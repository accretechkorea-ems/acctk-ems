'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type FocusEvent as ReactFocusEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { HOME_STATE_KEY } from '@/lib/home'
import { useOutsideClick } from '@/hooks/useOutsideClick'
import {
  canAccess80, canAccess20, canAccessQuote, canAccessSales,
  canAccessAdmin, canAccessMaintenance, type EngineerLike,
} from '@/lib/permissions'
import { useNotifications, type Notification } from '@/hooks/useNotifications'
import NotificationList from '@/components/common/NotificationList'

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
  const [notifOpen, setNotifOpen] = useState(false)
  const [hoveredMenu, setHoveredMenu] = useState<string | null>(null)   // PC 드롭다운
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null) // 모바일 아코디언
  const [menuFocusIndex, setMenuFocusIndex] = useState(-1) // 드롭다운 키보드 포커스 인덱스(-1=없음)
  // 열린 드롭다운의 가로 정렬: 기본은 트리거 기준 중앙, 화면 밖으로 넘치는 가장자리 메뉴만 좌/우로 예외 처리.
  const [menuAlign, setMenuAlign] = useState<'center' | 'left' | 'right'>('center')

  const notifRef = useRef<HTMLDivElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)   // 여는 지연 핸들
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)  // 닫는 지연 핸들
  const tabRefs = useRef<Record<string, HTMLSpanElement | null>>({})     // 상위 탭(ESC 복귀용)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])                  // 열린 드롭다운의 하위 항목
  const panelRef = useRef<HTMLDivElement>(null)                          // 열린 드롭다운 패널(오버플로 측정용)

  useOutsideClick(notifRef, () => setNotifOpen(false), notifOpen)
  useOutsideClick(accountRef, () => setIsOpen(false), isOpen)
  useOutsideClick(mobileMenuRef, () => setIsMenuOpen(false), isMenuOpen)

  // 알림 로직은 공용 훅으로 일원화(대시보드와 공유).
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications(engineerId)

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
        }
      }
    }
    getUser()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => { listener.subscription.unsubscribe() }
  }, [])

  // 드롭다운이 키보드로 열렸을 때(menuFocusIndex>=0) 해당 하위 항목에 실제 포커스를 준다.
  useEffect(() => {
    if (hoveredMenu && menuFocusIndex >= 0) itemRefs.current[menuFocusIndex]?.focus()
  }, [hoveredMenu, menuFocusIndex])

  // 드롭다운 정렬: 트리거 기준 중앙이 기본. 다만 좌/우 끝 메뉴에서 중앙 정렬 시 패널이
  // 화면(헤더) 밖으로 삐져나가는 경우에만 해당 항목을 좌/우 가장자리 정렬로 예외 처리한다.
  // 패널 폭은 렌더 후에야 알 수 있으므로 열린 뒤 측정한다.
  useEffect(() => {
    if (!hoveredMenu) return
    const panel = panelRef.current
    const trigger = tabRefs.current[hoveredMenu]
    if (!panel || !trigger) return
    const MARGIN = 12 // 화면 가장자리 최소 여백
    const t = trigger.getBoundingClientRect()
    const center = t.left + t.width / 2
    const half = panel.offsetWidth / 2
    if (center - half < MARGIN) setMenuAlign('left')
    else if (center + half > window.innerWidth - MARGIN) setMenuAlign('right')
    else setMenuAlign('center')
  }, [hoveredMenu])

  // 언마운트 시 지연 타이머 정리
  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const handleNotifClick = (notif: Notification) => {
    markAsRead(notif.id)
    setNotifOpen(false)
    if (notif.link) router.push(notif.link)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  // 권한 판정은 lib/permissions.ts 로 일원화한다(조건식을 여기 직접 쓰지 않는다).
  const engineer: EngineerLike | null = user ? { permission_level: permissionLevel, teams: engineerTeams } : null

  // 2단 메뉴 구조: path(단일 링크) 또는 children(드롭다운) 중 하나만 갖는다.
  type MenuNode = {
    label: string
    path?: string
    children?: { label: string; path: string }[]
    canAccess: (e: EngineerLike | null) => boolean
  }
  const menu: MenuNode[] = [
    { label: '80', canAccess: canAccess80, children: [{ label: '고객사 현황', path: '/' }] },
    { label: '20', canAccess: canAccess20, children: [{ label: '입고 등록', path: '/repair' }, { label: '수리 현황 대시보드', path: '/repair/dashboard' }] },
    { label: '견적서', canAccess: canAccessQuote, path: '/quote' },
    { label: '건의사항', canAccess: canAccessQuote, path: '/suggestions' },
    { label: '영업관리', canAccess: canAccessSales, children: [{ label: '발주관리', path: '/purchase' }, { label: '재고관리', path: '/inventory' }] },
    { label: '관리자', canAccess: canAccessAdmin, children: [{ label: '실적 현황', path: '/sales' }, { label: '활동 현황', path: '/activity' }] },
    { label: '유지보수', canAccess: canAccessMaintenance, path: '/admin' },
  ]
  const visibleMenu = menu.filter(m => m.canAccess(engineer))

  // '/' 는 홈 상태 초기화 + 하드 내비게이션이 필요하므로 별도 처리한다.
  const navigate = (path: string) => {
    if (path === '/') { sessionStorage.removeItem(HOME_STATE_KEY); window.location.href = '/'; return }
    router.push(path)
  }
  const matchExact = (p: string) => pathname === p
  const matchSub = (p: string) => pathname === p || (p !== '/' && pathname.startsWith(p + '/'))
  const isNodeActive = (m: MenuNode) => m.path ? matchSub(m.path) : !!m.children?.some(c => matchSub(c.path))

  // ── 드롭다운 호버 지연 (Linear 방식) ──
  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    openTimer.current = null; closeTimer.current = null
  }
  // 여는 지연 100ms(스침 방지). 단, 이미 다른 탭이 열려 있으면 지연 없이 즉시 전환.
  const scheduleOpen = (label: string) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    if (hoveredMenu !== null) { setHoveredMenu(label); setMenuFocusIndex(-1); return }
    if (openTimer.current) clearTimeout(openTimer.current)
    openTimer.current = setTimeout(() => { setHoveredMenu(label); setMenuFocusIndex(-1) }, 100)
  }
  // 닫는 지연 300ms(상위 탭→하위 항목 이동 중 닫힘 방지).
  const scheduleClose = () => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null }
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { setHoveredMenu(null); setMenuFocusIndex(-1) }, 300)
  }
  const openMenuNow = (label: string) => { clearTimers(); setHoveredMenu(label) }
  const closeMenuNow = () => { clearTimers(); setHoveredMenu(null); setMenuFocusIndex(-1) }

  // ── 키보드 접근 ──
  const onTabKeyDown = (e: ReactKeyboardEvent, m: MenuNode) => {
    const hasChildren = !!m.children?.length
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!hasChildren) { if (m.path) navigate(m.path); return }
      if (hoveredMenu === m.label) closeMenuNow()
      else { openMenuNow(m.label); setMenuFocusIndex(0) }
    } else if (hasChildren && e.key === 'ArrowDown') {
      e.preventDefault(); openMenuNow(m.label); setMenuFocusIndex(0)
    } else if (e.key === 'Escape') {
      closeMenuNow()
    }
  }
  const onItemKeyDown = (e: ReactKeyboardEvent, m: MenuNode, index: number) => {
    const len = m.children!.length
    if (e.key === 'ArrowDown') { e.preventDefault(); setMenuFocusIndex(Math.min(index + 1, len - 1)) }
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (index === 0) { setMenuFocusIndex(-1); tabRefs.current[m.label]?.focus() } // 상위 탭으로 복귀
      else setMenuFocusIndex(index - 1)
    }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(m.children![index].path); closeMenuNow() }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenuNow(); tabRefs.current[m.label]?.focus() }
  }
  // 포커스가 상위 탭+드롭다운 영역 밖으로 나가면 닫는다.
  const onWrapperBlur = (e: ReactFocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) closeMenuNow()
  }

  return (
    <>
      <div style={{
        position: 'sticky', top: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 20px', borderBottom: '1px solid #e5e5e5',
        background: '#fff', minHeight: 44,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* 로고 → 개인 대시보드(/dashboard). 페이지는 아직 없고 링크만 건다. */}
          <img src="/headerlogo.png" alt="logo" style={{ height: 24, cursor: 'pointer' }} onClick={() => router.push('/dashboard')} />

          <div style={{ display: 'flex', gap: 20 }} className="pc-menu">
            {visibleMenu.map((m) => {
              const active = isNodeActive(m)
              const hasChildren = !!m.children?.length
              return (
                <div key={m.label} style={{ position: 'relative' }}
                  onMouseEnter={() => hasChildren ? scheduleOpen(m.label) : scheduleClose()}
                  onMouseLeave={scheduleClose}
                  onBlur={onWrapperBlur}>
                  <span
                    ref={el => { tabRefs.current[m.label] = el }}
                    tabIndex={0}
                    role="button"
                    aria-haspopup={hasChildren ? 'menu' : undefined}
                    aria-expanded={hasChildren ? hoveredMenu === m.label : undefined}
                    onClick={() => { if (m.path) navigate(m.path); else if (m.children?.[0]) navigate(m.children[0].path) }}
                    onKeyDown={(e) => onTabKeyDown(e, m)}
                    style={{
                      fontSize: 16, fontWeight: 700,
                      color: active ? '#234ea2' : '#111111',
                      cursor: 'pointer', whiteSpace: 'nowrap', paddingBottom: 4,
                      borderBottom: active ? '2.5px solid #234ea2' : '2.5px solid transparent',
                      transition: 'all 0.15s', display: 'inline-block', outline: 'none',
                    }}>
                    {m.label}
                  </span>

                  {/* 드롭다운: 트리거 기준 가로 중앙(left:50% + translateX(-50%)). paddingTop 6 이 상위 탭과
                      패널을 끊김 없이 연결한다(투명 브리지). 가장자리에서 넘칠 때만 menuAlign 으로 좌/우 정렬. */}
                  {hasChildren && hoveredMenu === m.label && (
                    <div role="menu" ref={panelRef}
                      style={{
                        position: 'absolute', top: '100%', paddingTop: 6, zIndex: 9998,
                        ...(menuAlign === 'center'
                          ? { left: '50%', transform: 'translateX(-50%)' }
                          : menuAlign === 'right' ? { right: 0 } : { left: 0 }),
                      }}>
                      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', padding: 6, minWidth: 180, width: 'fit-content' }}>
                        {m.children!.map((c, i) => {
                          const cActive = matchExact(c.path)
                          return (
                            <div key={c.path}
                              ref={el => { itemRefs.current[i] = el }}
                              role="menuitem"
                              tabIndex={-1}
                              onClick={() => { navigate(c.path); closeMenuNow() }}
                              onKeyDown={(e) => onItemKeyDown(e, m, i)}
                              style={{
                                height: 34, display: 'flex', alignItems: 'center',
                                padding: '0 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
                                fontSize: 14, fontWeight: cActive ? 700 : 500,
                                color: cActive ? '#234ea2' : '#111111',
                                background: 'transparent', outline: 'none',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                              onFocus={e => (e.currentTarget.style.background = '#f5f5f5')}
                              onBlur={e => (e.currentTarget.style.background = 'transparent')}>
                              {c.label}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
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
                      <button onClick={markAllAsRead} style={{ fontSize: 12, color: '#234ea2', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
                        모두 읽음
                      </button>
                    )}
                  </div>
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    <NotificationList notifications={notifications} onItemClick={handleNotifClick} />
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
              <div className="mobile-menu" style={{ position: 'fixed', top: 44, left: 0, right: 0, background: '#fff', borderBottom: '1px solid #e5e5e5', zIndex: 9998, padding: '8px 0', maxHeight: 'calc(100vh - 44px)', overflowY: 'auto' }}>
                {visibleMenu.map((m) => {
                  const hasChildren = !!m.children?.length
                  // 하위 없는 탭(견적서·유지보수): 바로 이동
                  if (!hasChildren) {
                    return (
                      <div key={m.label} onClick={() => { navigate(m.path!); setIsMenuOpen(false) }}
                        style={{ padding: '14px 24px', fontSize: 16, fontWeight: 700, color: isNodeActive(m) ? '#234ea2' : '#111111', cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }}>
                        {m.label}
                      </div>
                    )
                  }
                  // 드롭다운 탭: 호버가 없으므로 아코디언(누르면 하위 펼침)
                  const expanded = mobileExpanded === m.label
                  return (
                    <div key={m.label} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <div onClick={() => setMobileExpanded(expanded ? null : m.label)}
                        style={{ padding: '14px 24px', fontSize: 16, fontWeight: 700, color: isNodeActive(m) ? '#234ea2' : '#111111', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{m.label}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                          style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </div>
                      {expanded && (
                        <div style={{ background: '#fafafa' }}>
                          {m.children!.map((c) => (
                            <div key={c.path} onClick={() => { navigate(c.path); setIsMenuOpen(false); setMobileExpanded(null) }}
                              style={{ padding: '12px 24px 12px 40px', fontSize: 15, fontWeight: 600, color: matchExact(c.path) ? '#234ea2' : '#333333', cursor: 'pointer' }}>
                              {c.label}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
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
