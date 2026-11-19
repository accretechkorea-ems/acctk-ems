'use client'

// 영업활동 종류 — `public.activity_types` 표가 정본이다.
//
// ── 왜 표인가 ──────────────────────────────────────────────────────────────
//   전에는 `sales_activities.activity_type` 의 CHECK 제약이 값을 네 개로 묶고 있었고,
//   드롭다운은 `SalesActivityModal` 의 상수였다. 종류를 하나 더하려면 SQL 과 코드를
//   함께 고쳐야 했다(그래서 「리드 등록」을 더할 때 제약을 손으로 바꿨다). 이제 관리
//   화면에서 더하고, 이름·순서·활성을 바꾼다.
//
// ── 무엇을 가리키는가 ─────────────────────────────────────────────────────
//   `sales_activities.activity_type` 은 **label** 을 참조한다(FK · on update cascade).
//   code 가 아니라 label 인 이유는 기존 줄을 한 줄도 쓰지 않고 옮기기 위해서였다
//   (db/crm_cleanup_20261118.sql ⑥). 그래서 **드롭다운의 값도 label** 이다.
//
// ── 세 가지 칸 ────────────────────────────────────────────────────────────
//   is_active  끄면 드롭다운에서 빠진다. **과거 줄의 표시는 그대로다** — 줄을 지우지
//              않으므로 집계·목록에서 사라지면 안 된다.
//   is_system  사람이 고르는 종류가 아니다(「리드 등록」 — 리드 전환이 자동으로 남긴다).
//              드롭다운에서 빼고, 관리 화면에서도 이름·활성을 잠근다.
//   is_remote  실제 방문이 아니다 — 동선 지도에서 뺀다(lib/routeMap.ts).
//
// 모양은 lib/quoteCategories.ts 를 그대로 따른다(캐시·오류 문구·순서 바꾸기까지).

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type ActivityType = {
  code: string
  label: string
  sort_order: number
  is_active: boolean
  is_system: boolean
  is_remote: boolean
}

const COLUMNS = 'code, label, sort_order, is_active, is_system, is_remote'

/** 순서 바꿀 때 다시 매기는 간격. 사이에 끼울 자리를 남긴다(시드도 10 단위다). */
const ORDER_STEP = 10

/** 새 code 에 허용하는 글자 — 영문 대문자·숫자·밑줄(견적 분류와 같은 규칙). */
export const CODE_RE = /^[A-Z0-9_]+$/

let cache: Promise<ActivityType[]> | null = null

/** 전체 종류(비활성·system 포함). 정렬은 sort_order → code. */
export function loadActivityTypes(): Promise<ActivityType[]> {
  if (cache) return cache
  cache = (async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('activity_types')
      .select(COLUMNS)
      .order('sort_order')
      .order('code')
    if (error) {
      // 실패하면 캐시를 비워 다음 호출에서 다시 시도한다.
      console.error('[activityTypes] load failed', error)
      cache = null
      return []
    }
    return (data ?? []) as ActivityType[]
  })()
  return cache
}

/** 관리 화면에서 고친 뒤 부른다. 다음 호출에서 다시 읽는다. */
export function invalidateActivityTypes(): void {
  cache = null
}

/** 화면에서 쓰는 훅. 처음 그릴 때 한 번 읽는다(캐시를 공유하므로 조회는 앱당 한 번). */
export function useActivityTypes(): ActivityType[] {
  const [list, setList] = useState<ActivityType[]>([])
  useEffect(() => {
    let cancelled = false
    loadActivityTypes().then(rows => { if (!cancelled) setList(rows) })
    return () => { cancelled = true }
  }, [])
  return list
}

/** 다음 순서 값 — 맨 아래에 붙인다. */
export const nextSortOrder = (list: ActivityType[]): number =>
  list.length === 0 ? ORDER_STEP : Math.max(...list.map(t => t.sort_order)) + ORDER_STEP

