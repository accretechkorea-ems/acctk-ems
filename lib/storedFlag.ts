'use client'

/**
 * **이 브라우저에 남는 켜짐/꺼짐 한 칸** — 사용자별 화면 설정에 쓴다 (2026-11-26).
 *
 * 처음 쓴 자리: 포캐스트 판의 「지표 숨기기」(묶음2 C1).
 *
 * ── 왜 훅이 따로 있나 ─────────────────────────────────────────────────────
 *   저장값을 **렌더 중에** 읽으면 서버가 그린 것과 달라 수화가 어긋나고(React #418),
 *   **효과 안에서** setState 로 켜면 렌더가 한 번 더 돈다(eslint 의 set-state-in-effect).
 *   둘 다 피하는 길은 「바깥 저장소를 구독한다」고 말하는 것이다 — 서버에서는 기본값을
 *   주고(getServerSnapshot), 붙은 뒤에는 저장값을 준다. React 가 알아서 한 번 다시 그린다.
 *
 * ── 저장소가 막혀 있어도 돈다 ─────────────────────────────────────────────
 *   비공개 모드·사이트 데이터 차단에서는 읽기·쓰기가 던진다. 그때는 **기억하지 못할 뿐**
 *   화면은 그대로 동작한다(기본값으로 시작하고, 끄고 켜는 것은 이 탭 안에서 듣는다).
 */

import { useCallback, useSyncExternalStore } from 'react'

/** 같은 열쇠를 보는 화면이 함께 바뀌도록 모아 둔다(한 탭 안에서). */
const listeners = new Map<string, Set<() => void>>()
/**
 * 마지막으로 읽은 값. useSyncExternalStore 의 getSnapshot 은 **같은 값이면 같은 것을**
 * 돌려줘야 한다(매번 새로 읽어 돌려주면 무한 렌더가 된다).
 */
const cache = new Map<string, boolean>()

function read(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? dflt : v === '1'
  } catch {
    return dflt
  }
}

function emit(key: string): void {
  for (const fn of listeners.get(key) ?? []) fn()
}

/**
 * 저장되는 켜짐/꺼짐 한 칸.
 *
 *   const [open, setOpen] = useStoredFlag(`pipeline:metrics:${engineerId}`, true)
 *
 * 서버와 첫(수화) 렌더에서는 **늘 dflt** 다 — 그래야 서버가 그린 글자와 어긋나지 않는다.
 */
export function useStoredFlag(key: string, dflt: boolean): [boolean, (next: boolean) => void] {
  const subscribe = useCallback((fn: () => void) => {
    const set = listeners.get(key) ?? new Set()
    set.add(fn)
    listeners.set(key, set)
    return () => { set.delete(fn) }
  }, [key])

  const getSnapshot = useCallback(() => {
    if (!cache.has(key)) cache.set(key, read(key, dflt))
    return cache.get(key) as boolean
  }, [key, dflt])

  const getServerSnapshot = useCallback(() => dflt, [dflt])

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const set = useCallback((next: boolean) => {
    cache.set(key, next)
    try { localStorage.setItem(key, next ? '1' : '0') } catch { /* 저장 못 해도 이 탭에서는 듣는다 */ }
    emit(key)
  }, [key])

  return [value, set]
}
