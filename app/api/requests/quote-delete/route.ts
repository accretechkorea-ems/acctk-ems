// 통합 요청함 — 견적 삭제 요청(quotes.status = '취소요청')의 조회·승인·반려.
//
// 클라이언트를 두 가지 쓴다. 섞으면 안 된다.
//   · 세션 클라이언트 — 로그인 확인, quotes/quote_items/quote_expenses 읽기·쓰기.
//     quotes 에는 감사 트리거(audit_row_change)가 걸려 있고 행위자를 auth.jwt() 에서 읽는다.
//     service role 로 쓰면 actor_email 이 NULL 로 남아 누가 처리했는지 사라진다.
//   · service role  — audit_log 읽기(superadmin 만 읽을 수 있다), engineers 조회,
//     notifications insert(남의 engineer_id 로 넣는 일은 서버에서만).
//
// 이전 상태(반려 시 되돌릴 값)는 quotes 어디에도 남지 않는다. audit_log 의
// '취소요청으로 전환된 마지막 UPDATE' 기록에서 old_data.status 를 꺼내 쓴다.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewAdmin } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'

const DELETE_REQUEST_STATUS = '취소요청'
/** 감사 기록이 없을 때 되돌릴 기본 상태. 트리거는 fail-open 이라 기록이 빌 수 있다. */
const DEFAULT_RESTORE_STATUS = '견적중'
const FAIL_STATUS = '실패'

const TYPE_REQUEST = 'quote_delete_request'
const TYPE_COMPLETED = 'quote_deleted'
const TYPE_REJECTED = 'quote_delete_rejected'

/** 감사 기록 한 번 조회의 상한. 대기 건이 많아도 이 안에서 끝난다. */
const AUDIT_SCAN_LIMIT = 2000

/** 견적 PDF 스토리지 버킷. quotes.pdf_url 은 '<버킷>/<파일명>' 꼴로 저장된다. */
const PDF_BUCKET = 'quote-pdfs'

type Caller = { engineer_id: number; name: string | null; permission_level: string | null; teams: string | null }

type QuoteRow = {
  quote_id: number
  quote_number: string | null
  quote_date: string | null
  customer_id: number | null
  total_supply: number | null
  delete_reason: string | null
  engineers: { name: string | null } | null
}

type AuditInfo = {
  prev_status: string | null
  prev_fail_reason: string | null
  requested_at: string
  requested_by_email: string | null
}

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/**
 * 로그인·권한 확인. 통과하면 세션 클라이언트와 caller 를 돌려준다.
 * 견적을 실제로 지우는 라우트라 팀 권한 캐시를 건너뛴다(권한을 거둔 직후에도 통과하면 곤란하다).
 */
async function authorize() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: bad('Unauthorized', 401), supabase, caller: null }

  const { data: callerRow, error: callerErr } = await supabase
    .from('engineers')
    .select('engineer_id, name, permission_level, teams')
    .eq('email', user.email!)
    .single()
  if (callerErr) console.error('[requests/quote-delete] caller lookup failed', { email: user.email, error: callerErr })
  if (!callerRow) return { error: bad('Forbidden', 403), supabase, caller: null }

  const caller = await withTeamPerm(callerRow as Caller, { fresh: true })
  if (!caller || !canViewAdmin(caller)) return { error: bad('Forbidden', 403), supabase, caller: null }

  return { error: null, supabase, caller }
}

/**
 * 견적별 '취소요청으로 전환된 가장 최근 기록'을 한 번의 쿼리로 읽는다.
 *
 * PostgREST 는 distinct on 을 못 하므로 occurred_at 내림차순으로 받아 견적마다 처음 나온 것만 쓴다.
 * old_data.status 가 이미 '취소요청' 인 기록은 전환이 아니라 같은 상태로 다시 저장한 것이므로
 * 건너뛰고 그다음(더 오래된) 기록을 본다 — SQL 의 `is distinct from` 과 같은 결과다.
 */
