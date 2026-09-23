// 메뉴 단위 권한 목록 — 사이드바·팀 관리 화면·페이지 가드·API 가드가 모두 이 파일만 본다.
//
// 판정 자료는 team_permissions(팀 × 메뉴 키)다. 로더(lib/teamPerms.ts ·
// lib/teamPermsServer.ts)가 팀별 키 집합을 읽어 engineer.perm.menus 에 붙여주고,
// 이 파일이
//   · 메뉴가 무엇이고 어디에 놓이는지
//   · 각 메뉴가 어떤 데이터 영역을 요구하는지
//   · 기존 판정 함수(canViewXxx)가 그 집합에서 어떻게 답을 만드는지(DERIVED_PERMS)
// 를 한곳에 모은다.
//
// 데이터 영역(data)은 RLS 가 실제로 묻는 세 가지(has_team_perm 의 인자)뿐이다.
// 「그 영역을 요구하는 메뉴가 하나라도 켜져 있으면 true」로 teams.can_view_* 를 채우면
// RLS 정책은 한 글자도 바꾸지 않아도 된다 — DERIVED_PERMS 가 그 규칙이다.
//
// ※ permissions.ts 와 서로를 import 한다(순환). 양쪽 다 상대를 함수 안에서만 부르고
//   모듈 최상위에서는 쓰지 않으므로 초기화 순서에 영향받지 않는다.
import { canViewMenu, type EngineerLike } from './permissions'

/** RLS 가 요구하는 데이터 영역. has_team_perm(perm) 의 인자와 같은 값이다. */
export type DataArea = 'customers' | 'quote' | 'sales_mgmt'

/** 사이드바 묶음. 순서는 MENU_GROUPS 가 정한다. */
export type MenuGroup = '주 메뉴' | '대시보드' | '고객' | '영업' | '주문' | '하단' | '관리'

export type MenuPerm = {
  /** 권한 키. team_permissions.perm_key 가 될 값이다. */
  key: string
  label: string
  group: MenuGroup
  path: string
  /** 사이드바 아이콘 키. 실제 SVG 는 사이드바가 들고 있다(이 파일은 .ts 라 JSX 를 두지 않는다). */
  icon: string
  /** 묶음 안에서의 순서. */
  order: number
  /** 이 메뉴가 요구하는 데이터 영역. 3단계에서 RLS 키를 파생하는 데 쓴다. */
  data: DataArea[]
  /** 권한 없이 로그인 전원에게 열린 메뉴. 팀 관리 화면에서 체크 대상이 아니다. */
  public?: true
}

/**
 * 묶음 정의.
 *   title    — null 이면 제목 없이 항목만 그린다.
 *   placement— main: 스크롤되는 가운데 영역 / bottom: 프로필 위에 붙는 영역
 */
export const MENU_GROUPS: { group: MenuGroup; title: string | null; placement: 'main' | 'bottom' }[] = [
  { group: '주 메뉴', title: null, placement: 'main' },
  { group: '대시보드', title: '대시보드', placement: 'main' },
  { group: '고객', title: '고객', placement: 'main' },
  { group: '영업', title: '영업', placement: 'main' },
  { group: '주문', title: '주문', placement: 'main' },
  { group: '하단', title: null, placement: 'bottom' },
  { group: '관리', title: '관리', placement: 'bottom' },
]

