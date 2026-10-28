'use client'

// 파이프라인 화면의 데이터 조회. 전체 영업기회와 기회에 묶인 활동을 함께 읽는다.
// 활동은 기회 모달의 「연결된 활동」 목록에 쓴다(칸반 카드의 방치 판정은 2026-10-28 에 걷었다).

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadMe } from '@/lib/appData/me'
import { loadEngineers } from '@/lib/appData/engineers'
import { useToast } from '@/components/common/Toast'

import type { Customer, Engineer, SalesActivity, SalesOpportunity } from '@/components/customer/types'

export function usePipelineData() {
  const supabase = createClient()
  const toast = useToast()

  const [opportunities, setOpportunities] = useState<SalesOpportunity[]>([])
  const [activities, setActivities] = useState<SalesActivity[]>([])
  const [engineers, setEngineers] = useState<Engineer[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState<{ engineer_id: number | null; role: string | null }>({ engineer_id: null, role: null })

  // 반환값 = 조회 성공 여부. 저장 후 성공 안내를 띄울지 판단하는 데 쓴다.
  const reload = async (): Promise<boolean> => {
    setLoading(true)
    const [oppRes, actRes, engRes, custRes] = await Promise.all([
      supabase.from('sales_opportunities')
        .select('*, engineers(name, position), customers(company_name), quotes(quote_id, quote_number, quote_date, total_supply, status, pdf_url)')
        .order('created_at', { ascending: false }),
      // 기회에 묶인 활동만 있으면 된다
      supabase.from('sales_activities')
        .select('*')
        .not('opportunity_id', 'is', null)
        .order('activity_date', { ascending: false }),
      loadEngineers(),
      // 신규 등록 시 업체를 고르기 위한 목록 (숨김 처리된 업체는 제외)
      supabase.from('customers').select('customer_id, company_name, address, status, agency').is('deleted_at', null).eq('is_parent', false).order('company_name'),
    ])
    setLoading(false)

    if (oppRes.error) {
      console.error('[pipeline] load opportunities failed', oppRes.error)
      toast.error(`포캐스트를 불러오지 못했습니다 (${oppRes.error.code || oppRes.error.message})`)
      return false
    }
    if (actRes.error) console.error('[pipeline] load activities failed', actRes.error)

    setOpportunities((oppRes.data as SalesOpportunity[]) ?? [])
    setActivities((actRes.data as SalesActivity[]) ?? [])
    setEngineers((engRes as unknown as Engineer[]) ?? [])
    if (custRes.error) console.error('[pipeline] load customers failed', custRes.error)
    setCustomers((custRes.data as Customer[]) ?? [])

    // 본인은 공통 층에서(조회 0회). 목록에서 다시 찾지 않는다.
    const { me: self } = await loadMe()
    if (self) setMe({ engineer_id: self.engineer_id, role: self.permission_level ?? null })
    return true
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 기회별 마지막 활동일(lastActivityByOpp)은 2026-10-28 에 걷었다 — 칸반 카드의
  // 「N일째 활동 없음」 줄이 없어져 쓰는 곳이 사라졌다. activities 자체는 그대로 둔다
  // (포캐스트 모달이 활동 이력을 그린다). 80 대시보드는 같은 계산을 제 훅에 들고 있다
  // (hooks/dashboard/useDashboard80.ts) — 그쪽은 그대로다.
  return { opportunities, activities, engineers, customers, loading, me, reload }
}
