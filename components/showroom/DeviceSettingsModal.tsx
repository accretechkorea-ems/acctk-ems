'use client'

// 쇼룸 장비 설정 (superadmin). 장비 자체는 고객사 상세에서 관리하고, 여기서는 쇼룸 설정만 고친다.
// showroom_devices 행이 없는 장비도 그대로 열린다 — 저장하면 라우트가 기본값 위에 만들어 준다.

import { useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import {
  DEVICE_STATUSES, MAX_DAILY_HOURS, deviceTitle, type ShowroomDevice,
} from '@/lib/showroom'
import { BLUE, BLUE_HOVER, BORDER, CARD_BG, TEXT, SUB, MUTED, DANGER, NEUTRAL_BG } from '@/components/common/ui'

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: SUB, marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', height: 44, padding: '0 12px', border: `1px solid ${BORDER}`, borderRadius: 6,
  boxSizing: 'border-box', color: TEXT, background: CARD_BG, outline: 'none', fontSize: 16, fontFamily: 'inherit',
}

export type DevicePatch = {
  device_id: number
  daily_hours: number
  device_status: string
  is_active: boolean
  sort_order: number
  note: string
}

type Props = {
  device: ShowroomDevice
  onClose: () => void
  onSubmit: (patch: DevicePatch) => Promise<string | null>
}

export default function DeviceSettingsModal({ device, onClose, onSubmit }: Props) {
  const [dailyHours, setDailyHours] = useState(String(device.daily_hours))
  const [status, setStatus] = useState(device.device_status)
  const [isActive, setIsActive] = useState(device.is_active)
  const [sortOrder, setSortOrder] = useState(String(device.sort_order))
  const [note, setNote] = useState(device.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    const hours = Number(dailyHours)
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_DAILY_HOURS) {
      setError(`일 가용시간은 0 초과 ${MAX_DAILY_HOURS} 이하로 입력해주세요.`)
      return
    }
    const order = Number(sortOrder)
    if (!Number.isInteger(order)) { setError('정렬순서는 정수로 입력해주세요.'); return }

    setSaving(true)
    setError(null)
    const message = await onSubmit({
      device_id: device.device_id,
      daily_hours: hours,
      device_status: status,
      is_active: isActive,
      sort_order: order,
      note,
    })
    setSaving(false)
    if (message) setError(message)
  }

  return (
    <ModalOverlay onClose={onClose} style={{ padding: 12 }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'calc(100vw - 24px)', maxWidth: 460, maxHeight: 'calc(100dvh - 32px)',
        background: CARD_BG, borderRadius: 8, boxSizing: 'border-box',
        boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: `1px solid ${BORDER}`,
        animation: 'modal-in 0.18s ease', display: 'flex', flexDirection: 'column',
      }}>
        <style>{`
          @keyframes modal-in {
            from { opacity: 0; transform: scale(0.97) translateY(8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', flexShrink: 0, borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, letterSpacing: '-0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              장비 설정
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {deviceTitle(device)}
            </div>
          </div>
          <button onClick={onClose} title="닫기"
            onMouseEnter={e => (e.currentTarget.style.color = TEXT)}
            onMouseLeave={e => (e.currentTarget.style.color = SUB)}
            style={{ width: 30, height: 30, borderRadius: '50%', background: NEUTRAL_BG, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUB, transition: 'color 0.15s ease', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'grid', gap: 14 }}>
          <div>
            <label style={labelStyle}>일 가용시간</label>
            <input type="number" min={0.5} max={MAX_DAILY_HOURS} step={0.5} value={dailyHours}
              onChange={e => { setDailyHours(e.target.value); setError(null) }} style={fieldStyle} />
            <div style={{ marginTop: 6, fontSize: 12, color: MUTED }}>가동률 계산의 분모로 쓰인다</div>
          </div>

          <div>
            <label style={labelStyle}>장비상태</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={fieldStyle}>
              {DEVICE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>사용여부</label>
            <div style={{ display: 'flex', background: NEUTRAL_BG, borderRadius: 6, padding: 3, height: 44, boxSizing: 'border-box' }}>
              <button type="button" onClick={() => setIsActive(true)}
                style={{ flex: 1, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 700, background: isActive ? CARD_BG : 'transparent', color: isActive ? TEXT : MUTED, transition: 'color 0.15s ease' }}>사용</button>
              <button type="button" onClick={() => setIsActive(false)}
                style={{ flex: 1, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 700, background: !isActive ? CARD_BG : 'transparent', color: !isActive ? TEXT : MUTED, transition: 'color 0.15s ease' }}>미사용</button>
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: MUTED }}>
              미사용으로 두면 가동률 집계와 일반 사용자 목록에서 빠진다
            </div>
          </div>

          <div>
            <label style={labelStyle}>정렬순서</label>
            <input type="number" step={1} value={sortOrder}
              onChange={e => { setSortOrder(e.target.value); setError(null) }} style={fieldStyle} />
          </div>

          <div>
            <label style={labelStyle}>비고</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="선택" style={fieldStyle} />
          </div>
        </div>

        <div style={{ padding: '14px 20px', paddingBottom: 'calc(14px + env(safe-area-inset-bottom))', flexShrink: 0, borderTop: `1px solid ${BORDER}` }}>
          {error && <div style={{ marginBottom: 10, fontSize: 12, fontWeight: 600, color: DANGER }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose} disabled={saving}
              style={{ padding: '9px 16px', background: CARD_BG, color: SUB, borderRadius: 6, border: `1px solid ${BORDER}`, cursor: saving ? 'default' : 'pointer', fontWeight: 600, fontSize: 13 }}>
              취소
            </button>
            <button onClick={handleSave} disabled={saving}
              onMouseEnter={e => { if (!saving) e.currentTarget.style.background = BLUE_HOVER }}
              onMouseLeave={e => { if (!saving) e.currentTarget.style.background = BLUE }}
              style={{ padding: '9px 18px', background: BLUE, color: '#fff', borderRadius: 6, border: 'none', cursor: saving ? 'default' : 'pointer', fontWeight: 700, fontSize: 13, opacity: saving ? 0.6 : 1, transition: 'background 0.15s ease' }}>
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  )
}
