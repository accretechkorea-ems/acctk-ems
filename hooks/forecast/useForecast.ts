'use client'

// 포캐스트 화면의 데이터 — 집계(lib/forecast.ts)와 조회(lib/forecastData.ts)를 화면에 잇는다.
//
// 이름 맵을 따로 읽는 이유 — 집계 줄에는 **id 만** 들어 있다(고객·대리점). 고객 목록을
// 여기서 한 번 읽어 두고 줄마다 이름을 붙인다. 모회사(is_parent)·숨긴 업체도 이름은 보여야
// 하므로 거르지 않고 전부 읽는다(이름만 쓰고 다른 칸은 보지 않는다).

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { loadForecast } from '@/lib/forecastData'
import { emptyBucket, type ForecastResult } from '@/lib/forecast'

const EMPTY: ForecastResult = { rows: [], byPersonMonth: {}, byCategoryMonth: {} }

export function useForecast(today: string) {
  const [supabase] = useState(() => createClient())
  const toast = useToast()
  const [result, setResult] = useState<ForecastResult>(EMPTY)
  const [customerNames, setCustomerNames] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    const [fc, custRes] = await Promise.all([
      loadForecast(supabase, { today }),
      supabase.from('customers').select('customer_id, company_name'),
    ])
    setLoading(false)
    if (fc.errors.length > 0) {
      console.error('[forecast] load failed', fc.errors)
      toast.error(`포캐스트 자료를 일부 읽지 못했습니다 (${fc.errors[0]})`)
    }
    setResult({ rows: fc.rows, byPersonMonth: fc.byPersonMonth, byCategoryMonth: fc.byCategoryMonth })
    if (custRes.error) console.error('[forecast] load customers failed', custRes.error)
    setCustomerNames(new Map(((custRes.data ?? []) as { customer_id: number; company_name: string | null }[])
      .map(c => [c.customer_id, c.company_name ?? ''])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, today])

  useEffect(() => { void reload() }, [reload])

  /** 그 달에 그 사람들에게 걸린 **목표** 합계. 목표는 담당자별로만 저장된다(분류 목표는 없다). */
  const targetOf = useCallback((month: string, engineerIds: number[]): number =>
    engineerIds.reduce((s, id) => s + (result.byPersonMonth[String(id)]?.[month]?.목표 ?? 0), 0),
    [result])

  return { result, customerNames, loading, reload, targetOf, emptyBucket }
}
