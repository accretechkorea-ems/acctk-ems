'use client'

/**
 * **툴팁** — 손을 올리면 뜨는 한 마디 (2026-11-27, 묶음5 1-1).
 *
 * ── 왜 부품으로 만드나 ────────────────────────────────────────────────────
 *   지금까지는 브라우저의 `title` 속성을 썼다. 공짜지만 우리 것이 아니다:
 *     · 뜨는 데 **1~2초**가 걸리고 그 시간을 우리가 정할 수 없다.
 *     · 생김새가 OS 마다 다르다 — 어두운 작은 상자, 노란 상자, 글꼴도 제각각.
 *     · 줄바꿈·단축키 칩 같은 **모양을 만들 수 없다**.
 *     · 터치 기기에서는 **아예 안 뜬다**(길게 눌러야 하고, 그마저 기기마다 다르다).
 *   그래서 한 벌로 만들고 생김새를 못 박는다.
 *
 * ── 생김새(캔버스 Tooltips E안) ───────────────────────────────────────────
 *   바탕 #1f2937 · 흰 글자 12px · **알약**(radius 999) · 꼬리 · 패딩 7×12.
 *   단축키는 **알약 칩**(흰 18% 바탕)으로 글 뒤에 붙는다.
 *
 * ── 언제 뜨나 ─────────────────────────────────────────────────────────────
 *   손을 올리고 **300ms** 뒤. 지나가는 길에 스치는 것으로는 뜨지 않는다
 *   (MemoHoverText 와 같은 값이다 — 이 저장소의 「기다림」은 한 값이다).
 *   기본은 **위**, 위에 자리가 없으면 아래. body 로 포털해 Z.popover 에 띄운다
 *   — 모달·스크롤 상자 안에서도 잘리지 않는다.
 *
 * ── 폰에서는 뜨지 않는다 ──────────────────────────────────────────────────
 *   터치에는 「올려 두기」가 없다. 눌렀을 때 뜨면 누른 것을 가린다.
 *   그래서 **아예 그리지 않는다** — 대신 aria-label 이 늘 붙어 있어 읽어 주기는 된다.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { R } from '@/lib/radius'
import { Z } from '@/lib/zIndex'

/** 손을 올리고 이만큼 지나야 뜬다. 메모 호버(MemoHoverText)와 같은 값이다. */
export const TOOLTIP_DELAY_MS = 300
/** 앵커와 말풍선 사이, 그리고 화면 가장자리와의 틈. */
const GAP = 8
const MARGIN = 6
/** 꼬리의 한 변. */
const TAIL = 5

const BG = '#1f2937'
const FG = '#ffffff'
/** 단축키 칩 — 바탕 위의 흰 18%. 글자는 그대로 희다. */
const CHIP_BG = 'rgba(255, 255, 255, 0.18)'

export type TooltipProps = {
  /** 뜰 글. 비면 아무것도 하지 않는다(감싸기만 한다). */
  label?: ReactNode
  /** 단축키 — 「Ctrl+B」. 글 뒤에 알약 칩으로 붙는다. */
  shortcut?: string
  /** 감쌀 것. 하나여야 한다(자리를 재야 하므로 span 으로 감싼다). */
  children: ReactNode
  /** 먼저 시도할 방향. 자리가 없으면 반대쪽으로 뒤집는다. 기본은 위. */
  prefer?: 'top' | 'bottom'
  /** 감싸는 span 의 스타일 — 자리 맞춤에만 쓴다. */
  style?: React.CSSProperties
}

/**
 * 터치 기기인가 — **뜰 때 묻는다**(상태로 들고 있지 않는다).
 * 처음 그릴 때 물으면 서버와 브라우저의 답이 달라 hydration 이 어긋나고,
 * 효과 안에서 물으면 한 번 그린 것을 그 자리에서 다시 그리게 된다.
 * 어차피 **뜨려는 순간**에만 알면 되는 값이다.
 */
const isTouch = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(hover: none)').matches

type Pos = { left: number; top: number; flipped: boolean; cx: number }

export default function Tooltip({ label, shortcut, children, prefer = 'top', style }: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const id = useId()

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  const show = () => {
    // 터치에는 「올려 두기」가 없다. 누른 것을 가리므로 아예 그리지 않는다.
    if (isTouch()) return
    clear()
    timer.current = setTimeout(() => setOpen(true), TOOLTIP_DELAY_MS)
  }
  const hide = () => { clear(); setOpen(false); setPos(null) }

  useEffect(() => () => clear(), [])

  // 자리를 잡는다 — 말풍선이 붙은 뒤(크기를 알아야 가운데를 맞춘다).
  const place = (el: HTMLDivElement | null) => {
    bubbleRef.current = el
    const a = anchorRef.current
    if (!el || !a) return
    const r = a.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    const above = r.top - GAP - b.height
    const below = r.bottom + GAP
    const flipped = prefer === 'top' ? above < MARGIN : below + b.height > window.innerHeight - MARGIN
    const top = (prefer === 'top') === !flipped ? above : below
    // 가운데 맞춤 — 화면 밖으로 나가면 안으로 민다. 꼬리는 **앵커 가운데**에 그대로 둔다.
    const raw = r.left + r.width / 2 - b.width / 2
    const left = Math.min(Math.max(MARGIN, raw), Math.max(MARGIN, window.innerWidth - b.width - MARGIN))
    setPos({ left, top, flipped: top > r.top, cx: r.left + r.width / 2 - left })
  }

  const has = label != null && label !== ''
  const live = has && open

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        // 키보드로 닿아도 뜬다 — 마우스가 없는 사람에게도 같은 말을 해 준다.
        onFocus={show}
        onBlur={hide}
        // 눌렀으면 할 말은 끝났다. 누른 뒤에도 떠 있으면 다음 것을 가린다.
        onPointerDown={hide}
        aria-describedby={live ? id : undefined}
        style={{ display: 'inline-flex', ...style }}
      >
        {children}
      </span>
      {live && typeof document !== 'undefined' && createPortal(
        <div
          id={id}
          role="tooltip"
          ref={place}
          style={{
            position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, zIndex: Z.popover,
            // 자리를 잡기 전 한 프레임 동안 (0,0) 에서 번쩍이지 않게 감춘다.
            visibility: pos ? 'visible' : 'hidden',
            pointerEvents: 'none',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            maxWidth: 260,
            padding: '7px 12px',
            // **알약** — 캔버스 E안. 네모 상자가 아니다.
            borderRadius: R.pill,
            background: BG, color: FG,
            fontSize: 12, lineHeight: 1.35, fontWeight: 500, fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          <span>{label}</span>
          {shortcut && (
            <span style={{
              flexShrink: 0, padding: '1px 6px', borderRadius: R.pill,
              background: CHIP_BG, fontSize: 11, fontWeight: 700, letterSpacing: '0.02em',
            }}>
              {shortcut}
            </span>
          )}
          {/* 꼬리 — 말풍선과 같은 색의 네모를 45° 돌려 모서리만 내민다. */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: Math.max(TAIL + 2, Math.min((pos?.cx ?? 0), 260 - TAIL - 2)) - TAIL,
              [pos?.flipped ? 'top' : 'bottom']: -TAIL,
              width: TAIL * 2, height: TAIL * 2,
              background: BG, transform: 'rotate(45deg)',
            }}
          />
        </div>,
        document.body,
      )}
    </>
  )
}
