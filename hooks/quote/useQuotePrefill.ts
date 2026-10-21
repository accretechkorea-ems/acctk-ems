'use client'

// 견적 작성 화면의 **주소 파라미터 프리필** 세 가지 — ?duplicate / ?on_behalf / ?repair_id.
//
// app/quote/page.tsx 에서 **그대로 옮겨 온 것**이다(분리 리팩터 3a). 본문·주석·의존성 배열·
// eslint-disable 주석을 한 글자도 바꾸지 않았다.
//
// **effect 선언 순서가 원본과 같다**(다시쓰기 → 대필 → 수리 건 prefill). 원본에서는 다시쓰기와
// 대필 사이에 「부대비용 프리셋 1회 로드」 effect 가 끼어 있었는데, 그것은 프리필과 무관해
// page.tsx 에 남겼고 이 훅 **뒤에서** 돈다. 셋 다 마운트 때 비동기 조회를 띄우기만 하므로
// 완료 순서는 원래부터 네트워크가 정했다(화면에 보이는 결과는 같다).
//
// 세 파라미터는 **값 자체를 믿지 않는다** — 다시쓰기·대필은 서버가 권한을 판정하고 돌려준
// 내용만 쓴다. 그 규칙은 서버(/api/quote-duplicate · /api/quote-on-behalf)에 있다.

import { useEffect, useRef } from 'react'
import type { ReadonlyURLSearchParams } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerResult, ExpenseRow, PriceItem, QuoteRow, RowKind } from '@/app/quote/types'
import { calcExpense, calcRow, createExpenseRow, createRow } from '@/app/quote/calc'
import { defaultTermsFor, isAllDefault, promoteLegacyDelivery, termsOf, type SetTerms } from '@/lib/quoteTerms'
import { subLinesOf } from '@/lib/quoteSubLines'
import { activeQuoteCategories, canSplitRowKind, loadQuoteCategories } from '@/lib/quoteCategories'
import { canGroupRowKind, isFormKind, isGroupKind } from '@/lib/quoteForms'
import { parentCompanyName } from '@/components/customer/ParentPicker'
import { resolveOnBehalf, type OnBehalfAssignee } from '@/lib/quoteMutations'
import type { useToast } from '@/components/common/Toast'

// /api/quote-duplicate 응답. 원본 견적의 '입력값' 만 담는다(금액은 새 환율로 다시 계산한다).
export type DuplicatePayload = {
  quote: {
    quote_number: string
    customer_id: number | null; dealer_id: number | null; opportunity_id: number | null
    recipient: string | null; delivery_info: string | null; note: string | null; quote_type: string | null
    /** 조건 네 줄(quotes.terms). null 이면 모두 기본값이다. */
    terms: unknown
    /** 견적 분류(quotes.category). null 이면 미분류(개편 전 견적)다. */
    category: string | null
    /** 견적서 양식(quotes.form_kind). null 이면 기존 양식(개편 전 견적)이다. */
    form_kind: string | null
  }
  items: {
    price_list_id: number | null; part_code: string | null; row_kind: string | null
    product_name: string | null; quantity: number | null; unit_price_jpy: number | null
    unit_price_krw: number | null; supply_amount: number | null
    profit_rate: number | null; tariff_rate: number | null
    /** 품명 아래 설명 줄(quote_items.sub_lines). null 이면 줄이 없다. */
    sub_lines: unknown
    /** 줄별 분류(quote_items.category). null 이면 견적 분류를 따랐다. */
    category: string | null
    /** 장비 구성 묶음(quote_items.group_kind). null 이면 묶음이 없었다. */
    group_kind: string | null
    price_list: PriceItem | null
  }[]
  expenses: { item_name: string | null; unit_price: number | null; headcount: number | null; days: number | null }[]
}