/** 관리 화면용 훅 — reload 는 캐시를 버리고 다시 읽는다(견적 분류와 같은 방식). */
export function useActivityTypesAdmin(): {
  types: ActivityType[]
  loading: boolean
  reload: () => Promise<void>
} {
  const [types, setTypes] = useState<ActivityType[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    loadActivityTypes().then(rows => {
      if (cancelled) return
      setTypes(rows)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const reload = useCallback(async () => {
    invalidateActivityTypes()
    const rows = await loadActivityTypes()
    setTypes(rows)
    setLoading(false)
  }, [])

  return { types, loading, reload }
}

// ── 고르기 ────────────────────────────────────────────────────────────────

/**
 * **드롭다운에 낼 종류** — 활성이고, 사람이 고를 수 있는 것만.
 *
 * 지금 골라 둔 값(current)이 비활성이거나 system 이어도 **남긴다**. 옛 활동을 고치는
 * 창에서 그 값이 목록에 없으면 칸이 빈칸으로 보이고, 저장하면 종류가 바뀌어 버린다.
 */
export function selectableActivityTypes(
  list: ActivityType[],
  current?: string | null,
): ActivityType[] {
  const pickable = list.filter(t => t.is_active && !t.is_system)
  if (current && !pickable.some(t => t.label === current)) {
    const kept = list.find(t => t.label === current)
    if (kept) return [...pickable, kept]
  }
  return pickable
}

/** label 로 찾는다. 비활성·system 도 찾아준다 — 과거 줄이 그 label 을 참조한다. */
export function findActivityType(
  list: ActivityType[],
  label: string | null | undefined,
): ActivityType | undefined {
  if (!label) return undefined
  return list.find(t => t.label === label)
}

/**
 * **집계·표시 순서에 쓸 전체 라벨** — 비활성·system 을 모두 넣는다.
 *
 * 카드·대시보드는 이 순서로 줄을 세우고, 목록에 없는 값은 뒤에 붙인다(옛 데이터).
 * 비활성을 빼면 과거 줄이 집계에서 사라진다 — 그래서 여기서는 걸러내지 않는다.
 */
export const activityTypeLabels = (list: ActivityType[]): string[] => list.map(t => t.label)

/** 비방문(원격) 종류의 라벨 — 동선 지도가 뺄 것들(lib/routeMap.ts). */
export const remoteActivityTypes = (list: ActivityType[]): string[] =>
  list.filter(t => t.is_remote).map(t => t.label)

/**
 * 새로 만들 code 를 검사한다. 통과하면 null, 막히면 보여 줄 한글 메시지.
 * 비활성 종류와도 겹치면 안 된다 — code 가 PK 라 insert 가 터진다.
 */
export function validateNewCode(list: ActivityType[], raw: string): string | null {
  const code = raw.trim()
  if (code === '') return '코드를 입력해주세요'
  if (!CODE_RE.test(code)) return '코드는 영문 대문자·숫자·밑줄만 쓸 수 있습니다'
  if (list.some(t => t.code === code)) return '이미 있는 코드입니다'
  return null
}

/** 새로 만들 이름을 검사한다. label 이 FK 대상이라 **이름도 유일해야** 한다. */
export function validateNewLabel(list: ActivityType[], raw: string): string | null {
  const label = raw.trim()
  if (label === '') return '이름을 입력해주세요'
  if (list.some(t => t.label === label)) return '이미 있는 이름입니다'
  return null
}

// ── 쓰기 ─────────────────────────────────────────────────────────────────

export type TypeResult = { ok: true } | { ok: false; error: string }

/** DB 가 거절한 이유를 한글로. 권한 문제는 한 문구로 모은다(견적 분류와 같은 방식). */
export function typeErrorMessage(error: { code?: string; message?: string } | null): string {
  const code = error?.code ?? ''
  const msg = error?.message ?? ''
  // 42501 = insufficient_privilege. RLS 정책에 막힌 INSERT 도 이 코드로 온다.
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return '권한이 없습니다. 활동 종류는 슈퍼관리자만 바꿀 수 있습니다'
  }
  if (code === '23505') return '이미 있는 코드나 이름입니다'
  if (code === '23503') return '활동 기록이 쓰고 있는 종류입니다'
  return msg || '저장하지 못했습니다'
}

/** 새 종류. code·label 검증은 부르는 쪽이 먼저 한다(목록이 필요해서다). */
export async function addActivityType(
  code: string,
  label: string,
  sortOrder: number,
  isRemote = false,
): Promise<TypeResult> {
  const supabase = createClient()
  const { error } = await supabase
    .from('activity_types')
    .insert({ code: code.trim(), label: label.trim(), sort_order: sortOrder, is_remote: isRemote })
  if (error) {
    console.error('[activityTypes] add failed', { code, error })
    return { ok: false, error: typeErrorMessage(error) }
  }
  invalidateActivityTypes()
  return { ok: true }
}

/**
 * 이름을 바꾼다. FK 가 `on update cascade` 라 **과거 활동의 값도 함께 따라간다**.
 * 정책에 막히면 오류 없이 0행이 돌아오므로 그것을 권한 문제로 알린다.
 */
export async function renameActivityType(code: string, label: string): Promise<TypeResult> {
  const next = label.trim()
  if (next === '') return { ok: false, error: '이름을 입력해주세요' }
  const supabase = createClient()
  const { data, error } = await supabase
    .from('activity_types')
    .update({ label: next })
    .eq('code', code)
    .select('code')
  if (error) {
    console.error('[activityTypes] rename failed', { code, error })
    return { ok: false, error: typeErrorMessage(error) }
  }
  if (!data || data.length === 0) {
    return { ok: false, error: typeErrorMessage({ code: '42501' }) }
  }
  invalidateActivityTypes()
  return { ok: true }
}

/** 활성·비활성 전환. 줄을 지우지 않는다 — 과거 활동의 종류 표기는 그대로 남는다. */
export async function setActivityTypeActive(code: string, isActive: boolean): Promise<TypeResult> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('activity_types')
    .update({ is_active: isActive })
    .eq('code', code)
    .select('code')
  if (error) {
    console.error('[activityTypes] toggle failed', { code, isActive, error })
    return { ok: false, error: typeErrorMessage(error) }
  }
  if (!data || data.length === 0) {
    return { ok: false, error: typeErrorMessage({ code: '42501' }) }
  }
  invalidateActivityTypes()
  return { ok: true }
}

/** 비방문(원격) 여부 전환 — 동선 지도에서 뺄지. */
export async function setActivityTypeRemote(code: string, isRemote: boolean): Promise<TypeResult> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('activity_types')
    .update({ is_remote: isRemote })
    .eq('code', code)
    .select('code')
  if (error) {
    console.error('[activityTypes] remote toggle failed', { code, isRemote, error })
    return { ok: false, error: typeErrorMessage(error) }
  }
  if (!data || data.length === 0) {
    return { ok: false, error: typeErrorMessage({ code: '42501' }) }
  }
  invalidateActivityTypes()
  return { ok: true }
}

