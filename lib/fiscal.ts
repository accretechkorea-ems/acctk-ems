// 실적/견적 달성률 표기 공용 유틸.
// ⚠️ 실적 현황(app/sales/page.tsx)은 자체 인라인 구현(achieveColorOf)을 그대로 둔다(수정 금지).
//    개인 대시보드 등 신규 사용처가 이 공용 함수를 쓰며, 색 규칙은 실적 현황과 동일하게 맞춘다.

/** 달성률 색 — 실적 현황과 동일: 100%↑ 초록(#16a34a), 미만 검정(#111827), 없음 회색. (앰버·빨강 미사용) */
export function achieveColorOf(v: number | null): string {
  return v === null ? '#6b7280' : v >= 100 ? '#16a34a' : '#111827'
}
