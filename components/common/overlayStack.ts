'use client'

// 떠 있는 오버레이의 **쌓임 순서**와 Esc 를 한곳에서 본다.
//
// 왜 필요한가 — 모달 위에 모달이 열리는 자리가 많다(업체 등록 → 주소 검색, 결재 → 결재선
// 고르기, 「저장하지 않고 닫을까요?」 확인창, 전체화면 지도 위의 모달…). 각자 document 에
// keydown 을 달면 Esc 한 번에 두 겹이 함께 닫힌다. 그래서 **쌓아 두고 맨 위만** 반응한다.
//
// 모달이 아닌 것도 합류한다 — 모바일 드로어(Sidebar)와 전체화면 지도(RouteMapView)는
// ModalOverlay 를 쓰지 않지만, 그 위에 모달이 열릴 수 있어 같은 줄에 서야 한다.
//
// 쌓임은 모듈 수준 배열 하나다. 열린 순서대로 push 하고 닫히면 그 자리만 뺀다
// (닫히는 순서가 열린 순서와 뒤집힐 수 있어 lastIndexOf 로 자기 것만 지운다).

import { useEffect, useRef } from 'react'

const stack: symbol[] = []

/**
 * 이 오버레이를 쌓임에 올리고, **맨 위일 때만** Esc 를 받는다.
 *
 *   escEnabled — Esc 로 닫을 수 있는가. false 면 쌓임에만 올라간다(그래야 아래 모달이
 *                대신 닫히지 않는다 — 닫는 길이 막힌 모달이 위에 있으면 Esc 는 아무 일도
 *                하지 않아야 한다).
 *   onEsc      — 맨 위에서 Esc 를 받았을 때. 최신 함수를 쓴다(다시 걸지 않는다).
 *   active     — 떠 있는가. false 면 쌓임에서 빠진다(드로어처럼 닫혀도 DOM 에 남는 것 때문).
 */
export function useOverlayEsc(escEnabled: boolean, onEsc: () => void, active: boolean = true): void {
  // 렌더 중에 ref 를 읽지 않는다(react-hooks/refs) — 효과에서만 쓴다.
  const escRef = useRef(onEsc)
  useEffect(() => { escRef.current = onEsc })

  useEffect(() => {
    if (!active) return
    const id = Symbol('overlay')
    stack.push(id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (stack[stack.length - 1] !== id) return
      escRef.current()
    }
    if (escEnabled) document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const i = stack.lastIndexOf(id)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active, escEnabled])
}
