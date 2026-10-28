// 계정 × 견적 분류별 **마지막 설정**(환율·관세율·이익률) — 읽기·쓰기와 최빈값 규칙.
//
// 표는 quote_user_defaults(engineer_email + category 가 PK). 그 사람이 그 분류로 **마지막에
// 확정한** 값이고, 다음에 같은 분류로 새 견적을 쓸 때의 출발값이다.
//
// ── 왜 최빈값인가 ───────────────────────────────────────────────────────────
//   견적 한 건에는 품목 줄이 여럿이고 줄마다 관세·이익률이 다를 수 있다. 「마지막 줄」을
//   기억하면 할인 끝에 끼워 넣은 한 줄이 다음 견적의 기본값이 되고, 평균을 쓰면 아무도
//   쓰지 않은 숫자(예: 56.7%)가 나온다. **가장 많이 쓴 값**이 그 사람의 그 분류 습관이다.
//
//   센 줄은 **이익률 모드의 가격표·수동입력 줄만**이다.
//     · 판매가 모드 줄(price_mode='price') — 이익률이 역산값이라 사람이 고른 값이 아니다.
//     · 국내조달품 — 관세를 쓰지 않는다(1 로 박혀 있다).
//     · 서비스비·할인 — 관세도 이익률도 뜻이 없다(0 이거나 계산 결과다).
//
//   같은 횟수면 **먼저 나온 값**을 쓴다. 규칙이 없으면 같은 견적을 두 번 확정할 때 결과가
//   달라져 「왜 바뀌었나」를 설명할 수 없다.
//
// ── 저장하지 않는 경우 ──────────────────────────────────────────────────────
//   임시저장(초안 자동 저장)과 **대필**이다. 대필은 남의 실적으로 들어가는 견적이라,
//   그 사람의 습관을 내 기본값으로 기억하면 다음 내 견적이 엉뚱한 값으로 시작한다.
//
// 순수 함수(modeOf)는 하네스가 그대로 돌린다 — scripts/quote-defaults-check.js.

import type { SupabaseClient } from '@supabase/supabase-js'

/** 표 이름 — 읽는 곳과 쓰는 곳이 같은 글자를 쓴다. */
const TABLE = 'quote_user_defaults'

/** 한 줄의 값. 칸이 비어 있으면 null 이고, 그때는 부르는 쪽이 종전 기본값으로 간다. */
export type QuoteUserDefaults = {
  exchangeRate: number | null
  tariffRate: number | null
  marginRate: number | null
  /** 그 줄을 마지막으로 저장한 날(YYYY-MM-DD, KST 아님 — 표의 updated_at 앞 10자). */
  savedAt: string | null
}

/** 최빈값을 셀 때 보는 줄의 모양 — QuoteRow 에서 이 네 칸만 쓴다. */
export type DefaultsRow = {
  row_kind: string
  price_mode?: string
  tariff_rate?: number
  profit_rate?: number
}

/** 그 줄을 세는가 — 이익률 모드의 가격표·수동입력 줄만. */
export function countsForDefaults(row: DefaultsRow): boolean {
  if (row.row_kind !== 'price_list' && row.row_kind !== 'manual_jpy') return false
  return (row.price_mode ?? 'rate') === 'rate'
}

/**
 * 최빈값 — 가장 많이 나온 값. 같은 횟수면 먼저 나온 값. 셀 줄이 없으면 null.
 *
 * 0 과 음수는 세지 않는다 — 관세 0·이익률 0 은 「아직 안 정했다」로 들어온 값이고
 * (할인 줄의 tariff_rate 가 0 이다), 그것을 기본값으로 기억하면 다음 견적의 원가가
 * 0 에서 시작한다. 이익률 0% 를 **정말** 쓰고 싶은 사람은 줄마다 0 을 넣으면 된다 —
 * 그 값은 기억되지 않을 뿐 그 견적에는 그대로 쓰인다.
 */
