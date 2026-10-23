// **실적 집계 대상인가** — 실적 현황·활동 현황·포캐스트가 「누구를 세는가」를 정하는 한 규칙.
//
// ── 왜 플래그인가 ───────────────────────────────────────────────────────────
//   예전에는 팀의 **메뉴 권한에서 파생**해 판정했다(lib/permissions.ts 의 isFieldEngineerTeam —
//   customers·dashboard 메뉴가 있고 admin 이 없는 팀). 그 규칙에는 함정이 있었다:
//   현장 팀에 「실적 현황」이나 「전자결재」 메뉴를 켜면 admin 영역이 켜진 것으로 파생되어
//   **그 팀 전원이 집계에서 빠졌다.** 메뉴를 켜는 일과 실적에 세는 일은 서로 다른 결정이다.
//
//   그래서 자료를 따로 뒀다.
//     teams.in_sales_stats      팀 기본값(not null, 기본 false)
//     engineers.in_sales_stats  개인 강제(null = 팀을 따른다 / true·false = 그 사람만 달리)
//   이제 판정은 **메뉴와 무관**하다. 바꾸는 자리도 팀 관리·목표 관리 화면 두 곳이다.

/** 판정에 필요한 만큼의 팀 값. loadTeamPerms 가 TeamPerm 에 담아 준다. */
export type SalesScopeTeam = { inSalesStats?: boolean } | null | undefined

/** 판정에 필요한 만큼의 직원 값. */
export type SalesScopeEngineer = {
  /** null·undefined = 팀을 따른다. true·false = 개인 강제. */
  in_sales_stats?: boolean | null
  /** 소속 팀 값(withTeamPerm·withTeamPerms 가 붙여 준다). */
  perm?: SalesScopeTeam
} | null | undefined

/**
 * 그 사람을 실적 집계에 넣는가.
 *
 *   ① 개인 값이 true·false 면 그대로 쓴다(팀보다 세다).
 *   ② 개인 값이 비어 있으면 팀 값을 쓴다.
 *   ③ 팀 값도 모르면(팀 미배정·권한을 아직 못 읽음) **제외**한다.
 *
 * ③을 제외로 둔 이유 — 예전 판정은 팀 권한을 못 읽었을 때 「포함」으로 떨어졌다(로딩 중에
 * 목록이 깜빡 늘었다가 줄었다). 집계는 틀린 수를 잠깐 보여 주는 것보다 적게 보여 주는 편이 낫다.
 *
 * teamPerm 을 직접 넘기면 그것을 먼저 본다 — 목록을 통째로 판정할 때 맵에서 꺼낸 값을 주면
 * engineer 에 perm 을 붙이지 않아도 된다.
 */
export function inSalesStats(engineer: SalesScopeEngineer, teamPerm?: SalesScopeTeam): boolean {
  if (!engineer) return false
  if (engineer.in_sales_stats === true) return true
  if (engineer.in_sales_stats === false) return false
  const team = teamPerm ?? engineer.perm
  return team?.inSalesStats === true
}

/** 개인 플래그의 세 가지 — 화면의 선택칸이 이 값을 쓴다. */
export type SalesScopeChoice = 'team' | 'in' | 'out'

/** 저장값 → 선택칸 값. */
export const scopeChoiceOf = (v: boolean | null | undefined): SalesScopeChoice =>
  v === true ? 'in' : v === false ? 'out' : 'team'

/** 선택칸 값 → 저장값(null 이면 팀을 따른다). */
export const scopeValueOf = (c: SalesScopeChoice): boolean | null =>
  c === 'in' ? true : c === 'out' ? false : null

/** 선택칸에 쓰는 이름. */
export const SCOPE_LABELS: Record<SalesScopeChoice, string> = {
  team: '팀 설정',
  in: '포함',
  out: '제외',
}
