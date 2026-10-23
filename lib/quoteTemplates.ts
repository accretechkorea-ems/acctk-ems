'use client'

// 장비 구성 템플릿(quote_templates · quote_template_items) — 읽기와 서버 호출.
//
// ── 읽기와 쓰기의 길이 다르다 ───────────────────────────────────────────────
//   읽기 : 세션 클라이언트로 직접 읽는다. RLS 의 SELECT 정책이 「superadmin 또는 견적 권한」
//          으로 이미 걸러 준다(quote_category_template_schema.sql 단계 4·5).
//   쓰기 : **서버 라우트(service role)만** 한다. 두 표에는 **쓰기 정책이 아예 없어서**
//          브라우저에서는 어떤 쓰기도 통과하지 못한다. 「견적 권한자는 누구나 고칠 수 있다」는
//          규칙은 라우트가 판정한다(app/api/quote-templates/route.ts).
//          owner_id·owner_name·updated_by·deleted_by 는 라우트가 **세션에서 강제로** 채운다 —
//          본문 값을 믿지 않는다(create_quote 가 created_by 를 강제하는 것과 같은 규칙).
//
// ── 가격을 저장하지 않는다 ──────────────────────────────────────────────────
//   품번만 저장하고 구입가(원가)는 **열 때 가격표에서 새로 계산한다.** 저장해 두면 가격표가
//   개정될 때 템플릿만 옛 값으로 굳는다. 사람이 정한 **판매단가**는 다시 계산할 수 없어
//   default_sell_price 에 담는다.
//
// DB 모양은 quote_category_template_schema.sql 이 정본이다.

import type { SupabaseClient } from '@supabase/supabase-js'

// ── 저장 모양 ───────────────────────────────────────────────────────────────

/** 템플릿 머리. is_deleted = true 인 행은 목록 조회가 걸러 낸다(soft delete). */
export type QuoteTemplate = {
  id: string
  name: string
  owner_id: number | null
  owner_name: string
  form_kind: string
  category: string | null
  model_key: string | null
  used_count: number
  last_used_at: string | null
  updated_at: string
}

/**
 * 템플릿의 한 줄.
 *
 * ⚠ **default_sell_price 는 국내조달품에서 뜻이 둘이다.**
 *   · 가격표·수동 품목(base/option/include) — 말 그대로 **판매단가**다.
 *   · 국내조달품(domestic)              — 그 줄은 매출이 아니라 **자사 부담 원가**이고
 *     (calc.ts 의 domestic 분기가 입력값을 원가로 쓴다) 원가를 담을 칸이 표에 없다.
 *     그래서 이 칸을 **기본 금액**으로 겸용한다. 불러올 때 manual_unit_price 로 들어간다.
 *   칸을 하나 더 두지 않은 이유는 뜻이 다른 두 칸이 생기면 읽는 쪽이 갈리기 때문이다.
 */
export type QuoteTemplateItem = {
  id: string
  template_id: string
  group_kind: string
  row_kind: string
  part_code: string | null
  /**
   * 가격표 줄의 구분값('' = 구분 없음).
   * 품번만으로는 **묶음 제목이 다른 여러 줄**을 가릴 수 없어 함께 저장한다(가격표 2단계).
   * 이 칸이 없던 때 저장된 템플릿은 DB 기본값 '' 로 읽히고, 종전처럼 동작한다.
   */
  variant: string
  item_name: string | null
  qty_per_unit: number
  default_checked: boolean
  default_sell_price: number | null
  /**
   * 직접 적은 줄(row_kind manual_jpy)의 **구입가(엔)**.
   *
   * 품번이 가격표에 없으니 열 때 되찾을 수 없어 저장한다. default_sell_price 에 섞지 않는
   * 이유 — 그 칸은 이미 뜻이 둘(판매단가 · 원화 원가)이고, 직접 적은 줄도 판매단가를 손으로
   * 넣을 수 있어 세 번째 뜻을 더하면 읽는 쪽이 갈린다.
   *
   * ⚠ 이 칸은 **DB 에 아직 없을 수 있다**(quote_template_items.default_cost_jpy).
   *   그래서 읽기는 select('*') 로 하고(없으면 undefined), 쓰기는 값이 있을 때만 보낸다.
   */
  default_cost_jpy?: number | null
  sort_order: number
}

/** 머리 + 줄. 모달이 한 덩어리로 들고 다닌다. */
export type QuoteTemplateFull = QuoteTemplate & { items: QuoteTemplateItem[] }

// ── 입력 상한 ───────────────────────────────────────────────────────────────
//
// 값은 lib/quoteTemplateLimits.ts 에 있다 — 이 파일은 `'use client'` 라서 서버(API 라우트)가
// 여기서 상수를 가져가면 Next 가 **client reference proxy** 로 바꿔 끼운다(숫자가 아니게 된다).
// 화면 쪽이 import 경로를 바꾸지 않아도 되게 여기서 다시 내보낸다.
export {
  TEMPLATE_NAME_MAX, TEMPLATE_ITEM_MAX, TEMPLATE_QTY_MAX, TEMPLATE_PRICE_MAX,
} from './quoteTemplateLimits'

const HEAD_COLUMNS =
  'id, name, owner_id, owner_name, form_kind, category, model_key, used_count, last_used_at, updated_at'
// 줄은 칸을 **모두** 받는다. 칸 이름을 적어 두면 아직 없는 칸(default_cost_jpy)을 적는 순간
// 조회가 통째로 실패한다 — 표가 작아서 전부 받아도 부담이 없다.
const ITEM_COLUMNS = '*'

// ── 읽기 ────────────────────────────────────────────────────────────────────

