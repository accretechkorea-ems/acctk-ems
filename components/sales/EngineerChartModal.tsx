'use client'

// 담당자 한 명의 **FY 월별 실적** 그래프 모달 — 실적 현황과 개인 대시보드가 같이 쓴다.
//
// ── 한 달에 막대 넷 ─────────────────────────────────────────────────────────
//   수주액(진한 파랑) · 수주목표(연한 파랑 테두리) · 매출액(진한 초록) · 매출목표(연한 초록 테두리).
//   열두 달이면 마흔여덟 개다. 수주와 매출을 한 화면에 세우는 이유는, 수주는 났는데 매출이
//   따라오지 않는 달(또는 그 반대)이 한눈에 보여야 하기 때문이다.
//
//   기간을 재는 날짜는 **카드와 같은 규칙**이다(lib/salesStats.ts) — 수주는 발주일,
//   매출은 세금계산서 완료일. 예전에는 이 그래프만 new Date() 로 달을 갈라, 브라우저
//   시간대에 따라 한국 새벽에 찍힌 건이 전달로 밀렸다.
//
// ── 숫자는 전부 lib/salesStats.ts 가 만든다 ────────────────────────────────
//   여기서 다시 더하지 않는다. 그래프와 아래 요약이 같은 함수를 보므로 둘이 어긋날 수 없다.

import { useEffect, useState } from 'react'
import { TEAM_COLORS, getCategoryColor } from '@/lib/categoryColors'
import { todayKST } from '@/lib/date'
import { monthlyBars, yearSummary, type StatQuote, type StatTarget } from '@/lib/salesStats'
import { Z } from '@/lib/zIndex'

const BLUE = '#234ea2'
/** 목표 막대의 테두리 — 기존 토큰이다(카드 hover 테두리와 같은 연한 파랑). */
const BLUE_LIGHT = '#c7d7f8'
const GREEN = '#16a34a'
/** 연한 초록 — 재고 화면이 쓰는 값과 같다. */
const GREEN_LIGHT = '#bbf7d0'
const CARD_BG = '#ffffff'
const BORDER = '#ebebeb'
const TEXT = '#111113'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'

const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')
const numM = (n: number) => {
  if (n === 0) return '₩0'
  if (n >= 100000000) return `₩${(n / 100000000).toFixed(1)}억`
  if (n >= 10000000) return `₩${(n / 10000000).toFixed(0)}천만`
  if (n >= 1000000) return `₩${(n / 1000000).toFixed(0)}백만`
  return `₩${Math.round(n / 10000)}만`
}
// 달성률 색 — 달성 여부만 구분(100%+ 초록 / 미만 검정).
const achieveColorOf = (v: number | null): string => v === null ? GRAY : v >= 100 ? GREEN : '#111827'

/** 막대가 아래에서 자라 오른다. 종전 것 그대로다. */
function BarAnimate({ height, color, width, outline }: { height: number; color: string; width: number; outline?: boolean }) {
  const [h, setH] = useState(0)
  useEffect(() => { const t = setTimeout(() => setH(height), 100); return () => clearTimeout(t) }, [height])
  return (
    <div style={{
      width, height: h, borderRadius: '3px 3px 0 0', position: 'relative', flexShrink: 0,
      background: outline ? CARD_BG : color,
      border: outline ? `1.5px solid ${color}` : 'none',
      boxSizing: 'border-box',
      transition: 'height 0.8s cubic-bezier(0.4,0,0.2,1)',
    }} />
  )
}

