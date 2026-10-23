// 서버 라우트에서 **세션의 메일**을 읽는다 — 읽기 전용 조회용.
//
// 왜 따로 두는가 — `auth.getUser()` 는 Supabase Auth 서버에 **왕복**해 토큰을 확인한다.
// 사이드바 배지(/api/approval?box=inbox)를 재어 보니 라우트 전체 319~632ms 중
// 권한 확인이 291~631ms 였고, 그 대부분이 이 왕복이었다(문서 조회는 나란히 끝났다 —
// docs/perf/latest-only.md 의 6단계 프로파일).
//
// `auth.getClaims()` 는 **그 자리에서** 토큰 서명을 검증한다(비대칭 키 프로젝트의 JWKS를
// 한 번 받아 캐시한다 — 이 프로젝트는 비대칭 키다. 화면에서 /auth/v1/.well-known/jwks.json 을
// 받는 것이 그 증거다). 왕복이 없으니 조회 한 번 값이 빠진다.
//
// ── 어디에 쓰고 어디에 쓰지 않는가 ────────────────────────────────────────────
//   쓴다     : 목록·건수 같은 **읽기** 조회. 서명과 만료를 확인하므로 남의 자료가 열리지 않는다.
//   쓰지 않는다: **쓰기**(승인·반려·상신 등). 로컬 검증은 「로그아웃했지만 아직 만료되지 않은
//              토큰」을 걸러내지 못한다. 쓰기는 지금처럼 getUser() 로 서버에 물어본다.

type AuthClient = {
  auth: {
    getClaims: () => Promise<{ data: { claims?: Record<string, unknown> } | null; error: unknown }>
    getUser: () => Promise<{ data: { user: { email?: string | null } | null } }>
  }
}

/**
 * 읽기 조회용 — 토큰을 로컬에서 검증해 메일을 돌려준다.
 * 로컬 검증이 되지 않으면(대칭 키 프로젝트·옛 토큰) 조용히 getUser() 로 떨어진다.
 */
export async function sessionEmailForRead(supabase: AuthClient): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getClaims()
    const email = data?.claims?.email
    if (!error && typeof email === 'string' && email) return email
  } catch {
    // 아래로 떨어진다.
  }
  const { data } = await supabase.auth.getUser()
  return data.user?.email ?? null
}
