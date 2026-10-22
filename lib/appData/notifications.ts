'use client'

// 알림 — **앱 당 한 벌**이다. 사이드바 배지 · 홈 카드 · 알림 화면이 모두 이것을 본다.
//
// 예전에는 사이드바가 useNotifications(10초 폴링)로, 홈 카드가 useDashboardCards 로, 알림
// 화면이 또 제 훅으로 각각 읽었다 — 같은 표를 세 벌 읽고, 배지 쪽은 10초마다 다시 읽었다.
// 지금은 조회 한 벌(60초, 탭이 숨으면 멈춤 — lib/appData/polledStore.ts)을 나눠 쓴다.
//
// ── 한 가지 달라진 것 ───────────────────────────────────────────────────────
//   알림 화면의 「안 읽음」 탭은 예전에 **조회 조건**(is_read = false)이었다. 조회가 한 벌이
//   되었으므로 지금은 받아 온 목록에서 거른다. 읽은 알림이 많아 첫 30건이 전부 읽음이면
//   「안 읽음」 탭이 비어 보일 수 있다 — 그때는 [더 보기]로 더 받는다(배지 숫자는 받아 온
//   목록에서 세므로 종전과 같은 규칙이다).

import { useEffect, useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase/client'
import { errorInfo } from '@/lib/errorInfo'
import { createPolledStore } from './polledStore'
import type { Notification } from '@/hooks/useNotifications'

/** 한 페이지 건수. 사이드바 배지·홈 카드·알림 화면이 같은 값을 쓴다. */
const PAGE = 30

/** 화면이 쓰는 열만 — select('*') 를 쓰지 않는다(docs/perf-rules.md 5). */
const COLUMNS = 'id, engineer_id, title, message, type, link, is_read, created_at'

type Page = { rows: Notification[]; hasMore: boolean }

/** 지금까지 받은 페이지 수(0 = 첫 페이지). [더 보기]로 늘어나고, 폴링은 받은 만큼 다시 읽는다. */
let pages = 0

const store = createPolledStore<Page>('notifications', { rows: [], hasMore: false }, async (engineerId) => {
  const supabase = createClient()
  const want = (pages + 1) * PAGE
  const { data, error } = await supabase
    .from('notifications')
    .select(COLUMNS)
    .eq('engineer_id', engineerId)
    .order('created_at', { ascending: false })
    .range(0, want - 1)
  if (error) throw new Error(String(errorInfo(error).message || '알림을 불러오지 못했습니다'))
  const rows = (data ?? []) as unknown as Notification[]
  // 받은 수가 요청한 만큼이면 더 있을 수 있다고 본다(총 건수를 따로 세지 않는다).
  return { rows, hasMore: rows.length === want }
})

/** 처리 직후 다시 읽는다(폴링을 기다리지 않는다). */
export const refreshNotifications = store.refresh

/** 로그아웃 — 받아 둔 알림을 버린다. */
export function resetNotifications(): void {
  pages = 0
  store.reset()
}

/** 다음 30건을 이어 받는다. */
async function loadMore(): Promise<void> {
  pages += 1
  await store.refresh()
}

/** 한 건 읽음. DB 를 고치고 받아 둔 목록도 그 자리에서 고친다(배지가 바로 줄어든다). */
async function markAsRead(id: number): Promise<void> {
  const target = store.getSnapshot().data.rows.find(n => n.id === id)
  if (!target || target.is_read) return
  const supabase = createClient()
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id)
  if (error) { console.error('[notifications] 읽음 처리 실패', errorInfo(error)); return }
  store.update(d => ({ ...d, rows: d.rows.map(n => (n.id === id ? { ...n, is_read: true } : n)) }))
}

/** 모두 읽음. */
async function markAllAsRead(engineerId: number | null): Promise<void> {
  if (engineerId == null) return
  const supabase = createClient()
  const { error } = await supabase.from('notifications')
    .update({ is_read: true }).eq('engineer_id', engineerId).eq('is_read', false)
  if (error) { console.error('[notifications] 모두 읽음 실패', errorInfo(error)); return }
  store.update(d => ({ ...d, rows: d.rows.map(n => ({ ...n, is_read: true })) }))
}

/**
 * 알림 공용 훅. 돌려주는 모양은 예전 useNotifications 와 같다 —
 * 다른 것은 **조회가 앱 당 한 벌**이라는 점이다.
 */
export function useNotificationStore(engineerId: number | null) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => { store.setKey(engineerId) }, [engineerId])
  const notifications = snapshot.data.rows
  return {
    notifications,
    /** 안 읽은 건수 — 받아 둔 목록에서 센다(종전과 같은 규칙). */
    unreadCount: notifications.filter(n => !n.is_read).length,
    loading: snapshot.loading,
    error: snapshot.error,
    hasMore: snapshot.data.hasMore,
    loadMore,
    markAsRead,
    markAllAsRead: () => markAllAsRead(engineerId),
    refetch: store.refresh,
  }
}
