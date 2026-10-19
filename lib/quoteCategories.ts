'use client'

// 견적 분류(BCT · CMM · KOLAS · Measuring Service · Roundness · SBS · Surface · TSE) 공용 로더.
//
// 값은 public.quote_categories 표가 정본이다. 코드 상수로 두지 않는 이유 — 관리 화면에서
// 추가·이름 변경·비활성을 해야 하고, 그때마다 배포를 기다릴 수 없다.
//
// offices(lib/offices.ts) 와 **같은 방식**이다. 모듈 수준에 한 번만 읽어 캐시한다 — 표가
// 여덟 행뿐이고 화면마다 다시 읽을 이유가 없다. 관리 화면에서 고치면 invalidateQuoteCategories()
// 로 캐시를 버린다.
//
// ── 두 자리에 쓴다 ─────────────────────────────────────────────────────────
//   quotes.category      — 견적 분류. 작성 첫 화면에서 **반드시** 고른다.
//   quote_items.category — 줄별 분류. 「분류 나누기」를 켠 뒤 **다른 분류로 바꾼 줄만** 채운다.
//                          null 이면 견적 분류를 따른다.
//   통계는 줄 분류를 먼저 보고 없으면 견적 분류로 떨어진다(그 집계는 8단계).
//
// ── code 는 바꾸지 않는다 ──────────────────────────────────────────────────
//   세 표가 이 글자를 그대로 참조한다(quotes · quote_items · quote_templates).
//   그래서 관리 화면은 label 만 고친다. 쓰지 않게 된 분류는 **지우지 않고 비활성**한다 —
//   지우면 FK 가 막고, 지울 수 있다 해도 과거 견적의 분류가 사라진다.
//
// ── 쓰기 권한은 RLS 가 본다 ────────────────────────────────────────────────
//   정책은 superadmin 만 쓰기를 허용한다(quote_category_template_schema.sql 단계 1).
//   그래서 이 파일은 권한을 따로 검사하지 않고 **DB 가 거절한 것을 한글로 바꿔** 돌려준다.
//   ⚠ UPDATE 는 정책에 막히면 **오류가 아니라 0행 갱신**으로 끝난다. 그래서 갱신 함수는
//     돌아온 행 수를 보고 0이면 권한 문제로 알린다(조용히 성공한 것처럼 보이지 않게).

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type QuoteCategory = {
  code: string
  label: string
  sort_order: number
  is_active: boolean
}

const COLUMNS = 'code, label, sort_order, is_active'

/** 순서 바꿀 때 다시 매기는 간격. 사이에 끼울 자리를 남긴다(스키마 시드도 10 단위다). */
const ORDER_STEP = 10

/**
 * 줄별 분류를 넣을 수 있는 품목 종류 — **매출 줄만**.
 *   domestic : 고객에게 청구하지 않는 자사 부담 비용이라 매출 집계에서 빠진다(calcTotals).
 *   discount : 총액에서 한 번 빼는 줄이고, 분류별 안분은 집계 시점에 계산한다(8단계).
 * 둘에는 분류를 넣지 않는다 — 넣어도 통계에서 쓸 자리가 없다.
 */
export const LINE_SPLIT_ROW_KINDS: readonly string[] = ['price_list', 'manual_jpy', 'service']

/** 이 줄에 분류 선택칸을 낼 것인가. */
export const canSplitRowKind = (rowKind: string | null | undefined): boolean =>
  rowKind != null && LINE_SPLIT_ROW_KINDS.includes(rowKind)

/** 새 code 에 허용하는 글자 — 영문 대문자·숫자·밑줄. */
export const CODE_RE = /^[A-Z0-9_]+$/

let cache: Promise<QuoteCategory[]> | null = null

/** 전체 분류(비활성 포함). 정렬은 sort_order → code. */
export function loadQuoteCategories(): Promise<QuoteCategory[]> {
  if (cache) return cache
  cache = (async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('quote_categories')
      .select(COLUMNS)
      .order('sort_order')
      .order('code')
    if (error) {
      // 실패하면 캐시를 비워 다음 호출에서 다시 시도한다.
      console.error('[quoteCategories] load failed', error)
      cache = null
      return []
    }
    return (data ?? []) as QuoteCategory[]
  })()
  return cache
}

