// teams 권한 플래그의 서버(API 라우트) 전용 로더.
//
// lib/teamPerms.ts 는 'use client' 라 라우트 핸들러에서 쓸 수 없고,
// 서버에서 모듈 캐시를 들면 유지보수 화면에서 플래그를 바꿔도 프로세스를 다시 띄울 때까지
// 반영되지 않는다. teams 는 10행 미만이라 요청마다 읽어도 부담이 없어 캐시하지 않는다.
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

/** teams 전체를 읽어 팀 이름 → 플래그 맵으로 돌려준다. 실패하면 빈 맵(= 전원 권한 없음). */
export async function loadTeamPerms(): Promise<Map<string, TeamPerm>> {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data, error } = await supabaseAdmin.from('teams').select(COLUMNS)
  const map = new Map<string, TeamPerm>()
  if (error) {
    console.error('[teamPerms/server] load failed', error)
    return map
  }
  for (const r of (data ?? []) as TeamRow[]) {
    if (r.name) map.set(r.name, toPerm(r))
  }
  return map
}

/** 이미 읽어둔 맵으로 engineer 에 플래그를 붙인다. 목록을 통째로 판정할 때 쓴다. */
export function attachTeamPerm<T extends EngineerLike>(map: Map<string, TeamPerm>, engineer: T): T {
  return { ...engineer, perm: engineer.teams ? map.get(engineer.teams) ?? null : null }
}

/** engineer 한 명에 플래그를 붙여 돌려준다. */
export async function withTeamPerm<T extends EngineerLike>(engineer: T | null | undefined): Promise<T | null> {
  if (!engineer) return null
  return attachTeamPerm(await loadTeamPerms(), engineer)
}
