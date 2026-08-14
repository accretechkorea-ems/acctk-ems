// 견적서 계산 로직(순수 함수). 화면·PDF·저장이 모두 이 파일의 결과를 쓴다.

import type { QuoteRow, ExpenseRow } from './types'

export function calcRow(row: QuoteRow, rate: number): QuoteRow {
  const exRate = rate || row.exchange_rate
  // 서비스비 — 공급가는 직접 입력, 원가는 부대비용 내역의 합. 수량은 1 고정.
  if (row.row_kind === 'service') {
    const unitPrice = row.manual_unit_price
    const supplyPrice = unitPrice
    const tax = Math.round(supplyPrice * 0.1)
    const productPrice = row.expenses.reduce((s, e) => s + e.amount, 0)
    const profit = supplyPrice - productPrice
    return {
      ...row, exchange_rate: exRate, quantity: 1,
      cost_price_jpy: 0, unit_price: unitPrice,
      supply_price: supplyPrice, tax,
      product_price: productPrice, profit,
      profit_rate: supplyPrice > 0 ? (profit / supplyPrice) * 100 : 0,
    }
  }
  // 국내조달품 — 원화 원가를 그대로 공급가로 쓴다(마진 0). 환율·관세는 쓰지 않는다.
  // 입력값은 manual_unit_price 를 재사용한다(= 사용자가 직접 넣는 원화 금액).
  if (row.row_kind === 'domestic') {
    const unitPrice = row.manual_unit_price
    const supplyPrice = unitPrice * row.quantity
    return {
      ...row, exchange_rate: exRate,
      cost_price_jpy: 0, unit_price: unitPrice,
      // 고객에게 청구하지 않는 자사 부담 비용 — 부가세도 발생하지 않는다.
      supply_price: supplyPrice, tax: 0,
      product_price: unitPrice * row.quantity,
      profit: 0, profit_rate: 0,
    }
  }
  // 수동입력 품목 — 구입가 JPY 만 사용자가 직접 넣고, 계산은 가격표 품목 분기와 동일하다.
  // 판매가 모드가 'price' 면 판매단가를 그대로 쓰고(올림 없음) 이익률을 역산한다.
  // 구입가·환율이 비어 있어도 이 분기에서 처리한다(구입가 0 → 원가 0). 갈 곳이 따로 없다.
  if (row.row_kind === 'manual_jpy') {
    const costJpy = row.manual_cost_jpy
    const rawUnit = (costJpy * exRate * row.tariff_rate) / (1 - row.profit_rate / 100)
    const unitPrice = row.price_mode === 'price'
      ? row.manual_unit_price
      : Math.ceil(rawUnit / 1000) * 1000
    const supplyPrice = unitPrice * row.quantity
    const tax = Math.round(supplyPrice * 0.1)
    const productPrice = Math.round(costJpy * exRate * row.tariff_rate * row.quantity)
    const profit = supplyPrice - productPrice
    return {
      ...row, exchange_rate: exRate,
      cost_price_jpy: costJpy, unit_price: unitPrice,
      supply_price: supplyPrice, tax,
      product_price: productPrice, profit,
      profit_rate: row.price_mode === 'price'
        ? (supplyPrice > 0 ? (profit / supplyPrice) * 100 : 0)
        : row.profit_rate,
    }
  }
  if (row.row_kind === 'price_list' && row.selectedItem?.cost_jpy && exRate) {
    const costJpy = row.selectedItem.cost_jpy
    const rawUnit = (costJpy * exRate * row.tariff_rate) / (1 - row.profit_rate / 100)
    const unitPrice = Math.ceil(rawUnit / 1000) * 1000
    const supplyPrice = unitPrice * row.quantity
    const tax = Math.round(supplyPrice * 0.1)
    const productPrice = Math.round(costJpy * exRate * row.tariff_rate * row.quantity)
    return {
      ...row, exchange_rate: exRate,
      cost_price_jpy: costJpy, unit_price: unitPrice,
      supply_price: supplyPrice, tax,
      product_price: productPrice, profit: supplyPrice - productPrice,
    }
  }
  // 가격표 품목인데 아직 품목을 고르지 않았거나(구입가·환율 없음) 계산할 근거가 없는 상태.
  // 금액을 만들어내지 않고 전부 0 으로 둔다 — 합계·PDF·저장(공급가 0 필터) 어디에도 잡히지 않는다.
  return {
    ...row, exchange_rate: exRate,
    cost_price_jpy: 0, unit_price: 0,
    supply_price: 0, tax: 0,
    product_price: 0, profit: 0,
  }
}

