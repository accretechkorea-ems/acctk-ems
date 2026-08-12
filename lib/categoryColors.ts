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

/* 차트 그래픽 전용 팔레트 (활동 현황 dot 색과 동일 값).
   서비스 유형 의미와 어긋나지 않도록 SERVICE_TYPE_COLORS 와 분리한 별도 상수. */
export const CHART_COLORS = {
  blue:   '#3b82f6',
  violet: '#8b5cf6',
  amber:  '#f59e0b',
  rose:   '#f43f5e',
  green:  '#22c55e',
  teal:   '#14b8a6',
} as const;

/* 20 수리 의미색 단일 소스 — 상태 4종 + 본사 + 잔량.
   목록 dot·대시보드 도넛/KPI/그래프가 모두 이 상수를 참조해 의미↔색을 통일한다.
   (잔량은 여러 상태의 합이라 중립 회색.) */
export const REPAIR_MEANING_COLORS = {
  '입고':     '#f43f5e',  // rose  — 접수
  '수리중':   '#f59e0b',  // amber
  '출고대기': '#22c55e',  // green
  '출고완료': '#3b82f6',  // blue
  '본사':     '#7c3aed',  // violet — 본사 발송/보유
  '잔량':     '#6b7280',  // gray  — 미출고 잔량(중립)
} as const;

/* 수리 상태 색 — REPAIR_MEANING_COLORS 의 상태 4종을 재사용 (목록 dot·대시보드 도넛에서 status 로 인덱싱). */
export const REPAIR_STATUS_COLORS = {
  '입고':     REPAIR_MEANING_COLORS['입고'],
  '수리중':   REPAIR_MEANING_COLORS['수리중'],
  '출고대기': REPAIR_MEANING_COLORS['출고대기'],
  '출고완료': REPAIR_MEANING_COLORS['출고완료'],
} as const;

/* 실적/견적 상태 — quotes.status 단일 컬럼(견적~발주 전 생애주기)이므로 맵도 하나 */
export const SALES_STATUS_COLORS = {
  '견적중':          { text: '#b45309', bg: '#fffbeb' },
  '수리중':          { text: '#92400e', bg: '#fef3c7' },  // 국내수리 견적 전용. 견적중(밝은 amber)과 톤 구분되는 진한 amber.
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
