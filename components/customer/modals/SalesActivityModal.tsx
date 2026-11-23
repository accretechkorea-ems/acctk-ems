'use client'

// 영업 활동 추가·수정 모달. 서비스 기록과 달리 장비가 필요 없어 별도로 둔다.
// activity(=null) 이면 추가, 값이 있으면 그 활동을 수정한다.

import { useEffect, useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { isClosed } from '../opportunity'
import type { Contact, SalesActivity, SalesActivityForm, SalesOpportunity } from '../types'
import { todayKST } from '@/lib/date'
import { selectableActivityTypes, useActivityTypes } from '@/lib/activityTypes'
import { R } from '@/lib/radius'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'

/**
 * 활동 종류의 **처음 값** — 아직 표를 못 읽었을 때 쓰는 값이고, 표를 읽으면 그 목록의
 * 첫 줄로 맞춘다. 종류 목록 자체는 `public.activity_types` 가 정본이다
 * (lib/activityTypes.ts — 전에는 여기 상수 ACTIVITY_TYPES 가 정본이었다).
 */
const FALLBACK_TYPE = '방문미팅'

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
  /**
   * **회사 화면에서 열 때** 고를 사업장 목록. 영업 활동은 사업장 줄에 붙으므로
   * 회사 전체 타임라인에서 적을 때는 어느 사업장인지 반드시 골라야 한다.
   * 사업장 상세에서는 주지 않는다(그 사업장으로 정해져 있다).
   */
  sites?: { id: number; name: string }[]
  siteId?: number | null
  onSiteChange?: (id: number) => void
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: R.icon,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}
const dateFieldStyle: CSSProperties = { ...fieldStyle, colorScheme: 'light' }
const areaStyle: CSSProperties = { ...fieldStyle, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }


const emptyForm = (): SalesActivityForm => ({
  opportunity_id: null, activity_date: todayKST(), activity_type: FALLBACK_TYPE, contact_id: null, content: '',
})

export default function SalesActivityModal({ isOpen, activity, contacts, opportunities, isSaving, canDelete, onClose, onSave, onDelete, sites, siteId, onSiteChange }: Props) {
  /** 열었을 때의 값 — 폼의 시작값이자 **변경 여부의 기준**이다(한 곳에서 만든다). */
  const formOf = (a: typeof activity): SalesActivityForm => (a
    ? {
        opportunity_id: a.opportunity_id,
        activity_date: a.activity_date ?? todayKST(),
        activity_type: a.activity_type,
        contact_id: a.contact_id,
        content: a.content ?? '',
      }
    : emptyForm())

  const [form, setForm] = useState<SalesActivityForm>(emptyForm)
  const { errors, setErrors, clearError, validate } = useFieldErrors<'activity_date' | 'activity_type' | 'content'>()
  const allTypes = useActivityTypes()
  /**
   * 고를 수 있는 종류 — 활성이고 system 이 아닌 것. 지금 값이 비활성이어도 남긴다
   * (옛 활동을 고치는 창에서 종류가 조용히 바뀌지 않게 — lib/activityTypes.ts).
   */
  const typeOptions = selectableActivityTypes(allTypes, form.activity_type)

  // 열릴 때마다 폼을 맞춘다 (신규면 오늘 날짜, 수정이면 기존 값)
  useEffect(() => {
    if (!isOpen) return
    setErrors({})
    setForm(formOf(activity))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activity])

  /**
   * **새 활동**의 기본 종류를 목록에 맞춘다. 처음 값('방문미팅')이 관리 화면에서 비활성
   * 되거나 이름이 바뀌면 칸에 없는 값이 남아 저장이 FK 에 막힌다. 표를 읽은 뒤 한 번만,
   * 그리고 **새 활동일 때만** 고친다 — 수정 창의 기존 값은 그대로 두어야 한다.
   */
  useEffect(() => {
    if (!isOpen || activity || allTypes.length === 0) return
    const pickable = selectableActivityTypes(allTypes)
    if (pickable.length === 0) return
    setForm(p => (pickable.some(t => t.label === p.activity_type) ? p : { ...p, activity_type: pickable[0].label }))
  }, [isOpen, activity, allTypes])

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
    <ModalOverlay onClose={onClose} confirmClose dirty={JSON.stringify(form) !== JSON.stringify(formOf(activity))}>
      <ModalCard
        width={480}
        footStyle={{ justifyContent: 'space-between' }}
        title={<>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', letterSpacing: '-0.3px' }}>
            {activity ? '영업 활동 수정' : '영업 활동 기록'}
          </div>
        </>}
        footer={<>
          {canDelete
            ? (
              <button
                onClick={onDelete}
                disabled={isSaving}
                style={{ padding: '9px 14px', background: '#fff', color: '#dc2626', borderRadius: R.icon, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
              >삭제</button>
            )
            : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{ padding: '9px 16px', background: '#fff', color: '#4b5563', borderRadius: R.icon, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
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

        <div style={{ display: 'grid', gap: 14 }}>
          {/* 사업장 — 회사 화면에서 적을 때만. 기본값은 가장 최근에 움직인 사업장이다. */}
          {sites && sites.length > 0 && (
            <div>
              <label style={labelStyle}>사업장 *</label>
              <select value={siteId ?? sites[0].id} disabled={isSaving}
                onChange={e => onSiteChange?.(Number(e.target.value))}
                style={{ ...fieldStyle, cursor: 'pointer' }}>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>활동일 *</label>
              <input type="date" className="date-fit" value={form.activity_date}
                onChange={(e) => { setForm(p => ({ ...p, activity_date: e.target.value })); clearError('activity_date') }}
                style={errors.activity_date ? { ...dateFieldStyle, border: errBorder } : dateFieldStyle} />
              <FieldError message={errors.activity_date} />
            </div>
            <div>
              <label style={labelStyle}>활동 종류 *</label>
              <select value={form.activity_type}
                onChange={(e) => { setForm(p => ({ ...p, activity_type: e.target.value })); clearError('activity_type') }}
                style={errors.activity_type ? { ...fieldStyle, border: errBorder } : fieldStyle}>
                {/* 값은 label 이다 — sales_activities.activity_type 이 label 을 참조한다(FK). */}
                {typeOptions.map(t => <option key={t.code} value={t.label}>{t.label}</option>)}
              </select>
              <FieldError message={errors.activity_type} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>포캐스트</label>
            <select value={form.opportunity_id ?? ''}
              onChange={(e) => setForm(p => ({ ...p, opportunity_id: e.target.value ? Number(e.target.value) : null }))}
              style={fieldStyle}>
              <option value="">연결 안 함</option>
              {selectableOpps.map(o => (
                <option key={o.opportunity_id} value={o.opportunity_id}>{o.title}</option>
              ))}
            </select>
            <div style={{ marginTop: 5, fontSize: 11, color: '#6b7280' }}>진행 중인 포캐스트만 고를 수 있습니다</div>
          </div>

          <div>
            <label style={labelStyle}>만난 고객 담당자</label>
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

      </ModalCard>
    </ModalOverlay>
  )
}
