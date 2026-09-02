'use client'

// 영업기회 추가·수정 모달. opportunity(=null) 이면 추가.
// 기존 기회를 열면 아래에 그 기회에 묶인 활동 목록을 읽기 전용으로 함께 보여준다
// (타임라인은 업체 전체를 시간순으로 보는 곳이라, 한 건의 흐름만 모아 보려면 여기가 필요하다).

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { isCurrentlyEmployed } from '@/lib/engineers'
import { STAGES, LOST_REASONS, dateToMonth, compactKRW, isClosed } from '../opportunity'
import { numKR } from '../constants'
import type { Customer, Engineer, OpportunityForm, SalesActivity, SalesOpportunity } from '../types'
import Popover from '@/components/common/Popover'

type Props = {
  isOpen: boolean
  opportunity: SalesOpportunity | null    // null = 신규
  activities: SalesActivity[]             // 이 업체의 전체 활동 (여기서 기회별로 거른다)
  customers: Customer[]                   // 파이프라인에서 신규 등록할 때 고를 업체 목록
  lockedCustomerName: string | null       // 업체 상세에서 열었으면 그 업체명 (선택칸을 잠근다)
  engineers: Engineer[]
  isSaving: boolean
  canEdit: boolean
  currentUserEngineerId: number | null
  canPickEngineer: boolean                // superadmin 이면 담당 영업을 바꿀 수 있다
  onClose: () => void
  onSave: (form: OpportunityForm) => void
  onDelete: () => void
  // 연결된 견적의 PDF 열기 (없으면 견적 목록만 보여준다)
  onOpenQuotePdf?: (pdfUrl: string | null | undefined, quoteNumber: string) => void
  // 수동 종료 / 종료 해제 (종료 여부는 closed_at 으로만 표현한다)
  onSetClosed?: (o: SalesOpportunity, close: boolean) => void
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: 6,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}
const monthFieldStyle: CSSProperties = { ...fieldStyle, colorScheme: 'light' }
const areaStyle: CSSProperties = { ...fieldStyle, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }

const emptyForm = (engineerId: number | null): OpportunityForm => ({
  customer_id: null, title: '', stage: '상담', expected_amount: '', expected_close: '',
  engineer_id: engineerId, lost_reason: '', lost_note: '',
})

