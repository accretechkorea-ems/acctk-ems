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

// 수동입력 품목의 판매가 산출 방식.
//   rate  — 목표이익률로 판매단가를 역산
//   price — 판매단가를 직접 입력하고 이익률을 계산
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
  profit_rate: number
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
  // 수동입력 품목 전용 — 판매가 산출 방식. 다른 종류는 기본값 'rate' 로 두고 쓰지 않는다.
  price_mode: PriceMode
  // 서비스비의 원가 내역(부대비용). 일반 품목은 빈 배열.
  expenses: ExpenseRow[]
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
