'use client'

// 가로 스크롤 영역에 좌우 이동 버튼을 덧붙이는 래퍼.
// 자식의 마크업을 바꾸지 않고 감싸기만 하도록, 마운트 후 자식 중에서
// overflow-x 가 auto/scroll 인 요소를 찾아 그 요소를 조작한다.
//
// - 마우스를 올렸을 때만 버튼을 띄운다 (hover 가 없는 터치 기기에서는 아예 띄우지 않는다)
// - 양끝에 닿으면 해당 방향 버튼을 감춘다
// - 스크롤할 것이 없으면 두 버튼 다 감춘다

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** 한 번 누를 때 이동할 거리(px). 기본 312 = 장비 카드 300 + gap 12 */
  step?: number
}

// overflow-x 가 스크롤 가능한 첫 요소를 너비 우선으로 찾는다
function findScrollable(root: HTMLElement): HTMLElement | null {
  const queue: HTMLElement[] = [root]
  while (queue.length) {
    const el = queue.shift()!
    if (el !== root) {
      const ox = getComputedStyle(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return el
    }
    for (const c of Array.from(el.children)) queue.push(c as HTMLElement)
  }
  return null
}

const hoverCapable = () =>
  typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches

export default function HorizontalScroller({ children, step = 312 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const elRef = useRef<HTMLElement | null>(null)
  const [hovered, setHovered] = useState(false)
  const [edge, setEdge] = useState({ left: false, right: false })

  useLayoutEffect(() => {
    const root = wrapRef.current
    if (!root) return
    const el = findScrollable(root)
    elRef.current = el
    if (!el) return

    // 값이 그대로면 상태를 바꾸지 않는다 (불필요한 리렌더 방지)
    const update = () => setEdge(prev => {
      const max = el.scrollWidth - el.clientWidth
      const next = { left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 }
      return prev.left === next.left && prev.right === next.right ? prev : next
    })
    update()

    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // 카드가 뒤늦게 추가/삭제되면 scrollWidth 가 바뀌므로 자식 변화도 본다
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true })

    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
      mo.disconnect()
    }
  }, [])

  const scroll = (dir: -1 | 1) => {
    elRef.current?.scrollBy({ left: dir * step, behavior: 'smooth' })
  }

  const arrow = (dir: -1 | 1) => (
    <button
      onClick={() => scroll(dir)}
      aria-label={dir === -1 ? '왼쪽으로 이동' : '오른쪽으로 이동'}
      style={{
        position: 'absolute', top: '50%', transform: 'translateY(-50%)',
        ...(dir === -1 ? { left: 4 } : { right: 4 }),
        zIndex: 2, width: 30, height: 30, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.95)', border: '1px solid #ebebeb',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        cursor: 'pointer', color: '#6b7280', padding: 0,
      }}
      onMouseEnter={e => { e.currentTarget.style.color = '#111827' }}
      onMouseLeave={e => { e.currentTarget.style.color = '#6b7280' }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {dir === -1 ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
      </svg>
    </button>
  )

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative' }}
      onMouseEnter={() => { if (hoverCapable()) setHovered(true) }}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && edge.left && arrow(-1)}
      {hovered && edge.right && arrow(1)}
    </div>
  )
}
