'use client'

import { useEffect, useMemo, useState } from 'react'
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

// 상대 시간 라벨 ('방금' / 'N분 전' / …). 알림 목록에서 공용으로 쓴다.
export function formatTime(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 60) return '방금'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return `${Math.floor(diff / 86400)}일 전`
}

/**
 * 알림 공용 훅. engineerId 기준으로 조회하고 10초마다 폴링한다.
 * engineerId 가 null 이면(로그인/직원 조회 전) 아무것도 하지 않는다.
 * 반환: { notifications, unreadCount, loading, markAsRead, markAllAsRead, refetch }
 */
export function useNotifications(engineerId: number | null) {
  const supabase = useMemo(() => createClient(), [])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = async () => {
    if (!engineerId) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('engineer_id', engineerId)
      .order('created_at', { ascending: false })
      .limit(30)
    setNotifications((data as Notification[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    if (!engineerId) return
    refetch()
    const interval = setInterval(refetch, 10000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineerId])

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

  return { notifications, unreadCount, loading, markAsRead, markAllAsRead, refetch }
}