export type UseQuotePrefillArgs = {
  supabase: SupabaseClient
  toast: ReturnType<typeof useToast>
  searchParams: ReadonlyURLSearchParams
  /** 값을 넣는 시점의 최신 환율(page.tsx 의 rateRef). */
  rateRef: { current: number }
  duplicateId: number | null
  onBehalfId: number | null
  repairId: number | null
  engineer: { engineer_id: number } | null
  setOnBehalf: React.Dispatch<React.SetStateAction<OnBehalfAssignee | null>>
  setRows: React.Dispatch<React.SetStateAction<QuoteRow[]>>
  setIsDealer: React.Dispatch<React.SetStateAction<boolean>>
  setCustomerId: React.Dispatch<React.SetStateAction<number | null>>
  setEuCustomerId: React.Dispatch<React.SetStateAction<number | null>>
  setSelectedCustomer: React.Dispatch<React.SetStateAction<CustomerResult | null>>
  setCustomerQuery: React.Dispatch<React.SetStateAction<string>>
  setCompany: React.Dispatch<React.SetStateAction<string>>
  setSelectedEU: React.Dispatch<React.SetStateAction<CustomerResult | null>>
  setEuQuery: React.Dispatch<React.SetStateAction<string>>
  resolveEuParent: (customerId: number | null) => void
  setReceiver: React.Dispatch<React.SetStateAction<string>>
  setTermsOpen: React.Dispatch<React.SetStateAction<boolean>>
  setTerms: SetTerms
  setRemarks: (v: string | null) => void
  setCategory: React.Dispatch<React.SetStateAction<string>>
  setFormKind: React.Dispatch<React.SetStateAction<string>>
  setLineSplitOn: React.Dispatch<React.SetStateAction<boolean>>
  loadOpportunities: (cid: number | null) => Promise<void>
  setOpportunityId: React.Dispatch<React.SetStateAction<number | null>>
  handleCustomerSelect: (c: CustomerResult) => void
  setCustomerResults: React.Dispatch<React.SetStateAction<CustomerResult[]>>
  setCustomerSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  setPrefillNotice: React.Dispatch<React.SetStateAction<string | null>>
}

