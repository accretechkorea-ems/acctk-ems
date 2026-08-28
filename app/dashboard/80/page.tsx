'use client'

// 80 대시보드 — "지금 챙겨야 할 것"을 전면에 두고, 그 아래에 영업기회 상황과 이번 달 성적을 둔다.
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
import { useDashboard80, buildUrgentItems, type UrgentItem, type UrgentKind } from '@/hooks/dashboard/useDashboard80'
import { STAGES, compactKRW } from '@/components/customer/opportunity'
import { numKR } from '@/components/customer/constants'

const PAGE_BG = '#f4f5f7'
const TOP_URGENT = 5     // 목록에 보여줄 상위 건수
const TOP_OWNERS = 6     // 담당자별 건수에 보여줄 인원
const BOARD_STAGES = STAGES.filter(s => s !== '실주')

const cardStyle: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8,
  padding: '14px 16px', display: 'flex', flexDirection: 'column',
}

// 종류 아이콘 — 이모지 대신 lucide 스타일 선 아이콘. 색은 중립 하나로 두고 모양으로만 구분한다.
function KindIcon({ kind }: { kind: UrgentKind }) {
  const common = {
    width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none',
    stroke: '#9ca3af', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    style: { flexShrink: 0 },
  }
  if (kind === '홀딩') return <svg {...common}><circle cx="12" cy="12" r="10" /><line x1="10" y1="9" x2="10" y2="15" /><line x1="14" y1="9" x2="14" y2="15" /></svg>
  if (kind === '정체') return <svg {...common}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
  return <svg {...common}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
}

function CardHead({ title, right, onMore }: { title: string; right?: React.ReactNode; onMore?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
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

  const openOpportunity = (item: UrgentItem) => {
    if (!item.opportunity) return
    setOppCustomerName(item.opportunity.customers?.company_name ?? null)
    loadOppActivities(item.opportunity.opportunity_id)
    opp.openEditOpp(item.opportunity)
  }

  const urgent = useMemo(
    () => buildUrgentItems({ holdings, opportunities, lastActivityByOpp }),
    [holdings, opportunities, lastActivityByOpp]
  )
  const urgentCounts = useMemo(() => ({
    '홀딩': urgent.filter(u => u.kind === '홀딩').length,
    '정체': urgent.filter(u => u.kind === '정체').length,
    '마감': urgent.filter(u => u.kind === '마감').length,
  }), [urgent])

  const stageCounts = useMemo(
    () => BOARD_STAGES.map(s => ({ stage: s, count: opportunities.filter(o => o.stage === s).length })),
    [opportunities]
  )
  const oppTotal = useMemo(
    () => opportunities.reduce((s, o) => s + (o.expected_amount ?? 0), 0),
    [opportunities]
  )

  const busy = loading || holdingLoading

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <style jsx global>{`
        .d80-row { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 12px; align-items: start; }
        @media (max-width: 900px) {
          .d80-row { grid-template-columns: minmax(0, 1fr); }
        }
      `}</style>

      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#111827', margin: 0, letterSpacing: '-0.3px' }}>80 대시보드</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
            전체 기준으로, 지금 챙겨야 할 것과 이번 달 상황을 모아 봅니다.
          </p>
        </div>

        {/* ── 지금 챙길 것 ── */}
        <div style={{ ...cardStyle, marginBottom: 12 }}>
          <CardHead
            title="지금 챙길 것"
            right={
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px' }}>
                {urgent.length}건
              </span>
            }
          />

          {/* 종류별 요약 — 숫자마다 갈 곳이 달라 각각 링크로 둔다 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingBottom: 10, borderBottom: '1px solid #ebebeb' }}>
            {([
              { kind: '홀딩' as const, label: '홀딩', to: '/holdings' },
              { kind: '정체' as const, label: '정체 기회', to: '/pipeline' },
              { kind: '마감' as const, label: '마감 임박', to: '/pipeline' },
            ]).map((s, i) => (
              <span key={s.kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {i > 0 && <span style={{ color: '#d1d5db' }}>·</span>}
                <button onClick={() => router.push(s.to)}
                  onMouseEnter={e => { e.currentTarget.style.color = '#234ea2' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#111827' }}
                  style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#111827', transition: 'color 0.15s ease' }}>
                  {s.label} <span style={{ fontWeight: 700 }}>{urgentCounts[s.kind]}</span>
                </button>
              </span>
            ))}
          </div>

          {busy ? (
            <Empty text="불러오는 중..." />
          ) : urgent.length === 0 ? (
            <Empty text="지금 챙길 것이 없습니다" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '4px -8px 0' }}>
              {urgent.slice(0, TOP_URGENT).map(u => (
                <button key={u.key}
                  onClick={() => (u.holding ? holding.openHolding(u.holding) : openOpportunity(u))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    padding: '7px 8px', background: 'none', border: 'none', borderRadius: 6,
                    cursor: 'pointer', transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#fafafa' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                >
                  <KindIcon kind={u.kind} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150, flexShrink: 0 }}>
                    {u.company}
                  </span>
                  <span style={{ fontSize: 12, color: '#234ea2', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
                    {u.title}
                  </span>
                  <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.owner}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', flexShrink: 0, whiteSpace: 'nowrap', minWidth: 88, textAlign: 'right' }}>
                    {u.status}
                  </span>
                </button>
              ))}
              {urgent.length > TOP_URGENT && (
                <div style={{ padding: '6px 8px', fontSize: 11, color: '#9ca3af' }}>
                  외 {urgent.length - TOP_URGENT}건
                </div>
              )}
            </div>
          )}
        </div>

        <div className="d80-row">
          {/* ── 영업기회 ── */}
          <div style={cardStyle}>
            <CardHead title="영업기회" onMore={() => router.push('/pipeline')} />
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

          {/* ── 이번 달 ── */}
          <div style={cardStyle}>
            <CardHead title="이번 달" />
            {loading ? (
              <Empty text="불러오는 중..." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { label: '견적', value: `${numKR(thisMonth.quoteCount)}건`, now: thisMonth.quoteCount, before: lastMonth.quoteCount, suffix: '건' },
                  { label: '수주', value: `${numKR(thisMonth.wonCount)}건`, now: thisMonth.wonCount, before: lastMonth.wonCount, suffix: '건' },
                  { label: '매출', value: thisMonth.revenue > 0 ? compactKRW(thisMonth.revenue) : '₩0', now: thisMonth.revenue, before: lastMonth.revenue, suffix: '원' },
                ].map(m => (
                  <div key={m.label}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>{m.label}</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{m.value}</span>
                    </div>
                    <div style={{ textAlign: 'right', marginTop: 2 }}>
                      <Delta now={m.now} before={m.before} suffix={m.suffix} />
                    </div>
                  </div>
                ))}
              </div>
            )}
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
