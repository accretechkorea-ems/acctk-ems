'use client'

// 홀딩 해제 모달. 두 경로가 같이 쓴다.
//   1) 홀딩 상세에서 [홀딩 해제] 를 누른 경우
//   2) 새 서비스 레포트를 저장한 뒤 그 장비에 진행 중인 홀딩이 있어 물어보는 경우 (notice 로 안내)
// 닫아도 아무것도 되돌리지 않는다 — 레포트는 이미 저장된 상태다.

import { useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import { elapsedLabel } from '../holding'
import type { Holding } from '../types'
import { todayKST } from '@/lib/date'
import { R } from '@/lib/radius'

type Props = {
  isOpen: boolean
  holding: Holding | null
  notice?: string | null      // 레포트 저장 후 물어볼 때 띄우는 안내 문구
  isSaving: boolean
  onClose: () => void
  onResolve: (holdingId: number, note: string, resolvedAt: string) => void
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#4b5563', marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: R.icon,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}
const dateFieldStyle: CSSProperties = { ...fieldStyle, colorScheme: 'light' }
const areaStyle: CSSProperties = { ...fieldStyle, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }

// 닫히면 껍데기가 null 을 돌려주어 이 폼이 통째로 언마운트된다.
// 덕분에 다시 열 때 입력값이 자연히 초기화되어, 초기화용 effect 를 둘 필요가 없다.
export default function HoldingResolveModal({ isOpen, holding, ...rest }: Props) {
  if (!isOpen || !holding) return null
  return <ResolveForm holding={holding} {...rest} />
}

function ResolveForm({ holding, notice, isSaving, onClose, onResolve }: Omit<Props, 'isOpen' | 'holding'> & { holding: Holding }) {
  const [note, setNote] = useState('')
  // 날짜 칸의 기본값 — 아래 dirty 판정이 이 값과 견준다(오늘 그대로면 손대지 않은 것이다).
  const today = todayKST()
  const [resolvedAt, setResolvedAt] = useState(today)

  return (
    <ModalOverlay onClose={onClose} confirmClose dirty={note.trim() !== '' || resolvedAt !== today}>
      <ModalCard
        width={460}
        title={<>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', letterSpacing: '-0.3px' }}>홀딩 해제</div>
            {notice && (
              <div style={{ fontSize: 12, color: '#4b5563', marginTop: 5 }}>{notice}</div>
            )}
          </div>
        </>}
        footer={<>
          <button onClick={onClose}
            style={{ padding: '9px 16px', background: '#fff', color: '#4b5563', borderRadius: R.icon, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
          >{notice ? '나중에' : '취소'}</button>
          <button
            onClick={() => onResolve(holding.holding_id, note, resolvedAt)}
            disabled={isSaving}
            onMouseEnter={(e) => { if (!isSaving) e.currentTarget.style.background = '#1c3e87' }}
            onMouseLeave={(e) => { if (!isSaving) e.currentTarget.style.background = '#234ea2' }}
            style={{ padding: '9px 18px', background: '#234ea2', color: '#fff', borderRadius: R.icon, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isSaving ? 0.6 : 1, transition: 'background 0.15s ease' }}
          >
            {isSaving ? '처리 중...' : '해제'}
          </button>
        </>}
      >

        {/* 어떤 홀딩을 해제하는지 */}
        <div style={{ padding: '10px 12px', background: '#f8fafc', border: '1px solid #ebebeb', borderRadius: R.control, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', wordBreak: 'break-all' }}>{holding.title}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>{holding.devices?.device_name ?? '-'}</span>
            <span style={{ color: '#6b7280' }}>·</span>
            <span>시작 {holding.started_at}</span>
            <span style={{ color: '#6b7280' }}>·</span>
            <span>{elapsedLabel(holding)}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={labelStyle}>해제일</label>
            <input type="date" className="date-fit" value={resolvedAt} onChange={(e) => setResolvedAt(e.target.value)} style={dateFieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>해제 사유</label>
            <textarea value={note} rows={4}
              onChange={(e) => setNote(e.target.value)}
              placeholder="어떻게 해결됐는지 적어주세요"
              style={areaStyle} />
          </div>
        </div>

      </ModalCard>
    </ModalOverlay>
  )
}
