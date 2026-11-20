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

/** 사건 종류 — 늘어나면 여기 한 줄만 더한다(스키마는 그대로다). */
export type CustomerEventType = 'lead_registered' | 'lead_assigned' | 'lead_reassigned'

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
