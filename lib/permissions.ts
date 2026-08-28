// 권한 규칙 단일 소스(single source of truth).
// 메뉴 노출 · 페이지 진입 · 데이터 범위 판정을 이 모듈 한 곳에서 관리한다.
//
// 팀 이름은 이 파일에 없다. 권한은 teams 테이블의 플래그 6개로만 판정하며,
// 새 팀이 생기면 유지보수 화면에서 체크박스만 켜면 코드 수정 없이 반영된다.
// 플래그는 lib/teamPerms.ts 가 읽어와 engineer.perm 에 붙여준다.

// engineers.permission_level 의 값. 'manager'(팀장)는 폐지했다.
// 남아 있는 옛 데이터를 만나도 member 와 똑같이 취급되어 깨지지 않는다.
export type PermissionLevel = 'superadmin' | 'member'

// teams 테이블의 권한 플래그. 컬럼명과 1:1로 대응한다.
export type TeamPerm = {
  customers: boolean    // can_view_customers  — 20·80 (고객사 현황 · 20 수리등록)
  dashboard: boolean    // can_view_dashboard  — 대시보드
  quote: boolean        // can_view_quote      — 견적서
  pipeline: boolean     // can_view_pipeline   — 영업 현황
  salesMgmt: boolean    // can_view_sales_mgmt — 영업관리 (발주·재고)
  admin: boolean        // can_view_admin      — 관리자 (실적 현황 · 유지보수)
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

// 플래그 하나를 보는 공통 판정. engineer 미확정(로딩)이면 잠근다.
function hasPerm(engineer: EngineerLike | null | undefined, key: keyof TeamPerm): boolean {
  if (!engineer) return false
  if (isSuperAdmin(engineer)) return true
  return engineer.perm?.[key] === true
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
 * 팀 이름 대신 플래그로 본다 — 고객사와 대시보드를 함께 보는 팀이 곧 현장 팀이다.
 * (임원·영업관리·Apps. 는 이 조건에서 자연히 빠진다)
 * perm 이 아직 안 붙은 상태(로딩 등)에서는 기존 동작대로 포함시킨다.
 */
export function isFieldEngineerTeam(engineer?: EngineerLike | null): boolean {
  if (!engineer?.perm) return true
  return engineer.perm.customers && engineer.perm.dashboard && !engineer.perm.admin
}
