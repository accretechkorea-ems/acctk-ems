'use client'

// 「나는 누구인가」를 **앱 당 한 번** 읽는다.
//
// 예전에는 사이드바·각 화면·각 훅이 제각기 `auth.getUser()` → `engineers where email`
// → `loadTeamPerms()` 세 단계를 불렀다. 한 화면에 최소 두 벌이 겹쳤고(사이드바 + 그 화면),
// 세 단계가 직렬이라 화면 자료 조회는 그 사슬이 끝난 뒤에야 시작됐다(docs/perf-baseline.md).
//
// 방식은 lib/quoteCategories.ts·lib/teamPerms.ts 와 **같다** — 모듈 수준에 약속(Promise)을
// 캐시한다. 동시에 여러 곳에서 불러도 조회는 한 번만 나가고, 개발 모드의 Strict Mode
// 이중 실행도 같은 약속을 다시 받는다.
//
// 캐시를 버리는 때는 셋뿐이다: 로그인 · 로그아웃 · 권한 변경(invalidateMe).

import { createClient } from '@/lib/supabase/client'
import { attachTeamPerm, loadTeamPerms } from '@/lib/teamPerms'
import type { TeamPerm } from '@/lib/permissions'

/**
 * 로그인한 본인. 화면·훅이 쓰는 열만 적는다(select('*') 를 쓰지 않는다 — 규칙 5).
 * 모자란 열이 생기면 여기에 더하고 COLUMNS 도 함께 고친다.
 */
export type Me = {
  engineer_id: number
  name: string | null
  position: string | null
  teams: string | null
  permission_level: string | null
  office: string | null
  email: string | null
  tel: string | null
  /** 견적번호·보고서에 쓰는 담당자 이니셜. */
  initials: string | null
  /** 사업부 전환 권한(superadmin 과 함께일 때만 뜻이 있다). */
  can_switch_division: boolean | null
  resigned_date: string | null
  /** 실적 집계 개인 강제(null = 팀을 따른다). 홈 「내 실적」 카드가 본다. */
  in_sales_stats: boolean | null
  /**
   * 자택 주소와 그 좌표 — **본인 것만** 여기 실린다(이 조회는 자기 행 한 줄이다).
   *
   * 쓰는 곳은 고객사 지도의 「자택 출발」 하나다(components/home/MapView.tsx). 좌표를
   * 여기 실어 두면 지도가 열릴 때 조회가 늘지 않는다. 주소는 내 정보 화면이 되보여 준다.
   *
   * **남의 자택 주소는 어느 목록에도 싣지 않는다** — lib/appData/engineers.ts 의 열 목록과
   * 관리자 화면의 직원 조회에는 이 세 칸이 없다. 사는 곳은 업무에 쓰는 정보가 아니고,
   * 한 번 목록에 실리면 화면에 그리지 않아도 브라우저까지 나간다.
   */
  home_address: string | null
  home_lat: number | null
  home_lng: number | null
  /** 소속 팀이 켜 둔 메뉴 키 — team_permissions 에서 붙여준다. */
  perm: TeamPerm | null
}

const COLUMNS = 'engineer_id, name, position, teams, permission_level, office, email, tel, initials, can_switch_division, resigned_date, in_sales_stats, home_address, home_lat, home_lng'

/** 세션과 본인 행. 로그인하지 않았으면 둘 다 비어 있다. */
export type MeResult = {
  /** 세션의 메일. 세션은 있는데 engineers 행이 없는 경우를 가려내려고 따로 둔다. */
  email: string | null
  me: Me | null
  /** 조회가 실패했을 때 한 마디(세션 없음은 실패가 아니다). */
  error: string | null
}

let cache: Promise<MeResult> | null = null
/** 지금 읽어 둔(또는 읽는 중인) 세션 메일. 읽는 중이면 아직 null 이다. */
let loadedEmail: string | null = null

/** 로그인·로그아웃·권한 변경 뒤에 부른다. 다음 호출에서 다시 읽는다. */
export function invalidateMe(): void {
  cache = null
  loadedEmail = null
}