/** 범례 한 조각. */
function Legend({ color, label, outline }: { color: string; label: string; outline?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{
        width: 12, height: 12, borderRadius: 2, boxSizing: 'border-box',
        background: outline ? CARD_BG : color, border: outline ? `1.5px solid ${color}` : 'none',
      }} />
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
  const BAR_H = 150
  const today = todayKST()
  const nowYear = Number(today.slice(0, 4))
  const nowMonth = Number(today.slice(5, 7))

  const bars = monthlyBars(quotes, targets, { engineerId: engineer.engineer_id, fy })
  const sum = yearSummary(quotes, targets, { engineerId: engineer.engineer_id, fy, today })
  // 막대 높이의 기준 — 실적과 목표를 통틀어 가장 큰 값이다(목표만 있는 달도 눈금이 맞는다).
  const maxAmt = Math.max(
    1, ...bars.map(b => Math.max(b.orderedAmt, b.revenueAmt, b.orderTarget, b.salesTarget)),
  )
  const h = (v: number) => Math.max(0, (v / maxAmt) * BAR_H)
  const tc = getCategoryColor(TEAM_COLORS, engineer.teams)

  /** 아래 보조 지표 한 칸. */
  const box = (label: string, value: string, sub?: string, color?: string) => (
    <div key={label} style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px', border: `1px solid ${BORDER}`, minWidth: 0 }}>
      <div style={{ fontSize: 10, color: GRAY, marginBottom: 3 }}>{label}</div>
      <div className="num" style={{ fontSize: 13, fontWeight: 800, color: color || TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div className="num" style={{ fontSize: 10, color: MUTED, fontWeight: 600, marginTop: 2 }}>{sub}</div>}
    </div>
  )
  /** 월평균 필요액 — 이미 넘겼으면 「달성」, 목표가 없거나 남은 달이 없으면 「-」. */
  const needText = (v: number | 'done' | null) => (v === 'done' ? '달성' : v === null ? '-' : `₩${numKR(v)}`)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{
        background: CARD_BG, borderRadius: 18,
        // 노트북에서 거의 꽉 차게. 머리는 고정이고 본문만 넘칠 때 내려간다.
        width: 'min(1400px, 94vw)', height: 'min(860px, 90vh)',
        display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>{engineer.name}</span>
              <span style={{ fontSize: 12, color: GRAY }}>{engineer.position}</span>
              {engineer.teams && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: tc.bg, color: tc.text, fontWeight: 700 }}>{engineer.teams}</span>}
            </div>
            <div style={{ fontSize: 12, color: GRAY }}>
              FY{fy} 월별 실적 · 월 목표 수주 {sum.orderTarget > 0 ? `₩${numKR(Math.round(sum.orderTarget / 12))}` : '미설정'}
              <span style={{ color: MUTED }}> · </span>
              매출 {sum.salesTarget > 0 ? `₩${numKR(Math.round(sum.salesTarget / 12))}` : '미설정'}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {/* 범례 — 막대 넷이 무엇인지 먼저 말한다(목표 막대에는 금액을 적지 않는다). */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontSize: 11, color: GRAY, flexWrap: 'wrap' }}>
            <Legend color={BLUE} label="수주액" />
            <Legend color={BLUE_LIGHT} label="수주 목표" outline />
            <Legend color={GREEN} label="매출액" />
            <Legend color={GREEN_LIGHT} label="매출 목표" outline />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 8, alignItems: 'flex-end' }}>
            {bars.map(b => {
              const isCurrent = b.year === nowYear && b.month === nowMonth
              return (
                <div key={`${b.year}-${b.month}`} style={{ textAlign: 'center', minWidth: 0 }}>
                  {/* 금액은 **실적 막대에만**. 둘 다 0 이면 아무것도 적지 않는다. */}
                  <div style={{ fontSize: 10, color: BLUE, fontWeight: 700, minHeight: 13 }}>{b.orderedAmt > 0 ? numM(b.orderedAmt) : ''}</div>
                  <div style={{ fontSize: 10, color: GREEN, fontWeight: 700, minHeight: 13, marginBottom: 2 }}>{b.revenueAmt > 0 ? numM(b.revenueAmt) : ''}</div>

                  <div style={{ position: 'relative', height: BAR_H, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
                    <div style={{ position: 'absolute', inset: 0, background: isCurrent ? '#eff4ff' : '#f8fafc', borderRadius: '4px 4px 0 0' }} />
                    {/* 수주액 · 수주목표 · 매출액 · 매출목표 — 늘 이 순서다. */}
                    <BarAnimate height={h(b.orderedAmt)} color={BLUE} width={11} />
                    <BarAnimate height={h(b.orderTarget)} color={BLUE_LIGHT} width={11} outline />
                    <BarAnimate height={h(b.revenueAmt)} color={GREEN} width={11} />
                    <BarAnimate height={h(b.salesTarget)} color={GREEN_LIGHT} width={11} outline />
                  </div>

                  <div style={{ marginTop: 5 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: isCurrent ? BLUE : TEXT }}>{b.label}</div>
                    {/* 달성률은 실적이 있는 쪽만 — 수주 한 줄, 매출 한 줄. */}
                    {b.orderAchieve !== null && b.orderedAmt > 0 && (
                      <div className="num" style={{ fontSize: 9, fontWeight: 700, color: achieveColorOf(b.orderAchieve) }}>수주 {b.orderAchieve.toFixed(0)}%</div>
                    )}
                    {b.salesAchieve !== null && b.revenueAmt > 0 && (
                      <div className="num" style={{ fontSize: 9, fontWeight: 700, color: achieveColorOf(b.salesAchieve) }}>매출 {b.salesAchieve.toFixed(0)}%</div>
                    )}
                    {isCurrent && <div style={{ fontSize: 8, color: BLUE, fontWeight: 700 }}>◀</div>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 보조 지표 다섯 — 「지금 어디쯤인가」와 「앞으로 얼마씩 해야 하는가」. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10, marginTop: 22 }}>
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
