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

/* 활동 유형 색 — 활동 현황(카드·상세)에서 서비스 6종과 영업 4종을 함께 그릴 때 쓴다.
   영업 4종은 새 색을 만들지 않고 서비스 색을 그대로 빌린다. 값을 복사하지 않고 참조만 하므로
   서비스 색을 고치면 함께 따라간다. 여기 없는 유형은 getCategoryColor 가 FALLBACK_COLOR 로 떨어뜨린다.
   (한 사람이 서비스와 영업을 모두 쓰는 일은 없다는 전제라 색이 겹쳐도 한 카드 안에서 부딪히지 않는다) */
export const ACTIVITY_TYPE_COLORS = {
  ...SERVICE_TYPE_COLORS,
  '전화상담': SERVICE_TYPE_COLORS['유선기술지원'],  // 둘 다 비방문·원격
  '방문미팅': SERVICE_TYPE_COLORS['신규설치'],      // 실제 방문의 기본색
  '사양검토': SERVICE_TYPE_COLORS['이전설치'],      // 검토·기획 성격
  '경쟁입찰': SERVICE_TYPE_COLORS['B/S'],           // 경쟁·리스크
} as const satisfies Record<string, CategoryColor>;

/* 고객사 상세 통합 타임라인의 항목 종류 dot.
   서비스는 SERVICE_TYPE_COLORS 를 그대로 쓰고, 견적만 여기서 색을 갖는다.
   서비스 6색(파랑·보라·주황·자홍·초록·청록) 어느 것과도 겹치지 않는 중립 슬레이트. */
export const TIMELINE_KIND_COLORS = {
  '견적': { text: '#475569', bg: '#f3f4f6', dot: '#64748b' },
  // 영업 활동은 4종(전화상담·방문미팅·사양검토·경쟁입찰)을 한 색으로 묶는다.
  // 견적이 상태와 무관하게 한 색인 것과 같은 방식이며, 값은 기존 액센트를 그대로 쓴다.
  '영업': { text: '#234ea2', bg: '#eff4ff', dot: '#234ea2' },
  // 홀딩(미해결 이슈) — 견적의 슬레이트보다 흐린 중립. 새 값을 만들지 않고 기존 '흐림' 토큰을 쓴다.
  '홀딩': { text: '#6b7280', bg: '#f3f4f6', dot: '#9ca3af' },
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

/** 견적 상태값 → 화면 표시 라벨. 저장값('취소요청' 등)은 그대로 두고 표기만 바꾼다. */
export function salesStatusLabel(status: string): string {
  return status === '취소요청' ? '삭제 요청' : status;
}

export const DELIVERY_METHOD_COLORS = {
  '택배발송': { text: '#2563eb', bg: '#eff6ff' },
  '직납':     { text: '#15803d', bg: '#f0fdf4' },
} as const satisfies Record<string, CategoryColor>;

/* 팀 배지 색. 여기 없는 팀은 getCategoryColor 가 FALLBACK_COLOR(회색)로 그리므로,
   새 팀이 생겨도 화면은 깨지지 않는다(권한과 무관 — 권한은 teams 테이블 플래그로만 판정한다).
   20 은 20수리·20영업으로 나뉘었고, 같은 계열(초록·청록)로 묶어 새 값을 만들지 않는다. */
export const TEAM_COLORS = {
  '80영업':   { text: '#234ea2', bg: '#eff4ff' },
  '80CS':     { text: '#0369a1', bg: '#f0f9ff' },
  '20':       { text: '#15803d', bg: '#f0fdf4' },
  '20수리':   { text: '#15803d', bg: '#f0fdf4' },
  '20영업':   { text: '#0f766e', bg: '#f0fdfa' },
  '영업관리': { text: '#b45309', bg: '#fffbeb' },
  '임원':     { text: '#7e22ce', bg: '#faf5ff' },
  'Apps.':    { text: '#0f766e', bg: '#f0fdfa' },
} as const satisfies Record<string, CategoryColor>;

// 'manager'(팀장) 폐지 — 남은 옛 값은 FALLBACK_COLOR(회색)로 그려진다.
export const ROLE_COLORS = {
  superadmin: { text: '#7c3aed', bg: '#faf5ff' },
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
