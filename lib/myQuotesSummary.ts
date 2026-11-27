// 내 견적 요약 **여섯 칸의 셈** (2026-11-28, 야간4 2-1).
//
// ── 왜 옮겼나 ──────────────────────────────────────────────────────────────
//   셈은 components/dashboard/MyQuotesPanel.tsx 안에 흩어져 있었다. 2-1 에서 칸의
//   **생김새**를 바꾸는데(회색 타일 한 줄 · 억·만 축약 · 막대), 숫자가 함께 흔들렸는지
//   눈으로는 가릴 수 없다. 순수 함수로 내놓으면 하네스가 그대로 돌려
//   **정의가 안 바뀐 것**을 숫자로 못 박는다(scripts/my-quotes-summary-check.js).
//
//   **정의는 한 글자도 바꾸지 않았다.** 아래 주석의 규칙은 옮겨 온 그대로다.
//
// ── 세는 규칙 ──────────────────────────────────────────────────────────────
//   · 모수는 **engineer_id 가 나인 건**이다. 목록에는 내가 남 대신 쓴 견적도 실리지만
//     그 실적은 원래 담당자의 것이다 — 실적 현황(app/sales)과 같은 기준이다.
//   · 기간을 재는 날짜가 지표마다 다르다.
//       견적 제출 — quote_date
//       수주      — purchase_order_at
//       매출      — tax_invoice_completed_at
//     처리 시각이 비어 있는 건은 그 지표의 어느 기간에도 잡히지 않는다.
//   · 달성률은 선택 기간에 맞춰 연간 목표를 나눈다(월÷12 · 분기÷4 · 반기÷2 · 연간×1,
//     유효 견적은 월에 준해 ÷12).
//       수주 달성률 = 수주액 / 수주목표(order_target_amount)
//       매출 달성률 = 매출액 / 매출목표(target_amount)

/** 셈에 쓰는 칸만. 화면의 Quote 가 이 꼴을 이미 담고 있다. */
export type SummaryQuote = {
  engineer_id: number
  status: string
  quote_date: string
  total_supply: number | null
  total_profit: number | null
  purchase_order_at?: string | null
  tax_invoice_completed_at?: string | null
}

export type SummaryInput = {
  /** 목록에 실린 견적 전부(대필 포함). 모수는 이 함수가 engineer_id 로 좁힌다. */
  quotes: readonly SummaryQuote[]
  /** 실적이 **내 것**인지 가르는 기준. */
  engineerId: number
  /** 선택 기간. `YYYY-MM-DD`. */
  rangeStart: string
  rangeEnd: string
  /** 상태가 「수주」로 잡히는지 — lib/quoteStatus.ts 의 isOrdered 를 그대로 넘긴다. */
  isOrdered: (status: string) => boolean
  /** 매출 완료 상태의 글자 — lib/quoteStatus.ts 의 REVENUE_STATUS. */
  revenueStatus: string
  /** 「견적중」 상태의 글자 — lib/quoteStatus.ts 의 PENDING_STATUS. */
  pendingStatus: string
  /** 기간에 맞춘 **나눔수**(월 12 · 분기 4 · 반기 2 · 연간 1 · 유효 견적 12). */
  divisor: number
  /** 그 회계연도의 연간 목표. 없으면 null. */
  target: { target: number; orderTarget: number } | null
}

export type MyQuotesSummary = {
  /** 견적 제출 — quote_date 가 기간 안인 내 건의 공급가 합과 건수. */
  quotedAmt: number
  quotedCnt: number
  /** 견적중 — 위 모수 중 상태가 「견적중」인 것(견적 제출의 **부분집합**이다). */
  pendingAmt: number
  pendingCnt: number
  /** 수주 — purchase_order_at 이 기간 안이고 상태가 수주로 잡히는 건. */
  orderedAmt: number
  orderedCnt: number
  /** 전환율 — 수주 건수 ÷ 견적 제출 건수. 분자·분모의 기준 날짜가 달라 기간이 꼭 겹치지는 않는다. */
  convRate: number | null
  /** 매출 완료 — tax_invoice_completed_at 이 기간 안이고 상태가 매출완료인 건. */
  revenueAmt: number
  revenueCnt: number
  profitAmt: number
  profitRate: number | null
  /** 기간에 맞춰 나눈 목표. 목표가 없으면 0. */
  salesTarget: number
  orderTarget: number
  /** 달성률 — 목표가 0 이면 null(「미설정」으로 적는다). */
  achieve: number | null
  orderAchieve: number | null
}

export function myQuotesSummary(input: SummaryInput): MyQuotesSummary {
  const { quotes, engineerId, rangeStart, rangeEnd, isOrdered, revenueStatus, pendingStatus, divisor, target } = input

  const credited = quotes.filter(q => q.engineer_id === engineerId)
  const sum = (rows: readonly SummaryQuote[]) => rows.reduce((s, q) => s + (q.total_supply || 0), 0)
  /** 처리 시각이 기간 안인가. 비어 있으면 어느 기간에도 들지 않는다. */
  const inRange = (ts: string | null | undefined) =>
    !!ts && ts.slice(0, 10) >= rangeStart && ts.slice(0, 10) <= rangeEnd

  const quotedQuotes = credited.filter(q => q.quote_date >= rangeStart && q.quote_date <= rangeEnd)
  const pendingQuotes = quotedQuotes.filter(q => q.status === pendingStatus)
  const orderedQuotes = credited.filter(q => isOrdered(q.status) && inRange(q.purchase_order_at))
  const revenueQuotes = credited.filter(q => q.status === revenueStatus && inRange(q.tax_invoice_completed_at))

  const quotedAmt = sum(quotedQuotes)
  const orderedAmt = sum(orderedQuotes)
  const revenueAmt = sum(revenueQuotes)
  const profitAmt = revenueQuotes.reduce((s, q) => s + (q.total_profit || 0), 0)

  const salesTarget = target ? Math.round(target.target / divisor) : 0
  const orderTarget = target ? Math.round(target.orderTarget / divisor) : 0

  return {
    quotedAmt,
    quotedCnt: quotedQuotes.length,
    pendingAmt: sum(pendingQuotes),
    pendingCnt: pendingQuotes.length,
    orderedAmt,
    orderedCnt: orderedQuotes.length,
    convRate: quotedQuotes.length > 0 ? (orderedQuotes.length / quotedQuotes.length * 100) : null,
    revenueAmt,
    revenueCnt: revenueQuotes.length,
    profitAmt,
    profitRate: revenueAmt > 0 ? (profitAmt / revenueAmt * 100) : null,
    salesTarget,
    orderTarget,
    achieve: salesTarget > 0 ? (revenueAmt / salesTarget * 100) : null,
    orderAchieve: orderTarget > 0 ? (orderedAmt / orderTarget * 100) : null,
  }
}
