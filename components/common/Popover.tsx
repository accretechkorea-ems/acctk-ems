'use client'

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Z } from '@/lib/zIndex'

/**
 * 앵커에 붙어 뜨는 패널(드롭다운·팝오버·툴팁) 공통 부품.
 *
 * 왜 필요한가: 떠 있는 UI 를 `position: absolute` 로 두면 조상 중 하나라도
 * overflow 가 visible 이 아닌 순간 잘린다. 표 컨테이너·모달 본문·목록 상자가
 * 전부 그렇다. z-index 를 아무리 올려도 자르는 것은 조상이라 소용이 없다.
 * 그래서 패널을 document.body 로 포털해 fixed 로 띄우고, 위치만 앵커의 화면
 * 좌표에서 계산한다. 조상의 overflow 와 무관해진다.
 *
 * 새로 만든 방식이 아니라 이미 이 코드베이스에서 두 번 쓰인 것을 모은 것이다 —
 * 수리 목록의 메모 팝오버, 고객사 상세의 단계 메뉴.
 *
 * 아래에 자리가 모자라면 위로 뒤집고, 좌우로 넘치면 화면 안으로 민다.
 * 그래도 넘치면 남는 높이만큼만 쓰고 패널 안에서 스크롤된다.
 */

/** 앵커·패널과 화면 가장자리 사이에 남겨 둘 여백 */
const MARGIN = 8

type Placement = { left: number; top: number; maxHeight: number; width?: number }

type Props = {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  /** 바깥 클릭·ESC 로 닫을 때 불린다. 툴팁처럼 닫을 일이 없으면 빈 함수를 준다. */
  onClose: () => void
  /** 앵커 기준 가로 정렬. start=왼쪽 맞춤, center=가운데, end=오른쪽 맞춤 */
  align?: 'start' | 'center' | 'end'
  /** 앵커와 패널 사이 간격(px) */
  gap?: number
  /** 먼저 시도할 방향. 자리가 모자라면 반대쪽으로 뒤집는다. 기본은 아래. */
  prefer?: 'bottom' | 'top'
  /** 폭을 앵커에 맞춘다(입력칸 아래 검색 결과처럼) */
  matchAnchorWidth?: boolean
  /** 고정 폭(px). matchAnchorWidth 보다 우선한다. */
  width?: number
  /** 패널 최대 높이(px). 화면에 남는 공간과 비교해 더 작은 쪽을 쓴다. */
  maxHeight?: number
  /** 패널 스타일. 배경·테두리 등 생김새는 호출부가 정한다. */
  style?: CSSProperties
  className?: string
  children: ReactNode
}

/**
 * 앵커 좌표를 재서 패널을 놓을 자리를 계산한다.
 * 열려 있는 동안 스크롤·리사이즈·패널 크기 변화마다 다시 잰다. 스크롤은 capture 로
 * 듣는다 — 표 컨테이너나 모달 본문처럼 안쪽에서 스크롤되는 요소는 이벤트가
 * window 까지 올라오지 않기 때문이다.
 */
export function useAnchorRect(
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: { current: HTMLElement | null },
  open: boolean,
  opts: { align: 'start' | 'center' | 'end'; gap: number; prefer: 'bottom' | 'top'; width?: number; maxHeight?: number; matchAnchorWidth?: boolean },
) {
  const [pos, setPos] = useState<Placement | null>(null)
  const { align, gap, prefer, width, maxHeight, matchAnchorWidth } = opts

  const place = useCallback(() => {
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (!anchor || !panel) return
    const rect = anchor.getBoundingClientRect()
    // 앵커가 사라졌거나 숨겨졌으면 자리를 옮기지 않는다.
    if (rect.width === 0 && rect.height === 0) return

    // 높이는 내용 높이(scrollHeight)로 잰다. 우리가 준 maxHeight 에 영향받지 않아야
    // 계산 결과가 다시 입력이 되는 되먹임이 생기지 않는다.
    const contentH = panel.scrollHeight
    const w = width ?? (matchAnchorWidth ? rect.width : panel.offsetWidth)

    const below = window.innerHeight - rect.bottom - gap - MARGIN
    const above = rect.top - gap - MARGIN
    // 먼저 시도할 쪽에 자리가 모자라고 반대쪽이 더 넓을 때만 뒤집는다.
    const flip = prefer === 'top'
      ? !(contentH > above && below > above)   // 위가 기본 — 위가 모자라면 아래로
      : contentH > below && above > below
    const room = Math.max(80, flip ? above : below)
    const cap = Math.min(room, maxHeight ?? room)

    const top = flip ? rect.top - gap - Math.min(contentH, cap) : rect.bottom + gap
    const raw = align === 'end' ? rect.right - w
      : align === 'center' ? rect.left + rect.width / 2 - w / 2
      : rect.left
    const left = Math.min(Math.max(MARGIN, raw), Math.max(MARGIN, window.innerWidth - w - MARGIN))

    const next: Placement = { left, top, maxHeight: cap, width: matchAnchorWidth ? rect.width : width }
    setPos(prev => (
      prev && prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight && prev.width === next.width
        ? prev   // 값이 그대로면 새 객체를 넣지 않는다(스크롤마다 재렌더되지 않게)
        : next
    ))
  }, [anchorRef, panelRef, align, gap, prefer, width, maxHeight, matchAnchorWidth])

  // 패널이 붙는 순간(커밋 시점, 화면에 그려지기 전) 첫 자리를 잡는다.
  const attachPanel = useCallback((el: HTMLElement | null) => {
    panelRef.current = el
    if (el) place()
  }, [panelRef, place])

  useLayoutEffect(() => {
    if (!open) return
    // 내용이 바뀌어 패널 크기가 달라지면 자리도 다시 잡는다.
    const ro = new ResizeObserver(place)
    if (panelRef.current) ro.observe(panelRef.current)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place, panelRef])

  return { pos, attachPanel }
}

export default function Popover({
  anchorRef, open, onClose, align = 'start', gap = 4, prefer = 'bottom',
  matchAnchorWidth, width, maxHeight, style, className, children,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const { pos, attachPanel } = useAnchorRect(anchorRef, panelRef, open, { align, gap, prefer, width, maxHeight, matchAnchorWidth })

  // 바깥 클릭·ESC 로 닫기. 앵커 위 클릭은 호출부의 토글에 맡긴다
  // (여기서 닫아 버리면 토글이 곧바로 다시 열어 깜빡인다).
  useLayoutEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      if (anchorRef.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchorRef])

  // 서버 렌더에는 body 가 없다. open 은 항상 사용자의 조작으로 켜지므로
  // 서버·첫 렌더에서는 어차피 그릴 것이 없다.
  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={attachPanel}
      className={className}
      style={{
        position: 'fixed',
        zIndex: Z.popover,
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        maxHeight: pos?.maxHeight,
        overflowY: 'auto',
        ...(pos?.width != null ? { width: pos.width } : null),
        // 자리를 잡기 전 한 프레임 동안 (0,0) 에서 번쩍이지 않게 감춘다.
        visibility: pos ? 'visible' : 'hidden',
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
