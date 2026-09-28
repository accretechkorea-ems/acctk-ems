// 통합 요청함 — 쇼룸 데모 사용 신청의 옛 목록. 처리 경로는 닫혔다(전자결재 4단계).
//
// 새 신청은 approval_documents 로 올라가므로 여기 목록에는 더 이상 쌓이지 않는다. 이미 처리된 옛 건을
// 요청함에서 계속 볼 수 있도록 GET 은 그대로 두고, 승인·반려·확인(POST)만 막았다.
//
// GET  — 신청 목록(관리자 팀 권한 canViewAdmin). approval_requests 의 읽기 정책은 본인 신청·superadmin 만
//        허용하므로, 요청함을 보는 관리자 팀 모두에게 보이려면 service role 로 읽어 내려 줘야 한다.
//        ?status=done  → 처리완료(승인·반려 — 사후 신청의 확인도 '승인'이다) 최근 50건, 처리일시 내림차순
//        그 밖(기본)   → 대기중 전부, 신청일시 내림차순
//        처리 버튼을 보일지(can_decide)는 대기중 건 중 superadmin 이면서 본인 신청이 아닌 건만이다.
// POST — 2026-09-28(전자결재 4단계)부터 닫혔다. 410 만 돌려준다 — 쇼룸 신청은 /approval 에서 처리한다.
//        결재를 거치지 않고 승인하는 경로를 남겨 두지 않기 위해 함수 본문을 비웠다.
// (옛 설명) POST — { requestId, action: 'approve' | 'reject' | 'confirm', comment? }
//        superadmin 만(permission_level 판정 — 팀 플래그가 아니다). 본인 신청은 처리할 수 없다(DB 제약 ar_no_self_approve).
//        사전 신청은 approve/reject, 사후 신청(이미 끝난 사용)은 confirm 만 받는다. 대기중이 아니면 409.
import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu, isSuperAdmin } from '@/lib/permissions'
import { DEMO_REQUEST_TYPE, REQUEST_PENDING, REQUEST_APPROVED, REQUEST_REJECTED } from '@/lib/showroom'
import { admin, bad, loadCaller, REQUEST_COLUMNS, type RequestRecord } from '@/app/api/showroom/requests/shared'

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
export async function POST() {
  // 쇼룸 신청의 승인·반려·확인은 전자결재(/api/approval)가 한다. 이 경로로 상태를 바꾸면
  // 결재선·이력이 남지 않으므로 아예 막는다.
  return bad('쇼룸 사용 신청은 이제 결재함(/approval)에서 처리합니다.', 410)
}