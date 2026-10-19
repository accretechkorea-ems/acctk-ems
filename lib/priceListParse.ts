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
  HEADER_CANDIDATES, JIG_VARIANTS, TARGET_LABELS, candidateHint, normHeader, targetOfHeader,
} from './priceListKinds'
import type { HeaderTarget, PriceListKind } from './priceListKinds'

/** 서버로 보내는 한 줄. price_list 의 칸 이름과 같다(sheet_name 은 서버가 채운다). */
export type ParsedPriceRow = {
  item_code: string
  variant: string
  plnt: string | null
  grp: string | null
  item_name_jp: string | null
  model_jp: string | null
  note1_jp: string | null
  note2_jp: string | null
  note3_jp: string | null
  price_jpy: number | null
  cost_jpy: number | null
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
  /** 섹션 제목(■)·머리글 반복·빈 줄처럼 품목이 아닌 줄. */
  skippedNonItem: number
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

// ── 본체 ────────────────────────────────────────────────────────────────────

/** 섹션 제목 행인가 — Calibration 시트는 「■ …」 로 묶음을 나눈다. */
const isSectionLabel = (s: string): boolean => /^[■◆▶■◆]/.test(s)

export function parsePriceSheet(
  rows: unknown[][], kind: PriceListKind, sheetName: string,
): ParseResult {
  const out: ParseResult = {
    sheetName, headerRow: 0, columns: [], validText: null, rows: [],
    readRows: 0, skippedNonItem: 0, skippedNoCost: [], merged: 0,
    conflicts: [], errors: [], warnings: [],
  }

  const hit = scanHeader(rows)
  if (!hit) {
    // 무엇이 없는지 구체적으로 알린다 — 「파싱 실패」만 보여 주면 사람이 할 수 있는 일이 없다.
    const head = rows.slice(0, HEADER_SCAN_ROWS)
    const hasCode = head.some(r => (r ?? []).some(c => targetOfHeader(c) === 'item_code'))
    const missing: HeaderTarget[] = hasCode ? ['cost_jpy'] : ['item_code']
    out.errors.push(
      missing.map(m =>
        `머리글에서 「${TARGET_LABELS[m]}」 열을 찾지 못했습니다. 후보: ${candidateHint(m)}`).join(' / ')
      + ` (위에서 ${HEADER_SCAN_ROWS}행까지 찾았습니다)`,
    )
    return out
  }

  out.headerRow = hit.row + 1
  out.validText = findValidText(rows, hit.row)
  out.columns = [...hit.map.entries()]
    .map(([target, index]) => ({ target, label: TARGET_LABELS[target], index, header: hit.headers.get(target) ?? '' }))
    .sort((a, b) => a.index - b.index)

  const col = (t: HeaderTarget): number | null => hit.map.get(t) ?? null
  const cell = (row: unknown[], t: HeaderTarget): unknown => {
    const i = col(t)
    return i == null ? null : row[i]
  }

  // Jig 두 열 — CMM Main body 에서만 본다. 한 열만 있어도 그 열로 두 줄 중 하나를 만든다.
  const jigIn = kind.profile === 'cmm_main' ? col('cost_jig_in') : null
  const jigOut = kind.profile === 'cmm_main' ? col('cost_jig_out') : null
  const useJig = jigIn != null || jigOut != null
  if (kind.profile === 'cmm_main' && !useJig) {
    out.warnings.push('구입가 열이 Jig 포함/제외로 나뉘어 있지 않습니다 — 한 품번을 한 줄로 등록합니다.')
  }

  // ── 줄 읽기 ──
  type Draft = ParsedPriceRow & { rowNo: number }
  const drafts: Draft[] = []

  for (let r = hit.row + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const rawCode = text(cell(row, 'item_code'))
    if (!rawCode) {
      // 품번이 없는 줄 — 빈 줄, 섹션 제목, 합계 줄. 조용히 건너뛴다.
      if ((row ?? []).some(c => text(c) !== null)) out.skippedNonItem++
      continue
    }
    // 섹션 제목이 품번 열에 들어 있는 경우(Calibration) · 머리글 반복 행.
    if (isSectionLabel(rawCode) || targetOfHeader(rawCode) !== null) {
      out.skippedNonItem++
      continue
    }

    out.readRows++
    const base = {
      item_code: rawCode,
      plnt: text(cell(row, 'plnt')),
      grp: text(cell(row, 'grp')),
      item_name_jp: text(cell(row, 'item_name_jp')),
      model_jp: text(cell(row, 'model_jp')),
      note1_jp: text(cell(row, 'note1_jp')),
      note2_jp: text(cell(row, 'note2_jp')),
      // note3_jp 는 읽지 않는다 — 예전 스크립트가 열 위치를 세다 실수로 정가 값을 넣던 칸이다.
      note3_jp: null,
      price_jpy: cleanNumber(cell(row, 'price_jpy')),
    }

    if (useJig) {
      // 한 행 → 두 줄. 품번은 그대로 두고 variant 와 설명 끝 표기로 가른다.
      const pairs = [
        { c: jigIn, v: JIG_VARIANTS.jig_in },
        { c: jigOut, v: JIG_VARIANTS.jig_out },
      ]
      let made = 0
      for (const { c, v } of pairs) {
        if (c == null) continue
        const cost = cleanNumber(row[c])
        if (cost == null) continue
        drafts.push({
          ...base, rowNo: r + 1, variant: v.variant, cost_jpy: cost,
          model_jp: [base.model_jp, v.mark].filter(Boolean).join(' '),
        })
        made++
      }
      // 두 열이 모두 비면 등록할 수 없는 줄이다.
      if (made === 0) out.skippedNoCost.push({ item_code: rawCode, name: base.item_name_jp ?? '' })
      continue
    }

    const cost = cleanNumber(cell(row, 'cost_jpy'))
    if (cost == null) {
      out.skippedNoCost.push({ item_code: rawCode, name: base.item_name_jp ?? '' })
      continue
    }
    drafts.push({ ...base, rowNo: r + 1, variant: '', cost_jpy: cost })
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
})

/** 모든 열 후보를 한 번에 보여 줄 때 쓴다(화면 도움말). */
export const allCandidates = (): { label: string; list: string }[] =>
  (Object.keys(HEADER_CANDIDATES) as HeaderTarget[])
    .map(t => ({ label: TARGET_LABELS[t], list: HEADER_CANDIDATES[t].join(' / ') }))
