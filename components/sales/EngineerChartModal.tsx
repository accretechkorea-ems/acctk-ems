'use client'

// 담당자 한 명의 **FY 월별 실적** 그래프 모달 — 실적 현황과 개인 대시보드가 같이 쓴다.
//
// ── 패널 두 장 ──────────────────────────────────────────────────────────────
//   위가 「수주」, 아래가 「매출」이다. 각각은 평범한 세로 막대그래프 한 장 —
//   X축은 열두 달(4월~3월), 막대는 실적, 월 목표는 **주황 가로선** 하나다.
//
//   **Y축은 두 패널이 같다.** 눈금이 다르면 위아래 막대 높이를 눈으로 비교할 수 없어,
//   수주는 났는데 매출이 안 따라온 달을 찾자는 목적이 사라진다.
//
// ── 1366×768 에서 스크롤 없이 ───────────────────────────────────────────────
//   작은 노트북이 기준이다. 그래서 높이가 고정값으로 쌓인다 —
//   머리 71 + 본문 여백 26 + 패널 220×2 + 지표 70 + 간격 10 = 617 ≤ 90vh(691).
//   패널마다 제목 줄을 두거나 범례를 본문에 두면 이 합이 넘쳐 스크롤이 생긴다.
//   그래서 패널 이름은 Y축 왼쪽 **세로 글자**, 범례는 **머리 오른쪽**,
//   월 목표 금액은 **목표선 끝**이다. 줄 하나하나가 패널 높이를 깎는다.
//
// ── 숫자는 전부 lib/salesStats.ts 가 만든다 ────────────────────────────────
//   여기서 다시 더하지 않는다(그리기만 한다) — 그래프와 아래 요약이 같은 함수를 본다.
//   수주는 발주일, 매출은 세금계산서 완료일, 월 목표는 연간 목표 ÷ 12 다.
//
//   그림은 SVG 다. 차트 라이브러리를 들이지 않는다 — 막대와 선 몇 개뿐이라
//   의존성을 하나 더 지고 갈 이유가 없다.

import { useEffect, useState } from 'react'
import { TEAM_COLORS, getCategoryColor } from '@/lib/categoryColors'
import { todayKST } from '@/lib/date'
import { monthlyBars, yearSummary, type MonthBars, type StatQuote, type StatTarget } from '@/lib/salesStats'
import { Z } from '@/lib/zIndex'

const BLUE = '#234ea2'
const GREEN = '#16a34a'
/** 목표선 — 실적 현황이 쓰던 주황 그대로다. */
const ORANGE = '#d97706'
const CARD_BG = '#ffffff'
const BORDER = '#ebebeb'
const TEXT = '#111113'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'
/** 현재 월 세로 띠 — 기존 연한 파랑(가격표 드롭존·버튼 hover 와 같은 값). */
const NOW_BAND = '#eff4ff'

const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')
const numM = (n: number) => {
  if (n === 0) return '₩0'
  if (n >= 100000000) return `₩${(n / 100000000).toFixed(1)}억`
  if (n >= 10000000) return `₩${(n / 10000000).toFixed(0)}천만`
  if (n >= 1000000) return `₩${(n / 1000000).toFixed(0)}백만`
  return `₩${Math.round(n / 10000)}만`
}
/** 목표선 끝에 붙는 금액 — 눈금 라벨과 달리 소수 한 자리까지 적는다(₩4.6백만). */
const numM1 = (n: number) => {
  if (n >= 100000000) return `₩${(n / 100000000).toFixed(1)}억`
  if (n >= 10000000) return `₩${(n / 10000000).toFixed(1)}천만`
  if (n >= 1000000) return `₩${(n / 1000000).toFixed(1)}백만`
  return `₩${Math.round(n / 10000)}만`
}
// 달성률 색 — 달성 여부만 구분(100%+ 초록 / 미만 검정).
const achieveColorOf = (v: number | null): string => v === null ? GRAY : v >= 100 ? GREEN : '#111827'

// ── 그림 치수 ───────────────────────────────────────────────────────────────
// 뷰박스로 그린다. 본문이 1180 보다 넓으면 그림은 1180 그대로 가운데 놓인다.
const W = 1180
const H = 220              // 패널 하나의 높이. 두 장 + 지표 줄이 760 안에 들어가는 값이다.
const PAD_L = 86           // 세로 제목 + 눈금 라벨 자리
const PAD_R = 58           // 목표선 끝 금액 자리
const PAD_T = 20           // 막대 위 금액 자리
const PAD_B = 30           // 달 이름 + 달성률 자리
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B
const BASE_Y = PAD_T + PLOT_H     // 막대가 서는 바닥
const SLOT = PLOT_W / 12
const BAR_W = Math.min(40, SLOT * 0.52)

