'use client'

// 견적 작성 화면의 **기본 정보 카드** — 사명·대리점·E.U·영업기회·수신인·비고·서명란·조건.
//
// app/quote/page.tsx 에서 **그대로 옮겨 온 것**이다(분리 리팩터 3a). JSX·스타일·문구·주석을
// 한 글자도 바꾸지 않았다(들여쓰기 8칸만 덜어냈다). 카드 안에서만 쓰던 파생값
// (customerGuide·showCustomerLink·selectableOpportunities·remarksPreview·remarksEdited)과
// 입력칸 설명(TERM_PLACEHOLDERS)도 함께 가져왔다 — 화면에는 쓰는 곳이 없었다.
//
// 상태는 하나도 들고 있지 않다. 전부 화면(page.tsx)의 값과 setter 를 받아 쓴다.
// 비고·조건 묶음은 다음 단계(3a-7·3a-8)에서 다시 RemarksEditor·TermsEditor 로 나눈다.

import { useEffect, useState } from 'react'
import { FieldError, errBorder } from '@/components/common/fieldErrors'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import { isClosed } from '@/components/customer/opportunity'
import { euDisplayName } from '@/lib/quoteEuName'
import { siteListHref } from '@/lib/mapPopup'
import { contactOptionLabel } from '@/lib/quoteRecipient'
import { type RecipientSource, groupRecipients, isAgencyPick, pickKey } from '@/lib/quoteCustomerPick'
import type { Contact } from '@/components/customer/types'
import { type SetTerms, type Terms, TERM_LABELS, defaultTermsFor, termKeysFor } from '@/lib/quoteTerms'
import SearchSelect from '@/components/common/SearchSelect'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import RemarksEditor from '@/components/quote/RemarksEditor'
import TermsEditor from '@/components/quote/TermsEditor'
import LockedSection from '@/components/quote/LockedSection'
import type { CustomerResult } from '@/app/quote/types'
import type { QuoteCategory } from '@/lib/quoteCategories'
import { FORM_KINDS, FORM_LABELS } from '@/lib/quoteForms'
import type { SalesOpportunity } from '@/components/customer/types'
import { BLUE, BORDER, CARD_BG, MUTED } from '@/components/common/ui'
import { TEXT_LABEL } from '@/lib/textTokens'
import { R } from '@/lib/radius'
import { advanceQuoteFocus, focusQuoteStep, onlyContactId, registerQuoteFocus } from '@/lib/quoteFocus'


/**
 * 후보 목록의 키보드 조작 결과 — **훅의 반환 타입을 그대로** 쓴다.
 * 손으로 베껴 적었을 때는 setActive 가 (i: number) => void 였는데 실제로는 Dispatch 다.
 */
type ListKeys = ReturnType<typeof useListKeyboard<CustomerResult>>

/**
 * 사명 칸 — 검색·선택·해제.
 *
 * 「대리점」 체크박스는 없다(2026-11-20에 걷었다). 검색이 사업장과 대리점을 함께 돌려주고
 * **고른 줄의 역할**이 그 체크를 대신한다 — isDealer 는 받아서 **보여 주기만** 한다
 * (뱃지와 E.U 칸의 등장). 역할을 정하는 자리는 hooks/quote/useQuoteCustomer.ts 다.
 */
export type CustomerCardCustomer = {
  selectedCustomer: CustomerResult | null
  customerQuery: string
  customerResults: CustomerResult[]
  customerSearchOpen: boolean
  setCustomerSearchOpen: (v: boolean) => void
  customerKeys: ListKeys
  customerSearchRef: React.RefObject<HTMLDivElement | null>
  customerListRef: React.RefObject<HTMLDivElement | null>
  handleCustomerSearch: (q: string) => void
  handleCustomerSelect: (c: CustomerResult) => void
  handleCustomerClear: () => void
  prefillNotice: string | null
  setPrefillNotice: (v: string | null) => void
  /** 고른 줄이 대리점인가 — 뱃지와 E.U 칸을 가른다. 이 카드에서 바꾸지 않는다. */
  isDealer: boolean
}

/** E.U(최종 사용 업체) 칸 — **사명 칸에서 대리점을 고르면** 그려진다. */
export type CustomerCardEu = {
  euQuery: string
  euResults: CustomerResult[]
  euSearchOpen: boolean
  setEuSearchOpen: (v: boolean) => void
  euKeys: ListKeys
  euSearchRef: React.RefObject<HTMLDivElement | null>
  euListRef: React.RefObject<HTMLDivElement | null>
  selectedEU: CustomerResult | null
  euParentName: string | null
  handleEUSearch: (q: string) => void
  handleEUSelect: (c: CustomerResult) => void
  handleEUClear: () => void
}

