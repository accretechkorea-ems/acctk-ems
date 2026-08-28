'use client'

// 홀딩 현황 — 전체 업체의 미해결 이슈를 한자리에서 본다.
// 상세·해제 모달은 업체 상세와 같은 것을 재사용한다.
// (등록은 장비를 골라야 하므로 여기서 하지 않고 업체 상세에서만 한다)

import { useMemo, useState } from 'react'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { canViewCustomers } from '@/lib/permissions'
import HoldingModal from '@/components/customer/modals/HoldingModal'
import HoldingResolveModal from '@/components/customer/modals/HoldingResolveModal'
import { useHoldingCrud } from '@/hooks/customer/useHoldingCrud'
import { useHoldingList } from '@/hooks/holding/useHoldingList'
import { deviceLabel, elapsedDays, elapsedLabel } from '@/components/customer/holding'
import type { Holding } from '@/components/customer/types'

const PAGE_BG = '#f4f5f7'
const STALE_DAYS = 30

const TABS = ['진행 중', '해제됨', '전체'] as const
type Tab = typeof TABS[number]

const fmtDate = (s: string) => s.slice(0, 10)

// 가장 최근 메모 한 건
function latestNote(h: Holding) {
  const notes = h.holding_notes ?? []
  if (notes.length === 0) return null
  return notes.reduce((a, b) => (a.created_at > b.created_at ? a : b))
}

function HoldingCard({ h, onOpen, onResolve }: { h: Holding; onOpen: () => void; onResolve: () => void }) {
  const note = latestNote(h)
  const stale = !h.resolved_at && elapsedDays(h) >= STALE_DAYS

  return (
    <div
      style={{ background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8, padding: '12px 14px', transition: 'border-color 0.15s ease' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#c7d7f8' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#ebebeb' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <button onClick={onOpen}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, textAlign: 'left', padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
            {h.customers?.company_name ?? '-'}
          </span>
          <span style={{ fontSize: 12, color: '#234ea2', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {deviceLabel(h)}
          </span>
        </button>
        {stale && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }} title={`시작 ${h.started_at}`}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af' }}>30일 초과</span>
          </span>
        )}
        <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {elapsedLabel(h)}
        </span>
      </div>

      <button onClick={onOpen}
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: 0, marginTop: 5, background: 'none', border: 'none', cursor: 'pointer' }}>
        <div style={{ fontSize: 13, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {h.title}
        </div>
        {note && (
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            최근 메모: {note.content}
            <span style={{ color: '#9ca3af' }}> ({fmtDate(note.created_at)})</span>
          </div>
        )}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {h.engineers?.name ?? '-'}
          <span style={{ color: '#d1d5db' }}> · </span>
          시작 {h.started_at}
          {h.resolved_at && (
            <>
              <span style={{ color: '#d1d5db' }}> · </span>
              해제 {h.resolved_at}
            </>
          )}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0 }}>
          {!h.resolved_at && (
            <button onClick={onResolve}
              style={{ padding: '4px 10px', background: '#fff', color: '#6b7280', border: '1px solid #ebebeb', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
              해제
            </button>
          )}
          <button onClick={onOpen}
            style={{ padding: '4px 10px', background: '#f3f4f6', color: '#6b7280', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
            상세
          </button>
        </div>
      </div>
    </div>
  )
}

export default function HoldingsPage() {
  const { engineer: me, loading: guardLoading, authorized } = usePageGuard(canViewCustomers)
  const { holdings, loading, engineerId, reload } = useHoldingList()
  // 등록은 이 화면에서 하지 않으므로 customerId 는 null
  const holding = useHoldingCrud({ customerId: null, holdings, engineerId, fetchDetail: reload, role: me?.permission_level ?? null })

  const [tab, setTab] = useState<Tab>('진행 중')
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matched = holdings.filter(h => {
      if (tab === '진행 중' && h.resolved_at) return false
      if (tab === '해제됨' && !h.resolved_at) return false
      if (!q) return true
      return (h.customers?.company_name ?? '').toLowerCase().includes(q)
        || deviceLabel(h).toLowerCase().includes(q)
        || h.title.toLowerCase().includes(q)
    })
    // 진행 중은 오래된 것이 위로, 해제된 것은 최근 해제가 위로
    return matched.sort((a, b) => {
      if (!a.resolved_at && !b.resolved_at) return elapsedDays(b) - elapsedDays(a)
      if (!a.resolved_at) return -1
      if (!b.resolved_at) return 1
      return a.resolved_at < b.resolved_at ? 1 : -1
    })
  }, [holdings, tab, search])

  const openCount = holdings.filter(h => !h.resolved_at).length

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#111827', margin: 0, letterSpacing: '-0.3px' }}>홀딩 현황</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
            현장에서 바로 해결되지 않은 건을 모아 봅니다. 새 홀딩은 업체 상세의 장비 카드에서 겁니다.
          </p>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{
                  padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                  background: tab === t ? '#234ea2' : '#f3f4f6', color: tab === t ? '#ffffff' : '#9ca3af',
                }}>
                {t}
              </button>
            ))}
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="업체 / 장비 / 제목 검색"
              style={{
                flex: 1, minWidth: 180, padding: '8px 11px', border: '1px solid #ebebeb',
                borderRadius: 6, background: '#fff', color: '#111827', fontSize: 13,
                outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ background: '#fff', border: '1px solid #ebebeb', borderRadius: 8, padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
            불러오는 중...
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{tab}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px' }}>{rows.length}건</span>
              {tab !== '진행 중' && openCount > 0 && (
                <span style={{ fontSize: 11, color: '#9ca3af' }}>진행 중 {openCount}건</span>
              )}
            </div>

            {rows.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #ebebeb', borderRadius: 8, padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                조건에 맞는 홀딩이 없습니다
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows.map(h => (
                  <HoldingCard key={h.holding_id} h={h}
                    onOpen={() => holding.openHolding(h)}
                    onResolve={() => holding.openResolve(h)} />
                ))}
              </div>
            )}
          </>
        )}
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
    </main>
  )
}
