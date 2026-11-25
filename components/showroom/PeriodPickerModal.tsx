'use client'

// 기간 선택 모달 — 가동률 헤더의 기간 표시를 누르면 열린다.
//   모드: 월 / 분기 / 반기 / 연 / 지정
//   월·분기·반기는 연도를 옮기며 단위를 고르고, 연은 최근 5년 중에서, 지정은 시작일·종료일을 직접 넣는다.
//   단위를 누르면 바로 적용하고 닫힌다. 지정만 [적용] 을 눌러야 한다(날짜 두 개를 다 넣어야 해서).
// 바깥 클릭·ESC 는 공용 오버레이(ModalOverlay)가 닫는다 — 적던 값이 있으면 확인을 지난다.
// 아직 오지 않은 달·분기도 고를 수 있다(흐리게 보인다) — 고르면 '아직 오지 않은 기간' 안내가 나온다.

import { useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import SegmentedControl from '@/components/common/SegmentedControl'
import { nowKSTParts, daysBetween } from '@/lib/date'
import {
  PERIOD_MODES, MAX_PERIOD_DAYS, periodRange, isValidYmd, type Period, type PeriodMode,
} from '@/lib/showroom'
import {
  BLUE, BORDER, CARD_BG, TEXT, MUTED, SUB, DANGER, ROW_HOVER_BG, btnPrimary, inputStyle,
} from '@/components/common/ui'
import { R } from '@/lib/radius'

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
  height: 44, borderRadius: R.icon, fontFamily: 'inherit', cursor: 'pointer',
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
  width: 30, height: 30, border: `1px solid ${BORDER}`, borderRadius: R.icon, background: CARD_BG,
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

  // 바깥 클릭·Esc 는 **오버레이 하나**가 맡는다(2026-11-26, 지시 P).
  // 전에는 useOutsideClick 이 따로 걸려 있어, 바깥을 누르면 confirmClose 를 **건너뛰고**
  // 바로 닫혔다(적던 기간이 그대로 사라졌다). 그 자리를 공용 오버레이로 모았다.

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
    // 고르던 기간이 날아가지 않게 확인 뒤 닫는다.
    <ModalOverlay onClose={onClose} confirmClose style={{ padding: '6vh 12px' }}>
      {/* 공용 카드로 옮겼다(2026-11-26, 지시 P) — 열림 모션 150ms(이 파일에만 있던
          @keyframes modal-in 0.18s 를 대신한다) · Esc·바깥 클릭·✕ 가 한 함수를 지난다
          (confirmClose 는 그대로). 겉모양은 그대로다: 폭 380 · 머리줄 선과 여백 ·
          제목 18/700. 칸 CSS(CELL_CSS)는 본문 맨 위에 그대로 둔다. */}
      <ModalCard
        width={380}
        role="dialog" ariaLabel="기간 선택"
        style={{ borderRadius: R.control, maxHeight: 'calc(100dvh - 32px)', border: `1px solid ${BORDER}` }}
        headStyle={{ padding: '16px 20px', borderBottom: `1px solid ${BORDER}`, alignItems: 'center' }}
        bodyStyle={{ padding: '16px 20px 20px' }}
        title={<div style={{ fontSize: 18, fontWeight: 700, color: TEXT, letterSpacing: '-0.3px' }}>기간 선택</div>}
      >
        <>
          <style>{CELL_CSS}</style>
          <div style={{ marginBottom: 16 }}>
            <SegmentedControl
              equal
              value={mode}
              options={PERIOD_MODES}
              onChange={v => { setMode(v as PeriodMode); setError(null) }}
            />
          </div>
          {renderBody()}
        </>
      </ModalCard>
    </ModalOverlay>
  )
}
