// 견적서 엑셀 내보내기 — 데이터 조회 + 시트 생성.
// 화면과 무관한 순수 로직만 둔다(버튼·선택 UI 는 다음 단계).
//
// 생성 타입(database.types.ts)이 없는 프로젝트라 반환 타입을 수동으로 선언한다.
// 컬럼명은 실제 테이블(quotes / quote_items / quote_expenses)에서 확인한 것과 일치한다.

import { createClient } from '@/lib/supabase/client'
import { salesStatusLabel } from '@/lib/categoryColors'
import { profitBreakdownOfLines } from '@/lib/quoteProfit'
import { toCurrency, type Currency } from '@/lib/quoteCurrency'
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
  /** 그 줄의 통화(quote_items.currency). 없으면 엔 — 통화 칸이 생기기 전 견적이다. */
  currency: string | null
  /** 그 줄의 분류. 비면 견적 분류를 따른다 — 판관비 안분이 이 값을 본다. */
  category: string | null
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
  /** 견적 분류 — 판관비 규칙(TSE 30%)을 가린다. */
  category: string | null
  total_profit: number | null
  profit_rate: number | null
  customers: { company_name: string } | null   // customer_id 참조(직판 고객사 / 대리점 견적이면 E.U)
  dealer: { company_name: string } | null      // dealer_id 참조(대리점). 직판이면 null
  engineers: { name: string; position: string | null } | null
  quote_items: QuoteExcelItem[]
  quote_expenses: QuoteExcelExpense[]
}

