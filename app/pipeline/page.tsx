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
import { R } from '@/lib/radius'
import { matchesCompany } from '@/lib/companySearch'

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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, pointerWithin,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { isSuperAdmin } from '@/lib/permissions'
import { BLUE, BLUE_HOVER, BLUE_TINT, BORDER, CARD_BG, MUTED, TEXT, cardTitle } from '@/components/common/ui'
import { TEXT_DISABLED } from '@/lib/textTokens'
import OpportunityCard from '@/components/pipeline/OpportunityCard'
import OpportunityModal from '@/components/customer/modals/OpportunityModal'
import LostModal from '@/components/forecast/LostModal'
import { useOpportunityCrud } from '@/hooks/customer/useOpportunityCrud'
import { useQuotePdf } from '@/hooks/customer/useQuotePdf'
import { usePipelineData } from '@/hooks/pipeline/usePipelineData'
import { useForecast } from '@/hooks/forecast/useForecast'
import Popover from '@/components/common/Popover'
import { useQuoteCategories } from '@/lib/quoteCategories'
import { todayKST } from '@/lib/date'
import { FORM_LABELS, isFormKind } from '@/lib/quoteForms'
import { bucketOf, emptyBucket, fiscalMonths, fiscalYearOfMonth, type Bucket } from '@/lib/forecast'
import {
  boardSummary, cardRank, idleDaysOf, inQuarter, isTaskLate, krwFull, krwShort,
  lastActivityByOpp, pickNextTask, quarterSlices,
} from '@/lib/forecastBoard'
import ExcelIconButton from '@/components/common/ExcelIconButton'
import { shortSiteName } from '@/lib/customerList'
import type { TaskRow } from '@/lib/tasks'
import { useStoredFlag } from '@/lib/storedFlag'
import { exportForecastXlsx } from '@/lib/forecastExcel'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { CUSTOMER_NAME_SELECT, customerCompanyName } from '@/lib/customerLabel'
import { quoteCustomerLabel } from '@/lib/quoteEuName'
import { exportForecastStatsXlsx, statsKindOf, type StatsRow } from '@/lib/forecastStatsExcel'
import { STAGES, isClosed } from '@/components/customer/opportunity'
import type { SalesOpportunity } from '@/components/customer/types'

// 실주는 열로 두지 않고 판 아래에 접어둔다 (평소엔 시야에서 빼고, 필요할 때만 펼쳐 본다)
const BOARD_STAGES = STAGES.filter(s => s !== '실주')

/**
 * 담당자 필터의 값. 'all' 은 전체, 숫자는 그 담당자다.
 *
 * null 은 「아직 아무것도 고르지 않았다」 — 그때는 기본값을 쓴다(본인이 목록에 있으면
 * 본인, 없으면 전체). 상태를 비워 두고 아래에서 기본값을 계산하는 이유: 목록은 자료가
 * 도착한 뒤에 정해지므로, 효과 안에서 setState 로 채우면 한 번 그린 뒤 다시 그린다.
 */
type OwnerPick = number | 'all' | null

/** 내보내기 팝오버의 선택칸 — 화면 다른 곳의 입력칸과 같은 모양이다. */
const popSel: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid #ebebeb', borderRadius: R.icon,
  background: '#fff', color: '#111827', fontSize: 12, fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer', outline: 'none', width: '100%', boxSizing: 'border-box',
}

const PAGE_BG = '#f4f5f7'
/** 이번 달 마감을 알리는 빨강 — 홈 할 일·장비 카드의 「지남」과 같은 값이다. */
const LATE_RED = '#b91c1c'