export const MENU_PERMS: MenuPerm[] = [
  // ── 주 메뉴 — 홈·알림은 전원 공개, 결재는 관리자 ──
  { key: 'home', label: '홈', group: '주 메뉴', path: '/dashboard', icon: 'home', order: 10, data: [], public: true },
  { key: 'notifications', label: '알림', group: '주 메뉴', path: '/notifications', icon: 'bell', order: 20, data: [], public: true },
  { key: 'approvals', label: '결재', group: '주 메뉴', path: '/requests', icon: 'approval', order: 30, data: ['customers', 'quote'] },

  // ── 대시보드 ──
  { key: 'repair_dashboard', label: '20 대시보드', group: '대시보드', path: '/repair/dashboard', icon: 'grid', order: 10, data: ['customers'] },
  { key: 'dashboard_80', label: '80 대시보드', group: '대시보드', path: '/dashboard/80', icon: 'gauge', order: 20, data: ['customers', 'quote'] },
  { key: 'activity', label: '활동 현황', group: '대시보드', path: '/activity', icon: 'activity', order: 30, data: ['customers'] },

  // ── 고객 ──
  { key: 'customers', label: '고객사', group: '고객', path: '/', icon: 'building', order: 10, data: ['customers'] },
  { key: 'repair', label: '20 수리', group: '고객', path: '/repair', icon: 'wrench', order: 20, data: ['customers'] },
  { key: 'showroom', label: '쇼룸', group: '고객', path: '/showroom', icon: 'monitor', order: 30, data: ['customers'] },

  // ── 영업 ──
  { key: 'leads', label: '리드', group: '영업', path: '/leads', icon: 'userPlus', order: 10, data: [] },
  { key: 'pipeline', label: '파이프라인', group: '영업', path: '/pipeline', icon: 'kanban', order: 20, data: ['customers'] },
  { key: 'quote', label: '견적서', group: '영업', path: '/quote', icon: 'fileText', order: 30, data: ['quote'] },

  // ── 주문 ──
  { key: 'purchase', label: '발주', group: '주문', path: '/purchase', icon: 'package', order: 10, data: ['quote', 'sales_mgmt'] },
  { key: 'inventory', label: '재고', group: '주문', path: '/inventory', icon: 'archive', order: 20, data: ['sales_mgmt'] },

  // ── 하단 — 전원 공개 ──
  { key: 'suggestions', label: '건의사항', group: '하단', path: '/suggestions', icon: 'message', order: 10, data: [], public: true },

  // ── 관리 ──
  { key: 'sales', label: '실적 현황', group: '관리', path: '/sales', icon: 'barChart', order: 10, data: ['quote'] },
  { key: 'admin', label: '관리', group: '관리', path: '/admin', icon: 'sliders', order: 20, data: ['customers', 'quote', 'sales_mgmt'] },
]

/**
 * 메뉴에 없는 화면이 어느 메뉴에 딸렸는지. 페이지 가드를 메뉴 키로 바꾸는 3단계 이후에 쓴다.
 * 'public' 은 로그인만 되어 있으면 열리는 화면이다.
 */
export const PARENT_MENU: Record<string, string> = {
  '/customer/[id]': 'customers',
  '/holdings': 'dashboard_80',
  '/account': 'public',
}

export const MENU_BY_KEY: Record<string, MenuPerm> =
  Object.fromEntries(MENU_PERMS.map(m => [m.key, m]))

/** 로그인만 하면 열리는 화면임을 나타내는 값. 메뉴 키가 아니다. */
export const PUBLIC_MENU = 'public'

/** 경로 패턴([id] 같은 자리는 아무 값이나)과 실제 경로가 같은지. */
function matchesPattern(pattern: string, path: string): boolean {
  const a = pattern.split('/')
  const b = path.split('/')
  if (a.length !== b.length) return false
  return a.every((seg, i) => (seg.startsWith('[') && seg.endsWith(']') ? b[i].length > 0 : seg === b[i]))
}

/**
 * 경로가 어느 메뉴에 속하는가.
 *   메뉴 키   — 그 메뉴 권한이 있어야 들어간다
 *   PUBLIC_MENU — 로그인만 하면 된다(홈·알림·건의사항·본인 정보)
 *   null      — 목록에 없는 경로. 가드는 막는다(새 화면을 여기 등록해야 열린다).
 * 화면마다 키를 적지 않고 이 함수 하나로 찾게 해서, 경로와 권한이 어긋나지 않게 한다.
 */
export function menuKeyForPath(pathname: string): string | null {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const menu = MENU_PERMS.find(m => m.path === path)
  if (menu) return menu.public ? PUBLIC_MENU : menu.key
  for (const [pattern, key] of Object.entries(PARENT_MENU)) {
    if (matchesPattern(pattern, path)) return key
  }
  return null
}

