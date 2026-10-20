// 가격표 엑셀 한 시트 → DB 에 넣을 행 배열. **순수 함수만** 둔다.
//
// 엑셀 파일을 읽는 일(xlsx)은 화면이 한다. 이 파일은 「2차원 배열」을 받는다 —
// 그래야 실데이터 없이 가짜 시트로 시험할 수 있다(scripts/price-list-parse-check.js).
//
// ── 조용히 틀리지 않는다 ────────────────────────────────────────────────────
//   가격표를 잘못 읽으면 견적 금액이 전부 틀어진다. 그래서 애매하면 **멈춘다.**
//     · 필수 열(품번·구입가)을 못 찾으면 오류 — 어느 열이 없는지와 후보를 한글로 알린다.
//     · 같은 품번이 값이 다르게 두 번 나오면 오류 — 어느 쪽이 맞는지 기계가 고를 수 없다.
//     · 구입가가 없는 줄은 **경고**다(등록에서 빼고 건수를 보여 준다. 막지는 않는다).
//
// ── 숫자를 여기서도 반올림한다 ──────────────────────────────────────────────
//   price_jpy·cost_jpy 는 integer 칸이고 서버 함수도 반올림한다. 그래도 여기서 먼저
//   반올림하는 이유는 **미리보기에 보여 준 숫자와 저장되는 숫자가 같아야** 하기 때문이다.

import {
  HEADER_CANDIDATES, TARGET_LABELS, normHeader, targetOfHeader,
} from './priceListKinds'
import type { HeaderTarget, PriceListKind } from './priceListKinds'

/** 서버로 보내는 한 줄. price_list 의 칸 이름과 같다(sheet_name 은 서버가 채운다). */
export type ParsedPriceRow = {
  item_code: string
  variant: string
  plnt: string | null
  /**
   * 80 가격표는 엑셀의 Group 열, 20 가격표는 **섹션 제목**(「[Gauge system]」)이 들어온다.
   * 20 파일에는 Group 열이 없고 대신 품목 묶음이 섹션 줄로 나뉘어 있다 —
   * 그 이름을 여기 담아 두면 어느 묶음의 품목인지 남는다.
   */
  grp: string | null
  item_name_jp: string | null
  model_jp: string | null
  note1_jp: string | null
  note2_jp: string | null
  note3_jp: string | null
  price_jpy: number | null
  cost_jpy: number | null
  /**
   * 납기 — **주(週) 숫자 문자열**이다('10' = 10주). 20 가격표에만 담는다.
   *
   * ⚠ 80 종류에는 **넣지 않는다.** 그 값은 사람이 손으로 채운 운영값이고
   *   (delivery_time_update.sql 이 품번 450여 개에 직접 넣었다) 엑셀에 없다.
   * ⚠ 지금 DB 함수(apply_price_list_import)는 이 칸을 **저장하지 않는다.**
   *   보내도 조용히 쓰이지 않을 뿐 오류가 나지 않는다(함수 주석 참조).
   */
  delivery_time?: string | null
}

export type FoundColumn = { target: HeaderTarget; label: string; index: number; header: string }

export type ParseResult = {
  sheetName: string
  /** 사람이 읽는 번호(엑셀 행 번호). 못 찾으면 0. */
  headerRow: number
  columns: FoundColumn[]
  /** 파일 맨 위의 「Valid date …」 문구. 기능은 없고 기록·표시용이다. */
  validText: string | null
  rows: ParsedPriceRow[]
  /** 머리글 아래에서 품번이 있던 줄 수(건너뛴 섹션·빈 줄은 뺀 수). */
  readRows: number
  /** 섹션 제목(■·[이름])·머리글 반복·빈 줄처럼 품목이 아닌 줄. */
  skippedNonItem: number
  /** 그중 묶음 제목 줄의 수(20 가격표의 「[이름]」 · 80 교정의 「■…」). */
  sectionRows: number
  /** 납기를 개월에서 주로 환산한 줄 수. */
  deliveryConverted: number
  /** 「Valid date」 문구가 없을 때, 머리글 위에서 찾은 날짜(참고용. 저장하지 않는다). */
  topDate: string | null
  /** 구입가가 없어 등록에서 뺀 줄. */
  skippedNoCost: { item_code: string; name: string }[]
  /** 값까지 같아 하나로 합친 중복 줄 수. */
  merged: number
  /** 값이 달라 막은 품번. 비어 있지 않으면 등록할 수 없다. */
  conflicts: string[]
  errors: string[]
  warnings: string[]
}

