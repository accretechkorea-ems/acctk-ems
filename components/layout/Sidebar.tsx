'use client'

// 좌측 사이드바 — 예전 상단 헤더(components/home/Header.tsx)를 대신한다.
// 메뉴 구성·권한 조건·활성 표시 판정은 헤더에서 쓰던 것을 그대로 옮겼다.
//
// 한 컴포넌트가 PC·모바일 껍데기를 모두 그린다(메뉴·알림 상태를 한 벌로 쓰기 위해서다).
//   PC(769px 이상)  — 왼쪽 고정 사이드바
//   모바일(768 이하) — 상단 얇은 바 + 왼쪽에서 밀려 나오는 드로어
// 어느 쪽을 보여줄지는 HeaderWrapper 의 미디어 쿼리가 정한다.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { HOME_STATE_KEY } from '@/lib/home'
import { useOutsideClick } from '@/hooks/useOutsideClick'
import { type EngineerLike, type TeamPerm } from '@/lib/permissions'
// 메뉴 목록·권한 판정은 이 파일 한곳에서만 정한다(1단계).
import { MENU_GROUPS, MENU_PATHS, MENU_PERMS, visibleMenus, type MenuPerm } from '@/lib/menuPerms'
import { loadTeamPerms } from '@/lib/teamPerms'
import { useNotifications } from '@/hooks/useNotifications'
import { Z } from '@/lib/zIndex'

/** 사이드바 폭. 본문 margin-left 와 같아야 한다(HeaderWrapper 가 같은 값을 쓴다). */
export const SIDEBAR_WIDTH = 232
/** 접었을 때의 폭 — 아이콘만 남는다. */
export const SIDEBAR_COLLAPSED_WIDTH = 64
/** 모바일 상단 바 높이. */
export const TOPBAR_HEIGHT = 52
/** 모바일 드로어 폭. */
const DRAWER_WIDTH = 304

const BORDER = '#ebebeb'
const BG = '#f5f6f8'
const TEXT = '#111827'
const ITEM = '#374151'
const MUTED = '#6b7280'
const BLUE = '#234ea2'
const ACTIVE_BG = '#e6ecf8'

/** 로고 마크. <img> 대신 배경으로 깐다(next/image 경고를 늘리지 않는다). */
const logoMark = (size: number): CSSProperties => ({
  width: size, height: size, borderRadius: 7, flexShrink: 0,
  backgroundImage: 'url(/logo-mark.png)', backgroundSize: 'cover', backgroundPosition: 'center',
})

/** 아이콘 공통 껍데기 — 시안과 같은 선 아이콘(PC 16px / 모바일 18px, stroke 1.8). */
function I({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {children}
    </svg>
  )
}

/**
 * 아이콘 키 → 그림. 메뉴 목록(lib/menuPerms.ts)은 키만 들고 있고 그림은 여기 있다
 * (그 파일은 .ts 라 JSX 를 둘 수 없고, 목록은 화면과 무관하게 재사용된다).
 */
const ICONS: Record<string, (size: number) => ReactNode> = {
  home: s => <I size={s}><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" /></I>,
  bell: s => <I size={s}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 21a2 2 0 0 0 4 0" /></I>,
  approval: s => <I size={s}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="m9 15 2 2 4-4" /></I>,
  grid: s => <I size={s}><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="5" rx="1" /><rect x="3" y="13" width="8" height="8" rx="1" /><rect x="13" y="10" width="8" height="11" rx="1" /></I>,
  gauge: s => <I size={s}><circle cx="12" cy="12" r="9" /><path d="M12 12 16 8" /><path d="M12 3v3M21 12h-3M12 21v-3M3 12h3" /></I>,
  activity: s => <I size={s}><path d="M3 12h4l2.5-7 5 14L17 12h4" /></I>,
  building: s => <I size={s}><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3" /></I>,
  wrench: s => <I size={s}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" /></I>,
  monitor: s => <I size={s}><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M8 20h8M12 16v4" /></I>,
  userPlus: s => <I size={s}><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6" /></I>,
  kanban: s => <I size={s}><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="11" rx="1" /><rect x="17" y="4" width="4" height="7" rx="1" /></I>,
  fileText: s => <I size={s}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></I>,
  barChart: s => <I size={s}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></I>,
  package: s => <I size={s}><path d="m21 8-9-5-9 5 9 5z" /><path d="M3 8v8l9 5 9-5V8M12 13v8" /></I>,
  archive: s => <I size={s}><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" /></I>,
  message: s => <I size={s}><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></I>,
  sliders: s => <I size={s}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></I>,
}

