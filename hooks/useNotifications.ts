'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type Notification = {
  id: number
  engineer_id: number
  title: string
  message: string
  type: string
  link: string | null
  is_read: boolean
  created_at: string
}

/** 한 번에 가져오는 기본 건수. 사이드바 배지·대시보드 카드가 쓰던 값이다. */
const DEFAULT_LIMIT = 30
/** 기본 폴링 주기. 배지가 금방 따라오도록 짧게 둔다. */
const DEFAULT_POLL_MS = 10000

export type NotificationsOptions = {
  /** 한 페이지 건수. 기본 30. */
  limit?: number
  /** 안 읽은 것만 가져온다. 기본 false. */
  unreadOnly?: boolean
  /** 폴링 주기(ms). 0 이면 폴링하지 않는다. 기본 10초. */
  pollMs?: number
}

// 상대 시간 라벨 ('방금' / 'N분 전' / …). 알림 목록에서 공용으로 쓴다.
export function formatTime(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 60) return '방금'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return `${Math.floor(diff / 86400)}일 전`
}

/**
 * 알림 공용 훅. engineerId 기준으로 조회하고 주기적으로 다시 읽는다.
 * engineerId 가 null 이면(로그인/직원 조회 전) 아무것도 하지 않는다.
 *
 * 인자를 주지 않으면 예전과 같다 — 최근 30건, 10초 폴링, 읽음 여부 무관.
 * 전용 화면은 { unreadOnly, pollMs } 를 주고 loadMore 로 30건씩 더 받는다.
 *
 * 반환: { notifications, unreadCount, loading, hasMore, loadMore, markAsRead, markAllAsRead, refetch }
 */
export function useNotifications(engineerId: number | null, options: NotificationsOptions = {}) {
  const { limit = DEFAULT_LIMIT, unreadOnly = false, pollMs = DEFAULT_POLL_MS } = options
  const supabase = useMemo(() => createClient(), [])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [hasMore, setHasMore] = useState(false)
  // 조회 조건 한 벌을 나타내는 키. 이 키의 첫 조회가 끝나기 전까지가 loading 이다
  // (effect 안에서 setLoading 을 부르지 않으려고 파생값으로 둔다).
  const queryKey = `${engineerId}|${unreadOnly}|${limit}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== queryKey
  /** 지금까지 받은 페이지 수(0 = 첫 페이지만). 폴링은 받은 만큼 한 번에 다시 읽는다. */
  const pageRef = useRef(0)

  /** 0..page 까지를 한 번에 읽는다. 폴링이 [더 보기] 로 받은 만큼을 지우지 않게 하려는 것이다. */
  const fetchUpTo = async (page: number) => {
    if (!engineerId) return
    let q = supabase
      .from('notifications')
      .select('*')
      .eq('engineer_id', engineerId)
    if (unreadOnly) q = q.eq('is_read', false)
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .range(0, (page + 1) * limit - 1)
    if (error) console.error('[notifications] 조회 실패', error)
    const rows = (data as Notification[]) ?? []
    setNotifications(rows)
    // 받은 수가 요청한 만큼이면 더 있을 수 있다고 본다(총 건수를 따로 세지 않는다).
    setHasMore(rows.length === (page + 1) * limit)
    setLoadedKey(queryKey)
  }

  const refetch = () => fetchUpTo(pageRef.current)

  /** 다음 30건을 이어 받는다. */
  const loadMore = async () => {
    pageRef.current += 1
    await fetchUpTo(pageRef.current)
  }

  useEffect(() => {
    if (!engineerId) return
    // 조건이 바뀌면(읽음 필터 등) 처음부터 다시 읽는다.
    pageRef.current = 0
    fetchUpTo(0)
    if (pollMs <= 0) return
    const interval = setInterval(() => { fetchUpTo(pageRef.current) }, pollMs)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineerId, unreadOnly, limit, pollMs])

  const markAsRead = async (id: number) => {
    const target = notifications.find(n => n.id === id)
    if (!target || target.is_read) return
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
  }

  const markAllAsRead = async () => {
    if (!engineerId) return
    await supabase.from('notifications').update({ is_read: true }).eq('engineer_id', engineerId).eq('is_read', false)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  const unreadCount = notifications.filter(n => !n.is_read).length

  return { notifications, unreadCount, loading, hasMore, loadMore, markAsRead, markAllAsRead, refetch }
}
