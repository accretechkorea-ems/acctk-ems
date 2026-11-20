'use client'

/**
 * 스크롤 힌트 — 목록 **위·아래**로 더 있다는 표시.
 *
 * 왜 둘 다인가(2026-11-20): 아래쪽 ⌄ 하나만 있어서, 목록을 내린 뒤에는 위로 더
 * 있다는 것을 알 길이 없었다(스크롤바를 숨겨 두었으므로 더욱). 같은 모양의 표시를
 * 위에도 둔다 — 보이는 쪽이 곧 「그쪽으로 더 있다」는 뜻이다.
 *
 * 쓰는 쪽은 **구르는 요소**(overflow-y: auto)의 ref 를 준다. 이 부품은 그 요소를
 * 지켜보다가(스크롤·크기 변화) 위/아래 표시만 켠다. 눌러서 움직이지는 않는다 —
 * 표시일 뿐이라 포인터 이벤트를 받지 않는다.
 */

import { useEffect, useState, type RefObject } from 'react'
import { R } from '@/lib/radius'

const BORDER = '#ebebeb'
const SUB = '#6b7280'

type Props = {
  /** 구르는 요소. 이 요소의 스크롤 위치로 위·아래를 가른다. */
  scrollRef: RefObject<HTMLElement | null>
  /** 바깥 상자 안에서 힌트를 띄울 위치(px). 머리줄이 있으면 그만큼 내린다. */
  top?: number
  bottom?: number
}

export default function ScrollHints({ scrollRef, top = 8, bottom = 8 }: Props) {
  const [more, setMore] = useState({ up: false, down: false })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const check = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setMore({
          up: el.scrollTop > 1,
          down: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
        })
      })
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    // 내용이 바뀌어도 다시 센다(필터·탭을 바꾸면 길이가 달라진다).
    const mo = new MutationObserver(check)
    mo.observe(el, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', check)
      ro.disconnect()
      mo.disconnect()
    }
  }, [scrollRef])

  const dot = (dir: 'up' | 'down', shown: boolean) => (
    <div aria-hidden
      style={{
        position: 'absolute', left: '50%', transform: 'translateX(-50%)',
        ...(dir === 'up' ? { top } : { bottom }),
        opacity: shown ? 1 : 0, transition: 'opacity 0.2s ease', pointerEvents: 'none',
        width: 24, height: 24, borderRadius: R.pill,
        background: '#ffffff', border: `1px solid ${BORDER}`, boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1,
      }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={SUB} strokeWidth="2"
        style={{ animation: 'hint-bob 1.4s ease-in-out infinite' }}>
        <polyline points={dir === 'up' ? '6 15 12 9 18 15' : '6 9 12 15 18 9'} />
      </svg>
    </div>
  )

  return (
    <>
      <style>{`@keyframes hint-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(2px) } }`}</style>
      {dot('up', more.up)}
      {dot('down', more.down)}
    </>
  )
}
