// 반도체 고객 접촉 보고 — **저장 모양 변환**(순수 모듈).
//
// 입력 객체(화면) ↔ DB 행. 어느 값이 어느 칸으로 가는지는 등록표의 storage 가 정한다(fields.ts).
//   'project' → semi_projects 의 칸        (customer_name · site_dept · title)
//   'column'  → semi_contact_reports 의 칸 (contact_date · contact_method · customer_contact · purpose · fact · next_contact_date)
//   'detail'  → semi_contact_reports.detail jsonb 의 키
//
// 규칙
//   · 값은 앞뒤 공백을 지워 저장한다(안쪽 줄바꿈은 그대로 — 긴 글의 문단을 지키려고).
//   · 칸(project·column)의 빈 값은 null 로 보낸다. 날짜 칸에 '' 를 넣으면 DB 가 거절한다.
//     not null 칸(고객사·Project·접촉일·접촉방법)은 validateReport 가 먼저 막는다.
//   · detail 에는 등록표에 있는 key 만, 값이 있을 때만 넣는다 — 빈 값은 키째 뺀다.
//   · 읽을 때 detail 에 등록표에 없는 키가 있으면 버린다(옛 키·손으로 넣은 키가 화면에 새지 않게).
//   · id·작성자·시각(author_id·created_at·updated_at …)은 다루지 않는다 — 라우트가 정한다.
//
// DB·화면에 의존하지 않는다 — 스크립트로 그대로 돌려 볼 수 있다.

import {
  ACTION_PRIORITY_DEFAULT, ACTION_STATUS_DEFAULT, FIELDS, emptyInput,
  type ActionInput, type FieldKey, type ReportInput,
} from './fields'
import type { PartialInput } from './prefill'

export type StorageParts = {
  /** semi_projects 에 넣을 칸. */
  project: Record<string, string | null>
  /** semi_contact_reports 에 넣을 칸(detail 제외). */
  report: Record<string, string | null>
  /** semi_contact_reports.detail. 빈 값은 키가 없다. */
  detail: Record<string, string>
}

/** 입력 객체를 저장할 세 덩어리로 나눈다. */
export function toStorage(input: PartialInput): StorageParts {
  const out: StorageParts = { project: {}, report: {}, detail: {} }
  for (const f of FIELDS) {
    const v = clean(input[f.key])
    if (f.storage === 'detail') {
      if (v !== '') out.detail[f.key] = v
    } else {
      out[f.storage === 'project' ? 'project' : 'report'][f.key] = v === '' ? null : v
    }
  }
  return out
}

/**
 * DB 행을 입력 객체로 되돌린다.
 * @param row     semi_contact_reports 행(칸들 + detail). 다른 칸(report_id 등)이 섞여 있어도 된다.
 * @param project semi_projects 행. 없으면 Project 칸은 row 에서 찾는다(조인해 펼쳐 받은 경우).
 */
export function fromStorage(
  row: Record<string, unknown> | null | undefined,
  project?: Record<string, unknown> | null,
): ReportInput {
  const out = emptyInput()
  const detail = asObject(row?.detail)
  for (const f of FIELDS) {
    let v: unknown
    if (f.storage === 'detail') v = detail[f.key]
    else if (f.storage === 'project') v = project ? project[f.key] : row?.[f.key]
    else v = row?.[f.key]
    out[f.key as FieldKey] = scalar(v)
  }
  return out
}

// ── Action 줄 ───────────────────────────────────────────────────────────────

/** semi_actions 에 넣을 칸(report_id·project_id 는 라우트가 붙인다). */
export type ActionRow = {
  action: string
  owner_name: string
  owner_id: number | null
  due_date: string
  status: string
  priority: string
  note: string | null
}

/** Action 입력 → DB 칸. 상태·우선순위가 비면 DB 기본값과 같은 값을 넣는다. */
export function actionToStorage(a: Partial<ActionInput>): ActionRow {
  const note = clean(a.note)
  return {
    action: clean(a.what),
    owner_name: clean(a.owner),
    owner_id: typeof a.owner_id === 'number' && Number.isInteger(a.owner_id) ? a.owner_id : null,
    due_date: clean(a.due_date),
    status: clean(a.status) || ACTION_STATUS_DEFAULT,
    priority: clean(a.priority) || ACTION_PRIORITY_DEFAULT,
    note: note === '' ? null : note,
  }
}

/** DB 행 → Action 입력. */
export function actionFromStorage(row: Record<string, unknown> | null | undefined): ActionInput {
  const ownerId = row?.owner_id
  return {
    what: scalar(row?.action),
    owner: scalar(row?.owner_name),
    owner_id: typeof ownerId === 'number' && Number.isInteger(ownerId) ? ownerId : null,
    due_date: scalar(row?.due_date),
    status: scalar(row?.status) || ACTION_STATUS_DEFAULT,
    priority: scalar(row?.priority) || ACTION_PRIORITY_DEFAULT,
    note: scalar(row?.note),
  }
}

// ── 내부 ────────────────────────────────────────────────────────────────────

function clean(v: unknown): string {
  if (v == null) return ''
  return (typeof v === 'string' ? v : String(v)).trim()
}

/** 문자열·숫자만 글자로, 그 밖(null·객체·배열)은 ''. */
function scalar(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

/** jsonb 는 보통 객체로 오지만, 문자열로 오는 경로(옛 데이터·수동 입력)도 받아 둔다. 깨지면 빈 객체. */
function asObject(v: unknown): Record<string, unknown> {
  let o = v
  if (typeof o === 'string') {
    try { o = JSON.parse(o) } catch { return {} }
  }
  return o != null && typeof o === 'object' && !Array.isArray(o) ? o as Record<string, unknown> : {}
}
