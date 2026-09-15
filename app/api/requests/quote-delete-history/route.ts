// 통합 요청함 — 처리가 끝난 견적 삭제 요청(최근 50건). 읽기 전용. GET 만 있다.
//
// 견적 삭제 요청은 quotes.status = '취소요청' 으로만 관리되고 처리 이력 테이블이 없다. 대신 감사 기록(audit_log)에
// 남은 두 가지로 처리 결과를 되살린다. 견적 삭제 처리 라우트(/api/requests/quote-delete)는 건드리지 않는다.
//   · 승인(삭제) — quotes 의 DELETE 기록 중 지우기 직전 상태가 '취소요청' 인 것. old_data 에 견적 행 전체가 있다.
//   · 반려(복원) — quotes 의 UPDATE 기록 중 '취소요청' → 다른 상태로 바뀐 것. 되돌아간 상태도 함께 보인다.
//   처리자 = 그 기록의 actor_email(처리 라우트가 세션 클라이언트로 써서 감사 트리거가 남긴다).
//   반려 사유는 견적에 남지 않는다(반려하면 delete_reason 을 비운다). 반려 알림(quote_delete_rejected)의
//   「사유:」 문구에서 찾는다 — 같은 [견적번호]이고 처리 시각에 가장 가까운(5분 안) 알림.
// 감사 트리거는 fail-open 이라 기록이 빠진 건은 여기 나오지 않는다.
// audit_log 는 superadmin 만 읽을 수 있어 service role 로 읽는다. 로그인·권한(관리자 팀)은 세션으로 먼저 확인한다.
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { canViewAdmin } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'

const TAG = 'requests/quote-delete-history'
const DELETE_REQUEST_STATUS = '취소요청'
const TYPE_REJECTED = 'quote_delete_rejected'
/** 처리완료로 보이는 건수(승인·반려 합쳐 최근 순). */
const LIMIT = 50
/** 반려 사유를 찾을 때 훑는 최근 반려 알림 수. 요청자마다 한 건씩 남는다. */
const NOTICE_SCAN = 500
/** 반려 기록과 반려 알림의 시각 차이 허용 — 같은 처리 안에서 곧바로 이어 남는다. */
const NOTICE_MATCH_MS = 5 * 60 * 1000

type Caller = { engineer_id: number; name: string | null; permission_level: string | null; teams: string | null }

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 로그인 + 관리자 팀 권한. 읽기 전용이라 팀 권한 캐시(30초)를 그대로 쓴다. */
async function authorize() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: bad('Unauthorized', 401) }
  const { data: row, error } = await supabase
    .from('engineers')
    .select('engineer_id, name, permission_level, teams')
    .eq('email', user.email)
    .single()
  if (error) console.error(`[${TAG}] caller lookup failed`, { email: user.email, error })
  const caller = await withTeamPerm((row ?? null) as Caller | null)
  if (!caller || !canViewAdmin(caller)) return { error: bad('Forbidden', 403) }
  return { error: null }
}