export function useQuotePrefill({
  supabase, toast, searchParams, rateRef,
  duplicateId, onBehalfId, repairId, engineer,
  setOnBehalf, setRows, setIsDealer, setCustomerId, setEuCustomerId,
  setSelectedCustomer, setCustomerQuery, setCompany, setSelectedEU, setEuQuery,
  resolveEuParent, setReceiver, setTermsOpen, setTerms, setRemarks,
  setCategory, setFormKind, setLineSplitOn,
  loadOpportunities, setOpportunityId, handleCustomerSelect,
  setCustomerResults, setCustomerSearchOpen, setPrefillNotice,
}: UseQuotePrefillArgs) {
  // ── 다시쓰기: 서버가 돌려준 원본 내용을 화면 상태로 되돌린다 ──
  // 환율만 오늘 것을 쓴다. 각 행의 exchange_rate 를 0 으로 비워 두면 calcRow 가 현재 환율을 잡는다
  // — 과거 환율이 남으면 단가가 그때 값으로 굳어 버린다.
  const applyDuplicate = async (payload: DuplicatePayload) => {
    const { quote, items, expenses } = payload
    // 분류 목록을 **여기서 기다린다.** prop 으로 받으면 목록이 늦게 오는 경우 멀쩡한 분류를
    // 「비활성」으로 잘못 보고 비워 버린다(둘 다 마운트 때 띄우는 조회라 도착 순서가 갈린다).
    // loadQuoteCategories 는 모듈 캐시라 이미 읽었으면 그 자리에서 돌아온다.
    const activeList = activeQuoteCategories(await loadQuoteCategories())
    // 부대비용은 서비스비 행 하나에 통째로 붙는다(견적당 1건).
    const expenseRows: ExpenseRow[] = expenses.map(e => calcExpense({
      ...createExpenseRow(),
      item_name: e.item_name ?? '', unit_price: Number(e.unit_price) || 0,
      headcount: Number(e.headcount) || 0, days: Number(e.days) || 0,
    }))
    const built: QuoteRow[] = items.map(it => {
      const kind = (it.row_kind as RowKind) || 'price_list'
      const unitKrw = Number(it.unit_price_krw) || 0
      const base = createRow()
      return calcRow({
        ...base,
        row_kind: kind,
        itemText: it.product_name ?? '',
        partCode: it.part_code ?? '',
        quantity: Number(it.quantity) || base.quantity,
        tariff_rate: it.tariff_rate == null ? base.tariff_rate : Number(it.tariff_rate),
        // 저장된 값은 목표값이 아니라 실현 이익률이다. 그대로 목표값 자리에 넣고 새 환율로 다시 계산한다.
        profit_rate: Number(it.profit_rate) || 0,
        exchange_rate: 0,
        selectedItem: it.price_list ?? null,
        manual_cost_jpy: kind === 'manual_jpy' ? Number(it.unit_price_jpy) || 0 : 0,
        // 모델은 아직 quote_items 에 칸이 없어 되살릴 값이 없다(createRow 의 빈 글자를 쓴다).
        // 칸이 생기면 /api/quote-duplicate 의 select 에 model_name 을 더하고 여기서 받는다.
        // 할인은 사용자가 양수로 넣는 값이라 음수 공급가를 되돌린다.
        manual_unit_price: kind === 'discount' ? Math.abs(Number(it.supply_amount) || 0) : unitKrw,
        // price_mode 는 저장되지 않는다. 이익률 모드는 반드시 1,000원 올림을 하므로
        // 단가가 1,000원 배수가 아니면 판매가 모드였던 것이 확실하다. 배수면 기본값(rate)으로 둔다.
        price_mode: (kind === 'price_list' || kind === 'manual_jpy') && unitKrw % 1000 !== 0 ? 'price' : 'rate',
        // 품명 아래 설명 줄 — 저장값을 그대로 되살린다. 없거나 깨졌으면 빈 배열이다(subLinesOf).
        subLines: subLinesOf(it.sub_lines),
        // 줄별 분류 — **살아 있는 분류이고 매출 줄일 때만** 되살린다.
        // 비활성이 된 분류를 그대로 들고 오면 선택칸에 없는 값이 남아 고칠 수 없다.
        category: (canSplitRowKind(kind) && it.category != null
          && activeList.some(c => c.code === it.category)) ? it.category : null,
        // 구성 묶음 — 아는 값이고 묶음을 둘 수 있는 줄일 때만 되살린다.
        group_kind: (canGroupRowKind(kind) && isGroupKind(it.group_kind)) ? it.group_kind : null,
        expenses: kind === 'service' ? expenseRows : [],
      }, rateRef.current)
    })
    setRows(built.length > 0 ? built : [createRow()])

    // 견적 분류 — 원본 값을 그대로 가져온다. 다만 **미분류(null)거나 비활성이 된 분류**면
    // 비워 둬서 다시 고르게 한다(없는 값을 고른 것처럼 보이면 그대로 확정될 수 있다).
    const dupCategory = quote.category != null && activeList.some(c => c.code === quote.category)
      ? quote.category
      : ''
    setCategory(dupCategory)
    // 되살린 줄 중에 분류가 들어간 것이 있으면 「분류 나누기」를 켜 둔다 — 그러지 않으면
    // 값이 있는데 화면에 선택칸이 없어 보이지 않는다.
    setLineSplitOn(built.some(r => r.category != null))
    // 양식 — 원본 값을 그대로. null(기존 양식)이거나 모르는 값이면 비워 다시 고르게 한다.
    setFormKind(isFormKind(quote.form_kind) ? quote.form_kind : '')

    // 대리점 견적이면 청구처가 대리점(dealer_id), 최종 사용 업체가 customer_id 다.
    const dealer = quote.dealer_id != null
    const mainId = dealer ? quote.dealer_id : quote.customer_id
    const euId = dealer ? quote.customer_id : null
    setIsDealer(dealer)
    setCustomerId(mainId); setEuCustomerId(euId)
    const ids = [mainId, euId].filter((v): v is number => v != null)
    if (ids.length > 0) {
      const { data } = await supabase.from('customers')
        .select('customer_id, company_name, address, status').in('customer_id', ids)
      const find = (id: number | null) => (data ?? []).find(c => c.customer_id === id) ?? null
      const main = find(mainId), eu = find(euId)
      if (main) { setSelectedCustomer(main); setCustomerQuery(main.company_name); setCompany(main.company_name) }
      if (eu) { setSelectedEU(eu); setEuQuery(eu.company_name) }
      // 수신처는 소속회사 이름이 우선이다(작성 화면의 고객사 선택과 같은 규칙).
      if (mainId != null) parentCompanyName(mainId).then(name => { if (name) setCompany(name) }).catch(() => {})
      // E.U 도 같은 규칙으로 다시 구한다 — 원본 비고의 E.U 줄은 아래에서 떼어 내고 새로 조립한다.
      resolveEuParent(euId)
    }

    setReceiver(quote.recipient ?? '')
    // 조건 네 줄 — 원본에 바꾼 값이 있으면 체크를 켜고 채운다. 없으면 **닫힌 기본 상태**다.
    // 옛 견적은 납기를 delivery_info 에만 담고 있다(납기 칸이 있던 시절) — 납품일정이
    // 기본값이면 그 값을 올린다(규칙·예외는 promoteLegacyDelivery 에 있다).
    {
      // 기본값은 **그 견적의 양식**을 따른다 — 조건을 바꾸지 않은 견적은 terms 가 null 이라,
      // 양식을 모르면 다른 문구로 되살아난다(20 견적서는 지불조건이 다르다).
      const base = defaultTermsFor(quote.form_kind)
      const restored = promoteLegacyDelivery(termsOf(quote.terms, base), quote.delivery_info)
      const changed = !isAllDefault(restored, undefined, base)
      setTermsOpen(changed)
      setTerms(changed ? restored : null)
    }
    // note 에는 납기·E.U 줄이 합쳐져 저장된다. 그 둘은 각자 칸에서 다시 만들어지므로 본문만 남긴다.
    setRemarks((quote.note ?? '').split('\n')
      .filter(line => !/^\*\s*납기\s*:/.test(line) && !/^\*\s*E\.U/.test(line))
      .join('\n').trim())

    // 영업기회는 아직 살아 있을 때만 잇는다(수주·종료된 기회에 새 견적을 달지 않는다).
    if (!dealer && mainId != null) {
      await loadOpportunities(mainId)
      const { data: opps } = await supabase.from('sales_opportunities')
        .select('opportunity_id').eq('customer_id', mainId)
      const alive = (opps ?? []).some(o => o.opportunity_id === quote.opportunity_id)
      setOpportunityId(alive ? quote.opportunity_id : null)
    }
    toast.success(`${quote.quote_number} 의 내용을 불러왔습니다. 확정하면 새 번호로 발급됩니다`)
  }

  // ── 다시쓰기 (1회) ──
  // 원본은 그대로 두고 내용만 가져온다. 확정하면 새 번호가 발급된다(번호 규칙은 손대지 않는다).
  const duplicateDone = useRef(false)
  useEffect(() => {
    if (duplicateDone.current || duplicateId == null || !engineer) return
    duplicateDone.current = true
    const run = async () => {
      const res = await fetch('/api/quote-duplicate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: duplicateId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error || '견적을 불러오지 못했습니다'); return }
      applyDuplicate(json)
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicateId, engineer])

  // 대필 승인 (1회). 서버가 거절하면 대필 모드로 들어가지 않고 평소대로 본인 견적을 쓴다
  // — 거절 사유는 "영업관리가 아니다" 또는 "대필할 수 없는 담당자다" 둘 중 하나다.
  const onBehalfDone = useRef(false)
  useEffect(() => {
    if (onBehalfDone.current || onBehalfId == null) return
    onBehalfDone.current = true
    resolveOnBehalf(onBehalfId).then(r => {
      if (r.ok) { setOnBehalf(r.assignee); return }
      toast.error(r.error || '대필할 수 없습니다')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBehalfId])

  // 수리 건 → 견적서 prefill (1회). repair_id 가 유효할 때만. 없으면 일반 견적서로 동작.
  const prefillDone = useRef(false)
  useEffect(() => {
    if (prefillDone.current || repairId == null) return
    prefillDone.current = true
    const product = (searchParams.get('product') ?? '').trim()
    const serial = (searchParams.get('serial') ?? '').trim()
    const customer = (searchParams.get('customer') ?? '').trim()
    // product → 첫 품목 itemText, serial → 첫 품목 subLines
    if (product || serial) {
      setRows(prev => {
        if (prev.length === 0) return prev
        const first = { ...prev[0], itemText: product || prev[0].itemText, subLines: serial ? [serial] : prev[0].subLines }
        return [first, ...prev.slice(1)]
      })
    }
    // customer → customers ilike. 정확히 1건이면 자동선택.
    // 여러 건이면 고객사를 고르지 않으면 저장이 막히므로, 후보 목록을 바로 펼쳐 두고 안내한다.
    if (customer) {
      setCustomerQuery(customer)
      supabase.from('customers').select('customer_id, company_name, address, status')
        .is('deleted_at', null).eq('is_parent', false).ilike('company_name', `%${customer}%`).limit(10)
        .then(({ data }) => {
          if (!data || data.length === 0) return
          if (data.length === 1) { handleCustomerSelect(data[0]); return }
          setCustomerResults(data)
          setCustomerSearchOpen(true)
          setPrefillNotice('여러 업체가 검색되었습니다. 하나를 선택해주세요')
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repairId])
}
