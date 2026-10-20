// 가격표 엑셀 한 시트 → DB 에 넣을 행 배열.
//
// ── 종류별 분기가 없다 ──────────────────────────────────────────────────────
//   예전에는 시트 이름(CMM Main body·Calibration·20 …)으로 읽는 법이 갈라졌다. 종류가
//   열넷으로 늘자 그 분기가 서로를 가렸다 — 어느 규칙이 어디에 걸리는지 알기 어렵다.
//   지금은 **모든 시트가 같은 규칙**으로 읽힌다. 다른 점은 머리글이 어디 있고 어떤 열이
//   있는지뿐이고, 그건 파일을 보고 알아낸다.
//
// ── 머리글은 한글 일곱 개로 고정한다 ───────────────────────────────────────
//   품번 · 품명 · 모델 · 정가 · 구입가 · 납기 · 비고.
//   영문 이름 후보를 두지 않는다. 본사 파일의 영문 머리글은 시트마다 다르고 해마다 바뀌어서
//   후보 목록을 따라다니는 쪽이 늘 뒤처졌다. **올리기 전에 일곱 글자로 고쳐 쓴다**는
//   한 가지 규칙이 그보다 분명하다(못 찾으면 어느 열이 없는지 한글로 알려 준다).
//
// ── 엑셀을 직접 읽지 않는다 ────────────────────────────────────────────────
//   xlsx 를 import 하지 않고 **워크시트 모양만** 받는다(`{ '!ref': …, A1: { v }, … }`).
//   그래서 브라우저·서버·시험 스크립트 어디서나 돌고, 가짜 시트로 시험할 수 있다.
//
// ── 파서는 줄을 지우거나 고르지 않는다 ─────────────────────────────────────
//   같은 품번이 여러 줄 나오면 **그대로 다 내보낸다.** 값이 같은 중복을 하나로 합치거나
//   값이 다른 중복을 막는 일은 DB 함수(apply_price_list_import)가 한다. 파서가 먼저
//   골라 버리면 사람이 올린 파일과 저장된 결과가 어긋나고, 그 차이를 아무도 못 본다.

import type { PriceLine, PriceListKind } from './priceListKinds'
import { normHeader } from './priceListKinds'

// ── 머리글 ──────────────────────────────────────────────────────────────────

/** 엑셀에서 찾는 머리글 — 이 일곱 개가 전부다. */
export const HEADER_NAMES = ['품번', '품명', '모델', '정가', '구입가', '납기', '비고'] as const
export type HeaderName = typeof HEADER_NAMES[number]

/** 없으면 등록할 수 없는 열. 품명이 비는 파일은 있어도 품번·구입가가 없으면 쓸 수 없다. */
export const REQUIRED_HEADERS: readonly HeaderName[] = ['품번', '구입가']

/** 머리글 → price_list 의 칸. 이 표가 매핑의 정본이다. */
export const HEADER_COLUMN: Record<HeaderName, string> = {
  품번: 'item_code',
  품명: 'item_name_jp',
  모델: 'model_jp',
  정가: 'price_jpy',
  구입가: 'cost_jpy',
  납기: 'delivery_time',
  비고: 'note1_jp',
}

/** 머리글을 찾는 범위(위에서 이만큼만 본다). */
export const HEADER_SCAN_ROWS = 20
/** 한 번에 받는 줄 수 상한 — 서버 라우트·DB 함수와 같은 값이다. */
export const PARSE_ROW_MAX = 20000

// ── 내보내는 모양 ───────────────────────────────────────────────────────────

