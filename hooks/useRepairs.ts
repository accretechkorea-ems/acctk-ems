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
  repair_content: string | null    // 자유 메모 (구 특이사항 텍스트 → 메모 용도로 유지)
  special_type: string | null      // 특이사항 유형: '본사수리' | '수리불가' | '수리진행안함' | null
  hq_requested_at: string | null   // 본사 발송일
  hq_returned_at: string | null    // 본사 복귀일
  quote_id: number | null          // 연결된 견적서(quotes.quote_id). 청구 금액의 유일 출처.
  created_by: number | null
  created_at: string
}

// 20팀 수리용 견적 요약(최소 필드). /api/repair-quotes 응답 형태. quotes 를 직접 조회하지 않는다.
export type RepairQuote = {
  quote_id: number
  quote_number: string
  total_supply: number | null
  company_name: string | null
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
    // 연결된 견적 요약은 quotes RLS 에 막히므로 여기서 붙이지 않는다.
    // 목록/모달이 /api/repair-quotes 로 별도 조회한다(20팀 견적만 service role 로 좁게 오픈).
    setRepairs((data as Repair[]) ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { refetch() }, [refetch])

  return { repairs, loading, refetch }
}
