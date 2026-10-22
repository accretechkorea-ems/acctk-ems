'use client'

// 담당자 한 명의 **FY 월별 매출 현황** 그래프 모달.
//
// 실적 현황(app/sales/page.tsx)에 인라인으로 있던 것을 **그대로** 옮겼다 — 모양·동작·색·문구를
// 한 글자도 바꾸지 않았다. 개인 대시보드의 「내 실적」 카드가 같은 모달을 열기 때문이다.
// (실적 현황은 개인 카드의 막대 아이콘으로, 홈은 카드 아무 데나 눌러서 연다.)

import { useEffect, useState } from 'react'
import { TEAM_COLORS, getCategoryColor } from '@/lib/categoryColors'
import { REVENUE_STATUS } from '@/lib/quoteStatus'
import { nowKSTParts } from '@/lib/date'
import { getFYMonths, type StatQuote, type StatTarget } from '@/lib/salesStats'
import { Z } from '@/lib/zIndex'

const BLUE = '#234ea2'
const CARD_BG = '#ffffff'
const BORDER = '#ebebeb'
const TEXT = '#111113'
const GRAY = '#6b7280'
const ORANGE = '#d97706'

const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')
const numM = (n: number) => {
  if (n === 0) return '₩0'
  if (n >= 100000000) return `₩${(n / 100000000).toFixed(1)}억`
  if (n >= 10000000) return `₩${(n / 10000000).toFixed(0)}천만`
  if (n >= 1000000) return `₩${(n / 1000000).toFixed(0)}백만`
  return `₩${Math.round(n / 10000)}만`
}
// 달성률 색 — 달성 여부만 구분(100%+ 초록 / 미만 검정).
const achieveColorOf = (v: number | null): string => v === null ? GRAY : v >= 100 ? '#16a34a' : '#111827'

/** 막대가 아래에서 자라 오른다. 실적 현황의 것 그대로. */
function BarAnimate({ height, color, width = 36 }: { height: number; color: string; width?: number }) {
  const [h, setH] = useState(0)
  useEffect(() => { const t = setTimeout(() => setH(height), 100); return () => clearTimeout(t) }, [height])
  return (
    <div style={{ width, height: h, background: color, borderRadius: '4px 4px 0 0', position: 'absolute', bottom: 0, transition: 'height 0.8s cubic-bezier(0.4,0,0.2,1)' }} />
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
  const { y: nowYear, m: nowMonth } = nowKSTParts()
  const BAR_H = 140

  const myTarget = targets.find(t => t.engineer_id === engineer.engineer_id && t.year === fy && t.quarter === null)
  const yearTarget = myTarget?.target_amount || 0
  const monthTarget = Math.round(yearTarget / 12)

  const monthData = getFYMonths(fy).map(({ label, month, year }) => {
    const mQ = quotes.filter(q => {
      if (q.engineer_id !== engineer.engineer_id) return false
      if (q.status !== REVENUE_STATUS || !q.tax_invoice_completed_at) return false
      // 매출은 세금계산서 발행이 끝난 달에 잡는다.
      const d = new Date(q.tax_invoice_completed_at)
      return d.getFullYear() === year && d.getMonth() + 1 === month
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
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
              const achieveColor = achieveColorOf(d.achieve)
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
              const boxes: { label: string; value: string; color?: string }[] = [
                { label: '연간 누적 매출', value: `₩${numKR(totalRev)}` },
                { label: '연간 누적 순이익', value: totalProfit > 0 ? `₩${numKR(totalProfit)}` : '-', color: '#16a34a' },
                { label: '매출 발생 월수', value: `${achievedMonths}개월` },
                { label: '목표 달성 월수', value: monthTarget > 0 ? `${overTargetMonths}개월` : '-', color: '#16a34a' },
              ]
              return boxes.map(({ label, value, color }) => (
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
