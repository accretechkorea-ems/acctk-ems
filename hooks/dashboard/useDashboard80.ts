'use client'

// 80 대시보드의 데이터.
// 화면 전체를 한 번에 읽지 않고, 위젯이 쓰는 범위만 좁혀서 각각 조회한다.
//   · 이번 달 지표 — 기간·상태를 쿼리에서 걸러 건수는 count(head)로만 받는다
//   · 영업기회   — 진행 중인 것만. 담당자 이름은 임베딩으로 함께 받아 추가 조회를 만들지 않는다
//   · 활동       — 정체 판정에 쓰는 날짜 두 컬럼만. 모달에 보여줄 내용은 열 때 그 기회 것만 따로 읽는다
// 홀딩은 기존 useHoldingList 를 그대로 쓴다(같은 데이터를 두 번 읽지 않기 위해).

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { isClosed } from '@/components/customer/opportunity'
import { deviceLabel, elapsedDays } from '@/components/customer/holding'
import { SERVICE_TYPES } from '@/components/activity/ActivityCard'
import { SALES_TYPES } from '@/lib/activity'
import type { Holding, SalesActivity, SalesOpportunity } from '@/components/customer/types'

export const STALE_DAYS = 30

// 마감 임박의 급함을 경과일수와 같은 축에 놓기 위한 기준(일).
// 오늘 마감이면 DUE_SCALE, 30일 남았으면 0, 지난 건은 DUE_SCALE 을 넘는다.
const DUE_SCALE = 30

export type MonthStats = {
  quoteCount: number      // 이번 달 작성된 견적
  wonCount: number        // 이번 달 발주서가 등록된 건(= 수주)
  revenue: number         // 이번 달 매출완료된 건의 공급가 합
}

/** 이번 달 활동 — 총 건수와 유형별 건수. 유형 목록은 입력 화면이 쓰는 상수를 그대로 따른다. */
export type ActivityStats = {
  total: number
  byType: { type: string; count: number }[]
}

/** 유효기간이 다가오는 견적 한 줄. */
export type ExpiringQuote = {
  quoteId: number
  quoteNumber: string
  quoteDate: string
  companyName: string
  expiry: string      // 만료일 YYYY-MM-DD
  daysLeft: number    // 음수면 이미 지난 것
}

// 견적 유효기간이 걸리는 상태 — 고객 회신을 기다리는 "견적중" 뿐이다.
// 발주 이후(발주(주문 대기)·주문완료·세금계산서 요청·매출완료)는 이미 물건이 움직였고,
// 수주는 고객이 받아들인 뒤, 수리중은 국내수리가 진행 중, 실패·취소요청·보류는 멈춘 건이라
// 어느 쪽도 "1개월 안에 답을 받아야 하는" 상태가 아니다.
const EXPIRY_TARGET_STATUS = '견적중'

export type UrgentKind = '홀딩' | '정체' | '마감'

/** '지금 챙길 것' 한 줄. 세 종류를 한 목록에 섞기 위한 공통 모양. */
export type UrgentItem = {
  kind: UrgentKind
  key: string
  company: string
  title: string           // 장비명 또는 기회 제목
  owner: string           // 담당자
  status: string          // '45일째' / '32일 무활동' / '이번 달 마감'
  score: number           // 클수록 급하다(아래 주석 참조)
  holding?: Holding
  opportunity?: SalesOpportunity
}