/**
 * 살아 있는 템플릿 전부(머리만). 모달이 기종 목록을 만들 때 쓴다.
 * 정렬은 화면이 다시 한다(내 것 먼저 → 최근 사용 순) — 그 규칙이 화면 쪽 뜻이라서다.
 */
export async function loadQuoteTemplates(supabase: SupabaseClient): Promise<QuoteTemplate[]> {
  const { data, error } = await supabase
    .from('quote_templates')
    .select(HEAD_COLUMNS)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false })
  if (error) {
    console.error('[quoteTemplates] 목록 조회 실패', error)
    return []
  }
  return (data ?? []) as QuoteTemplate[]
}

/** 템플릿 한 벌(머리 + 줄). 줄은 sort_order 순이다. */
export async function loadQuoteTemplate(
  supabase: SupabaseClient, id: string,
): Promise<QuoteTemplateFull | null> {
  const [head, items] = await Promise.all([
    supabase.from('quote_templates').select(HEAD_COLUMNS).eq('id', id).maybeSingle(),
    supabase.from('quote_template_items').select(ITEM_COLUMNS).eq('template_id', id).order('sort_order'),
  ])
  if (head.error || !head.data) {
    console.error('[quoteTemplates] 조회 실패', { id, error: head.error })
    return null
  }
  if (items.error) {
    console.error('[quoteTemplates] 줄 조회 실패', { id, error: items.error })
    return null
  }
  return { ...(head.data as QuoteTemplate), items: (items.data ?? []) as QuoteTemplateItem[] }
}

/**
 * 목록 정렬 — **내가 만든 것 먼저, 그 안에서 최근 사용 순.**
 * 쓴 적이 없으면 last_used_at 이 비어 있어 updated_at 으로 떨어진다.
 */
export function sortTemplates(list: QuoteTemplate[], myId: number | null): QuoteTemplate[] {
  const recency = (t: QuoteTemplate) => Date.parse(t.last_used_at ?? t.updated_at) || 0
  return [...list].sort((a, b) => {
    const am = a.owner_id != null && a.owner_id === myId ? 0 : 1
    const bm = b.owner_id != null && b.owner_id === myId ? 0 : 1
    if (am !== bm) return am - bm
    return recency(b) - recency(a)
  })
}

/** 내가 만든 템플릿인가. 남의 것은 「복사 저장」이 기본이다. */
export const isMyTemplate = (t: QuoteTemplate, myId: number | null): boolean =>
  myId != null && t.owner_id === myId

// ── 쓰기 (서버 라우트) ──────────────────────────────────────────────────────

export type TemplateResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

/** 라우트에 보낼 줄. id·template_id 는 서버가 만든다. */
export type TemplateItemInput = {
  group_kind: string
  row_kind: string
  /** 직접 적은 줄의 구입가(엔). 없으면 보내지 않는다(위 주석 참조). */
  default_cost_jpy?: number | null
  part_code: string | null
  /** 가격표 줄의 구분값('' = 구분 없음). 품번과 짝으로 가격표를 다시 찾는 열쇠다. */
  variant: string
  item_name: string | null
  qty_per_unit: number
  default_checked: boolean
  default_sell_price: number | null
  sort_order: number
}

export type TemplateSaveInput = {
  name: string
  model_key: string | null
  category: string | null
  items: TemplateItemInput[]
}

async function callTemplateApi<T>(body: unknown): Promise<TemplateResult<T>> {
  try {
    const res = await fetch('/api/quote-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json?.error || '저장하지 못했습니다' }
    return { ok: true, data: json as T }
  } catch (e) {
    console.error('[quoteTemplates] 요청 실패', e)
    return { ok: false, error: '서버에 연결하지 못했습니다' }
  }
}

/** 새 템플릿. owner 는 서버가 세션에서 채운다. */
export const createTemplate = (input: TemplateSaveInput) =>
  callTemplateApi<{ id: string }>({ action: 'create', ...input })

/** 원본 수정 — 머리와 줄을 통째로 바꾼다(줄은 지우고 다시 넣는다). */
export const updateTemplate = (id: string, input: TemplateSaveInput) =>
  callTemplateApi<{ id: string }>({ action: 'update', id, ...input })

/** 지우기 — 행을 지우지 않고 is_deleted 를 세운다(soft delete). */
export const deleteTemplate = (id: string) =>
  callTemplateApi<{ id: string }>({ action: 'delete', id })

/**
 * 사용 기록 — used_count + 1, last_used_at = now.
 * **실패해도 견적 추가를 막지 않는다**(부르는 쪽이 결과를 버린다).
 */
export const markTemplateUsed = (id: string) =>
  callTemplateApi<{ id: string }>({ action: 'use', id })

/**
 * 템플릿별 줄 수 — 목록에 「N항목」을 보여 주려고 센다.
 *
 * 관계 임베딩(`quote_template_items(count)`)을 쓰지 않고 template_id 만 받아 세는 이유는,
 * 임베딩이 PostgREST 의 관계 노출에 기대고 그게 어긋나면 **목록 자체가 비기** 때문이다.
 * 받는 값은 id 한 칸뿐이라 양도 작다(템플릿당 최대 TEMPLATE_ITEM_MAX 줄).
 */
export async function loadTemplateItemCounts(
  supabase: SupabaseClient, ids: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (ids.length === 0) return counts
  const { data, error } = await supabase
    .from('quote_template_items')
    .select('template_id')
    .in('template_id', ids)
  if (error) {
    console.error('[quoteTemplates] 줄 수 조회 실패', error)
    return counts
  }
  for (const r of (data ?? []) as { template_id: string }[]) {
    counts.set(r.template_id, (counts.get(r.template_id) ?? 0) + 1)
  }
  return counts
}