async function loadDeleteRequestAudit(sb: SupabaseClient, quoteIds: number[]): Promise<Map<number, AuditInfo>> {
  const map = new Map<number, AuditInfo>()
  if (quoteIds.length === 0) return map

  const { data, error } = await sb
    .from('audit_log')
    .select('row_id, occurred_at, actor_email, old_data')
    .eq('table_name', 'quotes')
    .eq('action', 'UPDATE')
    .eq('new_data->>status', DELETE_REQUEST_STATUS)
    .in('row_id', quoteIds.map(String))
    .order('occurred_at', { ascending: false })
    .limit(AUDIT_SCAN_LIMIT)
  if (error) {
    // 감사 기록을 못 읽어도 목록은 보여준다(이전 상태만 비게 된다).
    console.error('[requests/quote-delete] audit lookup failed', error)
    return map
  }

  type Row = { row_id: string | null; occurred_at: string; actor_email: string | null; old_data: Record<string, unknown> | null }
  for (const r of (data ?? []) as Row[]) {
    const id = Number(r.row_id)
    if (!Number.isFinite(id) || map.has(id)) continue
    const old = r.old_data ?? {}
    const prev = typeof old.status === 'string' ? old.status : null
    if (prev === DELETE_REQUEST_STATUS) continue
    map.set(id, {
      prev_status: prev,
      prev_fail_reason: typeof old.fail_reason === 'string' ? old.fail_reason : null,
      requested_at: r.occurred_at,
      requested_by_email: r.actor_email,
    })
  }
  return map
}

/** 이메일 → 엔지니어 이름. 못 찾은 이메일은 맵에 넣지 않는다. */
async function loadNamesByEmail(sb: SupabaseClient, emails: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (emails.length === 0) return map
  const { data, error } = await sb.from('engineers').select('email, name').in('email', emails)
  if (error) {
    console.error('[requests/quote-delete] engineer name lookup failed', error)
    return map
  }
  for (const e of (data ?? []) as { email: string | null; name: string | null }[]) {
    if (e.email && e.name) map.set(e.email, e.name)
  }
  return map
}

/**
 * 스토리지에 있는 견적 PDF 를 지운다. 견적 행이 지워진 뒤에 부른다.
 *
 * 경로 파싱은 /api/delete-quote-pdf:27-30 과 똑같이 한다 — 별도 규칙을 만들지 않는다.
 *   버킷 이름을 떼고(admin/page.tsx:371 이 하던 일), trim → '..' 제거 → 앞쪽 '/' 제거.
 *   남은 값이 비었거나 폴더 구분자가 있으면 잘못된 경로로 보고 지우지 않는다(경로 순회 방지).
 * 그 라우트의 '실제 견적 PDF 인지' 대조(:33-39)는 여기선 필요 없다 —
 * 지금 지운 바로 그 행의 pdf_url 을 쓰므로 이미 대조된 값이다.
 *
 * 돌려주는 값: true = 지웠음 / false = 지우지 못했음 / null = 지울 PDF 가 없음
 */
async function removeQuotePdf(sb: SupabaseClient, pdfUrl: string | null, quoteNumber: string | null): Promise<boolean | null> {
  if (!pdfUrl?.trim()) return null

  const safePath = pdfUrl.replace(`${PDF_BUCKET}/`, '').trim().replace(/\.\./g, '').replace(/^\/+/, '')
  if (!safePath || safePath.includes('/')) {
    console.error('[requests/quote-delete] invalid pdf path, skipped', { quoteNumber, pdfUrl })
    return false
  }

  const { error } = await sb.storage.from(PDF_BUCKET).remove([safePath])
  if (error) {
    console.error('[requests/quote-delete] pdf remove failed', { quoteNumber, pdfUrl, safePath, error })
    return false
  }
  return true
}

/**
 * 처리가 끝난 견적의 '삭제 요청' 알림 중 읽지 않은 것을 읽음으로 바꾼다.
 *
 * 이걸 안 하면 반려한 견적을 다시 삭제 요청했을 때 /api/quote-delete 의 중복 방지
 * (같은 견적번호의 미확인 요청 알림이 있으면 새로 만들지 않음)에 걸려 알림이 통째로 누락된다.
 * notifications 에 quote_id 컬럼이 없어(스키마 변경 금지) 메시지에 박힌 [견적번호]로 대조한다.
 */
async function markRequestNotificationsRead(sb: SupabaseClient, quoteNumber: string | null) {
  if (!quoteNumber) return
  const { error } = await sb
    .from('notifications')
    .update({ is_read: true })
    .eq('type', TYPE_REQUEST)
    .eq('is_read', false)
    .ilike('message', `%[${quoteNumber}]%`)
  if (error) console.error('[requests/quote-delete] mark request notifications read failed', { quoteNumber, error })
}

