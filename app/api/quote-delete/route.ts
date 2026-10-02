import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu, isSuperAdmin } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { todayKST } from '@/lib/date'
import { checkLines, createApprovalDocument } from '@/lib/approval/submit'
import {
  AUDIT_ACTION_SELF, buildQuoteDeleteSummary, DELETE_REQUEST_STATUS, executeQuoteDelete,
  isSelfDeletable, notifyQuoteDeleted, QUOTE_DELETE_TARGET_TABLE, QUOTE_DELETE_TYPE,
  SELF_DELETABLE_STATUSES, writeDeleteAudit,
} from '@/lib/approval/quoteDelete'
import type { LineInput } from '@/lib/approval/types'

// 견적 삭제 라우트. 견적 상태에 따라 두 갈래다.
//   · self    — 아직 실적에 잡히지 않은 견적('견적중'·'실패')을 결재 없이 바로 지운다.
//   · request — 그 밖의 상태는 결재로 올린다. 결재선을 함께 받는다.
//
// 어느 쪽이든 지우는 절차는 lib/approval/quoteDelete.ts 의 executeQuoteDelete 한 벌이다.
//
// 예전에는 action 이 둘이었다. 'completed'(관리자가 /admin 에서 직접 지운 건의 알림)는 지웠다 —
// 관리자 화면의 직접 삭제 경로를 닫으면서 부르는 곳이 없어졌고, 견적 삭제 완료 알림은
// lib/approval/quoteDelete.ts 의 onCompleteQuoteDelete 가 보낸다.
//
// 상신은 결재 라우트를 HTTP 로 부르지 않고 lib/approval/submit 의 함수를 그대로 쓴다 —
// 쇼룸 사용 신청(app/api/showroom/requests)과 같은 방식이다. 같은 프로세스 안에서 끝낸다.
//
// quotes.status 는 화면이 '취소요청' 으로 바꾼 뒤 이 라우트를 부른다. 상태를 여기서 바꾸지 않는
// 이유는 quotes 에 걸린 감사 트리거가 행위자를 auth.jwt() 에서 읽기 때문이다 — service role 로
// 쓰면 누가 요청했는지가 audit_log 에서 사라지고, 반려 시 되돌릴 이전 상태도 그 기록에서 읽는다.

