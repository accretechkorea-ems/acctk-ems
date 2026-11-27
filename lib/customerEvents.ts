// 고객 사건 로그 쓰기 — **service role 라우트에서만** 부른다(db/customer_events_20261120.sql).
//
// ── 왜 영업 활동이 아니라 사건인가 ───────────────────────────────────────
//   「리드가 들어왔다」·「담당이 배정됐다」는 사람이 한 활동이 아니라 **벌어진 일**이다.
//   그동안은 sales_activities 에 자동으로 한 줄을 끼워 넣었는데, 그러면
//     · 영업 활동 건수·종류 통계가 부풀고(만난 적 없는 「방문미팅」처럼 보인다),
//     · 사람이 그 줄을 고치거나 지울 수 있고,
//     · 활동 종류 표에 쓰지 않는 종류가 쌓인다.
//   이제 customer_events 에 적는다. 사람은 읽기만 한다.
//
// ── 표가 아직 없어도 리드 배정은 되어야 한다 ─────────────────────────────
//   SQL 적용 전에 코드가 먼저 배포될 수 있다. 사건을 적지 못하는 것은
//   **배정을 막을 이유가 못 되므로**, 로그만 남기고 조용히 넘어간다(lib/nameEn.ts 와 같은 태도).

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 사건 종류 — 늘어나면 여기 한 줄만 더한다(스키마는 그대로다).
 *
 * 2026-11-23 에 **고친 일**도 사건으로 적기 시작했다. 누가 무엇을 무엇으로 바꿨는지가
 * 아무 데도 남지 않아, 「어제까지 활성이었는데」를 확인할 길이 없었다.
 * ⚠ 이 줄들은 **활동이 아니다** — 최근 활동(lib/customerLastTouch.ts)은 보지 않는다.
 *   활동 이력에서도 「변경」 묶음으로 따로 서고 기본 필터에서 꺼져 있다.
 */
export type CustomerEventType =
  | 'lead_registered' | 'lead_assigned' | 'lead_reassigned'
  | 'site_status_changed' | 'site_agency_changed' | 'site_moved' | 'sites_merged'
  | 'company_industry_changed' | 'site_edited' | 'contact_edited' | 'device_edited'
  // 지우기·되돌리기 — 소프트 삭제다(deleted_at). 어느 줄을 왜 지웠는지 payload 에 담는다.
  | 'customer_deleted' | 'customer_restored'
  // 지울 수 없는 사람이 지워 달라고 한 자국(lib/customerDelete.ts).
  | 'company_delete_requested'
  // 리드 — 번호를 반납하고 되찾는다(lib/leadRecall.ts)와 **상태가 바뀐 자국**.
  | 'lead_recalled' | 'lead_restored'
  | 'lead_unassignable' | 'lead_converted' | 'lead_status_changed'
  // 견적을 포캐스트에 걸거나 푼 자국(2026-11-26).
  | 'quote_forecast_linked'
  /**
   * ── 2026-11-27 야간3 2-2 에서 더한 것 ──────────────────────────────────
   * 「이 사업장에 **무슨 일이 있었나**」를 타임라인이 다 말하게 한다. 전에는 리드와
   * 고친 자국만 남아, 홀딩이 걸려 있어도·포캐스트가 끝나도·수리품이 들어와도
   * 이력에는 아무 줄도 서지 않았다.
   *
   * 포캐스트의 **단계 고침**은 2026-11-28(야간4 4-2)부터 적는다 — 「단계 견적제출 →
   * 협상」 한 줄이다. 전에는 「자주 오르내려 이력이 덮인다」는 이유로 빼 두었는데,
   * 그 바람에 **언제 어디까지 갔는지**를 아무 데서도 볼 수 없었다. 대신 그 줄은
   * 작게 적고(활동 이력의 보조 줄), 금액·제목 같은 잡 변경은 여전히 적지 않는다.
   *
   * forecast_stage_changed 는 두 길로 들어온다:
   *   ① opportunity_stage_history 표가 아직 없을 때의 **폴백**
   *   ② 표가 있어도 **활동 이력에 보일 한 줄**로(두 곳이 같은 payload 를 쓴다)
   */
  | 'holding_started' | 'holding_resolved'
  | 'forecast_created' | 'forecast_closed' | 'forecast_stage_changed'
  | 'repair_received' | 'repair_shipped'
  | 'inquiry_created'

/**
 * 「리드」 묶음 — 활동 이력이 이 묶음을 **「리드」 종류**로 세운다(기본 켜짐).
 * 고친 자국(변경)과 다르다 — 리드는 **밖에서 들어온 일**이라 활동으로 읽힌다.
 */
