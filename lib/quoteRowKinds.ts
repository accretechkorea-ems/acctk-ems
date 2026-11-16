// 견적 품목 줄 **종류의 이름** — 화면이 쓰는 글자를 한 곳에 둔다.
//
// ── 왜 한 곳인가 ────────────────────────────────────────────────────────────
//   같은 종류를 부르는 이름이 화면마다 달랐다. 추가 버튼은 「+ 수동입력」, 줄 머리의 배지는
//   「수동 입력」, 설명서는 「수동입력 품목」이었다. 사람이 「어느 것이 그것인가」를 매번
//   맞춰 봐야 했고, 이름을 고치면 세 곳을 함께 고쳐야 했다(그래서 늘 한 곳이 뒤처졌다).
//
// ── 여기 있는 것은 **화면 글자뿐이다** ──────────────────────────────────────
//   DB(quote_items.row_kind)에 들어가는 값과 **고객 견적서 PDF 에 찍히는 글자**는 이 표와
//   무관하다. 그 둘은 지난 견적을 다시 그릴 때도 같아야 해서 바꾸지 않는다 —
//   예를 들어 'domestic' 줄을 화면에서는 「국내 구매」라고 부르지만, 저장값은 그대로
//   'domestic' 이고 설명서·PDF 쪽 문구(「국내조달품」)도 그대로 둔다.

import type { RowKind } from '@/app/quote/types'

/** 줄 머리 배지·목록에 쓰는 짧은 이름. */
export const ROW_KIND_LABEL: Record<RowKind, string> = {
  price_list: '가격표',
  manual_jpy: '직접 입력',
  domestic: '국내 구매',
  service: '서비스비',
  discount: '할인',
  title: '제목줄',
}

// 추가 버튼은 이 이름 앞에 「+ 」를 붙여 쓴다(components/quote/RowAddButtons.tsx).
// 「+ 」 다섯 개가 50px 쯤을 먹어 한동안 걷어 두었다가, 버튼 좌우 여백을 4 로 줄여
// 되돌렸다 — 340px 에서도 한 줄이다(실측). 버튼과 배지가 **같은 글자**를 쓰는 것은
// 그대로다 — 둘 다 아래 ROW_KIND_LABEL 을 읽는다.

/** 추가 버튼의 설명(마우스를 얹으면 나온다). 무엇에 쓰는 줄인지 한 문장. */
export const ROW_KIND_HINT: Record<RowKind, string> = {
  price_list: '본사·거래 가격표에서 품목을 찾아 넣습니다',
  manual_jpy: '가격표에 없는 품목을 구입가 직접 입력으로 넣습니다',
  domestic: '국내에서 사서 우리가 부담하는 항목(원화 원가만, 마진 없음)',
  service: '설치·교육처럼 인건비가 원가인 항목(견적당 1건)',
  discount: '총액에서 빼는 할인 줄(견적당 1건)',
  title: '견적서 표에 가로로 걸치는 제목 한 줄(금액 없음)',
}

/** 추가 버튼을 세우는 순서. 왼쪽이 가장 자주 쓰는 것이다. */
export const ROW_KIND_ORDER: readonly RowKind[] = [
  'price_list', 'manual_jpy', 'domestic', 'service', 'discount', 'title',
]

/**
 * 금액이 없는 **글자 줄**인가 — 제목줄.
 *
 * 합계·순번·엑셀·결재 검토표가 이 판정 하나로 그 줄을 비켜 간다. 종류 글자를 여기저기
 * 적지 않으려고 함수로 둔다(저장된 줄은 문자열이라 RowKind 로 좁혀지지 않는다).
 */
export const isTitleRowKind = (rowKind: string | null | undefined): boolean => rowKind === 'title'

/**
 * 화면·견적서에 찍는 **품목 순번**. 제목줄은 번호를 먹지 않고 null 을 받는다.
 *
 *   [가격표, 제목줄, 가격표, 할인]  →  [1, null, 2, 3]
 *
 * 순수 함수다(하네스가 그대로 돌린다 — scripts/quote-title-check.js). 줄의 모양을 묻지
 * 않고 종류만 본다 — 화면의 QuoteRow 와 저장된 quote_items 둘 다 그대로 넘길 수 있다.
 */
export function itemNumbers(rows: readonly { row_kind?: string | null }[]): (number | null)[] {
  let n = 0
  return rows.map(r => (isTitleRowKind(r.row_kind) ? null : ++n))
}
