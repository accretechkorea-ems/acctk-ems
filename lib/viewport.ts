// 모바일 판정 한 곳.
//
// 이 서비스는 데스크톱 사용이 기본이고, 모바일은 현장 서비스 인원만 쓴다.
// 그래서 "모바일이면 현장에서 바로 필요한 화면을 먼저 보여준다"는 규칙이 몇 군데 있는데,
// 기준값이 흩어지지 않도록 여기 한 곳에서만 정한다.
// 값은 헤더가 이미 쓰고 있는 768px 과 같다(그 아래에서 PC 메뉴가 숨는다).

export const MOBILE_MAX_WIDTH = 768

/** 현재 화면이 모바일 폭인지. 서버(SSR)에서는 항상 false — 데스크톱 기준으로 그린다. */
export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth <= MOBILE_MAX_WIDTH
}
