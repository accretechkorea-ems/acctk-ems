// 국내조달품(row_kind = 'domestic') 줄이 **견적서에 어떻게 나가는가**.
//
// 국내에서 원화로 사 오는 물건이다 — 환율·관세를 쓰지 않는 것만 수동입력 품목과 다르다.
//
// ── 2026-10-23 바뀐 것 ──────────────────────────────────────────────────────
// 예전에는 「PDF 에 숨기고 이익 분석에만 넣는」 줄이었다(자사 부담 비용). 본사 엑셀 양식에는
// 그런 구분이 없고 국내 구매품도 일반 품목으로 들어가므로, **모든 양식에서 일반 품목처럼**
// 매출·부가세·이익에 포함한다.
//
// 가격 없이 끼워 주는 것(장비 양식의 포함사항)은 그대로다 — 묶음이 include 인 줄은
// 금액 칸이 「-」로 나가고 매출에 들지 않는다.
//
// ── 지난 자료 ───────────────────────────────────────────────────────────────
// 저장된 견적에 domestic 줄은 **한 건도 없다**(2026-10-23 확인: quote_items 211행 중 0건).
// 그래도 옛 규칙을 남겨 둔다 — 백업에 없는 견적이 있을 수 있고, 옛 PDF 가 다시 그려질 때
// 금액이 생기는 것은 되돌릴 수 없는 사고다.
//   묶음이 include          → 포함사항(금액 「-」, 매출 제외)
//   묶음 없음 + 판매단가 0  → **옛 규칙대로 숨긴다**(원가에만 잡힌다)
//   그 밖                   → 일반 품목
//
// 순수 함수만 둔다 — 하네스(scripts/quote-domestic-check.js)가 그대로 돌린다.

/** 판정에 쓰는 줄의 모양. 화면의 QuoteRow 와 저장된 quote_items 둘 다 이 모양에 맞는다. */
export type DomesticRowLike = {
  row_kind?: string | null
  group_kind?: string | null
  /** 판매단가(원). 저장된 줄에서는 unit_price_krw 다. */
  unit_price?: number | null
}

/** 견적서에서 그 줄이 하는 일. */
export type DomesticRole =
  /** 일반 품목 — 금액이 찍히고 매출·부가세·이익에 든다. */
  | 'item'
  /** 포함사항 — 금액 칸이 「-」, 매출에 들지 않는다. */
  | 'include'
  /** 옛 규칙 — 견적서에 나오지 않고 원가에만 잡힌다. */
  | 'hidden'

export const isDomesticRow = (row: DomesticRowLike | null | undefined): boolean =>
  row?.row_kind === 'domestic'

/**
 * 국내조달품 줄의 역할.
 *
 * domestic 이 아닌 줄을 넘기면 'item' 이다 — 부르는 쪽이 종류를 또 묻지 않아도 되게.
 */
export function domesticRole(row: DomesticRowLike | null | undefined): DomesticRole {
  if (!isDomesticRow(row)) return 'item'
  if (row?.group_kind === 'include') return 'include'
  // 묶음을 고른 줄(본체·옵션)은 일반 품목이다. 묶음이 **없는** 줄만 옛 규칙을 본다.
  if (row?.group_kind == null && !(row?.unit_price ?? 0)) return 'hidden'
  return 'item'
}

/** 견적서(PDF)에 줄로 나오는가. 숨는 것은 옛 규칙의 domestic 뿐이다. */
export const showsOnQuote = (row: DomesticRowLike | null | undefined): boolean =>
  domesticRole(row) !== 'hidden'

/**
 * 매출(공급가·부가세)에 더하는 줄인가.
 *
 * 포함사항과 옛 규칙 줄만 빠진다. 포함사항은 금액 칸이 「-」로 나가므로 매출에 더하면
 * 견적서와 합계가 어긋난다 — 가격을 적어 두었더라도 빼는 쪽이 맞다.
 */
export const isBillableRow = (row: DomesticRowLike | null | undefined): boolean =>
  domesticRole(row) === 'item'