export const LEAD_EVENT_TYPES: readonly CustomerEventType[] = [
  'lead_registered', 'lead_assigned', 'lead_reassigned',
  'lead_unassignable', 'lead_converted', 'lead_status_changed',
  'lead_recalled', 'lead_restored',
]

/** 그 사건이 리드 줄인가. */
export function isLeadEvent(type: string): boolean {
  return (LEAD_EVENT_TYPES as readonly string[]).includes(type)
}

/** 「고친 일」 묶음 — 활동 이력이 이 묶음을 「변경」으로 접어 둔다. */
export const CHANGE_EVENT_TYPES: readonly CustomerEventType[] = [
  'site_status_changed', 'site_agency_changed', 'site_moved', 'sites_merged',
  'company_industry_changed', 'site_edited', 'contact_edited', 'device_edited',
  'customer_deleted', 'customer_restored', 'quote_forecast_linked',
]

/**
 * 「일」 묶음 — **밖에서 벌어진 일**이다(고친 자국이 아니다). 2026-11-27 야간3 2-2.
 * 활동 이력이 리드와 같은 자리에 세운다 — 접어 두지 않는다.
 */
export const WORK_EVENT_TYPES: readonly CustomerEventType[] = [
  'holding_started', 'holding_resolved',
  'forecast_created', 'forecast_closed',
  'repair_received', 'repair_shipped',
  'inquiry_created',
]

/** 그 사건이 「일」인가. */
export function isWorkEvent(type: string): boolean {
  return (WORK_EVENT_TYPES as readonly string[]).includes(type)
}

/**
 * 포캐스트 셋 — 생성 · 단계 · 종료 (2026-11-28, 야간4 4-2).
 * 활동 이력이 이 셋을 **「포캐스트」 종류**로 세운다. 같은 건의 줄이 회색 「사건」과
 * 노란 「포캐스트」로 갈라져 서면 한 건으로 읽히지 않는다.
 */
export const FORECAST_EVENT_TYPES: readonly CustomerEventType[] = [
  'forecast_created', 'forecast_stage_changed', 'forecast_closed',
]

/** 그 사건이 포캐스트 줄인가. */
export function isForecastEvent(type: string): boolean {
  return (FORECAST_EVENT_TYPES as readonly string[]).includes(type)
}

/** 그 사건이 「고친 일」인가. 모르는 종류는 아니라고 본다(옛 줄이 섞여도 종전처럼 보인다). */
export function isChangeEvent(type: string): boolean {
  return (CHANGE_EVENT_TYPES as readonly string[]).includes(type)
}

/** 칸 하나가 바뀐 자국 — payload.changes 에 이 모양으로 담는다. */
export type FieldChange = { field: string; label: string; before: string | null; after: string | null }

/** 두 값이 다른가 — 빈 값·null·공백만 있는 값은 같은 것으로 본다. */
const sameValue = (a: unknown, b: unknown): boolean =>
  String(a ?? '').trim() === String(b ?? '').trim()

/**
 * 바뀐 칸만 골라 자국을 만든다. 하나도 안 바뀌었으면 빈 배열이다
 * (빈 배열이면 부르는 쪽이 사건을 적지 않는다 — 「저장만 누른」 줄을 남기지 않는다).
 */
export function fieldChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  labels: Record<string, string>,
): FieldChange[] {
  const out: FieldChange[] = []
  for (const [field, next] of Object.entries(after)) {
    const prev = before?.[field]
    if (sameValue(prev, next)) continue
    out.push({
      field,
      label: labels[field] ?? field,
      before: prev == null || String(prev).trim() === '' ? null : String(prev),
      after: next == null || String(next).trim() === '' ? null : String(next),
    })
  }
  return out
}

export type CustomerEventRow = {
  customer_id: number
  event_type: CustomerEventType
  occurred_at: string
  actor_engineer_id: number | null
  payload: Record<string, unknown>
}

/** 표가 아직 없다(PGRST205 = 스키마 캐시에 없음, 42P01 = 그런 표 없음). */
const tableMissing = (error: { code?: string | null; message?: string | null } | null): boolean => {
  if (!error) return false
  return error.code === 'PGRST205' || error.code === '42P01' || /customer_events/.test(error.message ?? '')
}

/** 긴 메모를 사건 한 줄에 담을 만큼만 줄인다. */
export const briefNote = (text: string | null | undefined, max = 120): string | null => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

