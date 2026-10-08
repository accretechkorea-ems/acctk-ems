// 반도체 고객 접촉 보고 — **필드 등록표**(순수 모듈).
//
// 양식(「반도체 접촉 보고 01」 시트)의 칸을 이 표 한 곳에 적는다. 화면·엑셀·검증·저장이 모두 이 표를 읽는다.
//   · 선택지(options)도 여기에만 둔다. DB 에는 CHECK 를 걸지 않았으므로(semi_contact_schema.sql)
//     선택지를 고칠 때 이 표만 고치면 된다. 단 Action 상태의 'Done' 은 DB 부분 인덱스가 쓰는 값이다.
//   · storage 는 값이 어디에 저장되는지다.
//       'column'  semi_contact_reports 의 칸(이름 = key)
//       'project' semi_projects 의 칸(이름 = key)
//       'detail'  semi_contact_reports.detail jsonb 의 키(이름 = key)
//   · carry 는 이어쓰기 규칙이다. true = 같은 Project 의 직전 보고(또는 Project 정보)에서 값을 가져온다,
//     false = 매번 새로 쓴다(prefill.ts).
//
// 작성자는 이 표에 없다 — 화면 입력 칸이 없고 라우트가 세션의 호출자로 author_id 를 채운다.
// 화면·엑셀에서 자리만 필요하므로 AUTHOR_FIELD 로 이름표만 따로 둔다.
//
// DB·화면에 의존하지 않는다(import 가 없다) — 스크립트로 그대로 돌려 볼 수 있다.

export type SectionNo = 1 | 2 | 3 | 4 | 5 | 6

/** 양식의 섹션 순서와 제목. */
export const SECTIONS: readonly { no: SectionNo; label: string }[] = [
  { no: 1, label: '기본정보' },
  { no: 2, label: '새롭게 확인된 내용' },
  { no: 3, label: '고객 투자·요구' },
  { no: 4, label: '경쟁·의사결정' },
  { no: 5, label: '당사 판단·영업전략' },
  { no: 6, label: '미확인 사항·Next Action' },
]

export type FieldKind = 'text' | 'longtext' | 'date' | 'select'
export type FieldStorage = 'column' | 'project' | 'detail'

export type FieldDef = {
  /** 영문 snake_case. 저장 칸·detail 키 이름과 같다. */
  key: string
  /** 양식의 한글 라벨 그대로. */
  label: string
  section: SectionNo
  kind: FieldKind
  /** kind = 'select' 일 때만. 「미확인」도 유효한 값이다. */
  options?: readonly string[]
  required: boolean
  carry: boolean
  storage: FieldStorage
}

// ── 선택지 ──────────────────────────────────────────────────────────────────
export const CONTACT_METHODS = ['대면', '온라인', '전화', '이메일', '기타'] as const
export const OUR_STATUSES = ['미검토', '검토', 'Demo', '평가', 'Budget', '선정단계', '양산'] as const
export const COMPETITOR_STATUSES = ['양산', '평가', 'Demo', '검토', '미확인'] as const
export const CUSTOMER_PREFERENCES = ['당사 우위', '동등', '경쟁사 우위', '미확인'] as const

