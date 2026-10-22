'use client'

// 개인 대시보드의 작은 카드들 — 포캐스트 · 알림 · 결재 대기.
// 「내 견적」은 파일이 따로 있다(큰 모달이 붙어 있어 길다).
//
// 카드는 **자기 자료만** 본다. 숫자 규칙은 lib/homeCards.ts, 조회는 useDashboardCards 가 맡고
// 여기서는 그리기만 한다 — 그래야 한 카드가 실패해도 다른 카드가 멀쩡히 뜬다.

import { useState } from 'react'
import DashCard from './DashCard'
import EngineerStatCard, { type StatCardEngineer } from '@/components/sales/EngineerStatCard'
import EngineerChartModal from '@/components/sales/EngineerChartModal'
import { engineerStat, type StatQuote, type StatTarget } from '@/lib/salesStats'
import { stageBars, type CardOpportunity } from '@/lib/homeCards'
import type { ApprovalRow, NotificationRow, Slot } from '@/hooks/dashboard/useDashboardCards'

const TEXT = '#111827'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'
const FADE = '#d1d5db'
const BLUE = '#234ea2'

const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')
/** 금액을 줄여 쓴다 — 카드 한 줄에 들어가야 한다. */
const compact = (n: number): string => {
  if (!n) return '-'
  if (n >= 1e8) return `${(Math.round((n / 1e8) * 10) / 10)}억`
  if (n >= 1e7) return `${Math.round(n / 1e7)}천만`
  if (n >= 1e4) return `${numKR(Math.round(n / 1e4))}만`
  return numKR(n)
}

const empty = (text: string) => (
  <div style={{ fontSize: 12, color: MUTED, paddingTop: 8 }}>{text}</div>
)

// ── 내 실적 ─────────────────────────────────────────────────────────────────

/**
 * 본인 한 명분 실적 — **실적 현황의 개인 카드 그대로**다(부품을 함께 쓴다).
 * 다른 것은 누를 때뿐이다: 실적 현황은 견적 목록으로 가지만, 홈은 카드 어디를 눌러도
 * **월별 매출 그래프**가 바로 열린다(견적 목록은 옆의 「내 견적」 카드가 맡는다).
 *
 * 회계연도 전체(mode: 'year')를 본다 — 홈에서 먼저 보고 싶은 것은 올해 성적이다.
 * 기간 선택은 실적 현황에서 한다.
 */
export function MyStatCard({ engineer, quotes, targets, fy, loading, error }: {
  engineer: StatCardEngineer
  quotes: StatQuote[]
  targets: StatTarget[]
  fy: number
  loading: boolean
  error: boolean
}) {
  const [chartOpen, setChartOpen] = useState(false)
  const stat = engineerStat(quotes, targets, { engineerId: engineer.engineer_id, fy, mode: 'year', month: 1 })
  return (
    <>
      {/* 카드 어디를 눌러도 월별 그래프다. hoverLift 를 끄는 이유는 안쪽 카드가 이미 떠오르기 때문이다. */}
      <DashCard title={`내 실적 · FY${fy}`} onClick={() => setChartOpen(true)} hoverLift={false} loading={loading} error={error}>
        {/* 카드 자체가 /sales 의 그 카드다. 머리줄(이름·팀·달성률)이 겹치지 않게 여기서는
            DashCard 의 제목만 쓰고, 카드는 여백을 줄인 모양(compact)으로 넣는다. */}
        <EngineerStatCard
          engineer={engineer}
          stat={stat}
          compact
          delay={80}
          onClick={() => setChartOpen(true)}
        />
      </DashCard>
      {chartOpen && (
        <EngineerChartModal
          engineer={engineer}
          quotes={quotes}
          targets={targets}
          fy={fy}
          onClose={() => setChartOpen(false)}
        />
      )}
    </>
  )
}

// ── 포캐스트 ────────────────────────────────────────────────────────────────

