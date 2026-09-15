'use client'

// 기간 선택 모달 — 가동률 헤더의 기간 표시를 누르면 열린다.
//   모드: 월 / 분기 / 반기 / 연 / 지정
//   월·분기·반기는 연도를 옮기며 단위를 고르고, 연은 최근 5년 중에서, 지정은 시작일·종료일을 직접 넣는다.
//   단위를 누르면 바로 적용하고 닫힌다. 지정만 [적용] 을 눌러야 한다(날짜 두 개를 다 넣어야 해서).
// 바깥 클릭·ESC 는 공용 useOutsideClick 이 닫는다.
// 아직 오지 않은 달·분기도 고를 수 있다(흐리게 보인다) — 고르면 '아직 오지 않은 기간' 안내가 나온다.

import { useRef, useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import SegmentedControl from '@/components/common/SegmentedControl'
import { useOutsideClick } from '@/hooks/useOutsideClick'
import { nowKSTParts, daysBetween } from '@/lib/date'
import {
  PERIOD_MODES, MAX_PERIOD_DAYS, periodRange, isValidYmd, type Period, type PeriodMode,
} from '@/lib/showroom'
import {
  BLUE, BORDER, CARD_BG, TEXT, MUTED, SUB, DANGER, NEUTRAL_BG, ROW_HOVER_BG, btnPrimary, inputStyle,
} from '@/components/common/ui'

const RECENT_YEARS = 5
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const QUARTERS = [1, 2, 3, 4].map(q => ({ value: q, label: `${q}분기`, sub: `${q * 3 - 2}~${q * 3}월` }))
const HALVES = [
  { value: 1, label: '상반기', sub: '1~6월' },
  { value: 2, label: '하반기', sub: '7~12월' },
]

// 고른 칸은 주 버튼과 같은 파랑, 나머지는 테두리만. hover 는 목록 행 hover 배경.
const CELL_CSS = `
  .sr-pcell { transition: background 0.15s ease; }
  .sr-pcell[data-selected="0"]:hover, .sr-pcell[data-selected="0"]:focus-visible { background: ${ROW_HOVER_BG}; outline: none; }
`

const cell = (selected: boolean, dim: boolean): CSSProperties => ({
  height: 44, borderRadius: 6, fontFamily: 'inherit', cursor: 'pointer',
  border: selected ? `1px solid ${BLUE}` : `1px solid ${BORDER}`,
  background: selected ? BLUE : CARD_BG,
  color: selected ? '#ffffff' : dim ? MUTED : TEXT,
  fontSize: 13, fontWeight: selected ? 700 : 600,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
})

const cellSub = (selected: boolean): CSSProperties => ({
  fontSize: 11, fontWeight: 500, color: selected ? '#ffffff' : MUTED, opacity: selected ? 0.8 : 1,
})

const navBtn: CSSProperties = {
  width: 30, height: 30, border: `1px solid ${BORDER}`, borderRadius: 6, background: CARD_BG,
  color: SUB, cursor: 'pointer', fontSize: 13, fontWeight: 700,
}

function YearStepper({ year, onChange }: { year: number; onChange: (y: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 12 }}>
      <button onClick={() => onChange(year - 1)} aria-label="이전 해" style={navBtn}>◀</button>
      <span style={{ minWidth: 88, textAlign: 'center', fontSize: 15, fontWeight: 700, color: TEXT }}>{year}년</span>
      <button onClick={() => onChange(year + 1)} aria-label="다음 해" style={navBtn}>▶</button>
    </div>
  )
}

type Props = {
  /** 지금 기간 — 모드·연도·지정 날짜의 처음 값 */
  period: Period
  onPick: (period: Period) => void
  onClose: () => void
}

