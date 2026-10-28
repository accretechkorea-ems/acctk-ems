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

/** 그 달의 **수주·매출과 각 목표** — 월별 그래프의 막대 넷이다. */
export type MonthBars = {
  label: string
  month: number
  year: number
  orderedAmt: number
  revenueAmt: number
  profitAmt: number
  /** 월 목표 = 연간 목표 ÷ 12. 수주·매출 각각 따로다. */
  orderTarget: number
  salesTarget: number
  orderAchieve: number | null
  salesAchieve: number | null
}

/**
 * 집계 범위 — **한 명**(engineerId) 또는 **여럿**(engineerIds) 이다.
 *
 * 여럿은 사업부 전체 그래프가 쓴다(실적 현황 상단). 한 명은 개인 그래프 모달이 쓴다.
 * 둘을 한 함수로 둔 이유: 사업부 숫자가 개인 숫자의 합과 어긋나면 어느 쪽이 맞는지
 * 알 길이 없다. 같은 코드로 더하면 어긋날 수 없다.
 */
export type StatScope = { engineerId?: number; engineerIds?: readonly number[] }

/** 범위에 들었는가. id 가 비어 있는 옛 행은 어느 범위에도 들지 않는다. */
const inScope = (ids: Set<number>, id: number | null): boolean => id != null && ids.has(id)

/** 범위에 든 사람 id. 아무것도 주지 않으면 빈 집합(= 0 원)이다. */
function idsOf(scope: StatScope): Set<number> {
  if (scope.engineerIds) return new Set(scope.engineerIds)
  return new Set(scope.engineerId != null ? [scope.engineerId] : [])
}

/**
 * 그 범위의 **연간 목표 합**. 한 명이면 그 사람 한 줄, 여럿이면 그 사람들의 줄을 더한다.
 * 분기 목표 줄(quarter != null)은 보지 않는다 — 연간 줄만 정본이다.
 */
function annualTargetOf(
  targets: readonly StatTarget[],
  ids: Set<number>,
  fy: number,
  key: 'target_amount' | 'order_target_amount',
): number {
  return targets.reduce((s2, x) => (
    inScope(ids, x.engineer_id) && x.year === fy && x.quarter === null ? s2 + (x[key] || 0) : s2
  ), 0)
}

/**
 * 회계연도 열두 달의 막대 자료.
 *
 * 기간 판정은 카드와 **같은 함수**를 쓴다(inOrderPeriod·inRevenuePeriod) — 수주는 발주일,
 * 매출은 세금계산서 완료일이다. 예전에는 이 그래프만 new Date() 로 달을 갈라, 브라우저
 * 시간대에 따라 한국 새벽에 찍힌 건이 전달로 밀렸다.
 */
export function monthlyBars(
  quotes: readonly StatQuote[],
  targets: readonly StatTarget[],
  opts: StatScope & { fy: number },
): MonthBars[] {
  const { fy } = opts
  const ids = idsOf(opts)
  const mine = quotes.filter(q => inScope(ids, q.engineer_id))
  const orderTarget = Math.round(annualTargetOf(targets, ids, fy, 'order_target_amount') / 12)
  const salesTarget = Math.round(annualTargetOf(targets, ids, fy, 'target_amount') / 12)

  return getFYMonths(fy).map(({ label, month, year }) => {
    const ordered = mine.filter(q => inOrderPeriod(q, fy, 'month', month))
    const revenue = mine.filter(q => inRevenuePeriod(q, fy, 'month', month))
    const orderedAmt = ordered.reduce((s2, q) => s2 + (q.total_supply || 0), 0)
    const revenueAmt = revenue.reduce((s2, q) => s2 + (q.total_supply || 0), 0)
    return {
      label, month, year, orderedAmt, revenueAmt,
      profitAmt: revenue.reduce((s2, q) => s2 + (q.total_profit || 0), 0),
      orderTarget, salesTarget,
      orderAchieve: orderTarget > 0 ? (orderedAmt / orderTarget) * 100 : null,
      salesAchieve: salesTarget > 0 ? (revenueAmt / salesTarget) * 100 : null,
    }
  })
}

/**
 * 그 회계연도에 **남은 개월(이번 달 포함)**.
 *   지난 회계연도 → 0   다음 회계연도 → 12   이번 회계연도 → 이번 달부터 3월까지
 * 3월에 열면 1, 4월에 열면 12 다.
 */
