'use client'

// 견적 작성 화면의 **고객사·대리점·E.U·영업기회** 부분 — 검색·선택·해제.
//
// app/quote/page.tsx 에서 **그대로 옮겨 온 것**이다(분리 리팩터 3a). 상태 이름·초기값·본문·
// 주석을 한 글자도 바꾸지 않았다.
//
// 두 가지만 원본과 다르다(동작은 같다).
//   · supabase 클라이언트를 **화면에서 받는다** — 훅이 createClient() 를 다시 부르면 인스턴스가
//     하나 더 생긴다.
//   · 여덟 개 핸들러를 useOutsideClick·useListKeyboard **앞에** 두었다. 원본은 뒤에 두고 클로저로
//     앞에서 참조했는데(page.tsx 의 옛 211~212줄), 그 모양이 react-compiler 린트의
//     「Cannot access variable before it is declared」에 걸린다. 핸들러는 그냥 const 함수라
//     선언 위치를 올려도 훅 호출 순서·effect 순서는 그대로다
//     (useOutsideClick 둘 → useListKeyboard 둘 순서가 원본과 같다).

import { useCallback, useRef, useState } from 'react'
import { searchOr, withNameEnFallback } from '@/lib/nameEn'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useOutsideClick } from '@/hooks/useOutsideClick'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import type { CustomerResult } from '@/app/quote/types'
import type { SalesOpportunity } from '@/components/customer/types'
import { parentCompanyName } from '@/components/customer/ParentPicker'
import { NOT_AGENCY_ONLY } from '@/lib/customerAgency'
import { type CustomerRole, isAgencyPick, mergeCustomerPicks } from '@/lib/quoteCustomerPick'

export type UseQuoteCustomerArgs = {
  supabase: SupabaseClient
  /** 칸 옆 빨간 글씨를 지우는 데 쓴다(useFieldErrors 의 clearError). */
  clearError: (key: 'company' | 'eu' | 'items' | 'expenses') => void
}

