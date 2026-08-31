import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewAdmin, isSuperAdmin } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'

// 견적 삭제 흐름의 알림을 만드는 라우트. 동작은 action 으로 나눈다(발주 라우트와 같은 방식).
//   · request   — 사용자가 삭제를 요청했다 → 관리자 전원에게
//   · completed — 관리자가 실제로 삭제했다 → 그 견적을 쓴 사람에게
//
// 라우트로 둔 이유:
//   · 요청자는 일반 사용자다. 관리자 명단(engineers.permission_level)을 읽게 하지 않는다.
//   · 남의 engineer_id 로 notifications 를 넣는 일은 서버(service role)에서만 하게 막는다.

const TYPE_REQUEST = 'quote_delete_request'
const TYPE_COMPLETED = 'quote_deleted'

// 삭제 완료를 인정하는 감사 기록의 유효 시간(분). 지난 삭제 건으로 알림을 만들지 못하게 한다.
const AUDIT_WINDOW_MIN = 5

type Caller = { engineer_id: number; permission_level: string | null; teams: string | null }

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const quoteId = Number(body?.quoteId)
  const action: string = body?.action ?? 'request'
  if (!quoteId) return NextResponse.json({ error: 'quoteId required' }, { status: 400 })
  if (action !== 'request' && action !== 'completed') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const { data: callerRow } = await supabase
    .from('engineers')
    .select('engineer_id, permission_level, teams')
    .eq('email', user.email!)
    .single()
  if (!callerRow) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const caller = await withTeamPerm(callerRow as Caller)

  const supabaseAdmin = admin()

  // ── 삭제 요청 알림 ──
  if (action === 'request') {
    const { data: quote, error: quoteErr } = await supabaseAdmin
      .from('quotes')
      .select('quote_id, quote_number, status, delete_reason, engineer_id')
      .eq('quote_id', quoteId)
      .single()
    if (quoteErr || !quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    // 요청 권한 — 본인 견적이거나, 실적 현황에서 남의 견적을 처리할 수 있는 관리자 권한.
    const isOwner = caller?.engineer_id === quote.engineer_id
    if (!isOwner && !canViewAdmin(caller)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 실제로 삭제 요청 상태이고 사유가 있는 건만 알린다.
    if (quote.status !== '취소요청' || !quote.delete_reason?.trim()) {
      return NextResponse.json({ error: 'Not a pending delete request' }, { status: 409 })
    }

    // 중복 방지 — 같은 견적번호로 아직 읽지 않은 삭제 요청 알림이 있으면 새로 만들지 않는다.
    // notifications 에 quote_id 컬럼이 없어(스키마 변경 금지) 메시지에 박힌 [견적번호]로 대조한다.
    const { count: pending } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('type', TYPE_REQUEST)
      .eq('is_read', false)
      .ilike('message', `%[${quote.quote_number}]%`)
    if (pending && pending > 0) {
      return NextResponse.json({ success: true, skipped: true })
    }

    // 대상 — 재직 중인 관리자 전원(요청자 본인 제외).
    const { data: allEng } = await supabaseAdmin
      .from('engineers')
      .select('engineer_id, permission_level, resigned_date')
    const targets = (allEng ?? []).filter((e: { engineer_id: number; permission_level: string | null; resigned_date: string | null }) =>
      isSuperAdmin(e) && !e.resigned_date && e.engineer_id !== caller?.engineer_id
    )
    if (targets.length === 0) return NextResponse.json({ success: true, notified: 0 })

    const { error: notiErr } = await supabaseAdmin.from('notifications').insert(
      targets.map((t: { engineer_id: number }) => ({
        engineer_id: t.engineer_id,
        title: '견적 삭제 요청',
        message: `[${quote.quote_number}] 견적 삭제가 요청되었습니다.`,
        type: TYPE_REQUEST,
        link: '/admin?tab=quotes',
        is_read: false,
      }))
    )
    if (notiErr) {
      console.error('[quote-delete] request notification insert failed', { quoteId, targets: targets.length, error: notiErr })
      return NextResponse.json({ error: '알림 생성에 실패했습니다.' }, { status: 500 })
    }
    return NextResponse.json({ success: true, notified: targets.length })
  }

  // ── 삭제 완료 알림 ──
  // 견적 행은 이미 사라져 다시 읽을 수 없다. 대신 quotes 에 걸린 감사 트리거가 남긴
  // audit_log 를 근거로 삼는다 — 견적번호·수신자를 여기서 읽으므로 클라이언트 값은 쓰지 않는다.
  if (!canViewAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: audit, error: auditErr } = await supabaseAdmin
    .from('audit_log')
    .select('occurred_at, actor_email, old_data')
    .eq('table_name', 'quotes')
    .eq('action', 'DELETE')
    .eq('row_id', String(quoteId))
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (auditErr || !audit) {
    console.error('[quote-delete] audit record not found', { quoteId, error: auditErr })
    return NextResponse.json({ success: true, skipped: true })
  }

  // 지운 사람 본인이 부른 것이 맞는지, 방금 지운 것이 맞는지 확인한다.
  const ageMin = (Date.now() - new Date(audit.occurred_at).getTime()) / 60000
  if (audit.actor_email !== user.email || ageMin > AUDIT_WINDOW_MIN) {
    console.error('[quote-delete] audit record mismatch', { quoteId, actor: audit.actor_email, ageMin })
    return NextResponse.json({ success: true, skipped: true })
  }

  const old = (audit.old_data ?? {}) as { quote_number?: string; engineer_id?: number }
  const quoteNumber = old.quote_number
  const ownerId = old.engineer_id
  if (!quoteNumber || !ownerId) {
    console.error('[quote-delete] audit old_data incomplete', { quoteId })
    return NextResponse.json({ success: true, skipped: true })
  }

  // 지운 사람이 그 견적의 작성자면 본인에게 알리지 않는다.
  if (ownerId === caller?.engineer_id) {
    return NextResponse.json({ success: true, notified: 0 })
  }

  const { error: notiErr } = await supabaseAdmin.from('notifications').insert({
    engineer_id: ownerId,
    title: '견적 삭제 완료',
    message: `[${quoteNumber}] 견적이 삭제되었습니다.`,
    type: TYPE_COMPLETED,
    link: null,   // 견적이 사라져 이동할 곳이 없다
    is_read: false,
  })
  if (notiErr) {
    console.error('[quote-delete] completed notification insert failed', { quoteId, ownerId, error: notiErr })
    return NextResponse.json({ error: '알림 생성에 실패했습니다.' }, { status: 500 })
  }

  return NextResponse.json({ success: true, notified: 1 })
}
