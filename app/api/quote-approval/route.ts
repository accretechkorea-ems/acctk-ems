// 견적서 결재 상신 라우트 — 전자결재 6단계 A.
//
// 왜 전용 라우트인가 — 범용 상신(/api/approval 의 action 'submit')은 막혀 있다. 그 액션은 원 문서가
// 부르는 사람의 것인지 보지 않아, 결재가 전원 공개인 상태에서 남의 견적으로 문서를 만들 수 있다
// (app/api/approval/route.ts 의 GENERIC_SUBMIT_DISABLED 설명). 그래서 업무별 라우트가 원 문서를
// 검증한 뒤 lib/approval/submit.ts 의 함수를 **같은 프로세스 안에서** 직접 부른다 —
// 쇼룸 사용 신청(app/api/showroom/requests)·견적 삭제 요청(app/api/quote-delete)과 같은 방식이다.
//
// action 둘
//   check  — 결재선만 검사한다. **부작용이 없다.** 확정 전에 결재선 오류를 걸러 내,
//            결재선이 틀린 건에 견적번호가 발급되지 않게 하는 것이 목적이다
//            (번호는 create_quote 가 채번하고 되돌릴 수 없다).
//   submit — 결재선 검사 → 견적 검증 → 상태를 '결재중' 으로 → 결재 문서 생성.
//            문서 생성이 실패하면 상태를 직전 값으로 되돌린다(그러지 않으면 결재도 수정도 못 하는
//            '결재중' 에 갇힌다 — 견적 삭제 요청 화면이 쓰는 되돌리기와 같은 이유다).
//
// quotes.status 를 여기서(service role 로) 바꾼다
//   견적 삭제 요청은 상태 변경을 화면에 남겨 두었다 — quotes 의 감사 트리거가 행위자를 auth.jwt()
//   에서 읽고, 반려 시 되돌릴 이전 상태도 그 기록에서 꺼내기 때문이다(그 라우트 머리말).
//   견적서 상신은 사정이 다르다. 되돌릴 상태를 audit_log 가 아니라 **문서 summary 에 담아 두므로**
//   감사 기록에 의존하지 않고, 상태 변경과 문서 생성이 한 요청 안에서 붙어 있어야 중간 상태
//   ('결재중' 인데 문서가 없는 견적)가 남지 않는다. 행위자는 아래 audit_log 한 줄로 따로 남긴다.

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { todayKST } from '@/lib/date'
import { checkLines, createApprovalDocument } from '@/lib/approval/submit'
import {
  buildQuoteSummary, loadQuoteGates, QUOTE_TARGET_TABLE, QUOTE_TYPE, SUBMITTED_STATUS,
  type QuoteRowForSummary,
} from '@/lib/approval/quoteApproval'
import { APPROVABLE_STATUSES, isApprovalTarget } from '@/lib/quoteStatus'
import type { LineInput } from '@/lib/approval/types'

const TAG = 'quote-approval'

/** 감사 기록의 action. 트리거가 남기는 UPDATE 와 구분된다. */
const AUDIT_ACTION_SUBMIT = 'QUOTE_APPROVAL_SUBMIT'

type Caller = { engineer_id: number; name: string | null; permission_level: string | null; teams: string | null }

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** 화면이 보낸 결재선을 읽는다. 모양만 맞추고 내용 검증은 checkLines 가 한다(쇼룸·견적 삭제와 같다). */
function readLines(raw: unknown): LineInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  return raw.map(r => ({
    step: Number((r as LineInput)?.step),
    kind: (r as LineInput)?.kind,
    approverId: Number((r as LineInput)?.approverId),
    isDelegatedAuthority: (r as LineInput)?.isDelegatedAuthority === true,
  })) as LineInput[]
}

/**
 * 견적 검증에 필요한 칸 — summary 가 읽는 칸을 모두 포함한다.
 * `deleted_at` 은 넣지 않는다 — quotes 에는 그 칸이 **없다**(견적은 소프트 삭제가 아니라 행을 지운다.
 * lib/approval/quoteDelete.ts 의 executeQuoteDelete). 없는 견적은 아래에서 404 로 걸린다.
 */
const QUOTE_SELECT = 'quote_id, quote_number, quote_date, created_at, status, quote_type, total_supply, customer_id, created_by, engineer_id'

type QuoteRow = QuoteRowForSummary & { quote_date: string | null; created_at: string | null }

/** 'gates' 가 한 번에 받는 견적 id 수 상한. 화면은 200개씩 끊어 부른다. */
const GATES_MAX = 300

/**
 * 본문에서 견적 id 목록을 읽는다. 중복을 지우고 상한까지만 받는다.
 * 숫자 모양(/^\d+$/)과 안전 정수를 함께 본다 — '1e3'·'01'·소수·공백이 섞여 들어오면 버린다.
 */
function readQuoteIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null
  const out = new Set<number>()
  for (const v of raw) {
    const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
    if (!/^\d+$/.test(s)) continue
    const n = Number(s)
    if (!Number.isSafeInteger(n) || n <= 0) continue
    out.add(n)
    if (out.size >= GATES_MAX) break
  }
  return [...out]
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return bad('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const action: string = typeof body?.action === 'string' ? body.action : ''
  if (action !== 'check' && action !== 'submit' && action !== 'gates') return bad('Invalid action')

  // 세션 → engineers. 퇴사자는 막는다(결재 라우트의 loadCaller 와 같은 기준).
  const { data: callerRow, error: callerErr } = await supabase
    .from('engineers')
    .select('engineer_id, name, permission_level, teams, resigned_date')
    .eq('email', user.email!)
    .single()
  if (callerErr) console.error(`[${TAG}] caller lookup failed`, { email: user.email, error: callerErr })
  const row = (callerRow ?? null) as (Caller & { resigned_date: string | null }) | null
  if (!row || row.resigned_date) return bad('Forbidden', 403)

  const sb = admin()

  // ── 승인 게이트 조회 — 부작용 없음 ──
  // 목록 화면이 행마다 「발주서 등록·계산서 요청·PDF 열기」를 보여 줄지 정하는 데 쓴다.
  // **견적 작성 권한을 요구하지 않는다** — 실적 현황·발주 화면처럼 견적 메뉴가 없는 팀도
  // 목록을 보고, 그 화면에서 버튼이 어긋나면 눌러서 409 를 받는다. 내보내는 것은 게이트 값
  // 하나뿐이라(문서 내용·결재선·반려 사유 없음) 로그인한 재직자면 충분하다.
  if (action === 'gates') {
    const ids = readQuoteIds(body?.quote_ids)
    if (ids === null) return bad('견적 목록을 보내주세요.')
    if (ids.length === 0) return NextResponse.json({ gates: {} })
    const res = await loadQuoteGates(sb, ids)
    if (!res.ok) return bad(res.error, 500)
    // 상태·생성 시각은 내보내지 않는다 — 화면이 쓸 것은 게이트 하나다.
    const gates: Record<string, string> = {}
    for (const [id, row] of res.gates) gates[String(id)] = row.gate
    return NextResponse.json({ gates })
  }

  // 견적을 상신하는 라우트다. 권한을 거둔 직후에도 통과하면 곤란해 캐시를 건너뛴다
  // (견적 삭제 요청 라우트와 같은 판단).
  const caller = await withTeamPerm(row as Caller, { fresh: true })
  if (!caller || !canViewMenu(caller, 'quote')) return bad('견적 작성 권한이 없습니다.', 403)

  const lines = readLines(body?.lines)
  if (!lines) return bad('결재선을 지정해주세요.')

  // ── 결재선만 검사 — 부작용 없음 ──
  // 확정(번호 발급) 전에 부른다. 종류별 규칙(관리자 결재자 1명 이상)까지 여기서 걸린다.
  const lineProblem = await checkLines(sb, lines, caller.engineer_id, QUOTE_TYPE)
  if (lineProblem) return bad(lineProblem)
  if (action === 'check') return NextResponse.json({ ok: true })

  // ── 상신 ──
  const quoteId = Number(body?.quote_id)
  if (!Number.isInteger(quoteId) || quoteId <= 0) return bad('견적을 지정해주세요.')

  const { data: found, error: readErr } = await sb
    .from('quotes').select(QUOTE_SELECT).eq('quote_id', quoteId).maybeSingle()
  if (readErr) {
    console.error(`[${TAG}] quote lookup failed`, { quoteId, error: readErr })
    return bad('견적을 불러오지 못했습니다.', 500)
  }
  const quote = (found ?? null) as QuoteRow | null
  if (!quote) return bad('견적을 찾을 수 없습니다.', 404)

  // 상신은 **쓴 사람**만 한다. 대필 견적이면 실적 담당자(engineer_id)가 아니라 작성자다 —
  // 실적을 받은 쪽은 견적서를 만들지 않았으므로 무엇을 올리는지 판단할 수 없다.
  // created_by 가 빈 옛 데이터는 결재 도입 전 견적이라 아래 isApprovalTarget 에서 걸린다.
  if (quote.created_by == null || quote.created_by !== caller.engineer_id) {
    return bad('견적을 작성한 사람만 결재를 올릴 수 있습니다.', 403)
  }

  // 도입 경계는 **생성 시각**으로 본다(견적일은 사람이 과거로 정할 수 있다 — quoteStatus.ts 설명).
  if (!isApprovalTarget(quote.created_at)) {
    return bad('결재 도입 전에 만든 견적은 결재 대상이 아닙니다.')
  }

  const before = quote.status
  if (!(APPROVABLE_STATUSES as readonly string[]).includes(before)) {
    return bad(`지금은 결재를 올릴 수 없는 상태입니다 (${before})`, 409)
  }

  // 같은 견적으로 만들어진 문서가 **어떤 상태로든** 있으면 올리지 않는다.
  // 진행중만 보면 반려·회수·폐기된 문서가 있는 견적을 다시 올릴 수 있게 되는데, 견적서는
  // 재상신을 막아 둔 유형이라(docTypes.ts 의 canResubmit) 내용을 고쳐 새로 쓰는 것이 정해진 길이다.
  const { data: existing, error: docErr } = await sb
    .from('approval_documents')
    .select('document_id, status')
    .eq('doc_type', QUOTE_TYPE)
    .eq('target_table', QUOTE_TARGET_TABLE)
    .eq('target_id', quoteId)
    .limit(1)
  if (docErr) {
    console.error(`[${TAG}] document lookup failed`, { quoteId, error: docErr })
    return bad('진행 중인 결재를 확인하지 못했습니다.', 500)
  }
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: '이미 결재 문서가 있는 견적입니다. 고쳐 쓰기로 새로 작성해 주세요', documentId: existing[0].document_id },
      { status: 409 },
    )
  }

  // 요약은 상태를 바꾸기 **전에** 만든다 — restore_status 가 상신 직전 상태여야 한다.
  const summary = await buildQuoteSummary(sb, quote)

  // 상태를 '결재중' 으로. 조건부 UPDATE 라 그사이 남이 손댔으면 0행이 된다.
  const { data: locked, error: lockErr } = await sb
    .from('quotes')
    .update({ status: SUBMITTED_STATUS })
    .eq('quote_id', quoteId)
    .eq('status', before)
    .select('quote_id')
  if (lockErr) {
    console.error(`[${TAG}] status lock failed`, { quoteId, before, error: lockErr })
    return bad('견적 상태를 바꾸지 못했습니다.', 500)
  }
  if (!locked || locked.length === 0) {
    return bad('견적 상태가 바뀌어 결재를 올리지 못했습니다. 목록을 새로 읽어 주세요.', 409)
  }

  const made = await createApprovalDocument(sb, {
    docType: QUOTE_TYPE,
    // 문서번호는 원 문서 번호를 따른다(설계서 — 견적은 견적번호).
    docNo: quote.quote_number ?? String(quoteId),
    title: `견적서 — ${quote.quote_number ?? quoteId}`,
    summary: summary as unknown as Record<string, unknown>,
    targetTable: QUOTE_TARGET_TABLE,
    targetId: quoteId,
    lines,
    // 상신자는 작성자다. 위에서 caller 와 같다는 것을 확인했다.
    requesterId: quote.created_by,
    today: todayKST(),
  })

  if (!made.ok) {
    // 문서가 없으면 견적이 '결재중' 에 갇힌다 — 직전 상태로 되돌린다.
    const { data: back, error: undoErr } = await sb
      .from('quotes')
      .update({ status: before })
      .eq('quote_id', quoteId)
      .eq('status', SUBMITTED_STATUS)
      .select('quote_id')
    if (undoErr || !back || back.length === 0) {
      console.error(`[${TAG}] 상신 실패 후 상태 복원 실패 — 견적이 '결재중' 에 남았다`, { quoteId, before, error: undoErr })
      return NextResponse.json(
        { error: `${made.error} 견적이 「결재중」에 남았습니다. 관리자에게 알려주세요.` },
        { status: made.status },
      )
    }
    return NextResponse.json({ error: made.error }, { status: made.status })
  }

  // 누가 올렸는지 한 줄. service role 로 상태를 바꿨으므로 quotes 의 감사 트리거에는
  // 행위자가 남지 않는다(이 파일 머리말). best-effort 다 — 기록이 실패해도 상신은 이미 끝났다.
  const { error: auditErr } = await sb.from('audit_log').insert({
    actor_email: user.email ?? null,
    action: AUDIT_ACTION_SUBMIT,
    table_name: QUOTE_TARGET_TABLE,
    row_id: String(quoteId),
    old_data: { status: before },
    new_data: {
      status: SUBMITTED_STATUS,
      approval_document_id: made.documentId,
      quote_number: quote.quote_number,
      submitted_by: caller.engineer_id,
    },
  })
  if (auditErr) console.error(`[${TAG}] audit insert failed`, { quoteId, error: auditErr })

  console.log(`[${TAG}] 상신 완료`, { quoteId, documentId: made.documentId, before })
  return NextResponse.json({ ok: true, documentId: made.documentId, notified: made.notified })
}
