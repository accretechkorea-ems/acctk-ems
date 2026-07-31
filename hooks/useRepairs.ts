'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type RepairStatus = '입고' | '수리중' | '출고대기' | '출고완료'

export type Repair = {
  repair_id: number
  received_date: string           // 입고일
  customer_name: string | null    // 회사명
  product_type: string | null     // 제품 구분
  serial_number: string | null    // 시리얼번호
  item_type: string | null        // 구분: 게이지 | 앰프
  status: RepairStatus
  shipped_date: string | null     // 출고일
  repair_started_at: string | null // 수리 시작 시각
  repair_done_at: string | null    // 수리 완료(출고대기) 시각
  repair_content: string | null    // 특이사항 (본사수리·수리불가 등)
  created_by: number | null
  created_at: string
}

/**
 * repairs 목록을 로드하는 공용 훅.
 * 쿼리·정렬은 기존 page.tsx 의 fetchRepairs() 와 동일:
 *   select('*') → received_date desc → repair_id desc
 * 마운트 시 1회 자동 로드하고, 등록/상태변경/삭제/임포트 후 refetch() 로 재호출한다.
 */
export function useRepairs() {
  const supabase = useMemo(() => createClient(), [])
  const [repairs, setRepairs] = useState<Repair[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('repairs')
      .select('*')
      .order('received_date', { ascending: false })
      .order('repair_id', { ascending: false })
    setRepairs((data as Repair[]) ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { refetch() }, [refetch])

  return { repairs, loading, refetch }
}
