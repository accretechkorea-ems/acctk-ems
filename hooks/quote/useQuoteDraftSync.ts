'use client'

// 견적 작성 화면의 **임시저장**(localStorage) — 저장분 확인 · 되돌리기 · 자동 저장.
//
// app/quote/page.tsx 에서 **그대로 옮겨 온 것**이다(분리 리팩터 3a). 본문·주석·의존성 배열·
// eslint-disable 주석을 한 글자도 바꾸지 않았다.
//
// **순서가 규칙이다.** effect 두 개가 선언된 순서(① 저장분 확인 → ② 자동 저장)가 원본과 같고,
// ② 는 `draftReady` 가 서기 전에는 아무것도 쓰지 않는다 — 즉 **임시저장 모달에 답하기 전에는
// 자동 저장이 시작되지 않는다**(빈 화면이 저장분을 덮어쓰는 것을 막는 장치다).
// draftReady 가 서는 길은 셋뿐이다: 저장분이 없다 · 주소 프리필로 들어와 저장분을 버렸다 ·
// 모달에서 「새로 쓰기」나 「이어쓰기」를 눌렀다.

import { useEffect, useRef, useState } from 'react'
import type { CustomerResult, QuoteRow } from '@/app/quote/types'
import { calcRow } from '@/app/quote/calc'
import { DEFAULT_TERMS, isAllDefault, promoteLegacyDelivery, type Terms } from '@/lib/quoteTerms'
import { activeQuoteCategories, loadQuoteCategories } from '@/lib/quoteCategories'
import { isFormKind } from '@/lib/quoteForms'
import { loadDraft, saveDraft, clearDraft, isDraftMeaningful, type QuoteDraft } from '@/lib/quoteDraft'
import { resolveOnBehalf, type OnBehalfAssignee } from '@/lib/quoteMutations'
import type { useToast } from '@/components/common/Toast'

export type UseQuoteDraftSyncArgs = {
  toast: ReturnType<typeof useToast>
  /** 값을 넣는 시점의 최신 환율(page.tsx 의 rateRef). */
  rateRef: { current: number }
  engineer: { engineer_id: number } | null
  /** 주소로 들어온 프리필이 있으면 저장분은 묻지 않고 버린다. */
  hasUrlPrefill: boolean

  // 자동 저장이 담는 값(그 순간의 최신 상태)
  onBehalf: OnBehalfAssignee | null
  company: string
  customerId: number | null
  selectedCustomer: CustomerResult | null
  customerQuery: string
  isDealer: boolean
  euCustomerId: number | null
  selectedEU: CustomerResult | null
  euQuery: string
  opportunityId: number | null
  receiver: string
  remarks: string
  showSignature: boolean
  termsOpen: boolean
  terms: Terms
  rows: QuoteRow[]
  /** 견적 분류. 옛 초안에는 없으므로 되살릴 때 없으면 빈 글자로 둔다. */
  category: string
  /** 견적서 양식. 분류와 같은 규칙(옛 초안에는 없다). */
  formKind: string
  setCategory: React.Dispatch<React.SetStateAction<string>>
  setFormKind: React.Dispatch<React.SetStateAction<string>>

  // 자동 저장의 트리거 — PDF 미리보기가 쓰는 600ms debounce 값을 그대로 쓴다
  debouncedRows: QuoteRow[]
  debouncedCompany: string
  debouncedReceiver: string
  debouncedFinalRemarks: string

  // 저장분을 되돌릴 때 쓰는 화면 setter 들
  setCompany: React.Dispatch<React.SetStateAction<string>>
  setCustomerId: React.Dispatch<React.SetStateAction<number | null>>
  setSelectedCustomer: React.Dispatch<React.SetStateAction<CustomerResult | null>>
  setCustomerQuery: React.Dispatch<React.SetStateAction<string>>
  setIsDealer: React.Dispatch<React.SetStateAction<boolean>>
  setEuCustomerId: React.Dispatch<React.SetStateAction<number | null>>
  setSelectedEU: React.Dispatch<React.SetStateAction<CustomerResult | null>>
  setEuQuery: React.Dispatch<React.SetStateAction<string>>
  resolveEuParent: (customerId: number | null) => void
  setReceiver: React.Dispatch<React.SetStateAction<string>>
  setRemarks: (v: string | null) => void
  setShowSignature: React.Dispatch<React.SetStateAction<boolean>>
  setTermsOpen: React.Dispatch<React.SetStateAction<boolean>>
  setTerms: React.Dispatch<React.SetStateAction<Terms>>
  setRows: React.Dispatch<React.SetStateAction<QuoteRow[]>>
  loadOpportunities: (cid: number | null) => Promise<void>
  setOpportunityId: React.Dispatch<React.SetStateAction<number | null>>
  setOnBehalf: React.Dispatch<React.SetStateAction<OnBehalfAssignee | null>>
}

