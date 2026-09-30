// 통합 요청함 — 견적 삭제 요청의 옛 경로. 목록도 처리도 닫혔다(전자결재 5단계).
//
// 새 요청은 approval_documents 로 올라간다(app/api/quote-delete 가 상신한다). 삭제 실행과
// 반려·회수·폐기 시 복원은 lib/approval/quoteDelete.ts 의 실행 함수가 한다.
//
// GET  — 빈 목록만 돌려준다. 이 목록은 별도 테이블이 아니라 quotes.status = '취소요청' 을 그대로
//        읽어 만들던 것이라, 결재로 옮긴 뒤에는 「결재를 기다리는 견적」이 여기에도 섞여 보인다.
//        쇼룸(app/api/requests/showroom-demo)은 옛 신청이 별도 테이블에 남아 있어 GET 을 살려
//        두었지만, 이쪽은 보여 줄 옛 기록이 따로 없어 비운다.
// POST — 승인(삭제)·반려(복원)는 결재함(/approval)이 한다. 결재선·이력을 남기지 않고 견적을
//        지우는 경로를 남겨 두지 않기 위해 410 만 돌려준다.
//
// (옛 설명) GET  — quotes.status = '취소요청' 목록. 이전 상태는 audit_log 에서 읽어 붙였다.
//           POST — { quoteId, action: 'approve' | 'reject', comment? }. approvals 권한.
//                  승인이면 quote_expenses → quote_items → quotes 순으로 지우고 PDF 를 정리했다.
//                  그 실행 로직은 lib/approval/quoteDelete.ts 로 옮겨 그대로 쓴다.
import { NextResponse } from 'next/server'

// ── GET: 빈 목록 ────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({ requests: [] })
}

// ── POST: 닫힘 ──────────────────────────────────────────────────────
export async function POST() {
  return NextResponse.json(
    { error: '견적 삭제 요청은 이제 결재함(/approval)에서 처리합니다.' },
    { status: 410 },
  )
}