// ── GET: 대기 목록 ──────────────────────────────────────────────────
export async function GET() {
  const auth = await authorize()
  if (auth.error) return auth.error
  const supabase = auth.supabase

  // quotes 는 engineers 를 engineer_id(실적 귀속자)·created_by(작성자) 두 번 참조한다.
  // 관계를 지정하지 않으면 PGRST201(300 Multiple Choices)로 조회 전체가 실패한다.
  // 목록의 「담당자」는 실적 귀속자다.
  const { data, error } = await supabase
    .from('quotes')
    .select('quote_id, quote_number, quote_date, customer_id, total_supply, delete_reason, engineers!quotes_engineer_id_fkey(name)')
    .eq('status', DELETE_REQUEST_STATUS)
    .order('quote_date', { ascending: false })
  if (error) {
    console.error('[requests/quote-delete] pending list failed', error)
    return bad('요청 목록을 불러오지 못했습니다.', 500)
  }

  const quotes = (data ?? []) as unknown as QuoteRow[]
  if (quotes.length === 0) return NextResponse.json({ requests: [] })

  // 고객사명은 따로 읽는다(quotes 에 customers 임베딩을 걸지 않는다 — admin 화면과 같은 방식).
  const customerIds = [...new Set(quotes.map(q => q.customer_id).filter((id): id is number => id != null))]
  const custMap: Record<number, string> = {}
  if (customerIds.length > 0) {
    const { data: custData, error: custErr } = await supabase
      .from('customers').select('customer_id, company_name').in('customer_id', customerIds)
    if (custErr) console.error('[requests/quote-delete] customer lookup failed', custErr)
    for (const c of (custData ?? []) as { customer_id: number; company_name: string | null }[]) {
      if (c.company_name) custMap[c.customer_id] = c.company_name
    }
  }

  const supabaseAdmin = admin()
  const auditMap = await loadDeleteRequestAudit(supabaseAdmin, quotes.map(q => q.quote_id))
  const emails = [...new Set(
    [...auditMap.values()].map(a => a.requested_by_email).filter((e): e is string => !!e)
  )]
  const nameByEmail = await loadNamesByEmail(supabaseAdmin, emails)

  const requests = quotes.map(q => {
    const a = auditMap.get(q.quote_id)
    const email = a?.requested_by_email ?? null
    return {
      quote_id: q.quote_id,
      quote_number: q.quote_number,
      quote_date: q.quote_date,
      customer_name: q.customer_id != null ? custMap[q.customer_id] ?? null : null,
      total_supply: q.total_supply,
      engineer_name: q.engineers?.name ?? null,
      delete_reason: q.delete_reason,
      requested_at: a?.requested_at ?? null,
      // 이름을 못 찾으면 이메일을 그대로 내린다(퇴사자·계정 불일치 건도 누가 요청했는지는 보여야 한다).
      requester_name: email ? nameByEmail.get(email) ?? email : null,
      prev_status: a?.prev_status ?? null,
    }
  })

  return NextResponse.json({ requests })
}

