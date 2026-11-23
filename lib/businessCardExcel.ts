/**
 * 명함 목록을 엑셀로 (2026-11-23).
 *
 * **걸린 조건 그대로** 내보낸다 — 화면에서 본 줄과 파일의 줄이 같아야 한다.
 * 열에는 등록자 이름·팀·사업부를 함께 낸다(요청) — 「누가 모은 명함인가」를 세려면 필요하다.
 *
 * 줄 만들기(cardRowsAoA)는 순수 함수다 — 하네스가 돌린다. 파일로 쓰는 일만 브라우저에서 한다.
 */

import { EXCEL_COLUMNS, ageLabel, daysBetween, type BusinessCard } from './businessCard'

/** 머리글 — EXCEL_COLUMNS 의 차례 그대로 + 나이 한 칸. */
export const CARD_EXCEL_HEADER: readonly string[] = [...EXCEL_COLUMNS.map(c => c.label), '지난 기간']

const day = (v: unknown): string => String(v ?? '').slice(0, 10)

/** 줄 묶음 — 머리글 한 줄 + 명함마다 한 줄. */
export function cardRowsAoA(cards: readonly BusinessCard[], todayIso: string): (string | number)[][] {
  const out: (string | number)[][] = [[...CARD_EXCEL_HEADER]]
  for (const c of cards) {
    const row: (string | number)[] = []
    for (const col of EXCEL_COLUMNS) {
      const v = (c as unknown as Record<string, unknown>)[col.key]
      row.push(col.key === 'registered_at' || col.key === 'verified_at' ? day(v) : String(v ?? ''))
    }
    row.push(ageLabel(daysBetween(c.registered_at, todayIso)))
    out.push(row)
  }
  return out
}

/** 열 너비 — 글자 수로 어림잡는다(고객사 엑셀과 같은 방식). */
export function columnWidths(aoa: (string | number)[][]): { wch: number }[] {
  const cols = aoa[0]?.length ?? 0
  const out: { wch: number }[] = []
  for (let c = 0; c < cols; c++) {
    let w = 8
    for (const r of aoa) {
      const s = String(r[c] ?? '')
      // 한글은 두 칸으로 센다.
      const len = [...s].reduce((n, ch) => n + (/[가-힣]/.test(ch) ? 2 : 1), 0)
      if (len > w) w = len
    }
    out.push({ wch: Math.min(w + 2, 44) })
  }
  return out
}

export function cardExcelFileName(today: string): string {
  return `명함목록_${today.slice(0, 10).replace(/-/g, '')}.xlsx`
}

/** 파일 하나를 내려받는다. 브라우저에서만 부른다(동적 import). */
export async function exportCardXlsx(cards: readonly BusinessCard[], todayIso: string): Promise<number> {
  const aoa = cardRowsAoA(cards, todayIso)
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = columnWidths(aoa)
  const last = XLSX.utils.encode_cell({ r: aoa.length - 1, c: CARD_EXCEL_HEADER.length - 1 })
  ws['!autofilter'] = { ref: `A1:${last}` }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '명함')
  XLSX.writeFile(wb, cardExcelFileName(todayIso))
  return aoa.length - 1
}
