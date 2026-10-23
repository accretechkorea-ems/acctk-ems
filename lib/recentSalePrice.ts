'use client'

// 「최근 판매」 — 같은 고객사에 같은 품번을 **마지막으로 판 단가**.
//
// 본사 엑셀 견적서의 「판매실적가」 열이다. 단가를 정할 때 지난번에 얼마에 팔았는지가
// 가장 쓸모 있는 기준이라 품목 검색 결과와 품목 줄에 함께 보여 준다.
//
// ── 「팔았다」의 뜻 ─────────────────────────────────────────────────────────
// 수주 이상인 견적만 본다(lib/quoteStatus.ts 의 ORDERED_STATUSES — 수주 · 발주(주문 대기) ·
// 주문완료 · 세금계산서 요청 · 매출완료). 견적중·보류·실패는 **판 것이 아니다** —
// 제출만 한 금액을 「실적」으로 보여 주면 다음 견적이 그 값을 따라간다.
//
// ── 품번을 맞추는 방법 ─────────────────────────────────────────────────────
// 가격표 품목은 price_list_id 로, 직접 적은 품목은 part_code 로 맞춘다. quote_items 는
// 둘 다 저장한다(part_code 는 가격표가 바뀌어도 남는 스냅샷이다).
//
// ── 조회는 한 번 ───────────────────────────────────────────────────────────
// 품번마다 묻지 않는다. 화면이 알고 싶은 품번을 모아 **in 조회 한 번**으로 받아 오고,
// 고객사별로 모듈에 캐시한다(같은 품번을 다시 묻지 않는다).

import type { SupabaseClient } from '@supabase/supabase-js'
import { ORDERED_STATUSES } from '@/lib/quoteStatus'

/** 한 품번의 마지막 판매. */
export type RecentSale = {
  /** 그때 판 단가(원). */
  unitPrice: number
  /** 견적 날짜(YYYY-MM-DD). */
  quoteDate: string
  /** 견적번호 — 어느 건인지 짚어 줄 때 쓴다. */
  quoteNumber: string
}

/** 품번을 가리키는 열쇠. 가격표 품목은 id, 직접 적은 품목은 품번 글자다. */
export type SaleKey = { priceListId?: number | null; partCode?: string | null }

/**
 * 열쇠를 글자 하나로 — 맵의 키다.
 *
 * 가격표 id 가 있으면 그것이 먼저다(품번 글자가 가격표마다 겹칠 수 있다).
 * 품번 글자는 **대문자·공백 정리**해서 맞춘다 — 사람이 적는 칸이라 'kt35000' 과
 * 'KT35000 ' 이 같은 품번이다.
 */
export function recentSaleKey(key: SaleKey | null | undefined): string | null {
  const id = key?.priceListId
  if (id != null && Number.isFinite(Number(id))) return `id:${Number(id)}`
  const code = (key?.partCode ?? '').trim().toUpperCase()
  return code ? `code:${code}` : null
}

/** 받아 온 줄 하나(조회 결과의 모양). */
export type SaleRow = {
  price_list_id: number | null
  part_code: string | null
  unit_price_krw: number | null
  quote_id: number | null
  quote_number: string | null
  quote_date: string | null
}

/**
 * 받아 온 줄들을 품번별 **마지막 한 건**으로 줄인다.
 *
 * 늦은 날짜가 이긴다. 날짜가 같으면 quote_id 가 큰 쪽(나중에 만든 건)이 이긴다.
 * 단가가 0 이하인 줄은 버린다 — 「얼마에 팔았나」의 답이 아니다.
 *
 * 한 견적에 같은 품번이 여러 줄 있을 수 있다(수량을 나눠 적는 경우). 그때도 한 건만
 * 남는다 — 같은 견적 안에서는 어느 줄이 남아도 날짜·견적번호가 같다.
 */
