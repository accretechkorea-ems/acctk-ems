'use client'

import { useEffect, useState } from 'react'

// ── debounce 훅 ───────────────────────────────────────────────────────────────
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value)
  useEffect(() => {
    let mounted = true
    const timer = setTimeout(() => {
      if (mounted) setDebounced(value)
    }, delay)
    return () => {
      mounted = false
      clearTimeout(timer)
    }
  }, [value, delay])
  return debounced
}
