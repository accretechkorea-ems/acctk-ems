'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import type { Contact, ContactForm } from '../types'
import ModalOverlay from '@/components/common/ModalOverlay'

type Props = {
  contact: Contact | null
  isSaving: boolean
  onClose: () => void
  onSave: (form: ContactForm) => void
  onDelete: () => void
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: 6,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}

export default function ContactEditModal({ contact, isSaving, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<ContactForm>({ name: '', department: '', position: '', phone: '', email: '' })

  useEffect(() => {
    if (contact) {
      setForm({
        name: contact.name ?? '',
        department: contact.department ?? '',
        position: contact.position ?? '',
        phone: contact.phone ?? '',
        email: contact.email ?? '',
      })
    }
  }, [contact])

  if (!contact) return null

  const handleSave = () => {
    if (!form.name.trim()) { alert('이름을 입력해주세요.'); return }
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
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', letterSpacing: '-0.3px' }}>담당자 수정</div>
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
              <label style={labelStyle}>이름 *</label>
              <input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="이름" style={fieldStyle} />
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

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 24 }}>
          <button
            onClick={onDelete}
            disabled={isSaving}
            style={{ padding: '9px 16px', background: '#ef4444', color: '#fff', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isSaving ? 0.6 : 1 }}
          >삭제</button>
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
