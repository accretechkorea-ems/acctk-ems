//실적현황 페이지
'use client'

import React, { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isActiveInPeriod } from '@/lib/engineers'
import { SALES_STATUS_COLORS, TEAM_COLORS, getCategoryColor } from '@/lib/categoryColors'

const BLUE = '#234ea2'
const PAGE_BG = '#f4f5f7'
const CARD_BG = '#ffffff'
const BORDER = '#e2e4e9'
const TEXT = '#111113'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'
const ORANGE = '#d97706'

type Quote = {
  quote_id: number
  quote_number: string
  pdf_url?: string | null
  quote_date: string
  total_supply: number
  total_tax: number
  total_amount: number
  total_cost: number | null
  total_profit: number | null
  profit_rate: number | null
  status: string
  order_date: string | null
  revenue_date: string | null
  fail_reason: string | null
  recipient: string | null
  subject: string | null
  engineer_id: number
  customer_id: number | null
  dealer_id: number | null
  delivery_info: string | null
  purchase_order_url?: string | null
  purchase_order_at?: string | null
  shipping_date?: string | null
  order_memo?: string | null
  order_completed_at?: string | null
  order_completed_by?: string | null
  tax_invoice_date?: string | null
  tax_invoice_requested_at?: string | null
  tax_completed_by?: string | null
  delivery_method?: string | null
  engineers?: { name: string; position: string | null }
  customers?: { company_name: string } | null
  dealer?: { company_name: string } | null
  quote_items?: { product_name: string | null; price_list?: { model_jp: string | null } | null }[]
}
type Engineer = {
  engineer_id: number
  name: string
  position: string | null
  teams: string | null
  permission_level: string
  resigned_date?: string | null
}

type SalesTarget = {
  target_id: number
  engineer_id: number | null
  year: number
  quarter: number | null
  target_amount: number
}

const RANK_MEDAL = ['#b8860b', '#64748b', '#92400e'] as const
const RANK_MEDAL_BG = ['#fffbeb', '#f1f5f9', '#fff7ed'] as const

const POSITION_ORDER: Record<string, number> = {
  '총괄': 0, '관리자': 1, '수석': 2, '책임': 3, '선임': 4, '사원': 5,
}

const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')
const numM = (n: number) => {
  if (n === 0) return '₩0'
  if (n >= 100000000) return `₩${(n / 100000000).toFixed(1)}억`
  if (n >= 10000000) return `₩${(n / 10000000).toFixed(0)}천만`
  if (n >= 1000000) return `₩${(n / 1000000).toFixed(0)}백만`
  return `₩${Math.round(n / 10000)}만`
}
const PAGE_SIZE = 20

function getFiscalYear(dateStr: string): number {
  const m = new Date(dateStr).getMonth() + 1
  const y = new Date(dateStr).getFullYear()
  return m >= 4 ? y : y - 1
}

function getFiscalQuarter(dateStr: string): number {
  const m = new Date(dateStr).getMonth() + 1
  if (m >= 4 && m <= 6) return 1
  if (m >= 7 && m <= 9) return 2
  if (m >= 10 && m <= 12) return 3
  return 4
}

function getCurrentFY(): number {
  const now = new Date()
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1
}

function getRemainingLabel(mode: string, fy: number, month: number): string | null {
  const now = new Date()
  const nowFY = getCurrentFY()
  if (mode === 'year') {
    if (fy !== nowFY) return null
    const fyEnd = new Date(fy + 1, 2, 31)
    const diffMs = fyEnd.getTime() - now.getTime()
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    const diffMonths = Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 30))
    if (diffDays <= 0) return '기간 종료'
    if (diffMonths <= 1) return `잔여 ${diffDays}일`
    return `잔여 ${diffMonths}개월`
  }
  if (mode === 'month') {
    const nowMonth = now.getMonth() + 1
    const nowYear = now.getFullYear()
    const targetYear = month < 4 ? fy + 1 : fy
    if (targetYear === nowYear && month === nowMonth) {
      const lastDay = new Date(nowYear, nowMonth, 0).getDate()
      return `잔여 ${lastDay - now.getDate()}일`
    }
    return null
  }
  if (['q1', 'q2', 'q3', 'q4'].includes(mode)) {
    if (fy !== nowFY) return null
    const nowFQ = getFiscalQuarter(now.toISOString())
    const modeQ = parseInt(mode.replace('q', ''))
    if (nowFQ !== modeQ) return null
    const qEndMonth = modeQ === 1 ? 6 : modeQ === 2 ? 9 : modeQ === 3 ? 12 : 3
    const qEndYear = modeQ === 4 ? fy + 1 : fy
    const qEnd = new Date(qEndYear, qEndMonth - 1 + 1, 0)
    const diffDays = Math.ceil((qEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays <= 0) return '기간 종료'
    return `잔여 ${diffDays}일`
  }
  return null
}

function getPeriodLabel(mode: string, fy: number, month: number): string {
  if (mode === 'year') return `FY${fy} 연간 (${fy}.4 ~ ${fy + 1}.3)`
  if (mode === 'q1') return `FY${fy} Q1 (4~6월)`
  if (mode === 'q2') return `FY${fy} Q2 (7~9월)`
  if (mode === 'q3') return `FY${fy} Q3 (10~12월)`
  if (mode === 'q4') return `FY${fy} Q4 (1~3월)`
  if (mode === 'month') return `${month}월`
  return ''
}

function getFYMonths(fy: number): { label: string; month: number; year: number }[] {
  return [4,5,6,7,8,9,10,11,12,1,2,3].map(m => ({
    label: `${m}월`, month: m, year: m >= 4 ? fy : fy + 1,
  }))
}

function AnimatedGauge({ pct, color, height = 12, delay = 0 }: { pct: number; color: string; height?: number; delay?: number }) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setWidth(Math.min(100, pct)), delay)
    return () => clearTimeout(t)
  }, [pct, delay])
  return (
    <div style={{ background: '#e5e7eb', borderRadius: height, height, overflow: 'hidden' }}>
      <div style={{ width: `${width}%`, height: '100%', background: color, borderRadius: height, transition: 'width 1s cubic-bezier(0.4,0,0.2,1)' }} />
    </div>
  )
}

function BarAnimate({ height, color, width = 36 }: { height: number; color: string; width?: number }) {
  const [h, setH] = useState(0)
  useEffect(() => { const t = setTimeout(() => setH(height), 100); return () => clearTimeout(t) }, [height])
  return (
    <div style={{ width, height: h, background: color, borderRadius: '4px 4px 0 0', position: 'absolute', bottom: 0, transition: 'height 0.8s cubic-bezier(0.4,0,0.2,1)' }} />
  )
}

// ── 통합 실적 차트 ────────────────────────────────────────────────────────────
type ChartViewType = 'quarterly' | 'monthly' | 'yearly'

