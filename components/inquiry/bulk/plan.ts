// ───────────────────────── TEMP-BULK-IMPORT ─────────────────────────
// 일괄 등록 전용. 지난 파일을 한 번에 넣고 나면 이 폴더째 지운다.
// ─────────────────────────────────────────────────────────────────────
//
// 미리보기 행을 만들고 검사하는 순수 함수들. 화면(BulkImportModal)은 이 결과를 그리기만 한다.
// 네트워크·DOM 을 쓰지 않아 스크립트로 그대로 돌려 볼 수 있다(그래서 따로 뺐다).

import { addDays, todayKST } from '@/lib/date'
import { periodKeyFor, REQ80_SERIES, type InquiryType } from '@/lib/inquiries'
import { hitToNo, type Hit } from './parseFileNames'

/** 서버가 받아 주는 미래 날짜 여유(일). /api/inquiry 의 FUTURE_DAYS 와 같은 값이어야 한다. */
export const FUTURE_DAYS = 1

/**
 * 첨부 업로드가 요청 본문 상한에 걸리기 시작하는 크기.
 *
 * 근거 — 파일은 base64 data URL 로 실려 4/3(약 1.33배)로 부푼다. 이 서비스의 호스팅은
 * 본문이 약 4MB 를 넘으면 라우트에 닿기도 전에 끊는다(lib/leadOptions.ts:115 에 실측이 적혀 있다).
 * 4MB ÷ 1.33 ≈ 3MB 라, 3MB 를 넘으면 경고한다. 막지는 않는다 — 실제 한계는 환경을 타고,
 * 걸리면 업로드가 413 으로 돌아와 그 사유가 행에 그대로 보인다.
 * 서버 자체의 상한(20MB)은 이보다 훨씬 커서, 실제로 먼저 걸리는 것은 이쪽이다.
 */
export const SOFT_BYTES = 3 * 1024 * 1024

/** 서버(/api/inquiry-attachment)와 같은 상한. */
export const HARD_BYTES = 20 * 1024 * 1024

/** 서버(/api/inquiry-attachment 의 EXT_TYPES)와 같은 허용 확장자. */
export const ALLOWED_EXT = ['pdf', 'xlsx', 'docx', 'xls', 'doc', 'zip', 'msg', 'eml'] as const

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

/** 미리보기 한 행 = 의뢰서 한 건. */
export type Row = {
  /** 번호 문자열. 묶음 키이자 화면에 보이는 값이다. */
  no: string
  type: InquiryType
  seq: number
  /** 번호에 연도가 들어가는 종류만. */
  year?: number
  series?: string
  /** 발행일 'YYYY-MM-DD'. spare80 은 번호의 날짜로 고정되어 바꿀 수 없다. */
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

/**
 * 파일의 수정일을 KST 'YYYY-MM-DD' 로. 수정일이 없으면 오늘.
 * 날짜만 쓰므로 시간대를 못 박아 읽는다(브라우저 시간대를 타면 하루가 밀린다).
 */
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
 * 서버가 BY25 번호를 만들어 저장한다. 파일명에서 읽은 번호와 다른 번호가 생긴다는 뜻이다.
 * 그래서 연도가 박힌 종류는 **발행일의 연도가 번호의 연도와 같을 때만** 보낸다.
 *
 *   spare80   — 번호에 날짜가 통째로 들어 있다. 그 날짜로 고정하고 잠근다.
 *   hq_repair — 번호에 연도가 없다(239-0001). 수정일을 기본값으로, 자유롭게 고칠 수 있다.
 *   그 밖     — 수정일이 번호의 연도에 속하면 그 날짜, 아니면 비워 두고 사람이 넣게 한다.
 */
export function defaultIssuedDate(hit: Hit, fileDate: string): { date: string; locked: boolean } {
  if (hit.type === 'spare80') return { date: hit.date ?? '', locked: true }
  if (hit.type === 'hq_repair') return { date: fileDate, locked: false }
  const year = hit.year
  if (year && fileDate.slice(0, 4) === String(year)) return { date: fileDate, locked: false }
  return { date: '', locked: false }
}

/** 행의 발행일이 규칙에 맞는가. 맞으면 null, 아니면 사유. */
export function dateError(row: Pick<Row, 'type' | 'year' | 'issuedDate'>): string | null {
  const d = row.issuedDate
  if (!d) return '발행일을 입력해주세요.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '발행일 형식이 올바르지 않습니다.'
  // 서버가 거부하는 미래 날짜를 먼저 막는다(route.ts 의 register 와 같은 기준).
  if (d > addDays(todayKST(), FUTURE_DAYS)) return '앞으로의 날짜는 넣을 수 없습니다.'
  // 번호에 연도가 박힌 종류는 연도가 어긋나면 서버가 다른 번호를 만든다.
  if (row.year && d.slice(0, 4) !== String(row.year)) {
    return `번호의 연도(${row.year})와 발행일의 연도(${d.slice(0, 4)})가 다릅니다.`
  }
  return null
}

/** 행 하나의 등록 가능 여부를 다시 계산한다(발행일·담당자·파일). */
export function rowError(row: Row): string | null {
  const de = dateError(row)
  if (de) return de
  if (row.createdBy === '') return '담당자를 골라주세요.'
  if (row.type === 'req80' && !REQ80_SERIES.includes(row.series ?? '')) {
    return '80 의뢰서는 장비 계열(81·83·84)이 필요합니다.'
  }
  if (row.existing === 'exists' && !row.attachToExisting) return null
  if (row.existing === 'exists' && row.files.length === 0) return '붙일 파일이 없습니다.'
  return null
}

/** 파일 묶음 → 행. 같은 번호는 한 행으로 합친다(정규화된 번호 문자열이 키다). */
export function buildRows(
  matched: { file: File; hit: Hit }[],
  myId: number | '',
): Row[] {
  const byNo = new Map<string, Row>()
  for (const { file, hit } of matched) {
    const no = hitToNo(hit)
    const found = byNo.get(no)
    if (found) { found.files.push(file); continue }
    const { date, locked } = defaultIssuedDate(hit, fileYmd(file))
    byNo.set(no, {
      no, type: hit.type, seq: hit.seq, year: hit.year, series: hit.series,
      issuedDate: date, dateLocked: locked,
      title: '', createdBy: myId, files: [file], include: true,
      existing: 'new', attachToExisting: false, error: null, warn: null,
    })
  }
  // 등록 순서 — (종류, 기간)별로 일련번호 오름차순이면 카운터가 단조롭게 오른다.
  return [...byNo.values()].sort((a, b) => {
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
 * 등록 전에 한 번만 묻기 위한 카운터 요약.
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
