// 견적 진행 상태 정의. 값은 quotes.status 실제 값(lib/categoryColors.ts 의 SALES_STATUS_COLORS 키와 동일).
// 진행 중 = 완료·종결이 아닌 것.
//   포함(진행 중): 견적중 / 수주 / 발주(주문 대기) / 주문완료 / 세금계산서 요청
//   제외(종결):   매출완료 / 실패 / 취소요청 / 보류

export const IN_PROGRESS_STATUSES = ['견적중', '수주', '발주(주문 대기)', '주문완료', '세금계산서 요청'] as const

export const CLOSED_STATUSES = ['매출완료', '실패', '취소요청', '보류'] as const

// 수주로 보는 상태 — 발주서가 등록된 이후 단계 전부.
// '수주' 는 지금은 만들어지지 않는 옛 값이지만, 그 상태로 남은 과거 데이터를 위해 남겨둔다.
// 물건이 실제로 나간 것으로 보는 기준(부품 사용 이력의 '납품된 것만')도 같은 목록을 쓴다.
export const ORDERED_STATUSES = ['수주', '발주(주문 대기)', '주문완료', '세금계산서 요청', '매출완료'] as const

/** 수주로 잡히는 상태인지 */
export const isOrdered = (status: string | null | undefined) =>
  !!status && (ORDERED_STATUSES as readonly string[]).includes(status)

// 매출로 보는 상태 — 세금계산서 발행까지 끝난 건.
export const REVENUE_STATUS = '매출완료'

// 자동 실주(/api/auto-fail)가 남기는 사유 문구. 그 라우트의 리터럴과 같은 값이다.
export const AUTO_FAIL_REASON = '유효기간 만료 (30일)'

/** 자동 실주로 실패 처리된 건인지 — 되돌리기를 열지 말지 가르는 기준이다. */
export const isAutoFailed = (status: string | null | undefined, failReason: string | null | undefined) =>
  status === '실패' && failReason === AUTO_FAIL_REASON

// 되돌리기 창 안내.
// 자동 실주 건은 되돌릴 수 없다 — 견적일은 지난달인데 상태만 진행 중이 되면
// 고객에게 나간 PDF 의 유효기간("작성일로부터 1개월")과 어긋나기 때문이다.
export const REVERT_NOTICE = '견적중으로 되돌립니다. 실패 사유는 지워집니다'
export const AUTO_FAIL_NOTICE = '유효기간이 만료된 견적입니다. 되돌릴 수 없으며 새 견적서를 작성해주세요'

export function isInProgress(status: string | null | undefined): boolean {
  return !!status && (IN_PROGRESS_STATUSES as readonly string[]).includes(status)
}