function modeOf(values: number[]): number | null {
  const counts = new Map<number, number>()
  for (const v of values) {
    if (!Number.isFinite(v) || v <= 0) continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let best: number | null = null
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c }
  }
  return best
}

/** 품목 줄들에서 기억할 관세율·이익률. 셀 줄이 없으면 둘 다 null. */
export function defaultsFromRows(rows: DefaultsRow[]): { tariffRate: number | null; marginRate: number | null } {
  const counted = rows.filter(countsForDefaults)
  return {
    tariffRate: modeOf(counted.map(r => Number(r.tariff_rate))),
    marginRate: modeOf(counted.map(r => Number(r.profit_rate))),
  }
}

/** 숫자 칸 하나 — 값이 없거나 숫자가 아니거나 0 이하면 null(「저장된 것 없음」). */
function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 본인·그 분류의 저장된 설정. 없으면 null.
 *
 * **못 읽어도 조용하다.** 정책이 아직 없거나(파일 db/quote_user_defaults_rls.sql 미적용)
 * 표가 비어 있으면 null 이고, 화면은 종전 기본값으로 간다 — 견적 작성이 막히지 않는다.
 * 어느 줄을 달라고 할지만 이메일로 고르고, 무엇이 돌아오는지는 서버의 RLS 가 정한다.
 */
export async function loadQuoteUserDefaults(
  supabase: SupabaseClient,
  email: string | null | undefined,
  category: string,
): Promise<QuoteUserDefaults | null> {
  if (!email || !category.trim()) return null
  const { data, error } = await supabase
    .from(TABLE)
    .select('exchange_rate, tariff_rate, margin_rate, updated_at')
    .eq('engineer_email', email)
    .eq('category', category)
    .maybeSingle()
  if (error) { console.error('[quote] 저장된 설정을 읽지 못했습니다', error); return null }
  if (!data) return null
  const row = data as { exchange_rate: unknown; tariff_rate: unknown; margin_rate: unknown; updated_at: unknown }
  const out: QuoteUserDefaults = {
    exchangeRate: num(row.exchange_rate),
    tariffRate: num(row.tariff_rate),
    marginRate: num(row.margin_rate),
    savedAt: typeof row.updated_at === 'string' ? row.updated_at.slice(0, 10) : null,
  }
  // 세 칸이 모두 비어 있으면 줄이 있어도 쓸 것이 없다 — 없는 것으로 다룬다.
  if (out.exchangeRate === null && out.tariffRate === null && out.marginRate === null) return null
  return out
}

/**
 * 확정한 값으로 한 줄을 덮어쓴다(없으면 만든다).
 *
 * **실패해도 조용하다** — 견적은 이미 저장됐고, 이 줄은 다음 견적의 편의일 뿐이다.
 * 정책이 아직 없으면 0행으로 끝나거나 거절되는데, 그때 사용자에게 알릴 것이 없다
 * (알린다면 「견적은 저장됐지만 설정 기억은 실패」가 되어 겁만 준다). 콘솔에만 남긴다.
 *
 * engineer_email 은 **DB 가 다시 본다** — 정책의 with check 가 JWT 이메일과 같은 줄만
 * 받는다. 그래서 여기서 남의 이메일을 넣어도 들어가지 않는다.
 */
export async function saveQuoteUserDefaults(
  supabase: SupabaseClient,
  email: string | null | undefined,
  category: string,
  values: { exchangeRate: number | null; tariffRate: number | null; marginRate: number | null },
): Promise<void> {
  if (!email || !category.trim()) return
  // 셋 다 없으면 쓸 것이 없다(품목이 전부 판매가 모드인 견적 등).
  if (values.exchangeRate === null && values.tariffRate === null && values.marginRate === null) return
  const { error } = await supabase.from(TABLE).upsert({
    engineer_email: email,
    category,
    exchange_rate: values.exchangeRate,
    tariff_rate: values.tariffRate,
    margin_rate: values.marginRate,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'engineer_email,category' })
  if (error) console.error('[quote] 설정을 기억하지 못했습니다', error)
}
