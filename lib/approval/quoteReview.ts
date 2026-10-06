// 견적 검토표의 데이터 조립 — 순수 함수만 둔다(DB·화면 의존 없음).
//
// 결재자가 금액만 보고 판단하지 않도록, 품목·원가·이익·이익률·거래 구분을 한 덩어리로 묶는다.
// 결재 문서를 볼 수 있는 사람(상신자·결재선 참여자 전원·관리자)은 **전부** 본다 — 가리지 않는다.
//
// **저장된 값을 그대로 쓴다. 다시 계산하지 않는다.**
//   quotes.total_* 와 quote_items 의 금액은 화면이 계산해 넣은 값이고 DB 가 재계산하지 않는다
//   (quote_create_function.sql 머리말 — 「금액 합계는 클라이언트 계산값을 그대로 저장한다」).
//   여기서 다시 더하면 두 벌이 생겨 어긋난다. 합계 행도 품목을 더하지 않고 total_* 를 그대로 쓴다
//   — 국내조달품(domestic)은 total_supply 에서 빠지고 원가에만 잡히므로, 더하면 값이 달라진다.
//
// 거래 구분의 이름 규칙은 견적서와 같다 — 회사 아래 사업장이면 **회사 이름**이 찍힌다
// (lib/quoteEuName.ts 의 euDisplayName). 대리점·E.U 양쪽에 같은 규칙을 쓴다.

import { euDisplayName } from '@/lib/quoteEuName'

/** 숫자로 읽는다. null·빈 값·숫자가 아닌 값은 null — 0 으로 바꾸지 않는다(「없음」과 0 은 다르다). */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 천 단위 쉼표. 소수는 있으면 최대 네 자리까지 남긴다(원가가 소수인 과거 데이터가 있다). */
export const comma = (v: number | null | undefined): string =>
  v === null || v === undefined ? '-' : v.toLocaleString('ko-KR', { maximumFractionDigits: 4 })

/** 이익률 — 소수 한 자리. 없으면 '-'. */
export const rateText = (v: number | null | undefined): string =>
  v === null || v === undefined ? '-' : `${v.toFixed(1)}%`

// ── 들어오는 모양(DB 행 그대로) ──────────────────────────────────────

export type RawQuote = {
  quote_id: number
  quote_number: string | null
  quote_date: string | null
  status: string | null
  quote_type: string | null
  recipient: string | null
  note: string | null
  delivery_info: string | null
  total_supply: unknown
  total_tax: unknown
  total_amount: unknown
  total_cost: unknown
  total_profit: unknown
  profit_rate: unknown
  customer_id: number | null
  dealer_id: number | null
}

export type RawItem = {
  item_id: number
  row_kind: string | null
  part_code: string | null
  product_name: string | null
  quantity: unknown
  unit_price_jpy: unknown
  unit_price_krw: unknown
  supply_amount: unknown
  cost_amount: unknown
  profit_amount: unknown
  profit_rate: unknown
  exchange_rate: unknown
  tariff_rate: unknown
}

export type RawExpense = {
  expense_id: number
  item_name: string | null
  unit_price: unknown
  headcount: unknown
  days: unknown
  amount: unknown
}

/** 업체 한 곳의 이름 — 등록된 사업장명과 그것을 묶는 회사명. */
export type PartyName = { site: string | null; parent: string | null }

export type ReviewInput = {
  quote: RawQuote
  items: RawItem[]
  expenses: RawExpense[]
  /** customer_id 가 가리키는 업체(직판이면 고객사, 대리점 건이면 E.U). */
  customer: PartyName | null
  /** dealer_id 가 가리키는 대리점. 직판이면 null. */
  dealer: PartyName | null
  /** 실적 담당자(quotes.engineer_id) 이름. */
  engineer: string | null
  /** 작성자(quotes.created_by) 이름. 대필이면 실적 담당자와 다르다. */
  createdBy: string | null
}

// ── 나가는 모양(화면이 그대로 그린다) ────────────────────────────────

/** 품목 보조 줄의 한 조각 — 값이 있을 때만 들어간다. */
export type SubPart = { label: string; value: string }

export type ReviewItem = {
  itemId: number
  name: string
  quantity: number | null
  unitPrice: number | null
  supply: number | null
  cost: number | null
  profit: number | null
  profitRate: number | null
  /** 품번·구입가(엔)·환율·관세. 값이 없는 것은 빠진다. */
  subParts: SubPart[]
}

export type ReviewExpense = {
  expenseId: number
  name: string
  unitPrice: number | null
  days: number | null
  amount: number | null
}

export type ReviewChannel = {
  kind: 'direct' | 'dealer'
  /** '직판' · '대리점' */
  label: string
  /** 견적서에 찍히는 고객(직판) 또는 E.U 이름. */
  customer: string
  /** 등록된 사업장명 — 위 표기와 다를 때만 채운다(보조 글씨로 덧붙인다). */
  customerSite: string | null
  /** 대리점 건만. 견적서에 찍히는 대리점 이름. */
  dealer: string | null
  dealerSite: string | null
}

