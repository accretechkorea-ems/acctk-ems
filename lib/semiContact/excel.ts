// 반도체 고객 접촉 보고 — 엑셀 시트 만들기(순수 모듈).
//
// 견적·리드·쇼룸 엑셀(lib/quoteExcel.ts 등)과 같은 방식이다 — 이 파일은 넘겨받은 Workbook 에 시트를 그리기만 하고,
// exceljs 런타임은 호출부(서버 라우트 /api/semi-contact/export)가 불러 Workbook 을 만든다. 그래서 타입만 가져온다.
//
// 출력 두 가지
//   A. 보고서 한 장 — buildReportSheet: Project 정보 → 접촉일·방법·작성자 → 새롭게 확인된 내용 → Action 표
//      → 다음 Contact 예정일 → 나머지 칸(섹션 순서, 「라벨 | 값」). 등록표 36칸이 값이 비어도 라벨 행으로 전부 나간다.
//   B. 전체 이력 — buildHistoryWorkbook: 「이력」(보고서 1건 = 1행, 직전 대비 바뀐 칸은 연한 색) ·
//      「Action」(미완료 + 기한 지남은 빨간 글씨) · 「요약」.
//
// 값은 가공하지 않는다 — 날짜는 'YYYY-MM-DD' 문자열 그대로, 빈 값은 빈 칸. 칸 이름·섹션·순서는 등록표(fields.ts)를 따른다.
// 접촉 차수(#n)는 화면과 같은 contactSequence(sequence.ts)로 매긴다 — A 맨 위, B 「이력」 맨 앞 열, 「Action」 접촉 열.

import type { Cell, Workbook, Worksheet } from 'exceljs'
import {
  ACTION_LABELS, AUTHOR_FIELD, FIELDS, FIELD_BY_KEY, SECTIONS,
  type FieldDef, type FieldKey, type ReportInput,
} from './fields'
import { changedFields } from './prefill'
import { actionFromStorage, fromStorage } from './storage'
import { PROJECT_KEYS } from './project'
import { contactSequence, seqLabel } from './sequence'

// ── 입력 모양 ────────────────────────────────────────────────────────
export type ExportProject = { project_no: string; customer_name: string; site_dept: string | null; title: string }
/** semi_contact_reports 행(칸들 + detail) + 작성자 이름. */
export type ExportReport = { report_id: number; row: Record<string, unknown>; authorName: string }
/** semi_actions 행. */
export type ExportAction = { action_id: number; report_id: number; row: Record<string, unknown> }

/** 완료 상태(등록표의 Action 상태 중 이것만 완료). DB 부분 인덱스와 같은 기준. */
const DONE_STATUS = 'Done'

// ── 서식 ─────────────────────────────────────────────────────────────
const HEAD_BG = 'FFF3F4F6'      // 머리글·라벨 배경(중립 회색)
const SECTION_BG = 'FFD9E1F2'   // 섹션 제목 줄(견적 엑셀의 TITLE_BG 와 같다)
const CHANGED_BG = 'FFE6ECF8'   // 직전 대비 바뀐 칸(연한 파랑)
const DANGER = 'FFDC2626'       // 기한 지남(견적 엑셀의 FF_DANGER 와 같다)
/** 엑셀 행 높이 상한(pt). */
const MAX_ROW_HEIGHT = 409
const LINE_HEIGHT = 15

const fill = (cell: Cell, argb: string) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } } }
const thin = (cell: Cell) => {
  cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }
}
const wrapTop = (cell: Cell) => { cell.alignment = { wrapText: true, vertical: 'top' } }

/** 글자 폭 — 한글 등은 두 칸으로 친다. */
function textWidth(s: string): number {
  let w = 0
  for (const ch of s) w += ch.charCodeAt(0) > 0x7f ? 2 : 1
  return w
}

/**
 * 줄바꿈된 글이 잘리지 않을 행 높이(pt). 엑셀은 라이브러리가 쓴 줄(특히 병합 칸)의 높이를 맞춰 주지 않으므로
 * 칸 폭(글자 수)으로 줄 수를 어림해 직접 넣는다.
 */
function heightFor(text: string, widthChars: number): number {
  if (!text) return LINE_HEIGHT
  const per = Math.max(8, widthChars - 2)
  const lines = text.split(/\r?\n/).reduce((n, line) => n + Math.max(1, Math.ceil(textWidth(line) / per)), 0)
  return Math.min(MAX_ROW_HEIGHT, Math.max(LINE_HEIGHT, lines * LINE_HEIGHT + 4))
}

