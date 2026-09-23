// 통합 요청함 — 쇼룸 데모 사용 신청의 목록·승인·반려·확인. 흐름 전체는 app/api/showroom/requests/shared.ts.
//
// GET  — 신청 목록(관리자 팀 권한 canViewAdmin). approval_requests 의 읽기 정책은 본인 신청·superadmin 만
//        허용하므로, 요청함을 보는 관리자 팀 모두에게 보이려면 service role 로 읽어 내려 줘야 한다.
//        ?status=done  → 처리완료(승인·반려 — 사후 신청의 확인도 '승인'이다) 최근 50건, 처리일시 내림차순
//        그 밖(기본)   → 대기중 전부, 신청일시 내림차순
//        처리 버튼을 보일지(can_decide)는 대기중 건 중 superadmin 이면서 본인 신청이 아닌 건만이다.
// POST — { requestId, action: 'approve' | 'reject' | 'confirm', comment? }
//        superadmin 만(permission_level 판정 — 팀 플래그가 아니다). 본인 신청은 처리할 수 없다(DB 제약 ar_no_self_approve).
//        사전 신청은 approve/reject, 사후 신청(이미 끝난 사용)은 confirm 만 받는다. 대기중이 아니면 409.
import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu, isSuperAdmin } from '@/lib/permissions'
import { DEMO_REQUEST_TYPE, REQUEST_PENDING, REQUEST_APPROVED, REQUEST_REJECTED } from '@/lib/showroom'
import {
  admin, bad, loadCaller, findOverlap, createUsageFromRequest, refreshApprovalPdf,
  notifyEngineer, markRequestNoticesRead, NOTICE_APPROVED, NOTICE_REJECTED, REQUESTER_LINK,
  REQUEST_COLUMNS, type RequestRecord,
} from '@/app/api/showroom/requests/shared'

const TAG = 'requests/showroom-demo'

/** 처리완료로 보이는 건수. */
const DONE_LIMIT = 50

// ── GET: 대기 / 처리완료 목록 ────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await loadCaller(TAG)
  if (auth.error) return auth.error
  const caller = auth.caller
  if (!canViewMenu(caller, 'approvals')) return bad('Forbidden', 403)

  const done = req.nextUrl.searchParams.get('status') === 'done'
  const sb = admin()
  const base = sb.from('approval_requests').select(REQUEST_COLUMNS).eq('request_type', DEMO_REQUEST_TYPE)
  const { data, error } = await (done
    ? base.in('status', [REQUEST_APPROVED, REQUEST_REJECTED]).order('decided_at', { ascending: false }).limit(DONE_LIMIT)
    : base.eq('status', REQUEST_PENDING).order('created_at', { ascending: false }))
  if (error) {
    console.error(`[${TAG}] list failed`, { done, error })
    return bad('데모 신청 목록을 불러오지 못했습니다.', 500)
  }
  const rows = (data ?? []) as unknown as RequestRecord[]

  // 신청자·처리자 이름은 지금 이름으로(신청자는 payload 에 신청 시점 이름이 있어 못 찾으면 그걸 쓴다).
  const ids = [...new Set(rows.flatMap(r => (r.approver_id != null ? [r.requester_id, r.approver_id] : [r.requester_id])))]
  const names = new Map<number, string>()
  if (ids.length > 0) {
    const { data: engs, error: engErr } = await sb.from('engineers').select('engineer_id, name').in('engineer_id', ids)
    if (engErr) console.error(`[${TAG}] engineer lookup failed`, engErr)
    for (const e of (engs ?? []) as { engineer_id: number; name: string | null }[]) if (e.name) names.set(e.engineer_id, e.name)
  }

  const superadmin = isSuperAdmin(caller)
  return NextResponse.json({
    requests: rows.map(r => ({
      request_id: r.request_id,
      status: r.status,
      created_at: r.created_at,
      decided_at: r.decided_at,
      reason: r.reason,
      comment: r.comment,
      has_pdf: !!r.pdf_url,
      requester_name: names.get(r.requester_id) ?? r.payload.requester_name,
      approver_name: r.approver_id != null ? names.get(r.approver_id) ?? null : null,
      is_self: r.requester_id === caller.engineer_id,
      can_decide: r.status === REQUEST_PENDING && superadmin && r.requester_id !== caller.engineer_id,
      payload: r.payload,
    })),
  })
}

