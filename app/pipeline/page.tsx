'use client'

// 영업기회 파이프라인(칸반). 단계별 열로 늘어놓고 한눈에 본다.
// 드래그앤드롭은 다음 단계이며, 지금은 카드의 단계 select 로 옮긴다.
// 신규 등록은 업체 상세에서만 한다(어느 업체 건인지 정해야 하므로).

import { useMemo, useState, type ReactNode } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, pointerWithin,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import SegmentedControl from '@/components/common/SegmentedControl'
import { canViewPipeline, isSuperAdmin } from '@/lib/permissions'
import OpportunityCard from '@/components/pipeline/OpportunityCard'
import OpportunityModal from '@/components/customer/modals/OpportunityModal'
import { useOpportunityCrud } from '@/hooks/customer/useOpportunityCrud'
import { useQuotePdf } from '@/hooks/customer/useQuotePdf'
import { usePipelineData } from '@/hooks/pipeline/usePipelineData'
import { STAGES, compactKRW, isClosed } from '@/components/customer/opportunity'
import type { SalesOpportunity } from '@/components/customer/types'

// 실주는 열로 두지 않고 판 아래에 접어둔다 (평소엔 시야에서 빼고, 필요할 때만 펼쳐 본다)
const BOARD_STAGES = STAGES.filter(s => s !== '실주')

type Owner = '내 기회' | '전체'

const PAGE_BG = '#f4f5f7'

// 열 안 정렬 — 마감이 임박한 것부터. 마감일 없는 건은 맨 아래.
// 같은 날짜(또는 둘 다 마감일 없음)면 등록 순(오래된 것 먼저)으로 고정해 순서가 흔들리지 않게 한다.
// 기간 필터를 두지 않으므로(종료된 건은 판에서 빠지고, 마감일 없는 건이 통째로 사라지면 안 되므로)
// 정렬이 곧 우선순위 표시다.
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

// 카드 하나를 끌 수 있게 감싼다. 권한이 없으면 disabled 라 아예 잡히지 않는다.
function DraggableCard({ id, disabled, children }: { id: number; disabled: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        // 끄는 동안 원래 자리는 흐리게 남겨둔다(어디서 왔는지 보이도록)
        opacity: isDragging ? 0.4 : 1,
        cursor: disabled ? 'default' : 'grab',
        touchAction: 'manipulation',
        outline: 'none',
        // 열이 세로 스크롤이라 카드가 눌려 찌그러지지 않게 고정
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  )
}

// 열 하나 = 놓을 수 있는 자리. id 가 곧 단계 이름이다.
// 카드 목록 아래 빈 공간까지 이 요소 안이라, 열 어디에 놓아도 같은 단계로 떨어진다.
// 열 안 순서는 의미가 없어 카드 사이를 따로 나누지 않는다(열 전체가 하나의 드롭 지점).
function DroppableColumn({ stage, isOver, children }: { stage: string; isOver: boolean; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: stage })
  return (
    <div
      ref={setNodeRef}
      style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 8,
        borderRadius: 8, padding: 4, margin: '0 -4px',
        // 놓을 열 강조 — 새 색 없이 기존 중립 배경과 hover 테두리만 쓴다
        background: isOver ? '#f3f4f6' : 'transparent',
        outline: isOver ? '1px dashed #c7d7f8' : '1px dashed transparent',
        transition: 'background 0.15s ease',
      }}
    >
      {children}
    </div>
  )
}

