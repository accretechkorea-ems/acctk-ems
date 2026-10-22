// 개인 대시보드 카드의 **숫자 규칙** — 순수 함수만 둔다.
//
// 카드마다 조회는 따로 하지만(하나가 실패해도 나머지는 뜬다) 숫자를 만드는 규칙은 여기 모은다.
// 화면에서 계산하면 카드와 「내 견적」 표가 조용히 어긋난다 — 같은 달을 보는데 숫자가 다르면
// 둘 중 어느 쪽이 맞는지 알 길이 없다. DB·화면을 모른다(날짜 유틸 하나만 쓴다).

import { kstYmd } from './date'
import { quoteExpiry } from './quoteStatus'

// ── 이번 달 실적 ────────────────────────────────────────────────────────────

/** KPI 를 내는 데 필요한 견적의 최소 모양. */
export type CardQuote = {
  status: string | null
  quote_date: string | null
  purchase_order_at: string | null
  tax_invoice_completed_at: string | null
  total_supply: number | null
  total_profit: number | null
  engineer_id: number | null
}

export type MonthKpi = {
  /** 그 달에 **낸** 견적(견적일 기준). */
  quoted: number
  /** 그 달에 **발주가 난** 건(발주일 기준). */
  ordered: number
  /** 그 달에 **계산서가 끝난** 건(완료 시각 기준). */
  revenue: number
  profit: number
  profitRate: number | null
  orderTarget: number
  salesTarget: number
  /** 목표가 0이면 null(0으로 나누지 않는다). */
  orderAchieve: number | null
  salesAchieve: number | null
}

/** 수주로 보는 상태 — lib/quoteStatus.ts 의 ORDERED_STATUSES 와 같은 값이다(그 파일이 정본). */
const ORDERED = new Set(['수주', '발주(주문 대기)', '주문완료', '세금계산서 요청', '매출완료'])
const REVENUE = '매출완료'

/** 'YYYY-MM-DD…' 가 그 달인가. timestamptz 는 **한국 기준**으로 읽는다. */
const inMonth = (at: string | null | undefined, month: string, instant = false): boolean => {
  if (!at) return false
  const ymd = instant ? kstYmd(at) : at
  return ymd.slice(0, 7) === month
}

/**
 * 한 달치 숫자. 기간을 재는 날짜가 지표마다 다르다 — 「내 견적」 표와 같은 규칙이다.
 *   견적 제출 : quote_date
 *   수주      : purchase_order_at (시각이라 한국 날짜로 읽는다)
 *   매출·순이익: tax_invoice_completed_at + 상태가 매출완료
 * 목표는 **연간 목표 ÷ 12**. 실적 귀속자가 본인인 건만 센다(대필해 준 남의 건은 그 사람 실적이다).
 */
export function monthKpi(
  quotes: readonly CardQuote[],
  opts: { month: string; engineerId: number; yearTarget: { sales: number; order: number } },
): MonthKpi {
  const mine = quotes.filter(q => q.engineer_id === opts.engineerId)
  const quoted = mine.filter(q => inMonth(q.quote_date, opts.month))
    .reduce((s, q) => s + (q.total_supply ?? 0), 0)
  const ordered = mine.filter(q => ORDERED.has(q.status ?? '') && inMonth(q.purchase_order_at, opts.month, true))
    .reduce((s, q) => s + (q.total_supply ?? 0), 0)
  const revenueRows = mine.filter(q => q.status === REVENUE && inMonth(q.tax_invoice_completed_at, opts.month, true))
  const revenue = revenueRows.reduce((s, q) => s + (q.total_supply ?? 0), 0)
  const profit = revenueRows.reduce((s, q) => s + (q.total_profit ?? 0), 0)

  const salesTarget = Math.round(opts.yearTarget.sales / 12)
  const orderTarget = Math.round(opts.yearTarget.order / 12)
  return {
    quoted, ordered, revenue, profit,
    profitRate: revenue > 0 ? (profit / revenue) * 100 : null,
    salesTarget, orderTarget,
    orderAchieve: orderTarget > 0 ? (ordered / orderTarget) * 100 : null,
    salesAchieve: salesTarget > 0 ? (revenue / salesTarget) * 100 : null,
  }
}

/**
 * 「내 견적」 카드가 세는 상태 — **아직 손이 가야 하는 것들**이다.
 *
 * 매출완료는 넣지 않는다. 끝난 건이라 해마다 쌓이기만 해서, 세어 두면 숫자가 커지는 것 말고는
 * 아무 뜻이 없다(그 숫자는 실적 화면과 「내 견적」 모달이 기간과 함께 보여 준다).
 * 순서는 진행 순서다 — 견적을 내고, 발주를 받고, 주문이 끝나고, 계산서를 요청한다.
 */
export const CARD_QUOTE_STATUSES = ['견적중', '발주(주문 대기)', '주문완료', '세금계산서 요청'] as const

export type QuoteStatusCount = { status: string; count: number }

