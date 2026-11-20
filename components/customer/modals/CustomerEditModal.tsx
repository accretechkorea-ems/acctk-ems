'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { Customer, CustomerEditFormData } from '../types'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import FormFocusStyle from '@/components/common/FormFocusStyle'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import ParentPicker, { loadParents, type ParentOption } from '@/components/customer/ParentPicker'
import AgencyPicker from '@/components/customer/AgencyPicker'
import { INDUSTRIES } from '@/lib/leadOptions'
import { MEMO_MAX } from '@/components/common/MemoPopover'
import AddressField from './AddressField'
import { R } from '@/lib/radius'

type Props = {
  customer: Customer | null
  isSaving: boolean
  isDeleting?: boolean
  onClose: () => void
  onSave: (form: CustomerEditFormData) => void
  onDelete?: () => void
  /**
   * 「폐기 포함」 보기 — 장비 목록에 폐기된 것도 낼까.
   * **저장과 무관한 보기 설정**이라 누르는 즉시 반영된다(모달을 닫지 않아도 바뀐다).
   * 전에는 장비 목록 위에 늘 떠 있는 스위치였는데, 자주 쓰는 것이 아니라 여기로 옮겼다(2026-11-20).
   */
  showDisposed?: boolean
  onToggleDisposed?: () => void
  /** 폐기된 장비 수 — 0 이면 체크 자체를 내지 않는다(끌 것이 없는 스위치다). */
  disposedCount?: number
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: R.icon,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}

/** 열었을 때의 값 — 폼의 시작값이자 **변경 여부의 기준**이다(한 곳에서 만든다). */
const formOf = (c: Customer): CustomerEditFormData => ({
  company_name: c.company_name ?? '',
  site_name: c.site_name ?? '',
  address: c.address ?? '',
  agency_customer_id: c.agency_customer_id ?? null,
  status: c.status ?? '활성',
  parent_customer_id: c.parent_customer_id ?? null,
  note: c.note ?? '',
  new_company_industry: '',
})

const EMPTY_FORM: CustomerEditFormData = {
  company_name: '', site_name: '', address: '', agency_customer_id: null,
  status: '활성', parent_customer_id: null, note: '', new_company_industry: '',
}

