'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { HOME_STATE_KEY } from '@/lib/home'
import { useOutsideClick } from '@/hooks/useOutsideClick'

const ADMIN_EMAIL = 'jwkwon@accretechkorea.com'

type Notification = {
  id: number
  engineer_id: number
  title: string
  message: string
  type: string
  link: string | null
  is_read: boolean
  created_at: string
}

export default function Header() {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  const [user, setUser] = useState<any>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [engineerId, setEngineerId] = useState<number | null>(null)
  const [engineerTeams, setEngineerTeams] = useState<string | null>(null)
  const [permissionLevel, setPermissionLevel] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [notifOpen, setNotifOpen] = useState(false)

  const notifRef = useRef<HTMLDivElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)

  useOutsideClick(notifRef, () => setNotifOpen(false), notifOpen)
  useOutsideClick(accountRef, () => setIsOpen(false), isOpen)
  useOutsideClick(mobileMenuRef, () => setIsMenuOpen(false), isMenuOpen)

  const fetchNotifications = async (eid: number) => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('engineer_id', eid)
      .order('created_at', { ascending: false })
      .limit(20)
    setNotifications((data as Notification[]) ?? [])
  }

  useEffect(() => {
    const getUser = async () => {
      const { data } = await supabase.auth.getUser()
      setUser(data.user)
      if (data.user?.email) {
        const { data: eng } = await supabase
          .from('engineers')
          .select('engineer_id, teams, permission_level')
          .eq('email', data.user.email)
          .single()
        if (eng) {
          setEngineerId(eng.engineer_id)
          setEngineerTeams(eng.teams ?? null)
          setPermissionLevel(eng.permission_level ?? null)
          fetchNotifications(eng.engineer_id)
        }
      }
    }
    getUser()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => { listener.subscription.unsubscribe() }
  }, [])

  // 10초마다 알림 폴링
  useEffect(() => {
    if (!engineerId) return
    const interval = setInterval(() => fetchNotifications(engineerId), 10000)
    return () => clearInterval(interval)
  }, [engineerId])

  const handleNotifClick = async (notif: Notification) => {
    if (!notif.is_read) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', notif.id)
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n))
    }
    setNotifOpen(false)
    if (notif.link) router.push(notif.link)
  }

  const handleMarkAllRead = async () => {
    if (!engineerId) return
    await supabase.from('notifications').update({ is_read: true }).eq('engineer_id', engineerId).eq('is_read', false)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const formatTime = (ts: string) => {
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
    if (diff < 60) return '방금'
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
    return `${Math.floor(diff / 86400)}일 전`
  }

  const isAdmin = user?.email === ADMIN_EMAIL
  const isPurchaseManager = permissionLevel === 'superadmin' || engineerTeams === '영업관리'
  const canSeeRepair = permissionLevel === 'superadmin' || permissionLevel === 'manager' || engineerTeams === '20'
  const unreadCount = notifications.filter(n => !n.is_read).length

  const menuItems = [
    { label: '고객사 현황', onClick: () => { sessionStorage.removeItem(HOME_STATE_KEY); window.location.href = '/' }, path: '/' },
    { label: '활동 현황', onClick: () => router.push('/activity'), path: '/activity' },
    { label: '견적서', onClick: () => router.push('/quote'), path: '/quote' },
    { label: '실적 현황', onClick: () => router.push('/sales'), path: '/sales' },
    { label: '재고 관리', onClick: () => router.push('/inventory'), path: '/inventory' },
    ...(canSeeRepair ? [{ label: '20수리 현황', onClick: () => router.push('/repair'), path: '/repair' }] : []),
    { label: '자료실', onClick: () => router.push('/library'), path: '/library' },
    ...(isPurchaseManager ? [{ label: '발주 관리', onClick: () => router.push('/purchase'), path: '/purchase' }] : []),
    ...(isAdmin ? [{ label: '관리자', onClick: () => router.push('/admin'), path: '/admin' }] : []),
  ]

  return (
    <>
      <div style={{
        position: 'sticky', top: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 20px', borderBottom: '1px solid #e5e5e5',
        background: '#fff', minHeight: 44,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <img src="/headerlogo.png" alt="logo" style={{ height: 24, cursor: 'pointer' }} onClick={() => router.push('/')} />

          <div style={{ display: 'flex', gap: 20 }} className="pc-menu">
            {menuItems.map((item) => {
              const isActive = item.path === '/' ? pathname === '/' : pathname.startsWith(item.path)
              return (
                <span key={item.label} onClick={item.onClick} style={{
                  fontSize: 16, fontWeight: 700,
                  color: isActive ? '#234ea2' : '#111111',
                  cursor: 'pointer', whiteSpace: 'nowrap', paddingBottom: 4,
                  borderBottom: isActive ? '2.5px solid #234ea2' : '2.5px solid transparent',
                  transition: 'all 0.15s',
                }}>
                  {item.label}
                </span>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>

          {/* 🔔 알림 벨 */}
          <div ref={notifRef} style={{ position: 'relative' }}>
            <button
              onClick={() => { setNotifOpen(o => !o); setIsOpen(false) }}
              style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', lineHeight: 1, display: 'flex', alignItems: 'center' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 22C13.1046 22 14 21.1046 14 20H10C10 21.1046 10.8954 22 12 22Z" fill="#234ea2"/>
                <path d="M18 11C18 7.68629 15.3137 5 12 5C8.68629 5 6 7.68629 6 11V17L4 19H20L18 17V11Z" fill="#234ea2"/>
                <path d="M12 3C12.5523 3 13 2.55228 13 2C13 1.44772 12.5523 1 12 1C11.4477 1 11 1.44772 11 2C11 2.55228 11.4477 3 12 3Z" fill="#234ea2"/>
              </svg>
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: 0, right: 0,
                  background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 800,
                  borderRadius: 99, minWidth: 16, height: 16, padding: '0 3px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
                <div style={{
                  position: 'absolute', right: 0, top: 42, zIndex: 9998,
                  background: '#fff', border: '1px solid #e5e5e5',
                  borderRadius: 14, width: 340, maxHeight: 480,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
                  display: 'flex', flexDirection: 'column', overflow: 'hidden',
                }}>
                  <div style={{ padding: '13px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                    <span style={{ fontWeight: 800, fontSize: 14, color: '#111' }}>알림</span>
                    {unreadCount > 0 && (
                      <button onClick={handleMarkAllRead} style={{ fontSize: 12, color: '#234ea2', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
                        모두 읽음
                      </button>
                    )}
                  </div>
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {notifications.length === 0 ? (
                      <div style={{ padding: '32px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>알림이 없습니다</div>
                    ) : notifications.map(notif => (
                      <div key={notif.id}
                        onClick={() => handleNotifClick(notif)}
                        style={{
                          padding: '11px 16px', cursor: 'pointer',
                          background: notif.is_read ? '#fff' : '#eff6ff',
                          borderBottom: '1px solid #f5f5f5',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                        onMouseLeave={e => (e.currentTarget.style.background = notif.is_read ? '#fff' : '#eff6ff')}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: notif.is_read ? 600 : 800, fontSize: 13, color: '#111', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                              {!notif.is_read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#234ea2', flexShrink: 0, display: 'inline-block' }} />}
                              {notif.title}
                            </div>
                            <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.4 }}>
                              {notif.message}
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1 }}>
                            {formatTime(notif.created_at)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
            )}
          </div>

          {/* 유저 아바타 */}
          <div ref={accountRef} style={{ position: 'relative' }}>
            <div onClick={() => { setIsOpen(!isOpen); setNotifOpen(false) }} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: '#234ea2', display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700,
              }}>
                {user?.email?.[0]?.toUpperCase() || 'U'}
              </div>
              <div style={{ fontSize: 13 }} className="pc-only">
                {user?.email || 'loading...'}
              </div>
            </div>

            {isOpen && (
              <div style={{
                position: 'absolute', right: 0, top: 40, zIndex: 10000,
                background: '#ffffff', border: '1px solid #e5e5e5',
                borderRadius: 12, padding: 8, width: 150,
                boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
              }}>
                <div onClick={() => { router.push('/account'); setIsOpen(false) }}
                  style={{ padding: '10px 12px', cursor: 'pointer', color: '#111111', fontWeight: 600, fontSize: 14, borderRadius: 8, borderBottom: '1px solid #f0f0f0' }}>
                  정보 수정
                </div>
                <div onClick={handleLogout}
                  style={{ padding: '10px 12px', cursor: 'pointer', color: '#dc2626', fontWeight: 600, fontSize: 14, borderRadius: 8 }}>
                  로그아웃
                </div>
              </div>
            )}
          </div>

          <div ref={mobileMenuRef} style={{ display: 'contents' }}>
            <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="mobile-menu-btn"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, padding: 4, color: '#111111', display: 'none' }}>
              ☰
            </button>

            {isMenuOpen && (
              <div className="mobile-menu" style={{ position: 'fixed', top: 44, left: 0, right: 0, background: '#fff', borderBottom: '1px solid #e5e5e5', zIndex: 9998, padding: '8px 0' }}>
                {menuItems.map((item) => (
                  <div key={item.label} onClick={() => { item.onClick(); setIsMenuOpen(false) }}
                    style={{ padding: '14px 24px', fontSize: 16, fontWeight: 700, color: '#111111', cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }}>
                    {item.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .pc-menu { display: none !important; }
          .pc-only { display: none !important; }
          .mobile-menu-btn { display: block !important; }
        }
      `}</style>
    </>
  )
}