export default function PipelinePage() {
  const { loading: guardLoading, authorized } = usePageGuard(canViewPipeline)
  const data = usePipelineData()
  const { opportunities, activities, engineers, customers, loading, me, lastActivityByOpp, reload } = data

  const opp = useOpportunityCrud({ customerId: null, engineerId: me.engineer_id, role: me.role, fetchDetail: reload })
  // 연결된 견적 PDF 열기. 업체명은 견적별로 달라 로그에는 남기지 않는다.
  const quotePdf = useQuotePdf({ customer: null, engineerId: me.engineer_id })

  const [owner, setOwner] = useState<Owner>('내 기회')
  const [search, setSearch] = useState('')
  const [showLost, setShowLost] = useState(false)

  // 드래그 상태. 5px 이상 움직여야 끌기로 보므로 카드 클릭·select 조작과 겹치지 않는다.
  const [activeId, setActiveId] = useState<number | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return opportunities.filter(o => {
      if (owner === '내 기회' && o.engineer_id !== me.engineer_id) return false
      if (!q) return true
      return o.title.toLowerCase().includes(q)
        || (o.customers?.company_name ?? '').toLowerCase().includes(q)
    })
  }, [opportunities, owner, search, me.engineer_id])

  // 낙관적 업데이트 — 저장이 끝나기 전에 화면에서 먼저 옮긴다.
  // 실패하면 이 값만 지우면 원래 단계로 되돌아간다(서버 데이터는 그대로이므로).
  const [pendingStage, setPendingStage] = useState<Map<number, string>>(new Map())
  const stageOf = (o: SalesOpportunity) => pendingStage.get(o.opportunity_id) ?? o.stage

  const columns = useMemo(
    () => BOARD_STAGES.map(stage => {
      const rows = filtered
        .filter(o => !isClosed(o) && (pendingStage.get(o.opportunity_id) ?? o.stage) === stage)
        .sort(byDueDate)
      return { stage, rows, sum: rows.reduce((s, o) => s + (o.expected_amount ?? 0), 0) }
    }),
    [filtered, pendingStage]
  )
  // 끝난 건 = 실주 + 매출 확정 등으로 종료된 것. 판에서 빼고 아래에 접어둔다.
  const done = useMemo(() => filtered.filter(o => isClosed(o)), [filtered])

  const moveTo = async (o: SalesOpportunity, next: string) => {
    if (next === stageOf(o)) return
    setPendingStage(m => new Map(m).set(o.opportunity_id, next))
    const ok = await opp.changeStage(o, next)
    // 성공이면 reload 된 데이터에 반영돼 있고, 실패면 되돌아간다. 어느 쪽이든 임시값은 지운다.
    if (!ok) console.error('[pipeline] stage move reverted', o.opportunity_id, next)
    setPendingStage(m => { const n = new Map(m); n.delete(o.opportunity_id); return n })
  }

  const cardOf = (o: SalesOpportunity) => (
    <DraggableCard key={o.opportunity_id} id={o.opportunity_id} disabled={!opp.canEditOpp(o) || isClosed(o)}>
      <OpportunityCard
        opp={o}
        lastActivity={lastActivityByOpp.get(o.opportunity_id) ?? null}
        canEdit={opp.canEditOpp(o)}
        onOpen={() => opp.openEditOpp(o)}
        onChangeStage={next => moveTo(o, next)}
        onPickLost={() => opp.openEditOpp(o)}
        onClose={!isClosed(o) && o.stage === '수주' ? () => opp.setClosed(o, true) : undefined}
      />
    </DraggableCard>
  )

  const activeOpp = activeId === null ? null : filtered.find(o => o.opportunity_id === activeId) ?? null

  const handleDragStart = (e: DragStartEvent) => setActiveId(Number(e.active.id))

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    setOverStage(null)
    const target = e.over?.id
    if (typeof target !== 'string') return           // 열 밖에 놓으면 아무 일도 없다
    const dragged = opportunities.find(o => o.opportunity_id === e.active.id)
    if (!dragged) return
    moveTo(dragged, target)                          // 같은 열이면 moveTo 가 걸러낸다
  }

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    // 판 높이를 px 로 계산하지 않고 남는 공간을 그대로 채우게 한다
    // (헤더 45px = minHeight 44 + 아래 테두리 1. 이것 말고 고정값을 쓰지 않는다).
    // main → 안쪽 래퍼 → 판까지 flex 열로 이어져야 판이 정확히 남은 만큼만 차지한다.
    <main style={{
      padding: '24px 28px', background: PAGE_BG,
      minHeight: 'calc(100vh - 45px)', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column',
    }}>
      <style jsx global>{`
        /* 카드의 단계 select·종료 버튼은 호버 때만 띄운다.
           hover 를 지원하지 않는 기기(터치)에서는 이 미디어 쿼리가 걸리지 않아 항상 보인다.
           visibility 로만 토글해 자리를 유지하므로 카드 높이는 호버 전후가 같다. */
        @media (hover: hover) {
          .pl-card .pl-card-action { visibility: hidden; }
          .pl-card:hover .pl-card-action { visibility: visible; }
        }
      `}</style>

      <div style={{ maxWidth: 1600, width: '100%', margin: '0 auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>

        {/* 필터 — 소유자 · 검색 · 등록 버튼을 한 줄에 둔다(제목 없이 바로 판으로 이어진다) */}
        <div style={{ background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8, padding: '14px 16px', marginBottom: 12, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* 두 항목 폭을 같게(equal) 두고, 폭은 긴 쪽인 '내 기회' 기준으로 잡는다 */}
            <div style={{ flexShrink: 0 }}>
              <SegmentedControl
                options={['내 기회', '전체']}
                value={owner}
                onChange={v => setOwner(v as Owner)}
                equal
                minItemWidth={64}
                height={34}
              />
            </div>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="업체명 / 제목 검색"
              style={{
                width: 220, padding: '8px 11px', border: '1px solid #ebebeb',
                borderRadius: 6, background: '#fff', color: '#111827', fontSize: 13,
                outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
            <button onClick={opp.openNewOpp}
              onMouseEnter={e => { e.currentTarget.style.background = '#1c3e87' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#234ea2' }}
              style={{ marginLeft: 'auto', padding: '8px 16px', background: '#234ea2', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, transition: 'background 0.15s ease' }}>
              + 영업기회
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ background: '#fff', border: '1px solid #ebebeb', borderRadius: 8, padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
            불러오는 중...
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragOver={e => setOverStage(typeof e.over?.id === 'string' ? e.over.id : null)}
            onDragEnd={handleDragEnd}
            onDragCancel={() => { setActiveId(null); setOverStage(null) }}
          >
            {/* 칸반 — 가로 스크롤 없이 열 5개가 화면 폭을 항상 나눠 갖는다.
                판은 화면에 남은 세로 공간을 전부 차지하고(flex: 1), 그걸 넘칠 때만
                카드가 많은 열이 안에서 세로로 흐른다. 고정 높이를 쓰면 아래가 비었는데도
                일찍 잘려 스크롤이 생기므로 px 계산을 하지 않는다.
                (열 머리의 건수·합계는 늘 보이고, 열끼리 높이도 어긋나지 않는다) */}
            <div style={{
              display: 'flex', gap: 10, alignItems: 'stretch',
              flex: 1, minHeight: 420,
            }}>
              {columns.map(col => (
                <div key={col.stage} style={{
                  flex: '1 1 0', minWidth: 0, minHeight: 0,
                  display: 'flex', flexDirection: 'column',
                }}>
                  <div style={{ padding: '0 2px 8px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap' }}>{col.stage}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px' }}>{col.rows.length}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginTop: 3, whiteSpace: 'nowrap' }}>
                      {col.sum > 0 ? compactKRW(col.sum) : '-'}
                    </div>
                  </div>
                  <DroppableColumn stage={col.stage} isOver={overStage === col.stage}>
                    {col.rows.length === 0
                      ? <div style={{ border: '1px dashed #ebebeb', borderRadius: 8, padding: '18px 0', textAlign: 'center', fontSize: 12, color: '#d1d5db', flexShrink: 0 }}>
                          {overStage === col.stage ? '여기에 놓기' : '없음'}
                        </div>
                      : col.rows.map(cardOf)}
                  </DroppableColumn>
                </div>
              ))}
            </div>

            {/* 끝난 건(실주 · 종료) — 판 아래에 함께 접어둔다.
                판이 남은 높이를 다 쓰므로 이 블록만큼은 화면을 넘겨 페이지가 스크롤된다(펼쳤을 때). */}
            {done.length > 0 && (
              <div style={{ marginTop: 16, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <button onClick={() => setShowLost(v => !v)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#6b7280' }}>끝난 건</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px' }}>{done.length}건</span>
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>
                      실주 {done.filter(o => o.stage === '실주').length} · 종료 {done.filter(o => o.stage !== '실주').length}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#234ea2' }}>{showLost ? '접기' : '펼치기'}</span>
                  </button>
                  <span style={{ flex: 1, height: 1, background: '#ebebeb' }} />
                </div>
                {showLost && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
                    {done.map(cardOf)}
                  </div>
                )}
              </div>
            )}

            {filtered.length === 0 && (
              <div style={{ marginTop: 12, background: '#fff', border: '1px solid #ebebeb', borderRadius: 8, padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                조건에 맞는 영업기회가 없습니다
              </div>
            )}

            {/* 끌고 다니는 동안 커서를 따라다니는 미리보기 */}
            <DragOverlay dropAnimation={null}>
              {activeOpp && (
                <div style={{ width: 260, cursor: 'grabbing', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', borderRadius: 8 }}>
                  <OpportunityCard
                    opp={activeOpp}
                    lastActivity={lastActivityByOpp.get(activeOpp.opportunity_id) ?? null}
                    canEdit={false}
                    onOpen={() => {}}
                    onChangeStage={() => {}}
                    onPickLost={() => {}}
                  />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <OpportunityModal
        isOpen={opp.isOppModalOpen}
        opportunity={opp.editingOpp}
        activities={activities}
        customers={customers}
        lockedCustomerName={null}
        engineers={engineers}
        isSaving={opp.isSavingOpp}
        canEdit={!opp.editingOpp || opp.canEditOpp(opp.editingOpp)}
        currentUserEngineerId={me.engineer_id}
        canPickEngineer={isSuperAdmin({ permission_level: me.role })}
        onClose={opp.closeOppModal}
        onSave={opp.handleSaveOpp}
        onDelete={opp.handleDeleteOpp}
        onOpenQuotePdf={quotePdf.openQuotePdfByUrl}
        onSetClosed={opp.setClosed}
      />
    </main>
  )
}