/** 눈금 간격을 사람이 읽기 좋은 수로 — 1·2·2.5·5·10 × 10ⁿ. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * exp
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

/** 패널 한 장 — 세로 제목 + 막대 열둘 + 목표선. Y축은 밖에서 받은 값을 그대로 쓴다. */
function ChartPanel({ title, bars, color, valueOf, targetOf, achieveOf, axisMax, nowYear, nowMonth }: {
  title: string
  bars: MonthBars[]
  color: string
  valueOf: (b: MonthBars) => number
  targetOf: (b: MonthBars) => number
  achieveOf: (b: MonthBars) => number | null
  axisMax: number
  nowYear: number
  nowMonth: number
}) {
  const y = (v: number) => PAD_T + PLOT_H * (1 - v / axisMax)
  const step = niceStep(axisMax / 4)
  const ticks: number[] = []
  for (let v = 0; v <= axisMax + 1; v += step) ticks.push(v)
  // 월 목표는 열두 달이 모두 같은 값(연간 ÷ 12)이므로 첫 달에서 한 번 읽는다.
  const target = bars.length > 0 ? targetOf(bars[0]) : 0
  // 현재 월 띠는 **맨 위 눈금선까지**다. 축 최대값(1.15배)까지 올리면 눈금 바깥으로
  // 머리를 내밀어 그래프 영역을 넘어선 것처럼 보인다.
  const bandTop = y(ticks[ticks.length - 1] ?? 0)

  return (
    <svg
      width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}
      role="img" aria-label={`${title} 월별 막대그래프`}
    >
      {/* 패널 이름 — Y축 바깥, 세로로. 제목 줄 하나를 아끼려고 이 자리로 왔다. */}
      <text
        x={15} y={PAD_T + PLOT_H / 2} transform={`rotate(-90 15 ${PAD_T + PLOT_H / 2})`}
        textAnchor="middle" fontSize={14} fontWeight={800} fill={TEXT} letterSpacing="-0.3"
      >{title}</text>

      {/* 눈금선 — 가장 연한 선으로 깔고 왼쪽에 값을 적는다. */}
      {ticks.map(v => (
        <g key={v}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#d1d5db' : BORDER} strokeWidth={1} />
          <text x={PAD_L - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill={MUTED}>{numM(v)}</text>
        </g>
      ))}

      {bars.map((b, i) => {
        const isNow = b.year === nowYear && b.month === nowMonth
        const v = valueOf(b)
        // **0 인 달은 아무것도 그리지 않는다** — 막대도, 금액도, 달성률도. 높이 0 짜리
        // 막대를 그리면 바닥에 짧은 선 조각으로 남아 실적이 있는 것처럼 보였다.
        const has = v > 0
        const cx = PAD_L + SLOT * i + SLOT / 2
        // 아주 작은 값도 「선」이 아니라 막대로 읽히게 최소 높이를 준다.
        const barH = has ? Math.max(3, PLOT_H * (v / axisMax)) : 0
        const ach = achieveOf(b)
        return (
          <g key={`${b.year}-${b.month}`}>
            {/* 현재 월 — 막대 뒤 연한 세로 띠 하나. */}
            {isNow && <rect x={cx - SLOT / 2 + 2} y={bandTop} width={SLOT - 4} height={BASE_Y - bandTop} fill={NOW_BAND} rx={4} />}
            {has && (
              <>
                <BarAnimate x={cx - BAR_W / 2} height={barH} width={BAR_W} color={color} />
                <text x={cx} y={BASE_Y - barH - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill={color}>{numM(v)}</text>
              </>
            )}
            <text x={cx} y={BASE_Y + 15} textAnchor="middle" fontSize={12} fontWeight={700} fill={isNow ? BLUE : TEXT}>
              {b.label}{isNow ? ' ◀' : ''}
            </text>
            {has && ach !== null && (
              <text x={cx} y={BASE_Y + 27} textAnchor="middle" fontSize={10} fontWeight={700} fill={achieveColorOf(ach)}>
                {ach.toFixed(0)}%
              </text>
            )}
          </g>
        )
      })}

      {/* 월 목표 — 주황 가로선 하나 + 선 끝에 금액. 목표가 없으면 긋지 않는다. */}
      {target > 0 && target <= axisMax && (
        <>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(target)} y2={y(target)} stroke={ORANGE} strokeWidth={2} strokeDasharray="6 4" />
          <text x={W - PAD_R + 6} y={y(target) + 4} fontSize={10} fontWeight={700} fill={ORANGE}>{numM1(target)}</text>
        </>
      )}
    </svg>
  )
}

/** 범례 한 조각 — 막대는 네모, 목표는 선. */
function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      {line
        ? <div style={{ width: 16, height: 2, background: color, borderRadius: 1 }} />
        : <div style={{ width: 11, height: 11, borderRadius: 2, background: color }} />}
      {label}
    </div>
  )
}

export type ChartEngineer = { engineer_id: number; name: string | null; position: string | null; teams: string | null }