/** 칸 폭(엑셀 글자 단위) — 긴 글은 넓게. */
function colWidthOf(def: FieldDef): number {
  if (def.kind === 'longtext') return 40
  if (def.kind === 'date') return 12
  if (def.kind === 'select') return 14
  return 18
}

/**
 * 엑셀 시트 이름 — 31자, : \ / ? * [ ] 금지, 앞뒤 작은따옴표 금지(어기면 exceljs 가 예외를 던진다).
 * Project 번호는 사람이 적는 자유 형식이라 무엇이든 올 수 있어 여기서 다듬는다. 남는 것이 없으면 '보고서'.
 */
function sheetNameOf(raw: string): string {
  const s = raw.replace(/[:\\/?*[\]]/g, '-').replace(/^'+|'+$/g, '').trim().slice(0, 31).trim()
  return s || '보고서'
}

/** 빈 값은 칸을 비워 둔다(가공 금지). */
const put = (cell: Cell, v: string) => { if (v !== '') cell.value = v }

// ── 공통 계산 ────────────────────────────────────────────────────────
function projectInput(p: ExportProject) {
  return { customer_name: p.customer_name, site_dept: p.site_dept ?? '', title: p.title }
}
const noActionOf = (row: Record<string, unknown>): boolean => {
  const d = row.detail
  return !!d && typeof d === 'object' && (d as Record<string, unknown>).no_action === true
}

// ════════════════════════════════════════════════════════════════════
// A. 보고서 한 장
// ════════════════════════════════════════════════════════════════════

/** A 의 배치. 위 블록에 놓이지 않은 칸은 전부 「나머지 칸」으로 섹션 순서대로 나간다. */
export const REPORT_SHEET_CONTACT: FieldKey[] = ['contact_date', 'contact_method']
export const REPORT_SHEET_NOTES: FieldKey[] = ['fact', 'meeting_content']
export const REPORT_SHEET_NEXT: FieldKey[] = ['next_contact_date']
const REPORT_PLACED = new Set<FieldKey>([...PROJECT_KEYS, ...REPORT_SHEET_CONTACT, ...REPORT_SHEET_NOTES, ...REPORT_SHEET_NEXT])

/** A 시트의 열: A 라벨 · B~G 값(Action 표는 B~G 여섯 칸을 하나씩 쓴다). */
const A_COLS = [22, 30, 16, 13, 12, 11, 30]
const A_VALUE_WIDTH = A_COLS.slice(1).reduce((a, b) => a + b, 0)