/** 서버로 보내는 한 줄. 이름은 price_list 의 칸과 같다. */
export type ParsedPriceRow = {
  /** 엑셀 시트 이름 그대로. */
  sheet_name: string
  /** 어느 가격표인가 — 인자로 받은 '80' | '20'. */
  line: PriceLine
  item_code: string
  /** 같은 품번이 값이 다르게 여러 줄일 때만 채운다(= 그 줄의 묶음 제목). 아래 2-pass 참조. */
  variant: string
  /** 묶음 제목(「■…」 줄). 엑셀의 Profit Center 같은 열은 들어오지 않는다. */
  grp: string | null
  item_name_jp: string | null
  model_jp: string | null
  note1_jp: string | null
  price_jpy: number | null
  cost_jpy: number | null
  /** 주(週) 숫자 글자이거나, 개월이 아닌 표기는 적힌 그대로. 열이 없으면 null. */
  delivery_time: string | null
}

export type ParseCounts = {
  /** 품목으로 읽은 줄(품번 칸에 값이 있고 머리글 반복·묶음 제목이 아닌 줄). */
  itemRows: number
  /** 실제로 내보내는 줄(구입가가 있는 줄). */
  registered: number
  /** 구입가가 없어 뺀 줄. */
  noCost: number
  /** 품번은 있는데 품명·구입가가 둘 다 빈 줄(계열 제목 같은 것). */
  nonItem: number
  /** 묶음 제목 줄(「■…」·「[이름]」). */
  sections: number
  /** 중간에 다시 나온 머리글 줄 — **품목 아닌 줄로 세지 않는다.** */
  headerRepeats: number
  /** 개월을 주로 환산한 줄. */
  deliveryConverted: number
  /** 값이 달라 구분(variant)을 붙인 줄. */
  variantTagged: number
}

export type ParseResult = {
  sheetName: string
  line: PriceLine
  /** 사람이 읽는 엑셀 행 번호. 못 찾으면 0. */
  headerRow: number
  columns: { name: HeaderName; index: number }[]
  /** 머리글 위의 「Valid date …」 문구. */
  validText: string | null
  /** 그 문구가 없을 때 머리글 위에서 찾은 날짜(참고용. 저장하지 않는다). */
  topDate: string | null
  rows: ParsedPriceRow[]
  counts: ParseCounts
  /** 구입가가 없어 뺀 줄의 품번·품명(미리보기 목록용). */
  skippedNoCost: { item_code: string; name: string }[]
  errors: string[]
  warnings: string[]
}

// ── 워크시트 읽기 (xlsx 를 쓰지 않는다) ─────────────────────────────────────

/** xlsx 워크시트의 모양만 받는다. 칸은 `{ v: 값 }`, 범위는 `'!ref'`. */
export type SheetLike = Record<string, unknown>
export type WorkbookLike = { SheetNames: string[]; Sheets: Record<string, SheetLike> }

/** 'A' → 0, 'Z' → 25, 'AA' → 26. */
function colToIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** 0 → 'A', 26 → 'AA'. */
function indexToCol(index: number): string {
  let s = ''
  let n = index + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * 칸 하나의 값.
 * ⚠ 오류 칸(`#REF!`·`#N/A`)은 **t:'e' 이고 v 가 오류 번호(숫자)**다. 그 숫자를 그대로
 *   읽으면 가격으로 들어간다. 그래서 오류 칸은 값이 없는 것으로 본다.
 */
function cellValue(cell: unknown): unknown {
  if (cell === null || cell === undefined || typeof cell !== 'object') return null
  const c = cell as { t?: unknown; v?: unknown }
  if (c.t === 'e') return null
  return c.v ?? null
}

/** 워크시트 → 2차원 배열. `'!ref'` 가 없으면 빈 배열. */
export function sheetToRows(ws: SheetLike): unknown[][] {
  const ref = typeof ws['!ref'] === 'string' ? (ws['!ref'] as string) : ''
  const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)
  if (!m) return []
  const c0 = colToIndex(m[1]), r0 = Number(m[2]) - 1
  const c1 = colToIndex(m[3]), r1 = Number(m[4]) - 1
  const rows: unknown[][] = []
  for (let r = r0; r <= r1; r++) {
    const row: unknown[] = []
    for (let c = c0; c <= c1; c++) row.push(cellValue(ws[`${indexToCol(c)}${r + 1}`]))
    rows.push(row)
  }
  return rows
}

