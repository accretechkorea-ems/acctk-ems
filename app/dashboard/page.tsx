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
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { canViewCustomers, type TeamPerm } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPerms'
import { ACTIVITY_TYPES } from '@/lib/activity'
import ActivityCard from '@/components/activity/ActivityCard'
import ActivityDetailModal from '@/components/activity/ActivityDetailModal'
import DashCard from '@/components/dashboard/DashCard'
import { ApprovalCard, ForecastCard, MyStatCard, NotificationCard } from '@/components/dashboard/HomeCards'
import MyQuoteCard from '@/components/dashboard/MyQuoteCard'
import { useDashboardCards, type ApprovalRow, type NotificationRow } from '@/hooks/dashboard/useDashboardCards'
import { nowKSTParts } from '@/lib/date'
import { countedVisitEnd } from '@/lib/serviceVisit'

type Me = {
  engineer_id: number
  name: string | null
  position: string | null
  teams: string | null
  permission_level: string | null
  office: string | null
  perm?: TeamPerm | null
}

// 활동 요약에 필요한 최소 필드.
type ServiceLink = { service_id: number }
type ServiceTypeRow = { service_type: string | null }
type SalesTypeRow = { activity_type: string | null }

function DashboardPageInner() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  // ?quoteTab=견적중 — 「내 견적」 모달을 그 상태 탭으로 연다.
  // 카드의 상태 줄이 이 주소로 보낸다(다른 화면에서 보낼 때도 같은 열쇠를 쓴다).
  const quoteTab = useSearchParams().get('quoteTab')
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [activityYm, setActivityYm] = useState(() => { const n = nowKSTParts(); return { y: n.y, m: n.m } })
  // 활동 요약 건수. 아직 못 받았으면 null(카드를 그리지 않는다).
  const [actCounts, setActCounts] = useState<Record<string, number> | null>(null)
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

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data } = await supabase.auth.getUser()
      if (data.user?.email) {
        const { data: eng } = await supabase
          .from('engineers')
          .select('engineer_id, name, position, teams, permission_level, office')
          .eq('email', data.user.email)
          .single()
        // 활동 위젯 노출 판정에 팀 플래그가 필요해 붙여서 담는다.
        const withPerm = await withTeamPerm((eng as Me | null) ?? null)
        if (!cancelled) setMe(withPerm)
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const greeting = me
    ? `${me.teams ? me.teams + ' ' : ''}${me.name ?? ''}${me.position ? ` ${me.position}` : ''}님, 안녕하세요`
    : '안녕하세요'

  const todayLabel = `${nowD.y}년 ${nowD.m}월 ${nowD.d}일`
  const showActivity = canViewCustomers(me) // customers 를 읽을 수 있는 팀에만 노출
  const engineerId = me?.engineer_id ?? null

  // 회계연도는 4월 시작 — 실적 현황·포캐스트와 같은 규칙이다.
  const fiscalYear = nowD.m >= 4 ? nowD.y : nowD.y - 1
  const cards = useDashboardCards(engineerId, fiscalYear)

  // 본인 활동 건수 집계 — 활동 현황 화면과 같은 규칙이다.
  // 서비스는 참여자 표(service_engineers)를 거쳐 세고, 영업 활동은 engineer_id 로 바로 걸러진다.
  // 목록(ACTIVITY_TYPES)에 없는 유형은 양쪽 모두 무시한다.
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

      const counts: Record<string, number> = {}
      ACTIVITY_TYPES.forEach(t => { counts[t] = 0 })
      ;((shRes.data ?? []) as ServiceTypeRow[]).forEach(sh => {
        if (sh.service_type && counts[sh.service_type] !== undefined) counts[sh.service_type]++
      })
      ;((saRes.data ?? []) as SalesTypeRow[]).forEach(a => {
        if (a.activity_type && counts[a.activity_type] !== undefined) counts[a.activity_type]++
      })
      setActCounts(counts)
    }
    loadCounts()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineerId, showActivity, activityStart, activityEnd])

  const actTotal = actCounts ? Object.values(actCounts).reduce((a, b) => a + b, 0) : 0
  // 월 이동 버튼 — 활동 카드의 머리 오른쪽에 놓는다(카드 안에는 넣지 않는다).
  const stepBtn = (disabled: boolean) => ({
    width: 24, height: 24, border: '1px solid #ebebeb', borderRadius: 6, background: '#f3f4f6',
    cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 700,
    color: disabled ? '#d1d5db' : '#111827', flexShrink: 0, padding: 0,
  })

  /** 알림을 누르면 그 알림이 가리키는 곳으로 간다(링크가 없으면 알림 화면). */
  const openNotification = (n: NotificationRow) => router.push(n.link || '/notifications')
  const openApproval = (d: ApprovalRow) => router.push(`/approval/doc/${d.document_id}`)

  // 결재 대기는 **내 차례인 문서가 있을 때만** 자리를 차지한다.
  // 결재 화면 자체가 전원 공개라(menuPerms 의 approvals.menuPublic) 권한으로는 가를 수 없어,
  // 「받은 것이 있는가」로 가른다. 없는 사람에게는 빈 자리로 둔다.
  const showApproval = cards.approvals.loading || cards.approvals.error || cards.approvals.data.length > 0

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
        /* 활동 카드는 원래 제 높이를 쓰던 부품이라 격자 칸에 맞춰 넘치는 만큼만 감춘다. */
        .home-grid > .home-cell { min-width: 0; min-height: 0; overflow: hidden; display: flex; }
        .home-grid > .home-cell > * { flex: 1; min-width: 0; }
      `}</style>
      <div style={{ maxWidth: 1600, margin: '0 auto' }}>
        {/* 인사말 + 오늘 날짜 (한 줄) */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#111827', letterSpacing: '-0.3px', margin: 0 }}>
            {loading ? ' ' : greeting}
          </h1>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>{todayLabel}</span>
        </div>

        <div className="home-grid">
          {/* 1행 — 활동 기록 · 내 견적 · 포캐스트 · 알림 */}
          <div className="home-cell">
            {showActivity && me && actCounts ? (
              <ActivityCard
                engineer={me}
                counts={actCounts}
                total={actTotal}
                types={ACTIVITY_TYPES}
                fitHeight
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
              />
            )}
          </div>

          <div className="home-cell">
            <ForecastCard slot={cards.opportunities} onOpen={() => router.push('/pipeline')} />
          </div>

          <div className="home-cell">
            <NotificationCard
              slot={cards.notifications}
              onMore={() => router.push('/notifications')}
              onOpen={openNotification}
            />
          </div>

          {/* 2행 — 결재 대기 · 내 실적 · (빈 자리 둘) */}
          <div className="home-cell">
            {showApproval && (
              <ApprovalCard
                slot={cards.approvals}
                onMore={() => router.push('/approval')}
                onOpen={openApproval}
              />
            )}
          </div>

          {/* 내 실적 — 결재 카드가 숨어도 **제자리**다(위 칸이 비어 있을 뿐 당겨지지 않는다). */}
          <div className="home-cell">
            {me && (
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

          {/* 빈 자리 둘 — 카드 없이 칸만 둔다(격자 정렬). */}
          <div className="home-cell" />
          <div className="home-cell" />
        </div>
      </div>

      {/* 활동 상세 — 활동 현황 화면과 같은 모달. 기간도 카드에 보이는 달과 같다. */}
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
