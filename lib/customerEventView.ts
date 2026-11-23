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

/** 「전 → 후」 한 줄. 빈 값은 「없음」으로 적는다(빈칸이면 무엇이 바뀌었는지 모른다). */
const arrow = (before: unknown, after: unknown): string =>
  `${str(before) || '없음'} → ${str(after) || '없음'}`

/** 바뀐 칸 여럿을 한 줄로 — 「상태 활성 → 이탈 · 메모 없음 → …」. */
function changeText(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return '수정했습니다'
  return raw
    .map(c => {
      const one = c as { label?: unknown; before?: unknown; after?: unknown }
      return `${str(one.label)} ${arrow(one.before, one.after)}`
    })
    .join(' · ')
}

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
    // ── 고친 자국(2026-11-23) ──────────────────────────────────────────
    // 「무엇을 무엇으로」가 한 줄에 다 보여야 한다 — 열어 보지 않고도 읽히게.
    case 'site_status_changed':
      return { label: '상태 변경', title: str(p.site_name), body: arrow(p.before, p.after), owner: '' }
    case 'site_agency_changed':
      return { label: '대리점 변경', title: str(p.site_name), body: arrow(p.before, p.after), owner: '' }
    case 'company_industry_changed':
      return { label: '분류 지정', title: str(p.company_name), body: arrow(p.before, p.after), owner: '' }
    case 'site_moved':
      return { label: '회사 이동', title: str(p.site_name), body: arrow(p.before, p.after), owner: '' }
    case 'sites_merged': {
      const n = Number(p.merged_count ?? 0)
      return {
        label: '사업장 병합',
        title: str(p.kept),
        body: n > 0 ? `사업장 ${n}곳을 이 줄로 합쳤습니다` : '사업장을 합쳤습니다',
        owner: '',
      }
    }
    case 'site_edited':
      return { label: '사업장 수정', title: str(p.site_name), body: changeText(p.changes), owner: '' }
    case 'contact_edited':
      return {
        label: p.mode === 'add' ? '담당자 추가' : '담당자 수정',
        title: str(p.name),
        body: p.mode === 'add' ? '담당자를 추가했습니다' : changeText(p.changes),
        owner: '',
      }
    case 'device_edited':
      return {
        label: p.mode === 'add' ? '장비 추가' : '장비 수정',
        title: str(p.device),
        body: p.mode === 'add' ? '장비를 추가했습니다' : changeText(p.changes),
        owner: '',
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
