'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * 견적 목록의 체크박스 선택 상태.
 *
 * visibleIds 를 넘기면 목록이 바뀔 때(검색·상태 필터·기간 변경 등)
 * 화면에서 사라진 견적의 선택을 자동으로 걷어낸다.
 * 보이지 않는 견적이 선택된 채 내보내지는 상황을 막기 위한 것이다.
 *
 * ── 「이 조건 전체 선택」 (2026-11-26, 지시 O) ───────────────────────────────
 *   발주 목록이 쪽을 나누면서(50건) 「엑셀로 전부 내보내기」가 막혔다 — 쪽을 넘기면 위
 *   규칙이 선택을 걷어내기 때문이다. 그래서 **조건 전체 선택**을 둔다: 부르는 쪽이 조건에
 *   맞는 id 전부를 받아 selectCondition 으로 넘기면, 그때부터 쪽을 넘겨도 **걷어내지
 *   않는다**(wide).
 *
 *   조건이 바뀌면 그 선택은 뜻이 없다 — 부르는 쪽이 clear() 를 부른다(쪽 넘김과 조건 변경을
 *   가릴 수 있는 것은 화면뿐이다. 여기서는 둘이 똑같이 visibleIds 변화로 보인다).
 *   한 줄을 손으로 켜고 끄면 wide 는 꺼진다 — 그 순간부터는 사람이 고른 목록이다.
 */
export function useQuoteSelection(visibleIds?: number[]) {
  const [selectedSet, setSelectedSet] = useState<Set<number>>(new Set())
  /** 「이 조건 전체 선택」 중인가 — 켜져 있으면 쪽을 넘겨도 선택을 걷지 않는다. */
  const [wide, setWide] = useState(false)

  // 배열 아이덴티티가 매 렌더 바뀌므로 내용으로 비교한다.
  const visibleKey = visibleIds ? visibleIds.join(',') : ''
  useEffect(() => {
    if (!visibleIds || wide) return
    const visible = new Set(visibleIds)
    setSelectedSet(prev => {
      const next = new Set([...prev].filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, wide])

  const toggle = useCallback((id: number) => {
    // 손으로 한 줄을 켜고 끄면 그 순간부터 **사람이 고른 목록**이다(조건 전체가 아니다).
    setWide(false)
    setSelectedSet(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // 넘긴 id 가 전부 선택돼 있으면 해제, 아니면 전부 선택.
  const toggleAll = useCallback((ids: number[]) => {
    setWide(false)
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

  /**
   * 조건에 맞는 id 전부를 고른다 — 그때부터 쪽을 넘겨도 걷어내지 않는다.
   * 받는 id 는 부르는 쪽이 **서버에 다시 물어** 받은 것이다(화면에 보이는 쪽만으로는 모른다).
   */
  const selectCondition = useCallback((ids: number[]) => {
    setSelectedSet(new Set(ids))
    setWide(ids.length > 0)
  }, [])

  const clear = useCallback(() => { setSelectedSet(new Set()); setWide(false) }, [])
  const isSelected = useCallback((id: number) => selectedSet.has(id), [selectedSet])
  const selected = useMemo(() => [...selectedSet], [selectedSet])

  return { selected, count: selected.length, isSelected, toggle, toggleAll, clear, selectCondition, wide }
}