/**
 * 한 칸 위/아래로 옮긴다. 목록 전체의 sort_order 를 10 단위로 다시 매기고, 값이 달라진
 * 줄만 갱신한다 — 같은 순서 값이 섞여 있어도 결과가 어긋나지 않는다(견적 분류와 같다).
 */
export async function moveActivityType(
  list: ActivityType[],
  code: string,
  dir: -1 | 1,
): Promise<TypeResult> {
  const sorted = [...list].sort((a, b) =>
    a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : a.code.localeCompare(b.code))
  const from = sorted.findIndex(t => t.code === code)
  if (from < 0) return { ok: false, error: '종류를 찾지 못했습니다' }
  const to = from + dir
  if (to < 0 || to >= sorted.length) return { ok: true }

  const next = [...sorted]
  ;[next[from], next[to]] = [next[to], next[from]]

  const supabase = createClient()
  for (let i = 0; i < next.length; i++) {
    const want = (i + 1) * ORDER_STEP
    if (next[i].sort_order === want) continue
    const { data, error } = await supabase
      .from('activity_types')
      .update({ sort_order: want })
      .eq('code', next[i].code)
      .select('code')
    if (error) {
      console.error('[activityTypes] reorder failed', { code: next[i].code, error })
      return { ok: false, error: typeErrorMessage(error) }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: typeErrorMessage({ code: '42501' }) }
    }
  }
  invalidateActivityTypes()
  return { ok: true }
}