/** 관리 화면에서 분류를 고친 뒤 부른다. 다음 호출에서 다시 읽는다. */
export function invalidateQuoteCategories(): void {
  cache = null
}

/** code 로 찾는다. 비활성 분류도 찾아준다 — 기존 견적이 그 code 를 참조할 수 있기 때문이다. */
export function findQuoteCategory(
  list: QuoteCategory[],
  code: string | null | undefined,
): QuoteCategory | undefined {
  if (!code) return undefined
  return list.find(c => c.code === code)
}

/** 새로 고를 수 있는 분류만. 비활성은 드롭다운에 넣지 않는다. */
export const activeQuoteCategories = (list: QuoteCategory[]): QuoteCategory[] =>
  list.filter(c => c.is_active)

/**
 * 선택 목록에 쓸 분류.
 * 비활성이라도 지금 선택돼 있는 값(currentCode)은 남겨야 기존 견적이 빈칸으로 보이지 않는다.
 * (작성 화면은 **쓰지 않는다** — 새 견적은 활성 분류만 고른다. 상세·수정 화면용이다.)
 */
export function selectableQuoteCategories(
  list: QuoteCategory[],
  currentCode?: string | null,
): QuoteCategory[] {
  const active = activeQuoteCategories(list)
  if (currentCode && !active.some(c => c.code === currentCode)) {
    const kept = findQuoteCategory(list, currentCode)
    if (kept) return [...active, kept]
  }
  return active
}

/**
 * 화면에 찍을 이름. 목록을 아직 못 읽었거나 지워진 code 면 **code 를 그대로** 보여 준다
 * — 빈칸으로 두면 「분류 없음」과 구분되지 않는다. null 이면 미분류다.
 */
export function categoryLabel(list: QuoteCategory[], code: string | null | undefined): string {
  if (!code) return '미분류'
  return findQuoteCategory(list, code)?.label ?? code
}

/**
 * 새로 만들 code 를 검사한다. 통과하면 null, 막히면 사용자에게 보여 줄 한글 메시지.
 * 비활성 분류와도 겹치면 안 된다 — code 가 PK 라 insert 가 터진다.
 */
export function validateNewCode(list: QuoteCategory[], raw: string): string | null {
  const code = raw.trim()
  if (code === '') return '코드를 입력해주세요'
  if (!CODE_RE.test(code)) return '코드는 영문 대문자·숫자·밑줄만 쓸 수 있습니다'
  if (list.some(c => c.code === code)) return '이미 있는 코드입니다'
  return null
}

// ── 쓰기 ─────────────────────────────────────────────────────────────────────

export type CategoryResult = { ok: true } | { ok: false; error: string }

/**
 * DB 가 거절한 이유를 한글로. 권한 문제는 전부 같은 문구로 모은다 —
 * 사용자가 할 수 있는 일이 「관리자에게 문의」 하나뿐이라 구분해 봐야 쓸 데가 없다.
 */
export function categoryErrorMessage(error: { code?: string; message?: string } | null): string {
  const code = error?.code ?? ''
  const msg = error?.message ?? ''
  // 42501 = insufficient_privilege. RLS 정책에 막힌 INSERT 도 이 코드로 온다.
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return '권한이 없습니다. 분류는 슈퍼관리자만 바꿀 수 있습니다'
  }
  if (code === '23505') return '이미 있는 코드입니다'
  if (code === '23503') return '다른 자료가 쓰고 있는 분류입니다'
  return msg || '저장하지 못했습니다'
}

/** 새 분류. code 검증은 부르는 쪽이 validateNewCode 로 먼저 한다(목록이 필요해서다). */
export async function addQuoteCategory(
  code: string,
  label: string,
  sortOrder: number,
): Promise<CategoryResult> {
  const supabase = createClient()
  const { error } = await supabase
    .from('quote_categories')
    .insert({ code: code.trim(), label: label.trim(), sort_order: sortOrder })
  if (error) {
    console.error('[quoteCategories] add failed', { code, error })
    return { ok: false, error: categoryErrorMessage(error) }
  }
  invalidateQuoteCategories()
  return { ok: true }
}

/**
 * 표기 이름만 바꾼다. **code 는 바꿀 수 없다**(세 표가 참조한다).
 * 정책에 막히면 오류 없이 0행이 돌아오므로 그것을 권한 문제로 알린다.
 */
