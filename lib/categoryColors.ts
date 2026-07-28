/**
 * 카테고리/상태 색상 단일 소스 (확정본)
 */

export type CategoryColor = { text: string; bg: string; dot?: string };

export const SERVICE_TYPE_COLORS = {
  '신규설치':     { text: '#234ea2', bg: '#eff4ff', dot: '#3b82f6' },
  '이전설치':     { text: '#7c3aed', bg: '#f5f3ff', dot: '#8b5cf6' },
  'A/S':          { text: '#b45309', bg: '#fffbeb', dot: '#f59e0b' },
  'B/S':          { text: '#be123c', bg: '#fef2f2', dot: '#f43f5e' },
  '교육':         { text: '#15803d', bg: '#f0fdf4', dot: '#22c55e' },
  '유선기술지원':  { text: '#0f766e', bg: '#f0fdfa', dot: '#14b8a6' },
} as const satisfies Record<string, CategoryColor>;

/* 실적/견적 상태 — quotes.status 단일 컬럼(견적~발주 전 생애주기)이므로 맵도 하나 */
export const SALES_STATUS_COLORS = {
  '견적중':          { text: '#b45309', bg: '#fffbeb' },
  '수주':            { text: '#2563eb', bg: '#eff6ff' },
  '발주(주문 대기)':  { text: '#7c3aed', bg: '#f5f3ff' },
  '주문완료':        { text: '#0369a1', bg: '#eff6ff' },
  '세금계산서 요청':  { text: '#0f766e', bg: '#f0fdfa' },
  '매출완료':        { text: '#15803d', bg: '#f0fdf4' },
  '취소요청':        { text: '#be123c', bg: '#fef2f2' },
  '실패':            { text: '#b91c1c', bg: '#fef2f2' },
  '보류':            { text: '#6b7280', bg: '#f3f4f6' },
} as const satisfies Record<string, CategoryColor>;

export const DELIVERY_METHOD_COLORS = {
  '택배발송': { text: '#2563eb', bg: '#eff6ff' },
  '직납':     { text: '#15803d', bg: '#f0fdf4' },
} as const satisfies Record<string, CategoryColor>;

export const TEAM_COLORS = {
  '80영업':   { text: '#234ea2', bg: '#eff4ff' },
  '80CS':     { text: '#0369a1', bg: '#f0f9ff' },
  '20':       { text: '#15803d', bg: '#f0fdf4' },
  '영업관리': { text: '#b45309', bg: '#fffbeb' },
  '임원':     { text: '#7e22ce', bg: '#faf5ff' },
  'Apps.':    { text: '#0f766e', bg: '#f0fdfa' },
} as const satisfies Record<string, CategoryColor>;

export const ROLE_COLORS = {
  superadmin: { text: '#7c3aed', bg: '#faf5ff' },
  manager:    { text: '#234ea2', bg: '#eff6ff' },
  member:     { text: '#6b7280', bg: '#f3f4f6' },
} as const satisfies Record<string, CategoryColor>;

export const INVENTORY_MANAGER_COLOR: CategoryColor = {
  text: '#15803d', bg: '#f0fdf4',
};

export const FALLBACK_COLOR: CategoryColor = {
  text: '#6b7280', bg: '#f3f4f6', dot: '#9ca3af',
};

export type ServiceType    = keyof typeof SERVICE_TYPE_COLORS;
export type SalesStatus    = keyof typeof SALES_STATUS_COLORS;
export type DeliveryMethod = keyof typeof DELIVERY_METHOD_COLORS;
export type Team           = keyof typeof TEAM_COLORS;
export type Role           = keyof typeof ROLE_COLORS;

export function getCategoryColor(
  map: Record<string, CategoryColor>,
  key: string | null | undefined,
): CategoryColor {
  if (!key) return FALLBACK_COLOR;
  return map[key] ?? FALLBACK_COLOR;
}
