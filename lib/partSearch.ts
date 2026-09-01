'use client'

// 부품 사용 이력 검색 — "이 부품이 어느 업체에 나갔나".
//
// quote_items 는 견적 시점의 스냅샷(part_code·product_name)을 들고 있어서, 가격표가 개정돼도
// 그때 나간 품번·품명 그대로 찾힌다. 그래서 price_list 를 경유하지 않고 이 두 컬럼만 본다.
//   · part_code    — 가격표에서 고른 품목의 품번(직접 입력한 품번도 그대로 저장된다)
//   · product_name — "사용자 품명 (모델명)" 형태라 모델명·품명이 여기 들어 있다
//
// quotes 는 customers 를 두 번(customer_id·dealer_id) 참조하므로 임베딩에 제약 이름을 명시한다.
// 그냥 customers(...) 로 쓰면 PGRST201 로 조회 전체가 실패한다.

import { createClient } from '@/lib/supabase/client'
import { ORDERED_STATUSES } from '@/lib/quoteStatus'

/** 실제로 물건이 나간 것으로 보는 상태 — 발주서가 등록된 이후. 실적 현황의 수주 기준과 같은 목록이다. */
export const DELIVERED_STATUSES: readonly string[] = ORDERED_STATUSES

/** 이 글자 수 미만이면 조회하지 않는다(한두 글자로 전체를 긁지 않게). */
export const MIN_QUERY_LEN = 2

const LIMIT = 50

export type PartHit = {
  itemId: number
  partCode: string | null
  productName: string
  quantity: number | null
  supplyAmount: number | null
  quoteId: number
  quoteNumber: string
  quoteDate: string | null
  status: string
  pdfUrl: string | null
  customerId: number | null
  companyName: string          // 업체가 없는 견적이면 '-'
  viaDealer: boolean           // 대리점 경유 견적
  dealerName: string | null
}

type Company = { company_name: string | null } | null
type Row = {
  item_id: number
  part_code: string | null
  product_name: string | null
  quantity: number | null
  supply_amount: number | null
  quotes: {
    quote_id: number
    quote_number: string
    quote_date: string | null
    status: string
    pdf_url: string | null
    customer_id: number | null
    dealer_id: number | null
    customers: Company
    dealer: Company
  }
}

const SELECT =
  'item_id, part_code, product_name, quantity, supply_amount, ' +
  'quotes!inner(quote_id, quote_number, quote_date, status, pdf_url, customer_id, dealer_id, ' +
  'customers!quotes_customer_id_fkey(company_name), dealer:customers!quotes_dealer_id_fkey(company_name))'

// PostgREST 의 or 필터에서 값에 쉼표·괄호가 들어가면 조건이 잘린다. 검색어에서 미리 뺀다.
const sanitize = (q: string) => q.trim().replace(/[,()]/g, ' ').replace(/\s+/g, ' ')

export async function searchParts(
  q: string,
  opts?: { deliveredOnly?: boolean },
): Promise<{ rows: PartHit[]; error: string | null }> {
  const term = sanitize(q)
  if (term.length < MIN_QUERY_LEN) return { rows: [], error: null }

  const supabase = createClient()
  let query = supabase
    .from('quote_items')
    .select(SELECT)
    .or(`part_code.ilike.%${term}%,product_name.ilike.%${term}%`)
    // 할인 행은 부품이 아니라 총액 차감이라 결과에서 뺀다.
    // row_kind 가 비어 있는 옛 데이터까지 떨어지지 않도록 is.null 을 함께 허용한다.
    .or('row_kind.is.null,row_kind.neq.discount')
    .order('quote_date', { referencedTable: 'quotes', ascending: false })
    .limit(LIMIT)

  if (opts?.deliveredOnly) query = query.in('quotes.status', DELIVERED_STATUSES)

  const { data, error } = await query
  if (error) {
    console.error('[partSearch] failed', error)
    return { rows: [], error: error.code || error.message }
  }

  const rows: PartHit[] = ((data ?? []) as unknown as Row[]).map(r => {
    const qt = r.quotes
    return {
      itemId: r.item_id,
      partCode: r.part_code,
      productName: r.product_name ?? '',
      quantity: r.quantity,
      supplyAmount: r.supply_amount,
      quoteId: qt.quote_id,
      quoteNumber: qt.quote_number,
      quoteDate: qt.quote_date,
      status: qt.status,
      pdfUrl: qt.pdf_url,
      customerId: qt.customer_id,
      companyName: qt.customers?.company_name ?? '-',
      viaDealer: qt.dealer_id != null && qt.dealer_id !== qt.customer_id,
      dealerName: qt.dealer?.company_name ?? null,
    }
  })

  // 임베딩 컬럼 정렬은 서버에 맡기되, 받은 것도 한 번 더 정렬해 순서를 확실히 한다(최대 50건이라 부담 없다).
  // 날짜가 없는 견적은 맨 뒤로.
  rows.sort((a, b) => {
    if (a.quoteDate === b.quoteDate) return b.itemId - a.itemId
    if (!a.quoteDate) return 1
    if (!b.quoteDate) return -1
    return a.quoteDate < b.quoteDate ? 1 : -1
  })

  return { rows, error: null }
}
