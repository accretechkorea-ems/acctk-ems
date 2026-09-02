'use client'

// teams 테이블의 권한 플래그를 읽어 engineer 에 붙여준다.
//
// engineers.teams 는 문자열이라 PostgREST 임베딩(FK 조인)이 안 된다.
// 대신 teams 전체(8행)를 한 번 읽어 모듈 수준에 캐시하고 이름으로 맞춘다.
// 화면마다 조인하지 않으므로 조회는 세션당 한 번뿐이고, 목록이 작아 메모리 부담도 없다.
// 유지보수 화면에서 플래그를 바꾸면 새로고침 후 반영된다(캐시가 세션 단위이므로).

import { createClient } from '@/lib/supabase/client'
import type { EngineerLike, TeamPerm } from '@/lib/permissions'

type TeamRow = {
  name: string | null
  can_view_customers: boolean | null
  can_view_dashboard: boolean | null
  can_view_quote: boolean | null
  can_view_pipeline: boolean | null
  can_view_sales_mgmt: boolean | null
  can_view_admin: boolean | null
  can_view_leads: boolean | null
}

// 진행 중인 요청을 공유해, 여러 화면이 동시에 떠도 조회는 한 번만 나간다.
let cache: Promise<Map<string, TeamPerm>> | null = null

const toPerm = (r: TeamRow): TeamPerm => ({
  customers: r.can_view_customers === true,
  dashboard: r.can_view_dashboard === true,
  quote: r.can_view_quote === true,
  pipeline: r.can_view_pipeline === true,
  salesMgmt: r.can_view_sales_mgmt === true,
  admin: r.can_view_admin === true,
  leads: r.can_view_leads === true,
})

export function loadTeamPerms(): Promise<Map<string, TeamPerm>> {
  if (cache) return cache
  cache = (async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('teams')
      .select('name, can_view_customers, can_view_dashboard, can_view_quote, can_view_pipeline, can_view_sales_mgmt, can_view_admin, can_view_leads')
    if (error) {
      // 실패하면 캐시를 비워 다음 호출에서 다시 시도한다. 그동안은 권한 없음으로 취급된다.
      console.error('[teamPerms] load failed', error)
      cache = null
      return new Map<string, TeamPerm>()
    }
    const map = new Map<string, TeamPerm>()
    for (const r of (data ?? []) as TeamRow[]) {
      if (r.name) map.set(r.name, toPerm(r))
    }
    return map
  })()
  return cache
}

/** 이미 읽어둔 맵으로 플래그를 붙인다. 목록을 판정할 때 맵을 한 번만 읽으려고 분리해 둔다. */
export function attachTeamPerm<T extends EngineerLike>(map: Map<string, TeamPerm>, engineer: T): T {
  return { ...engineer, perm: engineer.teams ? map.get(engineer.teams) ?? null : null }
}

/** engineer 에 소속 팀의 플래그를 붙여 돌려준다. 팀이 없거나 못 찾으면 perm 은 null. */
export async function withTeamPerm<T extends EngineerLike>(engineer: T | null | undefined): Promise<T | null> {
  if (!engineer) return null
  return attachTeamPerm(await loadTeamPerms(), engineer)
}

/** 직원 목록 전체에 플래그를 붙인다(조회는 한 번). 실적·알림 대상 선별처럼 목록을 판정할 때 쓴다. */
export async function withTeamPerms<T extends EngineerLike>(list: T[] | null | undefined): Promise<T[]> {
  if (!list || list.length === 0) return []
  const map = await loadTeamPerms()
  return list.map(e => attachTeamPerm(map, e))
}