/** 영업기회 연결 — 고를 것이 있을 때만 칸이 나타난다. */
export type CustomerCardOpportunity = {
  opportunities: SalesOpportunity[]
  opportunityId: number | null
  setOpportunityId: (v: number | null) => void
  /**
   * 그 자리에서 **새 포캐스트 한 건**을 만든다(2026-11-26). 제목·예상월만 받는다.
   * 넘기지 않으면 「새 포캐스트 만들기」 줄이 서지 않는다.
   */
  onCreate?: (args: { title: string; month: string }) => Promise<{ ok: true } | { ok: false; error: string }>
}

/**
 * 수신인 — **고객사 담당자 한 사람**을 고른다(quotes.recipient_contact_id).
 *
 * 글자를 치지 않는다. 담당자는 고객사 상세에서 관리하는 표(contacts)가 정본이고, 견적은
 * 그 줄을 가리키기만 한다 — 그래야 같은 사람이 「김강민 선임님」·「김강민 선임」으로 갈려
 * 적히지 않는다(lib/quoteRecipient.ts 머리말).
 */
export type CustomerCardRecipient = {
  contactId: number | null
  setContactId: (v: number | null) => void
  contacts: Contact[]
  loading: boolean
  /** 고객사를 아직 안 골랐으면 고를 거리가 없다 — 칸을 잠근다. */
  customerId: number | null
  /**
   * 후보를 묶는 업체들 — **대리점 건이면 둘**(대리점 · E.U)이다. 둘일 때만 묶음 제목을
   * 그린다(lib/quoteCustomerPick.ts 의 groupRecipients).
   */
  sources: RecipientSource[]
  /** 옛 견적을 다시 쓸 때만 찬다 — 「이전 수신인: …」 안내로만 쓴다. */
  legacyText: string
}

/** 문서에 찍히는 나머지 입력 — 비고·서명란·조건. */
export type CustomerCardDoc = {
  remarks: string
  setRemarks: (v: string) => void
  remarksOpen: boolean
  setRemarksOpen: React.Dispatch<React.SetStateAction<boolean>>
  /** 비고 기본 문구(page.tsx 의 DEFAULT_REMARKS). 「수정됨」 판정에 쓴다. */
  defaultRemarks: string
  showSignature: boolean
  setShowSignature: (v: boolean) => void
  termsOpen: boolean
  setTermsOpen: (v: boolean) => void
  terms: Terms
  setTerms: SetTerms
}

/**
 * 견적 분류 — **작성 첫 화면의 가장 위**다. 활성 분류만 고를 수 있고, 고르기 전에는 확정이
 * 막힌다(품목 입력은 막지 않는다 — 금액을 먼저 잡아 보는 흐름을 끊지 않으려고).
 * 「분류 나누기」를 켜면 각 품목 줄에 분류 선택칸이 생긴다(QuoteItemRow).
 */
export type CustomerCardCategory = {
  value: string
  setValue: (v: string) => void
  /** 고를 수 있는 분류(활성만). */
  categories: QuoteCategory[]
  loading: boolean
  /** 견적서 양식(quotes.form_kind). 분류와 같은 규칙으로 고르기 전에는 확정이 막힌다. */
  formKind: string
  setFormKind: (v: string) => void
}

// prop 은 일곱 개다(3b 정리 전에는 52개였다).
// errors·clearError 는 분류·사명·E.U 세 묶음이 함께 쓰는 검증 통로라 묶지 않고 그대로 둔다.
export type CustomerCardProps = {
  /** 분류·양식을 아직 고르지 않았는가 — 그렇다면 사명 아래를 전부 잠근다. */
  locked: boolean
  errors: { category?: string; form?: string; company?: string; eu?: string; recipient?: string; items?: string; expenses?: string }
  clearError: (key: 'category' | 'form' | 'company' | 'eu' | 'recipient' | 'items' | 'expenses') => void
  category: CustomerCardCategory
  customer: CustomerCardCustomer
  eu: CustomerCardEu
  opportunity: CustomerCardOpportunity
  recipient: CustomerCardRecipient
  doc: CustomerCardDoc
}

