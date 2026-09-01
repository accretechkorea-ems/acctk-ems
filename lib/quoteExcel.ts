// 견적서 엑셀 내보내기 — 데이터 조회 + 시트 생성.
// 화면과 무관한 순수 로직만 둔다(버튼·선택 UI 는 다음 단계).
//
// 생성 타입(database.types.ts)이 없는 프로젝트라 반환 타입을 수동으로 선언한다.
// 컬럼명은 실제 테이블(quotes / quote_items / quote_expenses)에서 확인한 것과 일치한다.

import { createClient } from '@/lib/supabase/client'
// 타입만 가져온다(컴파일 시 사라짐). 런타임 exceljs 는 호출부에서 동적 import 한다.
import type { Workbook, Worksheet, Cell } from 'exceljs'

export type QuoteExcelItem = {
  item_id: number
  row_kind: string | null      // price_list | manual_jpy | domestic | service (과거 데이터는 null 가능)
  part_code: string | null
  product_name: string | null
  quantity: number | null
  unit_price_jpy: number | null
  unit_price_krw: number | null
  supply_amount: number | null
  tax_amount: number | null
  cost_amount: number | null
  profit_amount: number | null
  profit_rate: number | null
  exchange_rate: number | null
  tariff_rate: number | null
}

export type QuoteExcelExpense = {
  expense_id: number
  item_name: string | null
  unit_price: number | null
  headcount: number | null
  days: number | null
  amount: number | null
}

export type QuoteExcelData = {
  quote_id: number
  quote_number: string
  quote_date: string | null
  recipient: string | null
  note: string | null
  delivery_info: string | null
  status: string | null
  quote_type: string | null
  total_supply: number | null
  total_tax: number | null
  total_amount: number | null
  total_cost: number | null
  total_profit: number | null
  profit_rate: number | null
  customers: { company_name: string } | null   // customer_id 참조(직판 고객사 / 대리점 견적이면 E.U)
  dealer: { company_name: string } | null      // dealer_id 참조(대리점). 직판이면 null
  engineers: { name: string; position: string | null } | null
  quote_items: QuoteExcelItem[]
  quote_expenses: QuoteExcelExpense[]
}

// quotes 는 customers 를 두 번(customer_id · dealer_id) 참조하므로 별칭으로 어느 FK 인지 명시해야 한다.
const SELECT = `
  quote_id, quote_number, quote_date, recipient, note, delivery_info, status, quote_type,
  total_supply, total_tax, total_amount, total_cost, total_profit, profit_rate,
  customers:customer_id ( company_name ),
  dealer:dealer_id ( company_name ),
  engineers ( name, position ),
  quote_items ( item_id, row_kind, part_code, product_name, quantity,
                unit_price_jpy, unit_price_krw, supply_amount, tax_amount,
                cost_amount, profit_amount, profit_rate, exchange_rate, tariff_rate ),
  quote_expenses ( expense_id, item_name, unit_price, headcount, days, amount )
`

/**
 * 선택한 견적들의 엑셀용 전체 데이터를 한 번에 조회한다.
 * 조회 범위는 RLS 가 결정한다(화면에서 보이던 견적만 넘어온다는 전제).
 * 실패 시 throw — 호출부에서 toast 등으로 처리한다.
 */
export async function fetchQuotesForExcel(ids: number[]): Promise<QuoteExcelData[]> {
  if (ids.length === 0) return []

  const supabase = createClient()
  const { data, error } = await supabase
    .from('quotes')
    .select(SELECT)
    .in('quote_id', ids)
    .order('quote_date', { ascending: false })

  if (error) throw new Error(error.message)

  // 임베딩된 행은 순서가 보장되지 않으므로 입력 순서(id)로 고정한다.
  return ((data ?? []) as unknown as QuoteExcelData[]).map(q => ({
    ...q,
    quote_items: [...(q.quote_items ?? [])].sort((a, b) => a.item_id - b.item_id),
    quote_expenses: [...(q.quote_expenses ?? [])].sort((a, b) => a.expense_id - b.expense_id),
  }))
}

// ── 시트 생성 ────────────────────────────────────────────────────────────────
// exceljs 인스턴스는 호출부가 동적 import 해서 넘긴다(번들 증가 방지).

// 할인 표기 색 — 앱 전역의 DANGER(#dc2626) 와 같은 값.
const FF_DANGER = 'FFDC2626'
const FMT_KRW = '#,##0'
const FMT_JPY = '¥#,##0'
const FMT_RATE = '0.0"%"'
const FMT_TARIFF = '0.00'
const FMT_FX = '0.0000'

