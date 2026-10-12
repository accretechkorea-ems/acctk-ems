// 사업부(계측/반도체) — 사이드바가 어느 사업부의 메뉴를 보여 줄지 정하는 값.
//
// 사업부는 직원이 아니라 팀에 붙는다(teams.division, 값은 '계측'·'반도체', 기본 '계측').
// 직원은 팀을 고르면 사업부가 따라온다. 판정 자료는 팀 로더(lib/teamPerms.ts)가 TeamPerm.division 으로 붙인다.
//
// 이 값은 **화면 표시용**이다. 데이터 격리는 지금처럼 메뉴 권한과 RLS(has_team_perm·has_menu_perm)가 한다 —
// 사업부를 바꿔도 볼 수 있는 데이터는 달라지지 않고, 사이드바에 섞여 보이던 메뉴만 갈린다.
//
// 현재 사업부(사이드바가 정한다)
//   · 일반 직원 — 본인 팀의 사업부로 고정. 전환 버튼이 없다.
//   · superadmin — 사이드바에서 고른 값(계정별로 이 브라우저에 저장). 고른 적이 없으면 본인 팀의 사업부.
// 메뉴의 사업부는 lib/menuPerms.ts 의 menuDivision 이 정한다. 공통 메뉴는 건의사항뿐이다.
// 로그인 직후 첫 화면은 사업부의 시작 화면(DIVISION_HOME)이다(app/login/page.tsx).
//
// 값은 한글 그대로 둔다 — 결재 문서의 사업부 칸(approval_documents.division default '계측')과 같다.

export type Division = '계측' | '반도체'

/** 고르는 순서. */
export const DIVISIONS: readonly Division[] = ['계측', '반도체']

/** 사이드바 브랜드 아래에 보이는 이름. */
export const DIVISION_LABEL: Readonly<Record<Division, string>> = {
  '계측': '계측사업부',
  '반도체': '반도체사업부',
}

/** 사업부의 시작 화면. superadmin 이 사업부를 바꿨을 때, 반도체 직원이 로그인했을 때 옮겨 간다. */
export const DIVISION_HOME: Readonly<Record<Division, string>> = {
  '계측': '/dashboard',
  '반도체': '/contact/semi',
}

/** 사업부 값인지. */
export function isDivision(v: unknown): v is Division {
  return v === '계측' || v === '반도체'
}

/** DB·저장값을 사업부로 읽는다. 비었거나 모르는 값이면 '계측'(teams.division 의 기본값과 같다). */
export function toDivision(v: unknown): Division {
  return isDivision(v) ? v : '계측'
}

// ── superadmin 의 선택값 저장 ─────────────────────────────────────────
// 계정별로 저장한다 — 같은 컴퓨터를 여러 사람이 쓰는 현장이 있다.
// 읽기·쓰기 모두 try/catch(비공개 모드·저장소 차단). 실패하면 저장값이 없는 것으로 보고
// 본인 팀의 사업부를 쓴다 — 사이드바 묶음 접힘(lib/menuPerms.ts)과 같은 규칙이다.

export const divisionStorageKey = (engineerId: number): string => `sidebar:division:${engineerId}`

/** 저장된 선택값. 저장된 적이 없거나 값이 깨졌으면 null. */
export function readSavedDivision(engineerId: number): Division | null {
  try {
    const raw = localStorage.getItem(divisionStorageKey(engineerId))
    return isDivision(raw) ? raw : null
  } catch {
    return null
  }
}

export function writeSavedDivision(engineerId: number, division: Division): void {
  try {
    localStorage.setItem(divisionStorageKey(engineerId), division)
  } catch {
    /* 저장 못 해도 이번 화면에서는 바뀐 사업부로 보인다 */
  }
}
