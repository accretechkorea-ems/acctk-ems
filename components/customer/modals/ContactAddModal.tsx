'use client'

import { useState, type CSSProperties } from 'react'
import type { ContactForm } from '../types'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard, { modalGhostButton, modalPrimaryButton } from '@/components/common/ModalCard'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { R } from '@/lib/radius'

type Props = {
  isOpen: boolean
  isSaving: boolean
  onClose: () => void
  onSave: (form: ContactForm) => void
}

const emptyForm: ContactForm = { name: '', department: '', position: '', phone: '', email: '' }
const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: R.icon,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}

export default function ContactAddModal({ isOpen, isSaving, onClose, onSave }: Props) {
  const [form, setForm] = useState<ContactForm>(emptyForm)
  const { errors, setErrors, clearError, validate } = useFieldErrors<'name'>()

  if (!isOpen) return null

  const handleSave = () => {
    const ok = validate({ name: form.name.trim() ? null : '이름을 입력해주세요' })
    if (!ok) return
    onSave(form)
    setForm(emptyForm)
  }

  const handleClose = () => { setForm(emptyForm); setErrors({}); onClose() }

  /** 적은 것이 있는가 — 없으면 Esc·바깥 클릭에 확인을 받지 않는다(ModalOverlay). */
  const dirty = JSON.stringify(form) !== JSON.stringify(emptyForm)

  return (
    <ModalOverlay onClose={handleClose} confirmClose dirty={dirty}>
      {/* ✕ 는 onClose 를 주지 않는다 — 오버레이가 내려 준 닫기 요청(Esc·바깥 클릭과
          **같은 함수**)을 쓴다. 그래서 적은 것이 있으면 세 길 모두 먼저 묻는다. */}
      <ModalCard
        title="고객 담당자 추가"
        width={480}
        footer={<>
          <button onClick={handleClose} style={modalGhostButton()}>취소</button>
          <button onClick={handleSave} disabled={isSaving} style={modalPrimaryButton(isSaving)}>
            {isSaving ? '저장 중...' : '저장'}
          </button>
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
