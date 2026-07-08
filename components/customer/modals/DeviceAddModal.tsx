'use client'

import { useState } from 'react'
import type { DeviceForm } from '../types'
import {
  INPUT_BORDER, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY,
  WHITE_BUTTON_BG, WHITE_BUTTON_TEXT, inputStyle, dateInputStyle, modalOverlayStyle,
} from '../constants'

type Props = {
  isOpen: boolean
  isSaving: boolean
  onClose: () => void
  onSave: (form: DeviceForm, packingFile: File | null) => void
}

const emptyForm: DeviceForm = { device_name: '', device_name2: '', option: '', serial_number: '', program: 'ACCTee', install_date: '', category: '20' }
const labelStyle = { fontSize: 12, fontWeight: 600, color: TEXT_MUTED, marginBottom: 5, display: 'block' } as const

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
    <div onClick={handleClose} style={modalOverlayStyle}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720, background: '#ffffff', borderRadius: 20, padding: 28,
          boxShadow: '0 16px 48px rgba(0,0,0,0.22)', border: `1px solid ${INPUT_BORDER}`,
          animation: 'modal-in 0.18s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: TEXT_PRIMARY }}>장비 추가</div>
          <button
            onClick={handleClose}
            style={{ width: 30, height: 30, borderRadius: '50%', background: '#f4f5f7', border: 'none', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_SECONDARY }}
          >✕</button>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={labelStyle}>장비 라인업 / 모델명 / 옵션</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <input value={form.device_name} onChange={(e) => setForm(p => ({ ...p, device_name: e.target.value }))} placeholder="라인업 (ex. SURFCOM)" style={{ ...inputStyle, fontSize: 12 }} />
              <input value={form.device_name2} onChange={(e) => setForm(p => ({ ...p, device_name2: e.target.value }))} placeholder="모델명 (ex. 1600D)" style={{ ...inputStyle, fontSize: 12 }} />
              <input value={form.option} onChange={(e) => setForm(p => ({ ...p, option: e.target.value }))} placeholder="옵션 (ex. -12)" style={{ ...inputStyle, fontSize: 12 }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>시리얼넘버</label>
              <input value={form.serial_number} onChange={(e) => setForm(p => ({ ...p, serial_number: e.target.value }))} placeholder="시리얼넘버" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>프로그램</label>
              <select value={form.program} onChange={(e) => setForm(p => ({ ...p, program: e.target.value }))} style={inputStyle}>
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
              <input type="date" value={form.install_date} onChange={(e) => setForm(p => ({ ...p, install_date: e.target.value }))} style={dateInputStyle} />
            </div>
            <div>
              <label style={labelStyle}>구분</label>
              <select value={form.category} onChange={(e) => setForm(p => ({ ...p, category: e.target.value }))} style={inputStyle}>
                <option value="20">20</option>
                <option value="81">81</option>
                <option value="83">83</option>
                <option value="84">84</option>
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>납입의사록•패킹리스트</label>
            <label style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', overflow: 'hidden' }}>
              <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: WHITE_BUTTON_TEXT, background: WHITE_BUTTON_BG, borderRadius: 7, padding: '5px 10px' }}>
                파일 선택
              </span>
              <span style={{ flex: 1, fontSize: 12, color: packingFile ? TEXT_PRIMARY : '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
            style={{ padding: '10px 16px', background: '#f4f5f7', color: TEXT_PRIMARY, borderRadius: 10, border: `1px solid ${INPUT_BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
          >취소</button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{ padding: '10px 20px', background: WHITE_BUTTON_BG, color: WHITE_BUTTON_TEXT, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isSaving ? 0.7 : 1 }}
          >
            {isSaving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