// ── 등록표 ──────────────────────────────────────────────────────────────────
// 순서가 곧 화면·엑셀의 순서다.
// Project 칸(customer_name·site_dept·title)은 carry: true — 같은 Project 의 새 보고서에서는 Project 정보를
// 그대로 보여 준다(값의 출처는 보고서가 아니라 semi_projects 다).
// Device 상세는 양식에 가져오기·새로 구분이 적혀 있지 않다. Device 와 한 묶음이라 Device 와 같이 가져온다.
export const FIELDS = [
  // 1 기본정보
  { key: 'contact_date', label: '접촉일', section: 1, kind: 'date', required: true, carry: false, storage: 'column' },
  { key: 'contact_method', label: '접촉방법', section: 1, kind: 'select', options: CONTACT_METHODS, required: true, carry: false, storage: 'column' },
  { key: 'customer_name', label: '고객사', section: 1, kind: 'text', required: true, carry: true, storage: 'project' },
  { key: 'site_dept', label: '사업장/부서', section: 1, kind: 'text', required: false, carry: true, storage: 'project' },
  { key: 'customer_contact', label: '고객 담당자', section: 1, kind: 'text', required: false, carry: true, storage: 'column' },
  { key: 'title', label: 'Project/구매안건', section: 1, kind: 'text', required: true, carry: true, storage: 'project' },
  { key: 'equipment_model', label: 'Equipment/Model', section: 1, kind: 'text', required: false, carry: true, storage: 'detail' },
  { key: 'fab_line_process', label: 'Fab/Line/Process', section: 1, kind: 'text', required: false, carry: true, storage: 'detail' },
  { key: 'device', label: 'Device', section: 1, kind: 'text', required: false, carry: true, storage: 'detail' },
  { key: 'device_detail', label: 'Device 상세', section: 1, kind: 'text', required: false, carry: true, storage: 'detail' },
  { key: 'end_user', label: 'End User', section: 1, kind: 'text', required: false, carry: true, storage: 'detail' },
  { key: 'purpose', label: '미팅/접촉 목적', section: 1, kind: 'text', required: true, carry: false, storage: 'column' },
  { key: 'meeting_place', label: '미팅장소', section: 1, kind: 'text', required: false, carry: false, storage: 'detail' },

  // 2 새롭게 확인된 내용
  { key: 'meeting_content', label: '회의 내용', section: 2, kind: 'longtext', required: false, carry: false, storage: 'detail' },
  { key: 'fact', label: 'FACT', section: 2, kind: 'longtext', required: true, carry: false, storage: 'column' },

  // 3 고객 투자·요구
  { key: 'invest_timing', label: '투자시기', section: 3, kind: 'text', required: false, carry: true, storage: 'detail' },
  { key: 'expected_units', label: '예상대수', section: 3, kind: 'text', required: false, carry: true, storage: 'detail' },
  { key: 'our_status', label: '당사 장비 Status', section: 3, kind: 'select', options: OUR_STATUSES, required: false, carry: true, storage: 'detail' },
  { key: 'customer_requirements', label: '고객 요구/선정기준', section: 3, kind: 'longtext', required: false, carry: true, storage: 'detail' },
  { key: 'our_strength_weakness', label: '당사 장비 강점/약점', section: 3, kind: 'text', required: false, carry: true, storage: 'detail' },

  // 4 경쟁·의사결정
  { key: 'competitor_model', label: '경쟁사/Model', section: 4, kind: 'text', required: false, carry: true, storage: 'detail' },
  { key: 'competitor_status', label: '경쟁 Status', section: 4, kind: 'select', options: COMPETITOR_STATUSES, required: false, carry: true, storage: 'detail' },
  { key: 'competitor_view', label: '경쟁사 고객평가', section: 4, kind: 'text', required: false, carry: true, storage: 'detail' },
  { key: 'customer_preference', label: '고객 선호', section: 4, kind: 'select', options: CUSTOMER_PREFERENCES, required: false, carry: true, storage: 'detail' },
  { key: 'decision_maker', label: 'Decision Maker', section: 4, kind: 'text', required: false, carry: true, storage: 'detail' },
  { key: 'budget_owner', label: 'Budget Owner', section: 4, kind: 'text', required: false, carry: true, storage: 'detail' },
  { key: 'key_influencer', label: 'Key Influencer', section: 4, kind: 'text', required: false, carry: true, storage: 'detail' },

  // 5 당사 판단·영업전략
  { key: 'assessment', label: 'Assessment', section: 5, kind: 'longtext', required: false, carry: true, storage: 'detail' },
  { key: 'why_win', label: 'Why Win', section: 5, kind: 'text', required: false, carry: true, storage: 'detail' },
  { key: 'why_lose', label: 'Why Lose', section: 5, kind: 'text', required: false, carry: true, storage: 'detail' },
  { key: 'strategy', label: '영업전략', section: 5, kind: 'longtext', required: false, carry: true, storage: 'detail' },
  { key: 'hq_support', label: '회사/HQ 지원 필요', section: 5, kind: 'longtext', required: false, carry: true, storage: 'detail' },

  // 6 미확인 사항·Next Action (Action 줄은 아래 ACTION_* 로 따로)
  { key: 'next_check', label: '다음에 확인할 것', section: 6, kind: 'longtext', required: false, carry: false, storage: 'detail' },
  { key: 'next_contact_date', label: '다음 Contact 예정일', section: 6, kind: 'date', required: false, carry: false, storage: 'column' },
  { key: 'attachment_note', label: '첨부자료/저장위치', section: 6, kind: 'text', required: false, carry: false, storage: 'detail' },
  { key: 'memo', label: '메모', section: 6, kind: 'longtext', required: false, carry: false, storage: 'detail' },
] as const satisfies readonly FieldDef[]

