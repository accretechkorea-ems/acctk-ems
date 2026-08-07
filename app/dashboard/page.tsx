'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { canAccess80 } from '@/lib/permissions'
import { useNotifications, type Notification } from '@/hooks/useNotifications'
import NotificationList from '@/components/common/NotificationList'
import ActivityDetail from '@/components/activity/ActivityDetail'
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
  const [activityYm, setActivityYm] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() + 1 } })
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
        /* 활동 상세 : 알림 = 5 : 5. 두 카드는 동일 높이(align-items: stretch)로 각자 내부 스크롤. */
        .dash-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: stretch; margin-top: 16px; }
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

        {/* 1행: 이번 달 내 활동 상세 + 알림 (비-80 사용자면 알림이 전체 폭). 두 카드 동일 높이(560)로 각자 내부 스크롤. */}
        <div className={showActivity ? 'dash-row' : 'dash-row single'}>
          {showActivity && (
            // 상세 목록을 모달 없이 카드 안에 인라인 렌더. 월 스테퍼가 조회 기간(startDate~endDate)을 결정.
            <div style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #ebebeb', borderRadius: 8, overflow: 'hidden', height: 560 }}>
              <ActivityDetail
                engineer={me!}
                startDate={activityStart}
                endDate={activityEnd}
                variant="inline"
                headerRight={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <button onClick={() => stepMonth(-1)} title="이전 달"
                      style={{ width: 24, height: 24, border: '1px solid #ebebeb', borderRadius: 6, background: '#f3f4f6', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#111827', flexShrink: 0, padding: 0 }}>◀</button>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#111827', minWidth: 68, textAlign: 'center' }}>{activityYm.y}년 {activityYm.m}월</span>
                    <button onClick={() => { if (!atCurrentMonth) stepMonth(1) }} disabled={atCurrentMonth} title="다음 달"
                      style={{ width: 24, height: 24, border: '1px solid #ebebeb', borderRadius: 6, background: '#f3f4f6', cursor: atCurrentMonth ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 700, color: atCurrentMonth ? '#d1d5db' : '#111827', flexShrink: 0, padding: 0 }}>▶</button>
                  </div>
                }
              />
            </div>
          )}

          {/* 알림 (최근 5건) */}
          <div style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #ebebeb', borderRadius: 8, overflow: 'hidden', ...(showActivity ? { height: 560 } : {}) }}>
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
    </div>
  )
}