export function useQuoteCustomer({ supabase, clearError }: UseQuoteCustomerArgs) {
  const [company, setCompany] = useState('')
  const [isDealer, setIsDealer] = useState(false)

  const [customerId, setCustomerId] = useState<number | null>(null)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerResult[]>([])
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false)
  // ?customer= 로 넘어왔는데 후보가 여러 건일 때 띄우는 안내(사용자가 직접 골라야 저장된다)
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerResult | null>(null)
  // 영업기회 연결 (선택 사항). 견적 계산·PDF 와는 무관한 내부 정보다.
  const [opportunities, setOpportunities] = useState<SalesOpportunity[]>([])
  const [opportunityId, setOpportunityId] = useState<number | null>(null)

  const [euCustomerId, setEuCustomerId] = useState<number | null>(null)
  const [euQuery, setEuQuery] = useState('')
  const [euResults, setEuResults] = useState<CustomerResult[]>([])
  const [euSearchOpen, setEuSearchOpen] = useState(false)
  const [selectedEU, setSelectedEU] = useState<CustomerResult | null>(null)
  // 고른 E.U 사업장을 묶는 **회사 이름**. 견적서에는 이 이름이 찍힌다(lib/quoteEuName.ts).
  // 입력칸(euQuery)은 고른 사업장 이름 그대로 두고, 문서 표기만 갈아탄다.
  const [euParentName, setEuParentName] = useState<string | null>(null)
  // 마지막으로 회사 이름을 물어본 사업장 id. 연달아 고를 때 늦게 온 답을 버리는 데 쓴다.
  const euParentReqRef = useRef<number | null>(null)

  // 사명·E.U 검색 드롭다운 — 바깥 클릭(및 ESC)으로 닫는다(품목 검색창과 동일 방식).
  // 드롭다운이 ref 안쪽에 있어 항목 클릭은 '바깥'으로 판정되지 않는다.
  // 사명 검색은 조회를 둘(사업장·대리점) 보낸다 — 늦게 온 답을 버리는 데 쓴다.
  const customerSearchReqRef = useRef(0)
  const customerSearchRef = useRef<HTMLDivElement | null>(null)
  const euSearchRef = useRef<HTMLDivElement | null>(null)
  // 후보 목록의 ↓/↑·Enter. 닫기(Esc·바깥 클릭)는 아래 useOutsideClick 이 이미 맡고 있다.
  const customerListRef = useRef<HTMLDivElement | null>(null)
  const euListRef = useRef<HTMLDivElement | null>(null)

  /**
   * 사명 칸의 검색 — **사업장과 대리점을 한 번에 찾는다**(2026-11-20).
   *
   * 전에는 옆의 「대리점」 체크가 검색 대상을 갈랐다(직판이면 사업장, 켜면 대리점 줄만).
   * 고르려는 곳이 대리점인지 **먼저 알아야** 검색이 되는 순서였다. 이제는 두 조회를 함께
   * 보내 한 목록으로 세우고, 대리점 줄에 꼬리표를 붙여 **고른 줄이 역할을 말하게** 한다.
   *
   *   사업장 조회  is_parent=false + 대리점 전용 줄 제외(NOT_AGENCY_ONLY)
   *   대리점 조회  is_agency=true
   *
   * 조회 조건은 둘 다 **체크박스 시절 그대로**다 — 뜨는 줄의 범위는 바뀌지 않는다.
   * 대리점이면서 우리 고객인 사업장(이룸지텍·하나무역 등 15곳)은 양쪽에 다 걸려
   * **역할 두 줄**로 뜬다. 같은 줄이라도 들어가는 컬럼이 달라 고르는 사람이 정해야 한다
   * (lib/quoteCustomerPick.ts).
   */
  const handleCustomerSearch = async (q: string) => {
    setCustomerQuery(q)
    if (!q.trim()) { setCustomerResults([]); return }
    // 조회가 둘이라 답이 엇갈릴 수 있다 — 마지막으로 보낸 글자의 답만 받는다.
    const req = ++customerSearchReqRef.current
    // 회사명·사업장명·영문명을 함께 본다(사업장명만으로 찾는 사람도 있다).
    // 영문명 칸이 아직 없는 DB 면 그 칸만 빼고 한 번 더 읽는다 — lib/nameEn.ts.
    const run = (kind: CustomerRole) => withNameEnFallback(useEn => {
      const base = supabase
        .from('customers').select('customer_id, company_name, address, status')
        .is('deleted_at', null)
        .or(searchOr(q, useEn))
      const query = kind === 'agency'
        ? base.eq('is_agency', true)
        : base.eq('is_parent', false).or(NOT_AGENCY_ONLY)   // 부모 행(회사 묶음)·대리점 전용 줄 제외
      return query.limit(10)
    })
    const [sites, agencies] = await Promise.all([run('site'), run('agency')])
    if (customerSearchReqRef.current !== req) return
    setCustomerResults(mergeCustomerPicks(sites.data ?? [], agencies.data ?? []))
    setCustomerSearchOpen(true)
  }

  // 견적이 실제로 붙는 업체(대리점 건이면 E.U)의 진행 중 기회만 후보로 삼는다.
  // 업체가 바뀌면 후보를 다시 읽고 선택도 푼다 — 새 업체에 없는 기회가 남아 있으면 안 된다.
  // (칸 자체가 후보 유무로 나타났다 사라지므로, 선택이 화면에서 안 보이는 채 남는 일도 막는다)
  const loadOpportunities = async (cid: number | null) => {
    setOpportunityId(null)
    if (!cid) { setOpportunities([]); return }
    const { data, error } = await supabase
      .from('sales_opportunities')
      .select('*')
      .eq('customer_id', cid)
      .order('created_at', { ascending: false })
    if (error) { console.error('[quote] load opportunities failed', error); setOpportunities([]); return }
    setOpportunities((data as SalesOpportunity[]) ?? [])
  }

  const handleEUSearch = async (q: string) => {
    setEuQuery(q)
    if (!q.trim()) { setEuResults([]); return }
    const { data } = await withNameEnFallback(useEn => supabase
      .from('customers').select('customer_id, company_name, address, status')
      .is('deleted_at', null)
      .eq('is_parent', false)   // 부모 행(회사 묶음)은 견적 대상이 아니다
      .or(NOT_AGENCY_ONLY)      // 대리점 전용 줄은 최종 사용 업체가 아니다
      .or(searchOr(q, useEn)).limit(10))
    setEuResults(data || [])
    setEuSearchOpen(true)
  }

  /**
   * E.U 사업장을 묶는 회사 이름을 구해 둔다 — 견적서에 찍을 이름이다.
   * 수신처(handleCustomerSelect)와 **같은 조회**를 쓴다. 선택할 때 한 번만 부른다.
   *
   * 뒤늦게 와도 된다(미리보기·저장 모두 그때 값을 읽는다). 다만 연달아 고르면 먼저 보낸 답이
   * 나중에 올 수 있어, 지금 고른 사업장의 답만 받는다 — 다른 업체의 회사 이름이 문서에 찍히면
   * 고객이 받는 종이가 틀린다. `null` 을 넘기면 지운다(해제·초기화).
   */
  const resolveEuParent = (customerId: number | null) => {
    euParentReqRef.current = customerId
    setEuParentName(null)
    if (customerId == null) return
    parentCompanyName(customerId)
      .then(name => { if (euParentReqRef.current === customerId) setEuParentName(name) })
      .catch(e => console.error('[quote] E.U 소속 회사 조회 실패', { customerId, error: e }))
  }

  /** E.U 칸을 비운다 — 사명 칸에서 사업장을 고르면(= 직판) 남아 있을 자리가 없다. */
  const clearEu = () => {
    setSelectedEU(null)
    setEuCustomerId(null)
    setEuQuery('')
    resolveEuParent(null)
  }

  // company 는 화면 입력칸이 아니라 PDF 의 「○○ 귀하」 한 줄에만 쓰는 값이다.
  // 업체가 회사(부모) 아래 묶여 있으면 수신처는 회사 이름이어야 한다
  // — 「현대트랜시스(성연공장) 귀하」 는 문서로 나가기에 어색하다.
  // 검색·선택·저장은 종전대로 업체(customer_id) 기준이라 내부에서 어느 업체인지는 그대로 보인다.
  // 대리점 건이면 이 칸이 대리점이므로 같은 규칙이 대리점에도 적용된다. E.U 는 손대지 않는다.
  //
  // **고른 줄의 역할이 대리점 체크박스를 대신한다**(2026-11-20) — 대리점 줄을 고르면
  // isDealer 가 켜져 E.U 칸이 열리고, 사업장 줄을 고르면 꺼지며 E.U 를 비운다.
  // 역할이 없는 줄(포캐스트·수리 prefill 의 조회)은 사업장으로 본다.
  const handleCustomerSelect = (c: CustomerResult) => {
    const asAgency = isAgencyPick(c)
    setIsDealer(asAgency)
    setSelectedCustomer(c)
    setCustomerId(c.customer_id)
    setCompany(c.company_name)
    setCustomerQuery(c.company_name)
    setCustomerSearchOpen(false)
    setCustomerResults([])
    clearError('company')
    // 영업기회 후보는 **견적이 실제로 붙는 업체**(대리점 건이면 E.U) 기준이다.
    // 대리점을 고른 순간 E.U 는 아직 비어 있으므로 후보도 비운다.
    if (asAgency) { clearEu(); loadOpportunities(null) }
    else loadOpportunities(c.customer_id)
    // 회사 이름은 뒤늦게 와도 된다 — 미리보기·저장 모두 이 값을 그때 읽는다.
    parentCompanyName(c.customer_id)
      .then(name => { if (name) setCompany(name) })
      .catch(e => console.error('[quote] parent lookup failed', e))
  }

  // 사명을 비우면 **고른 역할도 함께 풀린다** — 대리점 뱃지와 E.U 칸이 남으면
  // 무엇으로 저장될지 화면이 말해 주지 못한다.
  const handleCustomerClear = () => {
    setSelectedCustomer(null)
    setCustomerId(null)
    setCustomerQuery('')
    setCompany('')
    setIsDealer(false)
    clearEu()
    loadOpportunities(null)
  }

  const handleEUSelect = (c: CustomerResult) => {
    setSelectedEU(c)
    setEuCustomerId(c.customer_id)
    setEuQuery(c.company_name)
    setEuSearchOpen(false)
    setEuResults([])
    loadOpportunities(c.customer_id)
    resolveEuParent(c.customer_id)
  }

  const handleEUClear = () => {
    clearEu()
    loadOpportunities(null)
  }

  useOutsideClick(customerSearchRef, useCallback(() => setCustomerSearchOpen(false), []), customerSearchOpen)
  useOutsideClick(euSearchRef, useCallback(() => setEuSearchOpen(false), []), euSearchOpen)
  const customerKeys = useListKeyboard(customerResults, customerSearchOpen, customerListRef, c => handleCustomerSelect(c))
  const euKeys = useListKeyboard(euResults, euSearchOpen, euListRef, c => handleEUSelect(c))

  return {
    company, setCompany,
    isDealer, setIsDealer,
    customerId, setCustomerId,
    customerQuery, setCustomerQuery,
    customerResults, setCustomerResults,
    customerSearchOpen, setCustomerSearchOpen,
    prefillNotice, setPrefillNotice,
    selectedCustomer, setSelectedCustomer,
    opportunities, setOpportunities, opportunityId, setOpportunityId,
    euCustomerId, setEuCustomerId,
    euQuery, setEuQuery,
    euResults, setEuResults,
    euSearchOpen, setEuSearchOpen,
    selectedEU, setSelectedEU,
    euParentName,
    customerSearchRef, euSearchRef, customerListRef, euListRef,
    customerKeys, euKeys,
    handleCustomerSearch,
    loadOpportunities,
    handleCustomerSelect,
    handleCustomerClear,
    handleEUSearch,
    resolveEuParent,
    handleEUSelect,
    handleEUClear,
  }
}