/** 한 번에 받는 줄 수 상한 — 서버 함수와 같은 값이다. */
export const PARSE_ROW_MAX = 20000
/** 머리글을 찾는 범위(위에서 이만큼만 본다). */
export const HEADER_SCAN_ROWS = 15

// ── 값 다듬기 ───────────────────────────────────────────────────────────────

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/\r\n/g, ' ').replace(/\n/g, ' ').trim()
  return s === '' ? null : s
}

/**
 * 숫자 칸 — 쉼표·통화기호·공백을 털고 정수로 반올림한다.
 * 숫자가 아니면(빈칸, '#REF!', '-', 글자) null 이다. null 은 「값이 없다」는 뜻이고,
 * 구입가가 null 인 줄은 등록에서 빠진다.
 */
export function cleanNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null
  const s = String(v).replace(/[,\s　¥￥₩]/g, '')
  if (s === '' || s === '-' || s.startsWith('#')) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : null
}

/**
 * 납기 — 엑셀의 「1.0 month」·「2.5 month」를 **주 숫자 문자열**로 바꾼다.
 *
 * 왜 주인가 — DB 의 delivery_time 에는 주 숫자만 들어 있고(delivery_time_update.sql 이
 * '2'·'3'·'4' 를 넣었다) 화면이 뒤에 「주」를 붙여 보여 준다
 * (app/quote/QuoteItemRow.tsx 의 「발주 후 {delivery_time}주」,
 *  hooks/quote/useQuoteRows.ts 의 `item.delivery_time + '주'`).
 * 그래서 개월을 **그대로 넣으면 1개월이 1주로 읽힌다.** 한 달을 4주로 보고 환산한다.
 *
 * 「-」·빈칸·알 수 없는 글자는 null 이다(납기 없음 — 화면이 「담당자 납기 문의」로 보여 준다).
 * 「2 weeks」처럼 주로 적혀 있으면 환산하지 않고 그 숫자를 쓴다.
 */
export function cleanLeadTime(v: unknown): { weeks: string | null; converted: boolean } {
  const s = v === null || v === undefined ? '' : String(v).trim()
  if (s === '' || s === '-') return { weeks: null, converted: false }
  const m = s.match(/(\d+(?:\.\d+)?)/)
  if (!m) return { weeks: null, converted: false }
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return { weeks: null, converted: false }
  const low = s.toLowerCase()
  if (low.includes('week') || s.includes('주')) return { weeks: String(Math.round(n)), converted: false }
  if (low.includes('month') || s.includes('개월') || s.includes('月')) {
    return { weeks: String(Math.round(n * 4)), converted: true }
  }
  // 단위가 없으면 손대지 않는다 — 주인지 개월인지 모르는 값을 네 배로 부풀리면 안 된다.
  return { weeks: String(Math.round(n)), converted: false }
}

/** 엑셀 날짜 일련번호 → 'YYYY-MM-DD'. 범위를 벗어나면 null(그냥 숫자였다는 뜻). */
function excelSerialDate(v: unknown): string | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  if (!Number.isFinite(n) || n < 30000 || n > 60000) return null
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}

// ── 시트 고르기 ─────────────────────────────────────────────────────────────

