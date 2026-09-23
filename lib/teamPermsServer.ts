// team_permissions(팀 × 메뉴 키)의 서버(API 라우트) 전용 로더.
//
// lib/teamPerms.ts 는 'use client' 라 라우트 핸들러에서 쓸 수 없다.
//
// 캐시 —
//   요청마다 다시 읽으면 왕복이 늘어난다(견적 PDF 열기 한 번에 Supabase 왕복 6회 중 1회).
//   권한은 거의 바뀌지 않으므로 30초만 들고 있는다. 오래 들고 있으면 권한을 바꿔도 반영이
//   늦어지고, 아예 안 들면 매번 왕복한다. 그 사이의 절충이다.
//   · 관리자 화면에서 팀 권한을 바꾸면 /api/team-perms 로 캐시를 즉시 버린다.
//   · 권한 변경이 늦게 반영되면 곤란한 라우트(상태를 바꾸는 쪽)는 loadTeamPerms({ fresh: true })
//     로 캐시를 건너뛴다 — 어디가 그런지는 각 라우트 주석에 적혀 있다.
//   ※ 서버가 여러 인스턴스로 뜨면 캐시도 인스턴스마다라, 무효화가 닿지 않은 쪽은 최대 30초까지
//     옛 값을 쓸 수 있다. 그래서 유효 시간을 짧게 뒀다.
//
// service role 로 읽는다 — 권한 판정 자료 자체가 RLS 에 막히면 안 되기 때문이다.

import { createClient } from '@supabase/supabase-js'
import type { EngineerLike, TeamPerm } from '@/lib/permissions'

type TeamRow = { id: number | null; name: string | null }
type PermRow = { team_id: number | null; perm_key: string | null }

/** 캐시 유효 시간(ms). 짧게 잡아 권한 변경이 오래 묵지 않게 한다. */
const TTL_MS = 30_000
let cache: { at: number; map: Map<string, TeamPerm> } | null = null

/** 관리자 화면에서 팀 권한을 바꾼 뒤 부른다(/api/team-perms). 다음 호출에서 다시 읽는다. */
export function invalidateTeamPerms(): void {
  cache = null
}

/** 팀 이름 → 켜 둔 메뉴 키 집합. 권한 행이 없는 팀도 빈 집합으로 넣는다. */
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

/**
 * 팀별 메뉴 권한을 읽어 팀 이름 → 키 집합 맵으로 돌려준다. 실패하면 빈 맵(= 전원 권한 없음).
 * fresh: true 면 캐시를 건너뛰고 반드시 다시 읽는다(권한 변경이 즉시 반영돼야 하는 라우트용).
 */
export async function loadTeamPerms(opts?: { fresh?: boolean }): Promise<Map<string, TeamPerm>> {
  if (!opts?.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.map
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const [teamsRes, permsRes] = await Promise.all([
    supabaseAdmin.from('teams').select('id, name'),
    supabaseAdmin.from('team_permissions').select('team_id, perm_key'),
  ])
  const error = teamsRes.error ?? permsRes.error
  if (error) {
    // 실패는 캐시하지 않는다 — 빈 맵을 30초 들고 있으면 그동안 전원이 권한 없음이 된다.
    console.error('[teamPerms/server] load failed', error)
    return new Map<string, TeamPerm>()
  }
  const map = buildMap(teamsRes.data as TeamRow[] | null, permsRes.data as PermRow[] | null)
  cache = { at: Date.now(), map }
  return map
}

/** 이미 읽어둔 맵으로 engineer 에 권한을 붙인다. 목록을 통째로 판정할 때 쓴다. */
export function attachTeamPerm<T extends EngineerLike>(map: Map<string, TeamPerm>, engineer: T): T {
  return { ...engineer, perm: engineer.teams ? map.get(engineer.teams) ?? null : null }
}

/** engineer 한 명에 권한을 붙여 돌려준다. */
export async function withTeamPerm<T extends EngineerLike>(engineer: T | null | undefined, opts?: { fresh?: boolean }): Promise<T | null> {
  if (!engineer) return null
  return attachTeamPerm(await loadTeamPerms(opts), engineer)
}