function PerformanceChart({ quotes, fy, targets, engineers, filteredEngineerIds, teamFilter }: {
  quotes: Quote[]
  fy: number
  targets: SalesTarget[]
  engineers: Engineer[]
  filteredEngineerIds: number[]
  teamFilter: string | null
}) {
  const [chartView, setChartView] = useState<ChartViewType>('quarterly')
  const BAR_H = 160

  const nowFY = getCurrentFY()
  const nowMonth = new Date().getMonth() + 1
  const nowYear = new Date().getFullYear()
  const nowFQ = getFiscalQuarter(new Date().toISOString())

  const scopedQuotes = teamFilter
    ? quotes.filter(q => filteredEngineerIds.includes(q.engineer_id))
    : quotes

  const totalYearTarget = engineers.reduce((s, e) => {
    if (teamFilter && e.teams !== teamFilter) return s
    const t = targets.find(t => t.engineer_id === e.engineer_id && t.year === fy && t.quarter === null)
    return s + (t?.target_amount || 0)
  }, 0)

  const quarterData = [
    { key: 'Q1', desc: '4~6월', q: 1 },
    { key: 'Q2', desc: '7~9월', q: 2 },
    { key: 'Q3', desc: '10~12월', q: 3 },
    { key: 'Q4', desc: '1~3월', q: 4 },
  ].map(qd => {
    const qQ = scopedQuotes.filter(q => getFiscalYear(q.quote_date) === fy && getFiscalQuarter(q.quote_date) === qd.q)
    const rev = qQ.filter(q => q.status === '매출완료')
    return {
      ...qd,
      revenueAmt: rev.reduce((s, q) => s + (q.total_supply || 0), 0),
      profitAmt: rev.reduce((s, q) => s + (q.total_profit || 0), 0),
      targetAmt: Math.round(totalYearTarget / 4),
      isCurrent: fy === nowFY && qd.q === nowFQ,
    }
  })

  const monthData = getFYMonths(fy).map(({ label, month, year }) => {
    const mQ = scopedQuotes.filter(q => {
      const d = new Date(q.quote_date)
      return d.getFullYear() === year && d.getMonth() + 1 === month
    })
    const rev = mQ.filter(q => q.status === '매출완료')
    const isCurrent = year === nowYear && month === nowMonth
    return {
      label, month, year,
      revenueAmt: rev.reduce((s, q) => s + (q.total_supply || 0), 0),
      profitAmt: rev.reduce((s, q) => s + (q.total_profit || 0), 0),
      targetAmt: Math.round(totalYearTarget / 12),
      isCurrent,
      isPast: year < nowYear || (year === nowYear && month < nowMonth),
    }
  })

  const yearData = [fy - 1, fy, fy + 1].map(y => {
    const yQ = scopedQuotes.filter(q => getFiscalYear(q.quote_date) === y)
    const rev = yQ.filter(q => q.status === '매출완료')
    const yTarget = engineers.reduce((s, e) => {
      if (teamFilter && e.teams !== teamFilter) return s
      const t = targets.find(t => t.engineer_id === e.engineer_id && t.year === y && t.quarter === null)
      return s + (t?.target_amount || 0)
    }, 0)
    return {
      label: `FY${y}`,
      revenueAmt: rev.reduce((s, q) => s + (q.total_supply || 0), 0),
      profitAmt: rev.reduce((s, q) => s + (q.total_profit || 0), 0),
      targetAmt: yTarget,
      isCurrent: y === nowFY,
    }
  })

  const data = chartView === 'quarterly' ? quarterData : chartView === 'monthly' ? monthData : yearData
  const maxAmt = Math.max(...data.map(d => Math.max(d.revenueAmt, d.targetAmt)), 1)

  return (
    <div style={{ background: CARD_BG, borderRadius: 14, padding: '20px 22px', marginBottom: 20, border: `1px solid ${BORDER}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 3, height: 16, background: BLUE, borderRadius: 2 }} />
          <span style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>실적 추이</span>
          <span style={{ fontSize: 12, color: MUTED, fontWeight: 400 }}>FY{fy}</span>
        </div>
        <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 1 }}>
          {([['quarterly', '분기별'], ['monthly', '월별'], ['yearly', '연도별']] as [ChartViewType, string][]).map(([v, label]) => (
            <button key={v} onClick={() => setChartView(v)}
              style={{ padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: chartView === v ? '#fff' : 'transparent', color: chartView === v ? TEXT : GRAY, boxShadow: chartView === v ? '0 1px 3px rgba(0,0,0,0.10)' : 'none', transition: 'all 0.15s ease' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: chartView === 'monthly' ? 'repeat(12, 1fr)' : `repeat(${data.length}, 1fr)`, gap: 8, alignItems: 'flex-end', paddingBottom: 4 }}>
        {data.map((d: any, i: number) => {
          const revenueH = Math.max(0, (d.revenueAmt / maxAmt) * BAR_H)
          const targetH = Math.max(2, (d.targetAmt / maxAmt) * BAR_H)
          const profitRate = d.revenueAmt > 0 ? (d.profitAmt / d.revenueAmt * 100) : null
          const achievePct = d.targetAmt > 0 ? (d.revenueAmt / d.targetAmt * 100) : null
          const barW = 36
          return (
            <div key={i} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: MUTED, marginBottom: 1, whiteSpace: 'nowrap' }}>
                {d.revenueAmt > 0 ? numM(d.revenueAmt) : ''}
              </div>
              {profitRate !== null && d.revenueAmt > 0 && (
                <div style={{ fontSize: 9, color: '#15803d', fontWeight: 700, marginBottom: 2 }}>{profitRate.toFixed(0)}%</div>
              )}
              <div style={{ position: 'relative', height: BAR_H, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                <div style={{ width: barW, height: Math.max(2, (Math.max(d.revenueAmt, d.targetAmt * 0.1) / maxAmt) * BAR_H) || 2, background: '#f1f5f9', borderRadius: '4px 4px 0 0', position: 'absolute', bottom: 0 }} />
                <BarAnimate height={revenueH} color={d.isCurrent ? BLUE : '#94a3b8'} width={barW} />
                {d.targetAmt > 0 && (
                  <div style={{ position: 'absolute', bottom: targetH, left: '50%', transform: 'translateX(-50%)', width: barW + 8, height: 2, background: ORANGE, borderRadius: 2, zIndex: 2 }} />
                )}
              </div>
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: chartView === 'monthly' ? 10 : 12, fontWeight: 700, color: d.isCurrent ? BLUE : TEXT, whiteSpace: 'nowrap' }}>{d.label || d.key}</div>
                {chartView === 'quarterly' && <div style={{ fontSize: 10, color: MUTED }}>{d.desc}</div>}
                {d.isCurrent && <div style={{ fontSize: 9, color: BLUE, fontWeight: 700, marginTop: 1 }}>● 현재</div>}
                {achievePct !== null && d.revenueAmt > 0 && (
                  <div style={{ fontSize: 9, color: achievePct >= 100 ? '#15803d' : achievePct >= 70 ? ORANGE : '#b91c1c', fontWeight: 700 }}>{achievePct.toFixed(0)}%</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 14, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${BORDER}`, fontSize: 11, color: MUTED, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 10, height: 10, background: '#94a3b8', borderRadius: 2 }} />매출 완료</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 14, height: 2, background: ORANGE, borderRadius: 1 }} />목표</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 10, height: 10, background: '#15803d', borderRadius: 2 }} />순이익률</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 10, height: 10, background: BLUE, borderRadius: 2 }} />현재 기간</div>
      </div>
    </div>
  )
}

// ── 개인 월별 차트 모달 ──────────────────────────────────────────────────────
function EngineerChartModal({ engineer, quotes, targets, fy, onClose }: {
  engineer: Engineer; quotes: Quote[]; targets: SalesTarget[]; fy: number; onClose: () => void
}) {
  const nowMonth = new Date().getMonth() + 1
  const nowYear = new Date().getFullYear()
  const BAR_H = 140

  const myTarget = targets.find(t => t.engineer_id === engineer.engineer_id && t.year === fy && t.quarter === null)
  const yearTarget = myTarget?.target_amount || 0
  const monthTarget = Math.round(yearTarget / 12)

  const monthData = getFYMonths(fy).map(({ label, month, year }) => {
    const mQ = quotes.filter(q => {
      if (q.engineer_id !== engineer.engineer_id) return false
      const d = new Date(q.quote_date)
      return d.getFullYear() === year && d.getMonth() + 1 === month && q.status === '매출완료'
    })
    const revenueAmt = mQ.reduce((s, q) => s + (q.total_supply || 0), 0)
    const profitAmt = mQ.reduce((s, q) => s + (q.total_profit || 0), 0)
    const isCurrent = year === nowYear && month === nowMonth
    const achieve = monthTarget > 0 ? (revenueAmt / monthTarget * 100) : null
    return { label, month, year, revenueAmt, profitAmt, isCurrent, achieve }
  })

  const maxAmt = Math.max(...monthData.map(d => Math.max(d.revenueAmt, monthTarget)), 1)
  const targetH = Math.max(2, (monthTarget / maxAmt) * BAR_H)
  const tc = getCategoryColor(TEAM_COLORS, engineer.teams)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: CARD_BG, borderRadius: 18, width: '100%', maxWidth: 860, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>{engineer.name}</span>
              <span style={{ fontSize: 12, color: GRAY }}>{engineer.position}</span>
              {engineer.teams && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: tc.bg, color: tc.text, fontWeight: 700 }}>{engineer.teams}</span>}
            </div>
            <div style={{ fontSize: 12, color: GRAY }}>FY{fy} 월별 매출 현황 · 월 목표 {monthTarget > 0 ? `₩${numKR(monthTarget)}` : '미설정'}</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 6, alignItems: 'flex-end', paddingBottom: 8 }}>
            {monthData.map((d, i) => {
              const revenueH = Math.max(0, (d.revenueAmt / maxAmt) * BAR_H)
              const profitRate = d.revenueAmt > 0 ? (d.profitAmt / d.revenueAmt * 100) : null
              const achieveColor = d.achieve === null ? GRAY : d.achieve >= 100 ? '#16a34a' : d.achieve >= 70 ? ORANGE : '#dc2626'
              return (
                <div key={i} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: GRAY, marginBottom: 1 }}>{d.revenueAmt > 0 ? numM(d.revenueAmt) : ''}</div>
                  {profitRate !== null && d.revenueAmt > 0 && <div style={{ fontSize: 9, color: '#16a34a', fontWeight: 700, marginBottom: 2 }}>{profitRate.toFixed(0)}%</div>}
                  <div style={{ position: 'relative', height: BAR_H, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                    <div style={{ position: 'absolute', bottom: 0, width: 36, height: '100%', background: '#f8fafc', borderRadius: '4px 4px 0 0' }} />
                    <BarAnimate height={revenueH} color={d.isCurrent ? BLUE : '#94a3b8'} />
                    {monthTarget > 0 && <div style={{ position: 'absolute', bottom: targetH, left: '50%', transform: 'translateX(-50%)', width: 44, height: 2, background: ORANGE, borderRadius: 2, zIndex: 2 }} />}
                  </div>
                  <div style={{ marginTop: 5 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: d.isCurrent ? BLUE : TEXT }}>{d.label}</div>
                    {d.achieve !== null && d.revenueAmt > 0 && <div style={{ fontSize: 9, fontWeight: 700, color: achieveColor }}>{d.achieve.toFixed(0)}%</div>}
                    {d.isCurrent && <div style={{ fontSize: 8, color: BLUE, fontWeight: 700 }}>◀</div>}
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 20 }}>
            {(() => {
              const totalRev = monthData.reduce((s, d) => s + d.revenueAmt, 0)
              const totalProfit = monthData.reduce((s, d) => s + d.profitAmt, 0)
              const achievedMonths = monthData.filter(d => d.revenueAmt > 0).length
              const overTargetMonths = monthData.filter(d => d.achieve !== null && d.achieve >= 100).length
              return [
                { label: '연간 누적 매출', value: `₩${numKR(totalRev)}` },
                { label: '연간 누적 순이익', value: totalProfit > 0 ? `₩${numKR(totalProfit)}` : '-', color: '#16a34a' },
                { label: '매출 발생 월수', value: `${achievedMonths}개월` },
                { label: '목표 달성 월수', value: monthTarget > 0 ? `${overTargetMonths}개월` : '-', color: '#16a34a' },
              ].map(({ label, value, color }: any) => (
                <div key={label} style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px', border: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 10, color: GRAY, marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: color || TEXT }}>{value}</div>
                </div>
              ))
            })()}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 16, fontSize: 11, color: GRAY }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 12, height: 12, background: '#94a3b8', borderRadius: 2 }} />매출 완료</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 2, background: ORANGE, borderRadius: 1 }} />월 목표</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 12, height: 12, background: BLUE, borderRadius: 2 }} />현재 월</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 팀 실적 카드 (4칸: 포캐스트/수주/매출완료/순이익) ─────────────────────────
