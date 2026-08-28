'use client'

// 홀딩 현황 화면의 전체 조회. 업체 상세와 달리 업체를 가리지 않고 다 읽는다.
// customers·devices·engineers·holding_notes 를 한 번에 임베딩한다(FK 가 각각 하나뿐이라 관계 지정 불필요).

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import type { Holding } from '@/components/customer/types'

export function useHoldingList() {
  const supabase = createClient()
  const toast = useToast()

  const [holdings, setHoldings] = useState<Holding[]>([])
  const [loading, setLoading] = useState(true)
  const [engineerId, setEngineerId] = useState<number | null>(null)

  // 반환값 = 조회 성공 여부. 저장 후 성공 안내를 띄울지 판단하는 데 쓴다.
  const reload = async (): Promise<boolean> => {
    setLoading(true)
    const { data, error } = await supabase
      .from('holdings')
      .select('*, customers(company_name), devices(device_name, device_name2, serial_number), engineers(name, position), holding_notes(*, engineers(name, position))')
      .order('started_at', { ascending: false })
    setLoading(false)

    if (error) {
      console.error('[holdings] load failed', error)
      toast.error(`홀딩을 불러오지 못했습니다 (${error.code || error.message})`)
      return false
    }
    setHoldings((data as Holding[]) ?? [])

    const { data: { user } } = await supabase.auth.getUser()
    if (user?.email) {
      const { data: me } = await supabase.from('engineers').select('engineer_id').eq('email', user.email).maybeSingle()
      if (me) setEngineerId(me.engineer_id)
    }
    return true
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { holdings, loading, engineerId, reload }
}