// ── 값 다듬기 ───────────────────────────────────────────────────────────────

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/\r\n/g, ' ').replace(/\n/g, ' ').trim()
  return s === '' ? null : s
}

/**
 * 정가·구입가 — 「¥ ￥ \ , 공백」을 털고 숫자로. 안 되면 null.
 * 都度見積 · TBC · - · ===== · #REF! · Net Price 처럼 글자가 섞이면 전부 null 이다.
 * **문자열을 숫자 칸으로 보내지 않는다** — DB 가 받다가 터지면 등록 전체가 롤백된다.
 * 소수는 정수로 반올림한다(integer 칸이고, 미리보기 숫자와 저장값이 같아야 한다).
 */
export function cleanNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null
  const s = String(v).replace(/[,\s　¥￥₩\\]/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : null
}

/**
 * 납기 — 「1.0 month」·「2 months」·「3ヶ月」이면 **주로 환산**하고(개월 × 4, 반올림),
 * 그 밖의 표기는 **적힌 그대로** 둔다.
 *
 * 주로 환산하는 이유 — DB 의 delivery_time 에는 주 숫자만 들어 있고(delivery_time_update.sql)
 * 화면이 뒤에 「주」를 붙여 보여 준다(app/quote/QuoteItemRow.tsx). 개월을 그대로 넣으면
 * 1개월이 1주로 읽힌다.
 *
 * 빈칸과 「-」는 null(납기 없음)이다. 「-」를 글자로 남기면 화면에 「발주 후 -주」가 찍힌다.
 */
export function cleanLeadTime(v: unknown): { weeks: string | null; converted: boolean } {
  const s = text(v)
  if (!s || /^[-–—]+$/.test(s)) return { weeks: null, converted: false }
  const month = s.match(/(\d+(?:\.\d+)?)\s*(months?|ヶ月|カ月|か月|개월)/i)
  if (month) {
    const n = Number(month[1])
    if (Number.isFinite(n) && n > 0) return { weeks: String(Math.round(n * 4)), converted: true }
  }
  return { weeks: s, converted: false }
}

/** 엑셀 날짜 일련번호 → 'YYYY-MM-DD'. 범위를 벗어나면 null(그냥 숫자였다는 뜻). */
function excelSerialDate(v: unknown): string | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  if (!Number.isFinite(n) || n < 30000 || n > 60000) return null
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10)
}

// ── 시트 고르기 ─────────────────────────────────────────────────────────────

/**
 * 통파일에서 쓸 시트를 고른다.
 *   ① 고른 종류와 이름이 같은 시트 ② 공백·대소문자만 다른 시트
 *   ③ 시트가 하나뿐이면 이름이 달라도 그 시트 ④ 그 밖에는 고르지 않고 한글로 알린다
 */
export function pickSheetName(
  sheetNames: string[], kind: PriceListKind,
): { name: string | null; note: string; error: string } {
  const exact = sheetNames.find(n => n.trim() === kind.sheet)
  if (exact) return { name: exact, note: '', error: '' }
  const loose = sheetNames.find(n => normHeader(n) === normHeader(kind.sheet))
  if (loose) {
    return { name: loose, note: `시트 이름이 「${loose}」입니다 — 「${kind.sheet}」와 같은 시트로 보고 읽습니다.`, error: '' }
  }
  if (sheetNames.length === 1) {
    return { name: sheetNames[0], note: `시트가 하나뿐이라 「${sheetNames[0]}」을 읽습니다.`, error: '' }
  }
  return {
    name: null, note: '',
    error: `「${kind.sheet}」 시트를 찾지 못했습니다. 이 파일의 시트: ${sheetNames.join(' / ')}`,
  }
}