// 머리 띠의 「칸 셋」(bandCell·bandLabel·bandValue)은 2026-11-26 묶음2 C1 에서 걷었다 —
// 띠가 제목 카드와 한 몸이 되면서 칸막이 없는 **한 줄**이 됐다(라벨·값이 옆으로 붙는다).

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
        borderRadius: R.control, padding: 4,
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
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const data = usePipelineData()
  const { opportunities, activities, engineers, customers, loading, me, reload } = data

  const opp = useOpportunityCrud({ customerId: null, engineerId: me.engineer_id, role: me.role, fetchDetail: reload })
  // 연결된 견적 PDF 열기. 업체명은 견적별로 달라 로그에는 남기지 않는다.
  const quotePdf = useQuotePdf({ customer: null, engineerId: me.engineer_id })

  // 담당자 필터 — 사용자가 고르기 전에는 null 이고 기본값(본인)이 쓰인다.
  const [ownerPick, setOwnerPick] = useState<OwnerPick>(null)
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
  const fc = useForecast(today, exportOpen)
  const { categories } = useQuoteCategories()

  const [activeId, setActiveId] = useState<number | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  /**
   * 담당자 후보 — **포캐스트가 한 건이라도 있는 사람만**이다. 전체 직원을 늘어놓으면
   * 고를 것이 없는 이름이 대부분이라 목록이 길어진다. 이름순(가나다)으로 둔다.
   *
   * 이름·직급은 기회에 묶여 온 값(engineers)을 쓰고, 없으면 직원 목록에서 찾는다.
   * 검색어로는 걸러내지 않는다 — 검색 때문에 담당자 목록이 흔들리면 고를 수가 없다.
   */
  const ownerOptions = useMemo(() => {
    const byId = new Map<number, string>()
    const engName = new Map(engineers.map(e => [e.engineer_id, `${e.name} ${e.position ?? ''}`.trim()]))
    for (const o of opportunities) {
      if (o.engineer_id == null || byId.has(o.engineer_id)) continue
      const fromRow = `${o.engineers?.name ?? ''} ${o.engineers?.position ?? ''}`.trim()
      byId.set(o.engineer_id, fromRow || engName.get(o.engineer_id) || `#${o.engineer_id}`)
    }
    return [...byId].map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'))
  }, [opportunities, engineers])

  // 고른 담당자. 아직 고르지 않았으면 본인(목록에 있을 때) · 없으면 전체.
  const ownerValue: number | 'all' = ownerPick
    ?? (me.engineer_id != null && ownerOptions.some(o => o.id === me.engineer_id) ? me.engineer_id : 'all')

  /** 고른 담당자의 이름 — 내보내기 안내문·파일명이 쓴다. 전체면 빈 글자. */
  const ownerLabel = ownerValue === 'all' ? '' : (ownerOptions.find(o => o.id === ownerValue)?.label ?? `#${ownerValue}`)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return opportunities.filter(o => {
      if (ownerValue !== 'all' && o.engineer_id !== ownerValue) return false
      if (!q) return true
      // 회사 쪽은 공용 함수가 본다(lib/companySearch.ts). 이 자리만 더 보는 것: 기회 제목.
      return matchesCompany({ company_name: o.customers?.company_name }, search, [o.title])
    })
  }, [opportunities, ownerValue, search])

  /**
   * 사유 창이 떠 있는 건 — 실주로 바꾸려는 건이거나(실주), 접으려는 건이다(종료).
   * null 이면 떠 있지 않다. 창은 한 벌이다(components/forecast/LostModal.tsx).
   */
  const [lostTarget, setLostTarget] = useState<{ opp: SalesOpportunity; what: '실주' | '종료' } | null>(null)
  const [lostBusy, setLostBusy] = useState(false)

  /**
   * 고른 분기 — null 이면 **전부**다(K1).
   *
   * 기간으로 **거르지 않는** 것이 이 판의 기본이다(마감일 없는 건이 통째로 사라지면 그
   * 건은 아무도 다시 보지 않는다). 그래서 기간은 거르개가 아니라 **띠의 분포**로 보여 주고,
   * 누르면 그때만 좁힌다. 한 번 더 누르면 전부로 돌아온다.
   */
  const [quarter, setQuarter] = useState<string | null>(null)

  /**
   * 지표 줄(아래 띠)을 펴 두었나 — **사용자별로** 이 브라우저에 남는다 (묶음2 C1).
   * 첫 그림은 늘 「펴짐」이다(서버가 그린 것과 어긋나지 않게 — lib/storedFlag.ts).
   */
  const [metricsOpen, setMetricsOpen] = useStoredFlag(`pipeline:metrics:${me.engineer_id ?? 'anon'}`, true)

  /**
   * 카드 5행의 **다음 할 일** — /api/task 가 내 줄만 돌려준다(RLS 밖에서도 같은 판정).
   * 표가 아직 없으면(503) 빈 목록이고 띠는 「다음 할 일 없음」이 된다 — 판은 그대로 돈다.
   * 남의 포캐스트에는 내 할 일이 없으므로 그 카드는 빈 띠다(그 사람 화면에서는 보인다).
   */
  const [tasks, setTasks] = useState<TaskRow[]>([])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/task', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list' }),
        })
        const json = await res.json().catch(() => null) as { ok?: boolean; rows?: TaskRow[] } | null
        if (!cancelled && res.ok && json?.ok) setTasks(json.rows ?? [])
      } catch (e) {
        console.error('[pipeline] 할 일을 읽지 못했다 — 띠는 비워 둔다', e)
      }
    })()
    return () => { cancelled = true }
  }, [])

  /** 판에 보이는 줄 — 담당자·검색에 분기까지 걸린 것. 띠도 **이 줄을** 센다(어긋나지 않게). */
  const shown = useMemo(() => filtered.filter(o => inQuarter(o, quarter)), [filtered, quarter])

  /** 분기 분포는 **분기를 고르기 전** 줄에서 센다 — 고른 뒤에도 다른 분기로 옮겨 갈 수 있어야 한다. */
  const slices = useMemo(() => quarterSlices(filtered.filter(o => !isClosed(o))), [filtered])
  const summary = useMemo(
    () => boardSummary(shown.filter(o => !isClosed(o)), BOARD_STAGES, todayKST()),
    [shown],
  )

  /** 기회별 마지막 활동일 — **이미 읽어 둔 활동 줄**로 만든다(조회를 늘리지 않는다). */
  const lastActivity = useMemo(() => lastActivityByOpp(activities), [activities])

  // 낙관적 업데이트 — 저장이 끝나기 전에 화면에서 먼저 옮긴다.
  // 실패하면 이 값만 지우면 원래 단계로 되돌아간다(서버 데이터는 그대로이므로).
  const [pendingStage, setPendingStage] = useState<Map<number, string>>(new Map())
  const stageOf = (o: SalesOpportunity) => pendingStage.get(o.opportunity_id) ?? o.stage

  /**
   * 열 안 차례 — **이번 달 마감 → 지난 할 일 있음 → 나머지**(2026-11-27 야간3 0-3).
   * 같은 등급 안에서는 종전 그대로다(byDueDate: 마감 임박 → 등록 순).
   * 흐림을 걷으면서(0-1) 「먼저 볼 것」을 가리는 일을 차례가 맡는다.
   */
  const columns = useMemo(
    () => BOARD_STAGES.map(stage => {
      const rows = shown
        .filter(o => !isClosed(o) && (pendingStage.get(o.opportunity_id) ?? o.stage) === stage)
        .sort((a, b) => {
          const ra = cardRank(a, { today, taskLate: isTaskLate(pickNextTask(tasks, a.opportunity_id), today) })
          const rb = cardRank(b, { today, taskLate: isTaskLate(pickNextTask(tasks, b.opportunity_id), today) })
          return ra !== rb ? ra - rb : byDueDate(a, b)
        })
      return { stage, rows, sum: rows.reduce((s, o) => s + (o.expected_amount ?? 0), 0) }
    }),
    [shown, pendingStage, tasks, today]
  )
  // 끝난 건 = 실주 + 매출 확정 등으로 종료된 것. 판에서 빼고 아래에 접어둔다.
  const done = useMemo(() => shown.filter(o => isClosed(o)), [shown])

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
        canEdit={opp.canEditOpp(o)}
        // 1행 「회사 » 사업장」 — 회사명은 부모 줄의 이름, 사업장명은 그 줄의 site_name 이다
        // (lib/customerLabel.ts · lib/customerList.ts. 이관 전 줄은 제 이름이 곧 회사명이다).
        company={customerCompanyName(o.customers)}
        site={shortSiteName(
          { company_name: o.customers?.company_name ?? '', site_name: o.customers?.site_name ?? null },
          customerCompanyName(o.customers),
        )}
        idleDays={idleDaysOf(lastActivity.get(o.opportunity_id) ?? null, o.created_at, today)}
        nextTask={pickNextTask(tasks, o.opportunity_id)}
        today={today}
        onOpen={() => opp.openEditOpp(o)}
        onChangeStage={next => moveTo(o, next)}
        // 실주·종료는 **사유 창**을 지난다(2026-11-26, L2). 전에는 영업기회 수정 창이
        // 통째로 열려, 사유 한 줄을 적으려고 제목·금액·마감까지 다시 보게 됐다.
        onPickLost={() => setLostTarget({ opp: o, what: '실주' })}
        onClose={!isClosed(o) && o.stage === '수주' ? () => setLostTarget({ opp: o, what: '종료' }) : undefined}
        // 이 기회로 견적을 쓰러 간다 — 견적 화면이 ?opportunity= 를 읽어 고객·기회를 미리 고른다.
        onWriteQuote={() => { window.location.href = `/quote?opportunity=${o.opportunity_id}` }}
      />
    </DraggableCard>
  )

  /**
   * 내보낼 사람 — **화면 위에서 고른 담당자를 따른다.**
   *
   * 예전에는 내보내기 팝오버에 담당자 선택칸이 따로 있어, 화면은 한 사람을 보는데 엑셀은
   * 전체가 나갔다(어느 쪽이 맞는지 파일을 열어 봐야 알았다). 지금은 고른 사람이 곧 내보낼
   * 사람이고, 전체일 때만 팀으로 좁힐 수 있다.
   */
  const exportEngineerIds = useMemo(() => {
    if (ownerValue !== 'all') return [ownerValue]
    const list = xTeam ? engineers.filter(e => (e.teams ?? '') === xTeam) : engineers
    return list.map(e => e.engineer_id)
  }, [engineers, xTeam, ownerValue])

  const teamNames = useMemo(
    () => [...new Set(engineers.map(e => e.teams).filter((t): t is string => !!t))].sort(),
    [engineers],
  )

  /**
   * **통계용(전체)** — 포캐스트 1건 + 포캐스트에 안 붙은 확정 견적 1장이 한 줄이다
   * (2026-11-27 야간3 3). 위 「본사 보고용」과 다른 파일이다 — 그쪽은 월별 버킷,
   * 이쪽은 **낱건**이다(피벗을 돌릴 자료).
   *
   * 기간은 **생성일** 기준이고 기본은 고른 FY 전체다. 팀은 위 팝오버의 그 값을 쓴다.
   * 권한은 기존 엑셀과 같다 — 이 화면에 들어온 사람이면 누른다.
   */
  const [statsBusy, setStatsBusy] = useState(false)
  const runStatsExport = async () => {
    setStatsBusy(true)
    try {
      const from = `${xFy}-04-01`
      const to = `${xFy + 1}-03-31`
      const idSet = new Set(exportEngineerIds)
      const engName = new Map(engineers.map(e => [e.engineer_id, `${e.name} ${e.position ?? ''}`.trim()]))
      const engTeam = new Map(engineers.map(e => [e.engineer_id, e.teams ?? '']))

      // ① 포캐스트 — 판이 이미 읽어 둔 줄을 쓴다(조회를 늘리지 않는다).
      const oppRows: StatsRow[] = opportunities
        .filter(o => {
          const d = (o.created_at ?? '').slice(0, 10)
          return d >= from && d <= to && (o.engineer_id == null || idSet.has(o.engineer_id))
        })
        .map(o => {
          const closed = isClosed(o)
          const stage = o.stage ?? ''
          return {
            kindOfUnit: '포캐스트' as const,
            // 포캐스트에는 품목이 없다 — 붙은 견적의 분류로 가린다(없으면 기타).
            kind: statsKindOf({ category: null, items: null }),
            company: customerCompanyName(o.customers),
            site: shortSiteName({ company_name: o.customers?.company_name ?? '', site_name: o.customers?.site_name ?? null }, customerCompanyName(o.customers)),
            dealer: '',
            owner: o.engineer_id == null ? '' : (engName.get(o.engineer_id) ?? `#${o.engineer_id}`),
            team: o.engineer_id == null ? '' : (engTeam.get(o.engineer_id) ?? ''),
            product: o.title ?? '',
            amount: Math.round(o.expected_amount ?? 0),
            createdAt: (o.created_at ?? '').slice(0, 10),
            stage,
            result: (stage === '실주' ? '실주' : closed ? (stage === '수주' ? '수주' : '취소') : '진행') as StatsRow['result'],
            closedAt: (o.closed_at ?? '').slice(0, 10),
            lostReason: o.lost_reason ?? '',
            competitor: String((o as unknown as { competitor?: string | null }).competitor ?? ''),
            quoteNos: (o.quotes ?? []).map(q => q.quote_number).filter(Boolean).join(', '),
          }
        })

      // ② 포캐스트에 **안 붙은** 확정 견적 — 그 건들을 빼면 쫓은 일의 절반이 사라진다.
      const { data: loose, error } = await supabase
        .from('quotes')
        .select(`quote_id, quote_number, quote_date, status, total_supply, engineer_id, category, repair_id, opportunity_id, customer_id, customers(${CUSTOMER_NAME_SELECT}), quote_items(product_name, group_kind)`)
        .is('opportunity_id', null)
        .gte('quote_date', from).lte('quote_date', to)
      if (error) { console.error('[stats] 견적을 읽지 못했다', error); toast.error('견적을 읽지 못했습니다'); return }

      type LooseQuote = {
        quote_number: string | null; quote_date: string | null; status: string | null
        total_supply: number | null; engineer_id: number | null; category: string | null; repair_id: number | null
        /** 사명 id — 비어 있으면 표에 「E.U 미지정」으로 적는다(2026-11-28, 야간4 8-2). */
        customer_id?: number | null
        customers?: { company_name: string | null; site_name?: string | null; parent?: { company_name?: string | null } | { company_name?: string | null }[] | null } | null
        quote_items?: { product_name: string | null; group_kind: string | null }[] | null
      }
      const quoteRows: StatsRow[] = ((loose ?? []) as unknown as LooseQuote[])
        .filter(q => q.engineer_id == null || idSet.has(q.engineer_id))
        .map(q => {
          const st = q.status ?? ''
          return {
            kindOfUnit: '견적 단독' as const,
            kind: statsKindOf({
              category: q.category,
              categoryLabel: categories.find(c => c.code === q.category)?.label ?? null,
              repairId: q.repair_id, items: q.quote_items ?? null,
            }),
            company: quoteCustomerLabel(q.customer_id, customerCompanyName(q.customers), ''),
            site: shortSiteName({ company_name: q.customers?.company_name ?? '', site_name: q.customers?.site_name ?? null }, customerCompanyName(q.customers)),
            dealer: '',
            owner: q.engineer_id == null ? '' : (engName.get(q.engineer_id) ?? `#${q.engineer_id}`),
            team: q.engineer_id == null ? '' : (engTeam.get(q.engineer_id) ?? ''),
            product: (q.quote_items ?? [])[0]?.product_name ?? '',
            amount: Math.round(q.total_supply ?? 0),
            createdAt: (q.quote_date ?? '').slice(0, 10),
            stage: st,
            result: (st === '실패' ? '실주' : st === '구매취소' ? '취소'
              : /발주|주문|매출/.test(st) ? '수주' : '진행') as StatsRow['result'],
            closedAt: '',
            lostReason: '',
            competitor: '',
            quoteNos: q.quote_number ?? '',
          }
        })

      const all = [...oppRows, ...quoteRows]
      await exportForecastStatsXlsx(all, `FY${xFy}${xTeam ? `_${xTeam}` : ''}`, today)
      toast.success(`통계용 ${all.length}줄을 내려받았습니다(포캐스트 ${oppRows.length} · 견적 단독 ${quoteRows.length})`)
      setExportOpen(false)
    } finally {
      setStatsBusy(false)
    }
  }

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
      // 파일명 꼬리 — 무엇을 내보냈는지 파일만 보고 알 수 있게.
      label: `FY${xFy}${ownerValue === 'all' ? (xTeam ? `_${xTeam}` : '') : `_${ownerLabel}`}`,
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
        .pl-page { min-height: 100dvh; }
        @media (max-width: 768px) { .pl-page { min-height: calc(100dvh - ${TOPBAR_HEIGHT}px); } }
        /* 카드의 단계 select·견적 쓰기·종료는 호버 때만 띄운다.
           hover 를 지원하지 않는 기기(터치)에서는 이 미디어 쿼리가 걸리지 않아 항상 보인다.
           **display 로 감춘다** — visibility 로 자리를 남기면 3행의 담당자·마감 글자가 늘
           단추 몫만큼 좁아져 잘렸다. 그 줄에 minHeight(22)를 줘, 단추가 나타나도 카드
           높이는 호버 전후가 같다(OpportunityCard). */
        @media (hover: hover) {
          .pl-card .pl-card-action { display: none; }
          .pl-card:hover .pl-card-action { display: flex; }
        }
        /* 14일 넘게 멎은 카드는 흐리다(묶음2 C3). **호버하면 제 짙기로 돌아온다** —
           흐리다고 읽을 수 없으면 안 된다(그 건을 다시 보려고 호버하는 것이다). */
        .pl-card:hover { opacity: 1 !important; }
      `}</style>

      <div style={{ maxWidth: 1600, width: '100%', margin: '0 auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>

        {/* ── 상단 카드 **하나** (2026-11-26 묶음2 C1, 캔버스 KanbanHeader 2안) ──────
            전에는 제목 카드와 요약 띠가 **따로 선 두 박스**였다. 둘 사이 12px 과 테두리
            두 벌이 판을 그만큼 아래로 밀었고, 「무엇을 보고 있나(담당자·검색)」와 「얼마나
            있나(건수·금액·분기)」가 서로 다른 상자에 흩어져 있었다. 한 카드 두 줄로 묶는다.

              위 줄 44px — 포캐스트 · 담당자 ▾ · 검색 ·········· ⬇ 엑셀 · ＋ 포캐스트
              아래 줄 34px(연회색) — 진행 중 N건·금액 | 이번 달 마감 N건 | 예정 분기 칩 ····· 지표 숨기기 ▴

            「단계」 묶음은 띠에서 뺐다(C2) — 열 머리가 「상담 [16] 14억 3,900만」으로
            같은 말을 이미 하고 있다. 두 군데에 적으면 한쪽만 고쳐져 어긋난다. */}
        <div style={{
          background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.control,
          marginBottom: 12, flexShrink: 0, overflow: 'hidden',
        }}>
          {/* 위 줄 — 44px */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 44, padding: '5px 12px' }}>
            <span style={{ ...cardTitle, fontSize: 17, flexShrink: 0, marginRight: 2 }}>포캐스트</span>
            {/* 담당자 — 「내 포캐스트 | 전체」 토글을 대신한다. 사람이 늘면 토글로는 남의
                포캐스트를 볼 길이 없었다(전체에서 눈으로 찾아야 했다).
                항목은 포캐스트가 있는 사람만이고, 기본값은 본인이다(ownerValue). */}
            <select
              value={String(ownerValue)}
              onChange={e => setOwnerPick(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              title="담당자"
              style={{
                flexShrink: 0, height: 32, padding: '0 8px', border: `1px solid ${BORDER}`,
                borderRadius: R.icon, background: CARD_BG, color: TEXT, fontSize: 13, fontWeight: 600,
                fontFamily: 'inherit', cursor: 'pointer', outline: 'none', maxWidth: 180,
              }}
            >
              <option value="all">전체</option>
              {ownerOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="업체명 / 제목 검색"
              style={{
                width: 220, height: 32, padding: '0 11px', border: `1px solid ${BORDER}`,
                borderRadius: R.icon, background: CARD_BG, color: TEXT, fontSize: 13,
                outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
            <span style={{ flex: 1, minWidth: 8 }} />
            {/* 엑셀 — 글자 버튼을 **공용 ⬇ 아이콘**으로 바꿨다(묶음2 E). 누르면 종전과 같은
                팝오버가 열린다(연도·팀을 고르고 내려받는다). 동작·권한은 한 줄도 바뀌지 않았다. */}
            <span ref={exportRef as React.RefObject<HTMLSpanElement>} style={{ display: 'inline-flex', flexShrink: 0 }}>
              <ExcelIconButton onClick={() => setExportOpen(v => !v)} size={32} />
            </span>
            <button onClick={opp.openNewOpp}
              onMouseEnter={e => { e.currentTarget.style.background = BLUE_HOVER }}
              onMouseLeave={e => { e.currentTarget.style.background = BLUE }}
              style={{ height: 32, padding: '0 14px', background: BLUE, color: CARD_BG, border: 'none', borderRadius: R.icon, cursor: 'pointer', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, transition: 'background 0.15s ease' }}>
              + 포캐스트
            </button>
          </div>

          {/* 아래 줄 — 34px 연회색 띠. **판에 보이는 줄만** 센다(분포만 분기를 고르기 전
              줄에서 센다 — 다른 분기로 옮겨 갈 수 있어야 한다). 분기를 누르면 그 분기만,
              한 번 더 누르면 전부다. 접으면 이 줄이 통째로 사라지고 카드는 44px 이 된다. */}
          {!loading && summary.count > 0 && metricsOpen && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
              // 띠 배경은 **흰색**이다(2026-11-28, 야간4 3-1). 회색 띠는 「여기는 다른
              // 묶음」이라고 말하는데, 이 줄은 바로 위 제목 줄과 **한 카드**다 —
              // 선 하나로 나누면 족하다. 회색을 깔면 판 위쪽이 두 층으로 무거워진다.
              minHeight: 34, padding: '4px 12px', background: CARD_BG,
              borderTop: `1px solid ${BORDER}`, fontSize: 12,
            }}>
              <span style={{ whiteSpace: 'nowrap' }}>
                <span style={{ color: MUTED }}>진행 중 </span>
                <b title={krwFull(summary.sum)} className="num" style={{ fontWeight: 700, color: TEXT }}>
                  {summary.count}건 · {krwShort(summary.sum)}
                </b>
              </span>
              <span style={{ color: BORDER }}>|</span>
              <span style={{ whiteSpace: 'nowrap' }}>
                <span style={{ color: MUTED }}>이번 달 마감 </span>
                <b style={{ fontWeight: 700, color: summary.soon === 0 ? TEXT_DISABLED : LATE_RED }}>{summary.soon}건</b>
              </span>
              <span style={{ color: BORDER }}>|</span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                <span style={{ color: MUTED, whiteSpace: 'nowrap' }}>예정 분기</span>
                {slices.map(s => {
                  const on = quarter === s.key
                  return (
                    <button
                      key={s.key || 'none'}
                      type="button"
                      onClick={() => setQuarter(on ? null : s.key)}
                      title={`${s.label} — ${s.count}건 · ${krwFull(s.sum)} (누르면 그 분기만)`}
                      style={{
                        display: 'inline-flex', alignItems: 'baseline', gap: 5, padding: '1px 8px',
                        borderRadius: R.pill, border: `1px solid ${on ? BLUE : BORDER}`,
                        background: on ? BLUE_TINT : CARD_BG, cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      <b style={{ fontSize: 12, fontWeight: 700, color: on ? BLUE : TEXT }}>{s.label}</b>
                      <span style={{ fontSize: 11, color: on ? BLUE : MUTED }}>{s.count}건 · {krwShort(s.sum)}</span>
                    </button>
                  )
                })}
                {quarter !== null && (
                  <button type="button" onClick={() => setQuarter(null)}
                    style={{ border: 'none', background: 'none', color: BLUE, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    분기 전체
                  </button>
                )}
              </span>
              <span style={{ flex: 1, minWidth: 4 }} />
              <button type="button" onClick={() => setMetricsOpen(false)}
                title="지표 줄을 접습니다 — 이 선택은 이 브라우저에 남습니다"
                style={{ border: 'none', background: 'none', color: MUTED, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
                지표 숨기기 ▴
              </button>
            </div>
          )}
          {/* 접어 두었을 때 — 다시 펴는 줄 하나만 남긴다(카드는 44px 그대로다). */}
          {!loading && summary.count > 0 && !metricsOpen && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 12px 4px' }}>
              <button type="button" onClick={() => setMetricsOpen(true)}
                title="건수·금액·예정 분기를 다시 봅니다"
                style={{ border: 'none', background: 'none', color: MUTED, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                지표 보기 ▾
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ background: '#fff', border: '1px solid #ebebeb', borderRadius: R.control, padding: 40, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
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
                    {/* 열 머리 — 「상담 **16건** · 14억 3,900만」 **한 줄**이다
                        (2026-11-28, 야간4 3-2). 건수를 알약 배지로 띄우던 것을 걷었다:
                        열마다 회색 알약이 하나씩 서면 판 위에 점이 다섯 줄로 깔려,
                        정작 **카드**를 보기 전에 눈이 거기서 멈춘다. 숫자는 글자로 족하다.
                        위 4px · 아래 6px, 밑줄 없음. */}
                    <div style={{ padding: '4px 2px 6px', flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap' }}>{col.stage}</span>
                        <span className="num" style={{ fontSize: 13, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap' }}>{col.rows.length}건</span>
                        {col.sum > 0 && (
                          <>
                            <span style={{ fontSize: 11, color: '#6b7280', flexShrink: 0 }}>·</span>
                            {/* 열 합계도 카드와 **같은 축약**이다(2026-11-26, K2) — 전에는
                                열 머리만 compactKRW 의 「1.3억」이라 카드와 글자가 달랐다. */}
                            <span title={krwFull(col.sum)} className="num" style={{ fontSize: 12, fontWeight: 600, color: '#4b5563', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {krwShort(col.sum)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <DroppableColumn stage={col.stage} isOver={overStage === col.stage}>
                      {col.rows.length === 0
                        ? <div style={{ border: '1px dashed #ebebeb', borderRadius: R.control, padding: '18px 0', textAlign: 'center', fontSize: 12, color: '#6b7280', flexShrink: 0 }}>
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
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#4b5563' }}>끝난 건</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', background: '#f3f4f6', borderRadius: R.pill, padding: '2px 8px' }}>{done.length}건</span>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>
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
              <div style={{ marginTop: 12, background: '#fff', border: '1px solid #ebebeb', borderRadius: R.control, padding: 40, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
                조건에 맞는 포캐스트가 없습니다
              </div>
            )}

            {/* 끌고 다니는 동안 커서를 따라다니는 미리보기 */}
            <DragOverlay dropAnimation={null}>
              {activeOpp && (
                <div style={{ width: 260, cursor: 'grabbing', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', borderRadius: R.control }}>
                  <OpportunityCard
                    opp={activeOpp}
                    canEdit={false}
                    onOpen={() => {}}
                    onChangeStage={() => {}}
                    onPickLost={() => {}}
                    company={customerCompanyName(activeOpp.customers)}
                    site={shortSiteName(
                      { company_name: activeOpp.customers?.company_name ?? '', site_name: activeOpp.customers?.site_name ?? null },
                      customerCompanyName(activeOpp.customers),
                    )}
                    idleDays={idleDaysOf(lastActivity.get(activeOpp.opportunity_id) ?? null, activeOpp.created_at, today)}
                    nextTask={pickNextTask(tasks, activeOpp.opportunity_id)}
                    today={today}
                  />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* 내보내기 — **담당자는 화면 위에서 고른 사람**이고(exportEngineerIds), 여기서는
          회계연도와 (전체일 때) 팀만 고른다. 검색어는 반영하지 않는다 — 보고용 숫자는
          화면에 보이는 카드가 아니라 집계 규칙이 정한 줄에서 나온다(lib/forecast.ts). */}
      <Popover anchorRef={exportRef} open={exportOpen} onClose={() => setExportOpen(false)} align="end" width={260}
        style={{ background: '#fff', border: '1px solid #ebebeb', borderRadius: R.control, boxShadow: '0 16px 40px rgba(0,0,0,0.18)', padding: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#111827', letterSpacing: '-0.3px' }}>엑셀 내보내기</span>
          <span style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.6 }}>
            월별 요약과 안건 목록을 시트 두 장으로 내려받습니다.
          </span>
          <select value={xFy} onChange={e => setXFy(Number(e.target.value))} aria-label="회계연도" style={popSel}>
            {[thisFY + 1, thisFY, thisFY - 1, thisFY - 2].map(y => (
              <option key={y} value={y}>FY{y} ({y}.04 ~ {y + 1}.03)</option>
            ))}
          </select>
          {/* 담당자를 고른 상태면 팀 선택칸을 내지 않는다 — 둘이 어긋나면 어느 쪽이
              나갔는지 파일을 열어 봐야 알게 된다. 전체일 때만 팀으로 좁힌다. */}
          {ownerValue === 'all' ? (
            <select value={xTeam} onChange={e => setXTeam(e.target.value)} aria-label="팀" style={popSel}>
              <option value="">전체 팀</option>
              {teamNames.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 11, color: '#4b5563', lineHeight: 1.6 }}>
              담당자 <b style={{ color: '#111827' }}>{ownerLabel}</b> — 화면 위에서 고른 사람입니다.
            </span>
          )}
          <button type="button" onClick={() => void runExport()} disabled={fc.loading}
            style={{
              marginTop: 2, padding: '8px 14px', borderRadius: R.icon, border: 'none', cursor: fc.loading ? 'default' : 'pointer',
              background: fc.loading ? '#f3f4f6' : '#234ea2', color: fc.loading ? '#9ca3af' : '#fff',
              fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
            }}>
            {fc.loading ? '자료 읽는 중...' : '내려받기'}
          </button>

          {/* ── 통계용(전체) — 2026-11-27 야간3 3 ──────────────────────────
              위 「내려받기」는 **본사 보고용**(월별 버킷 두 시트)이고 이쪽은 **낱건**이다.
              포캐스트 1건 + 포캐스트에 안 붙은 확정 견적 1장이 한 줄 — 피벗을 돌릴 자료다. */}
          <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 4, paddingTop: 8 }}>
            <span style={{ fontSize: 11, color: MUTED, lineHeight: 1.6, display: 'block', marginBottom: 6 }}>
              통계용은 **한 줄 = 한 건**입니다 — 포캐스트와, 포캐스트에 안 붙은 견적까지.
            </span>
            <button type="button" onClick={() => void runStatsExport()} disabled={statsBusy}
              style={{
                width: '100%', padding: '8px 14px', borderRadius: R.icon, border: `1px solid ${BORDER}`,
                cursor: statsBusy ? 'default' : 'pointer', background: CARD_BG, color: statsBusy ? MUTED : BLUE,
                fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
              }}>
              {statsBusy ? '만드는 중…' : '통계용(전체) 내려받기'}
            </button>
          </div>
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

      {/* 실주·종료 사유 — **한 벌인 창**이다(components/forecast/LostModal.tsx).
          사유를 적고 나면 그 자리에서 단계가 바뀐다(실주) 또는 접힌다(종료).
          칸이 아직 없으면 사유 글자와 메모만 옛 칸에 들어간다(markLost 의 42703 폴백). */}
      {lostTarget && (
        <LostModal
          title={`${lostTarget.opp.customers?.company_name ?? ''} · ${lostTarget.opp.title}`.replace(/^ · /, '')}
          what={lostTarget.what}
          busy={lostBusy}
          onClose={() => setLostTarget(null)}
          onSave={async patch => {
            setLostBusy(true)
            const ok = await opp.markLost(lostTarget.opp, patch,
              lostTarget.what === '실주' ? { stage: '실주' } : { closeOnly: true })
            setLostBusy(false)
            if (ok) setLostTarget(null)
          }}
        />
      )}
    </main>
  )
}
