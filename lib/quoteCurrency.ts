// 견적의 **통화** — 엔(JPY)과 달러(USD).
//
// ── 왜 생겼는가 ─────────────────────────────────────────────────────────────
//   SBS 분류 제품 일부를 Schmitt 에서 **달러로** 사 온다. 그 전까지 이 저장소는 매입을 전부
//   엔으로 다뤘다 — 가격표 칸 이름이 price_jpy·cost_jpy 이고, 견적 화면의 환율은 하나였고,
//   원가는 늘 `구입가 × 원/엔 × 관세` 였다. 달러 단가를 그 식에 넣으면 원가가 약 150배
//   틀어진다(원/달러 1,337 ÷ 원/엔 8.48).
//
//   그래서 2026-11-03 에 DB 에 칸 세 개가 생겼다(기본값 'JPY' — db/APPLIED.md).
//     price_list.currency   그 줄의 구입가·정가가 어느 통화인가
//     exchange_rate.currency 그 환율이 어느 통화의 것인가
//     quote_items.currency  그 품목 줄이 어느 통화로 계산됐는가(저장 시점 스냅샷)
//
// ── 이 파일이 하는 일 ───────────────────────────────────────────────────────
//   「통화가 무엇이고, 그 통화의 환율을 어디서 고르는가」만 둔다. 금액 계산은 calc.ts,
//   화면 표시는 3단계다. **순수 함수만** 있어 하네스가 그대로 돌린다
//   (scripts/quote-currency-check.js).

/** 다루는 통화. 늘릴 때 여기만 더하면 타입이 따라온다(EUR 등). */
export const CURRENCIES = ['JPY', 'USD'] as const
export type Currency = (typeof CURRENCIES)[number]

/**
 * 적히지 않았을 때의 통화.
 * DB 칸 기본값과 **같아야 한다** — 옛 줄·옛 임시저장에는 칸이 없고, 그것들은 전부 엔이다.
 */
export const DEFAULT_CURRENCY: Currency = 'JPY'

/** 금액 앞에 붙이는 기호. 화면·엑셀이 함께 쓴다(3단계에서 쓰기 시작한다). */
export const CURRENCY_SYMBOL: Readonly<Record<Currency, string>> = { JPY: '¥', USD: '$' }

/** 사람이 고를 때 보이는 이름. */
export const CURRENCY_LABEL: Readonly<Record<Currency, string>> = {
  JPY: '엔 (JPY)',
  USD: '달러 (USD)',
}

/**
 * 달러 환율의 **출발값** — 1,600 원/달러.
 *
 * 왜 상수인가 — 본사 견적서 엑셀의 SBS 칸이 그런 식으로 **사람이 정한 환율**을 쓴다
 * (그 시트에는 1,550 이 적혀 있었다). 실시간 매매기준율(1,337 선)보다 높게 잡아 두는 것은
 * 환차손과 수입 부대비를 그 안에 녹여 두는 관행이다. 그래서 자동 환율로 덮지 않고
 * **이 값으로 시작한 뒤 사람이 고친다**(견적 화면의 달러 환율 칸).
 *
 * ⚠ **나중에 설정 표로 옮긴다.** 지금은 코드 상수다 — 바꾸려면 배포가 필요하다.
 * 분류별·기간별로 달라지기 시작하면 quote_categories 나 별도 설정 표로 내려야 한다
 * (그때 이 상수는 「표에 값이 없을 때의 기본값」으로 남는다).
 */
export const USD_DEFAULT_RATE = 1600

/** 아는 통화인가. */
export function isCurrency(v: unknown): v is Currency {
  return typeof v === 'string' && (CURRENCIES as readonly string[]).includes(v)
}

/**
 * 어떤 값이든 통화로 읽는다. **모르면 엔이다**(DB 기본값·옛 자료와 같은 선택).
 * null·빈 글자·소문자('usd')·모르는 코드 전부 여기서 눕는다.
 */