// ── 머리글 찾기 ─────────────────────────────────────────────────────────────

type HeaderHit = { row: number; map: Map<HeaderName, number> }

/** 그 글자가 일곱 머리글 중 하나인가. */
function headerNameOf(v: unknown): HeaderName | null {
  const n = normHeader(v)
  if (!n) return null
  return HEADER_NAMES.find(h => normHeader(h) === n) ?? null
}

/** 위에서 HEADER_SCAN_ROWS 행까지 보고 **가장 많이 맞는 줄**을 머리글로 잡는다(같으면 위쪽). */
function scanHeader(rows: unknown[][]): HeaderHit | null {
  let best: HeaderHit | null = null
  const limit = Math.min(HEADER_SCAN_ROWS, rows.length)
  for (let r = 0; r < limit; r++) {
    const map = new Map<HeaderName, number>()
    const row = rows[r] ?? []
    row.forEach((cell, c) => {
      const name = headerNameOf(cell)
      // 같은 이름이 두 번 나오면 **왼쪽 것**을 쓴다(오른쪽에 합계·메모가 붙는 파일이 있다).
      if (name && !map.has(name)) map.set(name, c)
    })
    if (map.size === 0) continue
    if (!best || map.size > best.map.size) best = { row: r, map }
  }
  return best
}

/** 머리글 위에 적힌 「Valid date …」 문구(없으면 null). */
function findValidText(rows: unknown[][], headerRow: number): string | null {
  for (let r = 0; r < Math.min(headerRow, rows.length); r++) {
    for (const cell of rows[r] ?? []) {
      const s = text(cell)
      if (s && /valid\s*date/i.test(s)) return s
    }
  }
  return null
}

/** 「Valid date」 문구가 없는 파일에서 머리글 위의 날짜 셀을 찾는다(보여 주기만 한다). */
function findTopDate(rows: unknown[][], headerRow: number): string | null {
  for (let r = 0; r < Math.min(headerRow, rows.length); r++) {
    for (const cell of rows[r] ?? []) {
      if (cell instanceof Date) return cell.toISOString().slice(0, 10)
      const d = excelSerialDate(cell)
      if (d) return d
    }
  }
  return null
}

/**
 * 머리글 **위쪽**의 묶음 제목을 거꾸로 찾는다(없으면 null).
 *
 * 왜 필요한가 — 실제 Calibration (JPY) 시트는 「■Calibration Price (JCSS calibration)」가
 * 7행, 머리글이 8행이다. 머리글 아래부터만 읽으면 **첫 블록 열 줄의 묶음이 비어** 버린다.
 * 그 줄들은 눈으로 보면 분명히 그 묶음 안에 있다.
 *
 * 보는 범위는 findValidText·findTopDate 와 같다(머리글 위 전부). 가까운 쪽부터 거꾸로 올라가
 * **처음 만나는** 제목을 쓴다 — 머리글 바로 위의 제목이 그 블록의 것이다.
 * 「Calibration Price List」·「SURFCOM & CONTOURECORD series」 처럼 ■·[…] 가 아닌 제목 줄은
 * 잡지 않는다(그건 시트 제목이나 계열 이름이고 묶음이 아니다).
 *
 * 이 줄은 counts.sections 에 세지 않는다 — 그 셈은 **머리글 아래**에서 만난 제목 줄 수다.
 */
function findInitialSection(
  rows: unknown[][], headerRow: number, codeCol?: number, nameCol?: number,
): string | null {
  for (let r = Math.min(headerRow, rows.length) - 1; r >= 0; r--) {
    const row = rows[r] ?? []
    // 줄 안을 보는 규칙은 아래 본문 고리와 같다 — 품번 칸, 품번이 비면 품명 칸.
    const code = codeCol == null ? null : text(row[codeCol])
    const title = sectionTitle(code)
      ?? (code ? null : sectionTitle(nameCol == null ? null : text(row[nameCol])))
    if (title) return title
  }
  return null
}

