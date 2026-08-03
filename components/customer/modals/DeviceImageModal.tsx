'use client'

import { useState } from 'react'
import type { Device } from '../types'
import { INPUT_BORDER, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WHITE_BUTTON_BG, WHITE_BUTTON_TEXT, inputStyle } from '../constants'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'

type Props = {
  device: Device | null
  isSaving: boolean
  onClose: () => void
  onSave: (file: File) => void
}

export default function DeviceImageModal({ device, isSaving, onClose, onSave }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const { errors, setErrors, clearError, validate } = useFieldErrors<'file'>()

  if (!device) return null

  const handleClose = () => { setFile(null); setErrors({}); onClose() }

  const handleSave = () => {
    const ok = validate({ file: file ? null : '이미지 파일을 선택해주세요' })
    if (!ok) return
    onSave(file!)
    setFile(null)
  }

  return (
    <ModalOverlay onClose={handleClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, background: '#ffffff', borderRadius: 20, padding: 28,
          boxShadow: '0 16px 48px rgba(0,0,0,0.22)', border: `1px solid ${INPUT_BORDER}`,
          animation: 'modal-in 0.18s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: TEXT_PRIMARY }}>장비 사진 등록</div>
          <button
            onClick={handleClose}
            style={{ width: 30, height: 30, borderRadius: '50%', background: '#f4f5f7', border: 'none', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_SECONDARY }}
          >✕</button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: TEXT_MUTED, marginBottom: 6 }}>이미지 파일 선택</div>
        <input type="file" accept="image/*" onChange={(e) => { setFile(e.target.files?.[0] ?? null); clearError('file') }} style={errors.file ? { ...inputStyle, border: errBorder } : inputStyle} />
        <FieldError message={errors.file} />

        {file && (
          <div style={{ marginTop: 10, fontSize: 13, color: TEXT_SECONDARY }}>
            선택됨: {file.name}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          <button onClick={handleClose} style={{ padding: '10px 16px', background: '#f4f5f7', color: TEXT_PRIMARY, borderRadius: 10, border: `1px solid ${INPUT_BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>취소</button>
          <button onClick={handleSave} disabled={isSaving} style={{ padding: '10px 20px', background: WHITE_BUTTON_BG, color: WHITE_BUTTON_TEXT, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isSaving ? 0.7 : 1 }}>
            {isSaving ? '업로드 중...' : '저장'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
