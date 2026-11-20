'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import type { Contact, ContactForm } from '../types'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { R } from '@/lib/radius'

type Props = {
  contact: Contact | null
  isSaving: boolean
  onClose: () => void
  onSave: (form: ContactForm) => void
  onDelete: () => void
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: R.icon,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}

/** 열었을 때의 값 — 폼의 시작값이자 **변경 여부의 기준**이다(한 곳에서 만든다). */
const formOf = (c: Contact): ContactForm => ({
  name: c.name ?? '',
  department: c.department ?? '',
  position: c.position ?? '',
  phone: c.phone ?? '',
  email: c.email ?? '',
})

export default function ContactEditModal({ contact, isSaving, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<ContactForm>({ name: '', department: '', position: '', phone: '', email: '' })
  const { errors, setErrors, clearError, validate } = useFieldErrors<'name'>()

  useEffect(() => {
    if (contact) {
      setForm(formOf(contact))
      setErrors({})
    }
  }, [contact])

  if (!contact) return null

  const handleSave = () => {
    const ok = validate({ name: form.name.trim() ? null : '이름을 입력해주세요' })
    if (!ok) return
    onSave(form)
  }

  /** 열었을 때와 달라졌는가 — 그대로면 확인 없이 닫힌다(ModalOverlay). */
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(contact))

  return (
    <ModalOverlay onClose={onClose} confirmClose dirty={dirty}>
      <ModalCard
        title="고객 담당자 수정"
        width={480}
        footStyle={{ justifyContent: 'space-between' }}
        footer={<>
          <button
            onClick={onDelete}
            disabled={isSaving}
            style={{ padding: '9px 16px', background: '#ef4444', color: '#fff', borderRadius: R.icon, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isSaving ? 0.6 : 1 }}
          >삭제</button>
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

        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>이름 *</label>
              <input value={form.name} onChange={(e) => { setForm(p => ({ ...p, name: e.target.value })); clearError('name') }} placeholder="이름" style={errors.name ? { ...fieldStyle, border: errBorder } : fieldStyle} />
              <FieldError message={errors.name} />
            </div>
            <div>
              <label style={labelStyle}>직책</label>
              <input value={form.position} onChange={(e) => setForm(p => ({ ...p, position: e.target.value }))} placeholder="직책" style={fieldStyle} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>부서</label>
            <input value={form.department} onChange={(e) => setForm(p => ({ ...p, department: e.target.value }))} placeholder="부서" style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>전화번호</label>
            <input value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="전화번호" style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>이메일</label>
            <input value={form.email} onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))} placeholder="이메일" type="email" style={fieldStyle} />
          </div>
        </div>

      </ModalCard>
    </ModalOverlay>
  )
}