// ── 줄 분류 ─────────────────────────────────────────────────────────────────

/** 「■…」·「◆…」 처럼 묶음 제목으로 시작하는가. */
const SECTION_PREFIX = /^[■◆▶●]/
/** 「[이름]」만 있는 칸(20 가격표의 묶음 제목이 그 모양이다). */
const BRACKET_ONLY = /^\[(.+)\]$/

/** 묶음 제목이면 그 이름(기호·대괄호를 벗긴 글자), 아니면 null. */
function sectionTitle(s: string | null): string | null {
  if (!s) return null
  const t = s.trim()
  if (SECTION_PREFIX.test(t)) return t.replace(SECTION_PREFIX, '').trim() || null
  const b = t.match(BRACKET_ONLY)
  return b ? b[1].trim() || null : null
}

// ── 본체 ────────────────────────────────────────────────────────────────────

/**
 * 시트 하나를 읽는다.
 *
 * @param ws        워크시트(`{ '!ref': …, A1: { v }, … }`)
 * @param line      '80' | '20' — 그 줄들이 어느 가격표인지. 행마다 그대로 담긴다.
 * @param sheetName 엑셀 시트 이름. 행의 sheet_name 이 된다(비우면 빈 글자).
 */
export function parseSheet(ws: SheetLike, line: PriceLine, sheetName = ''): ParseResult {
  const out: ParseResult = {
    sheetName, line, headerRow: 0, columns: [], validText: null, topDate: null,
    rows: [],
    counts: {
      itemRows: 0, registered: 0, noCost: 0, nonItem: 0,
      sections: 0, headerRepeats: 0, deliveryConverted: 0, variantTagged: 0,
    },
    skippedNoCost: [], errors: [], warnings: [],
  }

  const rows = sheetToRows(ws)
  if (rows.length === 0) {
    out.errors.push('시트에서 읽을 내용이 없습니다.')
    return out
  }

  // ── 머리글 ──
  const hit = scanHeader(rows)
  const missing = REQUIRED_HEADERS.filter(h => !hit?.map.has(h))
  if (!hit || missing.length > 0) {
    const what = missing.length > 0 ? missing : REQUIRED_HEADERS
    out.errors.push(
      `머리글에서 ${what.map(h => `「${h}」`).join('·')} 열을 찾지 못했습니다 `
      + `(위에서 ${HEADER_SCAN_ROWS}행까지 찾았습니다). `
      // 일곱 이름을 **모두** 적는다 — 사람이 엑셀 머리글을 그 글자로 고쳐야 한다.
      + `머리글은 이 일곱 글자여야 합니다: ${HEADER_NAMES.join(' / ')} `
      + `(필수: ${REQUIRED_HEADERS.join(' · ')})`,
    )
    return out
  }

  out.headerRow = hit.row + 1
  out.validText = findValidText(rows, hit.row)
  if (!out.validText) out.topDate = findTopDate(rows, hit.row)
  out.columns = [...hit.map.entries()]
    .map(([name, index]) => ({ name, index }))
    .sort((a, b) => a.index - b.index)

  const at = (row: unknown[], name: HeaderName): unknown => {
    const i = hit.map.get(name)
    return i == null ? null : row[i]
  }

  // ── 1-pass: 줄을 분류하며 품목을 모은다 ──
  //   묶음 제목은 다음 제목이 나올 때까지 아래 품목들의 grp 가 된다.
  //   시작 값은 **머리글 위에 있는 제목**이다(있으면). 그 제목이 머리글보다 위에 적힌
  //   파일이 있어서, 없다고 보면 첫 블록의 묶음이 통째로 빈다.
  let grp: string | null = findInitialSection(rows, hit.row, hit.map.get('품번'), hit.map.get('품명'))
  const kept: ParsedPriceRow[] = []

  for (let r = hit.row + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const codeCell = text(at(row, '품번'))

    // (a) 묶음 제목 — 품번 칸의 「■…」, 또는 품번이 비고 품명 칸에 「[이름]」만 있는 줄.
    const title = sectionTitle(codeCell) ?? (codeCell ? null : sectionTitle(text(at(row, '품명'))))
    if (title) {
      grp = title
      out.counts.sections++
      continue
    }

    // (e) 품번 칸이 빈 줄은 무시한다(묶음 제목만 예외였다).
    if (!codeCell) continue

    // (b) 머리글이 중간에 다시 나온 줄 — 조용히 건너뛴다. 품목 아닌 줄로 세지 않는다.
    if (headerNameOf(codeCell)) {
      out.counts.headerRepeats++
      continue
    }

    const name = text(at(row, '품명'))
    const costRaw = at(row, '구입가')

    // (c) 품번만 있고 품명·구입가가 둘 다 빈 줄 — 계열 제목 같은 것이다.
    if (!name && text(costRaw) === null) {
      out.counts.nonItem++
      continue
    }

    // (d) 품목 줄.
    out.counts.itemRows++
    const cost = cleanNumber(costRaw)
    if (cost === null) {
      out.counts.noCost++
      if (out.skippedNoCost.length < 200) out.skippedNoCost.push({ item_code: codeCell, name: name ?? '' })
      continue
    }

    const lead = hit.map.has('납기') ? cleanLeadTime(at(row, '납기')) : null
    if (lead?.converted) out.counts.deliveryConverted++

    kept.push({
      sheet_name: sheetName,
      line,
      item_code: codeCell,
      variant: '',
      grp,
      item_name_jp: name,
      model_jp: text(at(row, '모델')),
      note1_jp: text(at(row, '비고')),
      price_jpy: cleanNumber(at(row, '정가')),
      cost_jpy: cost,
      delivery_time: lead ? lead.weeks : null,
    })
  }

  // ── 2-pass: 같은 품번이 값이 다르게 여러 줄이면 variant 에 묶음 제목을 넣는다 ──
  //
  //   왜 2-pass 인가 — 어느 줄에 구분을 붙여야 하는지는 **시트를 끝까지 읽어야** 안다.
  //   첫 줄을 만났을 때는 그 품번이 뒤에 또 나올지 알 수 없다.
  //
  //   값이 전부 같은 중복은 구분을 붙이지 않는다('' 로 둔다) — 같은 품목을 두 번 적은
  //   것이고, DB 함수가 하나로 합친다. 값이 다르면 서로 다른 품목이므로 (품번, 구분)이
  //   달라야 둘 다 남는다. 구분에 쓸 글자는 그 줄이 속한 묶음 제목이다.
  const byCode = new Map<string, ParsedPriceRow[]>()
  for (const row of kept) {
    const list = byCode.get(row.item_code)
    if (list) list.push(row)
    else byCode.set(row.item_code, [row])
  }
  const sig = (r: ParsedPriceRow) =>
    [r.cost_jpy, r.price_jpy, r.item_name_jp, r.model_jp].map(v => v ?? '').join('|')

  for (const list of byCode.values()) {
    if (list.length < 2) continue
    const first = sig(list[0])
    if (list.every(r => sig(r) === first)) continue
    for (const r of list) {
      r.variant = r.grp ?? ''
      out.counts.variantTagged++
    }
  }

  out.rows = kept
  out.counts.registered = kept.length

  // ── 오류·경고 ──
  if (kept.length === 0) {
    out.errors.push('등록할 수 있는 줄이 없습니다 — 구입가가 있는 줄이 하나도 없습니다.')
  }
  if (kept.length > PARSE_ROW_MAX) {
    out.errors.push(`한 번에 등록할 수 있는 줄은 ${PARSE_ROW_MAX.toLocaleString('ko-KR')}개까지입니다 (읽은 줄 ${kept.length.toLocaleString('ko-KR')}).`)
  }
  if (out.counts.noCost > 0) {
    out.warnings.push(`구입가가 없어 등록에서 빠지는 줄이 ${out.counts.noCost}건 있습니다.`)
  }
  if (!hit.map.has('품명')) out.warnings.push('「품명」 열이 없습니다 — 품번만 등록됩니다.')
  if (!hit.map.has('정가')) out.warnings.push('「정가」 열이 없습니다 — 정가 없이 등록합니다.')
  if (out.counts.variantTagged > 0) {
    out.warnings.push(
      `같은 품번이 값이 다르게 여러 줄 있어 ${out.counts.variantTagged}줄에 구분(묶음 제목)을 붙였습니다.`,
    )
  }

  return out
}