// ── POST: 승인 / 반려 / 확인 ─────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await loadCaller(TAG, { fresh: true })
  if (auth.error) return auth.error
  const caller = auth.caller
  if (!isSuperAdmin(caller)) return bad('데모 신청은 superadmin 만 처리할 수 있습니다.', 403)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const requestId = Number(body.requestId)
  const action = typeof body.action === 'string' ? body.action : ''
  if (!Number.isInteger(requestId) || requestId <= 0) return bad('신청을 지정해주세요.')
  if (action !== 'approve' && action !== 'reject' && action !== 'confirm') return bad('Invalid action')
  const comment = typeof body.comment === 'string' ? body.comment.trim() : ''

  const sb = admin()
  // 판정은 화면이 보낸 값이 아니라 DB 의 지금 값으로 한다.
  const { data: row, error: rowErr } = await sb.from('approval_requests').select(REQUEST_COLUMNS).eq('request_id', requestId).maybeSingle()
  if (rowErr) {
    console.error(`[${TAG}] row lookup failed`, { requestId, error: rowErr })
    return bad('신청을 불러오지 못했습니다.', 500)
  }
  const r = row as unknown as RequestRecord | null
  if (!r || r.request_type !== DEMO_REQUEST_TYPE) return bad('신청을 찾을 수 없습니다.', 404)
  if (r.status !== REQUEST_PENDING) return bad('이미 처리된 요청입니다', 409)
  if (r.requester_id === caller.engineer_id) return bad('본인이 신청한 건은 처리할 수 없습니다.', 403)

  const retro = r.payload.is_retroactive === true
  if (retro && action !== 'confirm') return bad('사후 신청은 확인만 할 수 있습니다.')
  if (!retro && action === 'confirm') return bad('사전 신청은 승인 또는 반려합니다.')
  const no = r.payload.request_no
  const now = new Date().toISOString()

  // ── 반려 ──
  if (action === 'reject') {
    if (!comment) return bad('반려 사유를 입력해주세요')
    const { data: upd, error: updErr } = await sb
      .from('approval_requests')
      .update({ status: REQUEST_REJECTED, approver_id: caller.engineer_id, decided_at: now, comment, updated_at: now })
      .eq('request_id', requestId)
      .eq('status', REQUEST_PENDING)
      .select('request_id')
    if (updErr) {
      console.error(`[${TAG}] reject update failed`, { requestId, error: updErr })
      return bad('반려 처리에 실패했습니다.', 500)
    }
    if (!upd || upd.length === 0) return bad('이미 처리된 요청입니다', 409)

    // PDF 는 그대로 둔다 — 재작성하면 새로 만든다.
    await notifyEngineer(sb, r.requester_id, {
      title: '쇼룸 데모 신청 반려',
      message: `[${no}] 데모 신청이 반려되었습니다. 사유: ${comment}`,
      type: NOTICE_REJECTED,
      link: REQUESTER_LINK,
    })
    await markRequestNoticesRead(sb, no)
    return NextResponse.json({ success: true, action })
  }

  // ── 승인(사전) / 확인(사후) ──
  // 승인은 사용 기록을 만든다 — 겹치는 기록이 있으면 승인부터 막는다.
  if (action === 'approve') {
    const p = r.payload
    const ov = await findOverlap(sb, p.device_id, p.usage_date, p.start_time, p.end_time)
    if (ov.error) return bad('사용 기록을 확인하지 못했습니다.', 500)
    if (ov.clash) return bad(`같은 장비·같은 날 겹치는 사용 기록이 있습니다 (${ov.clash}). 기록을 정리한 뒤 승인해주세요.`, 409)
  }

  const { data: upd, error: updErr } = await sb
    .from('approval_requests')
    .update({ status: REQUEST_APPROVED, approver_id: caller.engineer_id, decided_at: now, comment: comment || null, updated_at: now })
    .eq('request_id', requestId)
    .eq('status', REQUEST_PENDING)
    .select(REQUEST_COLUMNS)
  if (updErr) {
    console.error(`[${TAG}] approve update failed`, { requestId, action, error: updErr })
    return bad(action === 'approve' ? '승인 처리에 실패했습니다.' : '확인 처리에 실패했습니다.', 500)
  }
  if (!upd || upd.length === 0) return bad('이미 처리된 요청입니다', 409)
  const record = upd[0] as unknown as RequestRecord

  if (action === 'approve') {
    // 계획 시간을 실제 시간으로 넣는다(나중에 신청자가 고친다). 작성자는 신청자.
    const usage = await createUsageFromRequest(sb, requestId, record.payload, record.requester_id)
    if ('error' in usage) {
      // 사용 기록 없이 '승인'으로 남으면 안 된다 — 대기중으로 되돌린다.
      const { error: rbErr } = await sb
        .from('approval_requests')
        .update({ status: REQUEST_PENDING, approver_id: null, decided_at: null, comment: null, updated_at: new Date().toISOString() })
        .eq('request_id', requestId)
        .eq('status', REQUEST_APPROVED)
      if (rbErr) console.error(`[${TAG}] approve rollback failed`, { requestId, error: rbErr })
      return bad(usage.error, usage.status)
    }
  }

  // 도장을 얹은 PDF 로 교체한다. 실패해도 승인은 끝났으므로 되돌리지 않고 응답에 알린다.
  const pdfOk = await refreshApprovalPdf(sb, record, action === 'approve' ? 'approved' : 'confirmed')

  if (action === 'approve') {
    const p = record.payload
    await notifyEngineer(sb, record.requester_id, {
      title: '쇼룸 데모 신청 승인',
      message: `[${no}] ${p.device_name} · ${p.usage_date} 데모 신청이 승인되었습니다. 사용 기록이 만들어졌습니다.`,
      type: NOTICE_APPROVED,
      link: REQUESTER_LINK,
    })
  }
  // 확인(사후)은 신청자에게 알리지 않는다 — 알림만 읽음으로 바꾸고 목록에서 뺀다.
  await markRequestNoticesRead(sb, no)
  return NextResponse.json({ success: true, action, pdfOk })
}
