'use client'

import { useState, type CSSProperties } from 'react'
import type { DeviceForm } from '../types'
import ModalOverlay from '@/components/common/ModalOverlay'

type Props = {
  isOpen: boolean
  isSaving: boolean
  onClose: () => void
  onSave: (form: DeviceForm, packingFile: File | null) => void
}

const emptyForm: DeviceForm = { device_name: '', device_name2: '', option: '', serial_number: '', program: 'ACCTee', install_date: '', category: '20' }
const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: 6,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}
const dateStyle: CSSProperties = { ...fieldStyle, colorScheme: 'light' }

export default function DeviceAddModal({ isOpen, isSaving, onClose, onSave }: Props) {
  const [form, setForm] = useState<DeviceForm>(emptyForm)
  const [packingFile, setPackingFile] = useState<File | null>(null)

  if (!isOpen) return null

  const handleSave = () => {
    if (!form.device_name.trim()) { alert('장비 라인업을 입력해주세요.'); return }
    onSave(form, packingFile)
    setForm(emptyForm)
    setPackingFile(null)
  }

  const handleClose = () => { setForm(emptyForm); setPackingFile(null); onClose() }

  return (
    <ModalOverlay onClose={handleClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720, background: '#ffffff', borderRadius: 8, padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: '1px solid #ebebeb',
          animation: 'modal-in 0.18s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', letterSpacing: '-0.3px' }}>장비 추가</div>
          <button
            onClick={handleClose}
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
            <label style={labelStyle}>장비 라인업 / 모델명 / 옵션</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <input value={form.device_name} onChange={(e) => setForm(p => ({ ...p, device_name: e.target.value }))} placeholder="라인업 (ex. SURFCOM)" style={{ ...fieldStyle, fontSize: 13 }} />
              <input value={form.device_name2} onChange={(e) => setForm(p => ({ ...p, device_name2: e.target.value }))} placeholder="모델명 (ex. 1600D)" style={{ ...fieldStyle, fontSize: 13 }} />
              <input value={form.option} onChange={(e) => setForm(p => ({ ...p, option: e.target.value }))} placeholder="옵션 (ex. -12)" style={{ ...fieldStyle, fontSize: 13 }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>시리얼넘버</label>
              <input value={form.serial_number} onChange={(e) => setForm(p => ({ ...p, serial_number: e.target.value }))} placeholder="시리얼넘버" style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>프로그램</label>
              <select value={form.program} onChange={(e) => setForm(p => ({ ...p, program: e.target.value }))} style={fieldStyle}>
                <option value="ACCTee">ACCTee</option>
                <option value="Tims">Tims</option>
                <option value="CALYPSO">CALYPSO</option>
                <option value="없음">없음</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>납입일자</label>
              <input type="date" value={form.install_date} onChange={(e) => setForm(p => ({ ...p, install_date: e.target.value }))} style={dateStyle} />
            </div>
            <div>
              <label style={labelStyle}>구분</label>
              <select value={form.category} onChange={(e) => setForm(p => ({ ...p, category: e.target.value }))} style={fieldStyle}>
                <option value="20">20</option>
                <option value="81">81</option>
                <option value="83">83</option>
                <option value="84">84</option>
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>납입의사록•패킹리스트</label>
            <label style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', overflow: 'hidden' }}>
              <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: '#fff', background: '#234ea2', borderRadius: 6, padding: '5px 10px' }}>
                파일 선택
              </span>
              <span style={{ flex: 1, fontSize: 13, color: packingFile ? '#111827' : '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {packingFile ? packingFile.name : '납입의사록•패킹리스트 파일 선택'}
              </span>
              <input
                type="file"
                accept=".pdf,.xlsx,.xls,.doc,.docx,.png,.jpg,.jpeg"
                onChange={(e) => setPackingFile(e.target.files?.[0] ?? null)}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          <button
            onClick={handleClose}
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
    </ModalOverlay>
  )
}