type Caller = { engineer_id: number; permission_level: string | null; teams: string | null }

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** 화면이 보낸 결재선을 읽는다. 모양만 맞추고 내용 검증은 checkLines 가 한다(쇼룸과 같다). */
function readLines(raw: unknown): LineInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  return raw.map(r => ({
    step: Number((r as LineInput)?.step),
    kind: (r as LineInput)?.kind,
    approverId: Number((r as LineInput)?.approverId),
    isDelegatedAuthority: (r as LineInput)?.isDelegatedAuthority === true,
  })) as LineInput[]
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const quoteId = Number(body?.quoteId)
  const action: string = body?.action ?? 'request'
  if (!quoteId) return NextResponse.json({ error: 'quoteId required' }, { status: 400 })
  if (action !== 'request' && action !== 'self') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const { data: callerRow } = await supabase
    .from('engineers')
    .select('engineer_id, permission_level, teams')
    .eq('email', user.email!)
    .single()
  if (!callerRow) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // 견적을 실제로 지우는 라우트다. 권한을 거둔 직후에도 통과하면 곤란해 캐시를 건너뛴다.
  const caller = await withTeamPerm(callerRow as Caller, { fresh: true })

  const supabaseAdmin = admin()

  // ── 본인 삭제 — 결재를 거치지 않는다 ──
  if (action === 'self') {
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
    if (!reason) return NextResponse.json({ error: '삭제 사유를 입력해주세요.' }, { status: 400 })

    const { data: quote, error: quoteErr } = await supabaseAdmin
      .from('quotes')
      .select('quote_id, quote_number, status, engineer_id, created_by')
      .eq('quote_id', quoteId)
      .single()
    if (quoteErr || !quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    if (!isSelfDeletable(quote.status)) {
      return NextResponse.json(
        { error: `수주 이후 상태의 견적은 결재를 거쳐야 합니다 (${quote.status})` }, { status: 409 })
    }

    // 권한 판정을 quotes 의 RLS(quotes_delete)와 똑같이 맞춘다 —
    // 「superadmin 이거나 quotes.engineer_id = 나」. 여기서만 넓게 열어 두면 아래 DELETE 가
    // 조용히 0행이 되어(RLS 는 막아도 에러를 내지 않는다) 원인을 알 수 없는 실패가 된다.
    // 대필 견적을 쓰기만 한 사람(created_by)은 실적 담당자가 아니라서 이 길로는 못 지운다.
    const mine = quote.engineer_id != null && quote.engineer_id === caller?.engineer_id
    if (!mine && !isSuperAdmin(caller)) {
      return NextResponse.json({ error: '본인 견적만 삭제할 수 있습니다.' }, { status: 403 })
    }

    // quotes 행은 세션 클라이언트로 지운다 — 그래야 감사 트리거에 누가 지웠는지 남는다.
    // 자식(품목·부대비용)은 CASCADE 로 DB 가 함께 지운다(RLS 를 타지 않는다 — executeQuoteDelete 주석).
    // service role 은 조회·감사·알림·스토리지에 쓴다.
    const done = await executeQuoteDelete({
      sb: supabaseAdmin, sbQuote: supabase, quoteId,
      allowedStatuses: SELF_DELETABLE_STATUSES, via: '본인',
    })
    if (!done.ok) return NextResponse.json({ error: done.error }, { status: done.status })

    await writeDeleteAudit(supabaseAdmin, done.quote, {
      action: AUDIT_ACTION_SELF,
      actorId: caller!.engineer_id,
      detail: { reason, status_before: done.quote.status, approval: false },
    })
    // superadmin 이 남의 견적을 지운 경우에만 알림이 간다.
    await notifyQuoteDeleted(supabaseAdmin, done.quote, [caller!.engineer_id])

    return NextResponse.json({ success: true, quoteNumber: done.quote.quote_number })
  }

  // ── 삭제 요청 상신 ──
  if (action === 'request') {
    const lines = readLines(body?.lines)
    if (!lines) return NextResponse.json({ error: '결재선을 지정해주세요.' }, { status: 400 })

    const { data: quote, error: quoteErr } = await supabaseAdmin
      .from('quotes')
      .select('quote_id, quote_number, status, delete_reason, engineer_id, created_by, customer_id, total_supply')
      .eq('quote_id', quoteId)
      .single()
    if (quoteErr || !quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    // 요청 권한 — 그 견적을 쓴 사람이거나, 실적 현황에서 남의 견적을 처리할 수 있는 관리자 권한.
    // 대필 건은 실적 담당자(engineer_id)가 아니라 쓴 사람(created_by)이 기준이다 —
    // 견적서를 만들지 않은 쪽은 지워도 되는 건인지 판단할 수 없다.
    // created_by 가 빈 옛 데이터는 engineer_id 로 본다(대필 도입 전 건은 둘이 같다).
    const isOwner = caller?.engineer_id === (quote.created_by ?? quote.engineer_id)
    if (!isOwner && !canViewMenu(caller, 'approvals')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 실제로 삭제 요청 상태이고 사유가 있는 건만 올린다.
    if (quote.status !== DELETE_REQUEST_STATUS || !quote.delete_reason?.trim()) {
      return NextResponse.json({ error: 'Not a pending delete request' }, { status: 409 })
    }

    // 중복 방지 — 같은 견적으로 아직 도는 문서가 있으면 새로 올리지 않는다.
    // 옛 흐름은 알림 개수로 막았는데, 이제 문서 자체를 근거로 삼는다(더 정확하다).
    const { data: live, error: liveErr } = await supabaseAdmin
      .from('approval_documents')
      .select('document_id')
      .eq('doc_type', QUOTE_DELETE_TYPE)
      .eq('target_table', QUOTE_DELETE_TARGET_TABLE)
      .eq('target_id', quoteId)
      .eq('status', '진행중')
      .limit(1)
    if (liveErr) {
      console.error('[quote-delete] live document lookup failed', { quoteId, error: liveErr })
      return NextResponse.json({ error: '진행 중인 결재를 확인하지 못했습니다.' }, { status: 500 })
    }
    if (live && live.length > 0) {
      return NextResponse.json({ success: true, skipped: true, documentId: live[0].document_id })
    }

    // 결재선이 틀려서 막힐 건이면 문서를 만들기 전에 멈춘다.
    const lineProblem = await checkLines(supabaseAdmin, lines, caller!.engineer_id, QUOTE_DELETE_TYPE)
    if (lineProblem) return NextResponse.json({ error: lineProblem }, { status: 400 })

    const summary = await buildQuoteDeleteSummary(supabaseAdmin, quote)
    const made = await createApprovalDocument(supabaseAdmin, {
      docType: QUOTE_DELETE_TYPE,
      // 문서번호는 원 문서 번호를 따른다(설계서 — 견적은 견적번호).
      docNo: quote.quote_number ?? String(quote.quote_id),
      title: `견적 삭제 요청 — ${quote.quote_number ?? quote.quote_id}`,
      summary: summary as unknown as Record<string, unknown>,
      targetTable: QUOTE_DELETE_TARGET_TABLE,
      targetId: quoteId,
      lines,
      requesterId: caller!.engineer_id,
      today: todayKST(),
    })
    if (!made.ok) return NextResponse.json({ error: made.error }, { status: made.status })

    return NextResponse.json({ success: true, documentId: made.documentId })
  }

  // action 은 위에서 'self' 와 'request' 로 좁혔고 둘 다 위에서 끝난다 — 여기까지 오지 않는다.
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
