'use client'

/**
 * **회사 전체 활동**을 한 번에 읽는다 — 목록 보기에서 회사를 골랐을 때.
 *
 * 사업장 상세는 한 사업장(customer_id 하나)만 읽는다(hooks/customer/useCustomerDetail.ts).
 * 여기서는 같은 조회를 **회사의 사업장 전부**(`in`)로 넓힌다. 사업장 수만큼 조회를
 * 되풀이하지 않는다 — 현대자동차처럼 사업장이 40곳인 회사에서도 표마다 한 번씩, 모두 6번이다.
 *
 * 조회에 걸린 시간을 `ms` 로 함께 돌려준다(화면 구석에 쓰지는 않고, 느려지면 알아채려고 둔다).
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { QUOTE_SELECT } from '@/hooks/customer/useCustomerDetail'
import type { Contact, Device, Holding, Quote, SalesActivity, SalesOpportunity, ServiceHistory } from '@/components/customer/types'
import type { CustomerEvent } from '@/lib/customerEventView'

export type CompanyTimelineData = {
  history: ServiceHistory[]
  quotes: Quote[]
  activities: SalesActivity[]
  holdings: Holding[]
  devices: Device[]
  contacts: Contact[]
  opportunities: SalesOpportunity[]
  /** 고객 사건 로그(db/customer_events_20261120.sql). 표가 아직 없으면 빈 배열이다. */
  events: CustomerEvent[]
  /** 이 사업장들에 걸린 의뢰서. customer_id 칸이 없으면 빈 배열이다. */
  inquiries: InquiryRow[]
  loading: boolean
  /** 마지막 조회에 걸린 밀리초. */
  ms: number
  reload: () => void
}

/** 활동 이력에 쓰는 의뢰서 칸만. */
export type InquiryRow = {
  id: string
  customer_id: number | null
  device_id: number | null
  inquiry_no: string | null
  inquiry_type: string | null
  title: string | null
  status: string | null
  issued_date: string | null
  created_by: number | null
  created_at: string | null
}

/**
 * 의뢰서에 customer_id 칸이 있는가. **한 번 실패하면 그 세션에서는 다시 묻지 않는다** —
 * 칸이 없는 DB(= SQL 적용 전)에서 회사를 고를 때마다 400 이 쌓이기 때문이다.
 * 칸을 더하고 새로고침하면 다시 참이 된다(db/inquiry_customer_device_20261120.sql).
 */
let inquiryLinked = true

const EMPTY: Omit<CompanyTimelineData, 'reload'> = {
  history: [], quotes: [], activities: [], holdings: [], devices: [], contacts: [], opportunities: [], events: [],
  inquiries: [],
  loading: false, ms: 0,
}

export function useCompanyTimeline(siteIds: number[]): CompanyTimelineData {
  const supabase = createClient()
  const [data, setData] = useState(EMPTY)
  const [tick, setTick] = useState(0)
  // 같은 사업장 묶음이면 다시 읽지 않는다 — 배열은 매 렌더 새로 만들어지므로 키로 바꿔 본다.
  const key = siteIds.join(',')

  useEffect(() => {
    const ids = key ? key.split(',').map(Number) : []
    if (ids.length === 0) { setData(EMPTY); return }
    let cancelled = false
    setData(prev => ({ ...prev, loading: true }))
    const started = performance.now()

    const list = ids.join(',')
    Promise.all([
      supabase.from('service_history')
        .select('*, service_engineers(engineer_id, engineers(name, position))')
        .in('customer_id', ids).order('service_id', { ascending: false }),
      // 수요처로 잡힌 건과 대리점으로 낀 건을 함께 본다(상세와 같은 규칙).
      supabase.from('quotes').select(QUOTE_SELECT)
        .or(`customer_id.in.(${list}),dealer_id.in.(${list})`)
        .order('quote_date', { ascending: false }),
      supabase.from('sales_activities')
        .select('*, engineers(name, position), contacts(name, position), sales_opportunities(title)')
        .in('customer_id', ids).order('activity_date', { ascending: false }),
      supabase.from('holdings')
        .select('*, devices(device_name, device_name2, serial_number, status, disposed_at), engineers(name, position), holding_notes(*, engineers(name, position))')
        .in('customer_id', ids).order('started_at', { ascending: false }),
      supabase.from('devices').select('*').is('deleted_at', null).in('customer_id', ids),
      supabase.from('contacts').select('*').is('deleted_at', null).in('customer_id', ids).order('contact_id'),
      supabase.from('sales_opportunities')
        .select('*, engineers(name, position)')
        .in('customer_id', ids).order('created_at', { ascending: false }),
      // 사건 로그 — 사람이 적는 활동과 달리 자동으로만 쌓인다(lib/customerEvents.ts).
      supabase.from('customer_events')
        .select('id, customer_id, event_type, occurred_at, actor_engineer_id, payload')
        .in('customer_id', ids).order('occurred_at', { ascending: false }),
      // 의뢰서 — customer_id 칸은 2026-11-20 에 더했다. 칸이 없으면 한 번만 묻고 접는다.
      inquiryLinked
        ? supabase.from('inquiries')
          .select('id, customer_id, device_id, inquiry_no, inquiry_type, title, status, issued_date, created_by, created_at')
          .in('customer_id', ids).order('issued_date', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]).then(([h, q, a, hold, d, c, o, ev, iq]) => {
      if (cancelled) return
      for (const r of [h, q, a, hold, d, c, o]) {
        if (r.error) console.error('[companyTimeline] 조회 실패', r.error)
      }
      // 사건 표가 아직 없을 수 있다(SQL 적용 전) — 그때는 사건만 비고 나머지는 그대로 보인다.
      if (ev.error) console.warn('[companyTimeline] 사건 로그를 읽지 못했다 (db/customer_events_20261120.sql)', ev.error.message)
      // 의뢰서의 customer_id 칸도 마찬가지다(db/inquiry_customer_device_20261120.sql).
      if (iq.error) {
        inquiryLinked = false
        console.warn('[companyTimeline] 의뢰서를 읽지 못했다 — 이 세션에서는 더 묻지 않는다 (db/inquiry_customer_device_20261120.sql)', iq.error.message)
      }
      setData({
        history: (h.data as ServiceHistory[]) ?? [],
        quotes: (q.data as Quote[]) ?? [],
        activities: (a.data as SalesActivity[]) ?? [],
        holdings: (hold.data as Holding[]) ?? [],
        devices: (d.data as Device[]) ?? [],
        contacts: (c.data as Contact[]) ?? [],
        opportunities: (o.data as SalesOpportunity[]) ?? [],
        events: (ev.data as CustomerEvent[]) ?? [],
        inquiries: (iq.data as InquiryRow[]) ?? [],
        loading: false,
        ms: Math.round(performance.now() - started),
      })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick])

  return { ...data, reload: () => setTick(t => t + 1) }
}