export function toCurrency(v: unknown): Currency {
  if (typeof v !== 'string') return DEFAULT_CURRENCY
  const up = v.trim().toUpperCase()
  return isCurrency(up) ? up : DEFAULT_CURRENCY
}

/** 통화별 환율 한 벌 — 견적 화면이 들고 있는 모양. 값은 **원/1단위**다. */
export type Rates = Record<Currency, number>

/** 환율을 하나만 아는 자리에서 쓰는 묶음(장비 구성 모달 등 — 그쪽은 엔만 다룬다). */
export const jpyOnly = (jpy: number): Rates => ({ JPY: jpy, USD: 0 })

/**
 * 그 줄의 통화에 맞는 환율.
 *
 * 없거나 0 이면 **0 을 돌려준다** — 부르는 쪽(calc.ts)이 「계산할 근거가 없다」로 보고
 * 금액을 만들지 않는다. 0 을 1 로 바꿔 주면 구입가가 그대로 원화가 되어 조용히 틀린다.
 */
export function pickRate(currency: unknown, rates: Partial<Rates> | null | undefined): number {
  const cur = toCurrency(currency)
  const v = rates?.[cur]
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

// ── 수출입은행 응답 ──────────────────────────────────────────────────────────
//
// AP01 은 통화 23종을 배열로 준다. 통화를 가리키는 칸이 `cur_unit` 이고 **엔은 100단위**다.
//   { cur_unit: 'JPY(100)', deal_bas_r: '848.21' }  → 원/엔  8.4821
//   { cur_unit: 'USD',      deal_bas_r: '1,337.2' } → 원/달러 1337.2
// 2026-11-03 실측으로 확인했다(통화 목록 23종에 USD 가 있다).

/** 그 통화가 응답에서 쓰는 이름. */
export const EXIM_UNIT: Readonly<Record<Currency, string>> = { JPY: 'JPY(100)', USD: 'USD' }

/** 100단위로 오는 통화 — 받은 값을 100으로 나눠야 원/1단위가 된다. */
const EXIM_PER_100: Readonly<Record<Currency, boolean>> = { JPY: true, USD: false }

/** `'1,337.2'` → `1337.2`. 숫자로 못 읽으면 null. */
export function parseEximNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null
  if (typeof raw !== 'string') return null
  const n = Number(raw.replace(/,/g, '').trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 응답 한 줄 → **원/1단위** 환율. 엔은 100으로 나눈다.
 * 종전 코드가 `Number(jpy.deal_bas_r) / 100` 을 하던 자리를 이 함수가 대신한다.
 */
export function rateFromExim(currency: Currency, dealBasR: unknown): number | null {
  const n = parseEximNumber(dealBasR)
  if (n === null) return null
  const rate = EXIM_PER_100[currency] ? n / 100 : n
  // 소수 네 자리 — 종전 엔 환율이 저장되던 자리수와 같다(8.4821).
  return Math.round(rate * 10000) / 10000
}

/** 응답 배열에서 통화 한 줄을 집는다(모양이 다른 줄은 걸러진다). */
export function findEximRow(
  rows: unknown,
  currency: Currency,
): { cur_unit: string; deal_bas_r: unknown } | null {
  if (!Array.isArray(rows)) return null
  const want = EXIM_UNIT[currency]
  const hit = rows.find(r => r && typeof r === 'object' && (r as { cur_unit?: unknown }).cur_unit === want)
  return (hit ?? null) as { cur_unit: string; deal_bas_r: unknown } | null
}

/**
 * 응답 배열 → 통화별 환율. 못 읽은 통화는 칸이 비어 있다(부르는 쪽이 판단한다).
 * **엔을 못 읽으면 그 날짜는 쓰지 않는다** — 종전 동작과 같다(라우트가 다음 날짜로 넘어간다).
 */
export function ratesFromExim(rows: unknown): Partial<Rates> {
  const out: Partial<Rates> = {}
  for (const cur of CURRENCIES) {
    const row = findEximRow(rows, cur)
    const rate = row ? rateFromExim(cur, row.deal_bas_r) : null
    if (rate !== null) out[cur] = rate
  }
  return out
}
