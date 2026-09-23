// 로그인 영역의 껍데기 — 좌측 사이드바(PC) 또는 상단 바 + 드로어(모바일) + 본문.
// 공개 페이지(로그인·리드 등록)에서는 아무것도 감싸지 않고 본문만 전체 폭으로 둔다.
//
// 사이드바 접힘 상태를 여기서 들고 있다 — 사이드바 폭과 본문 여백이 함께 움직여야 하고,
// 저장·단축키도 한곳에 모아 두는 편이 낫기 때문이다.
'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar, { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from '@/components/layout/Sidebar'
import NoticePopup from '@/components/common/NoticePopup'
import { isPublicPath } from '@/lib/publicPaths'

/** 폭 경계. 이 아래는 상단 바 + 드로어, 위는 고정 사이드바. */
const MOBILE_MAX = 768

/**
 * 접힘 상태 저장.
 *   sidebar:collapsed:<engineer_id> — 계정별 값(이것이 기준이다)
 *   sidebar:collapsed:last          — 직전 값. 첫 페인트에 쓴다.
 *
 * 직원 조회는 비동기라 첫 렌더에는 engineer_id 를 모른다. 그때 펼친 채로 그렸다가
 * 접힘으로 바뀌면 화면이 한 번 튄다. 그래서 계정과 무관한 직전 값을 따로 두고,
 * 계정이 확인되면 그 계정의 값으로 맞춘다(보통 같은 값이라 아무 일도 일어나지 않는다).
 */
const LAST_KEY = 'sidebar:collapsed:last'
const keyOf = (engineerId: number) => `sidebar:collapsed:${engineerId}`

function readFlag(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key)
    return v === null ? null : v === '1'
  } catch {
    // 비공개 모드·저장소 차단. 접힘 상태를 기억하지 못할 뿐 화면은 그대로 동작한다.
    return null
  }
}
function writeFlag(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? '1' : '0') } catch { /* 저장 못 해도 접기는 동작한다 */ }
}

/** 입력 중에는 단축키를 먹지 않는다. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable
}

export default function HeaderWrapper({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  // 첫 렌더에서 바로 직전 값을 쓴다 — 펼침으로 그렸다가 접히는 깜빡임을 막는다.
  const [collapsed, setCollapsed] = useState(() => readFlag(LAST_KEY) ?? false)
  const [engineerId, setEngineerId] = useState<number | null>(null)

  // 계정이 확인되면 그 계정의 저장값으로 맞춘다(저장된 적이 없으면 지금 값을 그 계정 값으로 둔다).
  useEffect(() => {
    if (engineerId == null) return
    const mine = readFlag(keyOf(engineerId))
    if (mine === null) writeFlag(keyOf(engineerId), collapsed)
    else if (mine !== collapsed) setCollapsed(mine)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineerId])

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev
      writeFlag(LAST_KEY, next)
      if (engineerId != null) writeFlag(keyOf(engineerId), next)
      return next
    })
  }

  // Ctrl + \ — 입력칸에 있을 때는 무시한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key !== '\\') return
      if (isTyping(e.target)) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineerId])

  if (isPublicPath(pathname)) return <>{children}</>

  // 공지 팝업도 여기에 둔다 — 로그인 영역에서만 렌더되고, 레이아웃에 붙어 있어
  // 화면을 옮겨 다녀도 다시 마운트되지 않는다(팝업이 매번 뜨지 않게 하는 조건).
  return (
    <>
      <style>{`
        /* 사이드바 폭과 본문 여백은 늘 같이 움직인다 */
        .ems-sidebar { width: ${SIDEBAR_WIDTH}px; padding: 12px 10px; transition: width 0.2s ease, padding 0.2s ease; }
        .ems-sidebar.collapsed { width: ${SIDEBAR_COLLAPSED_WIDTH}px; padding: 12px 8px; }
        .ems-main { margin-left: ${SIDEBAR_WIDTH}px; transition: margin-left 0.2s ease; }
        .ems-main.collapsed { margin-left: ${SIDEBAR_COLLAPSED_WIDTH}px; }
        /* 모바일 전용 껍데기는 PC 에서 자리를 차지하지 않는다.
           display 는 여기서만 정한다 — 컴포넌트에 인라인으로 두면 이 규칙을 이긴다. */
        .ems-topbar, .ems-drawer-wrap { display: none; }
        /* 사이드바 가운데 메뉴 영역 — 넘칠 때만 스크롤하고, 스크롤바는 평소 보이지 않는다 */
        .ems-nav-scroll { scrollbar-width: thin; scrollbar-color: transparent transparent; }
        .ems-nav-scroll:hover { scrollbar-color: #d1d5db transparent; }
        .ems-nav-scroll::-webkit-scrollbar { width: 6px; }
        .ems-nav-scroll::-webkit-scrollbar-track { background: transparent; }
        .ems-nav-scroll::-webkit-scrollbar-thumb { background: transparent; border-radius: 99px; }
        .ems-nav-scroll:hover::-webkit-scrollbar-thumb { background: #d1d5db; }
        /* 알림 패널 — PC 는 사이드바 오른쪽 */
        .ems-notif { left: ${SIDEBAR_WIDTH + 6}px; top: 72px; width: 340px; }
        @media (max-width: ${MOBILE_MAX}px) {
          .ems-sidebar { display: none !important; }
          .ems-main, .ems-main.collapsed { margin-left: 0; }
          .ems-topbar { display: flex; }
          .ems-drawer-wrap { display: block; }
          /* 모바일은 상단 바 아래 전체 폭 */
          .ems-notif { left: 8px; right: 8px; top: 60px; width: auto; }
        }
      `}</style>
      <Sidebar collapsed={collapsed} onToggle={toggle} onEngineerId={setEngineerId} />
      <div className={`ems-main${collapsed ? ' collapsed' : ''}`}>{children}</div>
      <NoticePopup />
    </>
  )
}