export type LeadLike = {
  lead_id: number
  lead_no: string | null
  industry: string | null
  /** 요약 줄이 쓰는 둘 — 「관심 제품 · 파트너사」. */
  interest_product?: string | null
  partner_company?: string | null
  created_at: string
  meeting_note?: string | null
  request_note?: string | null
  assigned_to: number | null
}

/**
 * 리드 배정 한 번에 쌓이는 사건들을 만든다. **순수 함수** — 하네스가 이 결과를 본다.
 *
 *   · 처음 고객사가 생긴 리드   → lead_registered(등록된 날) + lead_assigned(지금)
 *   · 이미 등록된 리드의 재배정 → lead_reassigned 한 줄 (lead_registered 는 다시 만들지 않는다)
 *   · 회수(담당 없음)          → lead_reassigned 한 줄(받는 사람 칸이 빈다)
 *   · 같은 사람으로 다시 배정   → 사건 없음
 */
export function leadAssignmentEvents(input: {
  lead: LeadLike
  customerId: number
  /** 새 담당자(회수면 null). */
  assignedTo: number | null
  assigneeName: string | null
  /** 바뀌기 전 담당자 이름(있으면). */
  previousName: string | null
  /** 이 배정을 실행한 사람. */
  actorId: number | null
  /** 이 리드의 lead_registered 가 이미 있는가. */
  alreadyRegistered: boolean
  /** 지금 시각(ISO). 시험에서 고정값을 넣는다. */
  now: string
}): CustomerEventRow[] {
  const { lead, customerId, assignedTo, assigneeName, previousName, actorId, alreadyRegistered, now } = input
  const rows: CustomerEventRow[] = []
  const base = { lead_id: lead.lead_id, lead_no: lead.lead_no }

  if (!alreadyRegistered) {
    rows.push({
      customer_id: customerId,
      event_type: 'lead_registered',
      // **리드가 처음 들어온 날**을 적는다(배정한 날이 아니다).
      occurred_at: lead.created_at,
      actor_engineer_id: null,
      payload: {
        ...base,
        industry: lead.industry ?? null,
        // 요약 줄(한 줄)에 쓰는 둘. 전문은 note 에 그대로 둔다 — 펼치면 보인다.
        interest_product: lead.interest_product ?? null,
        partner_company: lead.partner_company ?? null,
        note: briefNote(lead.meeting_note ?? lead.request_note),
      },
    })
  }

  const changed = assignedTo !== lead.assigned_to
  if (changed) {
    const first = lead.assigned_to == null && assignedTo != null
    rows.push({
      customer_id: customerId,
      event_type: first ? 'lead_assigned' : 'lead_reassigned',
      occurred_at: now,
      actor_engineer_id: actorId,
      payload: {
        ...base,
        to_engineer_id: assignedTo,
        to_name: assigneeName,
        ...(first ? null : { from_engineer_id: lead.assigned_to, from_name: previousName }),
      },
    })
  }

  return rows
}

/** 사건 줄을 적는다. 표가 없거나 실패해도 **부르는 쪽을 막지 않는다**. */
export async function writeCustomerEvents(
  supabaseAdmin: SupabaseClient,
  rows: CustomerEventRow[],
): Promise<{ written: number }> {
  if (rows.length === 0) return { written: 0 }
  const { error } = await supabaseAdmin.from('customer_events').insert(rows)
  if (error) {
    if (tableMissing(error)) {
      console.warn('[customerEvents] customer_events 표가 아직 없다 — 사건을 적지 않고 넘어간다 (db/customer_events_20261120.sql)')
      return { written: 0 }
    }
    // 23505 = 유니크 위반. 같은 리드의 최초 등록이 두 번 들어온 경우다(동시에 눌렀을 때).
    if (error.code === '23505') {
      console.warn('[customerEvents] 이미 적힌 사건이라 건너뛴다', { rows: rows.map(r => r.event_type) })
      return { written: 0 }
    }
    console.error('[customerEvents] 사건 기록 실패', error)
    return { written: 0 }
  }
  return { written: rows.length }
}

/** 이 리드의 최초 등록 사건이 이미 있는가. 표가 없으면 「있다」고 보지 않는다(적지 못할 뿐이다). */
export async function hasLeadRegistered(supabaseAdmin: SupabaseClient, leadId: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('customer_events')
    .select('id')
    .eq('event_type', 'lead_registered')
    .eq('payload->>lead_id', String(leadId))
    .maybeSingle()
  if (error) {
    if (!tableMissing(error)) console.error('[customerEvents] 최초 등록 확인 실패', error)
    return false
  }
  return !!data
}