export function createRow(): QuoteRow {
  return {
    id: Math.random().toString(36).slice(2),
    itemText: '', selectedItem: null, subLines: [],
    quantity: 1, manual_unit_price: 0,
    tariff_rate: 1.13, exchange_rate: 0, profit_rate: 40,
    unit_price: 0, supply_price: 0, tax: 0,
    cost_price_jpy: 0, product_price: 0, profit: 0,
    partCode: '', row_kind: 'price_list', manual_cost_jpy: 0, price_mode: 'rate', expenses: [],
  }
}

// 수동입력 품목 행 — 가격표에 없는 제품용. 구입가 JPY 를 직접 입력받는다.
// 관세율·이익률 기본값은 createRow() 와 동일(1.13 / 40).
export function createManualJpyRow(): QuoteRow {
  return { ...createRow(), row_kind: 'manual_jpy' }
}

// 국내조달품 행 — 원화 원가만 입력한다. 마진이 없으므로 이익률은 0 에서 시작한다.
export function createDomesticRow(): QuoteRow {
  return { ...createRow(), row_kind: 'domestic', profit_rate: 0 }
}

// 서비스비 행 — 품명 기본값 '서비스비'(사용자 수정 가능, PDF 에 그대로 나감).
// 이익률은 계산 결과이므로 일반 품목의 기본값(40) 대신 0 에서 시작한다.
export function createServiceRow(): QuoteRow {
  return { ...createRow(), row_kind: 'service', itemText: '서비스비', profit_rate: 0 }
}

// 단가 × 인원 × 일수. 세 값 중 하나라도 바뀌면 이 함수를 통과시켜 재계산한다.
export function calcExpense(e: ExpenseRow): ExpenseRow {
  return { ...e, amount: e.unit_price * e.headcount * e.days }
}

export function createExpenseRow(): ExpenseRow {
  return {
    id: Math.random().toString(36).slice(2),
    item_name: '', unit_price: 0, headcount: 1, days: 1, amount: 0,
  }
}

// 합계 — 화면 상단 · ProfitPanel · PDF 미리보기 · PDF 다운로드가 모두 이 함수를 쓴다.
// (통합 전 4곳의 계산식이 문자 단위로 동일함을 확인한 뒤 하나로 합친 것)
export function calcTotals(rows: QuoteRow[]) {
  // 국내조달품은 고객에게 청구하지 않는 자사 부담 비용이다.
  // 매출(공급가·부가세)에서는 빼고 원가에만 반영해 순이익을 깎는다.
  const billable = rows.filter(r => r.row_kind !== 'domestic')
  const totalSupply = billable.reduce((s, r) => s + r.supply_price, 0)
  const totalTax = billable.reduce((s, r) => s + r.tax, 0)
  const totalAmount = totalSupply + totalTax
  const totalCost = rows.reduce((s, r) => s + r.product_price, 0)
  // 행별 이익의 합이 아니라 매출 − 원가로 정의한다.
  // 기존 4개 분기는 모두 row.profit === supply_price − product_price 라 값이 달라지지 않는다.
  const totalProfit = totalSupply - totalCost
  const totalProfitRate = totalSupply > 0 ? (totalProfit / totalSupply) * 100 : 0
  // 국내조달품이 원가를 얼마나 밀어올렸는지 화면에 보여주기 위한 값(합계 계산에는 관여하지 않는다).
  const domesticCost = rows.filter(r => r.row_kind === 'domestic').reduce((s, r) => s + r.product_price, 0)
  return { totalSupply, totalTax, totalAmount, totalCost, totalProfit, totalProfitRate, domesticCost }
}
