// 승인서 PDF 열기 — 비공개 버킷(showroom-approvals)이라 서명 URL 을 받아 새 창으로 연다.
// 전체기록 탭의 「내 신청」과 사용 기록 목록이 같이 쓴다. JSX 없음.
//
// kind — 'request' 는 옛 요청함 신청(approval_requests), 'doc' 는 전자결재 문서(approval_documents, 4단계).
//
// 서명 URL 은 비동기로 받으므로, 창을 먼저 열어 두고 주소만 나중에 넣는다 — 응답을 받은 뒤에 window.open 을
// 부르면 브라우저가 팝업으로 막는다. 실패하면 열어 둔 빈 창을 닫는다.

/** 성공이면 null, 실패면 화면에 띄울 메시지. */
export async function openApprovalPdf(id: number, kind: 'request' | 'doc' = 'request'): Promise<string | null> {
  const win = window.open('', '_blank')
  try {
    const param = kind === 'doc' ? 'doc' : 'id'
    const res = await fetch(`/api/showroom/requests/pdf?${param}=${id}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok || typeof body?.signedUrl !== 'string') {
      win?.close()
      return body?.error || '승인서를 열지 못했습니다.'
    }
    if (win) win.location.href = body.signedUrl
    else window.open(body.signedUrl, '_blank')
    return null
  } catch (e) {
    console.error('[showroom] approval pdf open failed', { id, kind, error: e })
    win?.close()
    return '승인서를 열지 못했습니다.'
  }
}
