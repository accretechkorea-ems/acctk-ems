'use client'

// 담당자 한 명의 **FY 월별 실적** 그래프 모달 — 실적 현황과 개인 대시보드가 같이 쓴다.
//
// 그리는 일은 전부 components/sales/salesChart.tsx 가 한다(사업부 전체 그래프와 **같은
// 조각**이다 — 패널 두 장·목표선·달성 색·보조 지표 다섯). 이 파일에 남은 것은 모달 껍데기와
// 「누구의 어느 해인가」뿐이다.
//
// 숫자는 전부 lib/salesStats.ts 가 만든다 — 그래프와 아래 요약이 같은 함수를 본다.
// 수주는 발주일, 매출은 세금계산서 완료일, 월 목표는 연간 목표 ÷ 12 다.
//
// 1366×768 에서 스크롤 없이: 머리 71 + 본문 여백 26 + 패널 220×2 + 지표 70 + 간격 10 = 617 ≤ 90vh(691).

import { TEAM_COLORS, getCategoryColor } from '@/lib/categoryColors'
import { todayKST } from '@/lib/date'
import { unitBars, yearSummary, type StatQuote, type StatTarget } from '@/lib/salesStats'
import {
  ChartLegend, ChartPanel, SummaryBoxes, axisMaxOf, numKR,
} from '@/components/sales/salesChart'
import { Z } from '@/lib/zIndex'

const CARD_BG = '#ffffff'
const BORDER = '#ebebeb'
const TEXT = '#111113'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'

export type ChartEngineer = { engineer_id: number; name: string | null; position: string | null; teams: string | null }

export default function EngineerChartModal({ engineer, quotes, targets, fy, onClose }: {
  engineer: ChartEngineer
  quotes: StatQuote[]
  targets: StatTarget[]
  fy: number
  onClose: () => void
}) {
  const today = todayKST()

  const bars = unitBars(quotes, targets, { engineerId: engineer.engineer_id, fy, unit: 'month', today })
  const sum = yearSummary(quotes, targets, { engineerId: engineer.engineer_id, fy, today })
  // Y축은 두 패널 공통이다(axisMaxOf) — 눈금이 다르면 위아래 막대를 눈으로 비교할 수 없다.
  const axisMax = axisMaxOf(bars)
  const tc = getCategoryColor(TEAM_COLORS, engineer.teams)

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
            <ChartLegend />
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>✕</button>
          </div>
        </div>

        <div style={{ padding: '12px 20px 14px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <ChartPanel kind="order" bars={bars} axisMax={axisMax} unitLabel="월 목표" />
          <ChartPanel kind="sales" bars={bars} axisMax={axisMax} unitLabel="월 목표" />
          <SummaryBoxes sum={sum} />
        </div>
      </div>
    </div>
  )
}
