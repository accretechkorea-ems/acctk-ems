'use client'

// 80 대시보드 — 이번 달 성적(띠) · 이번 달 활동 · 영업기회 / 홀딩·만료 임박 견적.
// 이 화면은 전체 기준이다(본인 것은 개인 페이지에서 본다).
// 상세·조작은 각 화면에서 하고, 여기서는 보여주고 넘겨주는 역할만 한다.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { canViewDashboard } from '@/lib/permissions'
import HoldingModal from '@/components/customer/modals/HoldingModal'
import HoldingResolveModal from '@/components/customer/modals/HoldingResolveModal'
import OpportunityModal from '@/components/customer/modals/OpportunityModal'
import { useHoldingCrud } from '@/hooks/customer/useHoldingCrud'
import { useHoldingList } from '@/hooks/holding/useHoldingList'
import { useOpportunityCrud } from '@/hooks/customer/useOpportunityCrud'
import { useDashboard80, buildUrgentItems } from '@/hooks/dashboard/useDashboard80'
import { STAGES, compactKRW } from '@/components/customer/opportunity'
import { numKR } from '@/components/customer/constants'
import type { SalesOpportunity } from '@/components/customer/types'

const PAGE_BG = '#f4f5f7'
// 고객사 상세의 가운데 열과 같은 상한. 넓은 화면에서 한 줄이 끝없이 길어지지 않게 한다.
const MAX_WIDTH = 1600
const TOP_HOLDINGS = 6   // 홀딩 격자 3열 × 2행
const TOP_UPCOMING = 6   // 다가오는 일정 격자 — 홀딩과 같은 3열 × 2행
/**
 * 격자에 깔 칸 수. 3건 이하면 한 줄(3칸)만 깔아 아래 한 줄이 통째로 비지 않게 한다.
 * 4건부터는 종전대로 두 줄(6칸). 모자란 자리는 그대로 점선 칸으로 채워 격자 모양을 지킨다.
 * 행 높이가 고정(72px)이라 칸 수가 줄면 카드 높이도 그만큼 줄어든다.
 */
const gridSlots = (count: number, max: number) => (count <= 3 ? 3 : max)
// 목록은 건수가 모자라도 이만큼의 줄 자리를 늘 차지한다(카드 높이를 고정하기 위해).
const TOP_OPPS = 10
const TOP_EXPIRING = 7
const ROW_H = 31         // 목록 한 줄 높이(빈 줄도 같은 높이로 채운다)
const DANGER = '#ef4444' // 기존 상태 표시에서 쓰던 빨강
const BOARD_STAGES = STAGES.filter(s => s !== '실주')

const cardStyle: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8,
  padding: '14px 16px', display: 'flex', flexDirection: 'column',
}

// 마감이 임박한 순. 마감일이 없는 건은 맨 뒤로 보내고, 같으면 등록 순으로 고정한다.
// (파이프라인 칸반의 열 안 정렬과 같은 규칙 — 두 화면의 순서가 어긋나지 않게)
function byDueDate(a: SalesOpportunity, b: SalesOpportunity): number {
  const ac = a.expected_close, bc = b.expected_close
  if (ac !== bc) {
    if (!ac) return 1
    if (!bc) return -1
    return ac < bc ? -1 : 1
  }
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.opportunity_id - b.opportunity_id
}

// 홀딩 아이콘(일시정지) — 이모지 대신 lucide 스타일 선 아이콘
function HoldIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" /><line x1="10" y1="9" x2="10" y2="15" /><line x1="14" y1="9" x2="14" y2="15" />
    </svg>
  )
}

// 달력 아이콘 — 활동 현황 헤더에서 쓰는 것과 같은 path. 홀딩의 HoldIcon 자리에 들어간다.
function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function CardHead({ title, right, onMore }: { title: string; right?: React.ReactNode; onMore?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{title}</span>
      {right}
      {onMore && (
        <button onClick={onMore}
          style={{ marginLeft: 'auto', padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#234ea2', whiteSpace: 'nowrap' }}>
          전체 보기 →
        </button>
      )}
    </div>
  )
}

function Count({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>{text}</div>
  )
}

// 목록 한 줄 — 배경 호버만 있는 버튼. 세 카드가 같은 모양을 쓴다.
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
  padding: '7px 8px', background: 'none', border: 'none', borderRadius: 6,
  cursor: 'pointer', transition: 'background 0.15s ease',
}
const rowHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = '#fafafa' },
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'none' },
}


