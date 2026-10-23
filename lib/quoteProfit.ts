// 견적 **분류별 수익 규칙** — 판관비율·품목 줄 이익률 기본값·영업이익 하한.
//
// 본사 엑셀 양식(AKB20261008-A.xlsx 의 「26년 개정 견적서」)이 정본이다. 그 시트의
// TSE·SBS 두 칸이 이렇게 적혀 있다.
//
//   분류  판관비율  영업이익율  견적 상수(1−판관−영업)  → 품목 줄 이익률 기본값
//   TSE   0.30      0.15        0.55                    45  (지금 코드는 60 — 아래 ※)
//   SBS   0.20      0.06        0.74                    26
//
// ※ TSE 의 기본 이익률은 60 으로 둔다. 엑셀의 0.55 는 「그 아래로 내려가지 않게 하는 선」이고,
//   실제 작성은 60 에서 시작해 깎는 방식이라 2026-10-22 에 60 으로 정했다. 영업이익 하한
//   15% 가 그 선을 지킨다(minOperatingMargin).
//
//   그 밖의 분류 — 판관비 없음 · 기본 40 · 하한 없음
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
export const CATEGORY_PROFIT_RULES: Record<string, CategoryProfitRule> = {
  TSE: { sgaRate: 0.30, defaultMargin: 60, minOperatingMargin: 15 },
  // SBS — 엑셀의 판관비율 0.20 · 영업이익율 0.06. 품목 줄 기본 이익률은 1−0.20−0.06 = 26%.
  //
  // 단가는 **엔(JPY)** 이다. 참고 엑셀의 「단가표」 시트에 SBS 품목이 [SB-6500] 묶음으로
  // 들어 있고 머리글이 LIST PRICE (JPY) 이며, 그 값이 price_list 의 price_jpy·cost_jpy 와
  // 한 원도 다르지 않다(2026-10-23 대조: 100056171A 450,000/252,000 등 7건 일치).
  // 그래서 환율은 TSE 와 같은 칸을 쓴다 — USD 로 가르지 않는다.
  //
  // (견적서 시트의 SBS 칸에는 환율 1,550 이 적혀 있다. 그것은 Schmitt 에서 달러로 사 오는
  //  다른 경로로 보이는데, 지금 가격표에 달러 단가가 없어 코드로 다룰 근거가 없다.
  //  달러로 사 오기 시작하면 가격표에 칸이 필요하다 — DB 변경이라 여기서 하지 않는다.)
  SBS: { sgaRate: 0.20, defaultMargin: 26, minOperatingMargin: 6 },
}

export type CategoryProfitRule = {
  /** 판관비율(0~1). 매출에 곱한다. */
  sgaRate: number
  /** 품목 줄 이익률 기본값(%). */
  defaultMargin: number
  /** 영업이익률 하한(%). 이 밑이면 화면이 사유를 묻는다. 없으면 묻지 않는다. */
  minOperatingMargin?: number
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

/**
 * 그 분류의 영업이익률 하한(%). 하한이 없는 분류는 null.
 *
 * 엑셀에 「영업이익은 6%고정함. 미만으로 적용 될 경우 사유 기재」로 적혀 있는 그 선이다.
 * **확정을 막지는 않는다** — 사유를 적게 하는 경고일 뿐이다(사람이 판단할 일이고,
 * 막으면 급한 건에서 우회 경로가 생긴다).
 */
export function minOperatingMarginOf(category: string | null | undefined): number | null {
  if (!category) return null
  return CATEGORY_PROFIT_RULES[category]?.minOperatingMargin ?? null
}

/**
 * 영업이익률이 하한 밑인가. 하한이 없으면 늘 false.
 *
 * 매출이 0 인 상태(아직 품목이 없다)에서는 묻지 않는다 — 작성 시작부터 빨간 글씨가
 * 떠 있으면 경고가 경고로 보이지 않는다.
 *
 * **화면에 보이는 자릿수로 견준다**(소수 한 자리). SBS 는 기본 이익률 26% 로 만들면
 * 영업이익률이 정확히 6% 에 서는데, 부동소수 때문에 5.999995% 가 되어 그냥 비교하면
 * 기본값으로 만든 견적마다 「6.0% — 하한 6% 미만」이 떴다(2026-10-23 하네스로 잡았다).
 * 사람이 보는 숫자와 판정이 어긋나는 경고는 경고가 아니다.
 */
export function isBelowMinOperating(
  breakdown: Pick<ProfitBreakdown, 'revenue' | 'operatingRate'>,
  category: string | null | undefined,
): boolean {
  const min = minOperatingMarginOf(category)
  if (min === null || breakdown.revenue <= 0) return false
  const shown = Math.round(breakdown.operatingRate * 10) / 10
  return shown < min
}

/** 경고 문구 — 화면과 하네스가 같은 글을 쓴다. */
export function belowMinOperatingMessage(operatingRate: number, min: number): string {
  return `영업이익 ${operatingRate.toFixed(1)}% — 하한 ${min}% 미만, 사유를 적어 주세요`
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
