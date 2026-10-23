// 견적 **분류별 수익 규칙** — 판관비율과 품목 줄 이익률 기본값.
//
// 지금 규칙이 있는 분류는 TSE 하나다.
//   TSE  — 판관비 매출의 30% · 품목 줄 이익률 기본 60%
//   그 밖(SBS 포함) — 판관비 없음 · 기본 40%
//
// ── 저장값의 뜻은 바뀌지 않는다 ──────────────────────────────────────────────
//   quotes.total_profit · profit_rate 는 지금까지처럼 **매출이익**(= 매출 − 원가)이다.
//   판관비와 영업이익은 **보여 주는 값**이다(작성 화면의 수익 분석, 엑셀 이익률 분석표).
//   실적 현황·대시보드 숫자도 그대로다 — 그 화면들은 저장값을 읽는다.
//
// 분류 목록 자체(코드·이름·사용 여부)는 DB 표가 정본이다(lib/quoteCategories.ts).
// 여기 있는 것은 **코드로만 정하는 계산 규칙**이라 그 파일과 나눠 두었다 —
// 순수 함수만 있어 하네스(scripts/quote-profit-check.js)가 그대로 돌린다.

/** 분류 코드별 규칙. 적히지 않은 분류는 아래 기본값을 쓴다. */
export const CATEGORY_PROFIT_RULES: Record<string, { sgaRate: number; defaultMargin: number }> = {
  TSE: { sgaRate: 0.30, defaultMargin: 60 },
}

/** 규칙이 없는 분류의 값 — 지금까지의 동작이다. */
export const DEFAULT_SGA_RATE = 0
export const DEFAULT_MARGIN = 40

/** 그 분류의 판관비율(0~1). 규칙이 없으면 0. */
export function sgaRateOf(category: string | null | undefined): number {
  if (!category) return DEFAULT_SGA_RATE
  return CATEGORY_PROFIT_RULES[category]?.sgaRate ?? DEFAULT_SGA_RATE
}

/** 그 분류의 품목 줄 이익률 기본값(%). 규칙이 없으면 40. */
export function defaultMarginOf(category: string | null | undefined): number {
  if (!category) return DEFAULT_MARGIN
  return CATEGORY_PROFIT_RULES[category]?.defaultMargin ?? DEFAULT_MARGIN
}

export type ProfitBreakdown = {
  /** 매출(공급가 합계). */
  revenue: number
  /** 원가 합계. */
  cost: number
  /** 매출이익 = 매출 − 원가. 저장되는 total_profit 과 같은 뜻이다. */
  grossProfit: number
  /** 매출이익률(%). 매출이 0이면 0. */
  grossRate: number
  /** 판관비 = 매출 × 판관비율. 규칙이 없는 분류는 0. */
  sga: number
  /** 영업이익 = 매출이익 − 판관비. */
  operatingProfit: number
  /** 영업이익률(%). 매출이 0이면 0. */
  operatingRate: number
  /** 판관비 줄을 낼 것인가(규칙이 있는 분류인가). */
  hasSga: boolean
}

/**
 * 수익 다섯 줄을 한 번에 계산한다 — 화면·엑셀이 같은 함수를 쓴다.
 *
 * 판관비는 **매출** 기준이다(원가가 아니다). 원가 100만·이익률 60%로 매출 250만이면
 * 매출이익 150만(60%) · 판관비 75만(30%) · 영업이익 75만(30%)이다.
 * 반올림은 원 단위에서 한다 — 화면과 엑셀이 다른 수를 보이지 않게.
 */
export function profitBreakdown(revenue: number, cost: number, category: string | null | undefined): ProfitBreakdown {
  const rate = sgaRateOf(category)
  const grossProfit = revenue - cost
  const sga = Math.round(revenue * rate)
  const operatingProfit = grossProfit - sga
  const pct = (v: number) => (revenue > 0 ? (v / revenue) * 100 : 0)
  return {
    revenue,
    cost,
    grossProfit,
    grossRate: pct(grossProfit),
    sga,
    operatingProfit,
    operatingRate: pct(operatingProfit),
    hasSga: rate > 0,
  }
}
