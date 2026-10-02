// ───────────────────────── TEMP-BULK-IMPORT ─────────────────────────
// 일괄 등록 전용. 지난 파일을 한 번에 넣고 나면 이 폴더째 지운다.
// ─────────────────────────────────────────────────────────────────────
//
// 미리보기 행을 만들고·고치고·검사하는 순수 함수들. 화면(BulkImportModal)은 이 결과를 그리고
// 서버에 보내기만 한다. 네트워크·DOM 을 쓰지 않아 스크립트로 그대로 돌려 볼 수 있다.
//
// 행의 번호는 **파생값**이다. 사람이 종류·계열·일련번호·연도를 고치면 buildInquiryNo 로 다시
// 만든다 — 문자열을 직접 잇지 않는다(자릿수·접두는 그 함수 하나가 정한다).

import { addDays, todayKST } from '@/lib/date'
import {
  buildInquiryNo, periodKeyFor, REQ80_SERIES, REQ20_SERIES, type InquiryType,
} from '@/lib/inquiries'
import type { Hit } from './parseFileNames'

/** 서버가 받아 주는 미래 날짜 여유(일). /api/inquiry 의 FUTURE_DAYS 와 같은 값이어야 한다. */
export const FUTURE_DAYS = 1

/**
 * 첨부 업로드가 요청 본문 상한에 걸리기 시작하는 크기.
 *
 * 근거 — 파일은 base64 data URL 로 실려 4/3(약 1.33배)로 부푼다. 이 서비스의 호스팅은
 * 본문이 약 4MB 를 넘으면 라우트에 닿기도 전에 끊는다(lib/leadOptions.ts:115 에 실측이 적혀 있다).
 * 4MB ÷ 1.33 ≈ 3MB 라, 3MB 를 넘으면 경고한다. 막지는 않는다 — 걸리면 413 사유가 행에 보인다.
 */
export const SOFT_BYTES = 3 * 1024 * 1024

/** 서버(/api/inquiry-attachment)와 같은 상한. */
export const HARD_BYTES = 20 * 1024 * 1024

/** 서버(/api/inquiry-attachment 의 EXT_TYPES)와 같은 허용 확장자. */
export const ALLOWED_EXT = ['pdf', 'xlsx', 'docx', 'xls', 'doc', 'zip', 'msg', 'eml'] as const

/**
 * in() 조회 한 번에 넣을 번호 개수.
 *
 * PostgREST 의 in 은 쿼리 문자열로 나간다 — 200개를 한 번에 보내면 URL 이 수천 자가 되어
 * 프록시·브라우저의 길이 한계에 걸릴 수 있고, 돌아오는 행도 기본 상한(1000)에 가까워진다.
 * 100개씩 끊어 보내면 URL 은 2KB 안쪽, 응답도 100행 안쪽이라 둘 다 걸리지 않는다.
 */
export const QUERY_CHUNK = 100

/** 배열을 n 개씩 끊는다. */
export function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