export function buildReportSheet(
  wb: Workbook,
  data: { project: ExportProject; report: ExportReport; actions: ExportAction[]; /** 접촉 차수(#n). 모르면 비워 둔다. */ seq?: number },
): Worksheet {
  const { project, report } = data
  const input = fromStorage(report.row, projectInput(project))
  const ws = wb.addWorksheet(sheetNameOf(`${project.project_no} ${input.contact_date}`))
  ws.columns = A_COLS.map(width => ({ width }))

  /** 섹션 제목 줄(A~G 병합). */
  const section = (title: string) => {
    const r = ws.addRow([title])
    ws.mergeCells(r.number, 1, r.number, 7)
    const c = r.getCell(1)
    c.font = { bold: true }
    fill(c, SECTION_BG)
  }
  /** 「라벨 | 값」 한 줄. 값은 B~G 병합, 줄바꿈 켜고 높이를 맞춘다. */
  const pair = (label: string, value: string) => {
    const r = ws.addRow([label])
    ws.mergeCells(r.number, 2, r.number, 7)
    const l = r.getCell(1)
    l.font = { bold: true }
    fill(l, HEAD_BG)
    thin(l); wrapTop(l)
    const v = r.getCell(2)
    put(v, value)
    thin(v); wrapTop(v)
    r.height = heightFor(value, A_VALUE_WIDTH)
  }
  const field = (k: FieldKey) => pair(FIELD_BY_KEY[k].label, input[k])

  // 제목
  const t = ws.addRow([[seqLabel(data.seq), project.project_no, project.title].filter(Boolean).join('  ')])
  ws.mergeCells(t.number, 1, t.number, 7)
  t.getCell(1).font = { bold: true, size: 14 }
  ws.addRow([])

  section('Project')
  pair('Project 번호', project.project_no)
  for (const k of PROJECT_KEYS) field(k)

  section('이번 접촉')
  for (const k of REPORT_SHEET_CONTACT) field(k)
  pair(AUTHOR_FIELD.label, report.authorName)

  section(SECTIONS.find(s => s.no === 2)?.label ?? '')
  for (const k of REPORT_SHEET_NOTES) field(k)

  // Action 표 — B~G 에 여섯 칸
  section('Action Items')
  if (noActionOf(report.row)) {
    pair('Action', 'Action 없음')
  } else {
    const head = ws.addRow(['', ACTION_LABELS.what, ACTION_LABELS.owner, ACTION_LABELS.due_date, ACTION_LABELS.status, ACTION_LABELS.priority, ACTION_LABELS.note])
    for (let c = 2; c <= 7; c++) { const cell = head.getCell(c); cell.font = { bold: true }; fill(cell, HEAD_BG); thin(cell) }
    const mine = data.actions.filter(a => a.report_id === report.report_id).sort((a, b) => a.action_id - b.action_id)
    if (mine.length === 0) ws.addRow(['', ''])
    for (const a of mine) {
      const x = actionFromStorage(a.row)
      const r = ws.addRow([''])
      const vals = [x.what, x.owner, x.due_date, x.status, x.priority, x.note]
      vals.forEach((v, i) => { const cell = r.getCell(i + 2); put(cell, v); thin(cell); wrapTop(cell) })
      r.height = Math.max(heightFor(x.what, A_COLS[1]), heightFor(x.note, A_COLS[6]))
    }
  }

  // 다음 Contact 예정일 — 제목 줄을 따로 두지 않는다(라벨이 곧 제목이라 같은 글자가 두 번 나온다). 한 줄 띄우고 바로 쓴다.
  ws.addRow([])
  for (const k of REPORT_SHEET_NEXT) field(k)

  // 나머지 칸 — 섹션 순서대로, 라벨은 값이 비어도 나간다.
  for (const s of SECTIONS) {
    const rest = (FIELDS as readonly FieldDef[]).filter(f => f.section === s.no && !REPORT_PLACED.has(f.key as FieldKey))
    if (rest.length === 0) continue
    section(s.label)
    for (const f of rest) field(f.key as FieldKey)
  }

  ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  return ws
}

// ════════════════════════════════════════════════════════════════════
// B. 전체 이력
// ════════════════════════════════════════════════════════════════════

/** 「이력」 시트의 칸 순서 — 접촉일·접촉방법을 맨 앞에(그 뒤 작성자), 나머지 34칸은 등록표(섹션) 순서. */
export const HISTORY_FIELD_ORDER: FieldKey[] = [
  'contact_date', 'contact_method',
  ...(FIELDS as readonly FieldDef[]).map(f => f.key as FieldKey).filter(k => k !== 'contact_date' && k !== 'contact_method'),
]

