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
import { withTeamPerm } from '@/lib/teamPerms'
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
  /** 사업부 전환 권한(superadmin 과 함께일 때만 뜻이 있다). */
  can_switch_division: boolean | null
  resigned_date: string | null
  /** 소속 팀이 켜 둔 메뉴 키 — team_permissions 에서 붙여준다. */
  perm: TeamPerm | null
}

const COLUMNS = 'engineer_id, name, position, teams, permission_level, office, email, tel, can_switch_division, resigned_date'

/** 세션과 본인 행. 로그인하지 않았으면 둘 다 비어 있다. */
export type MeResult = {
  /** 세션의 메일. 세션은 있는데 engineers 행이 없는 경우를 가려내려고 따로 둔다. */
  email: string | null
  me: Me | null
  /** 조회가 실패했을 때 한 마디(세션 없음은 실패가 아니다). */
  error: string | null
}

let cache: Promise<MeResult> | null = null

/** 로그인·로그아웃·권한 변경 뒤에 부른다. 다음 호출에서 다시 읽는다. */
export function invalidateMe(): void {
  cache = null
}

/** 본인 정보. 몇 번 불러도 조회는 앱 당 한 번이다. */
export function loadMe(): Promise<MeResult> {
  if (cache) return cache
  cache = (async (): Promise<MeResult> => {
    const supabase = createClient()
    const { data: userData, error: userErr } = await supabase.auth.getUser()
    const email = userData?.user?.email ?? null
    if (userErr || !email) {
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
    const withPerm = await withTeamPerm(data as unknown as Me)
    return { email, me: (withPerm as Me | null) ?? null, error: null }
  })()
  return cache
}
