// 권한 규칙 단일 소스(single source of truth).
// 메뉴 노출 · 페이지 진입 · 데이터 범위 판정을 이 모듈 한 곳에서 관리한다.
//
// 팀 이름은 이 파일에 없다. 판정 자료는 team_permissions(팀 × 메뉴 키)이며,
// 로더(lib/teamPerms.ts · lib/teamPermsServer.ts)가 소속 팀이 켜 둔 메뉴 키 집합을
// engineer.perm.menus 에 붙여준다. 새 팀이 생기면 유지보수 화면에서 메뉴만 켜면 된다.
//
// 영역 단위 함수(canViewCustomers 등)는 시그니처를 그대로 두고, 속만
// lib/menuPerms.ts 의 파생 규칙(DERIVED_PERMS)으로 메뉴 집합에서 답을 만든다.
//
// ※ menuPerms.ts 와 서로를 import 한다(순환). 양쪽 다 상대를 함수 안에서만 부르고
//   모듈 최상위에서는 쓰지 않으므로 초기화 순서에 영향받지 않는다.
import { deriveArea, MENU_BY_KEY, type PermArea } from './menuPerms'

// engineers.permission_level 의 값. 'manager'(팀장)는 폐지했다.
// 남아 있는 옛 데이터를 만나도 member 와 똑같이 취급되어 깨지지 않는다.
export type PermissionLevel = 'superadmin' | 'member'

/**
 * 소속 팀이 켜 둔 메뉴 키 집합. team_permissions 에서 그 팀의 행들을 모은 것이며,
 * 키는 lib/menuPerms.ts 의 MENU_PERMS[].key 와 같다.
 */
export type TeamPerm = {
  menus: Set<string>
}

// 판정 함수에 넘기는 최소 형태. 실제 engineer 객체(추가 필드 다수)를 그대로 넘길 수 있도록 느슨하게 둔다.
// teams 는 표시·매칭용 이름이며 권한 판정에는 쓰지 않는다.
export type EngineerLike = {
  permission_level?: PermissionLevel | string | null
  teams?: string | null
  perm?: TeamPerm | null
}

/**
 * superadmin 여부. "superadmin 은 팀과 무관하게 전부 통과" 원칙이
 * 이 헬퍼 한 곳에서만 관리되도록, 아래 모든 접근 함수가 이것을 먼저 확인한다.
 */
export function isSuperAdmin(engineer?: EngineerLike | null): boolean {
  return engineer?.permission_level === 'superadmin'
}

// 영역 하나를 보는 공통 판정. engineer 미확정(로딩)이면 잠근다.
// 답은 소속 팀이 켜 둔 메뉴 집합에서 파생 규칙으로 만든다.
function hasPerm(engineer: EngineerLike | null | undefined, area: PermArea): boolean {
  if (!engineer) return false
  if (isSuperAdmin(engineer)) return true
  return engineer.perm ? deriveArea(engineer.perm.menus, area) : false
}

/**
 * 메뉴 하나를 볼 수 있는가 — canViewMenu(engineer, 'quote') 형태.
 * 사이드바가 이것으로 항목을 거르고, 페이지·API 가드도 5단계에서 이 함수로 옮겨온다.
 * 공개 메뉴(홈·알림·건의사항)는 로그인만 확인하고, 목록에 없는 키는 거부한다.
 */
export function canViewMenu(engineer: EngineerLike | null | undefined, key: string): boolean {
  if (!engineer) return false
  if (isSuperAdmin(engineer)) return true
  const item = MENU_BY_KEY[key]
  if (!item) return false
  if (item.public) return true      // 로그인 여부는 바로 위에서 이미 확인했다
  return engineer.perm?.menus.has(key) === true
}

/** 20·80 — 고객사 현황 · 고객사 상세 · 20 수리등록 */
export function canViewCustomers(e?: EngineerLike | null): boolean { return hasPerm(e, 'customers') }

/** 대시보드 — 20 대시보드 · 80 대시보드 · 활동 현황 */
export function canViewDashboard(e?: EngineerLike | null): boolean { return hasPerm(e, 'dashboard') }

/** 견적서 */
export function canViewQuote(e?: EngineerLike | null): boolean { return hasPerm(e, 'quote') }

/** 영업 현황(파이프라인) */
export function canViewPipeline(e?: EngineerLike | null): boolean { return hasPerm(e, 'pipeline') }

/** 영업관리 — 발주관리 · 재고관리 */
export function canViewSalesMgmt(e?: EngineerLike | null): boolean { return hasPerm(e, 'salesMgmt') }

/** 관리자 — 실적 현황 · 유지보수 */
export function canViewAdmin(e?: EngineerLike | null): boolean { return hasPerm(e, 'admin') }

/**
 * 리드 — 대리점이 등록한 리드를 다룰 수 있는 팀.
 * 이 권한만으로는 배정받은 건만 볼 수 있고, 전체 조회·배정·삭제는 superadmin 만 한다.
 */
export function canViewLeads(e?: EngineerLike | null): boolean { return hasPerm(e, 'leads') }

/**
 * 로그인만 하면 되는 화면(건의사항 · 본인 페이지).
 * engineer 미확정(로딩) 상태에서는 잠근다.
 */
export function canViewAll(e?: EngineerLike | null): boolean { return !!e }

/**
 * 데이터 열람 범위(진입 여부와 별개로 "어디까지 보이는가").
 *  - 'all'  : 전사 전체 (superadmin)
 *  - 'self' : 본인 것만 (그 외 / 미확정)
 */
export function getViewScope(engineer?: EngineerLike | null): 'all' | 'self' {
  if (!engineer) return 'self'   // 로딩 중(미확정)엔 본인 것만
  return isSuperAdmin(engineer) ? 'all' : 'self'
}

/**
 * 직원 계정 관리(등록/수정/퇴사/삭제 등) 권한. '팀장' 폐지로 superadmin 전용이 됐다.
 */
export function canManageEngineers(engineer?: EngineerLike | null): boolean {
  return isSuperAdmin(engineer)
}

/**
 * 실적·활동 집계에 넣을 '현장 엔지니어' 여부.
 * 사람이 아니라 팀을 묻는 판정이라 superadmin 예외를 두지 않는다(hasPerm 을 쓰지 않는 이유).
 * 고객사와 대시보드를 함께 보면서 관리자 메뉴가 없는 팀이 곧 현장 팀이다.
 * (임원·영업관리·Apps. 는 이 조건에서 자연히 빠진다)
 * perm 이 아직 안 붙은 상태(로딩 등)에서는 기존 동작대로 포함시킨다.
 */
export function isFieldEngineerTeam(engineer?: EngineerLike | null): boolean {
  if (!engineer?.perm) return true
  const menus = engineer.perm.menus
  return deriveArea(menus, 'customers') && deriveArea(menus, 'dashboard') && !deriveArea(menus, 'admin')
}