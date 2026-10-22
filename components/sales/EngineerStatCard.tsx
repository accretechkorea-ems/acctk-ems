'use client'

// 담당자 한 명의 **실적 카드** — 4칸(견적 제출·수주·매출 완료·순이익) + 달성률 바 둘.
//
// 실적 현황(app/sales/page.tsx)에 인라인으로 있던 것을 그대로 옮겼다. 모양·색·문구를 바꾸지
// 않았다 — 개인 대시보드의 「내 실적」 카드가 같은 것을 쓴다.
//
// 두 화면이 다른 것은 **누르면 무슨 일이 생기는가**뿐이다.
//   실적 현황 — 카드를 누르면 견적 목록, 오른쪽 위 막대 아이콘이 월별 그래프
//   홈        — 카드 아무 데나 누르면 바로 월별 그래프(목록은 「내 견적」 카드가 맡는다)
// 그래서 동작은 전부 prop 으로 받는다. compact 는 홈 격자(260px)에 맞춰 **여백만** 줄인다.

import { useEffect, useState } from 'react'
import { TEAM_COLORS, getCategoryColor } from '@/lib/categoryColors'
import type { EngineerStat } from '@/lib/salesStats'

const BLUE = '#234ea2'
const CARD_BG = '#ffffff'
const BORDER = '#ebebeb'
const TEXT = '#111113'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'
const achieveColorOf = (v: number | null): string => v === null ? GRAY : v >= 100 ? '#16a34a' : '#111827'

const RANK_MEDAL = ['#b8860b', '#64748b', '#92400e'] as const
const RANK_MEDAL_BG = ['#fffbeb', '#f1f5f9', '#fff7ed'] as const

const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')

/** 달성률 막대 — 켜질 때 0 에서 자라 오른다. 실적 현황의 것 그대로다. */
export function AnimatedGauge({ pct, color, height = 12, delay = 0 }: { pct: number; color: string; height?: number; delay?: number }) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setWidth(Math.min(100, pct)), delay)
    return () => clearTimeout(t)
  }, [pct, delay])
  return (
    <div style={{ background: '#e5e7eb', borderRadius: height, height, overflow: 'hidden' }}>
      {/* 값이 아주 작아도(1~2%) 보이도록 0 초과면 최소 폭 확보 */}
      <div style={{ width: `${width}%`, minWidth: pct > 0 ? 4 : 0, height: '100%', background: color, borderRadius: height, transition: 'width 1s cubic-bezier(0.4,0,0.2,1)' }} />
    </div>
  )
}

export type StatCardEngineer = {
  engineer_id: number
  name: string | null
  position: string | null
  teams: string | null
}

export type EngineerStatCardProps = {
  engineer: StatCardEngineer
  stat: EngineerStat
  /** 매출 순위(0=1위). 3위까지만 메달이 붙는다. 주지 않으면 붙지 않는다. */
  rank?: number
  /** 막대가 자라기 시작하는 시점 — 카드가 여럿일 때 차례로 보이게 한다. */
  delay?: number
  /** 카드를 눌렀을 때. */
  onClick?: () => void
  /** 오른쪽 위 막대 아이콘. 주지 않으면 아이콘을 내지 않는다(홈은 카드 전체가 그 일을 한다). */
  onChart?: () => void
  /** 홈 격자(260px)에 맞춘 여백. 숫자·문구는 그대로다. */
  compact?: boolean
}

