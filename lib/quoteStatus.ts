// 견적 진행 상태 정의. 값은 quotes.status 의 실제 값이다(DB 에 CHECK 가 없어 코드가 유일한 기준이다).
//
// 상태 목록은 여기 한 곳에 있다. 화면의 필터 칩·상태 선택 버튼·색 표(lib/categoryColors.ts)가
// 모두 이 상수를 참조한다 — 예전에는 화면마다 배열을 따로 들고 있어, 상태를 하나 더하면
// 세 곳을 같이 고쳐야 했다.
//
// 표시 이름은 값과 다르다. 저장값은 그대로 두고 화면에서만 바꿔 부른다
// (lib/categoryColors.ts 의 salesStatusLabel — '실패' → 「미수주」, '취소요청' → 「삭제 요청」).

/** quotes.status 에 들어가는 값 전부. 필터 칩·색 표의 기준이다. */
export const QUOTE_STATUSES = [
  '견적중',
  '수리중',
  '수주',
  '발주(주문 대기)',
  '주문완료',
  '세금계산서 요청',
  '매출완료',
  '취소요청',
  '실패',
  '보류',
] as const

export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

/**
 * 목록 필터 칩에 세우는 순서. 「전체」는 화면이 앞에 붙인다.
 * '수주'·'보류' 는 지금은 만들어지지 않는 옛 값이라 칩에서 뺀다(그 상태로 남은 과거 건은
 * 「전체」에서 보이고, 색 표에는 남아 있어 배지가 회색으로 떨어지지 않는다).
 */
export const STATUS_FILTER_TABS: readonly QuoteStatus[] = [
  '견적중', '수리중', '발주(주문 대기)', '주문완료', '세금계산서 요청', '매출완료', '취소요청', '실패',
]

/** 상태 변경 창에서 사람이 고를 수 있는 값. 되돌리기(견적중)는 실주 건에만 붙는다. */
export const FAIL_STATUS = '실패'
export const EDIT_STATUSES: readonly QuoteStatus[] = ['취소요청', FAIL_STATUS]
export const EDIT_STATUSES_WITH_REVERT: readonly QuoteStatus[] = ['취소요청', FAIL_STATUS, '견적중']

/** 자동 실주의 대상이 되는 상태 — 아직 아무 결정이 없는 건. */
export const PENDING_STATUS = '견적중'

// 수주로 보는 상태 — 발주서가 등록된 이후 단계 전부.
// '수주' 는 지금은 만들어지지 않는 옛 값이지만, 그 상태로 남은 과거 데이터를 위해 남겨둔다.
// 물건이 실제로 나간 것으로 보는 기준(부품 사용 이력의 '납품된 것만')도 같은 목록을 쓴다.
export const ORDERED_STATUSES = ['수주', '발주(주문 대기)', '주문완료', '세금계산서 요청', '매출완료'] as const

/** 수주로 잡히는 상태인지 */
export const isOrdered = (status: string | null | undefined) =>
  !!status && (ORDERED_STATUSES as readonly string[]).includes(status)

// 매출로 보는 상태 — 세금계산서 발행까지 끝난 건.
export const REVENUE_STATUS = '매출완료'

// ── 유효기간 ────────────────────────────────────────────────────────
// 견적서 PDF 에 「작성일로부터 1개월」이라고 찍혀 나간다. 그 문구가 기준이다.
// 자동 실주(auto-fail)·80 대시보드의 D-day·홈 목록의 「유효 견적」이 모두 아래 두 함수를 쓴다
// — 예전에는 auto-fail 만 30일을 세어 31일 달에 하루가 어긋났다.

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * 견적 유효기간 만료일 = 작성일 + 1개월 − 1일.
 * 30일을 더하지 않고 월 단위로 옮긴다. 다음 달에 같은 날짜가 없으면(1/31 → 2/31)
 * 그 달 말일로 맞춘 뒤 하루를 뺀다.
 */
export function quoteExpiry(quoteDate: string): string {
  const [y, m, d] = quoteDate.split('-').map(Number)
  const nextY = m === 12 ? y + 1 : y
  const nextM = m === 12 ? 1 : m + 1
  const lastDay = new Date(nextY, nextM, 0).getDate()   // 다음 달 말일
  const dt = new Date(nextY, nextM - 1, Math.min(d, lastDay))
  dt.setDate(dt.getDate() - 1)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

/** 그 날(KST) 기준으로 유효기간이 지났는지. 만료일 당일은 아직 유효하다. */
export const isExpired = (quoteDate: string | null | undefined, today: string): boolean =>
  !!quoteDate && quoteExpiry(quoteDate) < today

/**
 * 오늘 기준으로 유효기간이 살아 있는 견적의 가장 이른 작성일 — quoteExpiry 의 정확한 역이다.
 * 「유효 견적」 기간의 시작점으로 쓴다.
 *
 * 먼저 반대 계산(오늘 − 1개월 + 1일)으로 어림잡고, 거기서 하루씩 앞으로 밀며 「그날 쓴 견적이
 * 아직 유효한」 첫 날을 찾는다. 한 번에 안 맞는 이유는 짧은 달의 말일 보정이다 —
 * 1/29 에 쓴 견적의 만료일은 2/29 가 없어 2/28 로 당겨지고 거기서 하루를 더 빼 2/27 이 된다.
 * 그래서 2/28 에는 이미 만료인데, 반대 계산만으로는 1/29 가 시작일로 나온다(하루 넓게 잡힌다).
 * 밀어야 하는 날은 많아도 이틀이다.
 */
export function validFromDate(today: string): string {
  const [y, m, d] = today.split('-').map(Number)
  const prevY = m === 1 ? y - 1 : y
  const prevM = m === 1 ? 12 : m - 1
  const lastDay = new Date(prevY, prevM, 0).getDate()
  const dt = new Date(prevY, prevM - 1, Math.min(d, lastDay))
  dt.setDate(dt.getDate() + 1)
  const ymd = () => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
  for (let i = 0; i < 3 && isExpired(ymd(), today); i++) dt.setDate(dt.getDate() + 1)
  return ymd()
}

// ── 자동 실주 ───────────────────────────────────────────────────────
// 자동 실주(/api/auto-fail)가 남기는 사유 문구. 그 라우트의 리터럴과 같은 값이다.
// 날짜 수(예전 '유효기간 만료 (30일)')를 넣지 않는다 — 기준이 바뀌면 옛 행과 문구가 갈려
// isAutoFailed 의 완전 일치 비교가 어긋나기 때문이다.
export const AUTO_FAIL_REASON = '유효기간 만료'

/** 자동 실주로 실패 처리된 건인지 — 되돌리기를 열지 말지 가르는 기준이다. */
export const isAutoFailed = (status: string | null | undefined, failReason: string | null | undefined) =>
  status === FAIL_STATUS && failReason === AUTO_FAIL_REASON

// 되돌리기 창 안내.
// 자동 실주 건은 되돌릴 수 없다 — 견적일은 지난달인데 상태만 진행 중이 되면
// 고객에게 나간 PDF 의 유효기간("작성일로부터 1개월")과 어긋나기 때문이다.
export const REVERT_NOTICE = '견적중으로 되돌립니다. 미수주 사유는 지워집니다'
export const AUTO_FAIL_NOTICE = '유효기간이 만료된 견적입니다. 되돌릴 수 없으며 새 견적서를 작성해주세요'
