// 로그인 영역의 껍데기 — 좌측 사이드바(PC) 또는 상단 바 + 드로어(모바일) + 본문.
// 공개 페이지(로그인·리드 등록)에서는 아무것도 감싸지 않고 본문만 전체 폭으로 둔다.
//
// 사이드바 접힘 상태를 여기서 들고 있다 — 사이드바 폭과 본문 여백이 함께 움직여야 하고,
// 저장·단축키도 한곳에 모아 두는 편이 낫기 때문이다.
//
// 접힘은 두 겹이다.
//   collapsed     — 사용자가 고른 값. 계정별로 localStorage 에 저장한다.
//   tempCollapsed — 화면별 임시 값(null 이면 저장값을 그대로 따른다). 화면 안에 자체 레일이 있어
//                   넓게 써야 하는 곳에서만 켜지고(lib/railPaths.ts), 그 화면을 벗어나면 null 로
//                   돌아가 저장값이 다시 드러난다.
//                   임시 값은 절대 저장하지 않는다 — 다음 로그인·다른 화면에 영향을 주면 안 된다.
'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar, { COLLAPSE_EASE, COLLAPSE_MS, SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from '@/components/layout/Sidebar'
import NoticePopup from '@/components/common/NoticePopup'
import { isPublicPath } from '@/lib/publicPaths'
import { hasInnerRail } from '@/lib/railPaths'

/** 폭 경계. 이 아래는 상단 바 + 드로어, 위는 고정 사이드바. */
const MOBILE_MAX = 768

// 들어가면 사이드바를 접어 두는 화면 — 화면 안에 자체 레일이 있는 곳이다.
// 목록과 판정은 lib/railPaths.ts 한 곳에 있다(전자결재·의뢰서가 같은 것을 쓴다).
// 저장된 설정은 건드리지 않는다 — 이 화면을 벗어나면 원래대로 돌아온다.

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
  // 화면별 임시 접힘. null 이면 저장값(collapsed)을 그대로 쓴다.
  // 첫 그림부터 맞춰 두어, 그런 화면을 바로 열었을 때 폈다가 접히는 움직임이 보이지 않게 한다.
  const [tempCollapsed, setTempCollapsed] = useState<boolean | null>(() => (hasInnerRail(pathname) ? true : null))
  const wide = hasInnerRail(pathname)
  /** 실제로 그리는 값 — 임시 값이 있으면 그것이 이긴다. */
  const shown = tempCollapsed ?? collapsed

  // 레일이 있는 화면에 들어가면 접고, 벗어나면 임시 값을 버려 저장값으로 돌아간다.
  // 그 화면 안에서 사용자가 직접 펼친 경우에는 경로가 그대로라 이 효과가 다시 돌지 않는다
  // — 머무는 동안 펼친 채로 남고, 나갔다 다시 들어오면 wide 가 false→true 로 바뀌며 다시 접힌다.
  useEffect(() => { setTempCollapsed(wide ? true : null) }, [wide])

  // 계정이 확인되면 그 계정의 저장값으로 맞춘다(저장된 적이 없으면 지금 값을 그 계정 값으로 둔다).
  useEffect(() => {
    if (engineerId == null) return
    const mine = readFlag(keyOf(engineerId))
    if (mine === null) writeFlag(keyOf(engineerId), collapsed)
    else if (mine !== collapsed) setCollapsed(mine)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineerId])

  const toggle = () => {
    // 레일이 있는 화면에서는 임시 값만 움직인다. 저장된 설정은 읽지도 쓰지도 않는다 —
    // 「이 화면에서만 잠깐 펼쳐 둔다」가 다음 로그인까지 따라가면 안 되기 때문이다.
    if (wide) { setTempCollapsed(!shown); return }
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
    // toggle 이 보는 값(wide·shown)이 바뀌면 처리기를 다시 단다 — 옛 값을 쥔 처리기가 남으면
    // 결재 화면에서 Ctrl+\ 를 눌렀을 때 저장값을 건드리게 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineerId, wide, shown])

  if (isPublicPath(pathname)) return <>{children}</>

  // 공지 팝업도 여기에 둔다 — 로그인 영역에서만 렌더되고, 레이아웃에 붙어 있어
  // 화면을 옮겨 다녀도 다시 마운트되지 않는다(팝업이 매번 뜨지 않게 하는 조건).
  return (
    <>
      <style>{`
        /* 사이드바 폭과 본문 여백은 늘 같이 움직인다.
           폭·여백은 transform 처럼 합성만으로 그릴 수 없어(움직일 때마다 배치를 다시 계산한다)
           짧게 끊고 끝에서 부드럽게 멈추는 가속도를 쓴다.
           ★ 이 시간은 Sidebar.tsx 의 COLLAPSE_MS 와 항상 같아야 한다 —
             거기서 이 시간 동안에만 will-change 를 붙인다. 한쪽을 바꾸면 다른 쪽도 같이 바꾼다. */
        .ems-sidebar { width: ${SIDEBAR_WIDTH}px; padding: 12px 10px; transition: width ${COLLAPSE_MS}ms ${COLLAPSE_EASE}, padding ${COLLAPSE_MS}ms ${COLLAPSE_EASE}; }
        .ems-sidebar.collapsed { width: ${SIDEBAR_COLLAPSED_WIDTH}px; padding: 12px 8px; }
        .ems-main { margin-left: ${SIDEBAR_WIDTH}px; transition: margin-left ${COLLAPSE_MS}ms ${COLLAPSE_EASE}; }
        .ems-main.collapsed { margin-left: ${SIDEBAR_COLLAPSED_WIDTH}px; }
        /* 모바일 전용 껍데기는 PC 에서 자리를 차지하지 않는다.
           display 는 여기서만 정한다 — 컴포넌트에 인라인으로 두면 이 규칙을 이긴다. */
        .ems-topbar, .ems-drawer-wrap { display: none; }
        /* 사이드바 가운데 메뉴 영역(.ems-nav-scroll)의 스크롤바 규칙은 여기에 두지 않는다.
           ★ Sidebar.tsx 의 MOTION_CSS 한곳에서만 정한다 — 여기에 같은 규칙을 다시 쓰면 안 된다.
           두 곳에 나뉘어 있으면 고칠 방법이 없어진다: 크로미움은 요소에 표준 속성
           (scrollbar-width·scrollbar-color)이 선언되어 있기만 하면 ::-webkit-scrollbar 규칙을
           통째로 무시하는데, 이 무시는 뒤에 오는 style 태그로 덮을 수 없다(캐스케이드 우선순위가
           아니라 스크롤바를 어느 방식으로 그릴지 고르는 단계다). 선언을 지우는 것만이 방법이다. */
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
      <Sidebar collapsed={shown} onToggle={toggle} onEngineerId={setEngineerId} />
      <div className={`ems-main${shown ? ' collapsed' : ''}`}>{children}</div>
      <NoticePopup />
    </>
  )
}
