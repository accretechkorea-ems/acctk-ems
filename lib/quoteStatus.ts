// 견적 진행 상태 정의. 값은 quotes.status 실제 값(lib/categoryColors.ts 의 SALES_STATUS_COLORS 키와 동일).
// 진행 중 = 완료·종결이 아닌 것.
//   포함(진행 중): 견적중 / 수주 / 발주(주문 대기) / 주문완료 / 세금계산서 요청
//   제외(종결):   매출완료 / 실패 / 취소요청 / 보류

export const IN_PROGRESS_STATUSES = ['견적중', '수주', '발주(주문 대기)', '주문완료', '세금계산서 요청'] as const

export const CLOSED_STATUSES = ['매출완료', '실패', '취소요청', '보류'] as const

export function isInProgress(status: string | null | undefined): boolean {
  return !!status && (IN_PROGRESS_STATUSES as readonly string[]).includes(status)
}
