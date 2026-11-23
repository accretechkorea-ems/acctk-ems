'use client'

// 회사 목록을 쓰는 작은 훅 — 캐시(ParentPicker 의 loadParents)를 공유하므로 조회는 앱당 한 번이다.
// 목록 보기의 여러 조각(회사 검색 창·정리 필요 탭)이 같은 목록을 본다.

import { useEffect, useState } from 'react'
import { loadParents, type ParentOption } from '@/components/customer/ParentPicker'

/** enabled 가 거짓이면 읽지 않는다 — 쓰지 않는 화면에서 조회가 한 벌 늘지 않게. */
export function useParents(enabled: boolean = true): ParentOption[] {
  const [list, setList] = useState<ParentOption[]>([])
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    loadParents().then(rows => { if (!cancelled) setList(rows) })
    return () => { cancelled = true }
  }, [enabled])
  return list
}
