'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * 견적 목록의 체크박스 선택 상태.
 *
 * visibleIds 를 넘기면 목록이 바뀔 때(검색·상태 필터·기간 변경 등)
 * 화면에서 사라진 견적의 선택을 자동으로 걷어낸다.
 * 보이지 않는 견적이 선택된 채 내보내지는 상황을 막기 위한 것이다.
 */
export function useQuoteSelection(visibleIds?: number[]) {
  const [selectedSet, setSelectedSet] = useState<Set<number>>(new Set())

  // 배열 아이덴티티가 매 렌더 바뀌므로 내용으로 비교한다.
  const visibleKey = visibleIds ? visibleIds.join(',') : ''
  useEffect(() => {
    if (!visibleIds) return
    const visible = new Set(visibleIds)
    setSelectedSet(prev => {
      const next = new Set([...prev].filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey])

  const toggle = useCallback((id: number) => {
    setSelectedSet(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // 넘긴 id 가 전부 선택돼 있으면 해제, 아니면 전부 선택.
  const toggleAll = useCallback((ids: number[]) => {
    setSelectedSet(prev => {
      const allSelected = ids.length > 0 && ids.every(id => prev.has(id))
      const next = new Set(prev)
      for (const id of ids) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }, [])

  const clear = useCallback(() => setSelectedSet(new Set()), [])
  const isSelected = useCallback((id: number) => selectedSet.has(id), [selectedSet])
  const selected = useMemo(() => [...selectedSet], [selectedSet])

  return { selected, count: selected.length, isSelected, toggle, toggleAll, clear }
}
