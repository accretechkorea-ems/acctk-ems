'use client'

// 사무실(길찾기 출발지 · 동선 지도 마커 · 직원 소속) 공용 로더.
//
// 값은 public.offices 테이블이 정본이다. 전에는 이 파일의 상수가 정본이었는데,
// 화면마다 좌표가 어긋나는 문제가 있어 DB 한 곳으로 옮겼다.
// engineers.office 는 이 표의 code 를 문자열로 참조한다(FK 없음).
//
// teams 와 같은 방식으로 모듈 수준에 한 번만 읽어 캐시한다 — 표가 몇 행뿐이고
// 화면마다 다시 읽을 이유가 없다. 관리자 화면에서 고치면 invalidateOffices() 로 캐시를 버린다.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type Office = {
  office_id: number
  code: string
  label: string
  address: string
  latitude: number | null
  longitude: number | null
  sort_order: number
  is_active: boolean
}

const COLUMNS = 'office_id, code, label, address, latitude, longitude, sort_order, is_active'

let cache: Promise<Office[]> | null = null

/** 전체 사무실(비활성 포함). 정렬은 sort_order → code. */
export function loadOffices(): Promise<Office[]> {
  if (cache) return cache
  cache = (async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('offices')
      .select(COLUMNS)
      .order('sort_order')
      .order('code')
    if (error) {
      // 실패하면 캐시를 비워 다음 호출에서 다시 시도한다.
      console.error('[offices] load failed', error)
      cache = null
      return []
    }
    return (data ?? []) as Office[]
  })()
  return cache
}

/** 관리자 화면에서 사무실을 고친 뒤 부른다. 다음 호출에서 다시 읽는다. */
export function invalidateOffices(): void {
  cache = null
}

/** code 로 찾는다. 비활성 사무실도 찾아준다 — 기존 데이터가 그 code 를 참조할 수 있기 때문이다. */
export function findOffice(offices: Office[], code: string | null | undefined): Office | undefined {
  if (!code) return undefined
  return offices.find(o => o.code === code)
}

/** 새로 고를 수 있는 사무실만. 비활성은 드롭다운에 넣지 않는다. */
export const activeOffices = (offices: Office[]): Office[] => offices.filter(o => o.is_active)

/**
 * 선택 목록에 쓸 사무실.
 * 비활성이라도 지금 선택돼 있는 값(currentCode)은 남겨야 기존 데이터가 빈칸으로 보이지 않는다.
 */
export function selectableOffices(offices: Office[], currentCode?: string | null): Office[] {
  const list = activeOffices(offices)
  if (currentCode && !list.some(o => o.code === currentCode)) {
    const kept = findOffice(offices, currentCode)
    if (kept) return [...list, kept]
  }
  return list
}

/** 화면에서 쓰는 훅. 캐시를 공유하므로 여러 화면이 함께 써도 조회는 한 번이다. */
export function useOffices(): { offices: Office[]; loading: boolean } {
  const [offices, setOffices] = useState<Office[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    loadOffices().then(list => {
      if (cancelled) return
      setOffices(list)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  return { offices, loading }
}
