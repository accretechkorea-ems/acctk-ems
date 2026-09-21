'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Device, DeviceForm } from '../types'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { useToast } from '@/components/common/Toast'
import { getDefaultImageUrl } from '../utils'
import { removeDeviceImage, uploadDeviceImage } from '@/hooks/customer/useDeviceCrud'

/** 사진 삭제 확정 대기 시간. */
const IMG_CONFIRM_MS = 3000

type Props = {
  device: Device | null
  isSaving: boolean
  onClose: () => void
  onSave: (form: DeviceForm, packingFile: File | null) => void
  onDelete: () => void
  onOpenPacking: () => void
  /** 사진을 바꾸거나 지운 직후 목록을 다시 읽는다 — 카드 썸네일이 바로 따라오게. */
  onImageChanged?: () => void
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: 6,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}
const dateStyle: CSSProperties = { ...fieldStyle, colorScheme: 'light' }

export default function DeviceEditModal({ device, isSaving, onClose, onSave, onDelete, onOpenPacking, onImageChanged }: Props) {
  const [form, setForm] = useState<DeviceForm>({ device_name: '', device_name2: '', option: '', serial_number: '', program: 'ACCTee', install_date: '', category: '20' })
  const [packingFile, setPackingFile] = useState<File | null>(null)
  const { errors, setErrors, clearError, validate } = useFieldErrors<'device_name'>()

  // 장비 사진 — 저장 버튼과 무관하게 즉시 반영된다.
  // 목록(카드)은 이 모달을 저장하거나 화면을 다시 읽을 때 따라온다.
  const toast = useToast()
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  // 처음 그릴 때부터 실제 사진을 보여준다. 다른 장비로 바뀌는 것은 아래 effect 가 맞춘다
  // (effect 로만 잡으면 첫 페인트에 기본 이미지가 잠깐 스친다).
  const [imageUrl, setImageUrl] = useState<string | null>(device?.image_url ?? null)
  const [imgBusy, setImgBusy] = useState(false)
  const [imgRemoving, setImgRemoving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  useEffect(() => {
    if (device) {
      setForm({
        device_name: device.device_name ?? '',
        device_name2: device.device_name2 ?? '',
        option: device.option ?? '',
        serial_number: device.serial_number ?? '',
        program: device.program ?? 'ACCTee',
        install_date: device.install_date ?? '',
        category: device.category ?? '20',
      })
      setPackingFile(null)
      setImageUrl(device.image_url)
      setConfirmRemove(false)
      setErrors({})
    }
  }, [device])

  useEffect(() => () => { if (removeTimer.current) clearTimeout(removeTimer.current) }, [])

  if (!device) return null

  // 개별 사진 → 기본 이미지 → 없음 순으로 보여준다.
  const defaultImg = getDefaultImageUrl(device, supabaseUrl)
  const shownImage = imageUrl ?? defaultImg

  /** 삭제는 두 번 눌러야 실행된다. 3초가 지나면 원래대로 돌아간다. */
  const armRemove = () => {
    if (removeTimer.current) clearTimeout(removeTimer.current)
    setConfirmRemove(true)
    removeTimer.current = setTimeout(() => { removeTimer.current = null; setConfirmRemove(false) }, IMG_CONFIRM_MS)
  }

  const handleImageFile = async (file: File | null) => {
    if (!file) return
    setImgBusy(true)
    // 지금 보이는 개별 사진을 기준으로 올린다 — 연달아 바꿔도 직전 파일이 정리된다.
    const r = await uploadDeviceImage({ ...device, image_url: imageUrl }, file)
    setImgBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    setImageUrl(r.url)
    onImageChanged?.()
    toast.success('장비 사진이 등록되었습니다')
  }

  const handleImageRemove = async () => {
    if (removeTimer.current) { clearTimeout(removeTimer.current); removeTimer.current = null }
    setConfirmRemove(false)
    setImgRemoving(true)
    const r = await removeDeviceImage({ ...device, image_url: imageUrl })
    setImgRemoving(false)
    if (!r.ok) { toast.error(r.error); return }
    setImageUrl(null)
    onImageChanged?.()
    toast.success('장비 사진이 삭제되었습니다')
  }

  const handleSave = () => {
    const ok = validate({ device_name: form.device_name.trim() ? null : '장비 라인업을 입력해주세요' })
    if (!ok) return
    onSave(form, packingFile)
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720, background: '#ffffff', borderRadius: 8, padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: '1px solid #ebebeb',
          animation: 'modal-in 0.18s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', letterSpacing: '-0.3px' }}>장비 수정</div>
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
            <label style={labelStyle}>장비 라인업 / 모델명 / 옵션</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <input value={form.device_name} onChange={(e) => { setForm(p => ({ ...p, device_name: e.target.value })); clearError('device_name') }} placeholder="라인업" style={errors.device_name ? { ...fieldStyle, fontSize: 13, border: errBorder } : { ...fieldStyle, fontSize: 13 }} />
              <input value={form.device_name2} onChange={(e) => setForm(p => ({ ...p, device_name2: e.target.value }))} placeholder="모델명" style={{ ...fieldStyle, fontSize: 13 }} />
              <input value={form.option} onChange={(e) => setForm(p => ({ ...p, option: e.target.value }))} placeholder="옵션" style={{ ...fieldStyle, fontSize: 13 }} />
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
            <label style={labelStyle}>
              납입의사록•패킹리스트
              {device.packing_list_url && (
                <button
                  type="button"
                  onClick={onOpenPacking}
                  style={{ marginLeft: 8, fontWeight: 700, color: '#234ea2', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12 }}
                >
                  현재 파일 열기
                </button>
              )}
            </label>
            <label
              style={{
                ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8,
                cursor: 'pointer', overflow: 'hidden',
              }}
            >
              <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: '#fff', background: '#234ea2', borderRadius: 6, padding: '5px 10px' }}>
                파일 선택
              </span>
              <span style={{ flex: 1, fontSize: 13, color: packingFile ? '#111827' : '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {packingFile
                  ? packingFile.name
                  : device.packing_list_url
                    ? '등록됨 — 새 파일로 교체하려면 선택'
                    : '납입의사록•패킹리스트 파일 선택'}
              </span>
              <input
                type="file"
                accept=".pdf,.xlsx,.xls,.doc,.docx,.png,.jpg,.jpeg"
                onChange={(e) => setPackingFile(e.target.files?.[0] ?? null)}
                style={{ display: 'none' }}
              />
            </label>
          </div>

          {/* 장비 사진 — 카드 우측 위는 수정 아이콘 자리라 여기서 바꾼다.
              고르는 즉시 올라가고 지우는 것도 즉시다(저장 버튼과 무관하다). */}
          <div>
            <label style={labelStyle}>장비 사진</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                role="img"
                aria-label={shownImage ? '장비 사진 미리보기' : '등록된 사진 없음'}
                style={{
                  width: 96, flexShrink: 0, aspectRatio: '4 / 3', borderRadius: 6, overflow: 'hidden',
                  border: shownImage ? '1px solid #ebebeb' : '1px dashed #ebebeb',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff',
                  backgroundImage: shownImage ? `url("${shownImage}")` : undefined,
                  backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat',
                }}
              >
                {!shownImage && <span style={{ fontSize: 11, fontWeight: 600, color: '#d1d5db' }}>없음</span>}
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
                  {imageUrl ? '등록된 사진' : shownImage ? '기본 이미지' : '등록된 사진이 없습니다'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    disabled={imgBusy}
                    onClick={() => imageInputRef.current?.click()}
                    style={{
                      border: '1px solid #ebebeb', borderRadius: 6, background: '#fff',
                      color: imgBusy ? '#d1d5db' : '#6b7280', fontSize: 13, fontWeight: 600,
                      padding: '7px 12px', cursor: imgBusy ? 'default' : 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    {imgBusy ? '올리는 중...' : '사진 변경'}
                  </button>

                  {imageUrl && (
                    <button
                      type="button"
                      disabled={imgBusy || imgRemoving}
                      onClick={() => { if (confirmRemove) void handleImageRemove(); else armRemove() }}
                      style={confirmRemove || imgRemoving
                        ? { border: 'none', borderRadius: 6, background: '#ef4444', color: '#fff', fontSize: 13, fontWeight: 700, padding: '8px 13px', cursor: imgRemoving ? 'default' : 'pointer', whiteSpace: 'nowrap', opacity: imgRemoving ? 0.6 : 1 }
                        : { border: '1px solid #ebebeb', borderRadius: 6, background: '#fff', color: '#9ca3af', fontSize: 13, fontWeight: 600, padding: '7px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {imgRemoving ? '삭제 중...' : confirmRemove ? '삭제 확인' : '사진 삭제'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; void handleImageFile(f) }}
              style={{ display: 'none' }}
            />
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
