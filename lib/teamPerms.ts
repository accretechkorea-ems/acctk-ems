'use client'

// team_permissions(팀 × 메뉴 키)를 읽어 engineer 에 붙여준다.
//
// engineers.teams 는 팀 이름 문자열이라 PostgREST 임베딩(FK 조인)이 안 된다.
// 대신 teams(이름)와 team_permissions(키) 둘을 한 번씩 읽어 모듈 수준에 캐시하고
// 이름으로 맞춘다. 두 조회는 나란히 나가고 세션당 한 번뿐이며, 행이 적어 부담도 없다.
// 유지보수 화면에서 권한을 바꾸면 새로고침 후 반영된다(캐시가 세션 단위이므로).
//
// 권한 행이 하나도 없는 팀도 빈 집합으로 맵에 넣는다 — 「팀은 있는데 아직 아무것도
// 켜지 않은 상태」와 「없는 팀」을 구분하기 위해서다.

import { createClient } from '@/lib/supabase/client'
import type { EngineerLike, TeamPerm } from '@/lib/permissions'

type TeamRow = { id: number | null; name: string | null }
type PermRow = { team_id: number | null; perm_key: string | null }

// 진행 중인 요청을 공유해, 여러 화면이 동시에 떠도 조회는 한 번만 나간다.
let cache: Promise<Map<string, TeamPerm>> | null = null

/** 관리자 화면에서 팀 권한을 바꾼 뒤 부른다. 다음 호출에서 다시 읽는다(offices 와 같은 방식). */
export function invalidateTeamPerms(): void {
  cache = null
}

export function loadTeamPerms(): Promise<Map<string, TeamPerm>> {
  if (cache) return cache
  cache = (async () => {
    const supabase = createClient()
    const [teamsRes, permsRes] = await Promise.all([
      supabase.from('teams').select('id, name'),
      supabase.from('team_permissions').select('team_id, perm_key'),
    ])
    const error = teamsRes.error ?? permsRes.error
    if (error) {
      // 실패하면 캐시를 비워 다음 호출에서 다시 시도한다. 그동안은 권한 없음으로 취급된다.
      console.error('[teamPerms] load failed', error)
      cache = null
      return new Map<string, TeamPerm>()
    }
    return buildMap(teamsRes.data as TeamRow[] | null, permsRes.data as PermRow[] | null)
  })()
  return cache
}

/** 팀 이름 → 켜 둔 메뉴 키 집합. */
function buildMap(teams: TeamRow[] | null, perms: PermRow[] | null): Map<string, TeamPerm> {
  const nameOf = new Map<number, string>()
  const map = new Map<string, TeamPerm>()
  for (const t of teams ?? []) {
    if (t.id == null || !t.name) continue
    nameOf.set(t.id, t.name)
    map.set(t.name, { menus: new Set<string>() })
  }
  for (const p of perms ?? []) {
    if (p.team_id == null || !p.perm_key) continue
    const name = nameOf.get(p.team_id)
    if (name) map.get(name)?.menus.add(p.perm_key)
  }
  return map
}

/** 이미 읽어둔 맵으로 권한을 붙인다. 목록을 판정할 때 맵을 한 번만 읽으려고 분리해 둔다. */
export function attachTeamPerm<T extends EngineerLike>(map: Map<string, TeamPerm>, engineer: T): T {
  return { ...engineer, perm: engineer.teams ? map.get(engineer.teams) ?? null : null }
}

/** engineer 에 소속 팀의 권한을 붙여 돌려준다. 팀이 없거나 못 찾으면 perm 은 null. */
export async function withTeamPerm<T extends EngineerLike>(engineer: T | null | undefined): Promise<T | null> {
  if (!engineer) return null
  return attachTeamPerm(await loadTeamPerms(), engineer)
}

/** 직원 목록 전체에 권한을 붙인다(조회는 한 번). 실적·알림 대상 선별처럼 목록을 판정할 때 쓴다. */
export async function withTeamPerms<T extends EngineerLike>(list: T[] | null | undefined): Promise<T[]> {
  if (!list || list.length === 0) return []
  const map = await loadTeamPerms()
  return list.map(e => attachTeamPerm(map, e))
}
