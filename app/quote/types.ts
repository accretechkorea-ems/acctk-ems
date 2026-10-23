// 견적서 화면·PDF 공용 타입.

export type Engineer = {
  engineer_id: number
  name: string
  position: string | null
  email: string | null
  initials: string | null
  tel: string | null
}

export type PriceItem = {
  id: number
  sheet_name: string
  item_code: string
  // 같은 종류·같은 품번을 여러 줄로 둘 때의 구분값('' = 구분 없음).
  // 값은 **가격표 엑셀의 묶음 제목**이다(「■Additional calibration documents (JCSS …)」 같은 것).
  // 같은 품번이 값이 다르게 여러 줄일 때만 채워진다(lib/priceListParse.ts 의 2-pass).
  // DB 칸은 not null default '' 지만, 가격표 2단계 **이전에 저장된 임시저장**에는 이 칸이
  // 없을 수 있다 — 읽는 쪽에서 `?? ''` 로 받는다.
  variant: string
  item_name_jp: string | null
  model_jp: string | null
  item_name_en: string | null
  model_en: string | null
  price_jpy: number | null
  cost_jpy: number | null
  delivery_time: string | null
  stock_quantity: number | null
}

export type CustomerResult = {
  customer_id: number
  company_name: string
  address: string | null
  status: string | null
}

// 품목 행 종류.
//   price_list — 가격표에서 선택한 품목(기본값). 품목 미선택 상태도 이 종류로 둔다.
//   manual_jpy — 수동입력 품목(구입가 JPY 를 직접 입력, 계산은 price_list 와 동일)
//   domestic   — 국내조달품(원화 원가만, 마진 0. 고객 PDF 금액란은 '-')
//   service    — 서비스비(견적당 1건)
//   discount   — 할인(견적당 1건). 총액에서만 빼며 품목별로 안분하지 않는다.
//                라벨('DISCOUNT' / 'SPECIAL DISCOUNT')은 itemText 에 담아 품명 칸으로 그대로 나간다.
export type RowKind = 'price_list' | 'manual_jpy' | 'domestic' | 'service' | 'discount'

// 할인 행의 라벨. 로직은 같고 견적서에 찍히는 문구만 다르다.
export const DISCOUNT_LABELS = ['DISCOUNT', 'SPECIAL DISCOUNT'] as const
export type DiscountLabel = typeof DISCOUNT_LABELS[number]

// 판매가 산출 방식. 가격표 품목·수동입력 품목이 함께 쓴다.
//   rate  — 목표이익률로 판매단가를 역산(1,000원 올림)
//   price — 판매단가를 직접 입력하고 이익률을 계산(올림 없음 — 친 값이 그대로 나가야 한다)
export type PriceMode = 'rate' | 'price'

export type QuoteRow = {
  id: string
  itemText: string
  selectedItem: PriceItem | null
  subLines: string[]
  quantity: number
  manual_unit_price: number
  tariff_rate: number
  exchange_rate: number
  // 이익률 스테퍼에 묶인 값. 이익률 모드에서는 사용자가 넣은 **목표값**이라
  // 올림된 단가로 실제 나오는 이익률과는 다르다(¥1,000·40% → 실제 42.69%).
  // 사용자가 친 값이 저절로 바뀌면 안 되므로 그대로 둔다.
  profit_rate: number
  /**
   * 사람이 이 줄의 이익률을 고쳤는가. 분류를 바꿀 때 **손대지 않은 줄만** 새 기본값으로
   * 맞추려고 둔다(고친 줄은 그대로). 저장하지 않는다 — 작성 화면에서만 쓰는 표시다.
   */
  margin_touched?: boolean
  // 올림·직접입력까지 반영된 **실현 이익률**. 화면 요약과 quote_items 저장이 이 값을 쓴다.
  // 계산 결과라 사용자가 직접 넣지 않는다(calcRow 가 매번 다시 채운다).
  realized_profit_rate: number
  unit_price: number
  supply_price: number
  tax: number
  cost_price_jpy: number
  product_price: number
  profit: number
  // 품번 — 검색창 내용을 그대로 미러링한다(가격표 선택 시 item_code, 직접 입력 시 입력값).
  // PDF 품번 칸이 이 값을 읽는다.
  partCode: string
  // 행 종류(단일 판별 필드). selectedItem 유무·is_service 조합 대신 이 값으로만 분기한다.
  row_kind: RowKind
  // 수동입력 품목 전용 — 구입가 JPY(가격표의 cost_jpy 자리). 다른 종류는 0.
  manual_cost_jpy: number
  // 수동입력 품목 전용 — **모델**(가격표의 model_jp 자리). 다른 종류는 빈 글자.
  // 20 견적서는 모델 열이 따로 있고, 가격표 품목은 그 열을 price_list.model_jp 로 채운다.
  // 직접 적은 줄은 채울 값이 없어 칸이 비어 있었다 — 그 자리를 사람이 적는다.
  // 80 양식은 모델 열이 없어 PDF 품명 뒤에 「(모델)」로 붙는다(lib/priceItemText.ts).
  // ⚠ 아직 quote_items 에 칸이 없다 — 임시저장에는 남고, 확정 저장·다시쓰기에는 남지 않는다
  //   (quote_items_model_schema.sql 의 단계 1·2 를 실행하면 그때부터 남는다).
  manual_model: string
  // 수동입력 품목 전용 — 판매가 산출 방식. 다른 종류는 기본값 'rate' 로 두고 쓰지 않는다.
  price_mode: PriceMode
  // 서비스비의 원가 내역(부대비용). 일반 품목은 빈 배열.
  expenses: ExpenseRow[]
  // 줄별 견적 분류(quote_categories.code). **null 이 기본**이고 그 뜻은 「견적 분류를 따른다」다.
  // 「분류 나누기」를 켜고 **다른 분류로 바꾼 줄만** 값이 들어간다(lib/quoteCategories.ts).
  // 매출 줄(price_list·manual_jpy·service)에만 넣는다 — domestic·discount 는 늘 null 이다.
  category: string | null
  // 장비 양식의 구성 묶음(quote_items.group_kind): base(본체+기본) / option(옵션) / include(포함사항).
  // **null 이 기본**이고 그 뜻은 「묶음 없음」이다 — PDF 에서 그룹 없이 마지막에 붙는다.
  // equip80 일 때만 화면에 선택칸이 나오고 저장된다(lib/quoteForms.ts).
  group_kind: string | null
}

// ── 부대비용(내부 관리용) ─────────────────────────────────────────────────────
// 견적 합계·원가·이익률·PDF 어디에도 반영하지 않는다. quote_expenses 에만 기록하고
// 화면에서는 자기 합계만 보여준다. unit_price 는 저장 시점 스냅샷(프리셋 값 복사본).
export type ExpensePreset = { item_name: string; unit_price: number }

export type ExpenseRow = {
  id: string
  item_name: string
  unit_price: number
  headcount: number
  days: number
  amount: number
}