export default function EngineerChartModal({ engineer, quotes, targets, fy, onClose }: {
  engineer: ChartEngineer
  quotes: StatQuote[]
  targets: StatTarget[]
  fy: number
  onClose: () => void
}) {
  const today = todayKST()
  const nowYear = Number(today.slice(0, 4))
  const nowMonth = Number(today.slice(5, 7))

  const bars = monthlyBars(quotes, targets, { engineerId: engineer.engineer_id, fy })
  const sum = yearSummary(quotes, targets, { engineerId: engineer.engineer_id, fy, today })

  // Y축은 두 패널 공통 — 모든 달의 수주·매출과 두 목표를 통틀어 가장 큰 값의 1.15배.
  // 막대 위 금액이 패널 위로 잘리지 않을 만큼의 여유다.
  const rawMax = Math.max(
    1, ...bars.map(b => Math.max(b.orderedAmt, b.revenueAmt, b.orderTarget, b.salesTarget)),
  )
  const axisMax = rawMax * 1.15
  const tc = getCategoryColor(TEAM_COLORS, engineer.teams)

  /** 아래 보조 지표 한 칸 — 높이 70px 로 눌러 담는다(스크롤을 만들지 않으려고). */
  const box = (label: string, value: string, sub?: string, color?: string) => (
    <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px', border: `1px solid ${BORDER}`, minWidth: 0, height: 70, boxSizing: 'border-box', overflow: 'hidden' }}>
      <div style={{ fontSize: 10, color: GRAY, marginBottom: 3 }}>{label}</div>
      <div className="num" style={{ fontSize: 13, fontWeight: 800, color: color || TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div className="num" style={{ fontSize: 10, color: MUTED, fontWeight: 600, marginTop: 3, lineHeight: '13px' }}>{sub}</div>}
    </div>
  )
  /** 월평균 필요액 — 이미 넘겼으면 「달성」, 목표가 없거나 남은 달이 없으면 「-」. */
  const needText = (v: number | 'done' | null) => (v === 'done' ? '달성' : v === null ? '-' : `₩${numKR(v)}`)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{
        background: CARD_BG, borderRadius: 18,
        // 1366×768 노트북에서 스크롤이 생기지 않는 높이다(90vh = 691 > 쌓인 617).
        width: 'min(1400px, 94vw)', height: 'min(760px, 90vh)',
        display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>{engineer.name}</span>
              <span style={{ fontSize: 12, color: GRAY }}>{engineer.position}</span>
              {engineer.teams && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: tc.bg, color: tc.text, fontWeight: 700 }}>{engineer.teams}</span>}
            </div>
            {/* 머리에는 **연간** 목표만 적는다. 월 목표는 목표선 끝에 붙어 있다. */}
            <div className="num" style={{ fontSize: 12, color: GRAY, whiteSpace: 'nowrap' }}>
              FY{fy} 월별 실적 · 연간 목표 수주 {sum.orderTarget > 0 ? `₩${numKR(sum.orderTarget)}` : '미설정'}
              <span style={{ color: MUTED }}> · </span>
              매출 {sum.salesTarget > 0 ? `₩${numKR(sum.salesTarget)}` : '미설정'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
            {/* 범례 — 본문에 두면 그만큼 패널이 낮아진다. 여기는 늘 보이는 자리다. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: GRAY }}>
              <Legend color={BLUE} label="수주액" />
              <Legend color={GREEN} label="매출액" />
              <Legend color={ORANGE} label="월 목표" line />
            </div>
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>✕</button>
          </div>
        </div>

        <div style={{ padding: '12px 20px 14px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <ChartPanel
            title="수주" bars={bars} color={BLUE} axisMax={axisMax}
            valueOf={b => b.orderedAmt} targetOf={b => b.orderTarget} achieveOf={b => b.orderAchieve}
            nowYear={nowYear} nowMonth={nowMonth}
          />
          <ChartPanel
            title="매출" bars={bars} color={GREEN} axisMax={axisMax}
            valueOf={b => b.revenueAmt} targetOf={b => b.salesTarget} achieveOf={b => b.salesAchieve}
            nowYear={nowYear} nowMonth={nowMonth}
          />

          {/* 보조 지표 다섯 — 「지금 어디쯤인가」와 「앞으로 얼마씩 해야 하는가」. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10, marginTop: 10 }}>
            {box('연간 누적 수주', `₩${numKR(sum.orderedAmt)}`,
              sum.orderAchieve === null ? '목표 미설정' : `달성률 ${sum.orderAchieve.toFixed(0)}% · 목표 ₩${numKR(sum.orderTarget)}`,
              BLUE)}
            {box('연간 누적 매출', `₩${numKR(sum.revenueAmt)}`,
              sum.salesAchieve === null ? '목표 미설정' : `달성률 ${sum.salesAchieve.toFixed(0)}% · 목표 ₩${numKR(sum.salesTarget)}`,
              GREEN)}
            {box('누적 순이익', sum.profitAmt > 0 ? `₩${numKR(sum.profitAmt)}` : '-',
              sum.profitRate === null ? '매출 없음' : `이익률 ${sum.profitRate.toFixed(1)}%`,
              GREEN)}
            {box('월평균 필요액',
              `수주 ${needText(sum.needOrder)}`,
              `매출 ${needText(sum.needSales)} · 남은 ${sum.remaining}개월`)}
            {box('견적중 잔량', `₩${numKR(sum.pendingAmt)}`, `${sum.pendingCnt}건`)}
          </div>
        </div>
      </div>
    </div>
  )
}
