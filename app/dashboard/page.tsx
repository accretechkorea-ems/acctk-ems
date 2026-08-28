'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { canViewCustomers, type TeamPerm } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPerms'
import { useNotifications, type Notification } from '@/hooks/useNotifications'
import NotificationList from '@/components/common/NotificationList'
import { ACTIVITY_TYPES } from '@/lib/activity'
import ActivityCard from '@/components/activity/ActivityCard'
import ActivityDetailModal from '@/components/activity/ActivityDetailModal'
import MyQuotesPanel from '@/components/dashboard/MyQuotesPanel'

// 대시보드는 훑어보는 화면이라 알림은 이만큼만 싣는다(전체는 헤더의 종 아이콘에서 본다).
const NOTIF_LIMIT = 5

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

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [activityYm, setActivityYm] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() + 1 } })
  // 활동 요약 건수. 아직 못 받았으면 null(카드를 그리지 않는다).
  const [actCounts, setActCounts] = useState<Record<string, number> | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const { notifications, unreadCount, loading: notifLoading, markAsRead } = useNotifications(me?.engineer_id ?? null)

  const handleNotifClick = (n: Notification) => {
    markAsRead(n.id)
    if (n.link) router.push(n.link)
  }

  // 활동 조회 기간: 선택한 달의 1일 ~ 말일. 이번 달이면 1일 ~ 오늘.
  const pad2 = (n: number) => String(n).padStart(2, '0')
  const nowD = new Date()
  const atCurrentMonth = activityYm.y === nowD.getFullYear() && activityYm.m === nowD.getMonth() + 1
  const activityStart = `${activityYm.y}-${pad2(activityYm.m)}-01`
  const activityEnd = atCurrentMonth
    ? `${nowD.getFullYear()}-${pad2(nowD.getMonth() + 1)}-${pad2(nowD.getDate())}`
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

  const todayLabel = `${nowD.getFullYear()}년 ${nowD.getMonth() + 1}월 ${nowD.getDate()}일`
  const showActivity = canViewCustomers(me) // customers 를 읽을 수 있는 팀에만 노출
  const engineerId = me?.engineer_id ?? null

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
              .lte('visit_date', activityEnd),
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
  // 월 이동 버튼 — 활동 현황 카드 위 줄에 놓는다(카드 안에는 넣지 않는다).
  const stepBtn = (disabled: boolean) => ({
    width: 24, height: 24, border: '1px solid #ebebeb', borderRadius: 6, background: '#f3f4f6',
    cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 700,
    color: disabled ? '#d1d5db' : '#111827', flexShrink: 0, padding: 0,
  })

  return (
    <div style={{ background: '#fafafa', minHeight: '100vh', padding: '24px 28px' }}>
      <style>{`
        /* 견적이 남는 폭을 전부 가져가고, 왼쪽 열만 고정 폭을 쓴다(비율 분할이 아니다).
           row-reverse 라 DOM 순서(견적 → 활동·알림)와 반대로 그려진다 — 화면에서는 활동·알림이 왼쪽,
           견적이 오른쪽이고, 줄바꿈될 때는 DOM 에서 앞선 견적이 위로 온다. */
        .dash-row { display: flex; flex-direction: row-reverse; flex-wrap: wrap; gap: 12px; align-items: stretch; margin-top: 16px; }
        /* flex-basis 는 견적 표가 가로 스크롤 없이 들어가는 최소 폭이다(실측 약 1010px).
           창이 좁아 둘을 나란히 두면 표가 잘리는 상황에서는 왼쪽 열이 아래로 내려가고
           견적이 폭을 전부 가져간다 — 표에 가로 스크롤이 생기지 않게 하는 것이 우선이다. */
        /* align-items: stretch 라 두 열의 바닥이 같은 위치에서 끝난다. 남는 높이는
           견적 쪽에서는 목록 줄 수(fitToHeight)가, 왼쪽에서는 알림 카드가 받는다. */
        .dash-quotes { flex: 1 1 1010px; min-width: 0; display: flex; flex-direction: column; }
        .dash-side { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; }
        .notif-scroll { scrollbar-width: thin; scrollbar-color: #d1d5db transparent; }
        .notif-scroll::-webkit-scrollbar { width: 6px; }
        .notif-scroll::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
        .notif-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>
      <div style={{ maxWidth: 1600, margin: '0 auto' }}>
        {/* 인사말 + 오늘 날짜 (한 줄) */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#111827', letterSpacing: '-0.3px', margin: 0 }}>
            {loading ? ' ' : greeting}
          </h1>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>{todayLabel}</span>
        </div>

        <div className="dash-row">
          {/* 내 견적 (읽기 전용: 실적 요약 · 필터 · 검색 · 목록 · 엑셀) — 이 화면의 본체 */}
          <div className="dash-quotes">
            {me && <MyQuotesPanel engineerId={me.engineer_id} fitToHeight />}
          </div>

          <div className="dash-side">
            {/* 활동 요약 — 활동 현황 화면의 카드를 그대로 쓰되 본인 것 하나만.
                월 이동은 카드의 headerRight 슬롯(원래 팀 뱃지 자리)에 넣는다 — 팀은 인사말에 이미 있다.
                카드 전체가 상세 모달을 여는 클릭 대상이라, 월 버튼은 클릭이 위로 번지지 않게 막는다. */}
            {showActivity && me && actCounts && (
              <ActivityCard
                engineer={me}
                counts={actCounts}
                total={actTotal}
                types={ACTIVITY_TYPES}
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
            )}

            {/* 알림 — 최근 몇 건만. 남는 높이를 받아 왼쪽 열 바닥을 견적 카드에 맞춘다. */}
            <div style={{ flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #ebebeb', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #ebebeb', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>알림</span>
                {unreadCount > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#dc2626', borderRadius: 99, minWidth: 18, height: 18, padding: '0 5px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
              <div className="notif-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {notifLoading ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>불러오는 중...</div>
                ) : (
                  <NotificationList notifications={notifications.slice(0, NOTIF_LIMIT)} onItemClick={handleNotifClick} emptyText="새 알림이 없습니다" compact />
                )}
              </div>
              {/* 잘라낸 건이 있으면 어디서 마저 보는지 알려준다 */}
              {!notifLoading && notifications.length > NOTIF_LIMIT && (
                <div style={{ padding: '9px 16px', borderTop: '1px solid #ebebeb', fontSize: 12, color: '#9ca3af' }}>
                  외 {notifications.length - NOTIF_LIMIT}건 · 상단 알림에서 전체 보기
                </div>
              )}
            </div>
          </div>
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
