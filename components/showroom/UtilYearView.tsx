'use client'

// 가동률 연간 보기.
//   (6) 히트맵 — 행 장비, 열 1~12월, 오른쪽 끝 연간 평균, 맨 아래 월별 평균
//       칸 색은 구간 색을 투명도로 진하게/옅게(새 색 없음). 기록 없는 달은 회색 빈칸,
//       아직 오지 않은 달은 아예 비운다. 칸을 누르면 그 달 월간 보기로 간다.
//   (7) 월별 추이 — 총 실사용시간 / 고객 데모 건수. 단위가 달라 한 축에 겹치지 않고
//       두 개의 작은 막대그래프로 나눴다. 각 막대 아래에 값을 적어 hover 없이도 읽힌다.
// 사무실 선택은 서버가 반영해 준다 — 여기 오는 행·추이는 이미 그 사무실 기준이다.

import { useState } from 'react'
import { UTIL_BAND_COLORS, UTIL_BAND_LABEL, utilBand, type UtilBand, type YearlyStats } from '@/lib/showroom'
import {
  BLUE, BORDER, TEXT, MUTED, SUB, NEUTRAL_BG,
  cardStyle, cardHeader, cardTitle, countBadge,
} from '@/components/common/ui'
import { fmtPct, fmtNum } from './utilParts'

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const CELL_H = 34
const PLOT_H = 96
const BAR_MAX_W = 24

const alphaHex = (a: number) => Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, '0')
/**
 * 칸 배경 = 구간 색(dot) + 투명도. 가동률이 높을수록 진하다(0.14~0.50).
 * 위한계를 0.50 으로 둔 것은 칸 숫자(구간 글자색)가 늘 읽히게 하려는 것이다.
 */
const cellBg = (rate: number, band: UtilBand) => `${UTIL_BAND_COLORS[band].dot}${alphaHex(0.14 + 0.36 * Math.min(rate, 1))}`

type Hover = { label: string; month: number | null; rate: number | null } | null