/** 기존 판정 함수가 묻는 영역 이름. TeamPerm 이 플래그였을 때의 키와 같다. */
export type PermArea = 'customers' | 'dashboard' | 'quote' | 'pipeline' | 'salesMgmt' | 'admin' | 'leads'

/**
 * 영역 파생 규칙 — 「이 메뉴 중 하나라도 켜져 있으면 그 영역을 본다」.
 *
 * 메뉴 권한만 저장하고 영역은 여기서 만든다. 그래서 teams.can_view_* 컬럼도,
 * 그 컬럼을 묻는 RLS 정책도 그대로 두고 판정 자료만 갈아끼울 수 있었다.
 * 규칙을 바꿀 일이 생기면 이 표 한 곳만 고친다.
 */
export const DERIVED_PERMS: Record<PermArea, readonly string[]> = {
  customers: ['repair_dashboard', 'dashboard_80', 'activity', 'customers', 'repair', 'showroom', 'pipeline', 'admin', 'approvals'],
  quote: ['dashboard_80', 'quote', 'purchase', 'sales', 'admin', 'approvals'],
  salesMgmt: ['purchase', 'inventory', 'admin'],
  dashboard: ['repair_dashboard', 'dashboard_80', 'activity'],
  pipeline: ['pipeline'],
  leads: ['leads'],
  admin: ['sales', 'admin', 'approvals'],
}

/** 팀이 켜 둔 메뉴 집합에서 영역 하나를 판정한다(사람이 아니라 팀만 본다 — superadmin 예외 없음). */
export function deriveArea(menus: Set<string>, area: PermArea): boolean {
  return DERIVED_PERMS[area].some(key => menus.has(key))
}

/**
 * 영역 → teams 컬럼 이름. RLS 함수 has_team_perm() 이 읽는 컬럼이 이것들이라,
 * 메뉴 권한을 저장할 때 파생 규칙으로 계산해 함께 맞춰 줘야 데이터 접근이 어긋나지 않는다.
 */
export const TEAM_PERM_COLUMN: Record<PermArea, string> = {
  customers: 'can_view_customers',
  dashboard: 'can_view_dashboard',
  quote: 'can_view_quote',
  pipeline: 'can_view_pipeline',
  salesMgmt: 'can_view_sales_mgmt',
  admin: 'can_view_admin',
  leads: 'can_view_leads',
}

/** 켜 둔 메뉴 집합에서 teams.can_view_* 7개를 만든다. 저장 라우트가 이 값으로 UPDATE 한다. */
export function deriveTeamColumns(menus: Set<string>): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const area of Object.keys(DERIVED_PERMS) as PermArea[]) {
    out[TEAM_PERM_COLUMN[area]] = deriveArea(menus, area)
  }
  return out
}

/** 팀별로 켤 수 있는 메뉴 — 전원 공개 항목은 체크 대상이 아니다. */
export const CHECKABLE_MENUS: MenuPerm[] = MENU_PERMS.filter(m => !m.public)

/** 체크 대상이 있는 묶음만, 묶음 순서대로. 팀 관리 화면이 이 순서로 그린다. */
export function checkableGroups(): { group: MenuGroup; title: string; items: MenuPerm[] }[] {
  return MENU_GROUPS
    .map(g => ({
      group: g.group,
      title: g.title ?? g.group,
      items: CHECKABLE_MENUS.filter(m => m.group === g.group).sort((a, b) => a.order - b.order),
    }))
    .filter(g => g.items.length > 0)
}

/** 한 묶음에서 이 사람에게 보이는 항목. 순서(order)대로 돌려준다. */
export function visibleMenus(group: MenuGroup, engineer?: EngineerLike | null): MenuPerm[] {
  return MENU_PERMS
    .filter(m => m.group === group && canViewMenu(engineer, m.key))
    .sort((a, b) => a.order - b.order)
}

/** 활성 표시 판정에 쓰는 전체 경로 목록(권한으로 거르기 전 기준). */
export const MENU_PATHS: string[] = MENU_PERMS.map(m => m.path)