/**
 * **이미 그 사람으로 읽어 두었는가.**
 *
 * supabase-js 는 페이지를 열 때 저장된 세션을 복원하며 SIGNED_IN 을 한 번 더 쏜다. 그것을
 * 「로그인했다」로 받아 캐시를 버리면 같은 조회가 두 번 나가고(auth/user·engineers), me 가
 * 다시 바뀌면서 그 값을 보는 effect 들까지 전부 다시 돈다 — 홈의 자료 요청이 14~21 로
 * 흔들린 이유다(docs/perf/baseline-browser.md ①).
 *
 * 읽는 중(loadedEmail === null)이면 **같은 사람으로 본다** — 페이지를 열 때 세션은 하나다.
 */
export function isLoadedFor(email: string | null): boolean {
  if (cache === null || email === null) return false
  return loadedEmail === null || loadedEmail === email
}

/**
 * 세션의 메일.
 *
 * getUser() 를 쓰지 않는 이유 — 그것은 Auth 서버에 **왕복**해 토큰을 확인한다.
 * 로그인 직후 첫 로딩을 재어 보니 이 왕복 하나가 85~262ms 였고, 그것이 끝나야
 * engineers 조회가 시작됐다(docs/perf/login-flow.md ④-a).
 *
 * 브라우저에서는 확인할 것이 없다 — 여기서 얻은 메일은 **어느 행을 달라고 할지**
 * 고르는 데만 쓰고, 무엇이 돌아오는지는 서버의 RLS 가 정한다. 토큰을 스스로 위조해도
 * 남의 자료가 열리지 않는다. 그래서 그 자리에서 읽을 수 있는 getSession() 을 쓴다
 * (만료됐으면 supabase-js 가 알아서 토큰을 새로 받는다).
 *
 * **서버**(app/api/**)는 사정이 다르다 — 그쪽은 lib/sessionEmail.ts 가 서명을 검증한다.
 */
async function sessionEmail(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  const email = data.session?.user?.email ?? null
  if (email) return email
  // 세션이 비어 있을 때만 서버에 물어본다(쿠키가 갓 심긴 경우 등).
  const { data: userData } = await supabase.auth.getUser()
  return userData.user?.email ?? null
}

/** 본인 정보. 몇 번 불러도 조회는 앱 당 한 번이다. */
export function loadMe(): Promise<MeResult> {
  if (cache) return cache
  cache = (async (): Promise<MeResult> => {
    const supabase = createClient()
    // 팀 권한은 **내가 누구인지와 무관하다**(팀 전체를 읽는다). 그래서 메일을 알아내는
    // 일과 **나란히** 띄운다 — 예전에는 engineers 가 끝난 뒤에 시작해 사슬이 한 칸 길었다
    // (docs/perf/login-flow.md ④-c, 191ms).
    const permsPromise = loadTeamPerms()
    const email = await sessionEmail(supabase)
    loadedEmail = email
    if (!email) {
      // 미로그인은 오류가 아니다 — 미들웨어가 /login 으로 보낸다. 캐시도 비워 둔다
      // (로그인하고 돌아오면 다시 읽어야 한다).
      cache = null
      return { email: null, me: null, error: null }
    }
    const { data, error } = await supabase
      .from('engineers')
      .select(COLUMNS)
      .eq('email', email)
      .maybeSingle()
    if (error) {
      // 실패하면 캐시를 비워 다음 호출에서 다시 시도한다.
      console.error('[me] engineers 조회 실패', error)
      cache = null
      return { email, me: null, error: error.message || '본인 정보를 읽지 못했습니다' }
    }
    if (!data) return { email, me: null, error: null }
    // 메뉴 권한은 팀 플래그로 판정한다(팀 이름을 코드에 두지 않기 위해).
    // loadTeamPerms 도 모듈 캐시라 여기서 한 번 읽으면 앱 전체가 그 값을 쓴다.
    const map = await permsPromise
    return { email, me: attachTeamPerm(map, data as unknown as Me), error: null }
  })()
  return cache
}