function TrendChart({ title, unit, values, future, color, selectedMonth, digits, onPick }: {
  title: string
  unit: string
  values: number[]
  future: boolean[]
  color: string
  selectedMonth: number | null
  digits: number
  onPick: (m: number) => void
}) {
  const max = Math.max(0, ...values.filter((_, i) => !future[i]))
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 10 }}>
        {title} <span style={{ fontSize: 11, fontWeight: 500, color: MUTED }}>({unit})</span>
      </div>
      {/* 막대 — 한 기준선에서 자라고, 끝만 4px 둥글다 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 2, height: PLOT_H, alignItems: 'end', borderBottom: `1px solid ${BORDER}` }}>
        {MONTHS.map((m, i) => {
          const h = future[i] || max === 0 ? 0 : (values[i] / max) * PLOT_H
          return (
            <button key={m} type="button" onClick={() => onPick(m)} disabled={future[i]}
              aria-label={`${m}월 ${future[i] ? '아직 오지 않은 달' : `${fmtNum(values[i], digits)}${unit}`} — 월간 보기`}
              style={{ height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'none', border: 'none', padding: 0, cursor: future[i] ? 'default' : 'pointer' }}>
              {h > 0 && (
                <span style={{ width: `min(${BAR_MAX_W}px, 70%)`, height: Math.max(h, 2), background: color, borderRadius: '4px 4px 0 0', opacity: m === selectedMonth ? 1 : 0.75 }} />
              )}
            </button>
          )
        })}
      </div>
      {/* 월 · 값 — 표 역할(모든 값이 hover 없이 읽힌다) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 2, marginTop: 6 }}>
        {MONTHS.map((m, i) => (
          <div key={m} style={{ textAlign: 'center', minWidth: 0 }}>
            <div style={{ fontSize: 11, color: m === selectedMonth ? TEXT : MUTED, fontWeight: m === selectedMonth ? 700 : 400 }}>{m}월</div>
            <div className="num" style={{ fontSize: 11, color: future[i] ? MUTED : SUB, marginTop: 2 }}>
              {future[i] ? '' : fmtNum(values[i], digits)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function UtilYearView({ yearly, selectedMonth, onPickMonth }: {
  yearly: YearlyStats
  /** 강조할 달(올해면 이번 달). null 이면 강조하지 않는다 */
  selectedMonth: number | null
  onPickMonth: (m: number) => void
}) {
  const [hover, setHover] = useState<Hover>(null)
  const { year, heatmap, trend } = yearly
  const future = trend.map(t => t.future)
  const cols = `minmax(150px, 1.6fr) repeat(12, minmax(44px, 1fr)) minmax(58px, 1fr)`

  /** 한 칸. 부품 컴포넌트가 아니라 그리는 함수다(렌더 중에 컴포넌트를 새로 만들지 않기 위해). */
  const renderCell = (key: string, rate: number | null, isFuture: boolean, label: string, month: number | null, strong = false) => {
    const base = {
      height: CELL_H, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: strong ? 800 : 700,
    } as const
    if (isFuture) return <div key={key} style={{ height: CELL_H }} />
    const hoverOn = () => setHover({ label, month, rate })
    const hoverOff = () => setHover(null)
    if (rate == null) {
      return (
        <div key={key} style={{ ...base, background: NEUTRAL_BG }} aria-label={`${label} ${month ? `${month}월` : '연간'} 기록 없음`}
          onMouseEnter={hoverOn} onMouseLeave={hoverOff} />
      )
    }
    const band = utilBand(rate) ?? 'low'
    const style = { ...base, background: cellBg(rate, band), color: UTIL_BAND_COLORS[band].text }
    if (month == null) {
      return <div key={key} style={style} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>{fmtPct(rate, 0)}</div>
    }
    return (
      <button key={key} type="button" onClick={() => onPickMonth(month)}
        onMouseEnter={hoverOn} onMouseLeave={hoverOff} onFocus={hoverOn} onBlur={hoverOff}
        aria-label={`${label} ${month}월 ${fmtPct(rate)} ${UTIL_BAND_LABEL[band]} — 월간 보기`}
        style={{ ...style, border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
        {fmtPct(rate, 0)}
      </button>
    )
  }

  const headerCell = (key: string, text: string, active = false) => (
    <div key={key} style={{ fontSize: 11, textAlign: 'center', color: active ? TEXT : MUTED, fontWeight: active ? 700 : 500, paddingBottom: 4 }}>{text}</div>
  )

  const hoverBand = hover && hover.rate != null ? utilBand(hover.rate) : null

  return (
    <>
      {/* (6) 히트맵 */}
      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <div style={cardHeader}>
          <span style={cardTitle}>{year}년 장비별 가동률</span>
          <span style={countBadge}>{heatmap.rows.length}대</span>
          <div style={{ flex: 1 }} />
          {/* 범례 — 색만으로 읽지 않도록 이름과 범위를 함께 적는다 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {(['low', 'normal', 'high'] as UtilBand[]).map(b => (
              <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: SUB }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: UTIL_BAND_COLORS[b].dot }} />
                {UTIL_BAND_LABEL[b]} {b === 'low' ? '<30%' : b === 'high' ? '>80%' : '30~80%'}
              </span>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: SUB }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: NEUTRAL_BG, border: `1px solid ${BORDER}` }} />
              기록 없음
            </span>
          </div>
        </div>

        {heatmap.rows.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: SUB }}>가동률을 계산할 장비가 없습니다</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 820 }}>
              <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 2 }}>
                {headerCell('h-name', '')}
                {MONTHS.map(m => headerCell(`h-${m}`, `${m}월`, m === selectedMonth))}
                {headerCell('h-annual', '연간', true)}
              </div>
              {heatmap.rows.map(r => (
                <div key={r.device_id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 2, marginTop: 2 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0, paddingRight: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                    <span style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.site_name}</span>
                  </div>
                  {MONTHS.map((m, i) => renderCell(`${r.device_id}-${m}`, r.months[i], future[i], r.name, m))}
                  {renderCell(`${r.device_id}-annual`, r.annual, false, r.name, null, true)}
                </div>
              ))}
              {/* 월별 평균 */}
              <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 2, marginTop: 6, paddingTop: 6, borderTop: `1px solid ${BORDER}` }}>
                <div style={{ display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 700, color: TEXT }}>월 평균</div>
                {MONTHS.map((m, i) => renderCell(`avg-${m}`, heatmap.monthlyAvg[i], future[i], '월 평균', m, true))}
                {renderCell('avg-annual', heatmap.annualAvg, false, '연간 평균', null, true)}
              </div>
            </div>
          </div>
        )}

        {/* hover 읽기 줄 — 칸 숫자는 반올림(%)이라 소수 첫째 자리까지 여기서 보여준다 */}
        <div style={{ marginTop: 10, minHeight: 18, fontSize: 12, color: hover ? TEXT : MUTED }}>
          {hover
            ? <>{hover.label} · {hover.month ? `${hover.month}월` : '연간'} · {hover.rate == null ? '기록 없음' : `${fmtPct(hover.rate)} (${hoverBand ? UTIL_BAND_LABEL[hoverBand] : ''})`}</>
            : '칸을 누르면 그 달의 월간 보기로 이동합니다. 평균은 가중 평균(Σ실사용 ÷ Σ분모)입니다.'}
        </div>
      </div>

      {/* (7) 월별 추이 */}
      <div style={cardStyle}>
        <div style={cardHeader}>
          <span style={cardTitle}>{year}년 월별 추이</span>
        </div>
        <div className="sr-two">
          <TrendChart title="총 실사용시간" unit="h" digits={1} color={BLUE}
            values={trend.map(t => t.hours)} future={future} selectedMonth={selectedMonth} onPick={onPickMonth} />
          <TrendChart title="고객 데모 건수" unit="건" digits={0} color={BLUE}
            values={trend.map(t => t.demoCount)} future={future} selectedMonth={selectedMonth} onPick={onPickMonth} />
        </div>
      </div>
    </>
  )
}
