import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isPublicPath, isPublicAsset } from '@/lib/publicPaths'
import { CHANGE_PASSWORD_PATH, RESIGNED_REASON, isResigned } from '@/lib/accountRules'

/**
 * 누구인지 못 물어봤을 때 **쉬었다 한 번 더** 묻는 사이(ms).
 * 화면 전환에서 사람이 느끼지 못하는 길이다. 하네스가 이 값을 본다.
 */
export const AUTH_RETRY_MS = 250

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  /**
   * 지금 누구인가 — **한 번 더 물어보고** 판정한다 (2026-11-27, 묶음5 8-2).
   *
   * ── 왜 ───────────────────────────────────────────────────────────────
   *   `getUser()` 는 Auth 서버에 묻는 **망 요청**이다. 그 한 번이 끊기거나 늦으면
   *   user 가 null 로 오고, 바로 아래 줄이 그 사람을 /login 으로 보낸다 —
   *   **토큰은 멀쩡한데 쓰던 중에 튕긴다.** 「사용 중에도 로그아웃된다」는 신고의
   *   가장 큰 몫이 여기다(화면을 옮길 때마다 이 요청이 한 번씩 나간다).
   *
   *   세션이 **정말** 끝났으면 두 번 물어도 null 이다. 한 번 더 묻는 값은 싸고,
   *   잘못 쫓아내는 값은 비싸다 — 하던 일을 잃는다.
   *
   * ⚠ 두 번째는 **곧바로** 묻지 않는다. 순간의 끊김이라면 조금 쉬어야 뜻이 있다.
   *   250ms 는 화면 전환에서 사람이 느끼지 못하는 길이다.
   */
  const askUser = async () => {
    try {
      const { data } = await supabase.auth.getUser()
      return data.user
    } catch {
      // 망이 아예 끊긴 경우 — 「없는 사람」이 아니라 「못 물어봤다」다.
      return null
    }
  }
  let user = await askUser()
  if (user === null) {
    await new Promise(r => setTimeout(r, AUTH_RETRY_MS))
    user = await askUser()
  }
  const { pathname } = request.nextUrl

  // API 라우트는 각 핸들러에서 인증 처리
  if (pathname.startsWith('/api/')) {
    return supabaseResponse
  }

  // 공개 경로(로그인 화면, 대리점 리드 등록 폼)와 그 화면이 쓰는 정적 파일은 미로그인도 그대로 연다.
  // 그 밖의 모든 경로는 종전대로 /login 으로 돌려보낸다.
  if (!user && !isPublicPath(pathname) && !isPublicAsset(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  /**
   * 퇴사 처리된 계정은 **다음 화면 이동에서 끊긴다**(2026-11-23).
   *
   * 왜 여기인가 — 서버 라우트는 이미 막혀 있었지만(lib/apiCaller.ts) 화면은 그대로 열렸다.
   * 로그인한 채 켜 둔 탭이 있으면 퇴사 처리를 해도 그 사람은 어제처럼 목록을 읽는다.
   * 로그인 문(app/login)·세션 갱신(lib/appData/me.ts)과 함께 네 자리를 다 막는다.
   *
   * 비용 — **화면 이동 한 번에 조회 한 번**이 는다. /api 와 정적 파일은 위에서 이미 빠졌고,
   * 미로그인도 빠지므로 늘어나는 것은 로그인한 사람의 페이지 이동뿐이다. 자리를 줄이려면
   * 토큰 클레임에 재직 여부를 심어야 하는데, 그러려면 퇴사 처리가 토큰을 갱신해야 한다
   * (지금 구조에 없다) — 그 교환은 하지 않았다.
   *
   * 조회가 실패하면 **그대로 들여보낸다**. 판정 자료를 못 읽었다고 재직자를 쫓아내지 않는다
   * (쓰기는 어차피 라우트가 다시 막는다 — 그쪽은 fail-closed 다).
   */
  /**
   * 비밀번호를 **초기화당한 사람**은 새 비밀번호를 정할 때까지 다른 화면으로 못 간다
   * (2026-11-26, 지시 D4). 표식은 engineers.must_change_password 다.
   *
   * 같은 한 줄 조회에 얹는다 — 화면 이동마다 조회가 하나 더 늘지 않게 한다.
   * ⚠ 칸이 아직 없으면(42703, db/must_change_password_20261126.sql 미적용) **떠밀지 않는다**.
   *   그래서 칸을 빼고 한 번 더 묻는다 — 재직 판정까지 함께 잃으면 안 되기 때문이다.
   */
  if (user?.email) {
    const first = await supabase
      .from('engineers')
      .select('resigned_date, must_change_password')
      .eq('email', user.email)
      .maybeSingle()
    let data = first.data as { resigned_date?: string | null; must_change_password?: boolean } | null
    const error = first.error
    if (error && (error.code === '42703' || error.code === 'PGRST204')) {
      // 표식 칸이 아직 없다 — 재직 판정만 받아 온다(떠밀기는 건너뛴다).
      ;({ data } = await supabase
        .from('engineers')
        .select('resigned_date')
        .eq('email', user.email)
        .maybeSingle())
    }
    if (isResigned(data)) {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = `?reason=${RESIGNED_REASON}`
      return NextResponse.redirect(url)
    }
    const mustChange = (data as { must_change_password?: boolean } | null)?.must_change_password === true
    if (mustChange && pathname !== CHANGE_PASSWORD_PATH) {
      const url = request.nextUrl.clone()
      url.pathname = CHANGE_PASSWORD_PATH
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
