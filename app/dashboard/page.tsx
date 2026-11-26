'use client'

// 개인 대시보드 — **4열 격자**다. 카드 하나가 한 가지를 말한다.
//
// 예전에는 왼쪽에 활동 요약, 오른쪽에 「내 견적」 표가 화면을 가득 채웠다. 표가 커서 다른 것을
// 둘 자리가 없었고, 그래서 알림·결재·포캐스트는 각 화면까지 가야 보였다. 표는 모달로 옮기고
// 자리를 카드에 나눠 준다 — 홈은 「무엇을 할 차례인가」를 보는 곳이다.
//
// ── 조회 ────────────────────────────────────────────────────────────────────
//   카드마다 따로 읽되 **동시에** 시작한다(hooks/dashboard/useDashboardCards.ts).
//   하나가 실패해도 그 카드만 「불러오지 못했습니다」가 되고 나머지는 그대로 뜬다.
//   「내 견적」 표의 전체 자료는 **모달을 열 때** 읽는다 — 카드는 숫자만 본다.

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { canViewCustomers } from '@/lib/permissions'
import { useMe } from '@/lib/appData/MeProvider'
import { inSalesStats } from '@/lib/salesScope'
import { activityTypeOrder } from '@/lib/activity'
import { loadActivityTypes } from '@/lib/activityTypes'
import ActivityCard from '@/components/activity/ActivityCard'
import ActivityDetailModal from '@/components/activity/ActivityDetailModal'
import DashCard from '@/components/dashboard/DashCard'
import MySnippetCard from '@/components/dashboard/MySnippetCard'
import { MyStatCard } from '@/components/dashboard/HomeCards'
import MyQuoteCard from '@/components/dashboard/MyQuoteCard'
import BackfillButton from '@/components/dashboard/BackfillButton'
import { TaskListCard } from '@/components/dashboard/TodayCards'
import TaskAddModal from '@/components/task/TaskAddModal'
import { useDashboardCards } from '@/hooks/dashboard/useDashboardCards'
import { useToday } from '@/hooks/dashboard/useToday'
import { useApprovalInbox } from '@/lib/appData/approvalInbox'
import { isSuperAdmin } from '@/lib/permissions'
import { buildTaskList, dueCounts, type TaskItem } from '@/lib/tasks'
import { nowKSTParts } from '@/lib/date'
import { countedVisitEnd } from '@/lib/serviceVisit'
import { R } from '@/lib/radius'

// 활동 요약에 필요한 최소 필드.
type ServiceLink = { service_id: number }
type ServiceTypeRow = { service_type: string | null }
type SalesTypeRow = { activity_type: string | null }