// ── POST: 승인(삭제) / 반려(복원) ───────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error
  const supabase = auth.supabase
  const caller = auth.caller

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const quoteId = Number(body.quoteId)
  const action = typeof body.action === 'string' ? body.action : ''
  if (!Number.isInteger(quoteId) || quoteId <= 0) return bad('견적을 지정해주세요.')
  if (action !== 'approve' && action !== 'reject') return bad('Invalid action')

  // 판정은 화면이 보낸 값이 아니라 DB 의 지금 값으로 한다.
  const { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .select('quote_id, quote_number, status, engineer_id, created_by, pdf_url')
    .eq('quote_id', quoteId)
    .maybeSingle()
  if (quoteErr) {
    console.error('[requests/quote-delete] quote lookup failed', { quoteId, error: quoteErr })
    return bad('견적을 불러오지 못했습니다.', 500)
  }
  if (!quote) return bad('견적을 찾을 수 없습니다.', 404)
  if (quote.status !== DELETE_REQUEST_STATUS) return bad('이미 처리된 요청입니다', 409)

  const supabaseAdmin = admin()

  // ── 승인: 실제 삭제 ──
  if (action === 'approve') {
    // quote_expenses·quote_items 가 quotes 를 참조한다(FK 는 NO ACTION). 자식부터 지우고
    // 매 단계 error 를 확인한다 — 중간에 실패하면 멈춰야 품목만 지워진 상태로 남지 않는다.
    const { error: expErr } = await supabase.from('quote_expenses').delete().eq('quote_id', quoteId)
    if (expErr) {
      console.error('[requests/quote-delete] delete quote_expenses failed', { quoteId, error: expErr })
      return bad(`1단계(부대비용) 삭제에 실패했습니다 (${expErr.code || expErr.message})`, 500)
    }
    const { error: itemErr } = await supabase.from('quote_items').delete().eq('quote_id', quoteId)
    if (itemErr) {
      console.error('[requests/quote-delete] delete quote_items failed', { quoteId, error: itemErr })
      return bad(`2단계(견적 품목) 삭제에 실패했습니다. 부대비용은 이미 지워졌습니다 (${itemErr.code || itemErr.message})`, 500)
    }
    const { error: delErr } = await supabase.from('quotes').delete().eq('quote_id', quoteId)
    if (delErr) {
      console.error('[requests/quote-delete] delete quote failed', { quoteId, error: delErr })
      return bad(`3단계(견적서) 삭제에 실패했습니다. 품목·부대비용은 이미 지워졌습니다 (${delErr.code || delErr.message})`, 500)
    }

    // 행이 다 지워진 뒤에 스토리지 PDF 를 지운다. 순서를 뒤집으면 안 된다 —
    // PDF 를 먼저 지웠다가 행 삭제가 실패하면 견적은 남고 PDF 만 사라진다.
    // 여기서 실패해도 삭제는 이미 끝났으므로 승인 자체는 성공으로 응답하고, 고아 파일만 남는다.
    const pdfRemoved = await removeQuotePdf(supabaseAdmin, quote.pdf_url, quote.quote_number)

    // 삭제가 끝났음을 그 견적의 실적 담당자에게 알린다. 지운 사람이 본인이면 알리지 않는다.
    // 알림이 실패해도 삭제는 이미 끝났으므로 되돌리지 않는다.
    if (quote.engineer_id && quote.engineer_id !== caller.engineer_id) {
      const { error: notiErr } = await supabaseAdmin.from('notifications').insert({
        engineer_id: quote.engineer_id,
        title: '견적 삭제 완료',
        message: `[${quote.quote_number}] 견적이 삭제되었습니다.`,
        type: TYPE_COMPLETED,
        link: null,   // 견적이 사라져 이동할 곳이 없다
        is_read: false,
      })
      if (notiErr) console.error('[requests/quote-delete] completed notification insert failed', { quoteId, error: notiErr })
    }

    await markRequestNotificationsRead(supabaseAdmin, quote.quote_number)
    return NextResponse.json({ success: true, action: 'approve', pdfRemoved })
  }

  // ── 반려: 이전 상태로 복원 ──
  const comment = typeof body.comment === 'string' ? body.comment.trim() : ''
  if (!comment) return bad('반려 사유를 입력해주세요')

  const info = (await loadDeleteRequestAudit(supabaseAdmin, [quoteId])).get(quoteId) ?? null
  const restoreStatus = info?.prev_status ?? DEFAULT_RESTORE_STATUS
  // fail_reason 은 '실패' 로 되돌아갈 때만 살린다. 그 밖의 상태에서는 남아 있으면 안 되는 값이다.
  const failReason = restoreStatus === FAIL_STATUS ? info?.prev_fail_reason ?? null : null

  // status 조건을 함께 걸어 동시 처리를 막는다 — 0건이면 그사이 누가 먼저 처리한 것이다.
  const { data: updated, error: updErr } = await supabase
    .from('quotes')
    .update({ status: restoreStatus, delete_reason: null, fail_reason: failReason })
    .eq('quote_id', quoteId)
    .eq('status', DELETE_REQUEST_STATUS)
    .select('quote_id')
  if (updErr) {
    console.error('[requests/quote-delete] reject update failed', { quoteId, error: updErr })
    return bad('반려 처리에 실패했습니다.', 500)
  }
  if (!updated || updated.length === 0) return bad('이미 처리된 요청입니다', 409)

  // 요청자에게 알린다. 감사 기록의 이메일이 먼저고, 못 찾으면 작성자(없으면 실적 담당자)로 간다.
  let requesterId: number | null = null
  if (info?.requested_by_email) {
    const { data: eng, error: engErr } = await supabaseAdmin
      .from('engineers').select('engineer_id').eq('email', info.requested_by_email).maybeSingle()
    if (engErr) console.error('[requests/quote-delete] requester lookup failed', { quoteId, error: engErr })
    requesterId = eng?.engineer_id ?? null
  }
  if (requesterId == null) requesterId = quote.created_by ?? quote.engineer_id ?? null

  if (requesterId != null) {
    const { error: notiErr } = await supabaseAdmin.from('notifications').insert({
      engineer_id: requesterId,
      title: '견적 삭제 요청 반려',
      message: `[${quote.quote_number}] 삭제 요청이 반려되었습니다. 사유: ${comment}`,
      type: TYPE_REJECTED,
      link: '/dashboard',
      is_read: false,
    })
    if (notiErr) console.error('[requests/quote-delete] rejected notification insert failed', { quoteId, requesterId, error: notiErr })
  }

  await markRequestNotificationsRead(supabaseAdmin, quote.quote_number)
  return NextResponse.json({ success: true, action: 'reject', restoredStatus: restoreStatus })
}
