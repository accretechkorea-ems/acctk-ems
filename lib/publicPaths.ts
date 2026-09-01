// 로그인 없이 열리는 경로. 미들웨어의 통과 여부와 화면 껍데기(헤더·세션 감시) 제외를
// 같은 목록으로 판단해야 어긋나지 않는다. 새 공개 페이지가 생기면 여기에만 추가한다.
//
// 참조하는 곳
//   · middleware.ts               — 미로그인 접근 허용
//   · components/common/HeaderWrapper.tsx  — 헤더·네비게이션 숨김
//   · components/common/SessionManager.tsx — 자동 로그아웃 감시 제외
//     (layout.tsx 는 서버 컴포넌트라 경로를 볼 수 없어, 그 자리에 놓이는
//      두 클라이언트 컴포넌트가 대신 이 목록을 본다)
export const PUBLIC_PATHS = ['/login', '/lead'] as const

export function isPublicPath(pathname: string): boolean {
  return (PUBLIC_PATHS as readonly string[]).includes(pathname)
}

// 공개 페이지가 실제로 불러오는 정적 파일.
// 미들웨어 matcher 는 _next/static 만 비켜가고 public/ 은 그대로 막기 때문에,
// 여기에 적지 않으면 미로그인 방문자에게 로고가 307 로 잘려 빈 자리로 보인다.
// public/ 전체를 여는 대신 쓰는 파일만 하나씩 연다.
export const PUBLIC_ASSETS = ['/pdflogo.png'] as const

export function isPublicAsset(pathname: string): boolean {
  return (PUBLIC_ASSETS as readonly string[]).includes(pathname)
}