/**
 * 상태별 건수. **기간을 보지 않는다** — 진행 중인 건은 언제 쓴 것이든 끝날 때까지 내 일이다.
 * 실적 귀속자가 본인인 건만 센다(대필해 준 남의 건은 그 사람 목록에 뜬다).
 */
export function quoteStatusCounts(
  quotes: readonly CardQuote[], engineerId: number,
): QuoteStatusCount[] {
  const mine = quotes.filter(q => q.engineer_id === engineerId)
  return CARD_QUOTE_STATUSES.map(status => ({
    status,
    count: mine.filter(q => q.status === status).length,
  }))
}

// ── 포캐스트 단계 막대 ──────────────────────────────────────────────────────

/** 보드에 세우는 단계(실주는 빼고 — 끝난 건이다). components/customer/opportunity.ts 와 같은 순서다. */
export const CARD_STAGES = ['상담', '사양검토', '견적제출', '협상', '수주'] as const

export type CardOpportunity = {
  opportunity_id: number
  stage: string | null
  expected_amount: number | null
  closed_at: string | null
  created_at: string | null
  engineer_id: number | null
}

export type StageBar = { stage: string; count: number; amount: number }

/** 단계별 건수·금액. 종료된 건(closed_at)은 빼고 센다 — 지금 들고 있는 것만 보는 카드다. */
export function stageBars(opps: readonly CardOpportunity[]): StageBar[] {
  const open = opps.filter(o => !o.closed_at)
  return CARD_STAGES.map(stage => {
    const rows = open.filter(o => o.stage === stage)
    return { stage, count: rows.length, amount: rows.reduce((s, o) => s + (o.expected_amount ?? 0), 0) }
  })
}

// ── 할 일 ───────────────────────────────────────────────────────────────────

export type TodoKey = 'amount0' | 'expiring' | 'stale' | 'leadNoForecast'

export type TodoItem = {
  key: TodoKey
  label: string
  count: number
  /** 누르면 갈 곳. 그 화면에서 바로 손댈 수 있는 자리여야 한다. */
  href: string
}

export type TodoInput = {
  opportunities: readonly CardOpportunity[]
  quotes: readonly { status: string | null; quote_date: string | null; engineer_id: number | null }[]
  /** 내 리드 — 진행중이면서 포캐스트가 아직 없는 건을 센다. */
  leads: readonly { status: string | null; converted_opportunity_id: number | null }[]
  /** [opportunity_id] = 마지막 활동일 'YYYY-MM-DD'. 없으면 등록일로 잰다. */
  lastActivity: Record<number, string>
  engineerId: number
  today: string
}

/** 며칠 지났는가 — 'YYYY-MM-DD' 두 개를 뺀다(시간대가 끼어들지 않는다). */
const daysSince = (from: string, today: string): number => {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${today}T00:00:00Z`)
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((b - a) / 86400000)
}

/** 활동이 없는 것으로 보는 일수. 파이프라인 카드의 「방치」와 같은 기준이다. */
export const STALE_DAYS = 30
/** 만료가 코앞이라고 보는 일수. */
export const EXPIRING_DAYS = 7

/**
 * 자동으로 만드는 할 일. **0건인 줄은 돌려주지 않는다**(할 일이 없으면 빈 배열이다).
 *
 * 리드 줄(leadNoForecast)은 **포캐스트가 아직 없는** 리드만 센다. 금액이 0인 것은 이미
 * 첫 줄(amount0)이 세고 있어, 같은 건을 두 줄로 알리지 않는다.
 */
export function buildTodos(input: TodoInput): TodoItem[] {
  const { opportunities, quotes, leads, lastActivity, engineerId, today } = input
  const mineOpen = opportunities.filter(o => o.engineer_id === engineerId && !o.closed_at)

  const amount0 = mineOpen.filter(o => !o.expected_amount).length
  const stale = mineOpen.filter(o => {
    const base = lastActivity[o.opportunity_id] ?? (o.created_at ?? '').slice(0, 10)
    return base !== '' && daysSince(base, today) >= STALE_DAYS
  }).length
  const expiring = quotes.filter(q => {
    if (q.engineer_id !== engineerId || q.status !== '견적중' || !q.quote_date) return false
    const end = quoteExpiry(q.quote_date)
    return end >= today && daysSince(today, end) <= EXPIRING_DAYS
  }).length
  const leadNoForecast = leads.filter(l => l.status === '진행중' && l.converted_opportunity_id == null).length

  const all: TodoItem[] = [
    { key: 'amount0', label: `금액이 비어 있는 포캐스트 ${amount0}건`, count: amount0, href: '/pipeline' },
    { key: 'expiring', label: `${EXPIRING_DAYS}일 안에 유효기간이 끝나는 견적 ${expiring}건`, count: expiring, href: '/dashboard?quoteTab=견적중' },
    { key: 'stale', label: `${STALE_DAYS}일 넘게 활동이 없는 포캐스트 ${stale}건`, count: stale, href: '/pipeline' },
    { key: 'leadNoForecast', label: `포캐스트가 만들어지지 않은 내 리드 ${leadNoForecast}건`, count: leadNoForecast, href: '/leads' },
  ]
  return all.filter(t => t.count > 0)
}