function TeamCard({ teamId, engineers, filteredQuotes, targets, mode, fy, onCardClick, isSelected }: {
  teamId: string; engineers: Engineer[]; filteredQuotes: Quote[]; targets: SalesTarget[]
  mode: string; fy: number; onCardClick: (id: string) => void; isSelected: boolean
}) {
  const tc = getCategoryColor(TEAM_COLORS, teamId)
  const teamEngIds = engineers.filter(e => e.teams === teamId).map(e => e.engineer_id)
  const teamQuotes = filteredQuotes.filter(q => teamEngIds.includes(q.engineer_id))
  const revenueQuotes = teamQuotes.filter(q => q.status === '매출완료')
  const quoteAmt = teamQuotes.reduce((s, q) => s + (q.total_supply || 0), 0)
  const orderAmt = teamQuotes.filter(q => ['수주', '매출완료'].includes(q.status)).reduce((s, q) => s + (q.total_supply || 0), 0)
  const revenueAmt = revenueQuotes.reduce((s, q) => s + (q.total_supply || 0), 0)
  const profitAmt = revenueQuotes.reduce((s, q) => s + (q.total_profit || 0), 0)
  const profitRate = revenueAmt > 0 ? (profitAmt / revenueAmt * 100) : null
  const teamYearTarget = engineers.filter(e => e.teams === teamId).reduce((s, e) => {
    const t = targets.find(t => t.engineer_id === e.engineer_id && t.year === fy && t.quarter === null)
    return s + (t?.target_amount || 0)
  }, 0)
  const periodTarget = mode === 'year' ? teamYearTarget : mode === 'month' ? Math.round(teamYearTarget / 12) : Math.round(teamYearTarget / 4)
  const achieve = periodTarget > 0 ? (revenueAmt / periodTarget * 100) : null
  const achieveColor = achieve === null ? GRAY : achieve >= 100 ? '#16a34a' : achieve >= 70 ? '#f59e0b' : '#dc2626'

  return (
    <div onClick={() => onCardClick(teamId)} style={{
      background: CARD_BG, borderRadius: 14, padding: '16px 18px',
      border: `1px solid ${isSelected ? tc.text : BORDER}`,
      borderLeft: `3px solid ${tc.text}`,
      cursor: 'pointer', transition: 'box-shadow 0.15s ease, transform 0.15s ease, border-color 0.15s ease',
      boxShadow: isSelected ? `0 4px 18px rgba(0,0,0,0.10)` : '0 1px 3px rgba(0,0,0,0.04)',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.10)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = isSelected ? '0 4px 18px rgba(0,0,0,0.10)' : '0 1px 3px rgba(0,0,0,0.04)'; (e.currentTarget as HTMLDivElement).style.transform = 'none' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>{teamId}</span>
          <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 99, background: tc.bg, color: tc.text, fontWeight: 700 }}>{teamEngIds.length}명</span>
        </div>
        {achieve !== null && (
          <span className="num" style={{ fontSize: 13, fontWeight: 800, color: achieveColor, background: achieveColor + '12', padding: '2px 8px', borderRadius: 99 }}>
            {achieve.toFixed(1)}%
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 12 }}>
        {[
          { label: '포캐스트', value: `₩${numKR(quoteAmt)}`, color: TEXT },
          { label: '수주', value: `₩${numKR(orderAmt)}`, color: TEXT },
          { label: '매출완료', value: `₩${numKR(revenueAmt)}`, color: BLUE },
          { label: '순이익', value: profitAmt > 0 ? `₩${numKR(profitAmt)}` : '-', color: profitAmt > 0 ? '#15803d' : MUTED, sub: profitRate !== null && profitAmt > 0 ? `${profitRate.toFixed(1)}%` : undefined },
        ].map(({ label, value, color, sub }) => (
          <div key={label} style={{ background: '#f8fafc', borderRadius: 9, padding: '9px 11px', border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 10, color: MUTED, marginBottom: 3, fontWeight: 500 }}>{label}</div>
            <div className="num" style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
            {sub && <div className="num" style={{ fontSize: 10, color: '#15803d', fontWeight: 700, marginTop: 1 }}>{sub}</div>}
          </div>
        ))}
      </div>

      {periodTarget > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11 }}>
            <span style={{ color: MUTED }}>달성률</span>
            <span className="num" style={{ color: achieveColor, fontWeight: 700 }}>₩{numKR(periodTarget)}</span>
          </div>
          <AnimatedGauge pct={achieve || 0} color={achieveColor} height={7} delay={200} />
        </>
      )}
    </div>
  )
}

