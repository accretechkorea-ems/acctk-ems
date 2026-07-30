'use client'

import { useEffect, useRef, useState } from 'react'

// prefers-reduced-motion 이면 애니메이션 없이 즉시 최종값
function prefersReduced(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 0 → target 카운트업. requestAnimationFrame + ease-out(cubic).
 * - duration 기본 900ms.
 * - target 이 바뀔 때만 다시 실행(같은 값 리렌더로는 재실행 안 됨).
 * - reduced-motion 이거나 유효하지 않은 값이면 즉시 target 반환.
 * 반환값은 애니메이션 중의 실수(소수 포함) — 표시 측에서 반올림/자릿수 포맷.
 */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!Number.isFinite(target)) { setValue(target); return }
    if (prefersReduced() || duration <= 0) { setValue(target); return }

    let start: number | null = null
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
    const tick = (now: number) => {
      if (start === null) start = now
      const p = Math.min(1, (now - start) / duration)
      setValue(target * easeOut(p))
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
      else setValue(target)
    }
    setValue(0)
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [target, duration])

  return value
}
