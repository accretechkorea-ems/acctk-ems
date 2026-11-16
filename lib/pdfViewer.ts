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

// ── 창 치수 — **A4 를 그대로 담는다** ──────────────────────────────────────
//   창을 넓게 잡으면 브라우저 PDF 뷰어가 쪽을 가운데 두고 좌우를 제 배경색으로 채운다.
//   그 검은 띠를 없애려면 창을 **문서 비율에 맞춰** 잡아야 한다. 세로를 먼저 정하고
//   (화면의 96% — 위아래 여백을 최소로), 가로는 그 세로에서 머리줄을 뺀 높이 × 210/297 에
//   세로 스크롤바 폭을 더한 값이다. 가로가 화면의 95% 를 넘으면 가로를 상한에 맞추고
//   세로를 비율대로 되돌린다(좁은 화면).

/** 머리줄 높이(px) — 계산이 정확하려면 높이를 못 박아야 한다. */
export const VIEWER_HEADER_H = 48
/** 창 세로 = 화면의 96%. */
export const VIEWER_VH = 0.96
/** 창 가로 상한 = 화면의 95%. */
export const VIEWER_MAX_VW = 0.95
/** A4 가로세로비. */
export const A4_RATIO = 210 / 297
/** 뷰어가 오른쪽에 세우는 세로 스크롤바 폭(px) — 이만큼 더 줘야 쪽이 안 눌린다. */
export const SCROLLBAR_W = 17
/** 아무리 좁아도 이보다 낮게는 만들지 않는다(px). */
const BODY_MIN_H = 240

/** 화면 크기에서 창 치수를 낸다 — 순수 함수다(scripts/pdf-viewer-check.js 가 그대로 돌린다). */
export function pdfViewerBox(vw: number, vh: number): { width: number; height: number; bodyHeight: number } {
  let bodyHeight = Math.max(BODY_MIN_H, Math.round(vh * VIEWER_VH) - VIEWER_HEADER_H)
  let width = Math.round(bodyHeight * A4_RATIO) + SCROLLBAR_W
  const maxWidth = Math.round(vw * VIEWER_MAX_VW)
  if (width > maxWidth) {
    width = maxWidth
    bodyHeight = Math.max(BODY_MIN_H, Math.round((width - SCROLLBAR_W) / A4_RATIO))
  }
  return { width, height: bodyHeight + VIEWER_HEADER_H, bodyHeight }
}

/**
 * 뷰어에게 주는 보기 설정 — 검은 툴바·쪽 목록을 감추고 가로에 맞춰 편다.
 * 듣지 않는 브라우저도 있다(그때는 그냥 기본 모양이다 — 해가 되지는 않는다).
 */
export const PDF_VIEW_PARAMS = '#toolbar=0&navpanes=0&scrollbar=1&view=FitH'

/** 브라우저 PDF 뷰어의 배경색 — 창 바탕을 이 색으로 맞춰야 이음매가 안 보인다. */
export const VIEWER_BG = '#e6e6e6'

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