export async function renameQuoteCategory(code: string, label: string): Promise<CategoryResult> {
  const next = label.trim()
  if (next === '') return { ok: false, error: '표기 이름을 입력해주세요' }
  const supabase = createClient()
  const { data, error } = await supabase
    .from('quote_categories')
    .update({ label: next })
    .eq('code', code)
    .select('code')
  if (error) {
    console.error('[quoteCategories] rename failed', { code, error })
    return { ok: false, error: categoryErrorMessage(error) }
  }
  if (!data || data.length === 0) {
    return { ok: false, error: categoryErrorMessage({ code: '42501' }) }
  }
  invalidateQuoteCategories()
  return { ok: true }
}

/** 활성·비활성 전환. 행을 지우지 않는다 — 기존 견적의 분류 표기는 그대로 남는다. */
export async function setQuoteCategoryActive(code: string, isActive: boolean): Promise<CategoryResult> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('quote_categories')
    .update({ is_active: isActive })
    .eq('code', code)
    .select('code')
  if (error) {
    console.error('[quoteCategories] toggle failed', { code, isActive, error })
    return { ok: false, error: categoryErrorMessage(error) }
  }
  if (!data || data.length === 0) {
    return { ok: false, error: categoryErrorMessage({ code: '42501' }) }
  }
  invalidateQuoteCategories()
  return { ok: true }
}

/**
 * 한 칸 위/아래로 옮긴다. 목록 전체의 sort_order 를 10 단위로 **다시 매기고**, 값이 달라진
 * 행만 갱신한다 — 그래야 같은 순서 값이 섞여 있어도(스키마가 default 0 을 허용한다) 결과가
 * 어긋나지 않는다.
 *
 * 여러 행을 따로 갱신하므로 한 트랜잭션이 아니다. 중간에 실패하면 순서가 어중간하게 남을 수
 * 있는데, 여덟 행짜리 관리 표라 다시 누르면 정리된다(그 사실을 화면이 알린다).
 */
export async function moveQuoteCategory(
  list: QuoteCategory[],
  code: string,
  dir: -1 | 1,
): Promise<CategoryResult> {
  // 화면에 보이는 순서와 같은 기준으로 세운다(sort_order → code).
  const sorted = [...list].sort((a, b) =>
    a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : a.code.localeCompare(b.code))
  const from = sorted.findIndex(c => c.code === code)
  if (from < 0) return { ok: false, error: '분류를 찾지 못했습니다' }
  const to = from + dir
  // 끝에서 더 밀면 아무것도 하지 않는다(버튼이 비활성이지만 한 번 더 막는다).
  if (to < 0 || to >= sorted.length) return { ok: true }

  const next = [...sorted]
  ;[next[from], next[to]] = [next[to], next[from]]

  const supabase = createClient()
  for (let i = 0; i < next.length; i++) {
    const want = (i + 1) * ORDER_STEP
    if (next[i].sort_order === want) continue
    const { data, error } = await supabase
      .from('quote_categories')
      .update({ sort_order: want })
      .eq('code', next[i].code)
      .select('code')
    if (error) {
      console.error('[quoteCategories] reorder failed', { code: next[i].code, error })
      return { ok: false, error: categoryErrorMessage(error) }
    }
    if (!data || data.length === 0) {
      return { ok: false, error: categoryErrorMessage({ code: '42501' }) }
    }
  }
  invalidateQuoteCategories()
  return { ok: true }
}

/** 새 분류의 기본 순서 — 맨 뒤. */
export const nextSortOrder = (list: QuoteCategory[]): number =>
  list.length === 0 ? ORDER_STEP : Math.max(...list.map(c => c.sort_order)) + ORDER_STEP

/**
 * 화면에서 쓰는 훅. 캐시를 공유하므로 여러 화면이 함께 써도 조회는 한 번이다.
 * reload 는 관리 화면이 쓴다(캐시를 버리고 다시 읽는다).
 */
export function useQuoteCategories(): {
  categories: QuoteCategory[]
  loading: boolean
  reload: () => Promise<void>
} {
  const [categories, setCategories] = useState<QuoteCategory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    loadQuoteCategories().then(list => {
      if (cancelled) return
      setCategories(list)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const reload = useCallback(async () => {
    invalidateQuoteCategories()
    const list = await loadQuoteCategories()
    setCategories(list)
  }, [])

  return { categories, loading, reload }
}
