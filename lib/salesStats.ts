// 실적 현황의 **숫자 규칙** — 기간 판정과 담당자 한 명분 집계.
//
// 실적 현황(app/sales/page.tsx)에 인라인으로 있던 것을 그대로 옮겼다. 개인 대시보드의
// 「내 실적」 카드가 같은 숫자를 보여야 해서다 — 규칙을 두 벌로 들고 다니면 같은 사람의
// 같은 달 숫자가 두 화면에서 다르게 나오고, 그때 어느 쪽이 맞는지 알 길이 없다.
//
// 기간을 재는 날짜가 **지표마다 다르다**(이것이 이 파일의 핵심이다).
//   견적 제출 — 견적을 낸 날(quote_date)
//   수주      — 발주서를 등록한 날(purchase_order_at)
//   매출      — 세금계산서 발행이 끝난 날(tax_invoice_completed_at)
// 처리 시각이 비어 있는 건은 그 지표의 어느 기간에도 잡히지 않는다(임의 대체 없음).
//
// 회계연도는 **4월 시작**이다. 날짜는 전부 한국 기준으로 읽는다 — timestamptz 가 한국 새벽에
// 찍히면 UTC 로는 전날이 되어 분기·회계연도가 통째로 밀린다.

import { kstYmd, ymdParts } from './date'

/** 보는 기간. 화면의 선택칸 값과 같은 글자다. */
export type PeriodMode = 'year' | 'month' | 'q1' | 'q2' | 'q3' | 'q4' | 'h1' | 'h2'

/** 집계에 필요한 견적의 최소 모양. */
export type StatQuote = {
  /** 실적 귀속자. 옛 행에는 비어 있을 수 있다 — 어느 담당자에게도 잡히지 않는다. */
  engineer_id: number | null
  /** 견적일 'YYYY-MM-DD'. 없으면 「견적 제출」 어느 기간에도 들지 않는다. */
  quote_date: string | null
  status: string | null
  purchase_order_at?: string | null
  tax_invoice_completed_at?: string | null
  total_supply: number | null
  total_profit?: number | null
}

export type StatTarget = {
  /** 옛 행에는 비어 있을 수 있다 — 그런 행은 어느 담당자에게도 붙지 않는다. */
  engineer_id: number | null
  year: number
  quarter: number | null
  target_amount: number | null
  order_target_amount: number | null
}

export type EngineerStat = {
  quotedAmt: number
  orderedAmt: number
  revenueAmt: number
  profitAmt: number
  profitRate: number | null
  quotedCnt: number
  orderedCnt: number
  /** 그 기간에 해당하는 매출 목표(연간 목표를 기간으로 나눈 값). */
  targetAmt: number
  orderTargetAmt: number
  achieve: number | null
  orderAchieve: number | null
}

/** 수주로 보는 상태 — lib/quoteStatus.ts 의 ORDERED_STATUSES 와 같은 값이다(그 파일이 정본). */
const ORDERED = new Set(['수주', '발주(주문 대기)', '주문완료', '세금계산서 요청', '매출완료'])
const REVENUE = '매출완료'

/** 한국 날짜로 읽은 {년, 월}. */
const parts = (dateStr: string) => ymdParts(kstYmd(dateStr))

/** 그 날짜가 속한 회계연도(4월 시작). 1~3월은 전년도다. */
export function fiscalYearOf(dateStr: string): number {
  const { y, m } = parts(dateStr)
  return m >= 4 ? y : y - 1
}

/** 그 날짜가 고른 기간 안에 드는가. month 는 mode === 'month' 일 때만 쓴다(1~12). */
export function matchPeriod(dateStr: string, fy: number, mode: PeriodMode, month: number): boolean {
  const { y, m } = parts(dateStr)
  if (mode === 'year') return fiscalYearOf(dateStr) === fy
  if (mode === 'month') {
    // 1~3월은 회계연도의 **다음 해**에 있다.
    const targetYear = month < 4 ? fy + 1 : fy
    return y === targetYear && m === month
  }
  if (mode === 'q1') return fiscalYearOf(dateStr) === fy && m >= 4 && m <= 6
  if (mode === 'q2') return fiscalYearOf(dateStr) === fy && m >= 7 && m <= 9
  if (mode === 'q3') return fiscalYearOf(dateStr) === fy && m >= 10 && m <= 12
  if (mode === 'q4') return m >= 1 && m <= 3 && y === fy + 1
  if (mode === 'h1') return fiscalYearOf(dateStr) === fy && m >= 4 && m <= 9           // 상반기 4~9월
  if (mode === 'h2') return fiscalYearOf(dateStr) === fy && (m >= 10 || m <= 3)        // 하반기 10~다음해 3월
  return true
}

