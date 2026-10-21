'use client'

// 월별 요약 표 — 행이 회계연도 열두 달, 열이 상태다. 맨 아래가 합계.
//
// 달을 누르면 아래 줄 목록이 그 달만 보여 준다(다시 누르면 해제). 그래서 행 전체가 버튼처럼
// 동작하고, 고른 달은 왼쪽에 액센트 선을 둔다 — 색으로만 구분하지 않는다.

import { BUCKET_KEYS, type Bucket } from '@/lib/forecast'

const BLUE = '#234ea2'
const TEXT = '#111827'
const MUTED = '#9ca3af'
const FADE = '#d1d5db'
const BORDER = '#ebebeb'

export type MonthSummary = { month: string; bucket: Bucket }

export type ForecastMonthTableProps = {
  months: MonthSummary[]
  /** 고른 달('YYYY-MM'). null 이면 전부 본다. */
  picked: string | null
  onPick: (month: string | null) => void
}

const won = (n: number) => n.toLocaleString('ko-KR')

/** 금액 칸 — 0 은 흐리게(읽을 것이 없다는 뜻을 색으로 준다). */
const Amount = ({ v, bold }: { v: number; bold?: boolean }) => (
  <td style={{
    padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap',
    fontSize: 13, fontWeight: bold ? 700 : 500, color: v === 0 ? FADE : TEXT,
  }} className="num">
    {won(v)}
  </td>
)

export default function ForecastMonthTable({ months, picked, onPick }: ForecastMonthTableProps) {
  const total = months.reduce((acc, m) => {
    for (const k of BUCKET_KEYS) acc[k] += m.bucket[k]
    return acc
  }, { 목표: 0, 포캐스트: 0, 지연: 0, 수주확정: 0, 실주: 0, 구매취소: 0 } as Bucket)

  /** 수주확정 ÷ 목표. 목표가 없으면 칸을 비운다(0 으로 나누지 않는다). */
  const rate = (b: Bucket) => (b.목표 > 0 ? Math.round((b.수주확정 / b.목표) * 100) : null)

  const th: React.CSSProperties = {
    padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap',
    fontSize: 11, fontWeight: 700, color: MUTED, borderBottom: `1px solid ${BORDER}`,
  }

  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>월</th>
              {BUCKET_KEYS.map(k => <th key={k} style={th}>{k}</th>)}
              <th style={th}>수주확정/목표</th>
            </tr>
          </thead>
          <tbody>
            {months.map(({ month, bucket }) => {
              const on = picked === month
              const pct = rate(bucket)
              return (
                <tr
                  key={month}
                  onClick={() => onPick(on ? null : month)}
                  style={{
                    cursor: 'pointer', borderBottom: `1px solid ${BORDER}`,
                    background: on ? '#f3f4f6' : 'transparent',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = '#fafafa' }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}
                >
                  <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', fontSize: 13, fontWeight: on ? 700 : 600, color: TEXT, borderLeft: `2px solid ${on ? BLUE : 'transparent'}` }}>
                    {month}
                  </td>
                  {BUCKET_KEYS.map(k => <Amount key={k} v={bucket[k]} />)}
                  <td style={{ padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700, color: pct === null ? FADE : (pct >= 100 ? '#16a34a' : MUTED) }}>
                    {pct === null ? '-' : `${pct}%`}
                  </td>
                </tr>
              )
            })}
            <tr style={{ background: '#fafafa' }}>
              <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 700, color: TEXT }}>합계</td>
              {BUCKET_KEYS.map(k => <Amount key={k} v={total[k]} bold />)}
              <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: rate(total) === null ? FADE : TEXT }}>
                {rate(total) === null ? '-' : `${rate(total)}%`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
