// 포캐스트 **단계 이력** — 쓰기·읽기·요약 (2026-11-28, 야간4 4-1).
//
// ── 왜 ─────────────────────────────────────────────────────────────────────
//   포캐스트에 남는 것은 **마지막 단계 하나**였다(sales_opportunities.stage). 그래서
//   「이 건이 견적제출까지 갔다가 되돌아왔나」를 물을 수 없었고, 활동 이력도 **지금
//   단계**를 적어 지난 줄의 뜻이 날마다 달라졌다(4-2 가 고친다).
//
// ── 어디서 쓰나 ────────────────────────────────────────────────────────────
//   생성       hooks/customer/useOpportunityCrud.ts (saveOpp)
//   단계 변경   같은 곳 (saveOpp 의 수정 · changeStage) · 칸반 드래그가 changeStage 를 쓴다
//   실주·종료   같은 곳 (markLost · setClosed)
//   자동 동기화 app/api/customer-change/route.ts (forecast-sync — 견적이 끌고 간다)
//
// ── 표가 아직 없을 때 ──────────────────────────────────────────────────────
//   db/opportunity_stage_history_20261128.sql 적용 전에는 42P01/PGRST205 가 난다.
//   그때는 **customer_events 에 한 줄** 남기고 조용히 넘어간다 — 단계 이동이 막히지
//   않는 것이 먼저다. 읽기는 빈 목록이라 요약 칸이 비어 보일 뿐이다.
//
// 요약 함수는 순수하다 — 하네스가 그대로 돌린다(scripts/forecast-stage-history-check.js).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerEventType } from '@/lib/customerEvents'

/** 표 이름 — 한 곳에서 적는다. */
export const STAGE_HISTORY_TABLE = 'opportunity_stage_history'

/** 표가 아직 없을 때 customer_events 에 남기는 종류. */
export const STAGE_FALLBACK_EVENT: CustomerEventType = 'forecast_stage_changed'

export type StageHistoryRow = {
  opportunity_id: number
  /** 생성 줄은 null 이다(어디에서 온 것이 아니다). */
  from_stage: string | null
  to_stage: string
  changed_at: string
  changed_by?: number | null
}

/** 표가 아직 없다는 뜻인가. */
export const stageTableMissing = (error: { code?: string | null; message?: string | null } | null): boolean => {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205'
    || new RegExp(STAGE_HISTORY_TABLE).test(error.message ?? '')
}

/**
 * 단계 한 번의 이동을 적는다. **본 일을 막지 않는다** — 실패해도 false 만 돌려준다.
 *
 * 표가 없으면 customer_events 에 남긴다(customerId 를 알 때만 — 사건은 사업장 줄에 붙는다).
 */
export async function recordStageChange(
  supabase: SupabaseClient,
  input: {
    opportunityId: number
    /** 없으면 생성 줄이다. */
    fromStage?: string | null
    toStage: string
    changedBy?: number | null
    /** 적는 시각. 주지 않으면 DB 의 now(). */
    changedAt?: string
    /** 표가 없을 때 사건을 붙일 사업장. 모르면 폴백도 건너뛴다. */
    customerId?: number | null
    /** 폴백으로 사건을 적는 함수(화면은 logCustomerEvent, 서버는 writeCustomerEvents 를 감싼 것). */
    logEvent?: (row: { customerId: number; type: CustomerEventType; payload: Record<string, unknown> }) => void
  },
): Promise<boolean> {
  const row: Record<string, unknown> = {
    opportunity_id: input.opportunityId,
    from_stage: input.fromStage ?? null,
    to_stage: input.toStage,
    changed_by: input.changedBy ?? null,
  }
  if (input.changedAt) row.changed_at = input.changedAt

  const { error } = await supabase.from(STAGE_HISTORY_TABLE).insert(row)
  if (!error) return true

  if (stageTableMissing(error)) {
    console.warn(`[stageHistory] ${STAGE_HISTORY_TABLE} 표가 아직 없다 — 사건으로 남긴다 (db/opportunity_stage_history_20261128.sql)`)
    const customerId = Number(input.customerId ?? 0)
    if (input.logEvent && Number.isInteger(customerId) && customerId > 0) {
      input.logEvent({
        customerId,
        type: STAGE_FALLBACK_EVENT,
        payload: {
          opportunity_id: input.opportunityId,
          from_stage: input.fromStage ?? null,
          to_stage: input.toStage,
        },
      })
    }
    return false
  }
  console.warn('[stageHistory] 단계 이력을 적지 못했다 — 단계 이동은 그대로다', error.code, error.message)
  return false
}

/**
 * 여러 건의 이력을 한 번에 읽는다. 표가 없으면 **빈 Map** 이다(화면은 요약 칸만 비운다).
 * 한 건의 줄은 **시간 순**으로 들어 있다.
 */
export async function fetchStageHistories(
  supabase: SupabaseClient,
  opportunityIds: readonly number[],
): Promise<Map<number, StageHistoryRow[]>> {
  const out = new Map<number, StageHistoryRow[]>()
  const ids = [...new Set(opportunityIds)].filter(id => Number.isInteger(id) && id > 0)
  if (ids.length === 0) return out
  const { data, error } = await supabase
    .from(STAGE_HISTORY_TABLE)
    .select('opportunity_id, from_stage, to_stage, changed_at, changed_by')
    .in('opportunity_id', ids)
    .order('changed_at', { ascending: true })
  if (error) {
    if (!stageTableMissing(error)) console.warn('[stageHistory] 이력을 읽지 못했다', error.code, error.message)
    return out
  }
  for (const r of (data ?? []) as StageHistoryRow[]) {
    const list = out.get(r.opportunity_id)
    if (list) list.push(r)
    else out.set(r.opportunity_id, [r])
  }
  return out
}

/** 「9/20」 — 해는 적지 않는다(한 줄에 네 칸이 서야 한다). */
export function shortDate(iso: string | null | undefined): string {
  const s = String(iso ?? '')
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return ''
  return `${Number(m[2])}/${Number(m[3])}`
}

/**
 * 이력 요약 한 줄 — 「상담 9/4 → 견적제출 9/20 → 협상 10/15 → 실주 11/24」.
 *
 * 줄이 없으면 빈 글자다. 같은 단계가 잇따라 적혀 있으면(자동 동기화가 겹쳐 쓴 경우)
 * **뒤엣것만** 남긴다 — 「협상 10/15 → 협상 10/15」는 읽는 사람에게 아무것도 말하지 않는다.
 */
export function summarizeStageHistory(rows: readonly StageHistoryRow[]): string {
  const sorted = [...rows].sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)))
  const parts: string[] = []
  let prev: string | null = null
  for (const r of sorted) {
    const stage = String(r.to_stage ?? '').trim()
    if (!stage || stage === prev) continue
    const d = shortDate(r.changed_at)
    parts.push(d ? `${stage} ${d}` : stage)
    prev = stage
  }
  return parts.join(' → ')
}