export default function CustomerCard({ locked, errors, clearError, category, customer, eu, opportunity, recipient, doc }: CustomerCardProps) {
  // 묶음을 풀어 **종전과 같은 이름**으로 둔다 — 아래 JSX 는 한 줄도 바뀌지 않았다.
  const {
    value: categoryValue, setValue: setCategoryValue,
    categories, loading: categoriesLoading,
    formKind, setFormKind,
  } = category
  const {
    selectedCustomer, customerQuery, customerResults, customerSearchRef,
    handleCustomerSearch, handleCustomerSelect, handleCustomerClear,
    prefillNotice, setPrefillNotice, isDealer,
  } = customer
  const {
    euQuery, euResults, euSearchRef, selectedEU, euParentName,
    handleEUSearch, handleEUSelect, handleEUClear,
  } = eu
  const { opportunities, opportunityId, setOpportunityId, onCreate } = opportunity
  const {
    contactId: recipientContactId, setContactId: setRecipientContactId,
    contacts, loading: contactsLoading,
    customerId: recipientCustomerId, sources: recipientSources, legacyText: legacyRecipient,
  } = recipient
  // 후보를 업체별로 묶는다 — 담당자가 없는 묶음은 빠진다(lib/quoteCustomerPick.ts).
  const recipientGroups = groupRecipients(contacts, recipientSources)

  /**
   * 담당자가 **한 사람뿐이면** 고를 것이 없다 — 그 사람으로 정하고 다음 칸으로 넘어간다.
   * 사람이 이미 고른 뒤에는 건드리지 않는다.
   *
   * ⚠ **대리점 건은 E.U 를 고르기 전까지 기다린다** (2026-11-26 묶음2 B3 실측).
   *   대리점을 고른 순간 후보는 그 대리점의 담당자뿐이다. 그 회사에 담당자가 한 사람이면
   *   이 효과가 곧바로 그를 수신인으로 정하고 **커서를 가격표 칸으로 보냈다** — 사람은
   *   아직 E.U 를 적으려던 중이었다. 그러고 나면 E.U 를 고른 뒤의 「수신인으로 가라」가
   *   아래 focusQuoteStep 의 「사람이 잡은 칸은 빼앗지 않는다」에 걸려 영원히 포기했다
   *   (실측: E.U → 커서가 「가격표 검색」. 수신인은 건너뛰었다).
   *   대리점 건의 후보는 **양쪽 담당자**다 — E.U 가 정해지기 전의 「한 사람」은 답이 아니다.
   */
  useEffect(() => {
    if (recipientContactId != null || contactsLoading) return
    if (isDealer && !selectedEU) return
    const only = onlyContactId(contacts)
    if (only == null) return
    setRecipientContactId(only)
    focusQuoteStep('priceSearch')
  }, [contacts, contactsLoading, recipientContactId, setRecipientContactId, isDealer, selectedEU])
  const {
    remarks, setRemarks, remarksOpen, setRemarksOpen, defaultRemarks,
    showSignature, setShowSignature, termsOpen, setTermsOpen, terms, setTerms,
  } = doc
  // 사명·E.U 아래 안내 문구. 셋 중 하나만 나온다.
  //   ① ?customer= 로 후보가 여럿일 때 ② 검색 결과가 없을 때 ③ 평소(상시 안내)
  const custNoResult = customerQuery.trim().length > 0 && customerResults.length === 0
  // 안내는 "찾아봤는데 없다" 일 때만 낸다. 사전 등록이 필요하다는 사실은 placeholder 가 이미 말한다.
  const customerGuide = prefillNotice
    ?? (custNoResult ? '검색 결과가 없습니다. 고객사 현황에서 업체를 먼저 등록해주세요' : null)
  // 링크는 "검색해도 없다" 일 때만 — 후보가 여럿인 경우엔 고르면 되므로 링크가 오히려 방해다.
  const showCustomerLink = !prefillNotice && custNoResult

  // 고를 수 있는 영업기회 — 종결된 건은 이미 연결돼 있을 때만 남긴다(선택 유지용).
  // 이 목록이 비면 영업기회 칸 자체를 그리지 않는다.
  const selectableOpportunities = opportunities.filter(o => !isClosed(o) || o.opportunity_id === opportunityId)
  // 포캐스트 고르기·만들기 칸의 상태(2026-11-26).
  const [oppQuery, setOppQuery] = useState('')
  const [oppNewOpen, setOppNewOpen] = useState(false)
  const [oppTitle, setOppTitle] = useState('')
  const [oppMonth, setOppMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [oppSaving, setOppSaving] = useState(false)
  /** 지금 걸린 포캐스트 — 칸에 적어 둘 글자. */
  const picked = opportunities.find(o => o.opportunity_id === opportunityId) ?? null
  /** 업체를 골랐는가 — 포캐스트가 하나도 없어도 **새로 만들기**는 낼 수 있어야 한다. */
  const customerPicked = !!(selectedEU || selectedCustomer)


  // 기본 정보
  /**
   * 「조건 변경」이 꺼져 있는데 기본값과 다른 칸 — 지금은 가격표 납기가 들어오는 길뿐이다.
   * 꺼져 있으면 저장·PDF 가 기본값을 쓰므로(app/quote/page.tsx 의 termsResult) 그대로 두면
   * 조용히 버려진다. 그래서 **버려지기 전에** 사람에게 보여 준다.
   */
  const termsBase = defaultTermsFor(formKind)
  const pendingTerms = termsOpen
    ? []
    : termKeysFor(formKind)
      .filter(k => (terms[k] ?? '') !== (termsBase[k] ?? ''))
      .map(k => `${TERM_LABELS[k]} 「${terms[k]}」`)

  return (
  <div style={{ background: '#fff', borderRadius: R.control, padding: '14px 16px', marginBottom: 14, border: '1px solid #ebebeb' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <div style={{ width: 3, height: 14, background: '#234ea2', borderRadius: R.icon, flexShrink: 0 }} />
      <span style={{ fontWeight: 800, fontSize: 13, color: '#111827' }}>기본 정보</span>
    </div>

    {/* 견적 분류 — **가장 먼저 고른다.** 고르기 전에는 확정이 막힌다(품목 입력은 막지 않는다).
        비활성 분류는 목록에 없다 — 새 견적은 쓰는 분류만 고른다. */}
    <div style={{ marginBottom: (errors.category || errors.form) ? 8 + 18 : 8 }}>
      {/* 분류와 양식을 한 줄에 둔다. 좁아지면 .q-two 가 1열로 접힌다. */}
      <div className="q-two">
        <div className="q-box" style={{ border: errors.category ? errBorder : undefined }}>
          <span className="q-box-label">분류</span>
          <select
            className="q-box-field ems-ring-off"
            value={categoryValue}
            disabled={categoriesLoading}
            onChange={e => { setCategoryValue(e.target.value); clearError('category') }}
            style={{ color: categoryValue ? '#111827' : '#6b7280', cursor: 'pointer' }}
          >
            <option value="" disabled hidden>{categoriesLoading ? '불러오는 중...' : '분류 선택 (필수)'}</option>
            {categories.map(c => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
          <FieldError message={errors.category} style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, whiteSpace: 'nowrap' }} />
        </div>
        {/* 견적서 양식 — 이 값 하나가 PDF 의 열·그룹·조건·합계 모양을 모두 가른다. */}
        <div className="q-box" style={{ border: errors.form ? errBorder : undefined }}>
          <span className="q-box-label">양식</span>
          <select
            className="q-box-field ems-ring-off"
            value={formKind}
            onChange={e => { setFormKind(e.target.value); clearError('form') }}
            style={{ color: formKind ? '#111827' : '#6b7280', cursor: 'pointer' }}
          >
            <option value="" disabled hidden>양식 선택 (필수)</option>
            {FORM_KINDS.map(k => (
              <option key={k} value={k}>{FORM_LABELS[k]}</option>
            ))}
          </select>
          <FieldError message={errors.form} style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, whiteSpace: 'nowrap' }} />
        </div>
      </div>
      {/* 분류 목록을 못 읽었으면 그 사실을 알린다 — 빈 드롭다운만 두면 「왜 확정이 안 되나」가 된다.
          줄마다 다른 분류는 이제 **줄 머리줄의 뱃지**에서 고른다(「분류 나누기」 토글은 걷었다 —
          켜고 끄는 단계가 없어도 되는 일이었고, 끌 때 지정한 값이 사라지는 함정이 있었다). */}
      {!categoriesLoading && categories.length === 0 && (
        <div style={{ marginTop: 4, marginLeft: 10, fontSize: 11, color: '#6b7280' }}>
          분류 목록을 불러오지 못했습니다. 새로고침하거나 관리자에게 문의해주세요
        </div>
      )}
    </div>

    {/* 분류·양식을 고르기 전에는 **여기부터 아래가 전부 잠긴다.** 그 둘이 품목의
        이익률·분류·가격표 검색 범위와 PDF 열 구성을 정하기 때문이다
        (이유는 components/quote/LockedSection.tsx 에 적어 두었다). */}
    {locked && (
      <div style={{ marginTop: 6, marginLeft: 10, fontSize: 11, color: '#6b7280' }}>
        분류와 양식을 먼저 선택하세요
      </div>
    )}

    <LockedSection locked={locked}>

    {/* 사명 — 사업장·대리점 통합 검색 */}
    <div style={{ marginBottom: errors.company ? 8 + 18 : 8 }}>
      <div ref={customerSearchRef} className="q-box" style={{ border: errors.company ? errBorder : undefined }}>
        <span className="q-box-label">사명</span>
          {/* 고르고 나면 이름을 글자로 보여준다 — 체크를 이름 바로 뒤에 붙이려면
              칸이 글자 폭만큼만 차지해야 하고, input 은 그렇게 줄지 않는다.
              다시 찾을 때는 × 로 비운다(그 편이 '고른 업체'와 '치고 있는 글자'가 어긋나지 않는다). */}
          {selectedCustomer ? (
            <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 11px' }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: '#111827' }}>
                {customerQuery}
              </span>
              {/* 대리점을 골랐다는 표시 — 체크박스가 있던 자리를 이 뱃지가 대신한다.
                  이 줄이 켜져 있으면 고른 id 가 quotes.dealer_id 로 가고, 아래 E.U 칸이 열린다. */}
              {isDealer && (
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: '#c2410c', background: '#f3f4f6', borderRadius: R.tag, padding: '1px 5px' }}>
                  대리점
                </span>
              )}
              <span title="등록된 업체와 연결됨" style={{ display: 'flex', alignItems: 'center', color: '#234ea2', flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
            </span>
          ) : (
            /* 공용 콤보박스로 고른다(2026-11-27, 묶음4 F). 손수 만든 목록을 걷었다 —
               ↑↓·Enter·Esc·Tab 이 다른 칸과 같아지고, **폰에서는 화면 아래 시트**로 뜬다
               (칸에 갇힌 목록은 390 에서 회사 이름이 잘려 무엇을 고르는지 알 수 없었다).
               고르는 값·검색 대상·다음 칸으로 옮기는 흐름은 **그대로**다. */
            <SearchSelect<CustomerResult>
              items={customerResults}
              itemKey={pickKey}
              renderItem={c => (
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, color: isAgencyPick(c) ? '#c2410c' : BLUE, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.company_name}</span>
                    {isAgencyPick(c) && (
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: '#c2410c', background: '#f3f4f6', borderRadius: R.tag, padding: '1px 5px' }}>
                        대리점
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{c.address ?? ''}{c.status ? ` · ${c.status}` : ''}</div>
                </div>
              )}
              onSelect={c => { handleCustomerSelect(c); advanceQuoteFocus('company', { isDealer: isAgencyPick(c) }) }}
              query={customerQuery}
              onQueryChange={v => { handleCustomerSearch(v); clearError('company'); setPrefillNotice(null) }}
              placeholder="업체·대리점 검색 (사전 등록 필요)"
              className="q-box-field ems-ring-off"
              wrapStyle={{ flex: 1, minWidth: 0, display: 'flex' }}
              inputStyle={{ border: 'none', background: 'transparent', padding: 0, borderRadius: 0 }}
            />
          )}
          {/* 상자 오른쪽 끝 — 지우기 ×.
              「대리점」 체크박스는 걷었다(2026-11-20). 검색이 사업장과 대리점을 함께 돌려주고,
              고른 줄의 역할이 그 체크를 대신한다(lib/quoteCustomerPick.ts). */}
          <div className="q-box-tail">
            {selectedCustomer && (
              <button onClick={handleCustomerClear}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 0, display: 'flex', alignItems: 'center' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <FieldError message={errors.company} style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, whiteSpace: 'nowrap' }} />
      </div>
      {/* 고른 업체를 알리는 칩 줄은 두지 않는다 — 상자 안에 업체명이 그대로 들어가 있어
          같은 말을 두 번 하는 셈이고, 대리점 여부는 상자 안 체크박스와 E.U 상자가 보여준다.
          미선택 상태도 시작 상태일 뿐이라 배지로 강조하지 않는다(안 고르면 검증이 붉게 막는다). */}
      {!selectedCustomer && customerGuide && (
        <div style={{ marginTop: 4, marginLeft: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>{customerGuide}</span>
          {showCustomerLink && (
            <a href="/" target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: '#234ea2', fontWeight: 600, textDecoration: 'none' }}>
              고객사 현황 열기 →
            </a>
          )}
        </div>
      )}
    </div>

    {/* E.U 필드 — 사명 칸에서 대리점을 고르면 나타난다(대리점 건의 수요처가 곧 E.U 다) */}
    {isDealer && (
      <div style={{ marginBottom: 8, animation: 'modal-in 0.15s ease' }}>
        {/* E.U 상자 — 대리점 건이라 테두리만 주황 계열을 유지한다(기존 색). */}
        <div ref={euSearchRef} className="q-box" style={{ borderColor: '#fed7aa' }}>
            <span className="q-box-label" style={{ borderRightColor: '#fed7aa' }}>E.U</span>
            {/* 사명 칸과 **같은 공용 콤보**다(2026-11-27, 묶음5 7). 손수 만든 목록을 걷었다 —
               ↑↓·Enter·Esc·Tab 이 다른 칸과 같아지고, **폰에서는 화면 아래 시트**로 뜬다.
               고르는 값·검색 대상·다음 칸으로 옮기는 흐름(quoteFocus)은 **그대로**다. */}
            <SearchSelect<CustomerResult>
              items={euResults}
              itemKey={c => c.customer_id}
              renderItem={c => (
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: '#c2410c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.company_name}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{c.address ?? ''}{c.status ? ` · ${c.status}` : ''}</div>
                </div>
              )}
              onSelect={c => { handleEUSelect(c); advanceQuoteFocus('eu', { isDealer: true }) }}
              query={euQuery}
              onQueryChange={v => { handleEUSearch(v); clearError('eu') }}
              placeholder="최종 사용 업체 검색 (사전 등록 필요)"
              className="q-box-field ems-ring-off"
              inputRef={el => registerQuoteFocus('eu', el)}
              wrapStyle={{ flex: 1, minWidth: 0, display: 'flex' }}
              inputStyle={{ border: 'none', background: 'transparent', padding: 0, borderRadius: 0 }}
            />
            {/* 고른 뒤에는 상자 안 오른쪽 끝에 체크(= 거래이력 연동)와 지우기만 남긴다. */}
            {selectedEU && (
              <div className="q-box-tail">
                <span title="거래이력 연동" style={{ display: 'flex', alignItems: 'center', color: '#c2410c' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
                <button onClick={handleEUClear}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 0, display: 'flex', alignItems: 'center' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            )}
        </div>
        {/* 고른 사업장이 회사 아래 묶여 있으면 견적서에는 **회사 이름**이 찍힌다.
            입력칸에는 고른 사업장이 그대로 보이므로, 무엇이 나가는지 여기서 알린다. */}
        {selectedEU && euParentName && (
          <div style={{ marginLeft: 10, marginTop: 4, fontSize: 11, color: '#6b7280', lineHeight: 1.6 }}>
            견적서 표기: {euDisplayName({ siteName: euQuery, parentName: euParentName })}
          </div>
        )}
        {/* 미선택 안내는 두지 않는다 — 사전 등록이 필요하다는 사실은 placeholder 가 말하고,
            안 고른 채 저장하면 아래 검증이 붉게 막는다(사명 칸과 같은 규칙). */}
        <FieldError message={errors.eu} style={{ marginLeft: 10 }} />
      </div>
    )}

    {/* 영업기회 연결 — 선택 사항. 내부 정보이며 PDF 에는 나가지 않는다.
        후보가 있는 업체는 몇 곳뿐이라, 고를 것이 있을 때만 칸을 낸다.
        (업체 미선택·기회 없음 상태에서는 안내만 남고 늘 비어 있던 칸이다) */}
    {(selectableOpportunities.length > 0 || (onCreate && customerPicked)) && (
      <div className="q-box" style={{ marginBottom: 8, animation: 'modal-in 0.15s ease' }}>
        <span className="q-box-label">포캐스트</span>
        {/* 공용 콤보박스로 고른다(SearchSelect) — ↑↓·Enter·Esc 가 다른 칸과 같다.
            맨 위에 「연결 안 함」, 맨 아래에 「＋ 새 포캐스트 만들기」가 선다.
            기본값은 **가장 최근 진행 건**이다(hooks/quote/useQuoteCustomer.ts). */}
        <div className="q-box-field ems-ring-off" style={{ padding: 0, border: 'none', minWidth: 0 }}>
          <SearchSelect<SalesOpportunity>
            items={selectableOpportunities.filter(o => !oppQuery.trim()
              || `${o.stage} ${o.title}`.toLowerCase().includes(oppQuery.trim().toLowerCase()))}
            itemKey={o => o.opportunity_id}
            renderItem={o => <span style={{ fontSize: 13 }}>{`${o.stage} · ${o.title}`}</span>}
            onSelect={o => { setOpportunityId(o.opportunity_id); setOppQuery('') }}
            query={oppQuery || (picked ? `${picked.stage} · ${picked.title}` : '')}
            onQueryChange={setOppQuery}
            placeholder="연결 안 함"
            openWhenEmpty
            emptyText="맞는 포캐스트가 없습니다"
            extras={[
              { key: 'none', where: 'top', node: <span style={{ fontSize: 13, color: MUTED }}>연결 안 함</span>, onSelect: () => { setOpportunityId(null); setOppQuery('') } },
              ...(onCreate ? [{ key: 'new', node: <span style={{ fontSize: 13, color: BLUE, fontWeight: 700 }}>＋ 새 포캐스트 만들기</span>, onSelect: () => setOppNewOpen(true) }] : []),
            ]}
          />
        </div>
      </div>
    )}

    {/* 새 포캐스트 — 제목·예상월만 받는다. 나머지는 포캐스트 화면에서 채운다. */}
    {oppNewOpen && onCreate && (
      <ModalOverlay onClose={() => setOppNewOpen(false)} confirmClose dirty={oppTitle.trim().length > 0}>
        <ModalCard
          width={380}
          closeX
          title={<span style={{ fontSize: 15, fontWeight: 700 }}>새 포캐스트</span>}
          footer={<>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => setOppNewOpen(false)}
              style={{ height: 34, padding: '0 12px', borderRadius: R.control, border: `1px solid ${BORDER}`, background: CARD_BG, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
            <button type="button" disabled={!oppTitle.trim() || oppSaving}
              onClick={async () => {
                setOppSaving(true)
                const r = await onCreate({ title: oppTitle, month: oppMonth })
                setOppSaving(false)
                if (r.ok) { setOppNewOpen(false); setOppTitle(''); setOppQuery('') }
              }}
              style={{ height: 34, padding: '0 16px', borderRadius: R.control, border: 'none', background: BLUE, color: CARD_BG, fontSize: 13, fontWeight: 700, cursor: oppTitle.trim() ? 'pointer' : 'not-allowed', opacity: oppTitle.trim() ? 1 : 0.5, fontFamily: 'inherit' }}>
              {oppSaving ? '만드는 중…' : '만들기'}
            </button>
          </>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: TEXT_LABEL }}>
              제목
              <input value={oppTitle} onChange={e => setOppTitle(e.target.value)} autoFocus
                placeholder="예: 진원도 측정기 도입"
                style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, height: 38, padding: '0 10px', border: `1px solid ${BORDER}`, borderRadius: R.control, fontSize: 13, fontFamily: 'inherit' }} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: TEXT_LABEL }}>
              예상 월
              <input type="month" value={oppMonth} onChange={e => setOppMonth(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, height: 38, padding: '0 10px', border: `1px solid ${BORDER}`, borderRadius: R.control, fontSize: 13, fontFamily: 'inherit' }} />
            </label>
          </div>
        </ModalCard>
      </ModalOverlay>
    )}

    {/* 수신인 — **고객사 담당자에서 고른다.** 직접 치지 않는다(위 CustomerCardRecipient).
        납기 칸은 없앴다. 납기는 조건 1번 「납품일정」 한 곳에서 적고, 그 값이
        quotes.delivery_info 로 저장된다(발주·결재 검토표가 읽던 칸 그대로다). */}
    <div style={{ marginBottom: 8 }}>
      <div className="q-box" style={{ border: errors.recipient ? errBorder : undefined }}>
        <span className="q-box-label">수신인</span>
        <select
          className="q-box-field ems-ring-off"
          value={recipientContactId ?? ''}
          ref={el => registerQuoteFocus('recipient', el)}
          disabled={recipientCustomerId == null || contacts.length === 0}
          onChange={e => {
            setRecipientContactId(e.target.value === '' ? null : Number(e.target.value))
            // 고른 그 자리에서 품목의 가격표 검색 칸으로 넘어간다.
            if (e.target.value !== '') focusQuoteStep('priceSearch')
          }}
          style={{ cursor: recipientCustomerId == null || contacts.length === 0 ? 'not-allowed' : 'pointer', color: recipientContactId == null ? '#6b7280' : '#111827' }}
        >
          <option value="" disabled hidden>
            {recipientCustomerId == null ? '고객사를 먼저 선택하세요'
              : contactsLoading ? '담당자 불러오는 중…'
              : contacts.length === 0 ? '등록된 담당자가 없습니다'
              : '담당자 선택'}
          </option>
          {/* 대리점 건은 **양쪽 담당자**에서 고른다 — 묶음 제목으로 어느 쪽 사람인지 밝힌다.
              직판은 묶음이 하나뿐이라 제목 없이 평평하게 둔다(없던 줄을 만들지 않는다). */}
          {recipientGroups.length > 1
            ? recipientGroups.map(g => (
              <optgroup key={g.customerId} label={g.label}>
                {g.contacts.map(c => (
                  <option key={c.contact_id} value={c.contact_id}>{contactOptionLabel(c)}</option>
                ))}
              </optgroup>
            ))
            : contacts.map(c => (
              <option key={c.contact_id} value={c.contact_id}>{contactOptionLabel(c)}</option>
            ))}
        </select>
      </div>
      <FieldError message={errors.recipient} />
      {/* 담당자가 0명 — 고를 거리가 없다. 어디서 등록하는지까지 알려 준다(새 탭으로 연다,
          쓰던 견적을 두고 떠나지 않게). */}
      {recipientCustomerId != null && !contactsLoading && contacts.length === 0 && (
        <div style={{ marginTop: 4, marginLeft: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>고객사 상세에서 담당자를 먼저 등록하세요</span>
          {/* 고객사로 가는 길도 **분할 보기**다(2026-11-28, 야간4 7-1). */}
          <a href={siteListHref(recipientCustomerId, '/quote')} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: '#234ea2', fontWeight: 600, textDecoration: 'none' }}>
            고객사 상세 열기 →
          </a>
        </div>
      )}
      {/* 옛 견적을 다시 쓰는 중 — 그 견적에는 담당자가 아니라 글자만 있었다.
          누구였는지 보여 주고 고르게 한다(그 글자는 새 견적으로 옮기지 않는다). */}
      {legacyRecipient.trim() !== '' && recipientContactId == null && (
        <div style={{ marginTop: 4, marginLeft: 10, fontSize: 11, color: '#6b7280' }}>
          이전 수신인: {legacyRecipient.trim()} — 담당자를 선택하세요
        </div>
      )}
    </div>

    <RemarksEditor
      remarks={remarks}
      setRemarks={setRemarks}
      remarksOpen={remarksOpen}
      setRemarksOpen={setRemarksOpen}
      defaultRemarks={defaultRemarks}
    />

    {/* 서명란·조건은 비고와 별개 항목이라 상자 밖 독립된 줄로 뺀다. 줄 오른쪽 끝에 붙인다.
        왼쪽이 「조건 변경」, 오른쪽이 「고객사 서명란 추가」다(같은 스타일). */}
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 8 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={termsOpen}
          onChange={e => {
            const on = e.target.checked
            setTermsOpen(on)
            // 체크를 풀면 적어 둔 값도 **기본값으로 돌린다** — 닫아 둔 값이 조용히 저장되지 않게.
            // null 이 「손대지 않음」이다(양식의 기본 문구로 돌아간다. lib/quoteTerms.ts).
            if (!on) setTerms(null)
          }}
          style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#234ea2' }}
        />
        <span style={{ fontSize: 11, fontWeight: 700, color: termsOpen ? '#234ea2' : '#4b5563', whiteSpace: 'nowrap' }}>조건 변경</span>
      </label>
      {/* 가격표 납기가 조건 칸에 들어와 있는데 체크가 꺼져 있다 — 그대로 두면 저장·PDF 가
          기본 문구를 쓰므로 그 값이 조용히 버려진다. **대신 눌러 주지는 않는다**(체크는 사람이
          누를 때만 바뀐다) — 누를 자리만 작은 뱃지로 둔다. */}
      {!termsOpen && pendingTerms.length > 0 && (
        <button
          type="button"
          onClick={() => setTermsOpen(true)}
          title={`${pendingTerms.join(' · ')} — 누르면 조건 변경을 켜고 반영합니다`}
          style={{
            fontSize: 11, fontWeight: 700, color: '#234ea2', background: '#eff4ff',
            border: 'none', borderRadius: R.pill, padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          납기 반영 가능
        </button>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showSignature}
          onChange={e => setShowSignature(e.target.checked)}
          style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#234ea2' }}
        />
        <span style={{ fontSize: 11, fontWeight: 700, color: showSignature ? '#234ea2' : '#4b5563', whiteSpace: 'nowrap' }}>고객사 서명란 추가</span>
      </label>
    </div>

    <TermsEditor termsOpen={termsOpen} terms={terms} setTerms={setTerms} formKind={formKind} />

    </LockedSection>
  </div>
  )
}
