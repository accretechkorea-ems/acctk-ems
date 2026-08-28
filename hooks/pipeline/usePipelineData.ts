'use client'

// 파이프라인 화면의 데이터 조회. 전체 영업기회와 기회에 묶인 활동을 함께 읽는다.
// 활동은 두 곳에 쓴다 — 방치 판정(최신 activity_date)과 기회 모달의 연결된 활동 목록.

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
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
      supabase.from('engineers').select('*, email').order('engineer_id', { ascending: true }),
      // 신규 등록 시 업체를 고르기 위한 목록 (숨김 처리된 업체는 제외)
      supabase.from('customers').select('customer_id, company_name, address, status, agency').is('deleted_at', null).order('company_name'),
    ])
    setLoading(false)

    if (oppRes.error) {
      console.error('[pipeline] load opportunities failed', oppRes.error)
      toast.error(`영업기회를 불러오지 못했습니다 (${oppRes.error.code || oppRes.error.message})`)
      return false
    }
    if (actRes.error) console.error('[pipeline] load activities failed', actRes.error)

    setOpportunities((oppRes.data as SalesOpportunity[]) ?? [])
    setActivities((actRes.data as SalesActivity[]) ?? [])
    setEngineers((engRes.data as Engineer[]) ?? [])
    if (custRes.error) console.error('[pipeline] load customers failed', custRes.error)
    setCustomers((custRes.data as Customer[]) ?? [])

    const { data: { user } } = await supabase.auth.getUser()
    if (user && engRes.data) {
      const found = (engRes.data as { engineer_id: number; email: string; permission_level: string | null }[])
        .find(e => e.email === user.email)
      if (found) setMe({ engineer_id: found.engineer_id, role: found.permission_level ?? null })
    }
    return true
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 기회별 마지막 활동일. 활동이 없으면 null 이고, 그때는 화면에서 created_at 으로 갈음한다.
  const lastActivityByOpp = useMemo(() => {
    const map = new Map<number, string>()
    for (const a of activities) {
      if (a.opportunity_id == null || !a.activity_date) continue
      const prev = map.get(a.opportunity_id)
      if (!prev || a.activity_date > prev) map.set(a.opportunity_id, a.activity_date)
    }
    return map
  }, [activities])

  return { opportunities, activities, engineers, customers, loading, me, lastActivityByOpp, reload }
}