function DashboardPageInner() {
  const supabase = useMemo(() => createClient(), [])
  // ?quoteTab=견적중 — 「내 견적」 모달을 그 상태 탭으로 연다.
  // 카드의 상태 줄이 이 주소로 보낸다(다른 화면에서 보낼 때도 같은 열쇠를 쓴다).
  const quoteTab = useSearchParams().get('quoteTab')
  // 본인 정보는 MeProvider 가 앱 당 한 번 읽은 것이다(여기서 다시 조회하지 않는다).
  const { me, loading } = useMe()
  const [activityYm, setActivityYm] = useState(() => { const n = nowKSTParts(); return { y: n.y, m: n.m } })
  // 활동 요약 건수. 아직 못 받았으면 null(카드를 그리지 않는다).
  const [actCounts, setActCounts] = useState<Record<string, number> | null>(null)
  /** 카드에 세우는 유형 — 서비스 + 영업 종류(표) + 목록 밖 값. 활동 현황과 같은 규칙이다. */
  const [actTypes, setActTypes] = useState<string[]>([])
  // 활동 상세 모달이 열려 있는가. 카드에 보이는 달(activityYm)을 그대로 쓴다.
  const [detailOpen, setDetailOpen] = useState(false)
  // 활동 조회 기간: 선택한 달의 1일 ~ 말일. 이번 달이면 1일 ~ 오늘.
  const pad2 = (n: number) => String(n).padStart(2, '0')
  const nowD = nowKSTParts()
  const atCurrentMonth = activityYm.y === nowD.y && activityYm.m === nowD.m
  const activityStart = `${activityYm.y}-${pad2(activityYm.m)}-01`
  const activityEnd = atCurrentMonth
    ? `${nowD.y}-${pad2(nowD.m)}-${pad2(nowD.d)}`
    : `${activityYm.y}-${pad2(activityYm.m)}-${pad2(new Date(activityYm.y, activityYm.m, 0).getDate())}` // 월마다 다른 말일
  const stepMonth = (delta: number) => setActivityYm(({ y, m }) => { const d = new Date(y, m - 1 + delta, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 } })

  const greeting = me
    ? `${me.teams ? me.teams + ' ' : ''}${me.name ?? ''}${me.position ? ` ${me.position}` : ''}님, 안녕하세요`
    : '안녕하세요'

  const todayLabel = `${nowD.y}년 ${nowD.m}월 ${nowD.d}일`
  const showActivity = canViewCustomers(me) // customers 를 읽을 수 있는 팀에만 노출
  const engineerId = me?.engineer_id ?? null

  // 회계연도는 4월 시작 — 실적 현황·포캐스트와 같은 규칙이다.
  const fiscalYear = nowD.m >= 4 ? nowD.y : nowD.y - 1
  const cards = useDashboardCards(engineerId, fiscalYear)

  // ── 내 오늘 (2026-11-26, 시안 Home2) ──────────────────────────────────────
  // 타일과 목록은 **같은 줄**을 센다(lib/tasks.ts) — 그래서 둘이 어긋나지 않는다.
  // 미배정 리드는 배정하는 사람에게만 뜻이 있다(지시: superadmin).
  const seeUnassignedLeads = isSuperAdmin(me)
  const today = useToday(engineerId, { seeUnassignedLeads })
  // 결재 미결함은 사이드바 배지와 **같은 스토어**다(조회가 한 벌로 돈다).
  const inbox = useApprovalInbox(engineerId)
  const [taskOpen, setTaskOpen] = useState(false)

  const taskItems = buildTaskList(today.tasks.data, {
    today: today.today,
    quotes: today.quotes.data,
    leads: today.leads.data,
    approvals: inbox.docs.map(d => ({ doc_id: d.document_id, title: d.title })),
    devices: today.pendingDevices.data,
    lost: today.lost.data,
    reasonPending: today.reasonPending.data,
  })
  // 제목 옆의 두 수 — 목록과 **같은 줄**을 센다(lib/tasks.ts 의 dueCounts).
  const counts = dueCounts(taskItems, today.today)

  /** 할 일 체크 — 끝낸 것으로 찍고 목록을 다시 읽는다(지우지 않는다). */
  const finishTask = async (it: TaskItem) => {
    if (!it.taskId) return
    try {
      await fetch('/api/task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'done', task_id: it.taskId, done: true }),
      })
    } catch (e) {
      console.error('[today] 할 일 완료 실패', e)
    }
    void today.reloadTasks()
  }

  // 본인 활동 건수 집계 — 활동 현황 화면과 같은 규칙이다.
  // 서비스는 참여자 표(service_engineers)를 거쳐 세고, 영업 활동은 engineer_id 로 바로 걸러진다.
  // 서비스는 목록에 없는 유형을 무시하고, 영업은 **목록 밖 값도 센다**(종류가 비활성·개명돼도
  // 과거 줄이 합계에서 빠지면 안 된다 — 활동 현황과 같은 규칙).
  useEffect(() => {
    if (engineerId === null || !showActivity) return
    let cancelled = false
    const loadCounts = async () => {
      const { data: seData } = await supabase
        .from('service_engineers')
        .select('service_id')
        .eq('engineer_id', engineerId)
      const serviceIds = (seData ?? []).map((se: ServiceLink) => se.service_id)

      const [shRes, saRes] = await Promise.all([
        serviceIds.length === 0
          ? Promise.resolve({ data: [] as ServiceTypeRow[] })
          : supabase
              .from('service_history')
              .select('service_type')
              .in('service_id', serviceIds)
              .gte('visit_date', activityStart)
              // 방문 예정으로 미리 써 둔 기록은 빼고 센다(오늘까지) — 활동 현황과 같은 기준.
              .lte('visit_date', countedVisitEnd(activityEnd)),
        supabase
          .from('sales_activities')
          .select('activity_type')
          .eq('engineer_id', engineerId)
          .gte('activity_date', activityStart)
          .lte('activity_date', activityEnd),
      ])
      if (cancelled) return

      const typeOrder = activityTypeOrder(await loadActivityTypes())
      if (cancelled) return
      const counts: Record<string, number> = {}
      typeOrder.forEach(t => { counts[t] = 0 })
      ;((shRes.data ?? []) as ServiceTypeRow[]).forEach(sh => {
        if (sh.service_type && counts[sh.service_type] !== undefined) counts[sh.service_type]++
      })
      ;((saRes.data ?? []) as SalesTypeRow[]).forEach(a => {
        if (!a.activity_type) return
        counts[a.activity_type] = (counts[a.activity_type] ?? 0) + 1
      })
      // 목록 밖 값도 줄로 세운다 — 세면서 감추면 합계와 줄이 어긋난다.
      setActTypes([...typeOrder, ...Object.keys(counts).filter(t => !typeOrder.includes(t)).sort()])
      setActCounts(counts)
    }
    loadCounts()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineerId, showActivity, activityStart, activityEnd])

  const actTotal = actCounts ? Object.values(actCounts).reduce((a, b) => a + b, 0) : 0
  // 월 이동 버튼 — 활동 카드의 머리 오른쪽에 놓는다(카드 안에는 넣지 않는다).
  const stepBtn = (disabled: boolean) => ({
    width: 24, height: 24, border: '1px solid #ebebeb', borderRadius: R.icon, background: '#f3f4f6',
    cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 700,
    color: disabled ? '#9ca3af' : '#111827', flexShrink: 0, padding: 0,
  })

  return (
    <div style={{ background: '#fafafa', minHeight: '100vh', padding: '24px 28px' }}>
      <style>{`
        /* 4열 격자. 카드 높이는 줄마다 같다(260px) — 높이가 들쭉날쭉하면 격자가 어긋난다.
           빈 자리는 카드 없이 둔다(격자 정렬만 맞춘다).
           330px 인 이유 — 「내 실적」 카드(4칸 + 달성률 바 둘)가 잘리지 않는 가장 낮은 높이다.
           다른 카드는 그만큼 줄이 더 보인다. */
        .home-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          grid-auto-rows: 330px;
          gap: 12px; margin-top: 16px;
        }
        /* 본문이 좁아지면 2열 → 1열. 사이드바가 232px 을 가져가므로 화면 기준 1280/768 을
           그대로 쓰면 한 칸 늦게 접힌다 — 본문 폭으로 재는 값을 쓴다. */
        @media (max-width: 1280px) { .home-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 768px)  { .home-grid { grid-template-columns: minmax(0, 1fr); } }
        /* 칸은 **자르지 않는다**(overflow 를 두지 않는다). 카드는 hover 때 2px 떠오르는데,
           칸이 자르고 있으면 그 2px 이 그대로 깎여 위 테두리가 끊겨 보였다. 넘칠 걱정은
           없다 — 카드마다 height:100% 로 칸에 맞고(DashCard·활동 카드·실적 카드),
           길어지는 본문은 카드가 제 안에서 감추거나 스크롤한다. */
        .home-grid > .home-cell { min-width: 0; min-height: 0; display: flex; }
        .home-grid > .home-cell > * { flex: 1; min-width: 0; }
        /* 「할 일」은 **두 칸**을 쓴다(지시 F3) — 한 줄짜리 글이 길어서 한 칸에서는 거의 잘린다.
           1열로 접히면 한 칸이다(span 2 를 그대로 두면 격자가 비뚤어진다). */
        .home-grid > .home-cell.wide { grid-column: span 2; }
        @media (max-width: 768px) { .home-grid > .home-cell.wide { grid-column: span 1; } }
        /* 할 일은 **두 칸 × 두 줄**을 쓴다(묶음2 A1·A2) — 타일 줄과 작은 카드 둘을 걷고
           그 자리를 전부 목록에 준다. 홈에서 먼저 읽어야 하는 것이 「무엇이 내 차례인가」다.
           1열로 접히면 한 칸·한 줄이다(span 을 그대로 두면 격자가 비뚤어진다). */
        .home-grid > .home-cell.tall { grid-row: span 2; }
        @media (max-width: 768px) { .home-grid > .home-cell.tall { grid-row: span 1; } }
      `}</style>
      <div style={{ maxWidth: 1600, margin: '0 auto' }}>
        {/* 인사말 + 오늘 날짜 (한 줄) */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#111827', letterSpacing: '-0.3px', margin: 0 }}>
            {loading ? ' ' : greeting}
          </h1>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#4b5563' }}>{todayLabel}</span>
        </div>

        {/* ⚠ 타일 줄(지난 할 일·오늘 할 일·멈춘 딜·미배정 리드·결재 대기)은 2026-11-26
            (묶음2 A1)에 **걷었다.** 아래 할 일 목록이 이미 같은 줄을 세고 있었고, 타일을
            누르면 가는 곳(포캐스트·리드·결재)도 그 줄을 누르면 가는 곳과 같다.
            지남·오늘은 할 일 카드 **제목 옆**으로 옮겼다. */}
        <div className="home-grid">
          {/* 할 일 — **두 칸 × 두 줄**. 아침에 먼저 읽어야 하는 것이 「오늘 무엇을 하나」다.
              성적·견적은 그 옆, 활동·문구는 그 아래 줄이다. */}
          <div className="home-cell wide tall">
            <TaskListCard
              items={taskItems}
              today={today.today}
              late={counts.late}
              now={counts.today}
              loading={today.tasks.loading}
              note={today.schemaNote}
              onAdd={() => setTaskOpen(true)}
              onToggle={it => { void finishTask(it) }}
            />
          </div>

          {/* 내 실적 — **집계 대상자에게만** 보여 준다. 비대상(임원·영업관리 등)에게는
              목표가 없어 0만 찍히므로, 칸을 비워 둔다(격자 정렬은 유지). */}
          <div className="home-cell">
            {me && inSalesStats(me) && (
              <MyStatCard
                engineer={me}
                quotes={cards.quotes.data}
                targets={cards.targets.data}
                fy={fiscalYear}
                loading={cards.quotes.loading || cards.targets.loading}
                error={cards.quotes.error || cards.targets.error}
              />
            )}
          </div>

          <div className="home-cell">
            {me && (
              <MyQuoteCard
                // 주소의 탭이 바뀌면 카드를 새로 만든다 — 처음 상태로 모달을 여는 구조라
                // 같은 화면에 머문 채 주소만 바뀌는 경우를 이렇게 받는다.
                key={quoteTab ?? ''}
                engineerId={me.engineer_id}
                slot={cards.quotes}
                initialTab={quoteTab}
                onReload={() => { void cards.reloadQuotes() }}
                // 「＋ 사후 실적」은 2026-11-26 에 실적 현황에서 여기로 왔다(F6).
                // 창은 같은 창이고, 슈퍼관리자에게만 선다(단추가 스스로 판정하지 않는다 —
                // 라우트가 막지만 보이지 않는 단추를 두지 않는다).
                headerRight={isSuperAdmin(me) ? <BackfillButton onSaved={() => { void cards.reloadQuotes() }} /> : undefined}
              />
            )}
          </div>

          {/* 2행 — 활동 기록 · 내 문구 (할 일 카드가 왼쪽 두 칸을 계속 쓴다) */}
          <div className="home-cell">
            {showActivity && me && actCounts ? (
              <ActivityCard
                engineer={me}
                counts={actCounts}
                total={actTotal}
                types={actTypes}
                fitHeight
                // 카드를 누르면 **그 자리에서** 활동 상세 모달이 열린다 — 홈에서 보던
                // 달의 내 기록을 보려고 누르는 것이고, 화면을 떠나면 돌아올 때 홈을
                // 처음부터 다시 읽는다(카드 여섯 개를 다시 조회한다). 활동 현황 화면은
                // 사이드바에 있다 — 그래서 모달 안에도, 카드에도 그리로 가는 링크는 두지
                // 않는다. 월 이동 화살표는 전파를 막는다(두 곳으로 갈 수는 없다).
                onClick={() => setDetailOpen(true)}
                headerRight={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                    onClick={e => e.stopPropagation()}>
                    <button onClick={() => stepMonth(-1)} title="이전 달" style={stepBtn(false)}>◀</button>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#111827', minWidth: 68, textAlign: 'center' }}>{activityYm.y}년 {activityYm.m}월</span>
                    <button onClick={() => { if (!atCurrentMonth) stepMonth(1) }} disabled={atCurrentMonth} title="다음 달" style={stepBtn(atCurrentMonth)}>▶</button>
                  </div>
                }
              />
            ) : showActivity ? (
              <DashCard title="활동 기록" loading>{null}</DashCard>
            ) : null}
          </div>

          {/* 내 문구 — 격자의 **마지막 칸**이다(폰에서는 맨 아래, 2026-11-25).
              「전체 관리」는 화면을 옮기지 않고 내 정보의 그 탭을 창 안에 그대로 띄운다.
              ⚠ 포캐스트·알림·결재 대기 카드는 2026-11-26 에 **뺐다**(지시 F4, 시안 Home2) —
                포캐스트는 칸반으로, 알림은 상단 종으로, 결재는 할 일 줄로 간다.
                카드 부품은 그대로 남아 있다(components/dashboard/HomeCards.tsx). */}
          <div className="home-cell">
            {me && <MySnippetCard me={{ engineer_id: me.engineer_id, permission_level: me.permission_level }} />}
          </div>
        </div>
      </div>

      {/* 활동 상세 — 활동 현황(/activity)에서 카드를 눌렀을 때 뜨는 **그 모달 그대로**다
          (components/activity/ActivityDetailModal.tsx — 본문은 ActivityDetail). 다른 점은
          누구의 것을 보느냐뿐이다: 여기는 늘 본인(me)이고, 기간은 카드에 보이는 달이다. */}
      {/* 「＋ 할 일」 — 자리마다 같은 창이다(components/task/TaskAddModal.tsx).
          홈에서는 연결 대상을 고를 수 있고, 포캐스트 카드·견적 상세에서는 그 건이 박혀 있다. */}
      {taskOpen && (
        <TaskAddModal onClose={() => setTaskOpen(false)} onSaved={() => { void today.reloadTasks() }} />
      )}

      {detailOpen && me && (
        <ActivityDetailModal
          engineer={me}
          startDate={activityStart}
          endDate={activityEnd}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </div>
  )
}

// useSearchParams 는 Suspense 경계 안에서만 쓸 수 있다(리드·견적 화면과 같은 방식).
export default function DashboardPage() {
  return (
    <Suspense fallback={<div style={{ background: '#fafafa', minHeight: '100vh' }} />}>
      <DashboardPageInner />
    </Suspense>
  )
}