export default function PeriodPickerModal({ period, onPick, onClose }: Props) {
  const now = nowKSTParts()
  const initialRange = periodRange(period)
  const [mode, setMode] = useState<PeriodMode>(period.mode)
  const [year, setYear] = useState(period.mode === 'custom' ? Number(initialRange.to.slice(0, 4)) : period.year)
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const [error, setError] = useState<string | null>(null)

  const panelRef = useRef<HTMLDivElement>(null)
  useOutsideClick(panelRef, onClose)

  /** 시작 달이 이번 달 뒤면 흐리게. */
  const futureFrom = (y: number, m: number) => y * 12 + m > now.y * 12 + now.m
  const years = Array.from({ length: RECENT_YEARS }, (_, i) => now.y - i)

  const applyCustom = () => {
    if (!isValidYmd(from) || !isValidYmd(to)) { setError('시작일과 종료일을 모두 입력해주세요.'); return }
    if (from > to) { setError('시작일이 종료일보다 늦습니다.'); return }
    if (daysBetween(from, to) + 1 > MAX_PERIOD_DAYS) { setError(`기간은 ${MAX_PERIOD_DAYS}일 이내로 골라주세요.`); return }
    onPick({ mode: 'custom', from, to })
  }

  const renderBody = () => {
    switch (mode) {
      case 'month':
        return (
          <>
            <YearStepper year={year} onChange={setYear} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
              {MONTHS.map(m => {
                const selected = period.mode === 'month' && period.year === year && period.month === m
                return (
                  <button key={m} className="sr-pcell" data-selected={selected ? '1' : '0'}
                    onClick={() => onPick({ mode: 'month', year, month: m })}
                    style={cell(selected, futureFrom(year, m))}>
                    {m}월
                  </button>
                )
              })}
            </div>
          </>
        )
      case 'quarter':
        return (
          <>
            <YearStepper year={year} onChange={setYear} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
              {QUARTERS.map(q => {
                const selected = period.mode === 'quarter' && period.year === year && period.quarter === q.value
                return (
                  <button key={q.value} className="sr-pcell" data-selected={selected ? '1' : '0'}
                    onClick={() => onPick({ mode: 'quarter', year, quarter: q.value })}
                    style={cell(selected, futureFrom(year, q.value * 3 - 2))}>
                    {q.label}
                    <span style={cellSub(selected)}>{q.sub}</span>
                  </button>
                )
              })}
            </div>
          </>
        )
      case 'half':
        return (
          <>
            <YearStepper year={year} onChange={setYear} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
              {HALVES.map(h => {
                const selected = period.mode === 'half' && period.year === year && period.half === h.value
                return (
                  <button key={h.value} className="sr-pcell" data-selected={selected ? '1' : '0'}
                    onClick={() => onPick({ mode: 'half', year, half: h.value })}
                    style={cell(selected, futureFrom(year, h.value * 6 - 5))}>
                    {h.label}
                    <span style={cellSub(selected)}>{h.sub}</span>
                  </button>
                )
              })}
            </div>
          </>
        )
      case 'year':
        return (
          <div style={{ display: 'grid', gap: 6 }}>
            {years.map(y => {
              const selected = period.mode === 'year' && period.year === y
              return (
                <button key={y} className="sr-pcell" data-selected={selected ? '1' : '0'}
                  onClick={() => onPick({ mode: 'year', year: y })}
                  style={cell(selected, false)}>
                  {y}년
                </button>
              )
            })}
          </div>
        )
      case 'custom':
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="date" value={from} max={to || undefined} aria-label="시작일"
                onChange={e => { setFrom(e.target.value); setError(null) }}
                style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
              <span style={{ fontSize: 13, color: MUTED, flexShrink: 0 }}>~</span>
              <input type="date" value={to} min={from || undefined} aria-label="종료일"
                onChange={e => { setTo(e.target.value); setError(null) }}
                style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: MUTED }}>
              최대 {MAX_PERIOD_DAYS}일. 진행 중인 기간은 오늘까지만 집계합니다.
            </div>
            {error && <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: DANGER }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={applyCustom} style={btnPrimary()}>적용</button>
            </div>
          </>
        )
    }
  }

  return (
    <ModalOverlay onClose={onClose} style={{ padding: 12 }}>
      <div ref={panelRef} onClick={e => e.stopPropagation()} role="dialog" aria-label="기간 선택" style={{
        width: 'calc(100vw - 24px)', maxWidth: 380, maxHeight: 'calc(100dvh - 32px)',
        background: CARD_BG, borderRadius: 8, boxSizing: 'border-box',
        boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: `1px solid ${BORDER}`,
        animation: 'modal-in 0.18s ease', display: 'flex', flexDirection: 'column',
      }}>
        <style>{`
          @keyframes modal-in {
            from { opacity: 0; transform: scale(0.97) translateY(8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
          ${CELL_CSS}
        `}</style>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', flexShrink: 0, borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, letterSpacing: '-0.3px' }}>기간 선택</div>
          <button onClick={onClose} title="닫기"
            onMouseEnter={e => (e.currentTarget.style.color = TEXT)}
            onMouseLeave={e => (e.currentTarget.style.color = SUB)}
            style={{ width: 30, height: 30, borderRadius: '50%', background: NEUTRAL_BG, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUB, transition: 'color 0.15s ease', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 20px' }}>
          <div style={{ marginBottom: 16 }}>
            <SegmentedControl
              equal
              value={mode}
              options={PERIOD_MODES}
              onChange={v => { setMode(v as PeriodMode); setError(null) }}
            />
          </div>
          {renderBody()}
        </div>
      </div>
    </ModalOverlay>
  )
}
