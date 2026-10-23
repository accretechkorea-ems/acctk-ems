'use client'

// 「최근 판매」를 화면이 쓰기 좋게 — 품번 목록을 주면 맵을 돌려준다.
//
//   const recent = useRecentSales(supabase, customerId, keys)
//   const sale = recent(row.selectedItem?.id, row.partCode)   // 없으면 null
//
// 조회는 lib/recentSalePrice.ts 가 한 번에 하고 고객사별로 캐시한다. 이 훅은 **언제 묻는가**
// 만 정한다 — 품번 목록이 바뀌었을 때만이다(검색하며 글자를 칠 때마다 묻지 않게, 목록을
// 글자로 눕혀 비교한다).

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadRecentSales, recentSaleKey, type RecentSale, type SaleKey } from '@/lib/recentSalePrice'

/** 결과가 없을 때 쓰는 고정 빈 맵 — 렌더마다 새 맵을 만들지 않는다. */
const EMPTY_MAP: Map<string, RecentSale> = new Map()

/** 품번 하나의 최근 판매를 찾아 주는 함수. */
export type RecentSaleLookup = (priceListId: number | null | undefined, partCode: string | null | undefined) => RecentSale | null

export function useRecentSales(
  supabase: SupabaseClient,
  customerId: number | null | undefined,
  keys: readonly SaleKey[],
): RecentSaleLookup {
  // 목록을 글자로 눕힌다 — 배열은 매 렌더 새 객체라 그대로 쓰면 effect 가 끝없이 돈다.
  const signature = [...new Set(keys.map(recentSaleKey).filter(Boolean))].sort().join('|')
  /**
   * 받아 둔 결과와 **그것이 어느 목록의 것인지**.
   *
   * effect 안에서 곧바로 setState 하지 않는다 — 목록이 바뀌는 순간 지난 결과를 지우려고
   * 그러면 렌더가 한 번 더 돌고, 품목을 고르는 사이 숫자가 깜빡인다. 열쇠를 비교해
   * **계산해서** 쓰면 둘 다 없다(hooks/useAvatarUrl.ts 와 같은 방식).
   */
  const [got, setGot] = useState<{ sig: string; map: Map<string, RecentSale> } | null>(null)

  useEffect(() => {
    if (!customerId || !signature) return
    let alive = true
    const list: SaleKey[] = signature.split('|').map(k =>
      k.startsWith('id:') ? { priceListId: Number(k.slice(3)) } : { partCode: k.slice(5) })
    loadRecentSales(supabase, customerId, list).then(m => { if (alive) setGot({ sig: signature, map: m }) })
    return () => { alive = false }
  }, [supabase, customerId, signature])

  const map = got?.sig === signature ? got.map : EMPTY_MAP

  return (priceListId, partCode) => {
    const byId = recentSaleKey({ priceListId })
    if (byId && map.has(byId)) return map.get(byId) ?? null
    const byCode = recentSaleKey({ partCode })
    if (byCode && map.has(byCode)) return map.get(byCode) ?? null
    return null
  }
}