export function remainingMonths(fy: number, today: string): number {
  const now = fiscalYearOf(today)
  if (fy > now) return 12
  if (fy < now) return 0
  const m = ymdParts(today).m
  return m >= 4 ? 16 - m : 4 - m
}

/**
 * 한 달에 얼마씩 더 해야 하는가 — (연간 목표 − 누적) ÷ 남은 개월.
 *   이미 넘겼으면 'done'  ·  목표가 없거나 남은 달이 없으면 null(칸을 비운다)
 * 0 으로 나누지 않는다.
 */
export function neededPerMonth(target: number, done: number, remaining: number): number | 'done' | null {
  if (target <= 0) return null
  if (done >= target) return 'done'
  if (remaining <= 0) return null
  return Math.ceil((target - done) / remaining)
}

/** 그래프 아래 보조 지표 다섯 칸. */
export type YearSummary = {
  orderedAmt: number
  revenueAmt: number
  profitAmt: number
  profitRate: number | null
  orderTarget: number
  salesTarget: number
  orderAchieve: number | null
  salesAchieve: number | null
  remaining: number
  needOrder: number | 'done' | null
  needSales: number | 'done' | null
  /** 아직 결과가 안 난 견적(상태 「견적중」) — 기간을 보지 않는다. */
  pendingAmt: number
  pendingCnt: number
}

