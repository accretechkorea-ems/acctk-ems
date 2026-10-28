'use client'

// 실적 그래프의 **공용 조각** — 개인 그래프 모달과 사업부 전체 그래프가 같은 코드를 쓴다.
//
// 왜 공용인가 — 두 그래프가 같은 숫자를 다르게 그리고 있었다. 개인 쪽은 수주·매출을 패널
// 두 장으로 나눠 월 목표선을 긋고, 사업부 쪽은 매출 하나만 회색 막대로 묶어 그렸다.
// 같은 화면에서 위아래로 보는 두 그림의 규칙이 다르면, 보는 사람이 매번 「이 색이 저기서는
// 무슨 뜻이었나」를 다시 맞춰야 한다. 그래서 그리는 쪽을 한곳으로 모았다(2026-10-28).
//
// ── 패널 두 장 ──────────────────────────────────────────────────────────────
//   위가 「수주」, 아래가 「매출」이다. 각각 평범한 세로 막대그래프 한 장 — 가로축은 칸
//   (달·분기·연도), 막대는 실적, 목표는 **주황 가로선** 하나다.
//
//   **Y축은 두 패널이 같다.** 눈금이 다르면 위아래 막대 높이를 눈으로 비교할 수 없어,
//   수주는 났는데 매출이 안 따라온 칸을 찾자는 목적이 사라진다. 그래서 축 최대값은
//   부르는 쪽이 한 번 구해 두 패널에 같이 넘긴다(axisMaxOf).
//
// ── 줄 하나하나가 패널 높이를 깎는다 ───────────────────────────────────────
//   1366×768 노트북에서 스크롤 없이 두 패널 + 지표 줄이 들어가야 한다. 그래서 패널 이름은
//   제목 줄을 따로 두지 않고 Y축 **왼쪽 여백**(비어 있던 자리)에 가로로 적고, 그 아래
//   목표 금액을 적는다 — 목표선 끝에 또 적으면 같은 수가 둘이다.
//
//   그림은 SVG 다. 차트 라이브러리를 들이지 않는다 — 막대와 선 몇 개뿐이라 의존성을
//   하나 더 지고 갈 이유가 없다.
//
// 숫자는 전부 lib/salesStats.ts 가 만든다(여기서 다시 더하지 않는다).

import { useEffect, useState } from 'react'
import type { UnitBar, YearSummary } from '@/lib/salesStats'

export const CHART_BLUE = '#234ea2'
export const CHART_GREEN = '#16a34a'
/** 목표선 — 실적 현황이 쓰던 주황 그대로다. */
export const CHART_ORANGE = '#d97706'
const BORDER = '#ebebeb'
const TEXT = '#111113'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'
/** 현재 칸 세로 띠 — 기존 연한 파랑(가격표 드롭존·버튼 hover 와 같은 값). */
const NOW_BAND = '#eff4ff'

export const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')
export const numM = (n: number) => {
  if (n === 0) return '₩0'
  if (n >= 100000000) return `₩${(n / 100000000).toFixed(1)}억`
  if (n >= 10000000) return `₩${(n / 10000000).toFixed(0)}천만`
  if (n >= 1000000) return `₩${(n / 1000000).toFixed(0)}백만`
  return `₩${Math.round(n / 10000)}만`
}

/**
 * 달성률 색 — **달성 여부만** 구분한다(100%+ 초록 / 미만 검정 / 목표 없음 회색).
 * 빨강은 쓰지 않는다: 미달이 잘못이 아니고, 빨강이 섞이면 화면이 경고판처럼 보인다.
 */
export const achieveColorOf = (v: number | null): string =>
  v === null ? GRAY : v >= 100 ? CHART_GREEN : '#111827'

// ── 그림 치수 ───────────────────────────────────────────────────────────────
// 뷰박스로 그린다. 본문이 1180 보다 넓으면 그림은 1180 그대로 가운데 놓인다.
const W = 1180
const H = 220              // 패널 하나의 높이. 두 장 + 지표 줄이 760 안에 들어가는 값이다.
const PAD_L = 150          // 가로 제목(수주/매출 + 목표) + 눈금 라벨 자리
const PAD_R = 14
const PAD_T = 20           // 막대 위 금액 자리
const PAD_B = 34           // 칸 이름(+ 둘째 줄) + 달성률 자리
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B
const BASE_Y = PAD_T + PLOT_H     // 막대가 서는 바닥

/** 눈금 간격을 사람이 읽기 좋은 수로 — 1·2·2.5·5·10 × 10ⁿ. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * exp
}

/**
 * 두 패널이 함께 쓸 Y축 최대값 — 모든 칸의 수주·매출과 두 목표를 통틀어 가장 큰 값의 1.15배.
 * 막대 위 금액이 패널 위로 잘리지 않을 만큼의 여유다.
 */
export function axisMaxOf(bars: readonly UnitBar[]): number {
  const raw = Math.max(
    1, ...bars.map(b => Math.max(b.orderedAmt, b.revenueAmt, b.orderTarget, b.salesTarget)),
  )
  return raw * 1.15
}

