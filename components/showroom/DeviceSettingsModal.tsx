'use client'

// 쇼룸 장비 설정 (superadmin). 장비 자체는 고객사 상세에서 관리하고, 여기서는 쇼룸 설정만 고친다.
// showroom_devices 행이 없는 장비도 그대로 열린다 — 저장하면 라우트가 기본값 위에 만들어 준다.

import { useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import {
  DEVICE_STATUSES, MAX_DAILY_HOURS, deviceTitle, type ShowroomDevice,
} from '@/lib/showroom'
import { BLUE, BLUE_HOVER, BORDER, CARD_BG, TEXT, SUB, MUTED, DANGER, NEUTRAL_BG } from '@/components/common/ui'
import { R } from '@/lib/radius'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', height: 44, padding: '0 12px', border: `1px solid ${BORDER}`, borderRadius: R.icon,
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
    // 입력 폼 — 확인 뒤 닫는다.
    <ModalOverlay onClose={onClose} confirmClose style={{ padding: '6vh 12px' }}>
      {/* 공용 카드로 옮겼다(2026-11-26, 지시 P) — 열림 모션 150ms(이 파일에만 있던
          @keyframes modal-in 0.18s 를 대신한다) · Esc·바깥 클릭·✕ 가 한 함수를 지난다
          (적던 값이 있으면 「저장하지 않고 닫을까요?」를 지난다 — confirmClose 그대로).
          겉모양은 그대로다: 폭 460 · 머리·발의 선과 여백 · 제목 18/700 · 홈바 safe-area. */}
      <ModalCard
        width={460}
        style={{ borderRadius: R.control, maxHeight: 'calc(100dvh - 32px)', border: `1px solid ${BORDER}` }}
        headStyle={{ padding: '16px 20px', borderBottom: `1px solid ${BORDER}`, alignItems: 'center' }}
        bodyStyle={{ padding: '16px 20px', display: 'grid', gap: 14 }}
        footStyle={{
          padding: '14px 20px', paddingBottom: 'calc(14px + env(safe-area-inset-bottom))',
          borderTop: `1px solid ${BORDER}`, flexWrap: 'wrap',
        }}
        title={<>
          <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, letterSpacing: '-0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            장비 설정
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {deviceTitle(device)}
          </div>
        </>}
        footer={<>
          {/* 못 저장한 까닭은 단추 **왼쪽**에 둔다(옛 창은 단추 위였다 — 한 줄로 모았다). */}
          {error && <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: DANGER }}>{error}</div>}
          <button onClick={onClose} disabled={saving}
            style={{ padding: '9px 16px', background: CARD_BG, color: SUB, borderRadius: R.icon, border: `1px solid ${BORDER}`, cursor: saving ? 'default' : 'pointer', fontWeight: 600, fontSize: 13 }}>
            취소
          </button>
          <button onClick={handleSave} disabled={saving}
            onMouseEnter={e => { if (!saving) e.currentTarget.style.background = BLUE_HOVER }}
            onMouseLeave={e => { if (!saving) e.currentTarget.style.background = BLUE }}
            style={{ padding: '9px 18px', background: BLUE, color: '#fff', borderRadius: R.icon, border: 'none', cursor: saving ? 'default' : 'pointer', fontWeight: 700, fontSize: 13, opacity: saving ? 0.6 : 1, transition: 'background 0.15s ease' }}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </>}
      >
        <>
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
            <div style={{ display: 'flex', background: NEUTRAL_BG, borderRadius: R.icon, padding: 3, height: 44, boxSizing: 'border-box' }}>
              <button type="button" onClick={() => setIsActive(true)}
                style={{ flex: 1, border: 'none', borderRadius: R.icon, cursor: 'pointer', fontSize: 14, fontWeight: 700, background: isActive ? CARD_BG : 'transparent', color: isActive ? TEXT : MUTED, transition: 'color 0.15s ease' }}>사용</button>
              <button type="button" onClick={() => setIsActive(false)}
                style={{ flex: 1, border: 'none', borderRadius: R.icon, cursor: 'pointer', fontSize: 14, fontWeight: 700, background: !isActive ? CARD_BG : 'transparent', color: !isActive ? TEXT : MUTED, transition: 'color 0.15s ease' }}>미사용</button>
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
        </>
      </ModalCard>
    </ModalOverlay>
  )
}
