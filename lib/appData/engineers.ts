'use client'

// 직원 **전체 목록**을 앱 당 한 번 읽는다 — 담당자 선택·결재선·실적 집계가 모두 같은 값을 본다.
//
// 열 구성이 화면마다 달랐다(`*` / `*, email` / `engineer_id, name, position, resigned_date`…).
// 그래서 같은 화면에서 두 번 읽히기도 했다(/sales·/purchase·/inquiries·/admin —
// docs/perf-baseline.md b). 여기서 **한 벌로 합쳐** 한 번만 읽는다.
//
// 방식은 lib/quoteCategories.ts·lib/teamPerms.ts 와 같다(모듈 캐시 + 무효화 + 훅).
// 행이 수십 줄뿐이라 전부 들고 있어도 부담이 없다. 직원을 고치는 화면(유지보수)은
// 저장 직후 invalidateEngineers() 를 불러야 다른 화면이 새 값을 본다.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/** 목록이 쓰는 열. select('*') 를 쓰지 않는다(규칙 5) — 모자라면 여기에 더한다. */
export type EngineerRow = {
  engineer_id: number
  name: string | null
  position: string | null
  teams: string | null
  permission_level: string | null
  office: string | null
  email: string | null
  tel: string | null
  initials: string | null
  can_switch_division: boolean | null
  resigned_date: string | null
  /** 실적 집계 개인 강제(null = 팀을 따른다). 판정은 lib/salesScope.ts 다. */
  in_sales_stats: boolean | null
}

const COLUMNS = 'engineer_id, name, position, teams, permission_level, office, email, tel, initials, can_switch_division, resigned_date, in_sales_stats'

let cache: Promise<EngineerRow[]> | null = null

/** 직원을 더하거나 고친 뒤 부른다. 다음 호출에서 다시 읽는다. */
export function invalidateEngineers(): void {
  cache = null
}

/** 직원 전체(퇴사자 포함 — 기간별 표시 판정은 lib/engineers.ts 가 한다). 정렬은 engineer_id. */
export function loadEngineers(): Promise<EngineerRow[]> {
  if (cache) return cache
  cache = (async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('engineers')
      .select(COLUMNS)
      .order('engineer_id', { ascending: true })
    if (error) {
      // 실패하면 캐시를 비워 다음 호출에서 다시 시도한다.
      console.error('[engineers] 목록 조회 실패', error)
      cache = null
      return []
    }
    return (data ?? []) as unknown as EngineerRow[]
  })()
  return cache
}

/** 화면에서 쓰는 훅. 첫 호출만 조회하고 그 뒤로는 메모리에서 바로 돌려준다. */
export function useEngineers(): { engineers: EngineerRow[]; loading: boolean } {
  const [engineers, setEngineers] = useState<EngineerRow[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    void loadEngineers().then(rows => {
      if (cancelled) return
      setEngineers(rows)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])
  return { engineers, loading }
}
