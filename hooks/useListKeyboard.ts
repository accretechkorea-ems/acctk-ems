'use client'

// 검색 후보 목록의 키보드 조작. 입력칸 + 후보 목록 한 쌍마다 하나씩 쓴다.
// ↓/↑ 이동, Enter 선택. 닫기(Esc·바깥 클릭)는 useOutsideClick 이 이미 맡고 있어 여기서 다루지 않는다.
//
// 마우스와 키보드가 같은 표시를 쓴다 — hover 는 색을 직접 칠하지 않고 active 를 옮기기만 하고,
// 그리는 쪽은 active 하나만 본다. 그래서 둘이 부딪히지 않는다(마우스가 목록을 벗어나도
// 마지막 위치가 남아, 이어서 ↓ 를 누르면 그 자리에서 이어진다).
//
// 목록 컨테이너의 ref 는 훅이 만들지 않고 화면 쪽에서 받는다 — 훅이 돌려준 ref 를 렌더 중에
// 다시 꺼내 쓰는 모양이 되면 react-compiler 규칙에 걸린다.
import { useCallback, useEffect, useState, type KeyboardEvent, type RefObject } from 'react'

export function useListKeyboard<T>(
  items: T[],
  open: boolean,
  listRef: RefObject<HTMLDivElement | null>,
  onSelect: (item: T) => void,
) {
  const [active, setActive] = useState(-1)

  // 후보가 바뀌거나 열림 상태가 바뀌면 첫 항목으로 되돌린다(닫혀 있으면 선택 자체를 지운다).
  // effect 가 아니라 렌더 중에 맞춘다 — effect 로 하면 한 번 그린 뒤 다시 그리게 되고,
  // 잘못된 항목이 한 프레임 동안 강조된다.
  const [prevItems, setPrevItems] = useState(items)
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevItems !== items || prevOpen !== open) {
    setPrevItems(items)
    setPrevOpen(open)
    setActive(open && items.length > 0 ? 0 : -1)
  }

  // 키보드로 옮긴 항목이 목록 밖으로 나가면 보이도록 굴린다.
  // 'nearest' 라 이미 보이는 항목에서는 아무 일도 일어나지 않는다(페이지가 튀지 않는다).
  useEffect(() => {
    if (active < 0) return
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, listRef])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    // IME 조합 중에는 아무것도 가로채지 않는다 — 한글 입력 중 Enter 는 조합 확정이다.
    // 조합을 끝내는 Enter 는 isComposing 이 true 로 들어오므로 여기서 한 번 흘려보내고,
    // 사용자가 다시 누른 Enter 부터 후보 선택으로 쓴다.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (!open || items.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(i => (i + 1) % items.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => (i <= 0 ? items.length - 1 : i - 1))
      return
    }
    if (e.key === 'Enter') {
      if (active < 0 || active >= items.length) return
      e.preventDefault()
      onSelect(items[active])
    }
  }, [open, items, active, onSelect])

  return { active, setActive, onKeyDown }
}