export default function EngineerStatCard({
  engineer, stat, rank, delay = 0, onClick, onChart, compact = false,
}: EngineerStatCardProps) {
  const tc = getCategoryColor(TEAM_COLORS, engineer.teams)
  const achieveColor = achieveColorOf(stat.achieve)
  const orderAchieveColor = achieveColorOf(stat.orderAchieve)
  const pad = compact ? '12px 14px' : '16px 18px'
  const boxPad = compact ? '6px 9px' : '8px 10px'

  return (
    <div
      onClick={onClick}
      style={{
        background: CARD_BG, borderRadius: 8, padding: pad, border: `1px solid ${BORDER}`,
        cursor: onClick ? 'pointer' : 'default', position: 'relative',
        transition: 'transform 0.15s ease, border-color 0.15s ease',
        ...(compact ? { height: '100%', boxSizing: 'border-box' as const, display: 'flex', flexDirection: 'column' as const } : null),
      }}
      onMouseEnter={onClick ? (e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = 'translateY(-2px)'; el.style.borderColor = '#c7d7f8' }) : undefined}
      onMouseLeave={onClick ? (e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = ''; el.style.borderColor = BORDER }) : undefined}
    >
      {onChart && (
        <button onClick={e => { e.stopPropagation(); onChart() }} title="월별 실적 차트"
          style={{ position: 'absolute', top: 14, right: 14, width: 28, height: 28, borderRadius: '50%', background: '#f8fafc', border: `1px solid ${BORDER}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: BLUE, transition: 'all 0.15s ease' }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.background = '#eff4ff'; el.style.borderColor = '#c7d7f8' }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.background = '#f8fafc'; el.style.borderColor = BORDER }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: compact ? 8 : 12, paddingRight: onChart ? 36 : 0, flexShrink: 0 }}>
        {rank !== undefined && rank < 3 && (
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: RANK_MEDAL_BG[rank], border: `1.5px solid ${RANK_MEDAL[rank]}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 800, color: RANK_MEDAL[rank] }}>
            {rank + 1}
          </div>
        )}
        <div>
          <span style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>{engineer.name}</span>
          <span style={{ fontSize: 12, color: GRAY, marginLeft: 6 }}>{engineer.position}</span>
        </div>
        {engineer.teams && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: tc.bg, color: tc.text }}>{engineer.teams}</span>}
        {stat.achieve !== null && <span className="num" style={{ fontSize: 13, fontWeight: 800, color: achieveColor, marginLeft: 'auto' }}>{stat.achieve.toFixed(0)}%</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: compact ? 6 : 8, marginBottom: compact ? 8 : 10, flexShrink: 0 }}>
        <div style={{ background: '#f8fafc', borderRadius: 8, padding: boxPad }}>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 2, fontWeight: 500 }}>견적 제출</div>
          <div className="num" style={{ fontSize: 13, fontWeight: 700, color: stat.quotedAmt > 0 ? TEXT : MUTED }}>₩{numKR(stat.quotedAmt)}</div>
          <div style={{ fontSize: 10, color: MUTED }}>{stat.quotedCnt}건</div>
        </div>
        <div style={{ background: '#f8fafc', borderRadius: 8, padding: boxPad }}>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 2, fontWeight: 500 }}>수주</div>
          <div className="num" style={{ fontSize: 13, fontWeight: 700, color: stat.orderedAmt > 0 ? TEXT : MUTED }}>₩{numKR(stat.orderedAmt)}</div>
          <div style={{ fontSize: 10, color: MUTED }}>{stat.orderedCnt}건</div>
        </div>
        <div style={{ background: '#f8fafc', borderRadius: 8, padding: boxPad }}>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 2, fontWeight: 500 }}>매출 완료</div>
          <div className="num" style={{ fontSize: 13, fontWeight: 700, color: stat.revenueAmt > 0 ? TEXT : MUTED }}>₩{numKR(stat.revenueAmt)}</div>
        </div>
        <div style={{ background: '#f8fafc', borderRadius: 8, padding: boxPad }}>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 2, fontWeight: 500 }}>순이익</div>
          <div className="num" style={{ fontSize: 13, fontWeight: 700, color: stat.profitAmt > 0 ? '#16a34a' : MUTED }}>{stat.profitAmt > 0 ? `₩${numKR(stat.profitAmt)}` : '-'}</div>
          {stat.profitRate !== null && stat.profitAmt > 0 && <div className="num" style={{ fontSize: 10, color: '#16a34a', fontWeight: 700 }}>{stat.profitRate.toFixed(1)}%</div>}
        </div>
      </div>

      {(stat.orderTargetAmt > 0 || stat.targetAmt > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 5 : 7 }}>
          {stat.orderTargetAmt > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11 }}>
                <span style={{ color: MUTED }}>수주 달성률</span>
                <span style={{ color: orderAchieveColor, fontWeight: 700 }}>{stat.orderAchieve?.toFixed(0)}% · 목표 {numKR(stat.orderTargetAmt)}</span>
              </div>
              <AnimatedGauge pct={stat.orderAchieve || 0} color={orderAchieveColor} height={7} delay={delay} />
            </div>
          )}
          {stat.targetAmt > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11 }}>
                <span style={{ color: MUTED }}>매출 달성률</span>
                <span style={{ color: achieveColor, fontWeight: 700 }}>{stat.achieve?.toFixed(0)}% · 목표 {numKR(stat.targetAmt)}</span>
              </div>
              <AnimatedGauge pct={stat.achieve || 0} color={achieveColor} height={7} delay={delay} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
