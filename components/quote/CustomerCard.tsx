'use client'

// 견적 작성 화면의 **기본 정보 카드** — 사명·대리점·E.U·영업기회·수신인·납기·비고·서명란·조건.
//
// app/quote/page.tsx 에서 **그대로 옮겨 온 것**이다(분리 리팩터 3a). JSX·스타일·문구·주석을
// 한 글자도 바꾸지 않았다(들여쓰기 8칸만 덜어냈다). 카드 안에서만 쓰던 파생값
// (customerGuide·showCustomerLink·selectableOpportunities·remarksPreview·remarksEdited)과
// 입력칸 설명(TERM_PLACEHOLDERS)도 함께 가져왔다 — 화면에는 쓰는 곳이 없었다.
//
// 상태는 하나도 들고 있지 않다. 전부 화면(page.tsx)의 값과 setter 를 받아 쓴다.
// 비고·조건 묶음은 다음 단계(3a-7·3a-8)에서 다시 RemarksEditor·TermsEditor 로 나눈다.

import { FieldError, errBorder } from '@/components/common/fieldErrors'
import { isClosed } from '@/components/customer/opportunity'
import { euDisplayName } from '@/lib/quoteEuName'
import { Z } from '@/lib/zIndex'
import { DEFAULT_TERMS, type Terms } from '@/lib/quoteTerms'
import RemarksEditor from '@/components/quote/RemarksEditor'
import TermsEditor from '@/components/quote/TermsEditor'
import type { CustomerResult } from '@/app/quote/types'
import type { SalesOpportunity } from '@/components/customer/types'


/** 후보 목록의 키보드 조작 결과(useListKeyboard 반환값). */
type ListKeys = { active: number; setActive: (i: number) => void; onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void }

export type CustomerCardProps = {
  errors: { company?: string; eu?: string; items?: string; expenses?: string }
  clearError: (key: 'company' | 'eu' | 'items' | 'expenses') => void
  customerSearchRef: React.RefObject<HTMLDivElement | null>
  customerListRef: React.RefObject<HTMLDivElement | null>
  euSearchRef: React.RefObject<HTMLDivElement | null>
  euListRef: React.RefObject<HTMLDivElement | null>
  selectedCustomer: CustomerResult | null
  customerQuery: string
  customerResults: CustomerResult[]
  customerSearchOpen: boolean
  setCustomerSearchOpen: (v: boolean) => void
  customerKeys: ListKeys
  handleCustomerSearch: (q: string) => void
  handleCustomerSelect: (c: CustomerResult) => void
  handleCustomerClear: () => void
  prefillNotice: string | null
  setPrefillNotice: (v: string | null) => void
  customerId: number | null
  isDealer: boolean
  setIsDealer: (v: boolean) => void
  euCustomerId: number | null
  euQuery: string
  euResults: CustomerResult[]
  euSearchOpen: boolean
  setEuSearchOpen: (v: boolean) => void
  euKeys: ListKeys
  selectedEU: CustomerResult | null
  euParentName: string | null
  handleEUSearch: (q: string) => void
  handleEUSelect: (c: CustomerResult) => void
  handleEUClear: () => void
  loadOpportunities: (cid: number | null) => void
  opportunities: SalesOpportunity[]
  opportunityId: number | null
  setOpportunityId: (v: number | null) => void
  receiver: string
  setReceiver: (v: string) => void
  delivery: string
  setDelivery: (v: string) => void
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
  setTerms: React.Dispatch<React.SetStateAction<Terms>>
}

