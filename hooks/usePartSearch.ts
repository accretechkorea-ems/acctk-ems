'use client'

// 부품 검색 상태 — 입력이 멈춘 뒤에만 조회한다.
// 업체 검색(클라이언트 필터)은 즉시 반응해야 하므로 그쪽과 섞지 않고 여기서 따로 관리한다.
//
// 화면에 내보내는 값(rows·loading·error·searched)은 전부 파생값이다.
// "지금 조건(key)" 과 "결과가 담긴 조건(result.key)" 을 비교하면 조회 중인지가 그대로 나오므로,
// effect 안에서 상태를 되돌리는 코드가 필요 없다(불필요한 렌더도 줄어든다).

import { useEffect, useState } from 'react'
import { searchParts, MIN_QUERY_LEN, type PartHit } from '@/lib/partSearch'

const DEBOUNCE_MS = 300

type Result = { key: string; rows: PartHit[]; error: string | null }

export function usePartSearch(query: string, enabled: boolean, deliveredOnly: boolean) {
  const [result, setResult] = useState<Result>({ key: '', rows: [], error: null })

  const term = query.trim()
  const active = enabled && term.length >= MIN_QUERY_LEN
  const key = active ? `${term}|${deliveredOnly}` : ''
  const settled = active && result.key === key

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const { rows, error } = await searchParts(term, { deliveredOnly })
      if (!cancelled) setResult({ key, rows, error })
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [active, key, term, deliveredOnly])

  return {
    rows: settled ? result.rows : [],
    error: settled ? result.error : null,
    loading: active && !settled,   // 조건이 바뀌었는데 아직 결과가 안 온 상태
    searched: settled,             // 한 번 끝난 조회 — '아직 안 침' 과 '결과 없음' 을 가른다
  }
}