/**
 * 통파일을 시트별로 읽는다. **이번 단계에서는 등록 화면이 쓰지 않는다**(시험만 한다) —
 * 화면은 지금도 종류를 고르고 그 시트 하나만 올린다.
 */
export function parseWorkbook(wb: WorkbookLike, line: PriceLine): ParseResult[] {
  return wb.SheetNames.map(name => parseSheet(wb.Sheets[name] ?? {}, line, name))
}

// ── 엑셀 머리글 규칙 안내 ───────────────────────────────────────────────────
//
// 화면에 보여 줄 글자를 **위 상수에서 만든다.** 따로 적어 두면 규칙을 고칠 때 안내가
// 옛 내용을 가리키고, 그 안내를 보고 엑셀을 고친 사람이 등록에 실패한다.

export type HeaderGuideItem = { label: string; column: string; required: boolean }
export type HeaderGuide = { summary: string; items: HeaderGuideItem[]; notes: string[] }

export function headerGuide(): HeaderGuide {
  const req = REQUIRED_HEADERS.map(h => `「${h}」`).join('·')
  return {
    summary: `머리글은 한글 일곱 글자다 — ${HEADER_NAMES.join(' · ')} (필수: ${REQUIRED_HEADERS.join(' · ')})`,
    items: HEADER_NAMES.map(h => ({
      label: h, column: HEADER_COLUMN[h], required: REQUIRED_HEADERS.includes(h),
    })),
    notes: [
      `머리글 행은 위에서 ${HEADER_SCAN_ROWS}행 안에서 가장 많이 맞는 줄로 잡고, 그 열 위치를 시트 전체에 씁니다. 열 순서는 상관없습니다.`,
      '이름은 공백만 지우고 똑같은지로 봅니다. 영문 머리글은 읽지 않습니다 — 올리기 전에 일곱 글자로 고쳐 주세요.',
      `${req} 를 찾지 못하면 등록되지 않습니다(어느 열이 없는지 알려 줍니다).`,
      '일곱 개 밖의 열(Profit Center · Calibration items · 숨긴 열 등)은 읽지 않습니다.',
      '「■…」 로 시작하는 줄과 품번 없이 「[이름]」만 있는 줄은 묶음 제목으로 읽어, 다음 제목까지 아래 품목들의 그룹에 담습니다.',
      '중간에 다시 나오는 머리글 줄은 조용히 건너뜁니다.',
      '품번은 있는데 품명·구입가가 둘 다 비면 품목이 아닌 줄로 세고 등록하지 않습니다.',
      '구입가가 숫자가 아니면(都度見積 · TBC · #REF! 등) 그 줄은 등록하지 않고 건수만 보여 줍니다. 정가는 없어도 됩니다.',
      '납기가 「1.0 month」처럼 개월이면 주로 환산하고(개월 × 4), 그 밖의 표기는 적힌 그대로 둡니다.',
      '같은 품번이 값이 다르게 여러 줄이면 그 줄들에 묶음 제목을 구분값으로 붙여 둘 다 등록합니다(값이 같은 중복은 DB 가 하나로 합칩니다).',
    ],
  }
}
