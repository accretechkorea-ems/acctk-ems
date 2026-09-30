// 화면 안에 자체 좌측 레일이 있는 경로.
//
// 이런 화면은 왼쪽을 두 번 쓴다 — 메인 사이드바 + 화면 안 레일. 둘 다 펼쳐 두면 본문이
// 좁아져 가로로 넓은 목록이 잘린다. 그래서 들어갈 때 메인 사이드바를 접어 둔다.
//
// 접힘은 「임시」다. 저장된 설정(sidebar:collapsed:<id>)은 읽지도 쓰지도 않고, 그 화면을
// 벗어나면 저장값이 다시 드러난다. 머무는 동안 사용자가 직접 펼치면 그대로 펼쳐져 있다.
// 자세한 규칙은 components/common/HeaderWrapper.tsx 의 tempCollapsed 주석에 있다.
//
// 목록을 여기 따로 둔 이유 — 예전에는 HeaderWrapper 안에 '/approval' 이 하드코딩돼 있었다.
// 같은 배치를 쓰는 화면이 둘이 되면서, 경로 검사를 복사하는 대신 목록 한 곳으로 묶었다.
// 셋째 화면이 생기면 아래 배열에 한 줄만 더한다.
//
// 참조하는 곳
//   · components/common/HeaderWrapper.tsx — 들어가면 메인 사이드바를 임시로 접는다

/** 자체 레일이 있는 화면의 최상위 경로. 하위 경로도 같이 본다. */
export const RAIL_PATHS = ['/approval', '/inquiries'] as const

/**
 * 그 경로이거나 그 아래인지. '/approval' 과 '/approval/123' 둘 다 true 다.
 * '/approvals' 처럼 이름이 겹치는 다른 경로는 걸리지 않는다 — 구분자('/')까지 봐야 한다.
 */
export function hasInnerRail(pathname: string): boolean {
  return RAIL_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))
}