export type QuoteReview = {
  quoteNumber: string | null
  quoteDate: string | null
  status: string | null
  totals: {
    supply: number | null
    tax: number | null
    amount: number | null
    cost: number | null
    profit: number | null
    profitRate: number | null
  }
  channel: ReviewChannel
  recipient: string | null
  engineer: string | null
  createdBy: string | null
  /**
   * 납기·비고 — **응답에는 담지만 검토표 화면은 그리지 않는다.**
   * 다음 작업(결재 완료 PDF)이 같은 응답을 쓰므로 여기서 함께 돌려준다.
   */
  delivery: string | null
  note: string | null
  items: ReviewItem[]
  expenses: ReviewExpense[]
}

/** 한 업체의 표기와, 표기와 다를 때의 등록 사업장명. */
function partyLabel(p: PartyName | null): { shown: string; site: string | null } {
  if (!p) return { shown: '-', site: null }
  const shown = euDisplayName({ siteName: p.site, parentName: p.parent })
  const site = (p.site ?? '').trim()
  // 회사명으로 찍히는데 등록된 사업장명이 다르면 그 사실을 알려야 한다 —
  // 결재자가 「어느 공장 건인가」를 판단할 재료다.
  return { shown: shown || '-', site: site && site !== shown ? site : null }
}

/** 품목 보조 줄 — 값이 있는 것만. 가격표 품목만 구입가·환율·관세가 채워진다. */
function subPartsOf(it: RawItem): SubPart[] {
  const out: SubPart[] = []
  const code = (it.part_code ?? '').trim()
  if (code) out.push({ label: '품번', value: code })
  const jpy = num(it.unit_price_jpy)
  if (jpy !== null && jpy !== 0) out.push({ label: '구입가', value: `¥${comma(jpy)}` })
  const fx = num(it.exchange_rate)
  if (fx !== null && fx !== 0) out.push({ label: '환율', value: String(fx) })
  const tariff = num(it.tariff_rate)
  if (tariff !== null && tariff !== 0) out.push({ label: '관세', value: String(tariff) })
  return out
}

/**
 * 검토표 데이터를 만든다.
 *
 * 깨지지 않아야 하는 경우
 *   · 품목이 없다 — items 빈 배열. 합계 행은 저장된 total_* 로 그대로 나온다.
 *   · 원가·이익이 없다(0원가 서비스, 옛 데이터) — null 로 두고 화면이 '-' 를 그린다.
 *     0 으로 바꾸지 않는다. 「원가 0」과 「원가 모름」은 결재자에게 다른 정보다.
 *   · 업체 이름을 못 읽었다 — '-'.
 */
export function buildQuoteReview(input: ReviewInput): QuoteReview {
  const q = input.quote
  const isDealer = q.dealer_id != null

  const cust = partyLabel(input.customer)
  const deal = isDealer ? partyLabel(input.dealer) : null

  return {
    quoteNumber: q.quote_number,
    quoteDate: q.quote_date,
    status: q.status,
    totals: {
      supply: num(q.total_supply),
      tax: num(q.total_tax),
      amount: num(q.total_amount),
      cost: num(q.total_cost),
      profit: num(q.total_profit),
      profitRate: num(q.profit_rate),
    },
    channel: {
      kind: isDealer ? 'dealer' : 'direct',
      label: isDealer ? '대리점' : '직판',
      customer: cust.shown,
      customerSite: cust.site,
      dealer: deal ? deal.shown : null,
      dealerSite: deal ? deal.site : null,
    },
    recipient: q.recipient,
    engineer: input.engineer,
    createdBy: input.createdBy,
    delivery: q.delivery_info,
    note: q.note,
    items: [...input.items]
      // 화면·엑셀과 같은 순서(item_id)다 — 임베딩된 행은 순서가 보장되지 않는다.
      .sort((a, b) => a.item_id - b.item_id)
      .map(it => ({
        itemId: it.item_id,
        // 품명이 비면 품번으로, 그것도 없으면 종류로 — 빈 칸을 남기지 않는다.
        name: (it.product_name ?? '').trim() || (it.part_code ?? '').trim() || (it.row_kind ?? '품목'),
        quantity: num(it.quantity),
        unitPrice: num(it.unit_price_krw),
        supply: num(it.supply_amount),
        cost: num(it.cost_amount),
        profit: num(it.profit_amount),
        profitRate: num(it.profit_rate),
        subParts: subPartsOf(it),
      })),
    expenses: [...input.expenses]
      .sort((a, b) => a.expense_id - b.expense_id)
      .map(e => ({
        expenseId: e.expense_id,
        name: (e.item_name ?? '').trim() || '-',
        unitPrice: num(e.unit_price),
        days: num(e.days),
        amount: num(e.amount),
      })),
  }
}