/**
 * 막대 하나 — 바닥에서 자라 오른다(종전 BarAnimate 와 같은 방식·같은 곡선이다).
 * div 가 아니라 SVG 사각형이라는 점만 다르다.
 */
function BarAnimate({ x, height, width, color }: {
  x: number; height: number; width: number; color: string
}) {
  const [h, setH] = useState(0)
  useEffect(() => { const t = setTimeout(() => setH(height), 100); return () => clearTimeout(t) }, [height])
  return (
    <rect
      x={x} y={BASE_Y - h} width={width} height={h} rx={3} fill={color}
      style={{ transition: 'height 0.8s cubic-bezier(0.4,0,0.2,1), y 0.8s cubic-bezier(0.4,0,0.2,1)' }}
    />
  )
}

export type ChartKind = 'order' | 'sales'

/**
 * 패널 한 장 — 가로 제목 + 막대 + 목표선. 칸 수는 bars 길이가 정한다(열두 달·네 분기·세 해).
 *
 * kind 가 그리는 값을 고른다 — 'order' 는 수주(파랑), 'sales' 는 매출(초록). 두 패널이
 * 같은 자료(UnitBar[])를 받아 제 칸만 꺼내 쓰므로, 한쪽만 다른 집계를 보는 일이 없다.
 */
export function ChartPanel({ kind, bars, axisMax, unitLabel }: {
  kind: ChartKind
  bars: readonly UnitBar[]
  axisMax: number
  /** 제목 아래 목표 줄의 머리말 — 「월 목표」·「분기 목표」·「연간 목표」. */
  unitLabel: string
}) {
  const isOrder = kind === 'order'
  const title = isOrder ? '수주' : '매출'
  const color = isOrder ? CHART_BLUE : CHART_GREEN
  const valueOf = (b: UnitBar) => (isOrder ? b.orderedAmt : b.revenueAmt)
  const targetOf = (b: UnitBar) => (isOrder ? b.orderTarget : b.salesTarget)
  const achieveOf = (b: UnitBar) => (isOrder ? b.orderAchieve : b.salesAchieve)

  const slot = PLOT_W / Math.max(1, bars.length)
  const barW = Math.min(40, slot * 0.52)
  const y = (v: number) => PAD_T + PLOT_H * (1 - v / axisMax)
  const step = niceStep(axisMax / 4)
  const ticks: number[] = []
  for (let v = 0; v <= axisMax + 1; v += step) ticks.push(v)

  // 목표가 칸마다 같으면(달·분기) 가로선 한 줄로 긋고 금액을 제목 아래 적는다.
  // 연도별은 해마다 목표가 달라 선을 칸별로 긋는다.
  const targets = bars.map(targetOf)
  const sameTarget = targets.length > 0 && targets.every(t => t === targets[0])
  const commonTarget = sameTarget ? targets[0] : 0

  // 현재 칸 띠는 **맨 위 눈금선까지**다. 축 최대값(1.15배)까지 올리면 눈금 바깥으로
  // 머리를 내밀어 그래프 영역을 넘어선 것처럼 보인다.
  const bandTop = y(ticks[ticks.length - 1] ?? 0)

  return (
    <svg
      width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}
      role="img" aria-label={`${title} 막대그래프`}
    >
      {/* 패널 이름 — Y축 바깥 여백, 그래프 세로 중앙. 제목 줄 하나를 아끼려고 이 자리다. */}
      <text x={2} y={PAD_T + PLOT_H / 2 - 2} fontSize={14} fontWeight={800} fill={TEXT} letterSpacing="-0.3">{title}</text>
      <text x={2} y={PAD_T + PLOT_H / 2 + 13} className="num" fontSize={10} fontWeight={600} fill={MUTED}>
        {sameTarget
          ? `${unitLabel} ${commonTarget > 0 ? `₩${numKR(commonTarget)}` : '미설정'}`
          : `${unitLabel} 칸마다 다름`}
      </text>

      {/* 눈금선 — 가장 연한 선으로 깔고 왼쪽에 값을 적는다. */}
      {ticks.map(v => (
        <g key={v}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#d1d5db' : BORDER} strokeWidth={1} />
          <text x={PAD_L - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill={MUTED}>{numM(v)}</text>
        </g>
      ))}

      {bars.map((b, i) => {
        const v = valueOf(b)
        // **0 인 칸은 아무것도 그리지 않는다** — 막대도, 금액도, 달성률도. 높이 0 짜리
        // 막대를 그리면 바닥에 짧은 선 조각으로 남아 실적이 있는 것처럼 보였다.
        const has = v > 0
        const cx = PAD_L + slot * i + slot / 2
        // 아주 작은 값도 「선」이 아니라 막대로 읽히게 최소 높이를 준다.
        const barH = has ? Math.max(3, PLOT_H * (v / axisMax)) : 0
        const ach = achieveOf(b)
        const t = targetOf(b)
        return (
          <g key={b.key}>
            {/* 현재 칸 — 막대 뒤 연한 세로 띠 하나. */}
            {b.isNow && <rect x={cx - slot / 2 + 2} y={bandTop} width={slot - 4} height={BASE_Y - bandTop} fill={NOW_BAND} rx={4} />}
            {has && (
              <>
                <BarAnimate x={cx - barW / 2} height={barH} width={barW} color={color} />
                <text x={cx} y={BASE_Y - barH - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill={color}>{numM(v)}</text>
              </>
            )}
            {/* 칸마다 목표가 다를 때(연도별) — 그 칸 폭만큼만 선을 긋는다. */}
            {!sameTarget && t > 0 && t <= axisMax && (
              <line
                x1={cx - slot / 2 + 6} x2={cx + slot / 2 - 6} y1={y(t)} y2={y(t)}
                stroke={CHART_ORANGE} strokeWidth={2} strokeDasharray="6 4"
              />
            )}
            <text x={cx} y={BASE_Y + 15} textAnchor="middle" fontSize={12} fontWeight={700} fill={b.isNow ? CHART_BLUE : TEXT}>
              {b.label}{b.isNow ? ' ◀' : ''}
            </text>
            {b.sub && (
              <text x={cx} y={BASE_Y + 26} textAnchor="middle" fontSize={10} fill={MUTED}>{b.sub}</text>
            )}
            {has && ach !== null && (
              <text x={cx} y={BASE_Y + (b.sub ? 37 : 27)} textAnchor="middle" fontSize={10} fontWeight={700} fill={achieveColorOf(ach)}>
                {ach.toFixed(0)}%
              </text>
            )}
          </g>
        )
      })}

      {/* 목표 — 주황 가로선 하나. 금액은 왼쪽 제목 아래에 있다(선 끝에 또 적지 않는다). */}
      {sameTarget && commonTarget > 0 && commonTarget <= axisMax && (
        <line x1={PAD_L} x2={W - PAD_R} y1={y(commonTarget)} y2={y(commonTarget)} stroke={CHART_ORANGE} strokeWidth={2} strokeDasharray="6 4" />
      )}
    </svg>
  )
}

/** 범례 한 조각 — 막대는 네모, 목표는 선. */
export function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      {line
        ? <div style={{ width: 16, height: 2, background: color, borderRadius: 1 }} />
        : <div style={{ width: 11, height: 11, borderRadius: 2, background: color }} />}
      {label}
    </div>
  )
}

