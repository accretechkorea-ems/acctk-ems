// 결재 문서를 새 창으로 여는 길 — **계산은 순수 함수**, 창을 여는 것만 브라우저를 쓴다.
//
// 목록과 알림이 같이 쓴다. 규칙이 두 곳에 베껴지면 한쪽만 고쳐져 창 크기·이름이 어긋난다.
//
// 규칙
//   · 데스크톱 — 새 창(window.open). 창 이름을 **문서별로 고유**하게 주어 같은 문서를 다시 누르면
//     새 창이 또 열리지 않고 그 창이 앞으로 온다.
//   · 팝업 차단 — window.open 이 null 을 돌려준다. 그때는 **같은 창**에서 popup 없이 연다
//     (사이드바가 있는 평소 화면이다. 빈손으로 끝나면 사용자는 버튼이 고장 난 줄 안다).
//   · 모바일 — 작은 화면에서 새 창은 탭만 늘린다. 언제나 같은 창에서 연다.
//
// 모바일 판정은 저장소의 한 곳(lib/viewport.ts)을 쓴다 — 기준값(768px)을 여기서 다시 적지 않는다.

/** 문서 화면의 경로. 주소를 만드는 곳이 하나여야 한다. */
const DOC_BASE = '/approval/doc'

/** 창 크기 상한 — 이보다 크게 열지 않는다. 양식이 900px 폭이면 충분히 담긴다. */
export const DOC_WINDOW_MAX = { width: 1100, height: 900 } as const

/** 화면의 몇 할까지 쓰는가. 작은 화면에서는 화면을 꽉 채우지 않도록 여유를 둔다. */
const SCREEN_RATIO = 0.9

/** 문서 id 로 쓸 수 있는 값인가 — 양수 정수만. */
export const isDocId = (v: unknown): boolean => {
  const n = Number(v)
  return Number.isSafeInteger(n) && n > 0
}

/**
 * 문서 화면 주소. popup 이면 `?popup=1` 이 붙는다(사이드바 없이 그린다).
 * id 가 올바르지 않으면 **null** — 부르는 쪽이 아무것도 하지 않는다(엉뚱한 주소로 보내지 않는다).
 */
export function docUrl(documentId: unknown, opts?: { popup?: boolean }): string | null {
  if (!isDocId(documentId)) return null
  const id = Number(documentId)
  return opts?.popup ? `${DOC_BASE}/${id}?popup=1` : `${DOC_BASE}/${id}`
}

/** 창 이름 — 문서별로 고유하다. 같은 문서를 다시 누르면 그 창을 다시 쓴다. */
export function docWindowName(documentId: unknown): string | null {
  if (!isDocId(documentId)) return null
  return `approvalDoc${Number(documentId)}`
}

export type ScreenBox = { width: number; height: number; availLeft?: number; availTop?: number }

/**
 * 창 크기와 자리 — 화면 가운데.
 * 너비·높이는 각각 `min(상한, 화면 × 0.9)` 이고, 아무리 작아도 320×400 아래로는 내려가지 않는다
 * (그 아래면 양식이 아니라 글자만 남는다 — 그때는 어차피 모바일 판정으로 같은 창에서 연다).
 */
export function docWindowBox(screen: ScreenBox): { width: number; height: number; left: number; top: number } {
  const w = Math.max(320, Math.min(DOC_WINDOW_MAX.width, Math.floor(screen.width * SCREEN_RATIO)))
  const h = Math.max(400, Math.min(DOC_WINDOW_MAX.height, Math.floor(screen.height * SCREEN_RATIO)))
  const left = Math.max(0, Math.floor((screen.availLeft ?? 0) + (screen.width - w) / 2))
  const top = Math.max(0, Math.floor((screen.availTop ?? 0) + (screen.height - h) / 2))
  return { width: w, height: h, left, top }
}

/** window.open 에 넘기는 features 문자열. */
export function docWindowFeatures(box: { width: number; height: number; left: number; top: number }): string {
  return [
    `width=${box.width}`, `height=${box.height}`, `left=${box.left}`, `top=${box.top}`,
    'noopener=no', 'resizable=yes', 'scrollbars=yes',
  ].join(',')
}

/**
 * 새 창을 열어야 하는가 — 모바일이면 아니다.
 * 판정을 인자로 받아 순수하게 유지한다(부르는 쪽이 lib/viewport 의 isMobileViewport 를 넘긴다).
 */
export const shouldOpenWindow = (mobile: boolean): boolean => !mobile

/** 어디로 갔는가 — 보고·검증에서 쓴다. */
export type OpenOutcome = 'window' | 'same-tab' | 'invalid'

/**
 * 문서를 연다. 브라우저를 쓰는 유일한 함수다.
 *   navigate — 같은 창에서 열 때 쓰는 이동 함수(Next 의 router.push 를 넘긴다).
 * 돌려주는 값으로 어디로 갔는지 알 수 있다(팝업이 막혀 같은 창으로 떨어졌는지 등).
 */
export function openApprovalDoc(
  documentId: unknown,
  opts: { mobile: boolean; navigate: (url: string) => void },
): OpenOutcome {
  const popupUrl = docUrl(documentId, { popup: true })
  const plainUrl = docUrl(documentId)
  const name = docWindowName(documentId)
  if (!popupUrl || !plainUrl || !name) return 'invalid'

  if (!shouldOpenWindow(opts.mobile)) {
    opts.navigate(plainUrl)
    return 'same-tab'
  }

  const box = docWindowBox({
    width: window.screen?.availWidth ?? window.innerWidth,
    height: window.screen?.availHeight ?? window.innerHeight,
    availLeft: (window.screen as Screen & { availLeft?: number })?.availLeft ?? 0,
    availTop: (window.screen as Screen & { availTop?: number })?.availTop ?? 0,
  })
  const win = window.open(popupUrl, name, docWindowFeatures(box))
  if (!win) {
    // 팝업 차단 — 같은 창에서 평소 화면으로 연다.
    opts.navigate(plainUrl)
    return 'same-tab'
  }
  win.focus()
  return 'window'
}