export const extOf = (name: string): string => {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** 파일 하나가 올라갈 수 있는지. 못 올리면 사유를, 올릴 수 있으면 null(경고는 warn 에). */
export function checkFile(f: { name: string; size: number }): { error: string | null; warn: string | null } {
  const ext = extOf(f.name)
  if (!(ALLOWED_EXT as readonly string[]).includes(ext)) {
    return { error: `지원하지 않는 형식입니다 (.${ext || '확장자 없음'})`, warn: null }
  }
  if (f.size > HARD_BYTES) return { error: `20MB 를 넘습니다 (${Math.round(f.size / 1024 / 1024)}MB)`, warn: null }
  if (f.size > SOFT_BYTES) return { error: null, warn: '서버 상한에 걸릴 수 있음' }
  return { error: null, warn: null }
}

/** 번호에 연도가 들어가는 종류인가. 들어가면 연도 칸을 보여 주고 발행일 연도와 맞춘다. */
export const needsYear = (t: InquiryType): boolean =>
  t === 'req80' || t === 'req20' || t === 'claim' || t === 'domestic_po'

/** 종류별로 기억해 두는 입력값 — 종류를 바꿨다 되돌려도 복원한다. */
export type TypeMemo = { series?: string; year?: number; numDate?: string }

/** 미리보기 한 행 = 의뢰서 한 건. */
export type Row = {
  /** 안정적인 식별자. 번호는 사람이 고치면 바뀌므로 키로 쓸 수 없다. */
  id: string
  /** 파서가 처음 잡은 값. 「수정함」 판단과 「되돌리기」의 기준이다. */
  auto: { type: InquiryType; seq: number; year?: number; series?: string; numDate?: string; no: string }

  type: InquiryType
  seq: number
  /** 번호에 연도가 들어가는 종류만. */
  year?: number
  /** req80 만(81·83·84). req20 은 '20' 고정이라 사람이 고르지 않는다. */
  series?: string
  /** spare80 의 번호용 날짜. 이 값이 곧 발행일이다. */
  numDate?: string
  /** 종류를 바꿨다 되돌릴 때 쓸 기억. */
  memo: Partial<Record<InquiryType, TypeMemo>>

  /** 파생 — buildInquiryNo 의 결과. 못 만들면 빈 문자열(그때는 error 가 찬다). */
  no: string
  /** 발행일 'YYYY-MM-DD'. spare80 은 numDate 로 고정된다. */
  issuedDate: string
  /** 발행일을 사람이 고칠 수 있는가. spare80 만 false. */
  dateLocked: boolean

  title: string
  createdBy: number | ''
  files: File[]
  include: boolean
  /** 사전 검사로 채운다. 'new' = 신규 등록, 'exists' = 이미 등록된 번호. */
  existing: 'new' | 'exists'
  /** 이미 있는 건의 id — 파일만 붙일 때 쓴다. */
  existingId?: string
  /** 이미 있는 건에 파일을 붙일지(기본 false = 건너뜀). */
  attachToExisting: boolean
  /** 등록을 막는 사유. 있으면 이 행은 보내지 않는다. */
  error: string | null
  /** 막지는 않는 주의. */
  warn: string | null
}

/** 파일의 수정일을 KST 'YYYY-MM-DD' 로. 수정일이 없으면 오늘. */
export const fileYmd = (f: { lastModified?: number }): string => {
  const t = f.lastModified
  if (!t) return todayKST()
  return new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

/**
 * 번호의 연도와 발행일을 맞춘다.
 *
 * **중요** — register 는 번호를 「발행일의 연도」로 다시 만든다(route.ts 의 register:
 * `const year = issuedDate.slice(0, 4)`). 그래서 BY26 번호를 2025년 발행일로 보내면
 * 서버가 BY25 번호를 만들어 저장한다. 연도가 박힌 종류는 둘이 같을 때만 보낸다.
 */
export function defaultIssuedDate(
  v: { type: InquiryType; year?: number; numDate?: string },
  fileDate: string,
): { date: string; locked: boolean } {
  if (v.type === 'spare80') return { date: v.numDate ?? '', locked: true }
  if (v.type === 'hq_repair') return { date: fileDate, locked: false }
  if (v.year && fileDate.slice(0, 4) === String(v.year)) return { date: fileDate, locked: false }
  return { date: '', locked: false }
}

/** 지금 입력값으로 번호를 만든다. 못 만들면 빈 문자열(계열 미선택 등). */
export function rowNo(r: Pick<Row, 'type' | 'seq' | 'year' | 'series' | 'numDate'>): string {
  if (!Number.isInteger(r.seq) || r.seq < 1) return ''
  try {
    return buildInquiryNo(r.type, {
      seq: r.seq,
      year: r.year ?? (r.numDate ? Number(r.numDate.slice(0, 4)) : 0),
      series: r.type === 'req80' ? (r.series ?? null) : null,
      issuedDate: r.numDate,
    })
  } catch {
    return ''
  }
}

/** 행의 발행일이 규칙에 맞는가. 맞으면 null, 아니면 사유. */
export function dateError(row: Pick<Row, 'type' | 'year' | 'issuedDate'>): string | null {
  const d = row.issuedDate
  if (!d) return '발행일을 입력해주세요.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '발행일 형식이 올바르지 않습니다.'
  if (d > addDays(todayKST(), FUTURE_DAYS)) return '앞으로의 날짜는 넣을 수 없습니다.'
  if (row.year && d.slice(0, 4) !== String(row.year)) {
    return `번호의 연도(${row.year})와 발행일의 연도(${d.slice(0, 4)})가 다릅니다.`
  }
  return null
}

/** 행 하나의 등록 가능 여부(번호 중복은 markDuplicates 가 따로 본다). */
export function rowError(row: Row): string | null {
  if (!Number.isInteger(row.seq) || row.seq < 1 || row.seq > 99999) {
    return '일련번호는 1~99999 사이의 정수여야 합니다.'
  }
  if (needsYear(row.type) && !(row.year && row.year >= 1000 && row.year <= 9999)) {
    return '연도를 네 자리로 입력해주세요.'
  }
  if (row.type === 'req80' && !REQ80_SERIES.includes(row.series ?? '')) {
    return '80 의뢰서는 장비 계열(81·83·84)이 필요합니다.'
  }
  if (row.type === 'spare80' && !row.numDate) return '번호에 들어갈 날짜를 입력해주세요.'
  if (!row.no) return '번호를 만들지 못했습니다. 값을 확인해주세요.'
  const de = dateError(row)
  if (de) return de
  if (row.createdBy === '') return '담당자를 골라주세요.'
  if (row.existing === 'exists' && !row.attachToExisting) return null
  if (row.existing === 'exists' && row.files.length === 0) return '붙일 파일이 없습니다.'
  return null
}

/**
 * 입력값이 바뀐 뒤 파생값을 다시 만든다 — 번호 · 발행일 잠금 · 오류.
 * 모든 편집은 이 함수를 지나간다(한 길로만 모아 두면 빠뜨릴 자리가 없다).
 */
export function recalc(row: Row): Row {
  const no = rowNo(row)
  const locked = row.type === 'spare80'
  const issuedDate = locked ? (row.numDate ?? '') : row.issuedDate
  const next: Row = { ...row, no, dateLocked: locked, issuedDate }
  return { ...next, error: rowError(next) }
}

/** 파서가 정한 값과 달라졌는가(종류·일련번호·연도·계열·번호용 날짜). */
export const touched = (r: Row): boolean =>
  r.type !== r.auto.type || r.seq !== r.auto.seq || r.year !== r.auto.year
  || (r.series ?? '') !== (r.auto.series ?? '') || (r.numDate ?? '') !== (r.auto.numDate ?? '')

/**
 * 종류를 바꾼다.
 *
 * 바꾸기 전 값은 그 종류의 기억(memo)에 넣어 두고, 새 종류의 기억이 있으면 꺼내 쓴다 —
 * 잘못 골랐다가 되돌렸을 때 입력을 다시 치게 하지 않으려는 것이다.
 * 기억이 없으면 파서가 읽은 값(auto), 그것도 없으면 파일 수정일에서 만든다.
 */
export function applyTypeChange(row: Row, next: InquiryType): Row {
  const fileDate = row.files[0] ? fileYmd(row.files[0]) : todayKST()
  const memo: Row['memo'] = {
    ...row.memo,
    [row.type]: { series: row.series, year: row.year, numDate: row.numDate },
  }
  const saved = memo[next] ?? {}
  const sameAsAuto = next === row.auto.type

  const year = needsYear(next)
    ? (saved.year ?? (sameAsAuto ? row.auto.year : undefined) ?? Number(fileDate.slice(0, 4)))
    : undefined
  const series = next === 'req80'
    ? (saved.series ?? (sameAsAuto ? row.auto.series : undefined) ?? '')
    : next === 'req20' ? REQ20_SERIES : undefined
  const numDate = next === 'spare80'
    ? (saved.numDate ?? (sameAsAuto ? row.auto.numDate : undefined) ?? fileDate)
    : undefined

  const base: Row = { ...row, type: next, memo, year, series, numDate }
  const { date, locked } = defaultIssuedDate(base, fileDate)
  // 연도가 맞는 발행일을 이미 들고 있으면 그대로 둔다 — 사람이 넣은 값을 지우지 않는다.
  const keep = !locked && base.issuedDate && (!year || base.issuedDate.slice(0, 4) === String(year))
  return recalc({ ...base, issuedDate: keep ? base.issuedDate : date, dateLocked: locked })
}

/** 자동 인식 값으로 되돌린다(업체명·담당자·파일·포함 여부는 그대로). */
export function revertRow(row: Row): Row {
  const a = row.auto
  const fileDate = row.files[0] ? fileYmd(row.files[0]) : todayKST()
  const base: Row = {
    ...row, type: a.type, seq: a.seq, year: a.year, series: a.series, numDate: a.numDate,
  }
  const { date, locked } = defaultIssuedDate(base, fileDate)
  return recalc({ ...base, issuedDate: locked ? (a.numDate ?? '') : date, dateLocked: locked })
}

/**
 * 번호가 겹치는 행에 오류를 붙인다.
 *
 * 자동으로 합치지 않는다 — 어느 쪽 번호가 맞는지는 사람만 안다. 둘 다 막아 두고
 * 번호를 고치거나 파일을 옮겨 한 행을 비우게 한다(moveFile).
 */
export function markDuplicates(rows: Row[]): Row[] {
  const count = new Map<string, number>()
  for (const r of rows) if (r.no) count.set(r.no, (count.get(r.no) ?? 0) + 1)
  return rows.map(r => {
    const dup = r.no && (count.get(r.no) ?? 0) > 1
    if (dup) return { ...r, error: `번호 중복 — 같은 번호의 행이 ${count.get(r.no)}개입니다.` }
    // 중복이 풀렸으면 일반 검사 결과로 되돌린다.
    return r.error?.startsWith('번호 중복') ? { ...r, error: rowError(r) } : r
  })
}

/** 파일을 다른 행으로 옮긴다. 파일이 0개가 된 행은 사라진다. */
export function moveFile(rows: Row[], fromId: string, fileIndex: number, toId: string): Row[] {
  const from = rows.find(r => r.id === fromId)
  if (!from || !from.files[fileIndex] || fromId === toId) return rows
  const moving = from.files[fileIndex]
  const next = rows.map(r => {
    if (r.id === fromId) return { ...r, files: r.files.filter((_, i) => i !== fileIndex) }
    if (r.id === toId) return { ...r, files: [...r.files, moving] }
    return r
  }).filter(r => r.files.length > 0)
  return markDuplicates(next.map(recalc))
}

let seqId = 0
/** 행 식별자 — 한 모달 안에서만 유일하면 된다. */
const nextId = (): string => `r${++seqId}`

/** 파일 묶음 → 행. 같은 번호는 한 행으로 합친다(정규화된 번호 문자열이 키다). */
export function buildRows(matched: { file: File; hit: Hit }[], myId: number | ''): Row[] {
  const byNo = new Map<string, Row>()
  for (const { file, hit } of matched) {
    const seed = {
      type: hit.type, seq: hit.seq, year: hit.year,
      series: hit.type === 'req80' ? hit.series : hit.type === 'req20' ? REQ20_SERIES : undefined,
      numDate: hit.date,
    }
    const no = rowNo(seed)
    const found = byNo.get(no)
    if (found) { found.files.push(file); continue }
    const { date, locked } = defaultIssuedDate(seed, fileYmd(file))
    byNo.set(no, recalc({
      id: nextId(),
      auto: { ...seed, no },
      ...seed,
      memo: {},
      no,
      issuedDate: locked ? (seed.numDate ?? '') : date,
      dateLocked: locked,
      title: '', createdBy: myId, files: [file], include: true,
      existing: 'new', attachToExisting: false, error: null, warn: null,
    }))
  }
  return sortRows([...byNo.values()])
}

/** (종류, 기간)별 일련번호 오름차순 — 카운터가 단조롭게 오른다. 편집 뒤에도 같은 규칙. */
export function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const ka = `${a.type}|${periodKeyFor(a.type, a.year ?? 0)}`
    const kb = `${b.type}|${periodKeyFor(b.type, b.year ?? 0)}`
    return ka === kb ? a.seq - b.seq : ka.localeCompare(kb)
  })
}