/** 그 기간의 **수주** 건인가 — 발주일 기준. */
export const inOrderPeriod = (q: StatQuote, fy: number, mode: PeriodMode, month: number): boolean =>
  ORDERED.has(q.status ?? '') && !!q.purchase_order_at && matchPeriod(q.purchase_order_at, fy, mode, month)

/** 그 기간의 **매출** 건인가 — 세금계산서 완료일 기준. */
export const inRevenuePeriod = (q: StatQuote, fy: number, mode: PeriodMode, month: number): boolean =>
  q.status === REVENUE && !!q.tax_invoice_completed_at && matchPeriod(q.tax_invoice_completed_at, fy, mode, month)

/** 연간 목표를 그 기간 몫으로 나눈다. 연간은 그대로, 월 ÷12, 반기 ÷2, 분기 ÷4. */
export function periodTarget(annual: number, mode: PeriodMode): number {
  if (mode === 'year') return annual
  if (mode === 'month') return Math.round(annual / 12)
  if (mode === 'h1' || mode === 'h2') return Math.round(annual / 2)
  return Math.round(annual / 4)
}

/**
 * 담당자 한 명분 집계. 실적 현황의 개인 카드와 개인 대시보드의 「내 실적」이 같이 쓴다.
 * 목표가 0이면 달성률은 null 이다(0으로 나누지 않는다 — 「0%」와 「목표 없음」은 다른 말이다).
 */
export function engineerStat(
  quotes: readonly StatQuote[],
  targets: readonly StatTarget[],
  opts: { engineerId: number; fy: number; mode: PeriodMode; month: number },
): EngineerStat {
  const { engineerId, fy, mode, month } = opts
  const mine = quotes.filter(q => q.engineer_id === engineerId)
  const quoted = mine.filter(q => !!q.quote_date && matchPeriod(q.quote_date, fy, mode, month))
  const ordered = mine.filter(q => inOrderPeriod(q, fy, mode, month))
  const revenue = mine.filter(q => inRevenuePeriod(q, fy, mode, month))

  const quotedAmt = quoted.reduce((s, q) => s + (q.total_supply || 0), 0)
  const orderedAmt = ordered.reduce((s, q) => s + (q.total_supply || 0), 0)
  const revenueAmt = revenue.reduce((s, q) => s + (q.total_supply || 0), 0)
  const profitAmt = revenue.reduce((s, q) => s + (q.total_profit || 0), 0)

  const t = targets.find(x => x.engineer_id === engineerId && x.year === fy && x.quarter === null)
  const targetAmt = periodTarget(t?.target_amount || 0, mode)
  const orderTargetAmt = periodTarget(t?.order_target_amount || 0, mode)

  return {
    quotedAmt, orderedAmt, revenueAmt, profitAmt,
    profitRate: revenueAmt > 0 ? (profitAmt / revenueAmt) * 100 : null,
    quotedCnt: quoted.length, orderedCnt: ordered.length,
    targetAmt, orderTargetAmt,
    achieve: targetAmt > 0 ? (revenueAmt / targetAmt) * 100 : null,
    orderAchieve: orderTargetAmt > 0 ? (orderedAmt / orderTargetAmt) * 100 : null,
  }
}

/** 회계연도의 열두 달 — 4월부터 다음해 3월까지. 월별 그래프의 가로축이다. */
export function getFYMonths(fy: number): { label: string; month: number; year: number }[] {
  const out: { label: string; month: number; year: number }[] = []
  for (let i = 0; i < 12; i++) {
    const m = 4 + i
    const month = m <= 12 ? m : m - 12
    out.push({ label: `${month}월`, month, year: m <= 12 ? fy : fy + 1 })
  }
  return out
}