const pad = (n: number) => String(n).padStart(2, '0')
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
// 'YYYY-MM-DD' 두 개의 날짜 차이(일). 값이 이상하면 0.
const daysBetween = (from: string, to: string) => {
  const a = Date.parse(`${from}T00:00:00`), b = Date.parse(`${to}T00:00:00`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.floor((b - a) / 86400000)
}
// 그 달의 시작일과 다음 달 시작일 ('YYYY-MM-DD'). 범위는 [start, end) 로 쓴다.
function monthRange(d: Date) {
  const start = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  const end = `${n.getFullYear()}-${pad(n.getMonth() + 1)}-01`
  return { start, end }
}

const emptyStats = (): MonthStats => ({ quoteCount: 0, wonCount: 0, revenue: 0 })
const emptyActivity = (types: readonly string[]): ActivityStats => ({
  total: 0, byType: types.map(type => ({ type, count: 0 })),
})

/**
 * 견적 유효기간 만료일 = 작성일 + 1개월 - 1일 (견적서 PDF 의 "작성일로부터 1개월" 문구 기준).
 * 30일을 더하지 않고 월 단위로 옮긴다. 다음 달에 같은 날짜가 없으면(1/31 → 2/31)
 * 그 달 말일로 맞춘 뒤 하루를 뺀다.
 */
export function quoteExpiry(quoteDate: string): string {
  const [y, m, d] = quoteDate.split('-').map(Number)
  const nextY = m === 12 ? y + 1 : y
  const nextM = m === 12 ? 1 : m + 1
  const lastDay = new Date(nextY, nextM, 0).getDate()   // 다음 달 말일
  const dt = new Date(nextY, nextM - 1, Math.min(d, lastDay))
  dt.setDate(dt.getDate() - 1)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

/**
 * 홀딩 · 정체 기회 · 마감 임박을 한 목록으로 합친다(순수 함수).
 *
 * 급한 순 기준 — 세 종류의 시간 축이 달라서 "얼마나 방치/초과됐는가(일)"로 환산해 한 줄에 세운다.
 *   · 홀딩   : 시작일로부터 경과일수          (45일째 → 45)
 *   · 정체   : 마지막 활동일로부터 경과일수    (32일 무활동 → 32)
 *   · 마감   : DUE_SCALE - 남은 일수          (오늘 마감 → 30, D-3 → 27, 5일 지남 → 35)
 * 값이 같으면 홀딩 → 마감 → 정체 순으로 둔다(손이 더 많이 가는 것부터).
 */
export function buildUrgentItems(args: {
  holdings: Holding[]
  opportunities: SalesOpportunity[]
  lastActivityByOpp: Map<number, string>
  today?: string
}): UrgentItem[] {
  const { holdings, opportunities, lastActivityByOpp } = args
  const today = args.today ?? todayStr()
  const monthEnd = (() => {
    const d = new Date()
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    return `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`
  })()

  const items: UrgentItem[] = []

  for (const h of holdings) {
    if (h.resolved_at) continue
    const days = elapsedDays(h)
    items.push({
      kind: '홀딩',
      key: `holding-${h.holding_id}`,
      company: h.customers?.company_name ?? '-',
      title: deviceLabel(h),
      owner: h.engineers?.name ?? '-',
      status: `${days}일째`,
      score: days,
      holding: h,
    })
  }

  for (const o of opportunities) {
    if (isClosed(o)) continue
    const company = o.customers?.company_name ?? '-'
    const owner = o.engineers?.name ?? '-'

    // 정체 — 마지막 활동(없으면 등록일)로부터 STALE_DAYS 이상
    const base = lastActivityByOpp.get(o.opportunity_id) ?? o.created_at.slice(0, 10)
    const idle = daysBetween(base, today)
    if (idle >= STALE_DAYS) {
      items.push({
        kind: '정체', key: `stale-${o.opportunity_id}`, company, title: o.title, owner,
        status: `${idle}일 무활동`, score: idle, opportunity: o,
      })
    }

    // 마감 임박 — expected_close 가 이번 달 말일 이내(지난 것 포함)
    if (o.expected_close && o.expected_close <= monthEnd) {
      const left = daysBetween(today, o.expected_close)
      items.push({
        kind: '마감', key: `due-${o.opportunity_id}`, company, title: o.title, owner,
        status: left < 0 ? `마감 ${-left}일 지남` : left === 0 ? '오늘 마감' : `마감 ${left}일 남음`,
        score: DUE_SCALE - left, opportunity: o,
      })
    }
  }

  const kindRank: Record<UrgentKind, number> = { '홀딩': 0, '마감': 1, '정체': 2 }
  return items.sort((a, b) =>
    b.score - a.score || kindRank[a.kind] - kindRank[b.kind] || a.key.localeCompare(b.key)
  )
}

export function useDashboard80() {
  const supabase = createClient()
  const toast = useToast()

  const [thisMonth, setThisMonth] = useState<MonthStats>(emptyStats)
  const [lastMonth, setLastMonth] = useState<MonthStats>(emptyStats)
  const [opportunities, setOpportunities] = useState<SalesOpportunity[]>([])
  const [lastActivityByOpp, setLastActivityByOpp] = useState<Map<number, string>>(new Map())
  const [oppActivities, setOppActivities] = useState<SalesActivity[]>([])
  const [salesActivity, setSalesActivity] = useState<ActivityStats>(() => emptyActivity(SALES_TYPES))
  const [serviceActivity, setServiceActivity] = useState<ActivityStats>(() => emptyActivity(SERVICE_TYPES))
  const [expiringQuotes, setExpiringQuotes] = useState<ExpiringQuote[]>([])
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)

  // 한 달 치 지표. 건수는 head+count 라 행을 받아오지 않는다.
  const loadMonth = async (range: { start: string; end: string }): Promise<MonthStats> => {
    const [quoteRes, wonRes, revenueRes] = await Promise.all([
      // 작성 기준
      supabase.from('quotes').select('quote_id', { count: 'exact', head: true })
        .gte('quote_date', range.start).lt('quote_date', range.end),
      // 수주 기준 — 발주서가 등록된 시점(견적중 → 발주(주문 대기))
      supabase.from('quotes').select('quote_id', { count: 'exact', head: true })
        .gte('purchase_order_at', range.start).lt('purchase_order_at', range.end),
      // 매출 기준 — 세금계산서 발행이 끝난 시점(→ 매출완료)
      supabase.from('quotes').select('total_supply')
        .eq('status', '매출완료')
        .gte('tax_invoice_completed_at', range.start).lt('tax_invoice_completed_at', range.end),
    ])
    const err = quoteRes.error || wonRes.error || revenueRes.error
    if (err) { console.error('[dashboard80] month stats failed', err); throw err }
    return {
      quoteCount: quoteRes.count ?? 0,
      wonCount: wonRes.count ?? 0,
      revenue: (revenueRes.data ?? []).reduce((s, q) => s + (q.total_supply ?? 0), 0),
    }
  }

  // 이번 달 활동 — 유형 컬럼만 읽어 화면에서 센다(집계 함수를 새로 만들지 않는다).
  // 유형 목록은 입력 화면이 쓰는 상수를 그대로 쓰므로 0건인 유형도 자리를 지킨다.
  const countByType = (rows: { type: string | null }[], types: readonly string[]): ActivityStats => {
    const m = new Map<string, number>()
    for (const r of rows) if (r.type) m.set(r.type, (m.get(r.type) ?? 0) + 1)
    return {
      total: rows.length,
      byType: types.map(type => ({ type, count: m.get(type) ?? 0 })),
    }
  }

  // 반환값 = 조회 성공 여부(모달 저장 후 성공 안내를 띄울지 판단하는 데 쓴다).
  const load = async (): Promise<boolean> => {
    setLoading(true)
    const now = new Date()
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    try {
      const range = monthRange(now)
      const [cur, before, oppRes, salesRes, serviceRes, expiryRes] = await Promise.all([
        loadMonth(range),
        loadMonth(monthRange(prev)),
        // 진행 중인 기회만 (종료·실주 제외). 담당자 이름은 여기서 함께 받는다.
        supabase.from('sales_opportunities')
          .select('*, customers(company_name), engineers(name, position)')
          .is('closed_at', null).neq('stage', '실주'),
        // 이번 달 영업 활동 — 유형만
        supabase.from('sales_activities').select('activity_type')
          .gte('activity_date', range.start).lt('activity_date', range.end),
        // 이번 달 C/S 활동 — 유형만
        supabase.from('service_history').select('service_type')
          .gte('visit_date', range.start).lt('visit_date', range.end),
        // 유효기간이 걸리는 견적(견적중)만. 업체명은 두 FK 를 구분해 임베딩한다.
        supabase.from('quotes')
          .select('quote_id, quote_number, quote_date, customers!quotes_customer_id_fkey(company_name)')
          .eq('status', EXPIRY_TARGET_STATUS),
      ])
      if (!alive.current) return false
      if (oppRes.error) {
        console.error('[dashboard80] opportunities failed', oppRes.error)
        toast.error(`영업기회를 불러오지 못했습니다 (${oppRes.error.code || oppRes.error.message})`)
      }
      const opps = (oppRes.data as SalesOpportunity[]) ?? []

      // 정체 판정용 — 위 기회들에 묶인 활동의 날짜만 읽는다
      const ids = opps.map(o => o.opportunity_id)
      const map = new Map<number, string>()
      if (ids.length > 0) {
        const { data: acts, error: actErr } = await supabase
          .from('sales_activities')
          .select('opportunity_id, activity_date')
          .in('opportunity_id', ids)
        if (actErr) console.error('[dashboard80] activities failed', actErr)
        for (const a of acts ?? []) {
          if (a.opportunity_id == null || !a.activity_date) continue
          const prevDate = map.get(a.opportunity_id)
          if (!prevDate || a.activity_date > prevDate) map.set(a.opportunity_id, a.activity_date)
        }
      }
      if (!alive.current) return false

      if (salesRes.error) console.error('[dashboard80] sales activity failed', salesRes.error)
      if (serviceRes.error) console.error('[dashboard80] service activity failed', serviceRes.error)
      setSalesActivity(countByType(
        ((salesRes.data ?? []) as { activity_type: string | null }[]).map(r => ({ type: r.activity_type })),
        SALES_TYPES,
      ))
      setServiceActivity(countByType(
        ((serviceRes.data ?? []) as { service_type: string | null }[]).map(r => ({ type: r.service_type })),
        SERVICE_TYPES,
      ))

      if (expiryRes.error) console.error('[dashboard80] expiring quotes failed', expiryRes.error)
      const today = todayStr()
      type QuoteRow = {
        quote_id: number; quote_number: string; quote_date: string | null
        customers: { company_name: string | null } | null
      }
      setExpiringQuotes(
        ((expiryRes.data ?? []) as unknown as QuoteRow[])
          .filter(q => !!q.quote_date)
          .map(q => {
            const expiry = quoteExpiry(q.quote_date as string)
            return {
              quoteId: q.quote_id,
              quoteNumber: q.quote_number,
              quoteDate: q.quote_date as string,
              companyName: q.customers?.company_name ?? '-',
              expiry,
              daysLeft: daysBetween(today, expiry),
            }
          })
          .sort((a, b) => a.daysLeft - b.daysLeft || a.quoteId - b.quoteId),
      )

      setThisMonth(cur)
      setLastMonth(before)
      setOpportunities(opps)
      setLastActivityByOpp(map)
      return true
    } catch {
      if (alive.current) toast.error('대시보드를 불러오지 못했습니다')
      return false
    } finally {
      if (alive.current) setLoading(false)
    }
  }

  /**
   * 영업기회 모달을 열 때 그 기회의 활동만 읽는다.
   * 목록에서는 정체 판정에 날짜만 필요해 내용을 받지 않으므로, 모달을 열 때 한 번 더 좁게 읽는다.
   */
  const loadOppActivities = async (opportunityId: number) => {
    setOppActivities([])
    const { data, error } = await supabase
      .from('sales_activities')
      .select('*')
      .eq('opportunity_id', opportunityId)
      .order('activity_date', { ascending: false })
    if (error) { console.error('[dashboard80] opp activities failed', error); return }
    if (alive.current) setOppActivities((data as SalesActivity[]) ?? [])
  }

  useEffect(() => {
    alive.current = true
    load()
    return () => { alive.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 담당자별 진행 중 기회 건수 — 많은 순. 금액은 내지 않는다(개인 실적 비교는 실적 현황의 몫). */
  const ownerCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of opportunities) {
      if (isClosed(o)) continue
      const name = o.engineers?.name ?? '미지정'
      m.set(name, (m.get(name) ?? 0) + 1)
    }
    return [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [opportunities])

  return {
    thisMonth, lastMonth, opportunities, lastActivityByOpp,
    ownerCounts, oppActivities, loadOppActivities, loading, reload: load,
    salesActivity, serviceActivity, expiringQuotes,
  }
}