/** (종류, 기간) 하나의 카운터 요약. */
export type BumpSummary = {
  type: InquiryType
  periodKey: string
  /** 지금 카운터. peek 가 주지 않는 과거 연도는 null. */
  current: number | null
  /** 이번에 등록할 가장 큰 일련번호. */
  max: number
  /** 사이에 비어 「사용된 번호」가 되는 개수. */
  skipped: number
}

/**
 * 등록 전에 한 번만 묻기 위한 카운터 요약. **등록 직전의 현재 행 상태**로 계산한다
 * (사람이 번호를 고쳤으면 고친 값 기준이다).
 *
 * peek 는 **올해**(와 hq_repair 의 'ALL')만 돌려준다. 과거 연도 번호는 카운터를 읽을 길이
 * 없는데, 과거 연도 카운터는 자동 발급에 쓰이지 않으므로(발급은 늘 올해 기간키로 간다)
 * 건너뛰는 번호가 생겨도 손해가 없다. 그래서 과거 연도는 묻지 않고 confirm_bump 로 보낸다.
 */
export function bumpSummary(
  rows: Row[],
  counters: { type: string; period_key: string; last_seq: number }[],
): BumpSummary[] {
  const groups = new Map<string, { type: InquiryType; periodKey: string; seqs: number[] }>()
  for (const r of rows) {
    // 이미 있는 번호는 register 를 부르지 않으므로 카운터와 무관하다.
    if (r.existing === 'exists') continue
    const periodKey = periodKeyFor(r.type, r.issuedDate.slice(0, 4))
    const key = `${r.type}|${periodKey}`
    const g = groups.get(key) ?? { type: r.type, periodKey, seqs: [] }
    g.seqs.push(r.seq)
    groups.set(key, g)
  }
  const out: BumpSummary[] = []
  for (const g of groups.values()) {
    const found = counters.find(c => c.type === g.type && c.period_key === g.periodKey)
    const current = found ? Number(found.last_seq) : null
    const max = Math.max(...g.seqs)
    if (current === null) continue            // 과거 연도 — 묻지 않는다(위 머리말)
    const have = new Set(g.seqs)
    let skipped = 0
    for (let n = current + 1; n < max; n++) if (!have.has(n)) skipped++
    if (max > current && skipped > 0) out.push({ type: g.type, periodKey: g.periodKey, current, max, skipped })
  }
  return out
}
