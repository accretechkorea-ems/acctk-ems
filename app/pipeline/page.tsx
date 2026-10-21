'use client'

// 포캐스트(영업기회 칸반). 단계별 열로 늘어놓고 한눈에 본다.
//
// 본사 보고용 숫자(담당자 × 월 × 상태 금액)는 이 화면에서 그리지 않고 **엑셀로 내보낸다** —
// 집계 규칙은 lib/forecast.ts 한 곳에 있고, 여기서는 누를 때만 읽어(useForecast 의 enabled)
// 시트 둘로 떨어뜨린다. 칸반 자체는 그 버튼과 무관하게 종전 그대로다.
// 드래그앤드롭은 다음 단계이며, 지금은 카드의 단계 select 로 옮긴다.
// 신규 등록은 업체 상세에서만 한다(어느 업체 건인지 정해야 하므로).

// 모바일 상단 바 높이 — 화면 높이를 계산하는 곳은 이 상수 하나를 본다(PC 는 상단 바가 없다).
import { TOPBAR_HEIGHT } from '@/components/layout/Sidebar'

/**
 * 판 전체의 하한. 열에는 최소 폭을 두지 않고(남은 폭을 5등분한다) 판에만 하한을 둔다 —
 * 열마다 최소 폭을 걸면 합이 조금만 넘쳐도 가로 스크롤이 생겼다.
 *
 * 960 = 5열 × 184 + 간격 4 × 10. 184 는 카드 한 장이 찌그러지지 않는 폭이다
 * (가장 넓은 줄이 「담당자 · YYYY-MM 마감 예정 · 견적 N건」으로 11px 글자 기준 약 162px,
 *  카드 좌우 여백 12×2 를 더해 186 — 열 안쪽 여백 4×2 를 감안해 184 로 잡는다).
 *
 * 하한을 더 높이면(예: 1100) 1280 창 + 사이드바 펼침에서 스크롤이 생긴다 —
 * 그때 본문은 1280 − 232(사이드바) − 56(좌우 여백) = 992 뿐이다.
 * 이보다 좁아지면 열을 더 줄이는 대신 판을 가로로 민다.
 */
const BOARD_MIN_W = 960
import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, pointerWithin,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import SegmentedControl from '@/components/common/SegmentedControl'
import { isSuperAdmin } from '@/lib/permissions'
import OpportunityCard from '@/components/pipeline/OpportunityCard'
import OpportunityModal from '@/components/customer/modals/OpportunityModal'
import { useOpportunityCrud } from '@/hooks/customer/useOpportunityCrud'
import { useQuotePdf } from '@/hooks/customer/useQuotePdf'
import { usePipelineData } from '@/hooks/pipeline/usePipelineData'
import { useForecast } from '@/hooks/forecast/useForecast'
import Popover from '@/components/common/Popover'
import { useQuoteCategories } from '@/lib/quoteCategories'
import { todayKST } from '@/lib/date'
import { FORM_LABELS, isFormKind } from '@/lib/quoteForms'
import { bucketOf, emptyBucket, fiscalMonths, fiscalYearOfMonth, type Bucket } from '@/lib/forecast'
import { exportForecastXlsx } from '@/lib/forecastExcel'
import { STAGES, compactKRW, isClosed } from '@/components/customer/opportunity'
import type { SalesOpportunity } from '@/components/customer/types'

// 실주는 열로 두지 않고 판 아래에 접어둔다 (평소엔 시야에서 빼고, 필요할 때만 펼쳐 본다)
const BOARD_STAGES = STAGES.filter(s => s !== '실주')

type Owner = '내 포캐스트' | '전체'

