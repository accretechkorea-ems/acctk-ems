'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import type { Customer, CustomerEditFormData } from '../types'
import ModalOverlay from '@/components/common/ModalOverlay'

type Props = {
  customer: Customer | null
  isSaving: boolean
  isDeleting?: boolean
  onClose: () => void
  onSave: (form: CustomerEditFormData) => void
  onDelete?: () => void
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: 6,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}

export default function CustomerEditModal({ customer, isSaving, isDeleting, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<CustomerEditFormData>({ company_name: '', address: '', agency: '', status: '활성' })

  useEffect(() => {
    if (customer) {
      setForm({
        company_name: customer.company_name ?? '',
        address: customer.address ?? '',
        agency: customer.agency ?? '',
        status: customer.status ?? '활성',
      })
    }
  }, [customer])

  if (!customer) return null

  return (
    <ModalOverlay onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, background: '#ffffff', borderRadius: 8, padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: '1px solid #ebebeb',
          animation: 'modal-in 0.18s ease',
        }}
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', letterSpacing: '-0.3px' }}>업체 정보 수정</div>
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
          <div>
            <label style={labelStyle}>업체명</label>
            <input value={form.company_name} onChange={(e) => setForm(p => ({ ...p, company_name: e.target.value }))} placeholder="업체명" style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>주소</label>
            <input value={form.address} onChange={(e) => setForm(p => ({ ...p, address: e.target.value }))} placeholder="주소" style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>대리점</label>
            <input value={form.agency} onChange={(e) => setForm(p => ({ ...p, agency: e.target.value }))} placeholder="대리점" style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>상태</label>
            <select value={form.status} onChange={(e) => setForm(p => ({ ...p, status: e.target.value }))} style={fieldStyle}>
              <option value="활성">활성</option>
              <option value="잠재">잠재</option>
              <option value="이탈">이탈</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 24 }}>
          {onDelete ? (
            <button
              onClick={onDelete}
              disabled={isDeleting}
              style={{ padding: '9px 16px', background: '#ef4444', color: '#fff', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isDeleting ? 0.6 : 1 }}
            >
              {isDeleting ? '삭제 중...' : '삭제'}
            </button>
          ) : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{ padding: '9px 16px', background: '#fff', color: '#6b7280', borderRadius: 6, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >취소</button>
            <button
              onClick={() => onSave(form)}
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