// ── 개인 견적 모달 ────────────────────────────────────────────────────────────
function EngineerQuoteModal({ engineer, quotes, currentEngineerId, engineers, onClose, onStatusSave }: {
  engineer: Engineer & { quotedAmt: number; revenueAmt: number; profitAmt: number; profitRate: number | null; targetAmt: number; achieve: number | null }
  quotes: Quote[]
  currentEngineerId: number | null
  engineers: Engineer[]
  onClose: () => void
  onStatusSave: (q: Quote, status: string, orderDate: string, revenueDate: string, failReason: string) => Promise<void>
})
 {
  const supabase = createClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('전체')
  const [page, setPage] = useState(1)
  const [editQuote, setEditQuote] = useState<Quote | null>(null)
  const [editStatus, setEditStatus] = useState('')
  const [editOrderDate, setEditOrderDate] = useState('')
  const [editRevenueDate, setEditRevenueDate] = useState('')
  const [editFailReason, setEditFailReason] = useState('')
  const [saving, setSaving] = useState(false)
  // 발주서 등록
  const [poQuote, setPoQuote] = useState<Quote | null>(null)
  const [poFile, setPoFile] = useState<File | null>(null)
  const [poDelivery, setPoDelivery] = useState<'직납' | '택배발송'>('직납')
  const [poAddress, setPoAddress] = useState('')
  const [poAddressMode, setPoAddressMode] = useState<'company' | 'direct'>('company')
  const [poCompanyAddress, setPoCompanyAddress] = useState<string | null>(null)
  const [poContacts, setPoContacts] = useState<{ contact_id: number; name: string; phone: string | null; position: string | null; department: string | null }[]>([])
  const [poContactId, setPoContactId] = useState<number | ''>('')
  const [poUploading, setPoUploading] = useState(false)
  const [poIsDragging, setPoIsDragging] = useState(false)
  const poFileRef = useRef<HTMLInputElement>(null)
  // 세금계산서 요청
  const [taxQuote, setTaxQuote] = useState<Quote | null>(null)
  const [taxDate, setTaxDate] = useState('')
  const [taxSending, setTaxSending] = useState(false)
  // 메모 툴팁
  const [hoveredMemoId, setHoveredMemoId] = useState<number | null>(null)
  const tc = getCategoryColor(TEAM_COLORS, engineer.teams)
  const achieveColor = engineer.achieve === null ? GRAY : engineer.achieve >= 100 ? '#16a34a' : engineer.achieve >= 70 ? '#f59e0b' : '#dc2626'
  const filtered = quotes.filter(q => {
    const matchSearch = !search.trim() ||
      q.quote_number.toLowerCase().includes(search.toLowerCase()) ||
      (q.customers?.company_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (q.subject || '').toLowerCase().includes(search.toLowerCase())
    return matchSearch && (statusFilter === '전체' || q.status === statusFilter)
  })
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const inp: React.CSSProperties = { padding: '6px 10px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff', boxSizing: 'border-box' }
  const handleSave = async () => {
    if (!editQuote) return
    setSaving(true)
    await onStatusSave(editQuote, editStatus, editOrderDate, editRevenueDate, editFailReason)
    setSaving(false)
    setEditQuote(null)
  }

  useEffect(() => {
    if (!poQuote?.customer_id) { setPoContacts([]); setPoCompanyAddress(null); return }
    Promise.all([
      supabase.from('contacts').select('contact_id, name, phone, position, department').is('deleted_at', null).eq('customer_id', poQuote.customer_id).order('contact_id'),
      supabase.from('customers').select('address').eq('customer_id', poQuote.customer_id).single(),
    ]).then(([{ data: contacts }, { data: cust }]) => {
      setPoContacts(contacts ?? [])
      setPoCompanyAddress(cust?.address ?? null)
      setPoAddressMode('company')
      setPoAddress('')
    })
  }, [poQuote])

  const handlePoUpload = async () => {
    if (!poQuote || !poFile) return
    setPoUploading(true)
    const fd = new FormData()
    fd.append('quoteId', String(poQuote.quote_id))
    fd.append('quoteNumber', poQuote.quote_number)
    fd.append('action', 'upload')
    fd.append('file', poFile)
    fd.append('deliveryMethod', poDelivery)
    if (poDelivery === '택배발송') {
      const selectedContact = poContacts.find(c => c.contact_id === poContactId)
      const finalAddress = poAddressMode === 'company' ? (poCompanyAddress ?? '') : poAddress.trim()
      const parts: string[] = []
      if (selectedContact) {
        const label = [selectedContact.name, selectedContact.position || selectedContact.department].filter(Boolean).join(' ')
        parts.push(`받는사람: ${label}`)
        if (selectedContact.phone) parts.push(`연락처: ${selectedContact.phone}`)
      }
      if (finalAddress) parts.push(`주소: ${finalAddress}`)
      if (parts.length > 0) fd.append('deliveryAddress', parts.join('\n'))
    }
    const res = await fetch('/api/purchase-order', { method: 'POST', body: fd })
    const json = await res.json().catch(() => ({}))
    setPoUploading(false)
    if (!res.ok) {
      alert(`발주서 등록 실패: ${json.error || res.status}`)
      return
    }
    setPoQuote(null)
    setPoFile(null)
    setPoAddress('')
    setPoAddressMode('company')
    setPoCompanyAddress(null)
    setPoContactId('')
    setPoContacts([])
    await onStatusSave(poQuote, '발주(주문 대기)', '', '', '')
  }

  const handleTaxRequest = async () => {
    if (!taxQuote) return
    if (!taxDate) { alert('요청 발행일을 선택해주세요.'); return }
    setTaxSending(true)
    const fd = new FormData()
    fd.append('quoteId', String(taxQuote.quote_id))
    fd.append('action', 'request_tax')
    if (taxDate) fd.append('taxDate', taxDate)
    const res = await fetch('/api/purchase-order', { method: 'POST', body: fd })
    const json = await res.json().catch(() => ({}))
    setTaxSending(false)
    if (!res.ok) {
      alert(`세금계산서 요청 실패: ${json.error || res.status}`)
      return
    }
    setTaxQuote(null)
    setTaxDate('')
    await onStatusSave(taxQuote, '세금계산서 요청', '', '', '')
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: CARD_BG, borderRadius: 18, width: '100%', minWidth: 900, maxWidth: 1200, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', position: 'relative' }}>
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: TEXT }}>{engineer.name}</span>
                <span style={{ fontSize: 12, color: GRAY }}>{engineer.position}</span>
                {engineer.teams && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: tc.bg, color: tc.text, fontWeight: 700 }}>{engineer.teams}</span>}
              </div>
              <div style={{ display: 'flex', gap: 20, fontSize: 13 }}>
                <div><span style={{ color: GRAY, fontSize: 11 }}>포캐스트</span><div className="num" style={{ fontWeight: 700, color: TEXT }}>₩{numKR(engineer.quotedAmt)}</div></div>
                <div><span style={{ color: GRAY, fontSize: 11 }}>매출 완료</span><div className="num" style={{ fontWeight: 700, color: BLUE }}>₩{numKR(engineer.revenueAmt)}</div></div>
                <div>
                  <span style={{ color: GRAY, fontSize: 11 }}>순이익</span>
                  <div className="num" style={{ fontWeight: 800, color: '#16a34a' }}>
                    {engineer.profitAmt > 0 ? `₩${numKR(engineer.profitAmt)}` : '-'}
                    {engineer.profitRate !== null && engineer.profitAmt > 0 && <span style={{ fontSize: 11, marginLeft: 4 }}>({engineer.profitRate.toFixed(1)}%)</span>}
                  </div>
                </div>
                {engineer.achieve !== null && (
                  <div><span style={{ color: GRAY, fontSize: 11 }}>목표 달성률</span><div className="num" style={{ fontWeight: 800, color: achieveColor }}>{engineer.achieve.toFixed(1)}%</div></div>
                )}
              </div>
            </div>
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>✕</button>
          </div>
          {/* 대리점별 현황 */}
          {(() => {
            const dealerMap: Record<string, { name: string; supply: number; count: number }> = {}
            quotes.forEach(q => {
              if (!q.dealer_id || !q.dealer?.company_name) return
              const key = String(q.dealer_id)
              if (!dealerMap[key]) dealerMap[key] = { name: q.dealer.company_name, supply: 0, count: 0 }
              dealerMap[key].supply += q.total_supply
              dealerMap[key].count += 1
            })
            const dealers = Object.values(dealerMap).sort((a, b) => b.supply - a.supply)
            if (dealers.length === 0) return null
            return (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: '#fff7ed', borderRadius: 10, border: '1px solid #fed7aa' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#c2410c', marginBottom: 6 }}>대리점별 현황</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {dealers.map(d => (
                    <div key={d.name} style={{ background: '#fff', border: '1px solid #fed7aa', borderRadius: 7, padding: '4px 10px', fontSize: 11 }}>
                      <span style={{ fontWeight: 700, color: '#c2410c' }}>{d.name}</span>
                      <span className="num" style={{ color: GRAY, marginLeft: 6 }}>₩{numKR(d.supply)}</span>
                      <span style={{ color: MUTED, marginLeft: 4, fontSize: 10 }}>({d.count}건)</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="견적번호 / 고객사 / 내용 검색" style={{ ...inp, flex: 1, minWidth: 200 }} />
            {['전체', '견적중', '발주(주문 대기)', '주문완료', '세금계산서 요청', '매출완료', '취소요청', '실패'].map(s => (
              <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
                style={{ padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', background: statusFilter === s ? (s === '전체' ? BLUE : getCategoryColor(SALES_STATUS_COLORS, s).text) : '#f3f4f6', color: statusFilter === s ? '#fff' : TEXT }}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {paged.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>견적이 없습니다</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, background: CARD_BG, zIndex: 1 }}>
                <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                  {['견적번호', '날짜', '대리점', '고객사', '품목', '매출액', '순이익', '상태', '관리'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap', background: '#f8fafc' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map(q => {
                  const hasProfit = q.total_profit != null && q.total_profit !== 0
                  const profitConfirmed = ['발주(주문 대기)', '주문완료', '세금계산서 요청', '매출완료'].includes(q.status)
                  const profitColor = profitConfirmed ? '#15803d' : TEXT
                  const profitRateColor = profitConfirmed ? ((q.profit_rate || 0) >= 40 ? '#15803d' : ORANGE) : GRAY
                  const itemNames = q.quote_items && q.quote_items.length > 0
                    ? q.quote_items.map(i => i.price_list?.model_jp || i.product_name).filter(Boolean).join(', ')
                    : '-'
                  const showOrderInfo = ['주문완료', '세금계산서 요청', '매출완료'].includes(q.status)
                  return (
                    <tr key={q.quote_id} style={{ borderBottom: `1px solid ${BORDER}`, transition: 'background 0.12s ease' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: BLUE, whiteSpace: 'nowrap', textAlign: 'center' }}>
                        <span
                          onClick={async () => {
                            if (!q.pdf_url) return
                            if (q.pdf_url.includes('synology')) { window.open(q.pdf_url, '_blank'); return }
                            const path = q.pdf_url.startsWith('quote-pdfs/') ? q.pdf_url.replace('quote-pdfs/', '') : q.pdf_url.split('/quote-pdfs/')[1]
                            if (!path) return
                            const res = await fetch(`/api/quote-pdf?path=${encodeURIComponent(path)}`)
                            const json = await res.json()
                            if (json.signedUrl) {
                              window.open(json.signedUrl, '_blank')
                              await supabase.from('download_logs').insert({ engineer_id: currentEngineerId, quote_id: q.quote_id, quote_number: q.quote_number, company_name: q.customers?.company_name ?? null, action: 'view' })
                            }
                          }}
                          style={{ cursor: q.pdf_url ? 'pointer' : 'default' }}>
                          {q.quote_number}
                          {q.pdf_url && <span style={{ marginLeft: 4, fontSize: 9, color: MUTED }}>PDF</span>}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', color: MUTED, whiteSpace: 'nowrap', fontSize: 11, textAlign: 'center' }}>{q.quote_date}</td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        {q.dealer?.company_name
                          ? <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#fff7ed', color: '#c2410c', fontWeight: 700, border: '1px solid #fed7aa' }}>{q.dealer.company_name}</span>
                          : <span style={{ fontSize: 11, color: MUTED }}>직판</span>}
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 600, whiteSpace: 'nowrap', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center' }}>{q.customers?.company_name || '-'}</td>
                      <td style={{ padding: '8px 10px', color: GRAY, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>{itemNames}</td>
                      <td className="num" style={{ padding: '8px 10px', fontWeight: 700, whiteSpace: 'nowrap', color: TEXT, textAlign: 'center' }}>₩{numKR(q.total_supply)}</td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        {hasProfit ? <span className="num" style={{ fontWeight: 700, color: profitColor, fontSize: 11 }}>₩{numKR(q.total_profit!)}<span style={{ color: profitRateColor, marginLeft: 4 }}>{q.profit_rate?.toFixed(0)}%</span></span> : <span style={{ color: BORDER }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                          <span style={{ padding: '3px 7px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: getCategoryColor(SALES_STATUS_COLORS, q.status).bg, color: getCategoryColor(SALES_STATUS_COLORS, q.status).text, whiteSpace: 'nowrap', alignSelf: 'center' }}>
                            {q.status === '세금계산서 요청' ? '세금계산서 발행 요청' : q.status}
                          </span>
                          {showOrderInfo && (q.shipping_date || q.order_memo) && (
                            <div style={{ position: 'relative' }}
                              onMouseEnter={() => setHoveredMemoId(q.quote_id)}
                              onMouseLeave={() => setHoveredMemoId(null)}>
                              <span style={{ fontSize: 10, cursor: 'help', display: 'flex', alignItems: 'center', gap: 3 }}>
                                <span style={{ color: MUTED, fontWeight: 600 }}>출하예정</span>
                                <span style={{ color: '#0369a1', fontWeight: 700 }}>{q.shipping_date || '미정'}</span>
                                {q.order_memo && <span style={{ fontSize: 9 }}>📋</span>}
                              </span>
                              {hoveredMemoId === q.quote_id && (() => {
                                const rawProcessor = q.tax_completed_by || q.order_completed_by
                                const enrichProcessor = (raw: string | null | undefined) => {
                                  if (!raw) return '-'
                                  // 이미 직급 포함된 경우 (공백 포함) 그대로 사용
                                  if (raw.includes(' ')) return raw
                                  // 이름만 있는 경우 engineers 목록에서 직급 룩업
                                  const found = engineers.find(e => e.name === raw)
                                  return found?.position ? `${raw} ${found.position}` : raw
                                }
                                const processor = enrichProcessor(rawProcessor)
                                return (
                                  <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: '#1e293b', color: '#e2e8f0', borderRadius: 9, padding: '8px 12px', fontSize: 11, minWidth: 180, maxWidth: 260, lineHeight: 1.6, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', pointerEvents: 'none' }}>
                                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>처리 담당자</div>
                                    <div style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: q.order_memo ? 8 : 0 }}>
                                      {processor}
                                    </div>
                                    {q.order_memo && (
                                      <>
                                        <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, marginBottom: 3 }}>메모</div>
                                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{q.order_memo}</div>
                                      </>
                                    )}
                                  </div>
                                )
                              })()}
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                          {q.status === '견적중' && (
                            <button onClick={() => { setPoQuote(q); setPoFile(null) }}
                              style={{ padding: '3px 7px', background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: '#7c3aed' }}>
                              발주서 등록
                            </button>
                          )}
                          {q.status === '주문완료' && (
                            <button onClick={() => { setTaxQuote(q); setTaxDate(q.tax_invoice_date || '') }}
                              style={{ padding: '3px 7px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: '#b45309' }}>
                              계산서 요청
                            </button>
                          )}
                          <button
                            onClick={() => { setEditQuote(q); setEditStatus('취소요청'); setEditFailReason(q.fail_reason || '') }}
                            style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6, cursor: 'pointer', fontSize: 13, color: MUTED, lineHeight: 1, flexShrink: 0 }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#fef2f2'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#fecdd3'; (e.currentTarget as HTMLButtonElement).style.color = '#be123c' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.borderColor = BORDER; (e.currentTarget as HTMLButtonElement).style.color = MUTED }}
                          >⋮</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        {totalPages > 1 && (
          <div style={{ padding: '12px 24px', borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${BORDER}`, background: '#fff', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.4 : 1, fontWeight: 700 }}>‹</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: page === p ? BLUE : '#f3f4f6', color: page === p ? '#fff' : TEXT }}>{p}</button>
            ))}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${BORDER}`, background: '#fff', cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.4 : 1, fontWeight: 700 }}>›</button>
            <span style={{ fontSize: 12, color: GRAY, marginLeft: 8 }}>{filtered.length}건 중 {(page - 1) * PAGE_SIZE + 1}~{Math.min(page * PAGE_SIZE, filtered.length)}건</span>
          </div>
        )}
        {/* 발주서 등록 모달 */}
        {poQuote && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 360, boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 6 }}>발주서 등록</div>
              <div style={{ fontSize: 12, color: GRAY, marginBottom: 16 }}>{poQuote.quote_number}</div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: GRAY, marginBottom: 6, fontWeight: 600 }}>배송 방법</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['직납', '택배발송'] as const).map(m => (
                    <button key={m} onClick={() => setPoDelivery(m)}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1.5px solid ${poDelivery === m ? '#7c3aed' : BORDER}`, cursor: 'pointer', fontWeight: 700, fontSize: 13, background: poDelivery === m ? '#f5f3ff' : '#f9fafb', color: poDelivery === m ? '#7c3aed' : GRAY, transition: 'all 0.12s' }}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              {poDelivery === '택배발송' && (
                <>
                  {poContacts.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, color: GRAY, marginBottom: 6, fontWeight: 600 }}>받는 담당자</div>
                      <select
                        value={poContactId}
                        onChange={e => setPoContactId(e.target.value ? Number(e.target.value) : '')}
                        style={{ width: '100%', padding: '7px 10px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box' }}>
                        <option value=''>-- 담당자 선택 (선택사항) --</option>
                        {poContacts.map(c => {
                          const label = [c.name, c.position || c.department].filter(Boolean).join(' · ')
                          return <option key={c.contact_id} value={c.contact_id}>{label}{c.phone ? ` (${c.phone})` : ''}</option>
                        })}
                      </select>
                    </div>
                  )}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: GRAY, marginBottom: 6, fontWeight: 600 }}>배송 주소</div>
                    <select
                      value={poAddressMode}
                      onChange={e => { setPoAddressMode(e.target.value as 'company' | 'direct'); setPoAddress('') }}
                      style={{ width: '100%', padding: '7px 10px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box', marginBottom: 6 }}>
                      {poCompanyAddress && <option value="company">🏢 회사 주소: {poCompanyAddress}</option>}
                      <option value="direct">✏️ 직접 입력</option>
                    </select>
                    {poAddressMode === 'direct' && (
                      <textarea
                        value={poAddress}
                        onChange={e => setPoAddress(e.target.value)}
                        placeholder="배송받을 주소를 입력하세요"
                        rows={2}
                        style={{ width: '100%', padding: '7px 10px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12, outline: 'none', resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box', fontFamily: 'inherit' }}
                      />
                    )}
                    {poAddressMode === 'company' && poCompanyAddress && (
                      <div style={{ padding: '6px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#15803d', lineHeight: 1.5 }}>
                        {poCompanyAddress}
                      </div>
                    )}
                  </div>
                </>
              )}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: GRAY, marginBottom: 6, fontWeight: 600 }}>발주서 PDF</div>
                <div
                  onDragOver={e => { e.preventDefault(); setPoIsDragging(true) }}
                  onDragLeave={() => setPoIsDragging(false)}
                  onDrop={e => {
                    e.preventDefault()
                    setPoIsDragging(false)
                    const f = e.dataTransfer.files[0]
                    if (f && f.type === 'application/pdf') setPoFile(f)
                  }}
                  onClick={() => poFileRef.current?.click()}
                  style={{ border: `2px dashed ${poIsDragging ? '#7c3aed' : poFile ? '#7c3aed' : BORDER}`, borderRadius: 10, padding: '18px 12px', textAlign: 'center', cursor: 'pointer', background: poIsDragging ? '#f5f3ff' : poFile ? '#faf5ff' : '#fafafa', transition: 'all 0.15s' }}>
                  {poFile ? (
                    <>
                      <div style={{ fontSize: 20, marginBottom: 4 }}>📄</div>
                      <div style={{ fontSize: 12, color: '#7c3aed', fontWeight: 700 }}>{poFile.name}</div>
                      <div style={{ fontSize: 10, color: MUTED, marginTop: 3 }}>클릭하여 다시 선택</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 22, marginBottom: 6 }}>📁</div>
                      <div style={{ fontSize: 12, color: GRAY, fontWeight: 600 }}>PDF를 여기에 드래그하거나</div>
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>클릭하여 파일 선택</div>
                    </>
                  )}
                  <input ref={poFileRef} type="file" accept="application/pdf"
                    onChange={e => setPoFile(e.target.files?.[0] || null)}
                    style={{ display: 'none' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setPoQuote(null); setPoFile(null) }} disabled={poUploading}
                  style={{ flex: 1, padding: 9, background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>취소</button>
                <button onClick={handlePoUpload} disabled={poUploading || !poFile}
                  style={{ flex: 1, padding: 9, background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, opacity: (poUploading || !poFile) ? 0.6 : 1 }}>
                  {poUploading ? '업로드 중...' : '등록'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 세금계산서 요청 모달 */}
        {taxQuote && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 340, boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 6 }}>세금계산서 발행 요청</div>
              <div style={{ fontSize: 12, color: GRAY, marginBottom: 16 }}>{taxQuote.quote_number}</div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: GRAY, marginBottom: 6, fontWeight: 600 }}>요청 발행일 <span style={{ color: '#dc2626' }}>*</span></div>
                <input type="date" value={taxDate} onChange={e => setTaxDate(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: `1px solid ${taxDate ? BORDER : '#fca5a5'}`, borderRadius: 8, fontSize: 13, outline: 'none', colorScheme: 'light', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setTaxQuote(null); setTaxDate('') }} disabled={taxSending}
                  style={{ flex: 1, padding: 9, background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>취소</button>
                <button onClick={handleTaxRequest} disabled={taxSending || !taxDate}
                  style={{ flex: 1, padding: 9, background: '#b45309', color: '#fff', border: 'none', borderRadius: 8, cursor: taxDate ? 'pointer' : 'not-allowed', fontWeight: 700, opacity: (taxSending || !taxDate) ? 0.45 : 1 }}>
                  {taxSending ? '요청 중...' : '발행 요청'}
                </button>
              </div>
            </div>
          </div>
        )}

        {editQuote && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 360, boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 4 }}>취소 / 실패 처리</div>
              <div style={{ fontSize: 12, color: GRAY, marginBottom: 16 }}>{editQuote.quote_number} · {editQuote.customers?.company_name || ''}</div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {(['취소요청', '실패'] as const).map(s => (
                  <button key={s} onClick={() => setEditStatus(s)}
                    style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: `1.5px solid ${editStatus === s ? getCategoryColor(SALES_STATUS_COLORS, s).text : BORDER}`, cursor: 'pointer', fontWeight: 700, fontSize: 13, background: editStatus === s ? getCategoryColor(SALES_STATUS_COLORS, s).bg : '#f9fafb', color: editStatus === s ? getCategoryColor(SALES_STATUS_COLORS, s).text : GRAY, transition: 'all 0.12s' }}>
                    {s}
                  </button>
                ))}
              </div>

              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: GRAY, marginBottom: 5, fontWeight: 600 }}>
                  {editStatus === '취소요청' ? '취소 사유' : '실패 사유'}
                </div>
                <textarea value={editFailReason} onChange={e => setEditFailReason(e.target.value)} rows={3}
                  placeholder={editStatus === '취소요청' ? '취소 요청 사유를 입력하세요' : '실패 사유를 입력하세요'}
                  style={{ width: '100%', padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box' }} />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={() => setEditQuote(null)} style={{ flex: 1, padding: '9px', background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>닫기</button>
                <button onClick={handleSave} disabled={saving}
                  style={{ flex: 1, padding: '9px', background: getCategoryColor(SALES_STATUS_COLORS, editStatus).text, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
                  {saving ? '처리 중...' : `${editStatus} 확정`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function SalesPage() {
  const supabase = createClient()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [engineers, setEngineers] = useState<Engineer[]>([])
  const [targets, setTargets] = useState<SalesTarget[]>([])
  const [loading, setLoading] = useState(true)
  const currentFY = getCurrentFY()
  const thisMonth = new Date().getMonth() + 1
  const [fy, setFy] = useState(currentFY)
  const [mode, setMode] = useState<'year' | 'q1' | 'q2' | 'q3' | 'q4' | 'month'>('month')
  const [month, setMonth] = useState(thisMonth)
  const [teamFilter, setTeamFilter] = useState<string | null>(null)
  const [selectedEngineer, setSelectedEngineer] = useState<any | null>(null)
  const [chartEngineer, setChartEngineer] = useState<Engineer | null>(null)
  const [showChart, setShowChart] = useState(false)
  const [currentEngineer, setCurrentEngineer] = useState<Engineer | null>(null)

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    setLoading(true)
    await fetch('/api/auto-fail', { method: 'POST' }).catch(() => {})
    const { data: userData } = await supabase.auth.getUser()
    const [{ data: qData }, { data: eData }, { data: tData }, { data: meData }, { data: custData }] = await Promise.all([
      supabase.from('quotes')
        .select('*, engineers(name, position), quote_items(product_name, price_list(model_jp))')
        .order('quote_date', { ascending: false }).order('quote_number', { ascending: false }),
      supabase.from('engineers').select('engineer_id, name, position, teams, permission_level, resigned_date').order('engineer_id'),
      supabase.from('sales_targets').select('*'),
      supabase.from('engineers').select('*').eq('email', userData.user?.email || '').single(),
      supabase.from('customers').select('customer_id, company_name'),
    ])
    const custMap: Record<number, string> = {}
    for (const c of custData || []) custMap[c.customer_id] = c.company_name
    const merged = (qData || []).map((q: any) => ({
      ...q,
      customers: q.customer_id ? { company_name: custMap[q.customer_id] ?? null } : null,
      dealer: q.dealer_id ? { company_name: custMap[q.dealer_id] ?? null } : null,
    }))
    setQuotes(merged as Quote[])
    setEngineers(eData || [])
    setTargets(tData || [])
    setCurrentEngineer(meData || null)
    setLoading(false)
  }

  const teams = [...new Set(engineers.map(e => e.teams).filter(Boolean))].sort() as string[]
  const sortedEngineers = [...engineers].sort((a, b) => (POSITION_ORDER[a.position ?? ''] ?? 99) - (POSITION_ORDER[b.position ?? ''] ?? 99))

  // 조회 기간의 시작일(YYYY-MM-DD) — 회계연도 4월 시작 기준
  const pad = (n: number) => String(n).padStart(2, '0')
  const periodStart = (() => {
    if (mode === 'month') {
      const targetYear = month < 4 ? fy + 1 : fy
      return `${targetYear}-${pad(month)}-01`
    }
    if (mode === 'q2') return `${fy}-07-01`
    if (mode === 'q3') return `${fy}-10-01`
    if (mode === 'q4') return `${fy + 1}-01-01`
    // year, q1 → 회계연도 시작
    return `${fy}-04-01`
  })()

  // 권한별 열람 가능 엔지니어 필터 (+ 퇴사자는 조회 기간 시작일까지 재직한 경우만)
const visibleEngineers = sortedEngineers.filter(e => {
    if (['임원', '영업관리'].includes(e.teams ?? '')) return false
    if (!isActiveInPeriod(e.resigned_date, periodStart)) return false
    if (!currentEngineer) return false
    if (currentEngineer.permission_level === 'superadmin') return true
    if (currentEngineer.permission_level === 'manager') return e.teams === currentEngineer.teams
    return e.engineer_id === currentEngineer.engineer_id
  })

  const filteredEngineers = teamFilter ? visibleEngineers.filter(e => e.teams === teamFilter) : visibleEngineers
  const filteredEngineerIds = filteredEngineers.map(e => e.engineer_id)

  const matchPeriod = (dateStr: string, fiscalYear: number) => {
    const d = new Date(dateStr)
    const calYear = d.getFullYear()
    const calMonth = d.getMonth() + 1
    if (mode === 'year') return getFiscalYear(dateStr) === fiscalYear
    if (mode === 'month') {
      const targetYear = month < 4 ? fiscalYear + 1 : fiscalYear
      return calYear === targetYear && calMonth === month
    }
    if (mode === 'q1') return getFiscalYear(dateStr) === fiscalYear && calMonth >= 4 && calMonth <= 6
    if (mode === 'q2') return getFiscalYear(dateStr) === fiscalYear && calMonth >= 7 && calMonth <= 9
    if (mode === 'q3') return getFiscalYear(dateStr) === fiscalYear && calMonth >= 10 && calMonth <= 12
    if (mode === 'q4') return calMonth >= 1 && calMonth <= 3 && calYear === fiscalYear + 1
    return true
  }

  const allEngineers = sortedEngineers.filter(e => !['임원', '영업관리'].includes(e.teams ?? '') && isActiveInPeriod(e.resigned_date, periodStart))
  const allEngineerIds = allEngineers.map(e => e.engineer_id)
  const filteredQuotes = quotes.filter(q => matchPeriod(q.quote_date, fy) && (teamFilter ? filteredEngineerIds.includes(q.engineer_id) : true))
  const allFilteredQuotes = quotes.filter(q => matchPeriod(q.quote_date, fy) && allEngineerIds.includes(q.engineer_id))
  const allRevenueQuotes = allFilteredQuotes.filter(q => q.status === '매출완료')
  const totalQuoteAmt = allFilteredQuotes.reduce((s, q) => s + (q.total_supply || 0), 0)
  const totalOrderAmt = allFilteredQuotes.filter(q => ['수주', '매출완료'].includes(q.status)).reduce((s, q) => s + (q.total_supply || 0), 0)
  const totalRevenueAmt = allRevenueQuotes.reduce((s, q) => s + (q.total_supply || 0), 0)
  const totalCostAmt = allRevenueQuotes.reduce((s, q) => s + (q.total_cost || 0), 0)
  const totalProfitAmt = allRevenueQuotes.reduce((s, q) => s + (q.total_profit || 0), 0)
  const totalProfitRate = totalRevenueAmt > 0 ? (totalProfitAmt / totalRevenueAmt * 100) : null
  const totalQuoteCnt = allFilteredQuotes.length
  const totalOrderCnt = allFilteredQuotes.filter(q => ['수주', '매출완료'].includes(q.status)).length
  const convRate = totalQuoteCnt > 0 ? (totalOrderCnt / totalQuoteCnt * 100) : 0
  const allPrevQuotes = quotes.filter(q => matchPeriod(q.quote_date, fy - 1) && allEngineerIds.includes(q.engineer_id))
  const prevRevenue = allPrevQuotes.filter(q => q.status === '매출완료').reduce((s, q) => s + (q.total_supply || 0), 0)
  const yoyChange = prevRevenue > 0 ? ((totalRevenueAmt - prevRevenue) / prevRevenue * 100) : null
  const totalYearTarget = allEngineers.reduce((s, e) => {
    const t = targets.find(t => t.engineer_id === e.engineer_id && t.year === fy && t.quarter === null)
    return s + (t?.target_amount || 0)
  }, 0)
  const totalTargetAmt = mode === 'year' ? totalYearTarget : mode === 'month' ? Math.round(totalYearTarget / 12) : Math.round(totalYearTarget / 4)
  const totalAchieve = totalTargetAmt > 0 ? (totalRevenueAmt / totalTargetAmt * 100) : null
  const totalAchieveColor = totalAchieve === null ? GRAY : totalAchieve >= 100 ? '#16a34a' : totalAchieve >= 70 ? '#f59e0b' : '#dc2626'
  const remainingLabel = getRemainingLabel(mode, fy, month)

  const engineerStats = filteredEngineers.map(eng => {
    const myQuotes = filteredQuotes.filter(q => q.engineer_id === eng.engineer_id)
    const myRevenueQuotes = myQuotes.filter(q => q.status === '매출완료')
    const quotedAmt = myQuotes.reduce((s, q) => s + (q.total_supply || 0), 0)
    const revenueAmt = myRevenueQuotes.reduce((s, q) => s + (q.total_supply || 0), 0)
    const orderedAmt = myQuotes.filter(q => ['수주', '매출완료'].includes(q.status)).reduce((s, q) => s + (q.total_supply || 0), 0)
    const profitAmt = myRevenueQuotes.reduce((s, q) => s + (q.total_profit || 0), 0)
    const profitRate = revenueAmt > 0 ? (profitAmt / revenueAmt * 100) : null
    const quotedCnt = myQuotes.length
    const orderedCnt = myQuotes.filter(q => ['수주', '매출완료'].includes(q.status)).length
    const myTarget = targets.find(t => t.engineer_id === eng.engineer_id && t.year === fy && t.quarter === null)
    const yearTargetAmt = myTarget?.target_amount || 0
    const targetAmt = mode === 'year' ? yearTargetAmt : mode === 'month' ? Math.round(yearTargetAmt / 12) : Math.round(yearTargetAmt / 4)
    const achieve = targetAmt > 0 ? (revenueAmt / targetAmt * 100) : null
    return { ...eng, quotedAmt, orderedAmt, revenueAmt, profitAmt, profitRate, quotedCnt, orderedCnt, targetAmt, achieve }
  })

  const rankedByRevenue = [...engineerStats].sort((a, b) => b.revenueAmt - a.revenueAmt)
  const revenueRankMap = new Map(
    rankedByRevenue.filter(e => e.revenueAmt > 0).map((e, i) => [e.engineer_id, i])
  )

  const handleStatusSave = async (q: Quote, status: string, orderDate: string, revenueDate: string, failReason: string) => {
    await supabase.from('quotes').update({ status, order_date: orderDate || null, revenue_date: revenueDate || null, fail_reason: failReason || null }).eq('quote_id', q.quote_id)
    await fetchAll()
  }

  const inp: React.CSSProperties = { padding: '6px 10px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff', boxSizing: 'border-box' }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', fontSize: 16, color: GRAY }}>불러오는 중...</div>
  )

  return (
    <div style={{ background: PAGE_BG, minHeight: '100vh', padding: '24px 28px' }}>
      
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>

        {/* 필터 */}
        <div style={{ background: CARD_BG, borderRadius: 14, padding: '12px 16px', marginBottom: 20, border: `1px solid ${BORDER}` }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={fy} onChange={e => setFy(Number(e.target.value))} style={{ ...inp, width: 100, fontWeight: 700 }}>
              {[currentFY + 1, currentFY, currentFY - 1].map(y => <option key={y} value={y}>FY{y}</option>)}
            </select>
            <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 1 }}>
              {(['year', 'q1', 'q2', 'q3', 'q4', 'month'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  style={{ padding: '5px 11px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: mode === m ? '#fff' : 'transparent', color: mode === m ? TEXT : GRAY, boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.10)' : 'none', transition: 'all 0.15s ease', whiteSpace: 'nowrap' }}>
                  {m === 'year' ? '연간' : m === 'month' ? '월별' : m.toUpperCase()}
                </button>
              ))}
            </div>
            {mode === 'month' && (
              <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ ...inp, width: 76, fontWeight: 700 }}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
              </select>
            )}
            <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>{getPeriodLabel(mode, fy, month)}</span>
            {remainingLabel && (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', background: '#fef2f2', padding: '3px 10px', borderRadius: 99, border: '1px solid #fecaca' }}>{remainingLabel}</span>
            )}
            <div style={{ flex: 1 }} />
            <div style={{ width: 1, height: 20, background: BORDER }} />
            <span style={{ fontSize: 11, color: MUTED, fontWeight: 600, letterSpacing: '0.2px' }}>팀</span>
            <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 1 }}>
              <button onClick={() => setTeamFilter(null)}
                style={{ padding: '5px 11px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: teamFilter === null ? '#fff' : 'transparent', color: teamFilter === null ? TEXT : GRAY, boxShadow: teamFilter === null ? '0 1px 3px rgba(0,0,0,0.10)' : 'none', transition: 'all 0.15s ease' }}>전체</button>
              {teams.filter(t => !['임원', '영업관리'].includes(t)).map(t => (
                <button key={t} onClick={() => setTeamFilter(teamFilter === t ? null : t)}
                  style={{ padding: '5px 11px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: teamFilter === t ? '#fff' : 'transparent', color: teamFilter === t ? getCategoryColor(TEAM_COLORS, t).text : GRAY, boxShadow: teamFilter === t ? '0 1px 3px rgba(0,0,0,0.10)' : 'none', transition: 'all 0.15s ease' }}>{t}</button>
              ))}
            </div>
          </div>
        </div>

        {/* 사업부 전체 요약 */}
        <div style={{ background: CARD_BG, borderRadius: 14, padding: '20px 22px', marginBottom: 20, border: `1px solid ${BORDER}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 3, height: 18, background: BLUE, borderRadius: 2 }} />
              <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>
                {teamFilter ? teamFilter : '계측부 전체'}
              </span>
              <span style={{ fontSize: 12, color: MUTED, fontWeight: 400 }}>{getPeriodLabel(mode, fy, month)}</span>
            </div>
            <button onClick={() => setShowChart(p => !p)}
              style={{ padding: '6px 14px', borderRadius: 9, border: `1px solid ${showChart ? '#c7d7f8' : BORDER}`, background: showChart ? '#eff4ff' : '#f8fafc', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: showChart ? BLUE : GRAY, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, transition: 'all 0.15s ease' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              실적 추이
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(138px, 1fr))', gap: 10, marginBottom: 18 }}>
            {[
              { label: '포캐스트', value: `₩${numKR(totalQuoteAmt)}`, sub: `${totalQuoteCnt}건` },
              { label: '수주액', value: `₩${numKR(totalOrderAmt)}`, sub: `${totalOrderCnt}건` },
              { label: '매출 완료액', value: `₩${numKR(totalRevenueAmt)}`, accent: true },
              { label: '원가 합계', value: totalCostAmt > 0 ? `₩${numKR(totalCostAmt)}` : '—', sub: '매출완료 기준' },
              { label: '순이익', value: totalProfitAmt > 0 ? `₩${numKR(totalProfitAmt)}` : '—', sub: totalProfitRate !== null && totalProfitAmt > 0 ? `이익률 ${totalProfitRate.toFixed(1)}%` : null, color: '#15803d' },
              { label: '수주 전환율', value: `${convRate.toFixed(1)}%`, sub: `${totalOrderCnt} / ${totalQuoteCnt}건` },
              { label: '전년 동기 대비', value: yoyChange !== null ? `${yoyChange >= 0 ? '+' : ''}${yoyChange.toFixed(1)}%` : '—', color: yoyChange !== null ? (yoyChange >= 0 ? '#15803d' : '#b91c1c') : GRAY },
              { label: '목표 달성률', value: totalAchieve !== null ? `${totalAchieve.toFixed(1)}%` : '미설정', sub: totalTargetAmt > 0 ? `목표 ₩${numKR(totalTargetAmt)}` : null, color: totalAchieveColor },
            ].map(({ label, value, sub, accent, color }: any) => (
              <div key={label} style={{ background: accent ? '#eff4ff' : '#f8fafc', borderRadius: 11, padding: '13px 15px', border: `1px solid ${accent ? '#c7d7f8' : BORDER}` }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, marginBottom: 5, letterSpacing: '0.2px' }}>{label}</div>
                <div className="num" style={{ fontSize: 16, fontWeight: 800, color: color || (accent ? BLUE : TEXT), letterSpacing: '-0.3px', lineHeight: 1 }}>{value}</div>
                {sub && <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>{sub}</div>}
              </div>
            ))}
          </div>
          {totalTargetAmt > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                <span style={{ color: MUTED, fontWeight: 500 }}>사업부 목표 달성률</span>
                <span className="num" style={{ fontWeight: 700, color: totalAchieveColor }}>₩{numKR(totalRevenueAmt)} / ₩{numKR(totalTargetAmt)} ({totalAchieve?.toFixed(1)}%)</span>
              </div>
              <AnimatedGauge pct={totalAchieve || 0} color={totalAchieveColor} height={12} delay={100} />
            </>
          )}
        </div>

        {/* 실적 추이 차트 */}
        <div style={{ overflow: 'hidden', maxHeight: showChart ? 600 : 0, transition: 'max-height 0.4s cubic-bezier(0.4,0,0.2,1)', marginBottom: showChart ? 20 : 0 }}>
          <PerformanceChart quotes={quotes} fy={fy} targets={targets} engineers={sortedEngineers} filteredEngineerIds={filteredEngineerIds} teamFilter={teamFilter} />
        </div>

        {/* 팀별 실적 — superadmin과 각팀 manager, 해당 팀원에게만 표시 */}
        {!teamFilter && teams.length > 0 && (currentEngineer?.permission_level === 'superadmin' || currentEngineer?.permission_level === 'manager') && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div style={{ width: 3, height: 16, background: BLUE, borderRadius: 2 }} />
              <span style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>팀별 실적</span>
            </div>
           <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
               {teams.filter(t => {
                if (['임원', '영업관리'].includes(t)) return false
                if (currentEngineer?.permission_level === 'manager') return t === currentEngineer.teams
                return true
              }).map(t => (
              <TeamCard key={t} teamId={t} engineers={sortedEngineers} filteredQuotes={filteredQuotes} targets={targets} mode={mode} fy={fy} onCardClick={id => setTeamFilter(id === teamFilter ? null : id)} isSelected={teamFilter === t} />
            ))}            </div>
          </div>
        )}

        {/* 개인 실적 */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ width: 3, height: 16, background: BLUE, borderRadius: 2 }} />
            <span style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>개인 실적</span>
            <span style={{ fontSize: 12, color: MUTED, fontWeight: 400 }}>({filteredEngineers.length}명) · 카드 클릭 시 견적 목록</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
            {engineerStats.map((eng, idx) => {
              const tc = getCategoryColor(TEAM_COLORS, eng.teams)
              const achieveColor = eng.achieve === null ? GRAY : eng.achieve >= 100 ? '#16a34a' : eng.achieve >= 70 ? '#f59e0b' : '#dc2626'
              const rank = revenueRankMap.get(eng.engineer_id)
              return (
                <div key={eng.engineer_id}
                  onClick={() => setSelectedEngineer(eng)}
                  style={{ background: CARD_BG, borderRadius: 14, padding: '16px 18px', border: `1px solid ${rank !== undefined && rank < 3 ? RANK_MEDAL[rank] + '50' : BORDER}`, cursor: 'pointer', transition: 'box-shadow 0.15s ease, transform 0.15s ease', position: 'relative' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.10)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = ''; (e.currentTarget as HTMLDivElement).style.transform = '' }}>

                  <button onClick={e => { e.stopPropagation(); setChartEngineer(eng) }} title="월별 실적 차트"
                    style={{ position: 'absolute', top: 14, right: 14, width: 28, height: 28, borderRadius: '50%', background: '#f8fafc', border: `1px solid ${BORDER}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: BLUE, transition: 'all 0.15s ease' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#eff4ff'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#c7d7f8' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f8fafc'; (e.currentTarget as HTMLButtonElement).style.borderColor = BORDER }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingRight: 36 }}>
                    {rank !== undefined && rank < 3 && (
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: RANK_MEDAL_BG[rank], border: `1.5px solid ${RANK_MEDAL[rank]}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 800, color: RANK_MEDAL[rank] }}>
                        {rank + 1}
                      </div>
                    )}
                    <div>
                      <span style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>{eng.name}</span>
                      <span style={{ fontSize: 12, color: GRAY, marginLeft: 6 }}>{eng.position}</span>
                    </div>
                    {eng.teams && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: tc.bg, color: tc.text }}>{eng.teams}</span>}
                    {eng.achieve !== null && <span className="num" style={{ fontSize: 13, fontWeight: 800, color: achieveColor, marginLeft: 'auto' }}>{eng.achieve.toFixed(0)}%</span>}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                    <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 10, color: MUTED, marginBottom: 2, fontWeight: 500 }}>포캐스트</div>
                      <div className="num" style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>₩{numKR(eng.quotedAmt)}</div>
                      <div style={{ fontSize: 10, color: MUTED }}>{eng.quotedCnt}건</div>
                    </div>
                    <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 10, color: MUTED, marginBottom: 2, fontWeight: 500 }}>수주</div>
                      <div className="num" style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>₩{numKR(eng.orderedAmt)}</div>
                      <div style={{ fontSize: 10, color: MUTED }}>{eng.orderedCnt}건</div>
                    </div>
                    <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 10, color: MUTED, marginBottom: 2, fontWeight: 500 }}>매출 완료</div>
                      <div className="num" style={{ fontSize: 13, fontWeight: 700, color: BLUE }}>₩{numKR(eng.revenueAmt)}</div>
                    </div>
                    <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 10, color: MUTED, marginBottom: 2, fontWeight: 500 }}>순이익</div>
                      <div className="num" style={{ fontSize: 13, fontWeight: 700, color: eng.profitAmt > 0 ? '#16a34a' : MUTED }}>{eng.profitAmt > 0 ? `₩${numKR(eng.profitAmt)}` : '-'}</div>
                      {eng.profitRate !== null && eng.profitAmt > 0 && <div className="num" style={{ fontSize: 10, color: '#16a34a', fontWeight: 700 }}>{eng.profitRate.toFixed(1)}%</div>}
                    </div>
                  </div>
                  {eng.targetAmt > 0 && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11 }}>
                        <span style={{ color: MUTED }}>목표 달성률</span>
                        <span style={{ color: achieveColor, fontWeight: 700 }}>{eng.achieve?.toFixed(0)}% · 목표 {numKR(eng.targetAmt)}</span>
                      </div>
                      <AnimatedGauge pct={eng.achieve || 0} color={achieveColor} height={7} delay={80 + idx * 40} />
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {selectedEngineer && (
        <EngineerQuoteModal
          engineer={selectedEngineer}
          quotes={filteredQuotes.filter(q => q.engineer_id === selectedEngineer.engineer_id)}
          currentEngineerId={currentEngineer?.engineer_id ?? null}
          engineers={engineers}
          onClose={() => setSelectedEngineer(null)}
          onStatusSave={async (q, status, orderDate, revenueDate, failReason) => {
            await handleStatusSave(q, status, orderDate, revenueDate, failReason)
            setSelectedEngineer((prev: any) => prev ? { ...prev } : null)
          }}
        />
      )}

      {chartEngineer && (
        <EngineerChartModal engineer={chartEngineer} quotes={quotes} targets={targets} fy={fy} onClose={() => setChartEngineer(null)} />
      )}
    </div>
  )
}