/** 내 포캐스트를 단계별 가로막대 다섯 줄로. 카드를 누르면 포캐스트 화면으로 간다. */
export function ForecastCard({ slot, onOpen }: { slot: Slot<CardOpportunity[]>; onOpen: () => void }) {
  const bars = stageBars(slot.data)
  const max = Math.max(1, ...bars.map(b => b.amount))
  const total = bars.reduce((s, b) => s + b.count, 0)
  return (
    <DashCard title="포캐스트" onClick={onOpen} loading={slot.loading} error={slot.error} errorMessage={slot.message}>
      {total === 0 ? empty('진행 중인 포캐스트가 없습니다') : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bars.map(b => (
            <div key={b.stage} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ width: 52, flexShrink: 0, fontSize: 11, fontWeight: 600, color: b.count ? TEXT : FADE }}>{b.stage}</span>
              {/* 막대는 금액 비율이다. 0 원이어도 건수가 있으면 가느다란 자국을 남긴다. */}
              <span style={{ flex: 1, minWidth: 0, height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${b.amount > 0 ? Math.max(4, (b.amount / max) * 100) : (b.count ? 2 : 0)}%`, background: BLUE, borderRadius: 4 }} />
              </span>
              <span className="num" style={{ width: 34, flexShrink: 0, textAlign: 'right', fontSize: 11, fontWeight: 700, color: b.count ? TEXT : FADE }}>{b.count}건</span>
              <span className="num" style={{ width: 54, flexShrink: 0, textAlign: 'right', fontSize: 11, color: b.amount ? GRAY : FADE }}>{compact(b.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </DashCard>
  )
}

// ── 알림 ────────────────────────────────────────────────────────────────────

/**
 * 안 읽은 알림 최근 다섯. 한 줄을 누르면 그 알림이 가리키는 곳으로 가고,
 * 줄 밖(카드)을 누르면 알림 화면으로 간다. 줄은 전파를 막는다 — 두 곳으로 갈 수는 없다.
 */
export function NotificationCard({ slot, onOpenAll, onOpen }: {
  slot: Slot<NotificationRow[]>
  onOpenAll: () => void
  onOpen: (n: NotificationRow) => void
}) {
  return (
    <DashCard title="알림" onClick={onOpenAll} loading={slot.loading} error={slot.error} errorMessage={slot.message}>
      {slot.data.length === 0 ? empty('읽지 않은 알림이 없습니다') : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {slot.data.map(n => (
            <button key={n.id} type="button" onClick={e => { e.stopPropagation(); onOpen(n) }}
              style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '7px 0', background: 'none', border: 'none', borderBottom: '1px solid #ebebeb', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.title || n.message || '알림'}
              </span>
              <span style={{ flexShrink: 0, fontSize: 11, color: MUTED }}>{(n.created_at ?? '').slice(5, 10).replace('-', '.')}</span>
            </button>
          ))}
        </div>
      )}
    </DashCard>
  )
}

// ── 결재 대기 ───────────────────────────────────────────────────────────────

/**
 * 내가 결재할 문서.
 *
 * **0 건이어도 카드는 그대로 있는다.** 예전에는 부르는 쪽이 `data.length > 0` 일 때만 그려서,
 * 결재할 것이 없는 사람에게는 카드가 아예 없었다 — 그러면 「없다」와 「조회가 깨졌다」를
 * 구분할 수 없다. 못 읽었을 때는 그 이유(errorMessage)까지 카드에 적는다.
 */
export function ApprovalCard({ slot, onOpenAll, onOpen }: {
  slot: Slot<ApprovalRow[]>
  onOpenAll: () => void
  onOpen: (d: ApprovalRow) => void
}) {
  return (
    <DashCard title="결재 대기" onClick={onOpenAll} loading={slot.loading} error={slot.error} errorMessage={slot.message}>
      {slot.data.length === 0 ? empty('대기 중인 문서가 없습니다') : (
        <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 800, color: BLUE, letterSpacing: '-0.5px' }}>
          {slot.data.length}
        </span>
        <span style={{ fontSize: 12, color: GRAY }}>건이 내 차례입니다</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {slot.data.slice(0, 3).map(d => (
          <button key={d.document_id} type="button" onClick={e => { e.stopPropagation(); onOpen(d) }}
            style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', background: 'none', border: 'none', borderBottom: '1px solid #ebebeb', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
            <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: MUTED }}>{d.doc_type ?? '문서'}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.title || d.doc_no || `#${d.document_id}`}
            </span>
          </button>
        ))}
      </div>
        </>
      )}
    </DashCard>
  )
}