export default function OpportunityModal({
  isOpen, opportunity, activities, customers, lockedCustomerName, engineers, isSaving, canEdit,
  currentUserEngineerId, canPickEngineer, onClose, onSave, onDelete, onOpenQuotePdf, onSetClosed,
}: Props) {
  const [form, setForm] = useState<OpportunityForm>(() => emptyForm(currentUserEngineerId))
  const { errors, setErrors, clearError, validate } = useFieldErrors<'title' | 'lost_reason' | 'customer_id'>()
  const [custQuery, setCustQuery] = useState('')
  const [custOpen, setCustOpen] = useState(false)
  // 모달 본문이 스크롤 상자라 검색 결과를 포털로 띄운다. 그 기준이 되는 입력칸.
  const custAnchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    setErrors({})
    setForm(opportunity
      ? {
          customer_id: opportunity.customer_id,
          title: opportunity.title,
          stage: opportunity.stage,
          expected_amount: opportunity.expected_amount != null ? String(opportunity.expected_amount) : '',
          expected_close: dateToMonth(opportunity.expected_close),
          engineer_id: opportunity.engineer_id,
          lost_reason: opportunity.lost_reason ?? '',
          lost_note: opportunity.lost_note ?? '',
        }
      : emptyForm(currentUserEngineerId))
    setCustQuery('')
    setCustOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, opportunity])

  if (!isOpen) return null

  const todayStr = new Date().toISOString().slice(0, 10)
  const selectableEngineers = engineers.filter(e => isCurrentlyEmployed(e.resigned_date, todayStr))
  const linked = opportunity
    ? activities.filter(a => a.opportunity_id === opportunity.opportunity_id)
    : []
  const linkedQuotes = opportunity?.quotes ?? []
  const amountNum = Number(form.expected_amount.replace(/[^\d]/g, ''))

  // 업체 상세에서 열었으면 그 업체로 고정되므로 고를 필요가 없다.
  // 기존 기회를 수정할 때도 업체는 바꾸지 않는다(다른 업체로 옮기는 일은 없다).
  const needCustomerPick = !lockedCustomerName && !opportunity
  const pickedCustomer = customers.find(c => c.customer_id === form.customer_id) ?? null
  // 업체명이 겹치는 곳이 많아 주소를 함께 보여줘야 구분된다
  const custMatches = custQuery.trim()
    ? customers.filter(c => (c.company_name ?? '').toLowerCase().includes(custQuery.trim().toLowerCase())).slice(0, 8)
    : []

  const handleSave = () => {
    const ok = validate({
      title: form.title.trim() ? null : '제목을 입력해주세요',
      customer_id: needCustomerPick && !form.customer_id ? '업체를 선택해주세요' : null,
      lost_reason: form.stage === '실주' && !form.lost_reason ? '실주 사유를 선택해주세요' : null,
    })
    if (!ok) return
    onSave(form)
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520, maxHeight: '88vh', background: '#ffffff', borderRadius: 8,
          padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: '1px solid #ebebeb',
          animation: 'modal-in 0.18s ease', display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', letterSpacing: '-0.3px' }}>
            {opportunity ? (canEdit ? '영업기회 수정' : '영업기회') : '영업기회 등록'}
            {opportunity && isClosed(opportunity) && (
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '3px 9px', verticalAlign: 'middle' }}>
                {opportunity.stage === '실주' ? '실주' : '종료'}
                {opportunity.closed_at ? ' · ' + opportunity.closed_at.slice(0, 10) : ''}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            title="닫기"
            onMouseEnter={(e) => (e.currentTarget.style.color = '#111827')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#6b7280')}
            style={{ width: 28, height: 28, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', transition: 'color 0.15s ease' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, display: 'grid', gap: 14 }}>
          {/* 업체 — 상세 화면에서 열었으면 잠긴 상태로 보여주고, 파이프라인에서 신규 등록할 때만 고른다 */}
          {(lockedCustomerName || opportunity) ? (
            <div>
              <label style={labelStyle}>업체</label>
              <div style={{ ...fieldStyle, background: '#f9fafb', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {lockedCustomerName ?? opportunity?.customers?.company_name ?? '-'}
              </div>
            </div>
          ) : (
            <div ref={custAnchorRef}>
              <label style={labelStyle}>업체 *</label>
              {form.customer_id ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ ...fieldStyle, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pickedCustomer?.company_name ?? '-'}
                    {pickedCustomer?.address && (
                      <span style={{ marginLeft: 6, fontSize: 12, color: '#9ca3af' }}>{pickedCustomer.address}</span>
                    )}
                  </div>
                  <button
                    onClick={() => { setForm(p => ({ ...p, customer_id: null })); setCustQuery(''); setCustOpen(true) }}
                    style={{ padding: '9px 12px', background: '#f3f4f6', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#6b7280', flexShrink: 0 }}
                  >변경</button>
                </div>
              ) : (
                <input
                  value={custQuery}
                  onChange={(e) => { setCustQuery(e.target.value); setCustOpen(true); clearError('customer_id') }}
                  onFocus={() => setCustOpen(true)}
                  placeholder="업체명으로 검색"
                  style={errors.customer_id ? { ...fieldStyle, border: errBorder } : fieldStyle}
                />
              )}
              <FieldError message={errors.customer_id} />

              {/* 모달 본문이 overflowY: auto 라 안에 두면 잘린다 — 포털로 띄운다 */}
              <Popover
                anchorRef={custAnchorRef}
                open={custOpen && !form.customer_id && custMatches.length > 0}
                onClose={() => setCustOpen(false)}
                matchAnchorWidth
                maxHeight={240}
                style={{ background: '#fff', border: '1px solid #ebebeb', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
              >
                  {custMatches.map(c => (
                    <div key={c.customer_id}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setForm(p => ({ ...p, customer_id: c.customer_id }))
                        setCustOpen(false)
                        clearError('customer_id')
                      }}
                      style={{ padding: '8px 11px', cursor: 'pointer' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <div style={{ fontSize: 13, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.company_name ?? '-'}
                      </div>
                      <div style={{ fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.address ?? '주소 없음'}
                      </div>
                    </div>
                  ))}
              </Popover>
            </div>
          )}

          <div>
            <label style={labelStyle}>제목 *</label>
            <input value={form.title} disabled={!canEdit}
              onChange={(e) => { setForm(p => ({ ...p, title: e.target.value })); clearError('title') }}
              placeholder="예: A동 라인 증설"
              style={errors.title ? { ...fieldStyle, border: errBorder } : fieldStyle} />
            <FieldError message={errors.title} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>단계</label>
              <select value={form.stage} disabled={!canEdit}
                onChange={(e) => setForm(p => ({ ...p, stage: e.target.value }))}
                style={fieldStyle}>
                {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>담당 영업</label>
              <select value={form.engineer_id ?? ''} disabled={!canEdit || !canPickEngineer}
                onChange={(e) => setForm(p => ({ ...p, engineer_id: e.target.value ? Number(e.target.value) : null }))}
                style={{ ...fieldStyle, background: (!canEdit || !canPickEngineer) ? '#f9fafb' : '#fff' }}>
                {selectableEngineers.map(e => (
                  <option key={e.engineer_id} value={e.engineer_id}>{`${e.name} ${e.position ?? ''}`.trim()}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>예상 금액</label>
              <input value={form.expected_amount} disabled={!canEdit} inputMode="numeric"
                onChange={(e) => setForm(p => ({ ...p, expected_amount: e.target.value.replace(/[^\d]/g, '') }))}
                placeholder="예: 150000000" style={fieldStyle} />
              <div style={{ marginTop: 5, fontSize: 11, color: '#9ca3af' }}>
                {amountNum > 0 ? `₩${numKR(amountNum)} · ${compactKRW(amountNum)}` : '숫자만 입력'}
              </div>
            </div>
            <div>
              <label style={labelStyle}>예상 마감</label>
              <input type="month" value={form.expected_close} disabled={!canEdit}
                onChange={(e) => setForm(p => ({ ...p, expected_close: e.target.value }))}
                style={monthFieldStyle} />
              <div style={{ marginTop: 5, fontSize: 11, color: '#9ca3af' }}>월 단위로 기록합니다</div>
            </div>
          </div>

          {/* 실주로 바꿨을 때만 사유를 받는다 */}
          {form.stage === '실주' && (
            <div style={{ display: 'grid', gap: 10, padding: '12px 14px', background: '#f8fafc', border: '1px solid #ebebeb', borderRadius: 8 }}>
              <div>
                <label style={labelStyle}>실주 사유 *</label>
                <select value={form.lost_reason} disabled={!canEdit}
                  onChange={(e) => { setForm(p => ({ ...p, lost_reason: e.target.value })); clearError('lost_reason') }}
                  style={errors.lost_reason ? { ...fieldStyle, border: errBorder } : fieldStyle}>
                  <option value="">사유 선택</option>
                  {LOST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <FieldError message={errors.lost_reason} />
              </div>
              <div>
                <label style={labelStyle}>보충 메모</label>
                <textarea value={form.lost_note} rows={3} disabled={!canEdit}
                  onChange={(e) => setForm(p => ({ ...p, lost_note: e.target.value }))}
                  placeholder="경쟁사명, 가격 차이 등" style={areaStyle} />
              </div>
            </div>
          )}

          {/* 이 기회에 연결된 견적 (읽기 전용) — 누르면 PDF 를 연다 */}
          {opportunity && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>연결된 견적</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px' }}>{linkedQuotes.length}건</span>
              </div>
              {linkedQuotes.length === 0 ? (
                <div style={{ fontSize: 12, color: '#9ca3af' }}>연결된 견적이 없습니다. 견적서를 쓸 때 이 기회를 고르면 여기 모입니다.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {linkedQuotes.map(q => (
                    <button key={q.quote_id}
                      onClick={() => onOpenQuotePdf?.(q.pdf_url, q.quote_number)}
                      style={{
                        border: '1px solid #ebebeb', borderRadius: 6, padding: '8px 10px', textAlign: 'left',
                        background: '#fff', cursor: q.pdf_url ? 'pointer' : 'default', width: '100%',
                      }}
                      onMouseEnter={e => { if (q.pdf_url) e.currentTarget.style.borderColor = '#c7d7f8' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#ebebeb' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#234ea2' }}>{q.quote_number}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px' }}>{q.status}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>{q.quote_date}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>₩{numKR(q.total_supply || 0)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 이 기회에 묶인 활동 (읽기 전용) */}
          {opportunity && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>연결된 활동</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px' }}>{linked.length}건</span>
              </div>
              {linked.length === 0 ? (
                <div style={{ fontSize: 12, color: '#9ca3af' }}>연결된 활동이 없습니다. 활동 기록에서 이 기회를 고르면 여기 모입니다.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {linked.map(a => (
                    <div key={a.activity_id} style={{ border: '1px solid #ebebeb', borderRadius: 6, padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{a.activity_type}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>{a.activity_date ?? '-'}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.content ?? '-'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 20, flexShrink: 0 }}>
          {canEdit && opportunity
            ? (
              <>
              <button onClick={onDelete} disabled={isSaving}
                style={{ padding: '9px 14px', background: '#fff', color: '#dc2626', borderRadius: 6, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
              >삭제</button>
              {onSetClosed && opportunity.stage !== '실주' && (
                <button onClick={() => onSetClosed(opportunity, !opportunity.closed_at)} disabled={isSaving}
                  style={{ marginLeft: 8, padding: '9px 14px', background: '#fff', color: '#6b7280', borderRadius: 6, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                  {opportunity.closed_at ? '종료 해제' : '종료'}
                </button>
              )}
              </>
            )
            : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose}
              style={{ padding: '9px 16px', background: '#fff', color: '#6b7280', borderRadius: 6, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >{canEdit ? '취소' : '닫기'}</button>
            {canEdit && (
              <button onClick={handleSave} disabled={isSaving}
                onMouseEnter={(e) => { if (!isSaving) e.currentTarget.style.background = '#1c3e87' }}
                onMouseLeave={(e) => { if (!isSaving) e.currentTarget.style.background = '#234ea2' }}
                style={{ padding: '9px 18px', background: '#234ea2', color: '#fff', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isSaving ? 0.6 : 1, transition: 'background 0.15s ease' }}>
                {isSaving ? '저장 중...' : '저장'}
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalOverlay>
  )
}