/** 내보내기 팝오버의 선택칸 — 화면 다른 곳의 입력칸과 같은 모양이다. */
const popSel: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid #ebebeb', borderRadius: 6,
  background: '#fff', color: '#111827', fontSize: 12, fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer', outline: 'none', width: '100%', boxSizing: 'border-box',
}

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
        // padding 을 음수 margin 으로 되돌리던 것을 없앴다 — 그 4px 이 판 오른쪽을 넘겨
        // 1900 창에서도 가로 스크롤바를 만들고 있었다(카드가 8px 좁아지는 대신 스크롤이 사라진다).
        borderRadius: 8, padding: 4,
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
  const { loading: guardLoading, authorized } = usePageGuard()
  const data = usePipelineData()
  const { opportunities, activities, engineers, customers, loading, me, lastActivityByOpp, reload } = data

  const opp = useOpportunityCrud({ customerId: null, engineerId: me.engineer_id, role: me.role, fetchDetail: reload })
  // 연결된 견적 PDF 열기. 업체명은 견적별로 달라 로그에는 남기지 않는다.
  const quotePdf = useQuotePdf({ customer: null, engineerId: me.engineer_id })

  // 처음에는 회사 전체 기회를 보여준다. '내 기회'는 사용자가 직접 고른다.
  const [owner, setOwner] = useState<Owner>('전체')
  const [search, setSearch] = useState('')
  const [showLost, setShowLost] = useState(false)

  // 드래그 상태. 5px 이상 움직여야 끌기로 보므로 카드 클릭·select 조작과 겹치지 않는다.
  // ── 엑셀 내보내기 ──
  // 팝오버를 열 때 비로소 자료를 읽는다(enabled). 칸반만 볼 사람에게는 조회가 늘지 않는다.
  const exportRef = useRef<HTMLButtonElement | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const today = todayKST()
  const thisFY = fiscalYearOfMonth(today.slice(0, 7))
  const [xFy, setXFy] = useState(thisFY)
  const [xTeam, setXTeam] = useState('')
  const [xEng, setXEng] = useState<number | null>(null)
  const fc = useForecast(today, exportOpen)
  const { categories } = useQuoteCategories()

  const [activeId, setActiveId] = useState<number | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return opportunities.filter(o => {
      if (owner === '내 포캐스트' && o.engineer_id !== me.engineer_id) return false
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
        // 이 기회로 견적을 쓰러 간다 — 견적 화면이 ?opportunity= 를 읽어 고객·기회를 미리 고른다.
        onWriteQuote={() => { window.location.href = `/quote?opportunity=${o.opportunity_id}` }}
      />
    </DraggableCard>
  )

  // 내보낼 사람 — 팀·담당자를 고르면 좁힌다(아무것도 안 고르면 전체).
  const exportEngineerIds = useMemo(() => {
    const list = xTeam ? engineers.filter(e => (e.teams ?? '') === xTeam) : engineers
    const ids = list.map(e => e.engineer_id)
    return xEng == null ? ids : ids.filter(id => id === xEng)
  }, [engineers, xTeam, xEng])

  const teamNames = useMemo(
    () => [...new Set(engineers.map(e => e.teams).filter((t): t is string => !!t))].sort(),
    [engineers],
  )

  const runExport = async () => {
    const months = fiscalMonths(xFy)
    const monthSet = new Set(months)
    const idSet = new Set(exportEngineerIds)
    const rows = fc.result.rows
      .filter(r => monthSet.has(r.month) && r.engineerId != null && idSet.has(r.engineerId))
      .sort((a, b) => (a.month === b.month ? b.amount - a.amount : (a.month < b.month ? -1 : 1)))

    const byMonth = new Map<string, Bucket>(months.map(m => [m, emptyBucket()]))
    for (const r of rows) {
      const b = byMonth.get(r.month)
      if (b) b[bucketOf(r.status)] += r.amount
    }
    for (const m of months) {
      const b = byMonth.get(m)
      if (b) b.목표 = fc.targetOf(m, exportEngineerIds)
    }

    const engName = new Map(engineers.map(e => [e.engineer_id, `${e.name} ${e.position ?? ''}`.trim()]))
    await exportForecastXlsx({
      months: months.map(m => ({ month: m, bucket: byMonth.get(m) ?? emptyBucket() })),
      rows,
      engineerName: id => (id == null ? '' : engName.get(id) ?? `#${id}`),
      customerName: id => (id == null ? '' : fc.customerNames.get(id) ?? `#${id}`),
      categoryLabel: code => (code ? categories.find(c => c.code === code)?.label ?? code : '-'),
      formLabel: code => (isFormKind(code) ? FORM_LABELS[code] : '-'),
      titleOf: r => (r.source === 'quote'
        ? (r.no ?? `#${r.id}`)
        : (opportunities.find(o => o.opportunity_id === r.id)?.title ?? `#${r.id}`)),
      label: `FY${xFy}${xTeam ? `_${xTeam}` : ''}${xEng != null ? `_${engName.get(xEng) ?? xEng}` : ''}`,
    })
    setExportOpen(false)
  }

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
    <main className="pl-page" style={{
      padding: '24px 28px', background: PAGE_BG,
      boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column',
    }}>
      <style jsx global>{`
        /* PC 는 상단 바가 없어 화면 높이를 그대로 쓴다. 모바일만 상단 바만큼 뺀다. */
        .pl-page { min-height: 100vh; }
        @media (max-width: 768px) { .pl-page { min-height: calc(100vh - ${TOPBAR_HEIGHT}px); } }
        /* 카드의 단계 select·종료 버튼은 호버 때만 띄운다.
           hover 를 지원하지 않는 기기(터치)에서는 이 미디어 쿼리가 걸리지 않아 항상 보인다.
           visibility 로만 토글해 자리를 유지하므로 카드 높이는 호버 전후가 같다. */
        @media (hover: hover) {
          .pl-card .pl-card-action { visibility: hidden; }
          .pl-card:hover .pl-card-action { visibility: visible; }
        }
      `}</style>

      <div style={{ maxWidth: 1600, width: '100%', margin: '0 auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>

        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#111827', letterSpacing: '-0.3px', margin: '0 0 12px' }}>
          포캐스트
        </h1>

        {/* 필터 — 소유자 · 검색 · 등록/내보내기 버튼을 한 줄에 둔다 */}
        <div style={{ background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8, padding: '14px 16px', marginBottom: 12, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* 두 항목 폭을 같게(equal) 두고, 폭은 긴 쪽인 '내 기회' 기준으로 잡는다 */}
            <div style={{ flexShrink: 0 }}>
              <SegmentedControl
                options={['내 포캐스트', '전체']}
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
            <button ref={exportRef} onClick={() => setExportOpen(v => !v)}
              onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
              style={{ marginLeft: 'auto', padding: '8px 14px', background: '#fff', color: '#234ea2', border: '1px solid #ebebeb', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, transition: 'background 0.15s ease' }}>
              엑셀 내보내기
            </button>
            <button onClick={opp.openNewOpp}
              onMouseEnter={e => { e.currentTarget.style.background = '#1c3e87' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#234ea2' }}
              style={{ padding: '8px 16px', background: '#234ea2', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, transition: 'background 0.15s ease' }}>
              + 포캐스트
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
            {/* 칸반 — 열 5개가 남은 폭을 언제나 5등분한다(minmax(0, 1fr) 이라 내용이 열을 밀지 못한다).
                판은 화면에 남은 세로 공간을 전부 차지하고(flex: 1), 그걸 넘칠 때만
                카드가 많은 열이 안에서 세로로 흐른다. 고정 높이를 쓰면 아래가 비었는데도
                일찍 잘려 스크롤이 생기므로 px 계산을 하지 않는다.
                (열 머리의 건수·합계는 늘 보이고, 열끼리 높이도 어긋나지 않는다)

                바깥 칸이 스크롤을 맡고 안쪽 판에만 하한(BOARD_MIN_W)을 둔다 — 본문이 그보다
                넓으면 판이 본문 폭에 딱 맞아 가로 스크롤이 아예 생기지 않고, 좁아지면 이 칸에서만
                가로로 밀린다(페이지 전체가 밀리지 않는다). */}
            <div style={{
              flex: 1, minHeight: 420, minWidth: 0,
              display: 'flex', overflowX: 'auto',
            }}>
              <div style={{
                display: 'grid', gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
                gap: 10, alignItems: 'stretch',
                flex: 1, minWidth: BOARD_MIN_W,
              }}>
                {columns.map(col => (
                  <div key={col.stage} style={{
                    minWidth: 0, minHeight: 0,
                    display: 'flex', flexDirection: 'column',
                  }}>
                    <div style={{ padding: '0 2px 8px', flexShrink: 0 }}>
                      {/* 단계·건수·금액을 한 줄에 둔다 — 열이 좁아 두 줄을 쓰면 판이 그만큼 낮아진다 */}
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap' }}>{col.stage}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px', flexShrink: 0 }}>{col.rows.length}</span>
                        {col.sum > 0 && (
                          <>
                            <span style={{ fontSize: 11, color: '#d1d5db', flexShrink: 0 }}>·</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {compactKRW(col.sum)}
                            </span>
                          </>
                        )}
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
                조건에 맞는 포캐스트가 없습니다
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

      {/* 내보내기 — 회계연도·팀·담당자만 고른다. 칸반의 필터(내 기회·검색)와는 **따로다**
          (보고용 숫자는 화면에 보이는 카드가 아니라 집계 규칙이 정한 줄에서 나온다). */}
      <Popover anchorRef={exportRef} open={exportOpen} onClose={() => setExportOpen(false)} align="end" width={260}
        style={{ background: '#fff', border: '1px solid #ebebeb', borderRadius: 8, boxShadow: '0 16px 40px rgba(0,0,0,0.18)', padding: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#111827', letterSpacing: '-0.3px' }}>엑셀 내보내기</span>
          <span style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
            월별 요약과 안건 목록을 시트 두 장으로 내려받습니다.
          </span>
          <select value={xFy} onChange={e => setXFy(Number(e.target.value))} aria-label="회계연도" style={popSel}>
            {[thisFY + 1, thisFY, thisFY - 1, thisFY - 2].map(y => (
              <option key={y} value={y}>FY{y} ({y}.04 ~ {y + 1}.03)</option>
            ))}
          </select>
          <select value={xTeam} onChange={e => { setXTeam(e.target.value); setXEng(null) }} aria-label="팀" style={popSel}>
            <option value="">전체 팀</option>
            {teamNames.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={xEng ?? ''} onChange={e => setXEng(e.target.value ? Number(e.target.value) : null)} aria-label="담당자" style={popSel}>
            <option value="">전체 담당자</option>
            {(xTeam ? engineers.filter(e => (e.teams ?? '') === xTeam) : engineers).map(e => (
              <option key={e.engineer_id} value={e.engineer_id}>{`${e.name} ${e.position ?? ''}`.trim()}</option>
            ))}
          </select>
          <button type="button" onClick={() => void runExport()} disabled={fc.loading}
            style={{
              marginTop: 2, padding: '8px 14px', borderRadius: 6, border: 'none', cursor: fc.loading ? 'default' : 'pointer',
              background: fc.loading ? '#f3f4f6' : '#234ea2', color: fc.loading ? '#9ca3af' : '#fff',
              fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
            }}>
            {fc.loading ? '자료 읽는 중...' : '내려받기'}
          </button>
        </div>
      </Popover>

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