const GRAY_BG = 'FFF3F4F6'
const TITLE_BG = 'FFD9E1F2'
const LAST_COL = 10  // J (…H 공급가액 · I 이익 · J 이익률)

const fillBg = (cell: Cell, argb = GRAY_BG) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}
const borderThin = (cell: Cell) => {
  cell.border = {
    top: { style: 'thin' }, left: { style: 'thin' },
    bottom: { style: 'thin' }, right: { style: 'thin' },
  }
}
const borderTopThick = (cell: Cell) => {
  cell.border = { ...(cell.border ?? {}), top: { style: 'medium' } }
}

// 엑셀 시트명 제약: 31자, : \ / ? * [ ] 금지. 중복이면 (2), (3) … 을 붙인다.
function safeSheetName(raw: string, used: string[]): string {
  const base = (raw || '견적').replace(/[:\\/?*[\]]/g, '-').trim().slice(0, 31) || '견적'
  if (!used.includes(base)) return base
  for (let n = 2; n < 100; n++) {
    const suffix = ` (${n})`
    const candidate = base.slice(0, 31 - suffix.length) + suffix
    if (!used.includes(candidate)) return candidate
  }
  return base.slice(0, 27) + ' (99)'
}

// row_kind 가 null 이거나 모르는 값이면 (A) 블록에 넣고 품목명에 표시를 남긴다.
const KNOWN_KINDS = ['price_list', 'manual_jpy', 'domestic', 'service', 'discount']
const isUnknownKind = (k: string | null) => k === null || !KNOWN_KINDS.includes(k)

/**
 * 견적 1건을 "이익률 분석표" 시트 하나로 그린다. 생성된 시트를 반환한다.
 * 합계는 quotes 저장값이 정본이고, 블록별 "계" 는 항목 합을 그대로 보여준다.
 */