export default function CustomerEditModal({ customer, isSaving, isDeleting, onClose, onSave, onDelete, showDisposed = false, onToggleDisposed, disposedCount = 0 }: Props) {
  const [form, setForm] = useState<CustomerEditFormData>(EMPTY_FORM)
  const { errors, setErrors, clearError, validate } = useFieldErrors<'parent_customer_id' | 'address' | 'new_company_industry' | 'agency' | 'site_name'>()
  /** 대리점 칸에 **적기만 하고 고르지 않은** 글자. 그대로 저장하면 조용히 직판이 된다. */
  const [agencyQuery, setAgencyQuery] = useState('')
  /**
   * 대리점을 **골랐는가**. 전에 저장된 줄은 비어 있는 채로 들어오는데, 그 비어 있음이
   * 「직판이다」인지 「아직 안 정했다」인지 알 수 없다. 그래서 값이 없으면 고르게 한다.
   */
  const [agencyChosen, setAgencyChosen] = useState(false)
  /** 회사 목록 — 적어 둔 이름이 **이미 있는 회사인지** 가리는 데만 쓴다(ParentPicker 캐시). */
  const [companies, setCompanies] = useState<ParentOption[]>([])

  useEffect(() => {
    if (customer) {
      setForm(formOf(customer))
      setErrors({})
      // 이미 대리점이 붙어 있는 줄은 고른 것으로 본다(값이 곧 선택이다).
      setAgencyChosen(customer.agency_customer_id != null)
      setAgencyQuery('')
    }
  }, [customer])

  useEffect(() => {
    let cancelled = false
    loadParents().then(list => { if (!cancelled) setCompanies(list) })
    return () => { cancelled = true }
  }, [])

  /**
   * 저장하면 **회사를 새로 만드는가** — 회사를 고르지 않았고, 적혀 있는 이름이 회사
   * 목록에 없을 때다. 그때는 분류를 받아야 한다(등록 폼·ParentPicker 와 같은 규칙).
   * 목록에 같은 이름이 있으면 그 줄에 붙으므로 분류를 묻지 않는다.
   */
  const typedName = form.company_name.trim()
  const knownCompany = useMemo(
    () => companies.some(p => p.company_name.trim() === typedName),
    [companies, typedName],
  )
  const willCreateCompany = form.parent_customer_id == null && !!typedName && !knownCompany

  if (!customer) return null

  // 검증은 여기(모달)에서 인라인으로 수집 → 통과 시에만 onSave(form)
  const handleSave = () => {
    const ok = validate({
      new_company_industry: willCreateCompany && !form.new_company_industry
        ? '새 회사의 분류를 선택해주세요'
        : null,
      // 회사는 필수, 사업장명은 선택이다.
      // 회사 줄이 아직 없는 사업장(이관 전에 들어온 591곳)은 **이름만 적혀 있다** —
      // 그 이름으로 저장하면 회사를 찾거나 만들어 잇는다(hooks/customer/useCustomerCrud.ts).
      parent_customer_id: form.parent_customer_id == null && !form.company_name.trim()
        ? '회사명을 입력해주세요'
        : null,
      address: form.address.trim() ? null : '주소를 입력해주세요',
      site_name: form.site_name.trim() ? null : '사업장명을 입력해주세요',
      agency: agencyQuery.trim() && !agencyChosen
        ? '대리점을 목록에서 고르세요'
        : !agencyChosen
          ? '대리점을 고르세요 (거치지 않으면 ACCT-K)'
          : null,
    })
    if (!ok) return
    onSave(form)
  }

  /** 열었을 때와 달라졌는가 — 그대로면 확인 없이 닫힌다(ModalOverlay). */
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(customer))

  return (
    <ModalOverlay onClose={onClose} confirmClose dirty={dirty}>
      {/* 구조는 공용 카드가 든다 — 머리줄 고정 / 본문 스크롤 / 바닥줄 고정.
          ✕ 는 Esc·바깥 클릭과 **같은 함수**를 지난다(ModalCard). */}
      <ModalCard
        className="acc-form"
        width={1100}
        footStyle={{ justifyContent: 'space-between' }}
        title={<>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', letterSpacing: '-0.3px' }}>사업장 정보 수정</div>
        </>}
        footer={<>
          {onDelete ? (
            <button
              onClick={onDelete}
              disabled={isDeleting}
              style={{ padding: '9px 16px', background: '#ef4444', color: '#fff', borderRadius: R.icon, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isDeleting ? 0.6 : 1 }}
            >
              {isDeleting ? '삭제 중...' : '삭제'}
            </button>
          ) : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{ padding: '9px 16px', background: '#fff', color: '#6b7280', borderRadius: R.icon, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >취소</button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              onMouseEnter={(e) => { if (!isSaving) e.currentTarget.style.background = '#1c3e87' }}
              onMouseLeave={(e) => { if (!isSaving) e.currentTarget.style.background = '#234ea2' }}
              style={{ padding: '9px 18px', background: '#234ea2', color: '#fff', borderRadius: R.icon, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isSaving ? 0.6 : 1, transition: 'background 0.15s ease' }}
            >
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </>}
      >
        <FormFocusStyle />

        <div style={{ display: 'grid', gap: 14 }}>
          {/* 회사명 — **필수**. 목록에 없으면 그 자리에서 새 회사로 등록한다(분류를 함께 고른다).
              회사 줄이 아직 없는 사업장은 그 줄에 적혀 있던 이름이 칸에 채워져 보인다. */}
          <div>
            <label style={labelStyle}>회사명</label>
            <ParentPicker
              value={form.parent_customer_id}
              onChange={id => { setForm(p => ({ ...p, parent_customer_id: id })); clearError('parent_customer_id') }}
              nameValue={form.company_name}
              onNameChange={v => { setForm(p => ({ ...p, company_name: v })); clearError('parent_customer_id') }}
              allowCreate
              disabled={isSaving}
            />
            <FieldError message={errors.parent_customer_id} />
          </div>
          {/* 회사를 새로 만들며 저장하는 경우에만 나타나는 칸 — 분류는 회사 줄에 들어간다.
              고른 회사가 있거나 같은 이름의 회사가 이미 있으면 묻지 않는다. */}
          {willCreateCompany && (
            <div>
              <label style={labelStyle}>{`「${typedName}」 분류 (새 회사)`}</label>
              <select
                value={form.new_company_industry}
                disabled={isSaving}
                onChange={e => { setForm(p => ({ ...p, new_company_industry: e.target.value })); clearError('new_company_industry') }}
                style={errors.new_company_industry ? { ...fieldStyle, border: errBorder, cursor: 'pointer' } : { ...fieldStyle, cursor: 'pointer' }}
              >
                <option value="" disabled hidden>분류 선택 (필수)</option>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
              <FieldError message={errors.new_company_industry} />
            </div>
          )}
          {/* 한 줄 세 칸 — 등록 폼의 사업장 블록과 같은 리듬. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, alignItems: 'start' }}>
            <div>
              <label style={labelStyle}>사업장명</label>
              <input value={form.site_name}
                onChange={e => { setForm(p => ({ ...p, site_name: e.target.value })); clearError('site_name') }}
                placeholder="ex) 본사, A공장, 지명"
                style={errors.site_name ? { ...fieldStyle, border: errBorder } : fieldStyle} />
              <FieldError message={errors.site_name} />
            </div>
            <div>
              <label style={labelStyle}>대리점</label>
              {/* 자유 입력에서 **고르는 칸**으로 바뀌었다 — 같은 대리점이 여러 표기로
                  들어오던 것을 막는다(lib/customerAgency.ts). 고르지 않으면 직판이다.
                  적기만 하고 고르지 않으면 저장할 때 막는다. */}
              <AgencyPicker
                value={form.agency_customer_id}
                chosen={agencyChosen}
                onChange={(id, picked) => { setForm(p => ({ ...p, agency_customer_id: id })); setAgencyChosen(picked !== false); setAgencyQuery(''); clearError('agency') }}
                onQueryChange={q => { setAgencyQuery(q); clearError('agency') }}
                disabled={isSaving}
              />
              <FieldError message={errors.agency} />
            </div>
            <div>
              <label style={labelStyle}>상태</label>
              <select value={form.status} disabled={isSaving}
                onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                style={{ ...fieldStyle, cursor: 'pointer' }}>
                <option value="활성">활성</option>
                <option value="잠재">잠재</option>
                <option value="이탈">이탈</option>
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>주소</label>
            {/* 주소 — [주소 검색]으로 정규 주소를 받고, 상세는 따로 입력한다(합쳐서 한 칸에 저장된다).
                기존 업체의 예전 주소는 검색을 누를 때까지 지금처럼 한 칸에 그대로 보인다. */}
            <AddressField
              value={form.address}
              onChange={next => setForm(p => ({ ...p, address: next }))}
              onTouch={() => clearError('address')}
              error={errors.address}
              inputStyle={fieldStyle}
              errorBorder={errBorder}
              disabled={isSaving}
            />
            <FieldError message={errors.address} />
          </div>

          <div>
            <label style={labelStyle}>메모</label>
            {/* 이름 칸에 섞여 들어오던 사정(「- 폐업」·「인천 서구 이전」)을 적는 자리다.
                상세 정보 패널의 「메모」 줄이 이 값을 보여 준다. */}
            <textarea
              value={form.note}
              onChange={e => setForm(p => ({ ...p, note: e.target.value.slice(0, MEMO_MAX) }))}
              placeholder="ex) 일본 직수입 · 2026-03 충남 아산으로 사옥 이전"
              rows={3}
              style={{ ...fieldStyle, resize: 'vertical', fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit' }}
            />
            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4, textAlign: 'right' }}>
              {`${form.note.length} / ${MEMO_MAX}`}
            </div>
          </div>

          {/* 보기 설정 — 저장 단추와 무관하다. 누르면 그 자리에서 장비 목록이 바뀐다. */}
          {disposedCount > 0 && onToggleDisposed && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
              <input type="checkbox" checked={showDisposed} onChange={onToggleDisposed} />
              폐기 장비도 보기
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: R.pill, padding: '1px 7px' }}>{disposedCount}</span>
            </label>
          )}

        </div>

      </ModalCard>
    </ModalOverlay>
  )
}
