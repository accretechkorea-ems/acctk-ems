'use client'

// 고객사 상세의 데이터 조회 담당. 조회 결과와 파생 상태만 들고 있고,
// CRUD 는 각 도메인 훅(useServiceCrud / useContactCrud / useDeviceCrud / useCustomerCrud)이 맡는다.
// 그 훅들이 저장 후 fetchDetail() 로 갱신하므로 여기서 fetchDetail 을 함께 내보낸다.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import type { Customer, Device, Contact, ServiceHistory, Engineer, Quote, SalesActivity, SalesOpportunity, Holding } from '@/components/customer/types'

// quotes 는 engineers 를 engineer_id(실적 귀속자)·created_by(작성자) 두 번 참조한다.
// 관계를 지정하지 않으면 PGRST201(300 Multiple Choices)로 조회 전체가 실패한다.
// 거래 이력에 보여줄 담당자는 실적 귀속자다.
const QUOTE_SELECT = '*, engineers!quotes_engineer_id_fkey(name, position), quote_items(product_name, price_list(model_jp))'

export function useCustomerDetail(customerId: number) {
  const supabase = createClient()
  const router = useRouter()
  const toast = useToast()

  // ── 데이터 상태 ──
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [history, setHistory] = useState<ServiceHistory[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [activities, setActivities] = useState<SalesActivity[]>([])
  const [opportunities, setOpportunities] = useState<SalesOpportunity[]>([])
  const [holdings, setHoldings] = useState<Holding[]>([])
  // 이 업체가 어느 회사에 묶여 있으면(부모가 있으면) 형제 사업장의 견적까지 따로 담는다.
  // 요약의 건수·타임라인은 이 배열을 쓰지 않는다 — 거래 이력 모달에서만 쓴다.
  const [family, setFamily] = useState<{ name: string; siteCount: number; quotes: Quote[] } | null>(null)
  // 반대로 이 업체가 부모면 소속 사업장 목록을 담는다(부모 상세는 이 목록만 보여준다).
  const [childSites, setChildSites] = useState<{ customer_id: number; company_name: string | null }[]>([])
  const [engineers, setEngineers] = useState<Engineer[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUserEngineerId, setCurrentUserEngineerId] = useState<number | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)

  // ── 데이터 페칭 ──
  // 반환값 = 상세를 읽어 화면에 반영했는지. 저장 후 성공 안내를 띄울지 판단하는 데 쓴다.
  /**
   * 부모가 있으면 형제 사업장의 견적을, 자신이 부모면 소속 사업장 목록을 읽는다.
   * 둘 다 아니면 요청을 보내지 않는다 — 단독 업체의 화면은 종전과 완전히 같아야 한다.
   */
  const loadFamily = async (row: Customer) => {
    if (row.is_parent) {
      const { data } = await supabase
        .from('customers').select('customer_id, company_name')
        .eq('parent_customer_id', row.customer_id).is('deleted_at', null).order('company_name')
      setChildSites(data ?? [])
      setFamily(null)
      return
    }
    setChildSites([])
    const parentId = row.parent_customer_id ?? null
    if (parentId == null) { setFamily(null); return }

    const [{ data: parentRow }, { data: sibs }] = await Promise.all([
      supabase.from('customers').select('company_name').eq('customer_id', parentId).maybeSingle(),
      supabase.from('customers').select('customer_id').eq('parent_customer_id', parentId).is('deleted_at', null),
    ])
    const ids = (sibs ?? []).map(s => s.customer_id)
    let famQuotes: Quote[] = []
    if (ids.length > 0) {
      const list = ids.join(',')
      // 상세와 같은 규칙으로 모은다 — 수요처로 잡힌 건과 대리점으로 낀 건 모두.
      const { data, error } = await supabase
        .from('quotes')
        .select(QUOTE_SELECT)
        .or(`customer_id.in.(${list}),dealer_id.in.(${list})`)
        .order('quote_date', { ascending: false })
      if (error) console.error('[customerDetail] 회사 전체 거래 이력 조회 실패', error)
      famQuotes = (data as Quote[]) ?? []
    }
    setFamily({ name: parentRow?.company_name ?? '', siteCount: ids.length, quotes: famQuotes })
  }

  const fetchDetail = async (): Promise<boolean> => {
    setLoading(true)
    const [
      { data: customerData }, { data: devicesData }, { data: contactsData },
      { data: historyData }, { data: engineersData }, { data: quotesData },
      { data: activitiesData, error: activitiesErr },
      { data: oppsData, error: oppsErr },
      { data: holdingsData, error: holdingsErr },
    ] = await Promise.all([
      supabase.from('customers').select('*').is('deleted_at', null).eq('customer_id', customerId).maybeSingle(),
      supabase.from('devices').select('*').is('deleted_at', null).eq('customer_id', customerId).order('device_id', { ascending: true }),
      supabase.from('contacts').select('*').is('deleted_at', null).eq('customer_id', customerId).order('contact_id', { ascending: true }),
      supabase.from('service_history').select('*, service_engineers(engineer_id, engineers(name, position))').eq('customer_id', customerId).order('service_id', { ascending: false }),
      supabase.from('engineers').select('*, email').order('engineer_id', { ascending: true }),
      // 이 업체가 수요처(customer_id)인 견적과 대리점(dealer_id)으로 낀 견적을 함께 가져온다.
      // 거래 이력·요약·타임라인이 같은 배열을 쓰므로 세 곳 모두 대리점 건을 포함하게 된다.
      supabase.from('quotes').select(QUOTE_SELECT).or(`customer_id.eq.${customerId},dealer_id.eq.${customerId}`).order('quote_date', { ascending: false }),
      // 영업 활동. engineers·contacts 로 향하는 FK 가 각각 하나뿐이라 관계 지정 없이 임베딩된다.
      // (contacts 의 이름 컬럼은 contact_name 이 아니라 name 이다)
      supabase.from('sales_activities')
        .select('*, engineers(name, position), contacts(name, position), sales_opportunities(title)')
        .eq('customer_id', customerId)
        .order('activity_date', { ascending: false }),
      // 영업기회. engineers FK 가 하나뿐이라 관계 지정 없이 임베딩된다.
      supabase.from('sales_opportunities')
        .select('*, engineers(name, position), quotes(quote_id, quote_number, quote_date, total_supply, status, pdf_url)')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false }),
      // 장비 홀딩(미해결 이슈). devices·engineers·holding_notes 로 향하는 FK 가 각각 하나뿐이라 관계 지정 없이 임베딩된다.
      supabase.from('holdings')
        .select('*, devices(device_name, device_name2, serial_number), engineers(name, position), holding_notes(*, engineers(name, position))')
        .eq('customer_id', customerId)
        .order('started_at', { ascending: false }),
    ])
    // 숨김 처리된(deleted_at 있는) 업체거나 없는 번호면 상세를 열지 않고 목록으로 보낸다.
    if (!customerData) {
      setLoading(false)
      toast.error('삭제되었거나 없는 업체입니다')
      router.push('/')
      return false
    }
    setCustomer(customerData)
    setDevices(devicesData ?? [])
    setContacts(contactsData ?? [])
    setHistory(historyData ?? [])
    setEngineers(engineersData ?? [])
    setQuotes((quotesData as Quote[]) ?? [])
    await loadFamily(customerData as Customer)
    // 영업 활동은 다른 영역과 독립적이라, 실패해도 화면 전체를 막지 않고 로그만 남긴다.
    if (activitiesErr) console.error('[customer] sales_activities load failed', activitiesErr)
    setActivities((activitiesData as SalesActivity[]) ?? [])
    if (oppsErr) console.error('[customer] sales_opportunities load failed', oppsErr)
    setOpportunities((oppsData as SalesOpportunity[]) ?? [])
    if (holdingsErr) console.error('[customer] holdings load failed', holdingsErr)
    setHoldings((holdingsData as Holding[]) ?? [])
    const { data: { user } } = await supabase.auth.getUser()
    if (user && engineersData) {
      const me = (engineersData as any[]).find(e => e.email === user.email)
      if (me) {
        setCurrentUserEngineerId(me.engineer_id)
        setCurrentUserRole(me.permission_level ?? null)
      }
    }

    setLoading(false)
    return true
  }

  useEffect(() => {
    if (!customerId || Number.isNaN(customerId)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDetail()
  }, [customerId])

  // ── 파생 상태 ──
  const historyByDevice = useMemo(() => {
    const map = new Map<number, ServiceHistory[]>()
    devices.forEach(d => map.set(d.device_id, []))
    history.forEach(h => {
      if (h.device_id == null) return
      const arr = map.get(Number(h.device_id)) || []
      arr.push(h)
      map.set(Number(h.device_id), arr)
    })
    return map
  }, [devices, history])

  // 진행 중 홀딩은 장비마다 1건으로 제한하므로 단일 값으로 들고 있는다.
  const activeHoldingByDevice = useMemo(() => {
    const map = new Map<number, Holding>()
    for (const h of holdings) {
      if (h.resolved_at) continue
      if (!map.has(h.device_id)) map.set(h.device_id, h)
    }
    return map
  }, [holdings])

  // 서비스 레포트에서 걸린 홀딩(해제된 것도 포함) — 이력 줄에 배지를 띄우는 데 쓴다.
  const holdingByService = useMemo(() => {
    const map = new Map<number, Holding>()
    for (const h of holdings) {
      if (h.service_id == null) continue
      if (!map.has(h.service_id)) map.set(h.service_id, h)
    }
    return map
  }, [holdings])

  const totalRevenueAmt = useMemo(
    () => quotes.filter(q => q.status === '매출완료').reduce((s, q) => s + (q.total_supply || 0), 0),
    [quotes]
  )

  return {
    customer, devices, contacts, history, quotes, activities, opportunities, engineers,
    loading, currentUserEngineerId, currentUserRole,
    holdings, activeHoldingByDevice, holdingByService,
    historyByDevice, totalRevenueAmt,
    family, childSites,
    fetchDetail,
  }
}