/**
 * 통파일에서 쓸 시트를 고른다.
 *   ① 고른 종류와 이름이 같은 시트
 *   ② 시트가 하나뿐이면 이름이 달라도 그 시트(미리보기에 이름을 보여 준다)
 *   ③ 그 밖에는 고르지 않고 한글로 알린다
 */
export function pickSheetName(
  sheetNames: string[], kind: PriceListKind,
): { name: string | null; note: string; error: string } {
  const exact = sheetNames.find(n => n.trim() === kind.sheet)
  if (exact) return { name: exact, note: '', error: '' }
  // 공백·대소문자만 다른 경우는 같은 시트로 본다(사람이 손으로 고친 파일).
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

type HeaderHit = { row: number; map: Map<HeaderTarget, number>; headers: Map<HeaderTarget, string> }

function scanHeader(rows: unknown[][]): HeaderHit | null {
  let best: HeaderHit | null = null
  const limit = Math.min(HEADER_SCAN_ROWS, rows.length)
  for (let r = 0; r < limit; r++) {
    const row = rows[r] ?? []
    const map = new Map<HeaderTarget, number>()
    const headers = new Map<HeaderTarget, string>()
    row.forEach((cell, c) => {
      const target = targetOfHeader(cell)
      // 같은 이름이 두 번 나오면 **왼쪽 것**을 쓴다(오른쪽에 합계·메모가 붙는 파일이 있다).
      if (target && !map.has(target)) {
        map.set(target, c)
        headers.set(target, String(cell).replace(/\s+/g, ' ').trim())
      }
    })
    if (!map.has('item_code')) continue
    const hasCost = map.has('cost_jpy') || map.has('cost_jig_in') || map.has('cost_jig_out')
    if (!hasCost) continue
    // 맞은 열이 가장 많은 행이 머리글이다. 같으면 위쪽을 쓴다.
    if (!best || map.size > best.map.size) best = { row: r, map, headers }
  }
  return best
}

/** 머리글 위에 적힌 「Valid date …」 문구를 그대로 집는다(없으면 null). */
function findValidText(rows: unknown[][], headerRow: number): string | null {
  for (let r = 0; r < Math.min(headerRow, rows.length); r++) {
    for (const cell of rows[r] ?? []) {
      const s = text(cell)
      if (s && /valid\s*date/i.test(s)) return s
    }
  }
  return null
}

/**
 * 「Valid date」 문구가 없는 파일(20 가격표)에서 **머리글 위의 날짜 셀**을 찾는다.
 * 보여 주기만 한다 — 이력(valid_text)에는 넣지 않는다. 파일이 스스로 「유효기간」이라고
 * 말한 글자가 아니라 우리가 추측한 날짜라서, 기록으로 남기면 뜻이 섞인다.
 */
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

// ── 본체 ────────────────────────────────────────────────────────────────────

/** 섹션 제목 행인가 — Calibration 시트는 「■ …」 로 묶음을 나눈다. */
const isSectionLabel = (s: string): boolean => /^[■◆▶■◆]/.test(s)

/**
 * 20 가격표의 묶음 제목 — 품번 칸이 비고 품명 칸에 「[Gauge system]」처럼 대괄호 이름만 있다.
 * 품목이 아니라 묶음 머리다. 이름(대괄호 벗긴 글자)을 뒤따르는 품목들의 grp 에 넣는다.
 */
const bracketSection = (s: string | null): string | null => {
  if (!s) return null
  const m = s.trim().match(/^\[(.+)\]$/)
  return m ? m[1].trim() : null
}

export function parsePriceSheet(
  rows: unknown[][], kind: PriceListKind, sheetName: string,
): ParseResult {
  const out: ParseResult = {
    sheetName, headerRow: 0, columns: [], validText: null, rows: [],
    readRows: 0, skippedNonItem: 0, sectionRows: 0, deliveryConverted: 0, topDate: null,
    skippedNoCost: [], merged: 0,
    conflicts: [], errors: [], warnings: [],
  }

  const hit = scanHeader(rows)
  if (!hit) {
    // 무엇이 없는지 구체적으로 알린다 — 「파싱 실패」만 보여 주면 사람이 할 수 있는 일이 없다.
    const head = rows.slice(0, HEADER_SCAN_ROWS)
    const hasCode = head.some(r => (r ?? []).some(c => targetOfHeader(c) === 'item_code'))
    const missing: HeaderTarget[] = hasCode ? ['cost_jpy'] : ['item_code']
    for (const m of missing) {
      out.errors.push(
        `머리글에서 「${TARGET_LABELS[m]}」 열을 찾지 못했습니다 `
        + `(위에서 ${HEADER_SCAN_ROWS}행까지 찾았습니다). `
        // 기대하는 이름을 **전부** 보여 준다 — 사람이 엑셀 머리글을 고칠 수 있어야 한다.
        + `기대하는 머리글: ${HEADER_CANDIDATES[m].join(' / ')}`,
      )
    }
    return out
  }

  out.headerRow = hit.row + 1
  out.validText = findValidText(rows, hit.row)
  if (!out.validText) out.topDate = findTopDate(rows, hit.row)
  out.columns = [...hit.map.entries()]
    .map(([target, index]) => ({ target, label: TARGET_LABELS[target], index, header: hit.headers.get(target) ?? '' }))
    .sort((a, b) => a.index - b.index)

  const col = (t: HeaderTarget): number | null => hit.map.get(t) ?? null
  const cell = (row: unknown[], t: HeaderTarget): unknown => {
    const i = col(t)
    return i == null ? null : row[i]
  }

  // ── 줄 읽기 ──
  type Draft = ParsedPriceRow & { rowNo: number }
  const drafts: Draft[] = []
  // 지금까지 지나온 묶음 제목(20 가격표). 뒤따르는 품목 줄의 grp 가 된다.
  let section: string | null = null

  for (let r = hit.row + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const rawCode = text(cell(row, 'item_code'))
    if (!rawCode) {
      // 품번이 없는 줄 — 빈 줄, 묶음 제목, 합계 줄. 품목은 아니다.
      const named = bracketSection(text(cell(row, 'item_name_jp')))
      if (named) {
        section = named
        out.sectionRows++
        out.skippedNonItem++
        continue
      }
      if ((row ?? []).some(c => text(c) !== null)) out.skippedNonItem++
      continue
    }
    // 섹션 제목이 품번 열에 들어 있는 경우(Calibration) · 머리글 반복 행.
    if (isSectionLabel(rawCode) || targetOfHeader(rawCode) !== null) {
      if (isSectionLabel(rawCode)) out.sectionRows++
      out.skippedNonItem++
      continue
    }

    out.readRows++
    // 납기는 종류를 가리지 않고 읽는다 — 열이 있으면 담고, 없으면 담지 않는다.
    // (DB 함수가 「값이 온 줄만」 덮으므로, 열이 없는 파일로 기존 납기가 지워지지 않는다.)
    const lead = hit.map.has('delivery_time') ? cleanLeadTime(cell(row, 'delivery_time')) : null
    const base = {
      item_code: rawCode,
      plnt: text(cell(row, 'plnt')),
      // Group 열이 있으면 그 값, 없으면 지나온 묶음 제목(20 가격표).
      grp: text(cell(row, 'grp')) ?? section,
      ...(lead ? { delivery_time: lead.weeks } : {}),
      item_name_jp: text(cell(row, 'item_name_jp')),
      model_jp: text(cell(row, 'model_jp')),
      note1_jp: text(cell(row, 'note1_jp')),
      note2_jp: text(cell(row, 'note2_jp')),
      // note3_jp 는 읽지 않는다 — 예전 스크립트가 열 위치를 세다 실수로 정가 값을 넣던 칸이다.
      note3_jp: null,
      price_jpy: cleanNumber(cell(row, 'price_jpy')),
    }

    const cost = cleanNumber(cell(row, 'cost_jpy'))
    if (cost == null) {
      out.skippedNoCost.push({ item_code: rawCode, name: base.item_name_jp ?? '' })
      continue
    }
    drafts.push({ ...base, rowNo: r + 1, variant: '', cost_jpy: cost })
    // 환산 건수는 **등록되는 줄만** 센다 — 미리보기의 「등록 대상」과 앞뒤가 맞아야 한다.
    if (lead?.converted) out.deliveryConverted++
  }

  // ── 같은 (품번, 구분) 정리 ──
  //   값까지 같으면 하나로 합친다. 값이 다르면 막는다(어느 쪽이 맞는지 알 수 없다).
  const seen = new Map<string, Draft>()
  const conflict = new Set<string>()
  const sig = (d: Draft) =>
    [d.cost_jpy, d.price_jpy, d.item_name_jp, d.model_jp].map(v => (v ?? '')).join('|')

  for (const d of drafts) {
    const key = `${d.item_code}\u0000${d.variant}`
    const prev = seen.get(key)
    if (!prev) { seen.set(key, d); continue }
    if (sig(prev) === sig(d)) { out.merged++; continue }
    conflict.add(d.variant ? `${d.item_code} (${d.variant})` : d.item_code)
  }

  out.conflicts = [...conflict].sort()
  // 서버로 보내는 칸을 **명시한다** — rowNo 같은 화면용 값이 섞여 나가지 않게.
  out.rows = [...seen.values()].map(d => ({
    item_code: d.item_code, variant: d.variant,
    plnt: d.plnt, grp: d.grp,
    item_name_jp: d.item_name_jp, model_jp: d.model_jp,
    note1_jp: d.note1_jp, note2_jp: d.note2_jp, note3_jp: d.note3_jp,
    price_jpy: d.price_jpy, cost_jpy: d.cost_jpy,
    // 납기는 20 가격표 줄에만 있다(80 줄에는 이 칸이 아예 없다).
    ...(d.delivery_time !== undefined ? { delivery_time: d.delivery_time } : {}),
  }))

  // ── 오류·경고 ──
  if (out.conflicts.length > 0) {
    out.errors.push(
      `같은 품번이 서로 다른 값으로 들어 있습니다(${out.conflicts.length}건): `
      + out.conflicts.slice(0, 20).join(', ')
      + (out.conflicts.length > 20 ? ' …' : '')
      + ' — 파일을 고친 뒤 다시 올려 주세요.',
    )
  }
  if (out.rows.length === 0 && out.errors.length === 0) {
    out.errors.push('등록할 수 있는 줄이 없습니다 — 구입가가 있는 줄이 하나도 없습니다.')
  }
  if (out.rows.length > PARSE_ROW_MAX) {
    out.errors.push(`한 번에 등록할 수 있는 줄은 ${PARSE_ROW_MAX.toLocaleString('ko-KR')}개까지입니다 (읽은 줄 ${out.rows.length.toLocaleString('ko-KR')}).`)
  }
  if (out.skippedNoCost.length > 0) {
    out.warnings.push(`구입가가 없어 등록에서 빠지는 줄이 ${out.skippedNoCost.length}건 있습니다.`)
  }
  if (!hit.map.has('price_jpy')) {
    out.warnings.push('정가(List price) 열이 없습니다 — 정가 없이 등록합니다.')
  }
  if (!hit.map.has('item_name_jp') && !hit.map.has('model_jp')) {
    out.warnings.push('모델·설명 열을 찾지 못했습니다 — 품번만 등록됩니다.')
  }

  return out
}

/** 미리보기·확인창이 함께 쓰는 요약 숫자. */
export const parseSummary = (r: ParseResult) => ({
  읽은줄: r.readRows,
  등록대상: r.rows.length,
  구입가없어제외: r.skippedNoCost.length,
  합친중복: r.merged,
  품목아닌줄: r.skippedNonItem,
  묶음제목줄: r.sectionRows,
  납기환산: r.deliveryConverted,
})

/** 모든 열 후보를 한 번에 보여 줄 때 쓴다(화면 도움말). */
export const allCandidates = (): { label: string; list: string }[] =>
  (Object.keys(HEADER_CANDIDATES) as HeaderTarget[])
    .map(t => ({ label: TARGET_LABELS[t], list: HEADER_CANDIDATES[t].join(' / ') }))

// ── 엑셀 머리글 규칙 안내 ───────────────────────────────────────────────────
//
// 화면에 보여 줄 글자를 **후보 목록에서 만든다.** 따로 적어 두면 후보를 고칠 때 안내가
// 옛 이름을 가리키게 되고, 그 안내를 보고 엑셀을 고친 사람이 등록에 실패한다.

export type HeaderGuideItem = { label: string; names: readonly string[] }
export type HeaderGuide = {
  /** 한 줄 요약(접힌 상태에 보인다). */
  summary: string
  /** 없으면 등록되지 않는 열. */
  required: HeaderGuideItem[]
  /** 있으면 읽고 없으면 비워 두는 열. */
  optional: HeaderGuideItem[]
  /** 종류별 규칙 설명. */
  notes: string[]
}

const guideItem = (t: HeaderTarget): HeaderGuideItem => ({
  label: TARGET_LABELS[t], names: HEADER_CANDIDATES[t],
})

/** 그 종류에서 읽는 열과 규칙 — 전부 상수에서 만들어진다. */
export function headerGuide(kind: PriceListKind): HeaderGuide {
  const required: HeaderTarget[] = ['item_code', 'cost_jpy']
  const optional: HeaderTarget[] = ['delivery_time', 'price_jpy', 'item_name_jp', 'model_jp', 'note1_jp', 'note2_jp', 'plnt', 'grp']

  const notes = [
    `머리글 행은 위에서 ${HEADER_SCAN_ROWS}행 안에서 자동으로 찾습니다. 열 순서는 상관없고, 머리글 위의 제목·날짜 줄은 건너뜁니다.`,
    '이름은 대소문자·공백·줄바꿈을 지운 뒤 아래 목록과 똑같은지로 봅니다 — 비슷한 이름은 잡지 않습니다.',
    `필수 열(${required.map(t => TARGET_LABELS[t]).join(' · ')})을 찾지 못하면 「○○ 열을 찾지 못했습니다」가 뜨고 등록되지 않습니다. 엑셀 머리글을 아래 이름 중 하나로 고쳐 주세요.`,
    '구입가가 없는 줄은 등록하지 않고 건수만 보여 줍니다. 정가는 없어도 등록됩니다.',
    '같은 품번이 한 시트 안에서 값이 다르게 두 번 나오면 등록을 막습니다(값까지 같으면 하나로 합칩니다).',
  ]
  // 종류별 분기를 두지 않는다 — 모든 시트가 같은 규칙으로 읽힌다.
  notes.push(
    '「■ …」 로 시작하는 줄과 품번 없이 「[이름]」만 있는 줄은 묶음 제목으로 읽어 뒤따르는 품목의 그룹에 담습니다(품목으로 등록하지 않습니다).',
    '중간에 다시 나오는 머리글 줄은 조용히 건너뜁니다.',
    '납기가 「1.0 month」처럼 개월로 적혀 있으면 주로 환산합니다(개월 × 4).',
  )

  return {
    summary: `필수 열은 ${required.map(t => `「${TARGET_LABELS[t]}」`).join('·')} 두 개입니다 — 머리글 이름은 아래 목록에서 자동으로 찾습니다.`,
    required: required.map(guideItem),
    optional: optional.map(guideItem),
    notes,
  }
}