export function buildHistoryWorkbook(
  wb: Workbook,
  data: { project: ExportProject; reports: ExportReport[]; actions: ExportAction[]; today: string },
): void {
  const { project, today } = data
  const proj = projectInput(project)
  // 접촉일 오름차순(같은 날은 먼저 쓴 보고서가 앞).
  const asc = [...data.reports]
    .map(r => ({ r, input: fromStorage(r.row, proj) }))
    .sort((a, b) => a.input.contact_date.localeCompare(b.input.contact_date) || a.r.report_id - b.r.report_id)

  // ── 이력 ──
  const hs = wb.addWorksheet('이력')
  const seqOf = contactSequence(asc.map(x => ({ report_id: x.r.report_id, contact_date: x.input.contact_date })))
  const headers = [
    '차수',
    FIELD_BY_KEY.contact_date.label, FIELD_BY_KEY.contact_method.label, AUTHOR_FIELD.label,
    ...HISTORY_FIELD_ORDER.slice(2).map(k => FIELD_BY_KEY[k].label),
  ]
  const widths = [7, 12, 12, 10, ...HISTORY_FIELD_ORDER.slice(2).map(k => colWidthOf(FIELD_BY_KEY[k]))]
  hs.columns = widths.map(width => ({ width }))
  const hh = hs.addRow(headers)
  hh.eachCell(c => { c.font = { bold: true }; fill(c, HEAD_BG); thin(c); c.alignment = { wrapText: true, vertical: 'middle' } })
  hh.height = 30
  hs.views = [{ state: 'frozen', xSplit: 4, ySplit: 1 }]
  hs.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } }

  let before: ReportInput | null = null
  for (const { r, input } of asc) {
    const changed = new Set(changedFields(before, input))
    const values = [seqLabel(seqOf.get(r.report_id)), input.contact_date, input.contact_method, r.authorName, ...HISTORY_FIELD_ORDER.slice(2).map(k => input[k])]
    const row = hs.addRow([])
    let height = LINE_HEIGHT
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1)
      put(cell, v)
      thin(cell); wrapTop(cell)
      height = Math.max(height, heightFor(v, widths[i]))
      // 칸 i → 등록표 키: 0 차수 · 1 접촉일 · 2 접촉방법 · 3 작성자 · 4~ 나머지 34칸
      const key = i === 1 ? 'contact_date' : i === 2 ? 'contact_method' : i <= 3 ? null : HISTORY_FIELD_ORDER[i - 2]
      if (key && changed.has(key as FieldKey)) fill(cell, CHANGED_BG)
    })
    row.height = height
    before = input
  }

  // ── Action ──
  const as = wb.addWorksheet('Action')
  const aHead = [FIELD_BY_KEY.contact_date.label, ACTION_LABELS.what, ACTION_LABELS.owner, ACTION_LABELS.due_date, ACTION_LABELS.status, ACTION_LABELS.priority, ACTION_LABELS.note]
  const aWidths = [18, 40, 16, 12, 12, 10, 30]
  as.columns = aWidths.map(width => ({ width }))
  const ah = as.addRow(aHead)
  ah.eachCell(c => { c.font = { bold: true }; fill(c, HEAD_BG); thin(c) })
  as.views = [{ state: 'frozen', ySplit: 1 }]
  as.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: aHead.length } }

  const dateOf = new Map(asc.map(x => [x.r.report_id, x.input.contact_date]))
  /** 접촉 열 표시 「#3 (2026-10-12)」. 정렬은 날짜로 한다. */
  const contactOf = (reportId: number) => {
    const d = dateOf.get(reportId) ?? ''
    const n = seqLabel(seqOf.get(reportId))
    return n ? `${n} (${d})` : d
  }
  const actions = data.actions
    .map(a => ({ a, x: actionFromStorage(a.row), date: dateOf.get(a.report_id) ?? '', contact: contactOf(a.report_id) }))
    .sort((p, q) => p.date.localeCompare(q.date) || p.x.due_date.localeCompare(q.x.due_date) || p.a.action_id - q.a.action_id)
  let open = 0
  for (const { x, contact } of actions) {
    const isOpen = x.status !== DONE_STATUS
    if (isOpen) open++
    const overdue = isOpen && !!x.due_date && x.due_date < today
    const vals = [contact, x.what, x.owner, x.due_date, x.status, x.priority, x.note]
    const row = as.addRow([])
    vals.forEach((v, i) => {
      const cell = row.getCell(i + 1)
      put(cell, v)
      thin(cell); wrapTop(cell)
      if (overdue) cell.font = { color: { argb: DANGER } }
    })
    row.height = Math.max(heightFor(x.what, aWidths[1]), heightFor(x.note, aWidths[6]))
  }

  // ── 요약 ──
  const ss = wb.addWorksheet('요약')
  ss.columns = [{ width: 22 }, { width: 50 }]
  const latest = asc[asc.length - 1]?.input ?? null
  const summary: [string, string][] = [
    ['Project 번호', project.project_no],
    [FIELD_BY_KEY.customer_name.label, project.customer_name],
    [FIELD_BY_KEY.site_dept.label, project.site_dept ?? ''],
    [FIELD_BY_KEY.title.label, project.title],
    ['접촉 횟수', String(asc.length)],
    ['최근 접촉일', latest?.contact_date ?? ''],
    [FIELD_BY_KEY.next_contact_date.label, latest?.next_contact_date ?? ''],
    ['미완료 Action', String(open)],
  ]
  for (const [label, value] of summary) {
    const r = ss.addRow([label])
    const l = r.getCell(1)
    l.font = { bold: true }
    fill(l, HEAD_BG)
    thin(l)
    const v = r.getCell(2)
    put(v, value)
    thin(v); wrapTop(v)
  }
}
