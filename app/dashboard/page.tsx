'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { canAccess80 } from '@/lib/permissions'
import { useNotifications, type Notification } from '@/hooks/useNotifications'
import NotificationList from '@/components/common/NotificationList'
import ActivityCard, { SERVICE_TYPES } from '@/components/activity/ActivityCard'
import ActivityDetailModal from '@/components/activity/ActivityDetailModal'
import MyQuotesPanel from '@/components/dashboard/MyQuotesPanel'

type Me = {
  engineer_id: number
  name: string | null
  position: string | null
  teams: string | null
  permission_level: string | null
  office: string | null
}

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [activity, setActivity] = useState<{ counts: Record<string, number>; total: number } | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)
  const [activityYm, setActivityYm] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() + 1 } })
  const [showActivityDetail, setShowActivityDetail] = useState(false)
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

  // 이번 달 내 활동(본인 것만). service_history 는 RLS(is_team80)라 canAccess80 일 때만 조회한다.
  useEffect(() => {
    if (!me || !canAccess80(me)) { setActivityLoading(false); return }
    const eid = me.engineer_id
    let cancelled = false
    const loadActivity = async () => {
      const { data: se } = await supabase.from('service_engineers').select('service_id').eq('engineer_id', eid)
      const ids = (se ?? []).map(r => r.service_id)
      const counts: Record<string, number> = {}
      SERVICE_TYPES.forEach(t => { counts[t] = 0 })
      if (ids.length) {
        const { data: sh } = await supabase
          .from('service_history')
          .select('service_type, visit_date')
          .in('service_id', ids)
          .gte('visit_date', activityStart)
          .lte('visit_date', activityEnd)
        for (const r of sh ?? []) {
          if (r.service_type && counts[r.service_type] !== undefined) counts[r.service_type]++
        }
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      if (!cancelled) { setActivity({ counts, total }); setActivityLoading(false) }
    }
    loadActivity()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.engineer_id, activityStart, activityEnd])

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
        if (!cancelled) setMe((eng as Me | null) ?? null)
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

  const _now = new Date()
  const todayLabel = `${_now.getFullYear()}년 ${_now.getMonth() + 1}월 ${_now.getDate()}일`
  const showActivity = !!me && canAccess80(me) // is_team80 RLS 대상만 노출

  return (
    <div style={{ background: '#fafafa', minHeight: '100vh', padding: '24px 28px' }}>
      <style>{`
        /* 활동 카드는 활동 현황 페이지 카드와 동일 폭(246px = (1280 - 4*12)/5). 알림은 나머지. */
        .dash-row { display: grid; grid-template-columns: 246px 1fr; gap: 12px; align-items: stretch; margin-top: 16px; }
        .dash-row.single { grid-template-columns: 1fr; }
        @media (max-width: 1024px) { .dash-row { grid-template-columns: 1fr; } }
        .notif-scroll { scrollbar-width: thin; scrollbar-color: #d1d5db transparent; }
        .notif-scroll::-webkit-scrollbar { width: 6px; }
        .notif-scroll::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
        .notif-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        {/* 인사말 + 오늘 날짜 (한 줄) */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#111827', letterSpacing: '-0.3px', margin: 0 }}>
          {loading ? ' ' : greeting}
        </h1>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>{todayLabel}</span>
        </div>

        {/* 1행: 이번 달 내 활동 + 알림 (비-80 사용자면 알림이 전체 폭) */}
        <div className={showActivity ? 'dash-row' : 'dash-row single'}>
          {showActivity && (
            activityLoading ? (
              <div style={{ background: '#fff', border: '1px solid #ebebeb', borderRadius: 8, padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>불러오는 중...</div>
            ) : (
              // 0건이어도 카드 그대로 렌더(활동 현황 페이지와 동일). 팀 뱃지 대신 월 스테퍼를 우상단에.
              // 스테퍼 클릭은 stopPropagation 으로 카드 클릭(상세 모달)과 분리.
              <ActivityCard
                engineer={me!}
                counts={activity?.counts ?? {}}
                total={activity?.total ?? 0}
                onClick={() => setShowActivityDetail(true)}
                headerRight={
                  <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <button onClick={e => { e.stopPropagation(); stepMonth(-1) }} title="이전 달"
                      style={{ width: 24, height: 24, border: '1px solid #ebebeb', borderRadius: 6, background: '#f3f4f6', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#111827', flexShrink: 0, padding: 0 }}>◀</button>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#111827', minWidth: 68, textAlign: 'center' }}>{activityYm.y}년 {activityYm.m}월</span>
                    <button onClick={e => { e.stopPropagation(); if (!atCurrentMonth) stepMonth(1) }} disabled={atCurrentMonth} title="다음 달"
                      style={{ width: 24, height: 24, border: '1px solid #ebebeb', borderRadius: 6, background: '#f3f4f6', cursor: atCurrentMonth ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 700, color: atCurrentMonth ? '#d1d5db' : '#111827', flexShrink: 0, padding: 0 }}>▶</button>
                  </div>
                }
              />
            )
          )}

          {/* 알림 (최근 5건) */}
          <div style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #ebebeb', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #ebebeb', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>알림</span>
              {unreadCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#dc2626', borderRadius: 99, minWidth: 18, height: 18, padding: '0 5px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </div>
            {/* 전체 알림을 세로 스크롤. 2열일 땐 활동 카드 높이에 맞춰(absolute) 내부 스크롤,
                1열(활동 없음)일 땐 maxHeight 로 제한. */}
            {showActivity ? (
              <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                <div className="notif-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}>
                  {notifLoading ? (
                    <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>불러오는 중...</div>
                  ) : (
                    <NotificationList notifications={notifications} onItemClick={handleNotifClick} emptyText="새 알림이 없습니다" />
                  )}
                </div>
              </div>
            ) : (
              <div className="notif-scroll" style={{ maxHeight: 420, overflowY: 'auto' }}>
                {notifLoading ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>불러오는 중...</div>
                ) : (
                  <NotificationList notifications={notifications} onItemClick={handleNotifClick} emptyText="새 알림이 없습니다" />
                )}
              </div>
            )}
          </div>
        </div>

        {/* 내 견적 (읽기 전용: KPI + 필터 + 테이블 + PDF) */}
        {me && (
          <div style={{ marginTop: 12 }}>
            <MyQuotesPanel engineerId={me.engineer_id} />
          </div>
        )}
      </div>

      {/* 활동 상세 모달 (동선 보기 포함, 활동 현황 페이지와 공유). 본인 기록만 조회. */}
      {showActivityDetail && me && (
        <ActivityDetailModal
          engineer={me}
          startDate={activityStart}
          endDate={activityEnd}
          onClose={() => setShowActivityDetail(false)}
        />
      )}
    </div>
  )
}
