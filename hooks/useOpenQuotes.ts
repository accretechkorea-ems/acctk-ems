'use client'

// 업체별 **진행 견적 수** — 목록 보기의 칩·표·회사 카드가 쓴다.
//
// 「진행」은 `견적중`(PENDING_STATUS) 이다 — 아직 수주도 실패도 아닌 건. 발주 이상으로
// 넘어간 건은 「진행」이 아니라 실적이라 여기서 세지 않는다(lib/quoteStatus.ts).
//
// **목록 보기를 열 때만** 읽는다. 지도 보기는 이 수치를 쓰지 않는데 첫 화면 조회를
// 하나 더 늘릴 이유가 없다(docs/perf-rules.md — 첫 화면의 조회 수를 지킨다).
// 대리점 경유 건은 customer_id 가 최종 사용 업체이므로 그 줄에 붙는다.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PENDING_STATUS } from '@/lib/quoteStatus'

export function useOpenQuotes(enabled: boolean): Map<number, number> {
  const [map, setMap] = useState<Map<number, number>>(new Map())

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const run = async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('quotes')
        .select('customer_id')
        .eq('status', PENDING_STATUS)
        .range(0, 5000)
      if (cancelled) return
      if (error) { console.warn('[openQuotes] 조회 오류:', error); return }
      const next = new Map<number, number>()
      for (const r of (data ?? []) as { customer_id: number | null }[]) {
        const id = Number(r.customer_id)
        if (!Number.isFinite(id)) continue
        next.set(id, (next.get(id) ?? 0) + 1)
      }
      setMap(next)
    }
    void run()
    return () => { cancelled = true }
  }, [enabled])

  return map
}