type AuditRow = {
  row_id: string | null
  occurred_at: string
  actor_email: string | null
  old_data: Record<string, unknown> | null
  restored_status?: string | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

export async function GET() {
  const auth = await authorize()
  if (auth.error) return auth.error

  const sb = admin()
  const [delRes, rejRes] = await Promise.all([
    sb.from('audit_log')
      .select('row_id, occurred_at, actor_email, old_data')
      .eq('table_name', 'quotes')
      .eq('action', 'DELETE')
      .eq('old_data->>status', DELETE_REQUEST_STATUS)
      .order('occurred_at', { ascending: false })
      .limit(LIMIT),
    sb.from('audit_log')
      .select('row_id, occurred_at, actor_email, old_data, restored_status:new_data->>status')
      .eq('table_name', 'quotes')
      .eq('action', 'UPDATE')
      .eq('old_data->>status', DELETE_REQUEST_STATUS)
      .neq('new_data->>status', DELETE_REQUEST_STATUS)
      .order('occurred_at', { ascending: false })
      .limit(LIMIT),
  ])
  if (delRes.error || rejRes.error) {
    console.error(`[${TAG}] audit lookup failed`, { del: delRes.error, rej: rejRes.error })
    return bad('처리 이력을 불러오지 못했습니다.', 500)
  }

  const items = [
    ...((delRes.data ?? []) as AuditRow[]).map(a => ({ result: 'approved' as const, a })),
    ...((rejRes.data ?? []) as AuditRow[]).map(a => ({ result: 'rejected' as const, a })),
  ].sort((x, y) => y.a.occurred_at.localeCompare(x.a.occurred_at)).slice(0, LIMIT)
  if (items.length === 0) return NextResponse.json({ requests: [] })

  // 이름 — 처리자(이메일), 담당자(engineer_id), 고객사(customer_id). 서로 필요 없어 나란히 읽는다.
  const emails = [...new Set(items.map(i => i.a.actor_email).filter((e): e is string => !!e))]
  const engIds = [...new Set(items.map(i => num(i.a.old_data?.engineer_id)).filter((n): n is number => n != null))]
  const custIds = [...new Set(items.map(i => num(i.a.old_data?.customer_id)).filter((n): n is number => n != null))]
  const hasRejected = items.some(i => i.result === 'rejected')
  const [byEmail, byId, custs, notices] = await Promise.all([
    emails.length ? sb.from('engineers').select('email, name').in('email', emails) : Promise.resolve({ data: [], error: null }),
    engIds.length ? sb.from('engineers').select('engineer_id, name').in('engineer_id', engIds) : Promise.resolve({ data: [], error: null }),
    custIds.length ? sb.from('customers').select('customer_id, company_name').in('customer_id', custIds) : Promise.resolve({ data: [], error: null }),
    hasRejected
      ? sb.from('notifications').select('created_at, message').eq('type', TYPE_REJECTED).order('created_at', { ascending: false }).limit(NOTICE_SCAN)
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const [label, res] of [['engineers(email)', byEmail], ['engineers(id)', byId], ['customers', custs], ['notifications', notices]] as const) {
    if (res.error) console.error(`[${TAG}] ${label} lookup failed`, res.error)
  }
  const nameByEmail = new Map(((byEmail.data ?? []) as { email: string | null; name: string | null }[])
    .filter(e => e.email && e.name).map(e => [e.email as string, e.name as string]))
  const nameById = new Map(((byId.data ?? []) as { engineer_id: number; name: string | null }[])
    .filter(e => e.name).map(e => [e.engineer_id, e.name as string]))
  const custById = new Map(((custs.data ?? []) as { customer_id: number; company_name: string | null }[])
    .filter(c => c.company_name).map(c => [c.customer_id, c.company_name as string]))
  const rejectNotices = ((notices.data ?? []) as { created_at: string; message: string | null }[])
    .map(n => ({ at: Date.parse(n.created_at), message: n.message ?? '' }))

  /** 같은 [견적번호]이고 처리 시각에 가장 가까운 반려 알림의 「사유:」 뒤 문구. */
  const rejectReason = (quoteNumber: string | null, at: string): string | null => {
    if (!quoteNumber) return null
    const t = Date.parse(at)
    let best: { d: number; reason: string | null } | null = null
    for (const n of rejectNotices) {
      if (!n.message.includes(`[${quoteNumber}]`)) continue
      const d = Math.abs(n.at - t)
      if (d > NOTICE_MATCH_MS || (best && d >= best.d)) continue
      best = { d, reason: n.message.split('사유:')[1]?.trim() || null }
    }
    return best?.reason ?? null
  }

  const requests = items.map(({ result, a }) => {
    const old = a.old_data ?? {}
    const quoteNumber = str(old.quote_number)
    const engineerId = num(old.engineer_id)
    const customerId = num(old.customer_id)
    return {
      key: `${result}-${a.row_id ?? '?'}-${a.occurred_at}`,
      result,
      decided_at: a.occurred_at,
      // 이름을 못 찾으면 이메일을 그대로(퇴사자·계정 불일치 건도 누가 처리했는지는 보여야 한다).
      decider_name: a.actor_email ? nameByEmail.get(a.actor_email) ?? a.actor_email : null,
      quote_number: quoteNumber,
      customer_name: customerId != null ? custById.get(customerId) ?? null : null,
      total_supply: num(old.total_supply),
      engineer_name: engineerId != null ? nameById.get(engineerId) ?? null : null,
      delete_reason: str(old.delete_reason),
      reject_reason: result === 'rejected' ? rejectReason(quoteNumber, a.occurred_at) : null,
      restored_status: result === 'rejected' ? str(a.restored_status) : null,
    }
  })
  return NextResponse.json({ requests })
}