/** 범례 세 조각 — 두 그래프가 같은 글자를 쓴다. */
export function ChartLegend() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: GRAY }}>
      <Legend color={CHART_BLUE} label="수주액" />
      <Legend color={CHART_GREEN} label="매출액" />
      <Legend color={CHART_ORANGE} label="목표" line />
    </div>
  )
}

/** 보조 지표 한 칸 — 높이 70px 로 눌러 담는다(스크롤을 만들지 않으려고). */
function Box({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px', border: `1px solid ${BORDER}`, minWidth: 0, height: 70, boxSizing: 'border-box', overflow: 'hidden' }}>
      <div style={{ fontSize: 10, color: GRAY, marginBottom: 3 }}>{label}</div>
      <div className="num" style={{ fontSize: 13, fontWeight: 800, color: color || TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div className="num" style={{ fontSize: 10, color: MUTED, fontWeight: 600, marginTop: 3, lineHeight: '13px' }}>{sub}</div>}
    </div>
  )
}

/** 월평균 필요액 — 이미 넘겼으면 「달성」, 목표가 없거나 남은 달이 없으면 「-」. */
const needText = (v: number | 'done' | null) => (v === 'done' ? '달성' : v === null ? '-' : `₩${numKR(v)}`)

/**
 * 보조 지표 다섯 — 「지금 어디쯤인가」와 「앞으로 얼마씩 해야 하는가」.
 * 개인·사업부가 **같은 다섯 칸**을 본다(집계 범위만 다르다).
 */
export function SummaryBoxes({ sum }: { sum: YearSummary }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10, marginTop: 10 }}>
      <Box label="연간 누적 수주" value={`₩${numKR(sum.orderedAmt)}`} color={CHART_BLUE}
        sub={sum.orderAchieve === null ? '목표 미설정' : `달성률 ${sum.orderAchieve.toFixed(0)}% · 목표 ₩${numKR(sum.orderTarget)}`} />
      <Box label="연간 누적 매출" value={`₩${numKR(sum.revenueAmt)}`} color={CHART_GREEN}
        sub={sum.salesAchieve === null ? '목표 미설정' : `달성률 ${sum.salesAchieve.toFixed(0)}% · 목표 ₩${numKR(sum.salesTarget)}`} />
      <Box label="누적 순이익" value={sum.profitAmt > 0 ? `₩${numKR(sum.profitAmt)}` : '-'} color={CHART_GREEN}
        sub={sum.profitRate === null ? '매출 없음' : `이익률 ${sum.profitRate.toFixed(1)}%`} />
      <Box label="월평균 필요액" value={`수주 ${needText(sum.needOrder)}`}
        sub={`매출 ${needText(sum.needSales)} · 남은 ${sum.remaining}개월`} />
      <Box label="견적중 잔량" value={`₩${numKR(sum.pendingAmt)}`} sub={`${sum.pendingCnt}건`} />
    </div>
  )
}
