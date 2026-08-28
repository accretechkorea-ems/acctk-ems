'use client'

// 영업 활동 추가·수정 모달. 서비스 기록과 달리 장비가 필요 없어 별도로 둔다.
// activity(=null) 이면 추가, 값이 있으면 그 활동을 수정한다.

import { useEffect, useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { isClosed } from '../opportunity'
import type { Contact, SalesActivity, SalesActivityForm, SalesOpportunity } from '../types'

// sales_activities.activity_type CHECK 와 같은 값이어야 한다.
export const ACTIVITY_TYPES = ['전화상담', '방문미팅', '사양검토', '경쟁입찰'] as const

type Props = {
  isOpen: boolean
  activity: SalesActivity | null      // null = 신규
  contacts: Contact[]
  opportunities: SalesOpportunity[]
  isSaving: boolean
  canDelete: boolean
  onClose: () => void
  onSave: (form: SalesActivityForm) => void
  onDelete: () => void
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: 6,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}
const dateFieldStyle: CSSProperties = { ...fieldStyle, colorScheme: 'light' }
const areaStyle: CSSProperties = { ...fieldStyle, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const emptyForm = (): SalesActivityForm => ({
  opportunity_id: null, activity_date: todayStr(), activity_type: '방문미팅', contact_id: null, content: '',
})

export default function SalesActivityModal({ isOpen, activity, contacts, opportunities, isSaving, canDelete, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<SalesActivityForm>(emptyForm)
  const { errors, setErrors, clearError, validate } = useFieldErrors<'activity_date' | 'activity_type' | 'content'>()

  // 열릴 때마다 폼을 맞춘다 (신규면 오늘 날짜, 수정이면 기존 값)
  useEffect(() => {
    if (!isOpen) return
    setErrors({})
    setForm(activity
      ? {
          opportunity_id: activity.opportunity_id,
          activity_date: activity.activity_date ?? todayStr(),
          activity_type: activity.activity_type,
          contact_id: activity.contact_id,
          content: activity.content ?? '',
        }
      : emptyForm())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activity])

  if (!isOpen) return null

  // 진행 중인 기회만 고르게 하되, 이미 연결돼 있던 기회는 종료됐어도 후보에 남긴다
  const selectableOpps = opportunities.filter(o => !isClosed(o) || o.opportunity_id === activity?.opportunity_id)

  const handleSave = () => {
    const ok = validate({
      activity_date: form.activity_date.trim() ? null : '활동일을 선택해주세요',
      activity_type: form.activity_type ? null : '활동 종류를 선택해주세요',
      content: form.content.trim() ? null : '내용을 입력해주세요',
    })
    if (!ok) return
    onSave(form)
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, background: '#ffffff', borderRadius: 8, padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: '1px solid #ebebeb',
          animation: 'modal-in 0.18s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', letterSpacing: '-0.3px' }}>
            {activity ? '영업 활동 수정' : '영업 활동 기록'}
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

        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>활동일 *</label>
              <input type="date" value={form.activity_date}
                onChange={(e) => { setForm(p => ({ ...p, activity_date: e.target.value })); clearError('activity_date') }}
                style={errors.activity_date ? { ...dateFieldStyle, border: errBorder } : dateFieldStyle} />
              <FieldError message={errors.activity_date} />
            </div>
            <div>
              <label style={labelStyle}>활동 종류 *</label>
              <select value={form.activity_type}
                onChange={(e) => { setForm(p => ({ ...p, activity_type: e.target.value })); clearError('activity_type') }}
                style={errors.activity_type ? { ...fieldStyle, border: errBorder } : fieldStyle}>
                {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <FieldError message={errors.activity_type} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>영업기회</label>
            <select value={form.opportunity_id ?? ''}
              onChange={(e) => setForm(p => ({ ...p, opportunity_id: e.target.value ? Number(e.target.value) : null }))}
              style={fieldStyle}>
              <option value="">연결 안 함</option>
              {selectableOpps.map(o => (
                <option key={o.opportunity_id} value={o.opportunity_id}>{o.title}</option>
              ))}
            </select>
            <div style={{ marginTop: 5, fontSize: 11, color: '#9ca3af' }}>진행 중인 기회만 고를 수 있습니다</div>
          </div>

          <div>
            <label style={labelStyle}>만난 담당자</label>
            <select value={form.contact_id ?? ''}
              onChange={(e) => setForm(p => ({ ...p, contact_id: e.target.value ? Number(e.target.value) : null }))}
              style={fieldStyle}>
              <option value="">선택 안 함</option>
              {contacts.map(c => (
                <option key={c.contact_id} value={c.contact_id}>{`${c.name ?? '-'} ${c.position ?? ''}`.trim()}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>내용 *</label>
            <textarea value={form.content} rows={6}
              onChange={(e) => { setForm(p => ({ ...p, content: e.target.value })); clearError('content') }}
              placeholder="상담·미팅 내용을 적어주세요"
              style={errors.content ? { ...areaStyle, border: errBorder } : areaStyle} />
            <FieldError message={errors.content} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 24 }}>
          {canDelete
            ? (
              <button
                onClick={onDelete}
                disabled={isSaving}
                style={{ padding: '9px 14px', background: '#fff', color: '#dc2626', borderRadius: 6, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
              >삭제</button>
            )
            : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{ padding: '9px 16px', background: '#fff', color: '#6b7280', borderRadius: 6, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >취소</button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              onMouseEnter={(e) => { if (!isSaving) e.currentTarget.style.background = '#1c3e87' }}
              onMouseLeave={(e) => { if (!isSaving) e.currentTarget.style.background = '#234ea2' }}
              style={{ padding: '9px 18px', background: '#234ea2', color: '#fff', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isSaving ? 0.6 : 1, transition: 'background 0.15s ease' }}
            >
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  )
}