// quotes 는 customers 를 두 번(customer_id · dealer_id), engineers 를 두 번
// (engineer_id · created_by) 참조하므로 어느 FK 인지 명시해야 한다.
// 지정하지 않으면 PGRST201(300 Multiple Choices)로 조회 전체가 실패한다.
// 여기의 사람 이름은 실적 귀속자(engineer_id)다.
const SELECT = `
  quote_id, quote_number, quote_date, recipient, note, delivery_info, status, quote_type, category,
  total_supply, total_tax, total_amount, total_cost, total_profit, profit_rate,
  customers:customer_id ( company_name ),
  dealer:dealer_id ( company_name ),
  engineers!quotes_engineer_id_fkey ( name, position ),
  quote_items ( item_id, row_kind, part_code, product_name, quantity,
                unit_price_jpy, unit_price_krw, supply_amount, tax_amount,
                cost_amount, profit_amount, profit_rate, exchange_rate, tariff_rate,
                currency, category ),
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
const FMT_USD = '$#,##0'
/** 그 줄의 통화에 맞는 숫자 형식 — 엑셀에서도 기호가 금액에 붙어 나간다. */
const fmtOf = (currency: string | null | undefined) => (toCurrency(currency) === 'USD' ? FMT_USD : FMT_JPY)
const FMT_RATE = '0.0"%"'
const FMT_TARIFF = '0.00'
const FMT_FX = '0.0000'

const GRAY_BG = 'FFF3F4F6'
const TITLE_BG = 'FFD9E1F2'

/**
 * 열 번호 — **이름으로 쓴다.** 2026-11-03 에 「통화」 열이 품목명 뒤에 끼어들면서 뒤의 열이
 * 전부 한 칸씩 밀렸다. 숫자를 그대로 적어 두면 그런 변경 때마다 스무 군데를 함께 고쳐야 하고,
 * 한 군데를 놓치면 금액이 엉뚱한 칸에 적힌다(조용히 틀린다).
 */
const COL = {
  code: 1,      // 품번
  name: 2,      // 품목명
  qty: 3,       // 수량
  currency: 4,  // 통화 — 구입가가 어느 돈인가(JPY/USD)
  costFx: 5,    // 구입가(그 통화)
  tariff: 6,    // 관세율
  costKrw: 7,   // 원화환산
  unit: 8,      // 판매단가
  supply: 9,    // 공급가액
  profit: 10,   // 이익
  rate: 11,     // 이익률
} as const
const LAST_COL = COL.rate
/** 합계 줄 — 라벨을 여기까지 합치고 금액은 공급가액 칸에 적는다. */
const TOTAL_LABEL_END = COL.unit

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

  ws.getColumn(COL.code).width = 14
  ws.getColumn(COL.name).width = 30
  ws.getColumn(COL.qty).width = 8
  ws.getColumn(COL.currency).width = 7
  for (let c = COL.costFx; c <= LAST_COL; c++) ws.getColumn(c).width = 14

  const items = quote.quote_items ?? []
  const groupA = items.filter(i => i.row_kind === 'price_list' || i.row_kind === 'manual_jpy' || isUnknownKind(i.row_kind))
  const groupB = items.filter(i => i.row_kind === 'domestic')
  const serviceItem = items.find(i => i.row_kind === 'service') ?? null
  const discountItem = items.find(i => i.row_kind === 'discount') ?? null
  const expenses = quote.quote_expenses ?? []

  // 환율은 행별 칸이라 값이 갈리면 대표값을 쓰지 않는다. **통화별로** 모은다 —
  // 엔 줄과 달러 줄이 섞인 견적에서 둘을 한 칸에 담으면 「행별 상이」만 남아 쓸모가 없다.
  const ratesOf = (currency: Currency) => [...new Set(
    items
      .filter(i => toCurrency(i.currency) === currency)
      .map(i => i.exchange_rate)
      .filter((v): v is number => typeof v === 'number' && v > 0),
  )]
  const rates = ratesOf('JPY')
  const usdRates = ratesOf('USD')

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
  const fxLabelOf = (list: number[]) => (list.length === 0 ? '-' : list.length > 1 ? '행별 상이' : list[0])
  const fxLabel = fxLabelOf(rates)
  const info: [string, string | number | null, string, string | number | null][] = [
    ['견적번호', quote.quote_number, '환율적용월', (quote.quote_date ?? '').slice(0, 7) || '-'],
    ['고객사', quote.customers?.company_name ?? '-', '엔화 환율', fxLabel],
    // 이 이름은 실적 귀속자(quotes.engineer_id)다. 대필이면 쓴 사람과 다르므로 「작성자」가 아니라 「담당자」다.
    // 다른 화면(실적 현황·발주관리·유지보수·고객사 상세)도 같은 값을 「담당자」로 부른다.
    ['담당자', [quote.engineers?.name, quote.engineers?.position].filter(Boolean).join(' ') || '-', '대리점', quote.dealer?.company_name ?? '(직판)'],
    // 상태는 저장값이 아니라 화면과 같은 표시 이름으로 적는다('실패' → 「미수주」).
    ['견적일자', quote.quote_date ?? '-', '상태', quote.status ? salesStatusLabel(quote.status) : '-'],
  ]
  // 달러 줄이 섞인 견적에만 한 줄 더 — 엔만 쓰는 견적의 모양은 그대로다.
  if (usdRates.length > 0) info.push(['', null, '달러 환율', fxLabelOf(usdRates)])
  for (const [l1, v1, l2, v2] of info) {
    if (l1) labelValue(1, l1, v1)
    labelValue(5, l2, v2)
    if (typeof v2 === 'number') ws.getCell(r, 6).numFmt = FMT_FX
    r++
  }
  r++

  // ── (A) 본사 구입가 ──
  sectionRow('(A) 본사 구입가')
  // 「구입가(JPY)」가 아니라 **통화 열 + 구입가**다 — 달러 매입 품목이 섞이기 때문이다.
  headerRow(['품번', '품목명', '수량', '통화', '구입가', '관세율', '원화환산', '판매단가', '공급가액', '이익', '이익률'])
  let sumACost = 0, sumASupply = 0, sumAProfit = 0
  for (const it of groupA) {
    const cur = toCurrency(it.currency)
    ws.getCell(r, COL.code).value = it.part_code ?? '-'
    ws.getCell(r, COL.name).value = (it.product_name ?? '') + (isUnknownKind(it.row_kind) ? ' (종류 미상)' : '')
    ws.getCell(r, COL.qty).value = it.quantity ?? 0
    ws.getCell(r, COL.currency).value = cur
    ws.getCell(r, COL.currency).alignment = { horizontal: 'center' }
    ws.getCell(r, COL.costFx).value = it.unit_price_jpy ?? null
    ws.getCell(r, COL.costFx).numFmt = fmtOf(it.currency)
    ws.getCell(r, COL.tariff).value = it.tariff_rate ?? null
    ws.getCell(r, COL.tariff).numFmt = FMT_TARIFF
    ws.getCell(r, COL.costKrw).value = it.cost_amount ?? 0
    ws.getCell(r, COL.unit).value = it.unit_price_krw ?? 0
    ws.getCell(r, COL.supply).value = it.supply_amount ?? 0
    ws.getCell(r, COL.profit).value = it.profit_amount ?? 0
    ws.getCell(r, COL.rate).value = it.profit_rate ?? 0
    ws.getCell(r, COL.rate).numFmt = FMT_RATE
    for (const c of [COL.costKrw, COL.unit, COL.supply, COL.profit]) ws.getCell(r, c).numFmt = FMT_KRW
    for (let c = 1; c <= LAST_COL; c++) borderThin(ws.getCell(r, c))
    sumACost += it.cost_amount ?? 0
    sumASupply += it.supply_amount ?? 0
    sumAProfit += it.profit_amount ?? 0
    r++
  }
  ws.getCell(r, COL.code).value = '계'
  ws.getCell(r, COL.code).font = { bold: true }
  ws.getCell(r, COL.costKrw).value = sumACost
  ws.getCell(r, COL.supply).value = sumASupply
  ws.getCell(r, COL.profit).value = sumAProfit
  for (const c of [COL.costKrw, COL.supply, COL.profit]) { ws.getCell(r, c).numFmt = FMT_KRW; ws.getCell(r, c).font = { bold: true } }
  for (let c = 1; c <= LAST_COL; c++) borderTopThick(ws.getCell(r, c))
  r++

  // ── 할인 — (A) 계 바로 아래 한 줄. 총액에서만 빼는 항목이라 원가·이익률 칸은 비운다.
  //    이익 칸에는 줄어든 금액(음수)을 그대로 적는다 — 총계의 순이익과 이어지도록.
  if (discountItem) {
    ws.getCell(r, COL.code).value = '-'
    ws.getCell(r, COL.name).value = discountItem.product_name ?? 'DISCOUNT'
    ws.getCell(r, COL.name).font = { bold: true }
    ws.getCell(r, COL.supply).value = discountItem.supply_amount ?? 0
    ws.getCell(r, COL.profit).value = discountItem.profit_amount ?? 0
    for (const c of [COL.supply, COL.profit]) { ws.getCell(r, c).numFmt = FMT_KRW; ws.getCell(r, c).font = { bold: true, color: { argb: FF_DANGER } } }
    for (let c = 1; c <= LAST_COL; c++) borderThin(ws.getCell(r, c))
    r++
  }
  r++

  // ── (B) 국내조달품 (해당 행이 없으면 블록 자체를 생략) ──
  if (groupB.length > 0) {
    sectionRow('(B) 국내조달품')
    headerRow(['품번', '품목명', '수량', null, null, null, null, null, '금액'])
    let sumBCost = 0
    for (const it of groupB) {
      ws.getCell(r, COL.code).value = it.part_code ?? '-'
      ws.getCell(r, COL.name).value = it.product_name ?? ''
      ws.getCell(r, COL.qty).value = it.quantity ?? 0
      ws.getCell(r, COL.supply).value = it.cost_amount ?? 0
      ws.getCell(r, COL.supply).numFmt = FMT_KRW
      for (let c = 1; c <= LAST_COL; c++) borderThin(ws.getCell(r, c))
      sumBCost += it.cost_amount ?? 0
      r++
    }
    ws.getCell(r, COL.code).value = '계'
    ws.getCell(r, COL.code).font = { bold: true }
    ws.getCell(r, COL.supply).value = sumBCost
    ws.getCell(r, COL.supply).numFmt = FMT_KRW
    ws.getCell(r, COL.supply).font = { bold: true }
    for (let c = 1; c <= LAST_COL; c++) borderTopThick(ws.getCell(r, c))
    r += 2
  }

  // ── 서비스비 (서비스 행도 부대비용도 없으면 블록 생략) ──
  if (serviceItem || expenses.length > 0) {
    sectionRow('서비스비')
    headerRow(['항목', null, '단가', '인원', '일수', null, null, null, '금액'])
    let sumExpense = 0
    for (const e of expenses) {
      ws.mergeCells(r, COL.code, r, COL.name)
      ws.getCell(r, COL.code).value = e.item_name ?? ''
      ws.getCell(r, COL.qty).value = e.unit_price ?? 0
      ws.getCell(r, COL.qty).numFmt = FMT_KRW
      ws.getCell(r, COL.currency).value = e.headcount ?? 0
      ws.getCell(r, COL.costFx).value = e.days ?? 0
      ws.getCell(r, COL.supply).value = e.amount ?? 0
      ws.getCell(r, COL.supply).numFmt = FMT_KRW
      for (let c = 1; c <= LAST_COL; c++) borderThin(ws.getCell(r, c))
      sumExpense += e.amount ?? 0
      r++
    }
    ws.getCell(r, COL.code).value = '계'
    ws.getCell(r, COL.code).font = { bold: true }
    ws.getCell(r, COL.supply).value = sumExpense
    ws.getCell(r, COL.supply).numFmt = FMT_KRW
    ws.getCell(r, COL.supply).font = { bold: true }
    for (let c = 1; c <= LAST_COL; c++) borderTopThick(ws.getCell(r, c))
    r++
    ws.getCell(r, COL.code).value = '서비스 공급가'
    ws.getCell(r, COL.code).font = { bold: true }
    ws.getCell(r, COL.supply).value = serviceItem?.supply_amount ?? 0
    ws.getCell(r, COL.supply).numFmt = FMT_KRW
    r += 2
  }

  // ── 총계 (정본 = quotes 저장값) ──
  sectionRow('총계')
  const totalRow = (label: string, value: number | null) => {
    ws.mergeCells(r, 1, r, TOTAL_LABEL_END)
    const l = ws.getCell(r, 1)
    l.value = label
    l.font = { bold: true, size: 11 }
    const v = ws.getCell(r, COL.supply)
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

  ws.mergeCells(r, 1, r, TOTAL_LABEL_END)
  ws.getCell(r, 1).value = '최종 이윤'
  ws.getCell(r, 1).font = { bold: true, size: 11 }
  ws.getCell(r, COL.supply).value = quote.total_profit ?? 0
  ws.getCell(r, COL.supply).numFmt = FMT_KRW
  ws.getCell(r, COL.supply).font = { bold: true, size: 11 }
  ws.getCell(r, COL.profit).value = '이익률'
  ws.getCell(r, COL.profit).font = { bold: true, size: 10 }
  ws.getCell(r, COL.profit).alignment = { horizontal: 'right' }
  ws.getCell(r, COL.rate).value = quote.profit_rate ?? 0
  ws.getCell(r, COL.rate).numFmt = FMT_RATE
  ws.getCell(r, COL.rate).font = { bold: true }
  for (let c = 1; c <= LAST_COL; c++) borderThin(ws.getCell(r, c))
  r++

  // ── 판관비·영업이익 — 분류에 규칙이 있을 때만(지금은 TSE 매출의 30%) ──
  // 저장값(total_profit·profit_rate)은 **매출이익**이다. 아래 두 줄은 거기서 계산한 표시값이다.
  // **줄별 분류로 안분한다**(혼합 견적 — TSE + SBS). 줄에 분류가 없으면 견적 분류를 따르므로
  // 분류를 나누지 않은 견적은 종전과 한 원도 다르지 않다(lib/quoteProfit.ts).
  //
  // 매출·원가는 **저장된 합계**(quotes.total_*)가 정본이다 — 국내조달품이 total_supply 에서
  // 빠지는 등 줄 합과 다를 수 있다. 그래서 줄 목록은 **판관비를 나눌 비율**로만 쓰고,
  // 합계는 아래에서 저장값으로 되돌린다.
  const lineBd = profitBreakdownOfLines(
    items.map(it => ({ supply: it.supply_amount ?? 0, cost: it.cost_amount ?? 0, category: it.category })),
    quote.category,
  )
  const savedRevenue = quote.total_supply ?? 0
  const savedCost = quote.total_cost ?? 0
  // 저장 합계에 맞춘 판관비 — 줄 합과 저장 합이 다르면 그 비율만큼 옮긴다(둘이 같으면 그대로).
  const sga = lineBd.revenue > 0 ? Math.round(lineBd.sga * (savedRevenue / lineBd.revenue)) : 0
  const grossProfit = savedRevenue - savedCost
  const bd = {
    ...lineBd,
    revenue: savedRevenue,
    cost: savedCost,
    grossProfit,
    sga,
    operatingProfit: grossProfit - sga,
    operatingRate: savedRevenue > 0 ? ((grossProfit - sga) / savedRevenue) * 100 : 0,
  }
  if (bd.hasSga) {
    const extraRow = (label: string, amount: number, rate: number) => {
      ws.mergeCells(r, 1, r, TOTAL_LABEL_END)
      const l = ws.getCell(r, 1)
      l.value = label
      l.font = { bold: true, size: 11 }
      const v = ws.getCell(r, COL.supply)
      v.value = amount
      v.numFmt = FMT_KRW
      v.font = { bold: true, size: 11 }
      ws.getCell(r, COL.profit).value = '비율'
      ws.getCell(r, COL.profit).font = { bold: true, size: 10 }
      ws.getCell(r, COL.profit).alignment = { horizontal: 'right' }
      ws.getCell(r, COL.rate).value = Math.round(rate * 10) / 10
      ws.getCell(r, COL.rate).numFmt = FMT_RATE
      ws.getCell(r, COL.rate).font = { bold: true }
      for (let c = 1; c <= LAST_COL; c++) borderThin(ws.getCell(r, c))
      r++
    }
    const sgaPct = savedRevenue > 0 ? (bd.sga / savedRevenue) * 100 : 0
    // 분류가 섞인 견적은 「매출 × 30%」 같은 한 줄 설명이 맞지 않는다 — 섞였다고 적는다.
    const mixed = new Set(items.map(it => (it.category ?? '') || (quote.category ?? ''))).size > 1
    extraRow(`판관비 (${mixed ? '분류별 안분' : `매출 × ${sgaPct.toFixed(0)}%`})`, -bd.sga, sgaPct)
    extraRow('영업이익', bd.operatingProfit, bd.operatingRate)
  }

  return ws
}
