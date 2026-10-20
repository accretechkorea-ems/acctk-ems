'use client'

// 가격표(price_list) 품목 검색 — **한 곳에서만 한다.**
//
// 예전에는 이 질의가 품목 행 훅(hooks/quote/useQuoteRows.ts) 안에 박혀 있어서, 장비 구성
// 모달이 같은 검색을 하려면 질의를 한 벌 더 써야 했다. 질의가 둘이 되면 찾는 범위가 조용히
// 갈라진다(한쪽만 모델명을 보고 다른 쪽은 품번만 보는 식으로). 그래서 함수로 뽑았다.
//
// 찾는 범위: item_code(품번) · model_jp(설명·규격) · item_name_jp(모델명) 부분 일치, 최대 20건.
// item_name_jp 는 **가격표 2단계에서 더했다.** 그전에는 품번과 설명만 봤는데, 모델명이
// item_name_jp 칸에 들어 있어서 「코드 또는 모델명 검색」이라는 안내와 달리 모델명으로는
// 찾히지 않았다(가격표 1단계 조사 A-3).

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
  // PostgREST 의 or=(…) 는 **쉼표로 조건을 나눈다.** 검색어에 쉼표·괄호가 섞이면 필터가
  // 깨져 조회가 통째로 실패한다(품번 두 개를 붙여 치는 일이 있다). 그런 글자는 털어낸다.
  const safe = q.replace(/[,()%]/g, ' ').trim()
  if (!safe) return []
  const { data, error } = await supabase
    .from('price_list')
    .select('*')
    .or(`item_code.ilike.%${safe}%,model_jp.ilike.%${safe}%,item_name_jp.ilike.%${safe}%`)
    .limit(PRICE_SEARCH_LIMIT)
  if (error) {
    console.error('[priceSearch] 조회 실패', { q, error })
    return []
  }
  return (data ?? []) as PriceItem[]
}