export type FieldKey = (typeof FIELDS)[number]['key']

/** 입력 객체 — 모든 필드가 문자열이다(빈 값 = ''). 날짜는 'YYYY-MM-DD'. */
export type ReportInput = Record<FieldKey, string>

/** 작성자 이름표. 입력 칸이 아니다(라우트가 author_id 를 채운다). 화면·엑셀의 자리 표시용. */
export const AUTHOR_FIELD = { key: 'author', label: '작성자', section: 1 as SectionNo } as const

/** key → 정의. */
export const FIELD_BY_KEY: Readonly<Record<FieldKey, FieldDef>> = Object.fromEntries(
  FIELDS.map(f => [f.key, f]),
) as Record<FieldKey, FieldDef>

/** 등록표 순서대로의 key 목록. */
export const FIELD_KEYS: readonly FieldKey[] = FIELDS.map(f => f.key)

/** 섹션별 필드 — 화면·엑셀이 같은 순서로 그리도록. 필드가 없는 섹션도 빈 배열로 넣는다. */
export function fieldsBySection(): { section: { no: SectionNo; label: string }; fields: FieldDef[] }[] {
  return SECTIONS.map(section => ({
    section,
    fields: (FIELDS as readonly FieldDef[]).filter(f => f.section === section.no),
  }))
}

/** 모든 필드가 빈 값인 입력 객체. */
export function emptyInput(): ReportInput {
  const out = {} as ReportInput
  for (const k of FIELD_KEYS) out[k] = ''
  return out
}

// ── Action 줄 ───────────────────────────────────────────────────────────────
// DB 칸과 이름이 다른 둘: what ↔ action, owner ↔ owner_name (storage.ts 의 actionToStorage).
export const ACTION_STATUSES = ['Open', 'In Progress', 'Done'] as const
export const ACTION_PRIORITIES = ['High', 'Medium', 'Low'] as const
/** DB 기본값과 같다(semi_actions.status / priority). */
export const ACTION_STATUS_DEFAULT = 'Open'
export const ACTION_PRIORITY_DEFAULT = 'Medium'

export type ActionInput = {
  what: string
  owner: string
  /** 담당이 우리 직원이면 engineer_id. 고객 측 담당이면 null. */
  owner_id: number | null
  due_date: string
  status: string
  priority: string
  note: string
}

export type ActionField = Exclude<keyof ActionInput, 'owner_id'>

export const ACTION_LABELS: Readonly<Record<ActionField, string>> = {
  what: '할 일',
  owner: '담당',
  due_date: '기한',
  status: '상태',
  priority: '우선순위',
  note: '비고',
}

/** 빈 Action 줄(상태·우선순위는 기본값). */
export function emptyAction(): ActionInput {
  return {
    what: '', owner: '', owner_id: null, due_date: '',
    status: ACTION_STATUS_DEFAULT, priority: ACTION_PRIORITY_DEFAULT, note: '',
  }
}
