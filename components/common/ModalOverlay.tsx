'use client'

// 모달의 **바탕(오버레이)** — 닫는 길을 한곳에서 정한다.
//
// ── 닫는 길 두 개 ───────────────────────────────────────────────────────────
//   바깥 클릭 — 바탕에서 **누르고 뗀 것**이 모두 바탕일 때만 닫는다. 모달 안의 글자를
//               긁다가 손이 바탕에서 떨어졌다고 닫히면 쓰던 글이 날아간다.
//   Esc      — 2026-11-02 에 여기로 들였다. 전에는 ModalOverlay 에 Esc 가 없어서
//               네 모달만 각자 keydown 을 달아 두고 나머지 29개는 Esc 로 닫히지 않았다
//               (docs 조사 2026-11-02). 공용 한 곳에 두면 전부 같은 규칙이 된다.
//
// ── 여러 겹일 때는 맨 위만 닫힌다 ──────────────────────────────────────────
//   모달 위에 모달이 열리는 자리가 있다(업체 등록 → 주소 검색, 결재 → 결재선 고르기,
//   그리고 아래의 「저장하지 않고 닫을까요?」 확인창 자체). Esc 를 각자 받으면 한 번에
//   두 겹이 닫힌다. 그래서 떠 있는 오버레이를 **쌓아 두고**(stack) 맨 위인 것만 반응한다.
//   닫는 길이 막힌 모달(closeOn='none')도 쌓기에는 들어간다 — 그래야 그 아래 모달이
//   대신 닫히는 일이 없다.
//
// ── 입력 중인 폼은 묻고 닫는다 ─────────────────────────────────────────────
//   confirmClose 를 켜면 Esc·바깥 클릭이 바로 닫지 않고 「저장하지 않고 닫을까요?」를
//   먼저 묻는다(닫기 / 계속 작성). 저장 버튼으로 닫는 길은 묻지 않는다 — 그쪽은 onClose 를
//   직접 부르고 이 오버레이를 지나지 않는다.
//
//   dirty 를 함께 주면 **바뀐 것이 없을 때는 묻지 않는다**(열어 보고 그냥 닫는 흐름이
//   대부분이라, 그때까지 확인을 받으면 성가신 쪽이 이긴다). 못 주는 모달은 confirmClose
//   만 켜 둔다 — 그런 모달은 늘 묻는다.

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { modalOverlayStyle } from '../customer/constants'
import { useConfirmOptional } from './confirmContext'

/** 닫는 길. 'both' = Esc + 바깥 클릭(기본) · 'backdrop' = 바깥 클릭만 · 'none' = 둘 다 막는다. */
export type CloseOn = 'both' | 'backdrop' | 'none'

type Props = {
  onClose: () => void
  children: ReactNode
  style?: CSSProperties
  /** 기본 'both'. 저장 중처럼 닫히면 안 되는 동안은 'none' 으로 둘 수 있다. */
  closeOn?: CloseOn
  /** 켜면 Esc·바깥 클릭 때 「저장하지 않고 닫을까요?」를 먼저 묻는다. */
  confirmClose?: boolean
  /**
   * 열었을 때와 달라진 것이 있는가. **false 면 confirmClose 를 켜도 묻지 않는다.**
   * 주지 않으면(undefined) 늘 묻는다 — 모르면 안전한 쪽을 고른다.
   */
  dirty?: boolean
}

/** 떠 있는 오버레이 — 뒤가 맨 위다. Esc 는 맨 위만 받는다. */
const stack: symbol[] = []

export default function ModalOverlay({
  onClose, children, style, closeOn = 'both', confirmClose = false, dirty,
}: Props) {
  const downOnOverlay = useRef(false)
  const confirm = useConfirmOptional()

  /**
   * 닫기를 **요청**한다 — 물어야 하면 묻고, 아니면 바로 닫는다.
   * 「계속 작성」을 고르면 아무 일도 하지 않는다.
   */
  const requestClose = async () => {
    if (confirmClose && dirty !== false && confirm) {
      const ok = await confirm({
        title: '저장하지 않고 닫을까요?',
        message: '작성 중인 내용은 저장되지 않습니다.',
        confirmText: '닫기',
        cancelText: '계속 작성',
        variant: 'danger',
      })
      if (!ok) return
    }
    onClose()
  }

  // 아래 keydown 은 한 번만 걸고 **ref 로 최신 함수**를 부른다(렌더마다 다시 걸지 않는다).
  // 렌더 중에 ref 를 쓰지 않으려고 동기화는 효과에서 한다(React 규칙).
  const requestRef = useRef(requestClose)
  useEffect(() => { requestRef.current = requestClose })

  useEffect(() => {
    const id = Symbol('modal')
    stack.push(id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 맨 위가 아니면 모른 척한다(위에 뜬 모달이 닫힐 차례다).
      if (stack[stack.length - 1] !== id) return
      void requestRef.current()
    }
    // Esc 를 받지 않는 모달도 **쌓기에는 들어간다** — 그래야 그 아래 모달이 대신 닫히지 않는다.
    if (closeOn === 'both') document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const i = stack.lastIndexOf(id)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [closeOn])

  const backdropOk = closeOn === 'both' || closeOn === 'backdrop'

  return (
    <div
      style={{ ...modalOverlayStyle, ...style }}
      onMouseDown={(e) => { downOnOverlay.current = e.target === e.currentTarget }}
      onMouseUp={(e) => {
        const onBg = downOnOverlay.current && e.target === e.currentTarget
        downOnOverlay.current = false
        if (onBg && backdropOk) void requestClose()
      }}
    >
      {children}
    </div>
  )
}
