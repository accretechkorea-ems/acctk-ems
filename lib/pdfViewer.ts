'use client'

// **PDF 모달 뷰어로 보내는 창구** — 어디서 불러도 가운데 모달에서 열린다.
//
// ── 왜 전역 창구인가 ────────────────────────────────────────────────────────
//   PDF 를 여는 자리가 화면 컴포넌트 밖에도 있다(lib/openQuotePdf.tsx 는 모듈 함수다).
//   그 자리들이 각자 모달을 들고 있을 수는 없어, 토스트처럼 **한 곳에 꽂아 두고 부른다**.
//   꽂는 쪽은 components/pdf/PdfViewerHost.tsx 하나뿐이다(앱 뿌리에 한 번 마운트된다).
//
// ── 못 여는 자리 ────────────────────────────────────────────────────────────
//   모바일 사파리는 iframe 안에서 PDF 를 그리지 못한다(첫 쪽만 보이거나 빈 칸이 된다).
//   호스트가 아직 안 꽂혔을 수도 있다(뿌리 밖 화면). 두 경우에는 **새 탭**으로 보낸다 —
//   shouldUseNewTab() 이 그 판정이고, 기다릴 일이 있는 부르는 쪽은 **먼저** 그것을 물어
//   빈 탭을 열어 둔다(응답을 받은 뒤에 여는 탭은 팝업 차단에 걸린다).

export type PdfDoc = {
  /** 서명 URL 또는 공개 주소. 뷰어가 **받아서 blob 으로** 띄운다(PdfViewerModal 주석). */
  url: string
  /** 머리줄에 적는 이름(파일명). */
  name: string
  /**
   * 문서마다 다른 단추 하나 — 수리내역서의 「정보 수정」이 그것이다.
   * 누르면 그 일을 하고 뷰어는 닫힌다.
   */
  action?: { label: string; onClick: () => void }
}

type Handler = (doc: PdfDoc) => void

let handler: Handler | null = null

/** 호스트가 꽂는다. 언마운트하면 같은 함수로 뺀다. */
export function setPdfViewerHandler(h: Handler | null): void {
  handler = h
}

/** 내장 뷰어로 못 여는 자리인가 — 그렇다면 새 탭으로 간다. */
export function shouldUseNewTab(): boolean {
  if (handler === null) return true
  if (typeof navigator === 'undefined') return true
  const ua = navigator.userAgent
  // iOS 사파리(크롬·파폭 iOS 는 WebKit 이지만 PDF 를 띄우는 길이 다르다 — 제외한다).
  const isIOS = /iP(hone|ad|od)/.test(ua)
  const isIOSSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
  return isIOSSafari
}

/**
 * PDF 를 연다. 모달로 열었으면 true, 새 탭으로 보냈으면 false.
 * `tab` 을 주면(미리 열어 둔 빈 탭) 새 탭으로 갈 때 그 탭을 쓴다.
 */
export function openPdf(doc: PdfDoc, tab?: Window | null): boolean {
  if (!shouldUseNewTab() && handler) {
    tab?.close()
    handler(doc)
    return true
  }
  if (tab) tab.location.href = doc.url
  else window.open(doc.url, '_blank')
  return false
}

/** 주소에서 파일 이름만 — 머리줄에 적는다. 못 뽑으면 기본값. */
export function pdfNameOf(url: string, fallback = '문서.pdf'): string {
  try {
    const path = new URL(url, 'http://x').pathname
    const last = decodeURIComponent(path.split('/').pop() ?? '')
    return last.toLowerCase().endsWith('.pdf') ? last : fallback
  } catch {
    return fallback
  }
}