/** 그 회계연도 한 해치 요약. 막대 자료를 다시 받아 쓰므로 그래프와 숫자가 어긋날 수 없다. */
export function yearSummary(
  quotes: readonly StatQuote[],
  targets: readonly StatTarget[],
  opts: StatScope & { fy: number; today: string },
): YearSummary {
  const { fy, today } = opts
  const ids = idsOf(opts)
  const bars = monthlyBars(quotes, targets, opts)
  const orderedAmt = bars.reduce((s2, b) => s2 + b.orderedAmt, 0)
  const revenueAmt = bars.reduce((s2, b) => s2 + b.revenueAmt, 0)
  const profitAmt = bars.reduce((s2, b) => s2 + b.profitAmt, 0)

  const orderTarget = annualTargetOf(targets, ids, fy, 'order_target_amount')
  const salesTarget = annualTargetOf(targets, ids, fy, 'target_amount')
  const remaining = remainingMonths(fy, today)

  const pending = quotes.filter(q => inScope(ids, q.engineer_id) && q.status === '견적중')

  return {
    orderedAmt, revenueAmt, profitAmt,
    profitRate: revenueAmt > 0 ? (profitAmt / revenueAmt) * 100 : null,
    orderTarget, salesTarget,
    orderAchieve: orderTarget > 0 ? (orderedAmt / orderTarget) * 100 : null,
    salesAchieve: salesTarget > 0 ? (revenueAmt / salesTarget) * 100 : null,
    remaining,
    needOrder: neededPerMonth(orderTarget, orderedAmt, remaining),
    needSales: neededPerMonth(salesTarget, revenueAmt, remaining),
    pendingAmt: pending.reduce((s2, q) => s2 + (q.total_supply || 0), 0),
    pendingCnt: pending.length,
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

// ── 그래프 가로축의 칸 — 월 · 분기 · 연도 ───────────────────────────────────
// 실적 현황 상단의 사업부 그래프가 세 단위를 오간다. 개인 그래프 모달은 월만 쓴다.
// **더하는 규칙은 한곳에 둔다** — 분기는 그 안의 달을 더하고, 목표는 단위에 맞춰
// 연간 목표를 ÷12(월) · ÷4(분기) · ×1(연도) 한다.

/** 가로축 단위. */
export type ChartUnit = 'month' | 'quarter' | 'year'

/** 가로축 한 칸. MonthBars 와 같은 칸을 갖되 label 이 「4월」·「Q1」·「FY2026」 로 달라진다. */
export type UnitBar = {
  key: string
  label: string
  /** 둘째 줄(분기의 「4~6월」). 없으면 비운다. */
  sub?: string
  orderedAmt: number
  revenueAmt: number
  profitAmt: number
  orderTarget: number
  salesTarget: number
  orderAchieve: number | null
  salesAchieve: number | null
  /** 지금이 그 칸인가 — 막대 뒤 띠와 라벨 색이 이것을 본다. */
  isNow: boolean
}

const achieveOf = (amt: number, target: number): number | null =>
  target > 0 ? (amt / target) * 100 : null

/**
 * 가로축 칸 자료를 만든다.
 *
 *   month   — 회계연도 열두 달(monthlyBars 그대로)
 *   quarter — Q1~Q4. 그 안의 석 달을 더하고 목표는 연간 ÷ 4
 *   year    — FY−1 · FY · FY+1 세 해. 목표는 **각 해의 목표 합**이다(÷ 하지 않는다)
 *
 * 범위(engineerId 하나 또는 engineerIds 여럿)는 다른 함수와 같다 — 그래서 사업부 그래프의
 * 숫자는 개인 그래프 숫자의 합과 어긋날 수 없다.
 */
export function unitBars(
  quotes: readonly StatQuote[],
  targets: readonly StatTarget[],
  opts: StatScope & { fy: number; unit: ChartUnit; today: string },
): UnitBar[] {
  const { fy, unit, today } = opts
  const nowFy = fiscalYearOf(today)
  const { m: nowMonth } = ymdParts(today)
  const nowYear = ymdParts(today).y

  if (unit === 'month') {
    return monthlyBars(quotes, targets, opts).map(b => ({
      key: `${b.year}-${b.month}`,
      label: b.label,
      orderedAmt: b.orderedAmt,
      revenueAmt: b.revenueAmt,
      profitAmt: b.profitAmt,
      orderTarget: b.orderTarget,
      salesTarget: b.salesTarget,
      orderAchieve: b.orderAchieve,
      salesAchieve: b.salesAchieve,
      isNow: b.year === nowYear && b.month === nowMonth,
    }))
  }

  if (unit === 'quarter') {
    const months = monthlyBars(quotes, targets, opts)
    // 월 목표를 더하지 않는다 — ÷12 를 세 번 더하면 반올림 오차가 쌓인다. 연간에서 ÷4 한다.
    const ids = idsOf(opts)
    const orderTarget = Math.round(annualTargetOf(targets, ids, fy, 'order_target_amount') / 4)
    const salesTarget = Math.round(annualTargetOf(targets, ids, fy, 'target_amount') / 4)
    const nowQuarter = nowFy === fy ? Math.floor(((nowMonth + 8) % 12) / 3) + 1 : 0
    return [
      { q: 1, label: 'Q1', sub: '4~6월', ms: [4, 5, 6] },
      { q: 2, label: 'Q2', sub: '7~9월', ms: [7, 8, 9] },
      { q: 3, label: 'Q3', sub: '10~12월', ms: [10, 11, 12] },
      { q: 4, label: 'Q4', sub: '1~3월', ms: [1, 2, 3] },
    ].map(({ q, label, sub, ms }) => {
      const mine = months.filter(b => ms.includes(b.month))
      const orderedAmt = mine.reduce((s2, b) => s2 + b.orderedAmt, 0)
      const revenueAmt = mine.reduce((s2, b) => s2 + b.revenueAmt, 0)
      return {
        key: `q${q}`, label, sub,
        orderedAmt, revenueAmt,
        profitAmt: mine.reduce((s2, b) => s2 + b.profitAmt, 0),
        orderTarget, salesTarget,
        orderAchieve: achieveOf(orderedAmt, orderTarget),
        salesAchieve: achieveOf(revenueAmt, salesTarget),
        isNow: q === nowQuarter,
      }
    })
  }

  // 연도 — 세 해를 각각 제 목표로 잰다(그 해에 목표가 없으면 달성률은 비운다).
  return [fy - 1, fy, fy + 1].map(y => {
    const bars = monthlyBars(quotes, targets, { ...opts, fy: y })
    const ids = idsOf(opts)
    const orderTarget = annualTargetOf(targets, ids, y, 'order_target_amount')
    const salesTarget = annualTargetOf(targets, ids, y, 'target_amount')
    const orderedAmt = bars.reduce((s2, b) => s2 + b.orderedAmt, 0)
    const revenueAmt = bars.reduce((s2, b) => s2 + b.revenueAmt, 0)
    return {
      key: `fy${y}`, label: `FY${y}`,
      orderedAmt, revenueAmt,
      profitAmt: bars.reduce((s2, b) => s2 + b.profitAmt, 0),
      orderTarget, salesTarget,
      orderAchieve: achieveOf(orderedAmt, orderTarget),
      salesAchieve: achieveOf(revenueAmt, salesTarget),
      isNow: y === nowFy,
    }
  })
}
