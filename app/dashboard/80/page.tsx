'use client'

// 80 대시보드 — 장비 문제(홀딩)와 영업 진행 상황을 위아래로 나눠 본다.
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
const TOP_HOLDINGS = 5   // 홀딩 목록에 보여줄 건수
const TOP_OPPS = 5       // 영업기회 목록에 보여줄 건수
const TOP_OWNERS = 6     // 담당자별 건수에 보여줄 인원
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
    ownerCounts, oppActivities, loadOppActivities, loading, reload,
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
  // 화면에서만 갈라 쓴다 — 홀딩은 위 카드로, 정체·마감은 영업기회 카드의 지표·뱃지로.
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
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <style jsx global>{`
        /* 이번 달 — 숫자 세 개라 가로 띠로 눕힌다. 좁아지면 세로로 쌓고 구분선 방향도 바꾼다. */
        .d80-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .d80-strip > div + div { border-left: 1px solid #ebebeb; }
        @media (max-width: 899px) {
          .d80-strip { grid-template-columns: minmax(0, 1fr); }
          .d80-strip > div + div { border-left: none; border-top: 1px solid #ebebeb; }
        }
      `}</style>

      <div style={{ maxWidth: MAX_WIDTH, margin: '0 auto' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#111827', margin: '0 0 16px', letterSpacing: '-0.3px' }}>
          80 대시보드
        </h1>

        {/* ── 이번 달 — 가로 띠 ── */}
        <div style={{ ...cardStyle, padding: 0, marginBottom: 12 }}>
          {loading ? (
            <Empty text="불러오는 중..." />
          ) : (
            <div className="d80-strip">
              {[
                { label: '견적', value: `${numKR(thisMonth.quoteCount)}건`, now: thisMonth.quoteCount, before: lastMonth.quoteCount, suffix: '건' },
                { label: '수주', value: `${numKR(thisMonth.wonCount)}건`, now: thisMonth.wonCount, before: lastMonth.wonCount, suffix: '건' },
                { label: '매출', value: thisMonth.revenue > 0 ? compactKRW(thisMonth.revenue) : '₩0', now: thisMonth.revenue, before: lastMonth.revenue, suffix: '원' },
              ].map(m => (
                <div key={m.label} style={{ padding: '14px 16px' }}>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>이번 달 {m.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginTop: 4, letterSpacing: '-0.5px' }}>{m.value}</div>
                  <div style={{ marginTop: 2 }}>
                    <Delta now={m.now} before={m.before} suffix={m.suffix} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 홀딩 중인 건 ── */}
        <div style={{ ...cardStyle, marginBottom: 12 }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '0 -8px' }}>
              {holdingItems.slice(0, TOP_HOLDINGS).map(u => (
                <button key={u.key}
                  onClick={() => u.holding && holding.openHolding(u.holding)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    padding: '7px 8px', background: 'none', border: 'none', borderRadius: 6,
                    cursor: 'pointer', transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#fafafa' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                >
                  <HoldIcon />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180, flexShrink: 0 }}>
                    {u.company}
                  </span>
                  <span style={{ fontSize: 12, color: '#234ea2', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
                    {u.title}
                  </span>
                  <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.owner}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', flexShrink: 0, whiteSpace: 'nowrap', minWidth: 72, textAlign: 'right' }}>
                    {u.status}
                  </span>
                </button>
              ))}
              {holdingItems.length > TOP_HOLDINGS && (
                <div style={{ padding: '6px 8px', fontSize: 11, color: '#9ca3af' }}>
                  외 {holdingItems.length - TOP_HOLDINGS}건
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 영업기회 ── */}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {stageCounts.map((s, i) => (
                  <span key={s.stage} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {i > 0 && <span style={{ color: '#d1d5db' }}>·</span>}
                    <span style={{ fontSize: 13, color: '#111827' }}>
                      {s.stage} <span style={{ fontWeight: 700 }}>{s.count}</span>
                    </span>
                  </span>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: '#234ea2', whiteSpace: 'nowrap' }}>
                  {oppTotal > 0 ? compactKRW(oppTotal) : '-'}
                </span>
              </div>

              {/* 마감이 임박한 순 상위 5건 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '10px -8px 0', paddingTop: 10, borderTop: '1px solid #ebebeb' }}>
                {oppRows.slice(0, TOP_OPPS).map(o => {
                  const flagged = staleIds.has(o.opportunity_id) || dueIds.has(o.opportunity_id)
                  return (
                    <button key={o.opportunity_id}
                      onClick={() => openOpportunity(o)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                        padding: '7px 8px', background: 'none', border: 'none', borderRadius: 6,
                        cursor: 'pointer', transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#fafafa' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180, flexShrink: 0 }}>
                        {o.customers?.company_name ?? '-'}
                      </span>
                      <span style={{ fontSize: 12, color: '#234ea2', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
                        {o.title}
                      </span>
                      {flagged && <Count>{statusOf.get(o.opportunity_id)}</Count>}
                      <span style={{ fontSize: 12, color: '#6b7280', flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {o.stage}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#111827', flexShrink: 0, whiteSpace: 'nowrap', minWidth: 64, textAlign: 'right' }}>
                        {o.expected_amount ? compactKRW(o.expected_amount) : '-'}
                      </span>
                      <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap', minWidth: 82, textAlign: 'right' }}>
                        {o.expected_close ?? '마감일 없음'}
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

              {/* 담당자별 — 건수만. 금액은 실적 현황에서 본다. */}
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #ebebeb' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {ownerCounts.slice(0, TOP_OWNERS).map(o => (
                    <span key={o.name} style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
                      {o.name} <span style={{ fontWeight: 700, color: '#111827' }}>{o.count}건</span>
                    </span>
                  ))}
                  {ownerCounts.length > TOP_OWNERS && (
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>외 {ownerCounts.length - TOP_OWNERS}명</span>
                  )}
                </div>
              </div>
            </>
          )}
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