/** 아이콘 키가 목록에만 있고 그림이 없으면 빈 자리로 두지 않고 점 하나를 그린다. */
const iconOf = (key: string, size: number): ReactNode =>
  (ICONS[key] ?? (s => <I size={s}><circle cx="12" cy="12" r="4" /></I>))(size)

const MAIN_GROUPS = MENU_GROUPS.filter(g => g.placement === 'main')
const BOTTOM_GROUPS = MENU_GROUPS.filter(g => g.placement === 'bottom')

type Props = {
  /** 접힘 여부. 저장·단축키는 HeaderWrapper 가 맡는다(본문 여백도 같이 움직여야 해서다). */
  collapsed: boolean
  onToggle: () => void
  /** 로그인 직원이 확인되면 알린다 — 접힘 상태를 계정별로 저장하는 데 쓴다. */
  onEngineerId?: (id: number) => void
}

export default function Sidebar({ collapsed, onToggle, onEngineerId }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  const [email, setEmail] = useState<string | null>(null)
  const [engineerId, setEngineerId] = useState<number | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [position, setPosition] = useState<string | null>(null)
  const [teams, setTeams] = useState<string | null>(null)
  const [permissionLevel, setPermissionLevel] = useState<string | null>(null)
  const [teamPerm, setTeamPerm] = useState<TeamPerm | null>(null)

  const [meOpen, setMeOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 접힌 상태에서 아이콘 옆에 띄우는 이름표. title 속성은 느리고 모양을 정할 수 없어 직접 그린다.
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null)
  const meRef = useRef<HTMLDivElement>(null)

  useOutsideClick(meRef, () => setMeOpen(false), meOpen)

  // 알림 로직은 공용 훅 그대로(대시보드와 같은 것을 쓴다).
  // 배지 숫자만 쓴다(목록은 /notifications 가 보여준다). 폴링 주기도 예전 그대로다.
  const { unreadCount } = useNotifications(engineerId)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getUser()
      setEmail(data.user?.email ?? null)
      if (!data.user?.email) return
      const { data: eng } = await supabase
        .from('engineers')
        .select('engineer_id, name, position, teams, permission_level')
        .eq('email', data.user.email)
        .single()
      if (!eng) return
      setEngineerId(eng.engineer_id)
      onEngineerId?.(eng.engineer_id)
      setName(eng.name ?? null)
      setPosition(eng.position ?? null)
      setTeams(eng.teams ?? null)
      setPermissionLevel(eng.permission_level ?? null)
      // 메뉴 노출은 팀 플래그로 판정한다(팀 이름을 코드에 두지 않기 위해).
      const map = await loadTeamPerms()
      setTeamPerm(eng.teams ? map.get(eng.teams) ?? null : null)
    }
    load()
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null)
    })
    return () => { listener.subscription.unsubscribe() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  // ESC — 드로어·알림·프로필을 함께 닫는다.
  useEffect(() => {
    if (!drawerOpen && !meOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setDrawerOpen(false); setMeOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen, meOpen])

  // 드로어가 열려 있는 동안 본문 스크롤을 잠근다.
  useEffect(() => {
    if (!drawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [drawerOpen])

  // 화면을 옮기면 드로어는 닫는다(항목을 눌러 이동한 경우 포함).
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  const engineer: EngineerLike | null = email ? { permission_level: permissionLevel, teams, perm: teamPerm } : null

  // 활성 표시는 "현재 경로에 가장 잘 맞는 메뉴 경로 한 개"만 고른다.
  // 완전 일치를 우선하고, 하위 경로 매칭은 더 긴 경로가 이긴다
  // (/repair 와 /repair/dashboard 처럼 한쪽이 다른 쪽의 상위 경로인 경우 때문에 필요하다).
  const matchSub = (p: string) => pathname === p || (p !== '/' && pathname.startsWith(p + '/'))
  const activePath = MENU_PATHS
    .filter(matchSub)
    .sort((a, b) => (a === pathname ? 1 : 0) - (b === pathname ? 1 : 0) || a.length - b.length)
    .pop() ?? null
  /** 모바일 상단 바에 띄우는 현재 화면 이름. 해당 메뉴가 없으면 비운다. */
  const currentLabel = MENU_PERMS.find(i => i.path === activePath)?.label ?? ''

  // '/' 는 홈 상태 초기화 + 하드 내비게이션이 필요하므로 별도 처리한다.
  const navigate = (path: string) => {
    setDrawerOpen(false)
    if (path === '/') { sessionStorage.removeItem(HOME_STATE_KEY); window.location.href = '/'; return }
    router.push(path)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const itemStyle = (active: boolean, big: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: big ? 12 : 10,
    height: big ? 44 : 32, padding: big ? '0 12px' : '0 10px',
    borderRadius: big ? 8 : 6, cursor: 'pointer', width: '100%', boxSizing: 'border-box',
    border: 'none', textAlign: 'left', fontFamily: 'inherit',
    fontSize: big ? 15 : 13, fontWeight: active ? 700 : 500,
    background: active ? ACTIVE_BG : 'transparent',
    color: active ? BLUE : ITEM,
    whiteSpace: 'nowrap',
  })

  /** 접힌 사이드바에서 아이콘 옆에 이름표를 띄운다(마우스가 벗어나면 지운다). */
  const showTip = (label: string) => (e: React.MouseEvent<HTMLElement>) => {
    if (!collapsed) return
    const r = e.currentTarget.getBoundingClientRect()
    setTip({ label, top: Math.round(r.top + r.height / 2) })
  }
  const hideTip = () => setTip(null)

  /** 메뉴 한 줄. big 이면 모바일 드로어용(터치 크기). 접힌 PC 사이드바는 아이콘만 남는다. */
  const renderItem = (item: MenuPerm, big = false) => {
    const active = item.path === activePath
    // 알림만 배지를 단다(숫자는 안 읽은 건수).
    const isNotif = item.key === 'notifications'
    const mini = collapsed && !big
    return (
      <button
        key={item.key}
        type="button"
        aria-current={active ? 'page' : undefined}
        aria-label={mini ? item.label : undefined}
        onClick={() => navigate(item.path)}
        onMouseEnter={e => {
          showTip(item.label)(e)
          if (!active) { e.currentTarget.style.background = '#eceef2'; e.currentTarget.style.color = TEXT }
        }}
        onMouseLeave={e => {
          hideTip()
          if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = ITEM }
        }}
        style={{ ...itemStyle(active, big), ...(mini ? { justifyContent: 'center', padding: 0, position: 'relative' } : null) }}
      >
        {iconOf(item.icon, big ? 18 : 16)}
        {!mini && <span>{item.label}</span>}
        {isNotif && unreadCount > 0 && (
          mini
            // 접히면 숫자가 들어갈 자리가 없다 — 아이콘 오른쪽 위에 점으로만 알린다.
            ? <span style={{ position: 'absolute', top: 5, right: 12, width: 7, height: 7, borderRadius: 99, background: BLUE }} />
            : (
              <span style={{
                marginLeft: 'auto', minWidth: big ? 20 : 18, height: big ? 20 : 18, padding: '0 6px', boxSizing: 'border-box',
                borderRadius: 99, background: BLUE, color: '#ffffff', fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )
        )}
      </button>
    )
  }

  /** 그룹 전체. 보이는 항목이 없으면 제목까지 숨긴다. 접히면 제목 대신 얇은 구분선으로 나눈다. */
  const renderGroupList = (groups: typeof MENU_GROUPS, big: boolean) => {
    const mini = collapsed && !big
    let shown = 0
    return groups.map(g => {
      const items = visibleMenus(g.group, engineer)
      if (items.length === 0) return null
      const first = shown === 0
      shown += 1
      return (
        <div key={g.group}>
          {mini
            ? <div style={{ height: 1, background: first ? 'transparent' : '#e6e8ec', margin: first ? '10px 0 0' : '8px 6px' }} />
            : g.title
              ? <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, padding: big ? '14px 12px 4px' : '14px 10px 6px', letterSpacing: '0.2px' }}>{g.title}</div>
              : <div style={{ height: big ? 8 : 10 }} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{items.map(i => renderItem(i, big))}</div>
        </div>
      )
    })
  }

  const renderGroups = (big: boolean) => renderGroupList(MAIN_GROUPS, big)
  const renderBottom = (big: boolean) => renderGroupList(BOTTOM_GROUPS, big)
  // 하단 고정 영역에 보이는 항목이 하나도 없으면 칸 자체를 그리지 않는다.
  const bottomCount = BOTTOM_GROUPS.reduce((n, g) => n + visibleMenus(g.group, engineer).length, 0)
  const initial = (name?.trim()?.[0]) || email?.[0]?.toUpperCase() || 'U'
  const meLabel = name ? `${name}${position ? ' ' + position : ''}` : (email ?? '불러오는 중...')

  /** 프로필 줄. 드로어에서는 메뉴 없이 표시만 한다(정보 수정·로그아웃은 PC 와 같은 자리). */
  const profile = (big: boolean) => (
    <>
      <span style={{
        width: big ? 32 : 30, height: big ? 32 : 30, borderRadius: 99, background: BLUE, color: '#ffffff',
        fontSize: big ? 13 : 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{initial}</span>
      <span style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
        <span style={{ fontSize: big ? 14 : 13, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meLabel}</span>
        <span style={{ fontSize: big ? 12 : 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teams ?? '-'}</span>
      </span>
    </>
  )

  return (
    <>
      {/* ── 모바일 상단 바 — 흐름 안의 sticky 라 본문이 아래로 밀린다(예전 헤더와 같은 방식).
          display 는 여기서 정하지 않는다 — 인라인이 클래스를 이겨서 PC 에서도 보였다.
          보이고 숨기는 것은 HeaderWrapper 의 .ems-topbar 규칙만 정한다. ── */}
      <header className="ems-topbar" style={{
        position: 'sticky', top: 0, zIndex: Z.sidebar,
        height: TOPBAR_HEIGHT, alignItems: 'center', gap: 8, padding: '0 8px',
        background: '#ffffff', borderBottom: `1px solid ${BORDER}`, boxSizing: 'border-box',
      }}>
        <button type="button" aria-label="메뉴 열기" onClick={() => setDrawerOpen(true)}
          style={{ width: 44, height: 44, border: 0, background: 'transparent', color: TEXT, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentLabel}</span>
        <button type="button"
          aria-label={unreadCount > 0 ? `알림 ${unreadCount}건` : '알림'}
          onClick={() => { setDrawerOpen(false); navigate('/notifications') }}
          style={{ width: 44, height: 44, border: 0, background: 'transparent', color: TEXT, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>
          {unreadCount > 0 && (
            <span style={{ position: 'absolute', top: 9, right: 9, width: 8, height: 8, borderRadius: 99, background: BLUE, border: '2px solid #ffffff' }} />
          )}
        </button>
      </header>

      {/* ── PC 사이드바 ── */}
      <nav className={`ems-sidebar${collapsed ? ' collapsed' : ''}`} aria-label="주 메뉴" style={{
        position: 'fixed', top: 0, left: 0, zIndex: Z.sidebar,
        height: '100vh', boxSizing: 'border-box',
        background: BG, borderRight: `1px solid ${BORDER}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* 브랜드 — 접히면 로고만 남고, 접기 버튼은 그 아래로 내려가 펼치기 버튼이 된다. */}
        {collapsed ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '4px 0 10px' }}>
            <div style={logoMark(30)} role="img" aria-label="아크레텍코리아" />
            <button type="button" aria-label="사이드바 펼치기"
              onMouseEnter={showTip('사이드바 펼치기')} onMouseLeave={hideTip}
              onClick={onToggle}
              style={{ width: 28, height: 28, border: 0, background: 'transparent', borderRadius: 6, color: MUTED, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 6px 12px' }}>
            <div style={logoMark(30)} role="img" aria-label="아크레텍코리아" />
            <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: TEXT, lineHeight: 1.2 }}>아크레텍코리아</span>
              <span style={{ fontSize: 11, color: MUTED, display: 'flex', alignItems: 'center', gap: 2 }}>
                계측사업부
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </span>
            </div>
            <button type="button" aria-label="사이드바 접기" onClick={onToggle}
              style={{ width: 28, height: 28, border: 0, background: 'transparent', borderRadius: 6, color: MUTED, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
            </button>
          </div>
        )}

        {/* 검색 — 표시만(동작은 뒤 단계). 접히면 돋보기만 남는다. */}
        <button type="button" aria-label="검색" disabled
          onMouseEnter={showTip('검색')} onMouseLeave={hideTip}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, height: 32,
            padding: collapsed ? 0 : '0 10px', justifyContent: collapsed ? 'center' : 'flex-start',
            borderRadius: 6, border: '1px solid #e3e5e9', background: '#ffffff', color: MUTED,
            fontSize: 13, fontFamily: 'inherit', cursor: 'default', width: '100%', boxSizing: 'border-box',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          {!collapsed && (
            <>
              <span>검색</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED, border: '1px solid #e3e5e9', borderRadius: 4, padding: '1px 5px' }}>Ctrl K</span>
            </>
          )}
        </button>

        {/* 넘칠 때만 이 안에서 스크롤한다. 브랜드·검색·프로필은 늘 제자리에 있다. */}
        <div className="ems-nav-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', marginBottom: 8 }}>
          {renderGroups(false)}
        </div>

        {bottomCount > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 8, borderBottom: '1px solid #e6e8ec', marginBottom: 8 }}>
            {renderBottom(false)}
          </div>
        )}

        {/* 프로필 — 접히면 이니셜 원만 남는다 */}
        <div ref={meRef} style={{ position: 'relative' }}>
          <button type="button" onClick={() => setMeOpen(o => !o)}
            onMouseEnter={showTip(meLabel)} onMouseLeave={hideTip}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: 0,
              background: 'transparent', padding: 6, borderRadius: 8, fontFamily: 'inherit',
              cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box',
              justifyContent: collapsed ? 'center' : 'flex-start',
            }}>
            {collapsed ? (
              <span style={{
                width: 30, height: 30, borderRadius: 99, background: BLUE, color: '#ffffff',
                fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>{initial}</span>
            ) : (
              <>
                {profile(false)}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
              </>
            )}
          </button>

          {meOpen && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, zIndex: Z.sidebarPanel,
              background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 6,
              width: 160, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            }}>
              <button type="button" onClick={() => { setMeOpen(false); router.push('/account') }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 10px', border: 'none', background: 'transparent', color: TEXT, fontWeight: 600, fontSize: 13, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>
                정보 수정
              </button>
              <button type="button" onClick={handleLogout}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 10px', border: 'none', background: 'transparent', color: '#dc2626', fontWeight: 600, fontSize: 13, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>
                로그아웃
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* 접힌 사이드바의 이름표 — 사이드바가 overflow: hidden 이라 화면 기준으로 띄운다 */}
      {collapsed && tip && (
        <div role="tooltip" style={{
          position: 'fixed', left: SIDEBAR_COLLAPSED_WIDTH + 6, top: tip.top, transform: 'translateY(-50%)',
          zIndex: Z.sidebarPanel, pointerEvents: 'none',
          background: '#111827', color: '#ffffff', borderRadius: 6, padding: '5px 9px',
          fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        }}>
          {tip.label}
        </div>
      )}

      {/* ── 모바일 드로어 — 닫혀 있어도 붙여 두고 translateX 로 민다(0.2s) ── */}
      <div className="ems-drawer-wrap" aria-hidden={!drawerOpen} style={{
        position: 'fixed', inset: 0, zIndex: Z.sidebarPanel,
        pointerEvents: drawerOpen ? 'auto' : 'none',
      }}>
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: 'absolute', inset: 0, background: 'rgba(17,24,39,0.45)',
            opacity: drawerOpen ? 1 : 0, transition: 'opacity 0.2s ease',
          }}
        />
        <nav aria-label="주 메뉴" style={{
          position: 'absolute', top: 0, left: 0, width: DRAWER_WIDTH, height: '100%', boxSizing: 'border-box',
          background: BG, borderRight: `1px solid ${BORDER}`, padding: '14px 12px',
          display: 'flex', flexDirection: 'column', overflowY: 'auto',
          boxShadow: '0 16px 40px rgba(0,0,0,0.18)',
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.2s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 4px 14px' }}>
            <div style={logoMark(32)} role="img" aria-label="아크레텍코리아" />
            <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>아크레텍코리아</span>
              <span style={{ fontSize: 12, color: MUTED }}>계측사업부</span>
            </div>
            <button type="button" aria-label="메뉴 닫기" onClick={() => setDrawerOpen(false)}
              style={{ width: 44, height: 44, border: 0, background: 'transparent', color: MUTED, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>

          <button type="button" aria-label="검색" disabled
            style={{
              display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 12px',
              borderRadius: 8, border: '1px solid #e3e5e9', background: '#ffffff', color: MUTED,
              fontSize: 14, fontFamily: 'inherit', cursor: 'default', width: '100%', boxSizing: 'border-box', textAlign: 'left',
            }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <span>검색</span>
          </button>

          <div style={{ marginTop: 8 }}>{renderGroups(true)}</div>

          <div style={{ flexGrow: 1, minHeight: 12 }} />

          {bottomCount > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 8 }}>
              {renderBottom(true)}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 6px 4px', borderTop: '1px solid #e6e8ec' }}>
            {profile(true)}
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '6px 2px 2px' }}>
            <button type="button" onClick={() => { setDrawerOpen(false); router.push('/account') }}
              style={{ flex: 1, height: 40, border: `1px solid ${BORDER}`, background: '#ffffff', color: TEXT, fontWeight: 600, fontSize: 13, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
              정보 수정
            </button>
            <button type="button" onClick={handleLogout}
              style={{ flex: 1, height: 40, border: `1px solid ${BORDER}`, background: '#ffffff', color: '#dc2626', fontWeight: 600, fontSize: 13, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
              로그아웃
            </button>
          </div>
        </nav>
      </div>

    </>
  )
}
