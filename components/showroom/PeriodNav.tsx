'use client'

// ◀ 기간 ▶ — 가운데 기간 표시를 누르면 기간 선택 모달(월·분기·반기·연·지정)이 열린다.
// ◀ ▶ 는 지금 모드의 한 단위만큼 옮긴다(lib/showroom.ts shiftPeriod).
// 가동률 탭 헤더와 전체기록 탭 필터 줄이 같이 쓴다.
//
// 모달은 position: fixed 라, 이 컴포넌트를 transform 이 걸린 조상 안에 두면 그 조상 기준으로 뜬다.
// 헤더의 나타남 모션은 다 나타난 뒤 transform 을 none 으로 돌려 두므로 괜찮다(ShowroomHeader 참고).

import { useState, type CSSProperties } from 'react'
import { periodLabel, shiftPeriod, type Period } from '@/lib/showroom'
import { BORDER, CARD_BG, TEXT, MUTED, SUB, NEUTRAL_BG } from '@/components/common/ui'
import PeriodPickerModal from './PeriodPickerModal'

const CSS = `
  .sr-period { transition: background 0.15s ease; }
  .sr-period:hover, .sr-period:focus-visible { background: ${NEUTRAL_BG}; outline: none; }
`

const navBtn: CSSProperties = {
  width: 30, height: 30, border: `1px solid ${BORDER}`, borderRadius: 6, background: CARD_BG,
  color: SUB, cursor: 'pointer', fontSize: 13, fontWeight: 700, flexShrink: 0,
}

const periodBtn: CSSProperties = {
  height: 30, minWidth: 120, padding: '0 10px', border: 'none', borderRadius: 6, background: 'transparent',
  color: TEXT, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
}

export default function PeriodNav({ period, onChange }: { period: Period; onChange: (period: Period) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <style>{CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button onClick={() => onChange(shiftPeriod(period, -1))} aria-label="이전 기간" style={navBtn}>◀</button>
        <button className="sr-period" onClick={() => setOpen(true)} title="기간 선택" style={periodBtn}>
          {periodLabel(period)}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <button onClick={() => onChange(shiftPeriod(period, 1))} aria-label="다음 기간" style={navBtn}>▶</button>
      </div>
      {open && (
        <PeriodPickerModal
          period={period}
          onClose={() => setOpen(false)}
          onPick={p => { onChange(p); setOpen(false) }}
        />
      )}
    </>
  )
}