// 전월 대비 증감. 같으면 아무것도 내지 않는다.
function Delta({ now, before, suffix }: { now: number; before: number; suffix: string }) {
  const diff = now - before
  if (diff === 0) return <span style={{ fontSize: 11, color: '#9ca3af' }}>전월과 같음</span>
  const sign = diff > 0 ? '▲' : '▼'
  const label = suffix === '원' ? compactKRW(Math.abs(diff)) : `${numKR(Math.abs(diff))}${suffix}`
  return <span style={{ fontSize: 11, color: '#9ca3af' }}>전월 대비 {sign} {label}</span>
}

export default function Dashboard80Page() {
  const { engineer: me, loading: guardLoading, authorized } = usePageGuard(canViewDashboard)
  const router = useRouter()

  const { holdings, loading: holdingLoading, engineerId, reload: reloadHoldings } = useHoldingList()
  const holding = useHoldingCrud({ customerId: null, holdings, engineerId, fetchDetail: reloadHoldings, role: me?.permission_level ?? null })
  const {
    thisMonth, lastMonth, opportunities, lastActivityByOpp,
    oppActivities, loadOppActivities, loading, reload,
    salesActivity, serviceActivity, expiringQuotes, upcomingVisits,
    // ownerCounts(담당자별 집계)는 훅에 그대로 두되 화면에서는 쓰지 않는다.
    // 담당자를 각 줄에 붙이면서 카드 아래 집계 줄이 필요 없어졌다.
  } = useDashboard80()

  // 기회 수정은 담당 영업 본인 또는 superadmin. 신규 등록은 업체를 골라야 하므로 여기서 하지 않는다.
  const opp = useOpportunityCrud({
    customerId: null, engineerId: me?.engineer_id ?? null, role: me?.permission_level ?? null,
    fetchDetail: reload,
  })
  const [oppCustomerName, setOppCustomerName] = useState<string | null>(null)

  // 파이프라인에는 기회 한 건으로 바로 들어가는 주소가 없다.
  // 대신 이 화면이 이미 갖고 있는 영업기회 모달을 그 자리에서 연다.
  const openOpportunity = (o: SalesOpportunity) => {
    setOppCustomerName(o.customers?.company_name ?? null)
    loadOppActivities(o.opportunity_id)
    opp.openEditOpp(o)
  }

  // 홀딩·정체·마감 판정은 종전과 같은 함수(buildUrgentItems)로 한 번에 계산하고,
  // 화면에서만 갈라 쓴다 — 홀딩은 홀딩 카드로, 정체·마감은 영업기회 카드의 지표·뱃지로.
  const urgent = useMemo(
    () => buildUrgentItems({ holdings, opportunities, lastActivityByOpp }),
    [holdings, opportunities, lastActivityByOpp]
  )
  const holdingItems = useMemo(() => urgent.filter(u => u.kind === '홀딩'), [urgent])
  const staleIds = useMemo(
    () => new Set(urgent.filter(u => u.kind === '정체').map(u => u.opportunity?.opportunity_id)),
    [urgent]
  )
  const dueIds = useMemo(
    () => new Set(urgent.filter(u => u.kind === '마감').map(u => u.opportunity?.opportunity_id)),
    [urgent]
  )
  // 뱃지 문구('32일 무활동' / '마감 3일 남음')도 같은 계산 결과에서 가져온다.
  // 한 기회가 정체·마감 둘 다면 급한 쪽이 남는다 — urgent 는 이미 급한 순으로 정렬돼 있다.
  const statusOf = useMemo(() => {
    const m = new Map<number, string>()
    for (const u of urgent) {
      if (!u.opportunity) continue
      if (!m.has(u.opportunity.opportunity_id)) m.set(u.opportunity.opportunity_id, u.status)
    }
    return m
  }, [urgent])

  const stageCounts = useMemo(
    () => BOARD_STAGES.map(s => ({ stage: s, count: opportunities.filter(o => o.stage === s).length })),
    [opportunities]
  )
  const oppTotal = useMemo(
    () => opportunities.reduce((s, o) => s + (o.expected_amount ?? 0), 0),
    [opportunities]
  )
  const oppRows = useMemo(() => [...opportunities].sort(byDueDate), [opportunities])

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <main style={{ padding: '16px 28px 24px', background: PAGE_BG, minHeight: '100vh' }}>
      <style jsx global>{`
        /* 이번 달 — 성적 3칸 + 활동 2칸을 한 띠에 눕힌다. 다섯 칸을 같은 폭으로 나눈다.
           (좁아지면 세로로 쌓고 구분선 방향도 바꾼다) */
        .d80-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); }
        .d80-strip > div + div { border-left: 1px solid #ebebeb; }

        /* 본문 — 왼쪽(영업기회)이 한 줄에 담는 정보가 많아 6:4 로 넓게 쓴다.
           3열로 나누면 업체명·건명이 잘려 읽을 수 없다.
           align-items: stretch(기본값) 라서 두 열은 같은 높이가 되고, 아래 .d80-fill 이
           남는 높이를 흡수해 좌우 카드의 바닥이 맞는다. */
        .d80-main { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 4fr); gap: 12px; }
        .d80-side { display: flex; flex-direction: column; gap: 12px; }
        /* 오른쪽 열의 마지막 카드 — 남는 높이를 채운다 */
        .d80-fill { flex: 1; }
        /* 홀딩 — 한 건에 담기는 정보가 적어 세로 목록으로 두면 오른쪽이 빈다. 3열 격자로 눕힌다.
           행 높이를 내용에 맡기면 채워진 행과 빈 행의 높이가 달라지므로 고정한다
           (세 줄: 13 + 12 + 11px + 줄 간격 + 안쪽 여백 ≈ 69px 이라 여유를 둬 72px). */
        .d80-hold { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: 72px; gap: 8px; }
        .d80-hold > * { min-width: 0; box-sizing: border-box; }
        /* 모바일 — 전부 한 칸씩 세로로 쌓는다 */
        @media (max-width: 899px) {
          .d80-strip { grid-template-columns: minmax(0, 1fr); }
          .d80-strip > div + div { border-left: none; border-top: 1px solid #ebebeb; }
          .d80-main { grid-template-columns: minmax(0, 1fr); }
        }
      `}</style>

      <div style={{ maxWidth: MAX_WIDTH, margin: '0 auto' }}>

        {/* ── 이번 달 — 성적 3칸 + 활동 2칸 ──
            활동은 총 건수만 둔다. 유형별 내역은 활동 현황 화면에 이미 있다. */}
        <div style={{ ...cardStyle, padding: 0, marginBottom: 12 }}>
          {loading ? (
            <Empty text="불러오는 중..." />
          ) : (
            <div className="d80-strip">
              {[
                { label: '이번 달 견적', value: `${numKR(thisMonth.quoteCount)}건`, sub: <Delta now={thisMonth.quoteCount} before={lastMonth.quoteCount} suffix="건" /> },
                { label: '이번 달 수주', value: `${numKR(thisMonth.wonCount)}건`, sub: <Delta now={thisMonth.wonCount} before={lastMonth.wonCount} suffix="건" /> },
                { label: '이번 달 매출', value: thisMonth.revenue > 0 ? compactKRW(thisMonth.revenue) : '₩0', sub: <Delta now={thisMonth.revenue} before={lastMonth.revenue} suffix="원" /> },
                { label: '영업 활동', value: `${numKR(salesActivity.total)}건`, sub: null },
                { label: 'C/S 활동', value: `${numKR(serviceActivity.total)}건`, sub: null },
              ].map(m => (
                <div key={m.label} style={{ padding: '14px 16px' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>{m.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginTop: 4, letterSpacing: '-0.5px', whiteSpace: 'nowrap' }}>{m.value}</div>
                  {/* 보조 줄 — 넣을 것이 없어도 자리를 비워 다섯 칸의 높이를 맞춘다 */}
                  <div style={{ marginTop: 2, fontSize: 11, color: '#9ca3af' }}>{m.sub ?? '\u00a0'}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="d80-main">

          {/* ── 왼쪽: 영업기회 ── */}
          <div style={cardStyle}>
            <CardHead
              title="영업기회"
              right={
                <>
                  <Count>{opportunities.length}건</Count>
                  {staleIds.size > 0 && <span style={{ fontSize: 11, color: '#9ca3af' }}>정체 {staleIds.size}</span>}
                  {dueIds.size > 0 && <span style={{ fontSize: 11, color: '#9ca3af' }}>마감 임박 {dueIds.size}</span>}
                </>
              }
              onMore={() => router.push('/pipeline')}
            />
            {loading ? (
              <Empty text="불러오는 중..." />
            ) : opportunities.length === 0 ? (
              <Empty text="진행 중인 영업기회가 없습니다" />
            ) : (
              <>
                {/* 단계별 분포 — 가운뎃점으로 이어 한 문장처럼 읽히게 한다.
                    폭을 균등 분배하면 필터 버튼처럼 보여서 왼쪽 정렬로 둔다. 합계만 오른쪽 끝. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
                    {stageCounts.map((s, i) => (
                      <span key={s.stage} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {i > 0 && <span style={{ color: '#d1d5db' }}>·</span>}
                        <span style={{ fontSize: 13, color: '#111827', whiteSpace: 'nowrap' }}>
                          {s.stage} <span style={{ fontWeight: 700 }}>{s.count}</span>
                        </span>
                      </span>
                    ))}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#234ea2', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {oppTotal > 0 ? compactKRW(oppTotal) : '-'}
                  </span>
                </div>

                {/* 마감이 임박한 순. 건수가 모자라도 TOP_OPPS 줄만큼 자리를 차지해 카드 높이가 고정된다. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '10px -8px 0', paddingTop: 10, borderTop: '1px solid #ebebeb' }}>
                  {Array.from({ length: TOP_OPPS }).map((_, i) => {
                    const o = oppRows[i]
                    if (!o) return <div key={`opp-empty-${i}`} style={{ height: ROW_H }} />
                    const flagged = staleIds.has(o.opportunity_id) || dueIds.has(o.opportunity_id)
                    return (
                      <button key={o.opportunity_id} onClick={() => openOpportunity(o)} style={rowStyle} {...rowHover}>
                        {/* 업체명·건명이 남는 폭을 나눠 갖는다(고정 폭을 주면 오른쪽이 비어도 잘린다).
                            둘 다 줄어들 수 있고, 정말 넘칠 때만 말줄임된다. */}
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                          {o.customers?.company_name ?? '-'}
                        </span>
                        <span style={{ fontSize: 12, color: '#234ea2', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
                          {o.title}
                        </span>
                        {flagged && <Count>{statusOf.get(o.opportunity_id)}</Count>}
                        {/* 담당자 — 단계 앞에 흐린 글씨로. 카드 아래 집계 줄을 대신한다 */}
                        <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap', maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {o.engineers?.name ?? '-'}
                        </span>
                        <span style={{ fontSize: 12, color: '#6b7280', flexShrink: 0, whiteSpace: 'nowrap' }}>
                          {o.stage}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#111827', flexShrink: 0, whiteSpace: 'nowrap', minWidth: 64, textAlign: 'right' }}>
                          {o.expected_amount ? compactKRW(o.expected_amount) : '-'}
                        </span>
                        {/* 마감은 월 단위로 잡으므로 연월까지만 보여준다 */}
                        <span style={{
                          fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap', minWidth: 76, textAlign: 'right',
                          color: o.expected_close ? DANGER : '#9ca3af',
                          fontWeight: o.expected_close ? 700 : 400,
                        }}>
                          {o.expected_close ? o.expected_close.slice(0, 7) : '마감일 없음'}
                        </span>
                      </button>
                    )
                  })}
                  {oppRows.length > TOP_OPPS && (
                    <div style={{ padding: '6px 8px', fontSize: 11, color: '#9ca3af' }}>
                      외 {oppRows.length - TOP_OPPS}건
                    </div>
                  )}
                </div>

              </>
            )}
          </div>

          {/* ── 오른쪽: 홀딩 · 만료 임박 견적 ── */}
          <div className="d80-side">

            <div style={cardStyle}>
              <CardHead
                title="홀딩 중인 건"
                right={<Count>{holdingItems.length}건</Count>}
                onMore={() => router.push('/holdings')}
              />
              {holdingLoading ? (
                <Empty text="불러오는 중..." />
              ) : holdingItems.length === 0 ? (
                <Empty text="홀딩 중인 건이 없습니다" />
              ) : (
                // 3칸 또는 6칸 격자. 건수가 모자라면 빈 칸을 점선으로 채워 격자 모양을 유지한다.
                // 전체 건수는 헤더 뱃지에 있으므로 여기서는 "외 N건" 을 두지 않는다.
                <div className="d80-hold">
                  {Array.from({ length: gridSlots(holdingItems.length, TOP_HOLDINGS) }).map((_, i) => {
                    const u = holdingItems[i]
                    if (!u) {
                      return <div key={`empty-${i}`} style={{ border: '1px dashed #ebebeb', borderRadius: 6 }} />
                    }
                    return (
                      <button key={u.key}
                        onClick={() => u.holding && holding.openHolding(u.holding)}
                        style={{
                          display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, overflow: 'hidden',
                          textAlign: 'left', padding: '8px 10px', background: '#ffffff',
                          border: '1px solid #ebebeb', borderRadius: 6, cursor: 'pointer',
                          transition: 'border-color 0.15s ease',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = '#c7d7f8' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = '#ebebeb' }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                          <HoldIcon />
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                            {u.company}
                          </span>
                        </span>
                        <span style={{ fontSize: 12, color: '#234ea2', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {u.title}
                        </span>
                        <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {u.owner}
                          <span style={{ color: '#d1d5db' }}> · </span>
                          <span style={{ color: '#6b7280', fontWeight: 700 }}>{u.status}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── 다가오는 일정 — 아직 오지 않은 방문 예정. 홀딩 카드와 같은 3열 × 2행 격자를 쓴다.
                모아 볼 화면이 따로 없어 "전체 보기" 는 두지 않고 헤더 건수만 낸다. ── */}
            <div style={cardStyle}>
              <CardHead title="다가오는 일정" right={<Count>{upcomingVisits.length}건</Count>} />
              {loading ? (
                <Empty text="불러오는 중..." />
              ) : upcomingVisits.length === 0 ? (
                <Empty text="예정된 일정이 없습니다" />
              ) : (
                // 홀딩과 같은 규칙 — 3건 이하면 한 줄, 모자란 자리는 점선 칸.
                <div className="d80-hold">
                  {Array.from({ length: gridSlots(upcomingVisits.length, TOP_UPCOMING) }).map((_, i) => {
                    const v = upcomingVisits[i]
                    if (!v) {
                      return <div key={`up-empty-${i}`} style={{ border: '1px dashed #ebebeb', borderRadius: 6 }} />
                    }
                    return (
                      <div key={v.serviceId}
                        style={{
                          display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, overflow: 'hidden',
                          textAlign: 'left', padding: '8px 10px', background: '#ffffff',
                          border: '1px solid #ebebeb', borderRadius: 6,
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                          <CalendarIcon />
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                            {v.company}
                          </span>
                        </span>
                        <span style={{ fontSize: 12, color: '#234ea2', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {v.device}
                        </span>
                        {/* 칸이 좁아 세 조각이 다 들어가지 않을 때가 있다(폭 123px, 긴 조합은 158px 필요).
                            한 줄로 두면 맨 뒤의 D-N 부터 잘려서, 정작 급한 정보가 먼저 사라진다.
                            유형과 D-N 은 폭을 지키게 하고 담당자만 줄여 ... 로 접는다. */}
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#9ca3af', minWidth: 0 }}>
                          <span style={{ color: '#6b7280', fontWeight: 700, flexShrink: 0 }}>{v.serviceType}</span>
                          <span style={{ color: '#d1d5db', flexShrink: 0 }}>·</span>
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.owner}</span>
                          <span style={{ color: '#d1d5db', flexShrink: 0 }}>·</span>
                          <span style={{ flexShrink: 0 }}>D-{v.daysLeft}</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 만료 임박 견적 — 견적서의 "작성일로부터 1개월" 유효기간 기준.
                남는 높이를 이 카드가 흡수해 왼쪽 영업기회 카드와 바닥을 맞춘다. */}
            <div className="d80-fill" style={cardStyle}>
              <CardHead title="마감 임박 견적" right={<Count>{expiringQuotes.length}건</Count>} />
              {loading ? (
                <Empty text="불러오는 중..." />
              ) : expiringQuotes.length === 0 ? (
                <Empty text="해당 없음" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '0 -8px' }}>
                  {Array.from({ length: TOP_EXPIRING }).map((_, i) => {
                    const q = expiringQuotes[i]
                    if (!q) return <div key={`exp-empty-${i}`} style={{ height: ROW_H }} />
                    const over = q.daysLeft < 0
                    return (
                      <div key={q.quoteId} style={{ ...rowStyle, cursor: 'default' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                          {q.companyName}
                        </span>
                        <span style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
                          {q.quoteNumber}
                        </span>
                        {/* 며칠까지인지 날짜로도 보여준다 — D-day 만으로는 언제까지인지 알 수 없다 */}
                        <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap' }}>
                          {q.expiry}
                        </span>
                        {/* 유효기간은 지나면 다시 뽑아야 하므로 여유가 있어도 눈에 띄게 둔다 */}
                        <span
                          style={{
                            fontSize: 12, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap',
                            color: DANGER,
                          }}
                        >
                          {over ? '만료' : q.daysLeft === 0 ? '오늘 만료' : `D-${q.daysLeft}`}
                        </span>
                      </div>
                    )
                  })}
                  {expiringQuotes.length > TOP_EXPIRING && (
                    <div style={{ padding: '6px 8px', fontSize: 11, color: '#9ca3af' }}>
                      외 {expiringQuotes.length - TOP_EXPIRING}건
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      <HoldingModal
        isOpen={holding.isHoldingModalOpen}
        holding={holding.viewingHolding}
        targetDeviceName="-"
        linkedService={null}
        isSaving={holding.isSavingHolding}
        onClose={holding.closeHoldingModal}
        onCreate={holding.handleCreateHolding}
        onUpdateHolding={holding.handleUpdateHolding}
        onAddNote={holding.handleAddNote}
        onRequestResolve={h => holding.openResolve(h)}
        reports={holding.holdingReports}
        reportsLoading={holding.reportsLoading}
        onOpenReport={holding.handleOpenReport}
        canEditNote={holding.canEditNote}
        onUpdateNote={holding.handleUpdateNote}
        onDeleteNote={holding.handleDeleteNote}
        onReopen={holding.handleReopen}
        canDelete={!!holding.viewingHolding && holding.canDeleteHolding(holding.viewingHolding)}
        onDeleteHolding={holding.handleDeleteHolding}
      />
      <HoldingResolveModal
        isOpen={!!holding.resolveTarget}
        holding={holding.resolveTarget}
        notice={holding.resolveNotice}
        isSaving={holding.isSavingHolding}
        onClose={holding.closeResolve}
        onResolve={holding.handleResolve}
      />
      {/* 담당 영업 변경은 업체 상세·파이프라인에서 한다(여기서는 직원 목록을 읽지 않는다). */}
      <OpportunityModal
        isOpen={opp.isOppModalOpen}
        opportunity={opp.editingOpp}
        activities={oppActivities}
        customers={[]}
        lockedCustomerName={oppCustomerName}
        engineers={[]}
        isSaving={opp.isSavingOpp}
        canEdit={!!opp.editingOpp && opp.canEditOpp(opp.editingOpp)}
        currentUserEngineerId={me?.engineer_id ?? null}
        canPickEngineer={false}
        onClose={opp.closeOppModal}
        onSave={opp.handleSaveOpp}
        onDelete={opp.handleDeleteOpp}
        onSetClosed={opp.setClosed}
      />
    </main>
  )
}
