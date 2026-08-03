// 권한 규칙 단일 소스(single source of truth).
// 메뉴 노출 · 페이지 진입 · 데이터 범위 판정을 이 모듈 한 곳에서 관리한다.
// 이번 단계에서는 정의만 하며, 기존 체크 코드 교체는 다음 단계에서 한다.

// teams 테이블 기준 실제 팀 값의 전부.
export type TeamName = '80CS' | '80영업' | '20' | '영업관리' | '임원' | 'Apps.'

// engineers.permission_level 의 값 전부.
export type PermissionLevel = 'superadmin' | 'manager' | 'member'

// 판정 함수에 넘기는 최소 형태. 실제 engineer 객체(추가 필드 다수)를 그대로 넘길 수 있도록 느슨하게 둔다.
// DB 상 두 컬럼 모두 null 가능하므로 string | null 을 허용한다.
export type EngineerLike = {
  permission_level?: PermissionLevel | string | null
  teams?: TeamName | string | null
}

/**
 * superadmin 여부. "superadmin 은 팀과 무관하게 전부 통과" 원칙이
 * 이 헬퍼 한 곳에서만 관리되도록, 아래 모든 접근 함수가 이것을 먼저 확인한다.
 */
export function isSuperAdmin(engineer?: EngineerLike | null): boolean {
  return engineer?.permission_level === 'superadmin'
}

/**
 * 80 그룹 → 고객사 현황.
 * teams 테이블에 단일 '80' 값은 없고 '80CS' · '80영업' 두 값으로 나뉜다.
 */
export function canAccess80(engineer?: EngineerLike | null): boolean {
  if (!engineer) return false // 로딩 중(미확정)엔 잠근다
  if (isSuperAdmin(engineer)) return true
  return engineer.teams === '80CS' || engineer.teams === '80영업'
}

/**
 * 20 그룹 → 입고 등록 / 수리 현황 대시보드.
 */
export function canAccess20(engineer?: EngineerLike | null): boolean {
  if (!engineer) return false
  if (isSuperAdmin(engineer)) return true
  return engineer.teams === '20'
}

/**
 * 견적서 → 전체 공개.
 * 로그인 사용자면 누구나 접근하지만, engineer 미확정(로딩) 상태에서는 잠근다.
 */
export function canAccessQuote(engineer?: EngineerLike | null): boolean {
  if (!engineer) return false
  return true
}

/**
 * 영업관리 → 발주관리 / 재고관리 (영업관리팀 소속만).
 */
export function canAccessSales(engineer?: EngineerLike | null): boolean {
  if (!engineer) return false
  if (isSuperAdmin(engineer)) return true
  return engineer.teams === '영업관리'
}

/**
 * 관리자 → 실적 현황 / 활동 현황 (superadmin 만).
 */
export function canAccessAdmin(engineer?: EngineerLike | null): boolean {
  if (!engineer) return false
  return isSuperAdmin(engineer)
}

/**
 * 유지보수 → 기존 '관리자' 탭의 이름 변경본 (superadmin 만).
 */
export function canAccessMaintenance(engineer?: EngineerLike | null): boolean {
  if (!engineer) return false
  return isSuperAdmin(engineer)
}

/**
 * 데이터 열람 범위(진입 여부와 별개로 "어디까지 보이는가").
 *  - 'all'  : 전사 전체 (superadmin)
 *  - 'team' : 본인 팀만 (manager)
 *  - 'self' : 본인 것만 (member / 미확정)
 * 현재 실적 현황(app/sales/page.tsx) 열람 범위 로직을 추출한 것.
 * engineer 미확정 시엔 가장 좁은 'self' 를 반환한다(잘못 넓게 열리지 않도록).
 */
export function getViewScope(engineer?: EngineerLike | null): 'all' | 'team' | 'self' {
  if (!engineer) return 'self'
  if (isSuperAdmin(engineer)) return 'all'
  if (engineer.permission_level === 'manager') return 'team'
  return 'self'
}
