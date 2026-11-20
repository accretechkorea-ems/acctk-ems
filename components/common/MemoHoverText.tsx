'use client'

/**
 * **메모를 글자로 보여 주는 자리** — 아이콘이 없는 쪽(2026-11-20).
 *
 * 왜 아이콘이 없는가: 사업장 카드의 메모는 「있다/없다」를 말하는 자리가 아니라 **읽는**
 * 자리다. 라벨 옆에 글자가 그대로 서면 한 줄은 바로 읽히고, 긴 메모만 떠서 다 보이면 된다.
 * 목록 한 줄에 달린 메모(MemoPopover)는 지금처럼 아이콘을 쓴다 — 거기서는 행마다 자리가
 * 어긋나지 않는 것이 먼저다.
 *
 * 띄우는 판은 **MemoPopover 와 같은 것**이다(Popover + MEMO_PANEL_STYLE). 생김새가
 * 두 벌이 되지 않게 스타일을 그쪽에서 가져온다.
 *
 * 지연 300ms — 글자 위를 지나가기만 할 때 뜨지 않게 한다. 손이 떠나면 바로 닫는다.
 */

import { useEffect, useRef, useState } from 'react'
import Popover from '@/components/common/Popover'
import { MEMO_MAX_HEIGHT, MEMO_PANEL_STYLE } from '@/components/common/MemoPopover'

const MUTED = '#9ca3af'
const TEXT = '#111827'

/** 떠오르기까지 기다리는 시간(ms). */
export const MEMO_HOVER_DELAY = 300

export default function MemoHoverText({
  title, value, delay = MEMO_HOVER_DELAY, style, className,
}: {
  /** 어느 건의 메모인지 한 줄(MemoPopover 와 같은 규칙). */
  title: string
  value: string | null | undefined
  delay?: number
  /** 글자 쪽 스타일 — 말줄임·줄바꿈은 부르는 쪽이 정한다. */
  style?: React.CSSProperties
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  // 창을 떠난 채로 타이머가 남으면 사라진 글자 옆에 판이 뜬다.
  useEffect(() => clear, [])

  const text = (value ?? '').trim()
  if (!text) return null

  return (
    <span ref={ref}
      className={className}
      style={{ minWidth: 0, color: TEXT, ...style }}
      onMouseEnter={() => { clear(); timer.current = setTimeout(() => setOpen(true), delay) }}
      onMouseLeave={() => { clear(); setOpen(false) }}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      {text}
      <Popover
        anchorRef={ref}
        open={open}
        onClose={() => setOpen(false)}
        align="start"
        gap={6}
        maxHeight={MEMO_MAX_HEIGHT}
        style={MEMO_PANEL_STYLE}
      >
        <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.7, color: TEXT, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {text}
        </div>
      </Popover>
    </span>
  )
}