export function useQuoteDraftSync({
  toast, rateRef, engineer, hasUrlPrefill,
  onBehalf, company, customerId, selectedCustomer, customerQuery, isDealer,
  euCustomerId, selectedEU, euQuery, opportunityId,
  receiver, remarks, showSignature, termsOpen, terms, rows,
  category, formKind, setCategory, setFormKind,
  debouncedRows, debouncedCompany, debouncedReceiver, debouncedFinalRemarks,
  setCompany, setCustomerId, setSelectedCustomer, setCustomerQuery, setIsDealer,
  setEuCustomerId, setSelectedEU, setEuQuery, resolveEuParent,
  setReceiver, setRemarks, setShowSignature, setTermsOpen, setTerms, setRows,
  loadOpportunities, setOpportunityId, setOnBehalf,
}: UseQuoteDraftSyncArgs) {
  // 임시저장 — 저장분이 있으면 이어쓸지 먼저 묻는다. 답하기 전에는 자동 저장을 시작하지 않는다
  // (빈 화면이 저장분을 덮어써 버리기 때문).
  const [draftAsk, setDraftAsk] = useState<QuoteDraft | null>(null)
  const [draftReady, setDraftReady] = useState(false)

  // ── 임시저장: 저장분 확인 (1회) ──
  // 계정이 정해진 뒤에 본다 — 키가 engineer_id 라 남의 저장분은 애초에 읽히지 않는다.
  const draftCheckDone = useRef(false)
  useEffect(() => {
    if (draftCheckDone.current || !engineer) return
    draftCheckDone.current = true
    if (hasUrlPrefill) { clearDraft(engineer.engineer_id); setDraftReady(true); return }
    const d = loadDraft(engineer.engineer_id)
    if (d) setDraftAsk(d)
    else setDraftReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineer])

  // 저장분을 화면에 되돌린다.
  // 대필만 저장된 값을 쓰지 않고 서버에 다시 물어본다 — localStorage 를 고쳐
  // 남의 실적으로 견적을 만드는 길을 막기 위해서다(id 만 저장하는 이유).
  const applyDraft = async (d: QuoteDraft) => {
    setCompany(d.company); setCustomerId(d.customerId); setSelectedCustomer(d.selectedCustomer)
    setCustomerQuery(d.customerQuery); setIsDealer(d.isDealer)
    setEuCustomerId(d.euCustomerId); setSelectedEU(d.selectedEU); setEuQuery(d.euQuery)
    // 회사 이름은 저장분에 담지 않는다(초안 형식을 바꾸지 않는다) — 되살릴 때 다시 구한다.
    resolveEuParent(d.euCustomerId)
    setReceiver(d.receiver); setRemarks(d.remarks); setShowSignature(d.showSignature)
    // 조건은 **선택 필드**다 — 옛 초안에는 없으므로 없으면 닫힌 기본 상태로 둔다.
    // 옛 초안은 납기를 따로 담고 있다(delivery) — 납품일정이 기본값이면 그 값을 올린다.
    const draftTerms = promoteLegacyDelivery(
      d.terms ? { ...DEFAULT_TERMS, ...d.terms } : { ...DEFAULT_TERMS }, d.delivery)
    setTermsOpen(d.termsOpen === true || !isAllDefault(draftTerms))
    setTerms(draftTerms)
    // 분류는 **선택 필드**다 — 옛 초안에는 없으므로 없으면 빈 글자(미선택)로 둔다.
    // 그 사이에 비활성이 된 분류도 비운다 — 선택칸에 없는 값이 남으면 칸은 비어 보이는데
    // 확정은 통과해 버린다(목록은 모듈 캐시라 기다려도 비용이 없다).
    const draftCategory = typeof d.category === 'string' ? d.category : ''
    const activeList = activeQuoteCategories(await loadQuoteCategories())
    setCategory(activeList.some(c => c.code === draftCategory) ? draftCategory : '')
    // 양식도 **선택 필드**다. 모르는 값이면 비워 다시 고르게 한다.
    setFormKind(isFormKind(d.formKind) ? d.formKind : '')
    setRows(d.rows.map(r => calcRow(r, rateRef.current)))
    // 영업기회 목록은 고객사에 딸린 값이라 다시 불러온 뒤 저장분의 선택을 되돌린다.
    if (d.customerId != null && !d.isDealer) {
      await loadOpportunities(d.customerId)
      setOpportunityId(d.opportunityId)
    }
    setDraftAsk(null); setDraftReady(true)
    if (d.onBehalfId != null) {
      const r = await resolveOnBehalf(d.onBehalfId)
      if (r.ok) setOnBehalf(r.assignee)
      else toast.error(r.error || '대필 상태를 되살리지 못했습니다')
    }
  }

  // ── 임시저장: 자동 저장 ──
  // PDF 미리보기가 쓰는 600ms debounce 값을 그대로 트리거로 삼는다(타이핑마다 쓰지 않는다).
  // 저장하는 값은 그 순간의 최신 상태다.
  useEffect(() => {
    if (!engineer || !draftReady) return
    const draft = {
      onBehalfId: onBehalf?.engineer_id ?? null,
      company, customerId, selectedCustomer, customerQuery, isDealer,
      euCustomerId, selectedEU, euQuery, opportunityId,
      receiver, remarks, showSignature, termsOpen, terms, rows,
      category, formKind,
    }
    if (isDraftMeaningful(draft)) saveDraft(engineer.engineer_id, draft)
    else clearDraft(engineer.engineer_id)   // 다 지운 뒤에는 저장분도 없애 안내가 뜨지 않게 한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineer, draftReady, debouncedRows, debouncedCompany, debouncedReceiver, debouncedFinalRemarks,
      onBehalf, customerId, selectedCustomer, isDealer, euCustomerId, selectedEU, opportunityId, showSignature,
      termsOpen, terms])

  return { draftAsk, setDraftAsk, draftReady, setDraftReady, applyDraft }
}
