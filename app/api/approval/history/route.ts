// 결재 문서의 이력 조회 — service role 로 읽고, 열람 권한은 코드에서 본다.
//
// 왜 라우트로 옮겼는가. 문서 상세(components/approval/DocDetail.tsx)가 approval_history 를
// **브라우저 세션으로 직접** 읽고 있었다. 그러면 그 표의 RLS(ah_select)와 테이블 권한이 그대로
// 걸리는데, 화면은 「막혔다」와 「0건」을 구분할 수 없어(조회 실패를 빈 배열로 떨어뜨렸다)
// 상신 직후에도 「기록이 없습니다」로 보였다. 결재함 목록·검토표가 이미 service role 라우트를
// 거치는 것과 같은 방식으로 맞춘다.
//
// 왜 /api/approval 의 action 이 아니고 따로 두는가 — 그 라우트의 POST 는 **상태를 바꾸는** 액션만
// 모아 두었고(승인·반려·회수·폐기·재상신), GET 은 결재함 목록(box=…) 하나다. 이력은 읽기이고
// 함도 아니라 어느 쪽에도 끼지 않는다. 형제 라우트(approval/done, approval/delegations)가 이미
// 같은 방식으로 떨어져 있어 그 모양을 따랐다.
//
// 돌려주는 것은 **DocDetail 이 그리는 칸 그대로**다(history_id·action·actor_id·step·comment·created_at,
// created_at 오름차순). 사람 이름은 담지 않는다 — 화면이 이미 engineers 를 통째로 읽어 두고
// actor_id 를 이름으로 바꾼다(app/approval/page.tsx 의 people). 여기서 또 조인하면 왕복만 는다.

import { NextRequest, NextResponse } from 'next/server'
import { loadCaller } from '@/lib/apiCaller'
import { canViewApprovalDocument } from '@/lib/approval/docAccess'

const TAG = 'approval/history'

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** DocDetail 이 읽는 칸. 늘리지 마라 — 화면이 쓰지 않는 값을 내보낼 이유가 없다. */
const HISTORY_SELECT = 'history_id, action, actor_id, step, comment, created_at'

export async function GET(req: NextRequest) {
  const documentId = Number(req.nextUrl.searchParams.get('document_id'))
  if (!Number.isSafeInteger(documentId) || documentId <= 0) return bad('문서를 지정해주세요.')

  // 로그인·재직·팀 권한 부착을 한 줄로(lib/apiCaller.ts). 「approvals 메뉴 권한자」 줄은
  // 팀 권한이 붙어 있어야 돌고(docAccess.ts), 읽기(GET)라 캐시를 그대로 쓴다.
  const { error: authErr, caller, sb } = await loadCaller({ kind: 'login' }, { tag: TAG, req })
  if (authErr) return authErr

  const { data: docRow, error: docErr } = await sb
    .from('approval_documents')
    .select('document_id, requester_id')
    .eq('document_id', documentId)
    .maybeSingle()
  if (docErr) {
    console.error(`[${TAG}] document lookup failed`, { documentId, error: docErr })
    return bad('문서를 불러오지 못했습니다.', 500)
  }
  const doc = (docRow ?? null) as { document_id: number; requester_id: number } | null
  if (!doc) return bad('문서를 찾을 수 없습니다.', 404)

  // 권한을 **읽기보다 먼저** 본다 — 볼 수 없는 사람의 요청에는 이력 조회가 아예 나가지 않는다.
  // 판정이 실패하면 거짓이다(fail-closed, docAccess.ts).
  if (!(await canViewApprovalDocument(sb, doc, caller))) {
    console.warn(`[${TAG}] 권한 없음`, { documentId, callerId: caller.engineer_id })
    return bad('이 문서를 볼 권한이 없습니다.', 403)
  }

  const { data, error } = await sb
    .from('approval_history')
    .select(HISTORY_SELECT)
    .eq('document_id', documentId)
    .order('created_at', { ascending: true })
  if (error) {
    // 화면이 「0건」과 가를 수 있게 **오류로** 돌려준다 — 그 구분이 이번 작업의 요점이다.
    console.error(`[${TAG}] history lookup failed`, { documentId, error })
    return bad('이력을 불러오지 못했습니다.', 500)
  }

  return NextResponse.json({ history: data ?? [] })
}
