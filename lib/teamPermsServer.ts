// teams 권한 플래그의 서버(API 라우트) 전용 로더.
//
// lib/teamPerms.ts 는 'use client' 라 라우트 핸들러에서 쓸 수 없다.
//
// 캐시 —
//   요청마다 teams 를 읽으면 왕복이 한 번 더 늘어난다(견적 PDF 열기 한 번에 Supabase 왕복 6회 중 1회).
//   플래그는 거의 바뀌지 않으므로 30초만 들고 있는다. 오래 들고 있으면 권한을 바꿔도 반영이
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

const COLUMNS =
  'name, can_view_customers, can_view_dashboard, can_view_quote, can_view_pipeline, can_view_sales_mgmt, can_view_admin, can_view_leads'

const toPerm = (r: TeamRow): TeamPerm => ({
  customers: r.can_view_customers === true,
  dashboard: r.can_view_dashboard === true,
  quote: r.can_view_quote === true,
  pipeline: r.can_view_pipeline === true,
  salesMgmt: r.can_view_sales_mgmt === true,
  admin: r.can_view_admin === true,
  leads: r.can_view_leads === true,
})

/** 캐시 유효 시간(ms). 짧게 잡아 권한 변경이 오래 묵지 않게 한다. */
const TTL_MS = 30_000
let cache: { at: number; map: Map<string, TeamPerm> } | null = null

/** 관리자 화면에서 팀 권한을 바꾼 뒤 부른다(/api/team-perms). 다음 호출에서 다시 읽는다. */
export function invalidateTeamPerms(): void {
  cache = null
}

/**
 * teams 전체를 읽어 팀 이름 → 플래그 맵으로 돌려준다. 실패하면 빈 맵(= 전원 권한 없음).
 * fresh: true 면 캐시를 건너뛰고 반드시 다시 읽는다(권한 변경이 즉시 반영돼야 하는 라우트용).
 */
export async function loadTeamPerms(opts?: { fresh?: boolean }): Promise<Map<string, TeamPerm>> {
  if (!opts?.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.map
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data, error } = await supabaseAdmin.from('teams').select(COLUMNS)
  const map = new Map<string, TeamPerm>()
  if (error) {
    // 실패는 캐시하지 않는다 — 빈 맵을 30초 들고 있으면 그동안 전원이 권한 없음이 된다.
    console.error('[teamPerms/server] load failed', error)
    return map
  }
  for (const r of (data ?? []) as TeamRow[]) {
    if (r.name) map.set(r.name, toPerm(r))
  }
  cache = { at: Date.now(), map }
  return map
}

/** 이미 읽어둔 맵으로 engineer 에 플래그를 붙인다. 목록을 통째로 판정할 때 쓴다. */
export function attachTeamPerm<T extends EngineerLike>(map: Map<string, TeamPerm>, engineer: T): T {
  return { ...engineer, perm: engineer.teams ? map.get(engineer.teams) ?? null : null }
}

/** engineer 한 명에 플래그를 붙여 돌려준다. */
export async function withTeamPerm<T extends EngineerLike>(engineer: T | null | undefined, opts?: { fresh?: boolean }): Promise<T | null> {
  if (!engineer) return null
  return attachTeamPerm(await loadTeamPerms(opts), engineer)
}
