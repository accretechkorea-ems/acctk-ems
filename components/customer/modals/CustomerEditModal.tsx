'use client'

import { useEffect, useState } from 'react'
import type { Customer, CustomerEditFormData } from '../types'
import {
  DANGER_BG, INPUT_BORDER, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY,
  WHITE_BUTTON_BG, WHITE_BUTTON_TEXT, inputStyle, modalOverlayStyle,
} from '../constants'

type Props = {
  customer: Customer | null
  isSaving: boolean
  isDeleting?: boolean
  onClose: () => void
  onSave: (form: CustomerEditFormData) => void
  onDelete?: () => void
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: TEXT_MUTED, marginBottom: 5, display: 'block' } as const

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
    <div onClick={onClose} style={modalOverlayStyle}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, background: '#ffffff', borderRadius: 20, padding: 28,
          boxShadow: '0 16px 48px rgba(0,0,0,0.22)', border: `1px solid ${INPUT_BORDER}`,
          animation: 'modal-in 0.18s ease',
        }}
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: TEXT_PRIMARY }}>업체 정보 수정</div>
          <button
            onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: '50%', background: '#f4f5f7', border: 'none', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_SECONDARY }}
          >✕</button>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={labelStyle}>업체명</label>
            <input value={form.company_name} onChange={(e) => setForm(p => ({ ...p, company_name: e.target.value }))} placeholder="업체명" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>주소</label>
            <input value={form.address} onChange={(e) => setForm(p => ({ ...p, address: e.target.value }))} placeholder="주소" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>대리점</label>
            <input value={form.agency} onChange={(e) => setForm(p => ({ ...p, agency: e.target.value }))} placeholder="대리점" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>상태</label>
            <select value={form.status} onChange={(e) => setForm(p => ({ ...p, status: e.target.value }))} style={inputStyle}>
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
              style={{ padding: '10px 16px', background: DANGER_BG, color: '#fff', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isDeleting ? 0.7 : 1 }}
            >
              {isDeleting ? '삭제 중...' : '삭제'}
            </button>
          ) : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{ padding: '10px 16px', background: '#f4f5f7', color: TEXT_PRIMARY, borderRadius: 10, border: `1px solid ${INPUT_BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >취소</button>
            <button
              onClick={() => onSave(form)}
              disabled={isSaving}
              style={{ padding: '10px 20px', background: WHITE_BUTTON_BG, color: WHITE_BUTTON_TEXT, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isSaving ? 0.7 : 1 }}
            >
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
