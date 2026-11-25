// 포캐스트(영업기회) ↔ 연결 견적 — **앞으로만 움직이는** 동기화 규칙 (2026-11-26).
//
// ── 무엇을 맞추나 ────────────────────────────────────────────────────────
//   ① 단계 — 연결 견적이 있으면 최소 「견적제출」, 발주(주문 대기) 이상이면 「수주」.
//   ② 금액 — 연결 견적의 **공급가 합계**. 연결이 하나도 없으면 손으로 넣은 값을 둔다.
//   ③ 종료 — 수주가 되면 closed_at 에 **발주일**을 적는다.
//
// ── 내리지 않는다 ────────────────────────────────────────────────────────
//   사람이 「협상」까지 올려 둔 건을 견적 하나 때문에 「견적제출」로 **내리지 않는다**.
//   자동은 올리는 쪽으로만 간다(stageRank 로 견준다). 실주도 자동으로 만들지 않는다 —
//   연결 견적이 전부 실패·취소여도 사유는 사람이 적는다(카드가 뱃지로 알린다).
//
// 순수 모듈이다(import 는 규칙 표뿐) — 라우트·화면·하네스가 함께 읽는다.

import { STAGES } from '@/components/customer/opportunity'
import { isOrdered } from '@/lib/quoteStatus'

/** 연결 견적 한 줄 — 동기화에 필요한 것만. */
export type LinkedQuote = {
  quote_id: number
  status: string | null
  total_supply: number | null
  /** 발주서가 등록된 시각(수주일의 정본). */
  purchase_order_at: string | null
}

/** 지금 포캐스트의 값 — 내리지 않기 위해 본다. */
export type ForecastNow = {
  stage: string | null
  expected_amount: number | null
  closed_at: string | null
}

/** 자동으로 올라갈 수 있는 두 단계. */
export const AUTO_STAGE_QUOTED = '견적제출'
export const AUTO_STAGE_WON = '수주'

/** 끝난 것으로 보는 견적 상태 — 합계와 단계에서 뺀다. */
export const DEAD_QUOTE_STATUSES: readonly string[] = ['실패', '취소요청', '취소']

const rank = (stage: string | null | undefined): number => {
  const i = (STAGES as readonly string[]).indexOf(String(stage ?? ''))
  return i < 0 ? -1 : i
}

/** 살아 있는 연결 견적만(실패·취소는 뺀다). */
export const liveQuotes = (quotes: readonly LinkedQuote[]): LinkedQuote[] =>
  quotes.filter(q => !DEAD_QUOTE_STATUSES.includes(String(q.status ?? '')))

/** 연결 견적이 하나라도 있는데 **전부 죽었는가** — 카드가 「실주 사유 입력 필요」를 띄우는 조건. */
export const allDead = (quotes: readonly LinkedQuote[]): boolean =>
  quotes.length > 0 && liveQuotes(quotes).length === 0

/**
 * 맞춰야 할 값. 바꿀 것이 없으면 **빈 객체**를 돌려준다(그때는 쓰지 않는다).
 *
 * @param quotes 그 포캐스트에 연결된 견적 전부(죽은 것 포함 — 판정에 쓴다)
 */
export function forecastPatch(now: ForecastNow, quotes: readonly LinkedQuote[]): Record<string, unknown> {
  const live = liveQuotes(quotes)
  const patch: Record<string, unknown> = {}

  // ① 단계 — 올리는 쪽으로만.
  const won = live.filter(q => isOrdered(q.status))
  const want = won.length > 0 ? AUTO_STAGE_WON : (live.length > 0 ? AUTO_STAGE_QUOTED : null)
  if (want && rank(want) > rank(now.stage)) patch.stage = want

  // ③ 종료 — 수주가 되는 순간에만 적는다. 이미 적혀 있으면 두 번 쓰지 않는다.
  if (won.length > 0 && !now.closed_at) {
    const when = won
      .map(q => String(q.purchase_order_at ?? '').slice(0, 10))
      .filter(Boolean)
      .sort()[0]
    if (when) patch.closed_at = when
  }

  // ② 금액 — 연결(살아 있는 것)이 1건 이상이면 그 합계다. 없으면 손 값을 둔다.
  if (live.length > 0) {
    const sum = live.reduce((s, q) => s + (Number(q.total_supply) || 0), 0)
    if (sum !== Number(now.expected_amount ?? 0)) patch.expected_amount = sum
  }

  return patch
}

/**
 * 그 견적에 연결된 포캐스트를 맞춘다 — **서버에서** 부른다(service role 클라이언트).
 *
 * 화면은 /api/customer-change 의 `forecast-sync` 를 부르고, 서버끼리는 이 함수를
 * 그대로 쓴다(발주 라우트). 어느 쪽이든 규칙은 위 forecastPatch 하나다.
 * 못 찾거나 바꿀 것이 없으면 조용히 끝난다 — 맞추기가 본 일을 막지 않는다.
 */
export async function syncForecastOf(
  sb: { from: (t: string) => any },   // eslint-disable-line @typescript-eslint/no-explicit-any
  quoteId: number,
): Promise<{ changed: boolean }> {
  if (!Number.isInteger(quoteId) || quoteId <= 0) return { changed: false }
  const { data: q } = await sb.from('quotes').select('opportunity_id').eq('quote_id', quoteId).maybeSingle()
  const oppId = Number(q?.opportunity_id ?? 0)
  if (!oppId) return { changed: false }

  const [{ data: opp }, { data: linked }] = await Promise.all([
    sb.from('sales_opportunities').select('opportunity_id, stage, expected_amount, closed_at').eq('opportunity_id', oppId).maybeSingle(),
    sb.from('quotes').select('quote_id, status, total_supply, purchase_order_at').eq('opportunity_id', oppId),
  ])
  if (!opp) return { changed: false }
  const patch = forecastPatch(opp as ForecastNow, (linked ?? []) as LinkedQuote[])
  if (Object.keys(patch).length === 0) return { changed: false }
  const { error } = await sb.from('sales_opportunities').update(patch).eq('opportunity_id', oppId)
  if (error) { console.error('[forecastSync] update failed', { oppId, error }); return { changed: false } }
  return { changed: true }
}