export function pickLatestSales(rows: readonly SaleRow[]): Map<string, RecentSale> {
  type Picked = RecentSale & { quoteId: number }
  const best = new Map<string, Picked>()
  for (const r of rows) {
    const price = Number(r.unit_price_krw) || 0
    const date = (r.quote_date ?? '').slice(0, 10)
    if (price <= 0 || !date) continue
    // 가격표 품목이면 id 로도, 품번 글자로도 찾을 수 있게 두 열쇠에 모두 넣는다.
    const keys = [
      recentSaleKey({ priceListId: r.price_list_id }),
      recentSaleKey({ partCode: r.part_code }),
    ].filter((k): k is string => !!k)
    const quoteId = Number(r.quote_id) || 0
    for (const k of keys) {
      const cur = best.get(k)
      const better = !cur || date > cur.quoteDate || (date === cur.quoteDate && quoteId > cur.quoteId)
      if (better) best.set(k, { unitPrice: price, quoteDate: date, quoteNumber: r.quote_number ?? '', quoteId })
    }
  }
  const out = new Map<string, RecentSale>()
  for (const [k, v] of best) out.set(k, { unitPrice: v.unitPrice, quoteDate: v.quoteDate, quoteNumber: v.quoteNumber })
  return out
}

/** 고객사별 캐시 — `고객사|열쇠` → 결과(없으면 null 을 담아 다시 묻지 않는다). */
const cache = new Map<string, RecentSale | null>()

/** 고객사가 바뀌거나 견적을 저장한 뒤에 부른다. */
export function invalidateRecentSales(): void {
  cache.clear()
}

/**
 * 모르는 품번만 한 번에 받아 온다.
 *
 * 돌려주는 맵은 **물어본 열쇠만** 담는다(캐시 전체가 아니다). 조회가 실패하면 빈 맵이다 —
 * 보조 정보라 화면을 막지 않는다.
 */
export async function loadRecentSales(
  supabase: SupabaseClient,
  customerId: number | null | undefined,
  keys: readonly SaleKey[],
): Promise<Map<string, RecentSale>> {
  const out = new Map<string, RecentSale>()
  if (!customerId) return out

  const wanted = [...new Set(keys.map(recentSaleKey).filter((k): k is string => !!k))]
  const missing = wanted.filter(k => !cache.has(`${customerId}|${k}`))

  if (missing.length > 0) {
    const ids = missing.filter(k => k.startsWith('id:')).map(k => Number(k.slice(3)))
    const codes = missing.filter(k => k.startsWith('code:')).map(k => k.slice(5))
    const ors: string[] = []
    if (ids.length) ors.push(`price_list_id.in.(${ids.join(',')})`)
    // 품번 글자에 쉼표·따옴표가 섞이면 or 문법이 깨진다 — 그런 품번은 빼고 묻는다.
    const safeCodes = codes.filter(c => /^[A-Z0-9._\-/()]+$/.test(c))
    if (safeCodes.length) ors.push(`part_code.in.(${safeCodes.map(c => `"${c}"`).join(',')})`)

    if (ors.length > 0) {
      const { data, error } = await supabase
        .from('quote_items')
        .select('price_list_id, part_code, unit_price_krw, quotes!inner(quote_id, quote_number, quote_date, status, customer_id)')
        .eq('quotes.customer_id', customerId)
        .in('quotes.status', [...ORDERED_STATUSES])
        .or(ors.join(','))
      if (error) {
        console.warn('[recentSale] 조회 실패', error.message)
        return out
      }
      type Nested = {
        price_list_id: number | null; part_code: string | null; unit_price_krw: number | null
        quotes: { quote_id: number | null; quote_number: string | null; quote_date: string | null } | null
      }
      const rows: SaleRow[] = ((data ?? []) as unknown as Nested[]).map(r => ({
        price_list_id: r.price_list_id,
        part_code: r.part_code,
        unit_price_krw: r.unit_price_krw,
        quote_id: r.quotes?.quote_id ?? null,
        quote_number: r.quotes?.quote_number ?? null,
        quote_date: r.quotes?.quote_date ?? null,
      }))
      const found = pickLatestSales(rows)
      // 물어본 것은 전부 캐시에 적는다 — 없으면 null 로 적어 다시 묻지 않는다.
      for (const k of missing) cache.set(`${customerId}|${k}`, found.get(k) ?? null)
    } else {
      for (const k of missing) cache.set(`${customerId}|${k}`, null)
    }
  }

  for (const k of wanted) {
    const hit = cache.get(`${customerId}|${k}`)
    if (hit) out.set(k, hit)
  }
  return out
}
