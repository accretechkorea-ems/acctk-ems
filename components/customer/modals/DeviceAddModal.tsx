'use client'

import { useState, type CSSProperties } from 'react'
import type { DeviceForm } from '../types'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { R } from '@/lib/radius'

type Props = {
  isOpen: boolean
  isSaving: boolean
  onClose: () => void
  onSave: (form: DeviceForm, packingFile: File | null) => void
}

const emptyForm: DeviceForm = { device_name: '', device_name2: '', option: '', serial_number: '', program: 'ACCTee', install_date: '', category: '20' }
const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: R.icon,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}
const dateStyle: CSSProperties = { ...fieldStyle, colorScheme: 'light' }

export default function DeviceAddModal({ isOpen, isSaving, onClose, onSave }: Props) {
  const [form, setForm] = useState<DeviceForm>(emptyForm)
  const [packingFile, setPackingFile] = useState<File | null>(null)
  const { errors, setErrors, clearError, validate } = useFieldErrors<'device_name'>()

  if (!isOpen) return null

  const handleSave = () => {
    const ok = validate({ device_name: form.device_name.trim() ? null : '장비 라인업을 입력해주세요' })
    if (!ok) return
    onSave(form, packingFile)
    setForm(emptyForm)
    setPackingFile(null)
  }

  const handleClose = () => { setForm(emptyForm); setPackingFile(null); setErrors({}); onClose() }

  /** 적은 것이나 고른 파일이 있는가 — 없으면 확인 없이 닫힌다(ModalOverlay). */
  const dirty = JSON.stringify(form) !== JSON.stringify(emptyForm) || packingFile !== null

  return (
    <ModalOverlay onClose={handleClose} confirmClose dirty={dirty}>
      <ModalCard
        title="장비 추가"
        width={720}
        footer={<>
          <button
            onClick={handleClose}
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
        </>}
      >

        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={labelStyle}>장비 라인업 / 모델명 / 옵션</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <input value={form.device_name} onChange={(e) => { setForm(p => ({ ...p, device_name: e.target.value })); clearError('device_name') }} placeholder="라인업 (ex. SURFCOM)" style={errors.device_name ? { ...fieldStyle, fontSize: 13, border: errBorder } : { ...fieldStyle, fontSize: 13 }} />
              <input value={form.device_name2} onChange={(e) => setForm(p => ({ ...p, device_name2: e.target.value }))} placeholder="모델명 (ex. 1600D)" style={{ ...fieldStyle, fontSize: 13 }} />
              <input value={form.option} onChange={(e) => setForm(p => ({ ...p, option: e.target.value }))} placeholder="옵션 (ex. -12)" style={{ ...fieldStyle, fontSize: 13 }} />
            </div>
            <FieldError message={errors.device_name} />
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
              <input type="date" className="date-fit" value={form.install_date} onChange={(e) => setForm(p => ({ ...p, install_date: e.target.value }))} style={dateStyle} />
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
              <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: '#fff', background: '#234ea2', borderRadius: R.icon, padding: '5px 10px' }}>
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

      </ModalCard>
    </ModalOverlay>
  )
}