export default function CustomerCard({
  errors, clearError,
  customerSearchRef, customerListRef, euSearchRef, euListRef,
  selectedCustomer, customerQuery, customerResults, customerSearchOpen, setCustomerSearchOpen,
  customerKeys, handleCustomerSearch, handleCustomerSelect, handleCustomerClear,
  prefillNotice, setPrefillNotice, customerId, isDealer, setIsDealer,
  euCustomerId, euQuery, euResults, euSearchOpen, setEuSearchOpen, euKeys,
  selectedEU, euParentName, handleEUSearch, handleEUSelect, handleEUClear,
  loadOpportunities, opportunities, opportunityId, setOpportunityId,
  receiver, setReceiver, delivery, setDelivery,
  remarks, setRemarks, remarksOpen, setRemarksOpen, defaultRemarks,
  showSignature, setShowSignature,
  termsOpen, setTermsOpen, terms, setTerms,
}: CustomerCardProps) {
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


  // 기본 정보
  return (
  <div style={{ background: '#fff', borderRadius: 8, padding: '14px 16px', marginBottom: 14, border: '1px solid #ebebeb' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <div style={{ width: 3, height: 14, background: '#234ea2', borderRadius: 6, flexShrink: 0 }} />
      <span style={{ fontWeight: 800, fontSize: 13, color: '#111827' }}>기본 정보</span>
    </div>

    {/* 사명 + 대리점 체크박스 */}
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
              <span title="등록된 업체와 연결됨" style={{ display: 'flex', alignItems: 'center', color: '#234ea2', flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
            </span>
          ) : (
            <input
              className="q-box-field"
              value={customerQuery}
              onChange={e => { handleCustomerSearch(e.target.value); clearError('company'); setPrefillNotice(null) }}
              onFocus={() => customerResults.length > 0 && setCustomerSearchOpen(true)}
              onKeyDown={customerKeys.onKeyDown}
              placeholder="업체명 검색 (사전 등록 필요)"
            />
          )}
          {/* 상자 오른쪽 끝 — 지우기 × 와 대리점 체크박스 */}
          <div className="q-box-tail">
            {selectedCustomer && (
              <button onClick={handleCustomerClear}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 0, display: 'flex', alignItems: 'center' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={isDealer}
                onChange={e => {
                  setIsDealer(e.target.checked)
                  if (!e.target.checked) { handleEUClear() }
                  // 견적이 붙는 업체가 바뀌므로 영업기회 후보도 다시 잡는다
                  loadOpportunities(e.target.checked ? euCustomerId : customerId)
                }}
                style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#234ea2' }}
              />
              <span style={{ fontSize: 11, fontWeight: 700, color: isDealer ? '#234ea2' : '#6b7280' }}>대리점</span>
            </label>
          </div>
          <FieldError message={errors.company} style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, whiteSpace: 'nowrap' }} />
          {customerSearchOpen && customerResults.length > 0 && (
            <div ref={customerListRef} style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: Z.inPage, background: '#fff', border: '1px solid #234ea2', borderRadius: 8, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(35,78,162,0.12)' }}>
              {customerResults.map((c, i) => (
                <div key={c.customer_id} onClick={() => handleCustomerSelect(c)}
                  style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid #ebebeb', fontSize: 12, transition: 'background 0.15s ease', background: customerKeys.active === i ? '#f0f4ff' : '#fff' }}
                  onMouseEnter={() => customerKeys.setActive(i)}>
                  <div style={{ fontWeight: 700, color: '#234ea2' }}>{c.company_name}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{c.address ?? ''}{c.status ? ` · ${c.status}` : ''}</div>
                </div>
              ))}
            </div>
          )}
      </div>
      {/* 고른 업체를 알리는 칩 줄은 두지 않는다 — 상자 안에 업체명이 그대로 들어가 있어
          같은 말을 두 번 하는 셈이고, 대리점 여부는 상자 안 체크박스와 E.U 상자가 보여준다.
          미선택 상태도 시작 상태일 뿐이라 배지로 강조하지 않는다(안 고르면 검증이 붉게 막는다). */}
      {!selectedCustomer && customerGuide && (
        <div style={{ marginTop: 4, marginLeft: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>{customerGuide}</span>
          {showCustomerLink && (
            <a href="/" target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: '#234ea2', fontWeight: 600, textDecoration: 'none' }}>
              고객사 현황 열기 →
            </a>
          )}
        </div>
      )}
    </div>

    {/* E.U 필드 (대리점 체크 시 표시) */}
    {isDealer && (
      <div style={{ marginBottom: 8, animation: 'modal-in 0.15s ease' }}>
        {/* E.U 상자 — 대리점 건이라 테두리만 주황 계열을 유지한다(기존 색). */}
        <div ref={euSearchRef} className="q-box" style={{ borderColor: '#fed7aa' }}>
            <span className="q-box-label" style={{ borderRightColor: '#fed7aa' }}>E.U</span>
            <input
              className="q-box-field"
              value={euQuery}
              onChange={e => { handleEUSearch(e.target.value); clearError('eu') }}
              onFocus={() => euResults.length > 0 && setEuSearchOpen(true)}
              onKeyDown={euKeys.onKeyDown}
              placeholder="최종 사용 업체 검색 (사전 등록 필요)"
            />
            {/* 고른 뒤에는 상자 안 오른쪽 끝에 체크(= 거래이력 연동)와 지우기만 남긴다. */}
            {selectedEU && (
              <div className="q-box-tail">
                <span title="거래이력 연동" style={{ display: 'flex', alignItems: 'center', color: '#c2410c' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
                <button onClick={handleEUClear}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 0, display: 'flex', alignItems: 'center' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            )}
            {euSearchOpen && euResults.length > 0 && (
              <div ref={euListRef} style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: Z.inPage, background: '#fff', border: '1px solid #c2410c', borderRadius: 8, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(194,65,12,0.12)' }}>
                {euResults.map((c, i) => (
                  <div key={c.customer_id} onClick={() => handleEUSelect(c)}
                    style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid #ebebeb', fontSize: 12, transition: 'background 0.15s ease', background: euKeys.active === i ? '#fff7ed' : '#fff' }}
                    onMouseEnter={() => euKeys.setActive(i)}>
                    <div style={{ fontWeight: 700, color: '#c2410c' }}>{c.company_name}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{c.address ?? ''}{c.status ? ` · ${c.status}` : ''}</div>
                  </div>
                ))}
              </div>
            )}
        </div>
        {/* 고른 사업장이 회사 아래 묶여 있으면 견적서에는 **회사 이름**이 찍힌다.
            입력칸에는 고른 사업장이 그대로 보이므로, 무엇이 나가는지 여기서 알린다. */}
        {selectedEU && euParentName && (
          <div style={{ marginLeft: 10, marginTop: 4, fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
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
    {selectableOpportunities.length > 0 && (
      <div className="q-box" style={{ marginBottom: 8, animation: 'modal-in 0.15s ease' }}>
        <span className="q-box-label">영업기회</span>
        <select
          className="q-box-field"
          value={opportunityId ?? ''}
          onChange={e => setOpportunityId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">연결 안 함</option>
          {selectableOpportunities.map(o => (
            <option key={o.opportunity_id} value={o.opportunity_id}>{`${o.stage} · ${o.title}`}</option>
          ))}
        </select>
      </div>
    )}

    {/* 수신인 · 납기 — 한 줄. 좁아지면 .q-two 가 1열로 접힌다. */}
    <div className="q-two" style={{ marginBottom: 8 }}>
      <div className="q-box">
        <span className="q-box-label">수신인</span>
        <input className="q-box-field" value={receiver} onChange={e => setReceiver(e.target.value)} placeholder="예: 홍길동 부장님" />
      </div>
      <div className="q-box">
        <span className="q-box-label">납기</span>
        <input
          className="q-box-field"
          value={delivery}
          onChange={e => setDelivery(e.target.value)}
          placeholder="없을 시 입력 (N주)"
        />
      </div>
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
            if (!on) setTerms({ ...DEFAULT_TERMS })
          }}
          style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#234ea2' }}
        />
        <span style={{ fontSize: 11, fontWeight: 700, color: termsOpen ? '#234ea2' : '#6b7280' }}>조건 변경</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showSignature}
          onChange={e => setShowSignature(e.target.checked)}
          style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#234ea2' }}
        />
        <span style={{ fontSize: 11, fontWeight: 700, color: showSignature ? '#234ea2' : '#6b7280' }}>고객사 서명란 추가</span>
      </label>
    </div>

    <TermsEditor termsOpen={termsOpen} terms={terms} setTerms={setTerms} />
  </div>
  )
}
