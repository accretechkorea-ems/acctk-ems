/**
 * 고객 사건 한 줄을 **화면 글자로** 바꾼다 — 타임라인이 읽는다.
 *
 * 사건은 payload(jsonb)에 종류마다 다른 값을 담는다(lib/customerEvents.ts).
 * 그 모양을 아는 곳을 여기 하나로 둔다 — 화면 조각마다 payload 를 뜯지 않게.
 *
 * 모르는 종류가 들어와도 **줄은 보인다**(종류 이름을 그대로 쓴다). 새 사건을 더하는
 * 쪽이 화면을 고치는 것을 잊어도 기록이 사라지지는 않는다.
 */

export type CustomerEvent = {
  id: number
  customer_id: number
  event_type: string
  occurred_at: string
  actor_engineer_id: number | null
  payload: Record<string, unknown> | null
}

export type EventLine = {
  /** 종류 칸(왼쪽) — 「리드 등록」·「담당 배정」. */
  label: string
  /** 제목 칸 — 리드 번호처럼 그 사건을 가리키는 값. */
  title: string
  /** 내용 칸. */
  body: string
  /** 오른쪽 둘째 줄 — 누가. */
  owner: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export function eventLine(e: CustomerEvent): EventLine {
  const p = e.payload ?? {}
  const leadNo = str(p.lead_no) || (p.lead_id != null ? `#${str(p.lead_id)}` : '')
  const to = str(p.to_name)
  const from = str(p.from_name)

  switch (e.event_type) {
    case 'lead_registered': {
      const bits = [str(p.industry), str(p.note)].filter(Boolean)
      return {
        label: '리드 등록',
        title: leadNo,
        body: bits.join(' · ') || '리드가 등록되었습니다',
        owner: '',
      }
    }
    case 'lead_assigned':
      return {
        label: '담당 배정',
        title: leadNo,
        body: to ? `${to} 담당으로 배정` : '담당이 배정되었습니다',
        owner: to,
      }
    case 'lead_reassigned':
      return {
        label: '담당 변경',
        title: leadNo,
        body: to
          ? `${from || '없음'} → ${to}`
          : `${from || '담당'} → 없음 (회수)`,
        owner: to,
      }
    default:
      // 모르는 종류 — 줄은 남기고 payload 를 그대로 보여 준다.
      return {
        label: e.event_type,
        title: leadNo,
        body: Object.keys(p).length > 0 ? JSON.stringify(p) : '',
        owner: '',
      }
  }
}
