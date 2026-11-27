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

/** 지운 대상의 한글 이름. 모르는 값은 그대로 쓴다. */
const kindLabel = (kind: string): string =>
  ({ site: '사업장', company: '회사', agency: '대리점', contact: '담당자', device: '장비' } as Record<string, string>)[kind] ?? kind

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
      // **한 줄 요약이 먼저**다 — 관심 제품 · 파트너사(2026-11-23).
      // 전문(회의록)은 줄바꿈 뒤에 둔다. 줄은 기본으로 한 줄만 보이고 누르면 펼쳐진다
      // (TimelineRow 의 clampable). 옛 줄에는 둘이 없어 업종으로 떨어진다.
      const head = [str(p.interest_product), str(p.partner_company)].filter(Boolean).join(' · ')
        || str(p.industry)
        || '리드가 등록되었습니다'
      const full = str(p.note)
      return {
        label: '리드 등록',
        title: leadNo,
        body: full ? `${head}
${full}` : head,
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
    // ── 밖에서 벌어진 일 (2026-11-27 야간3 2-2) ───────────────────────
    case 'holding_started':
      return { label: '홀딩 시작', title: str(p.device ?? p.title), body: str(p.reason) || '홀딩이 걸렸습니다', owner: str(p.owner) }
    case 'holding_resolved':
      return { label: '홀딩 해제', title: str(p.device ?? p.title), body: str(p.reason) || '홀딩이 풀렸습니다', owner: str(p.owner) }
    case 'forecast_created':
      return { label: '포캐스트 생성', title: str(p.title), body: str(p.amount_text), owner: str(p.owner) }
    // 단계가 옮겨 간 줄(2026-11-28, 야간4 4-2). 금액·제목 같은 잡 변경은 줄로 서지 않는다.
    case 'forecast_stage_changed':
      return {
        label: '포캐스트 단계',
        title: str(p.title),
        body: arrow(p.from_stage, p.to_stage),
        owner: str(p.owner),
      }
    case 'forecast_closed':
      return { label: `포캐스트 ${str(p.result) || '종료'}`, title: str(p.title), body: str(p.reason) || str(p.amount_text), owner: str(p.owner) }
    case 'repair_received':
      return { label: '수리 입고', title: str(p.item), body: str(p.symptom), owner: str(p.owner) }
    case 'repair_shipped':
      return { label: '수리 출고', title: str(p.item), body: str(p.note), owner: str(p.owner) }
    case 'inquiry_created':
      return { label: '의뢰서 작성', title: str(p.inquiry_no), body: str(p.subject), owner: str(p.owner) }

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
    case 'lead_unassignable':
      return {
        label: '배정 불가',
        title: leadNo,
        body: str(p.reason) || '배정 불가로 처리되었습니다',
        owner: '',
      }
    case 'lead_converted':
      return { label: '리드 전환', title: leadNo, body: '고객사로 전환되었습니다', owner: '' }
    case 'lead_status_changed':
      return {
        label: '리드 상태',
        title: leadNo,
        body: [arrow(p.from, p.to), str(p.reason)].filter(Boolean).join(' · '),
        owner: '',
      }
    case 'lead_recalled':
      return {
        label: '리드 회수',
        title: leadNo,
        body: `번호를 반납했습니다${str(p.reason) ? ` — ${str(p.reason)}` : ''}`,
        owner: '',
      }
    case 'lead_restored':
      return { label: '리드 복구', title: leadNo, body: '번호를 되돌렸습니다', owner: '' }
    // 견적을 포캐스트에 걸거나 풀었다 — 그 포캐스트의 금액·단계가 함께 다시 셈해진다.
    case 'quote_forecast_linked': {
      const to = str(p.forecast)
      return {
        label: to ? '포캐스트 연결' : '포캐스트 해제',
        title: str(p.quote_no),
        body: to ? `${to} 에 걸었습니다` : '연결을 풀었습니다',
        owner: '',
      }
    }
    // 지울 수 없는 사람이 지워 달라고 한 자국. **아무것도 지워지지 않았다.**
    case 'company_delete_requested':
      return {
        label: '삭제 요청',
        title: str(p.name),
        body: str(p.reason) || '까닭 없음',
        owner: '',
      }
    case 'customer_deleted': {
      const kind = str(p.kind) || '줄'
      const why = str(p.reason)
      return {
        label: '삭제',
        title: str(p.name),
        body: why ? `${kindLabel(kind)} 숨김 — ${why}` : `${kindLabel(kind)}을 숨겼습니다`,
        owner: '',
      }
    }
    case 'customer_restored':
      return { label: '복구', title: str(p.name), body: `${kindLabel(str(p.kind))}을 되돌렸습니다`, owner: '' }
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
