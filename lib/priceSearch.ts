'use client'

// 가격표(price_list) 품목 검색 — **한 곳에서만 한다.**
//
// 예전에는 이 질의가 품목 행 훅(hooks/quote/useQuoteRows.ts) 안에 박혀 있어서, 장비 구성
// 모달이 같은 검색을 하려면 질의를 한 벌 더 써야 했다. 질의가 둘이 되면 찾는 범위가 조용히
// 갈라진다(한쪽만 모델명을 보고 다른 쪽은 품번만 보는 식으로). 그래서 함수로 뽑았다.
//
// 찾는 범위와 건수 상한은 **종전과 한 글자도 같다** — item_code 또는 model_jp 에 부분 일치,
// 최대 20건. 옮기면서 바꾼 것은 없다.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PriceItem } from '@/app/quote/types'

/** 한 번에 받는 후보 수. 드롭다운이 읽히는 선이다(종전 값 그대로). */
export const PRICE_SEARCH_LIMIT = 20

/**
 * 품번·모델명으로 가격표를 찾는다.
 * 빈 글자면 조회하지 않고 빈 배열을 돌려준다 — 한두 글자로 표 전체를 긁지 않게.
 * 실패해도 던지지 않는다(빈 배열) — 검색이 안 된다고 견적 작성을 멈출 이유가 없다.
 */
export async function searchPriceList(supabase: SupabaseClient, q: string): Promise<PriceItem[]> {
  if (!q.trim()) return []
  const { data, error } = await supabase
    .from('price_list')
    .select('*')
    .or(`item_code.ilike.%${q}%,model_jp.ilike.%${q}%`)
    .limit(PRICE_SEARCH_LIMIT)
  if (error) {
    console.error('[priceSearch] 조회 실패', { q, error })
    return []
  }
  return (data ?? []) as PriceItem[]
}