export function buildQuoteSheet(workbook: Workbook, quote: QuoteExcelData): Worksheet {
  const ws = workbook.addWorksheet(safeSheetName(quote.quote_number, workbook.worksheets.map(w => w.name)))

  ws.getColumn(1).width = 14
  ws.getColumn(2).width = 30
  ws.getColumn(3).width = 8
  for (let c = 4; c <= LAST_COL; c++) ws.getColumn(c).width = 14

  const items = quote.quote_items ?? []
  const groupA = items.filter(i => i.row_kind === 'price_list' || i.row_kind === 'manual_jpy' || isUnknownKind(i.row_kind))
  const groupB = items.filter(i => i.row_kind === 'domestic')
  const serviceItem = items.find(i => i.row_kind === 'service') ?? null
  const discountItem = items.find(i => i.row_kind === 'discount') ?? null
  const expenses = quote.quote_expenses ?? []

  // 환율은 행별 컬럼이라 값이 갈리면 대표값을 쓰지 않는다.
  const rates = [...new Set(items.map(i => i.exchange_rate).filter((v): v is number => typeof v === 'number' && v > 0))]

  let r = 1
  const sectionRow = (label: string) => {
    ws.mergeCells(r, 1, r, LAST_COL)
    const cell = ws.getCell(r, 1)
    cell.value = label
    cell.font = { bold: true, size: 11 }
    for (let c = 1; c <= LAST_COL; c++) { fillBg(ws.getCell(r, c)); borderThin(ws.getCell(r, c)) }
    r++
  }
  const headerRow = (labels: (string | null)[]) => {
    labels.forEach((label, idx) => {
      if (label === null) return
      const cell = ws.getCell(r, idx + 1)
      cell.value = label
      cell.font = { bold: true, size: 10 }
      cell.alignment = { horizontal: 'center' }
      fillBg(cell)
      borderThin(cell)
    })
    r++
  }
  const labelValue = (col: number, label: string, value: string | number | null) => {
    const l = ws.getCell(r, col)
    l.value = label
    l.font = { bold: true, size: 10 }
    ws.getCell(r, col + 1).value = value
  }

  // ── 제목 ──
  ws.mergeCells(r, 1, r, LAST_COL)
  const title = ws.getCell(r, 1)
  title.value = '이익률 분석표'
  title.font = { bold: true, size: 14 }
  title.alignment = { horizontal: 'center' }
  for (let c = 1; c <= LAST_COL; c++) fillBg(ws.getCell(r, c), TITLE_BG)
  r++

  ws.mergeCells(r, 1, r, LAST_COL)
  const notice = ws.getCell(r, 1)
  notice.value = '※ 대외비 — 원가 및 이익 정보 포함'
  notice.font = { size: 9, color: { argb: 'FF6B7280' } }
  notice.alignment = { horizontal: 'center' }
  r += 2

  // ── 기본 정보 (좌: A/B, 우: E/F) ──
  const fxLabel = rates.length === 0 ? '-' : rates.length > 1 ? '행별 상이' : rates[0]
  const info: [string, string | number | null, string, string | number | null][] = [
    ['견적번호', quote.quote_number, '환율적용월', (quote.quote_date ?? '').slice(0, 7) || '-'],
    ['고객사', quote.customers?.company_name ?? '-', '엔화 환율', fxLabel],
    ['작성자', [quote.engineers?.name, quote.engineers?.position].filter(Boolean).join(' ') || '-', '대리점', quote.dealer?.company_name ?? '(직판)'],
    ['견적일자', quote.quote_date ?? '-', '상태', quote.status ?? '-'],
  ]
  for (const [l1, v1, l2, v2] of info) {
    labelValue(1, l1, v1)
    labelValue(5, l2, v2)
    if (typeof v2 === 'number') ws.getCell(r, 6).numFmt = FMT_FX
    r++
  }
  r++

  // ── (A) 본사 구입가 ──
  sectionRow('(A) 본사 구입가')
  headerRow(['품번', '품목명', '수량', '구입가(JPY)', '관세율', '원화환산', '판매단가', '공급가액', '이익', '이익률'])
  let sumACost = 0, sumASupply = 0, sumAProfit = 0
  for (const it of groupA) {
    ws.getCell(r, 1).value = it.part_code ?? '-'
    ws.getCell(r, 2).value = (it.product_name ?? '') + (isUnknownKind(it.row_kind) ? ' (종류 미상)' : '')
    ws.getCell(r, 3).value = it.quantity ?? 0
    ws.getCell(r, 4).value = it.unit_price_jpy ?? null
    ws.getCell(r, 4).numFmt = FMT_JPY
    ws.getCell(r, 5).value = it.tariff_rate ?? null
    ws.getCell(r, 5).numFmt = FMT_TARIFF
    ws.getCell(r, 6).value = it.cost_amount ?? 0
    ws.getCell(r, 7).value = it.unit_price_krw ?? 0
    ws.getCell(r, 8).value = it.supply_amount ?? 0
    ws.getCell(r, 9).value = it.profit_amount ?? 0
    ws.getCell(r, 10).value = it.profit_rate ?? 0
    ws.getCell(r, 10).numFmt = FMT_RATE
    for (const c of [6, 7, 8, 9]) ws.getCell(r, c).numFmt = FMT_KRW
    for (let c = 1; c <= LAST_COL; c++) borderThin(ws.getCell(r, c))
    sumACost += it.cost_amount ?? 0
    sumASupply += it.supply_amount ?? 0
    sumAProfit += it.profit_amount ?? 0
    r++
  }
  ws.getCell(r, 1).value = '계'
  ws.getCell(r, 1).font = { bold: true }
  ws.getCell(r, 6).value = sumACost
  ws.getCell(r, 8).value = sumASupply
  ws.getCell(r, 9).value = sumAProfit
  for (const c of [6, 8, 9]) { ws.getCell(r, c).numFmt = FMT_KRW; ws.getCell(r, c).font = { bold: true } }
  for (let c = 1; c <= LAST_COL; c++) borderTopThick(ws.getCell(r, c))
  r++

  // ── 할인 — (A) 계 바로 아래 한 줄. 총액에서만 빼는 항목이라 원가·이익률 칸은 비운다.
  //    이익 칸에는 줄어든 금액(음수)을 그대로 적는다 — 총계의 순이익과 이어지도록.
  if (discountItem) {
    ws.getCell(r, 1).value = '-'
    ws.getCell(r, 2).value = discountItem.product_name ?? 'DISCOUNT'
    ws.getCell(r, 2).font = { bold: true }
    ws.getCell(r, 8).value = discountItem.supply_amount ?? 0
    ws.getCell(r, 9).value = discountItem.profit_amount ?? 0
    for (const c of [8, 9]) { ws.getCell(r, c).numFmt = FMT_KRW; ws.getCell(r, c).font = { bold: true, color: { argb: FF_DANGER } } }
    for (let c = 1; c <= LAST_COL; c++) borderThin(ws.getCell(r, c))
    r++
  }
  r++

  // ── (B) 국내조달품 (해당 행이 없으면 블록 자체를 생략) ──
  if (groupB.length > 0) {
    sectionRow('(B) 국내조달품')
    headerRow(['품번', '품목명', '수량', null, null, null, null, '금액'])
    let sumBCost = 0
    for (const it of groupB) {
      ws.getCell(r, 1).value = it.part_code ?? '-'
      ws.getCell(r, 2).value = it.product_name ?? ''
      ws.getCell(r, 3).value = it.quantity ?? 0
      ws.getCell(r, 8).value = it.cost_amount ?? 0
      ws.getCell(r, 8).numFmt = FMT_KRW
      for (let c = 1; c <= LAST_COL; c++) borderThin(ws.getCell(r, c))
      sumBCost += it.cost_amount ?? 0
      r++
    }
    ws.getCell(r, 1).value = '계'
    ws.getCell(r, 1).font = { bold: true }
    ws.getCell(r, 8).value = sumBCost
    ws.getCell(r, 8).numFmt = FMT_KRW
    ws.getCell(r, 8).font = { bold: true }
    for (let c = 1; c <= LAST_COL; c++) borderTopThick(ws.getCell(r, c))
    r += 2
  }

  // ── 서비스비 (서비스 행도 부대비용도 없으면 블록 생략) ──
  if (serviceItem || expenses.length > 0) {
    sectionRow('서비스비')
    headerRow(['항목', null, '단가', '인원', '일수', null, null, '금액'])
    let sumExpense = 0
    for (const e of expenses) {
      ws.mergeCells(r, 1, r, 2)
      ws.getCell(r, 1).value = e.item_name ?? ''
      ws.getCell(r, 3).value = e.unit_price ?? 0
      ws.getCell(r, 3).numFmt = FMT_KRW
      ws.getCell(r, 4).value = e.headcount ?? 0
      ws.getCell(r, 5).value = e.days ?? 0
      ws.getCell(r, 8).value = e.amount ?? 0
      ws.getCell(r, 8).numFmt = FMT_KRW
      for (let c = 1; c <= LAST_COL; c++) borderThin(ws.getCell(r, c))
      sumExpense += e.amount ?? 0
      r++
    }
    ws.getCell(r, 1).value = '계'
    ws.getCell(r, 1).font = { bold: true }
    ws.getCell(r, 8).value = sumExpense
    ws.getCell(r, 8).numFmt = FMT_KRW
    ws.getCell(r, 8).font = { bold: true }
    for (let c = 1; c <= LAST_COL; c++) borderTopThick(ws.getCell(r, c))
    r++
    ws.getCell(r, 1).value = '서비스 공급가'
    ws.getCell(r, 1).font = { bold: true }
    ws.getCell(r, 8).value = serviceItem?.supply_amount ?? 0
    ws.getCell(r, 8).numFmt = FMT_KRW
    r += 2
  }

  // ── 총계 (정본 = quotes 저장값) ──
  sectionRow('총계')
  const totalRow = (label: string, value: number | null) => {
    ws.mergeCells(r, 1, r, 7)
    const l = ws.getCell(r, 1)
    l.value = label
    l.font = { bold: true, size: 11 }
    const v = ws.getCell(r, 8)
    v.value = value ?? 0
    v.numFmt = FMT_KRW
    v.font = { size: 11 }
    for (let c = 1; c <= LAST_COL; c++) borderThin(ws.getCell(r, c))
    r++
  }
  totalRow('(A+B+서비스) 총 구입가', quote.total_cost)
  totalRow('견적 제출가', quote.total_supply)
  totalRow('부가세', quote.total_tax)
  totalRow('총액', quote.total_amount)

  ws.mergeCells(r, 1, r, 7)
  ws.getCell(r, 1).value = '최종 이윤'
  ws.getCell(r, 1).font = { bold: true, size: 11 }
  ws.getCell(r, 8).value = quote.total_profit ?? 0
  ws.getCell(r, 8).numFmt = FMT_KRW
  ws.getCell(r, 8).font = { bold: true, size: 11 }
  ws.getCell(r, 9).value = '이익률'
  ws.getCell(r, 9).font = { bold: true, size: 10 }
  ws.getCell(r, 9).alignment = { horizontal: 'right' }
  ws.getCell(r, 10).value = quote.profit_rate ?? 0
  ws.getCell(r, 10).numFmt = FMT_RATE
  ws.getCell(r, 10).font = { bold: true }
  for (let c = 1; c <= LAST_COL; c++) borderThin(ws.getCell(r, c))

  return ws
}
