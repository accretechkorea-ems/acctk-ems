'use client'

// 가격표 등록의 **브라우저 쪽 일** — 엑셀 읽기, 서버 호출, 이력 조회.
//
// 엑셀은 여기서 읽는다. 파일은 서버로 보내지 않고, DB 에 들어갈 칸만 담은 행 배열을 보낸다.
// xlsx 는 **쓸 때 불러온다**(동적 import) — 관리자가 파일을 고르기 전에는 내려받지 않는다.

import type { SupabaseClient } from '@supabase/supabase-js'
import { parsePriceSheet, pickSheetName } from '@/lib/priceListParse'
import type { ParseResult } from '@/lib/priceListParse'
import type { PriceListKind } from '@/lib/priceListKinds'

export type PreviewCounts = {
  incoming: number
  isNew: number
  priceChanged: number
  otherChanged: number
  same: number
  kept: number
  current: number
}

export type PreviewChange = {
  item_code: string
  variant: string
  old_cost: number | null
  new_cost: number | null
  old_price: number | null
  new_price: number | null
}

export type ServerPreview = { counts: PreviewCounts; changes: PreviewChange[] }

/** 서버 함수가 돌려주는 건수. */
export type ApplyResult = {
  import_id: number
  sheet_name: string
  received: number
  skipped: number
  merged: number
  inserted: number
  updated: number
  unchanged: number
}

export type ImportHistoryRow = {
  import_id: number
  sheet_name: string
  file_name: string
  valid_text: string | null
  inserted_count: number
  updated_count: number
  unchanged_count: number
  skipped_count: number
  applied_by: number | null
  applied_at: string
  applied_name: string
}

/**
 * 요청 본문 상한. Vercel 은 약 4.5MB 까지 받는다.
 * 한 줄이 JSON 으로 200바이트 안쪽이라 1,000줄이면 200KB 정도다(가장 큰 시트도 1,000줄 안팎).
 * 그래도 사고(여러 시트를 한 배열로 붙여 보내는 등)를 대비해 **보내기 전에** 크기를 잰다.
 */
export const BODY_BYTE_MAX = 3_500_000

export type ReadResult = {
  parse: ParseResult | null
  /** 시트 고르기 안내(이름이 달랐다·하나뿐이었다). 오류가 아니다. */
  sheetNote: string
  /** 파일을 아예 읽지 못했거나 시트를 못 찾은 경우. */
  error: string
  /** 보낼 본문의 바이트 수(미리보기에 숫자로 보여 준다). */
  bytes: number
}

/** 엑셀 한 개를 읽어 고른 종류의 시트를 파싱한다. */
export async function readPriceWorkbook(file: File, kind: PriceListKind): Promise<ReadResult> {
  const empty: ReadResult = { parse: null, sheetNote: '', error: '', bytes: 0 }
  let XLSX: typeof import('xlsx')
  try {
    XLSX = await import('xlsx')
  } catch {
    return { ...empty, error: '엑셀을 읽는 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.' }
  }

  let wb: import('xlsx').WorkBook
  try {
    const buf = await file.arrayBuffer()
    wb = XLSX.read(buf, { type: 'array' })
  } catch (e) {
    console.error('[priceListImport] 엑셀 읽기 실패', e)
    return { ...empty, error: '엑셀 파일을 읽지 못했습니다. .xlsx 파일인지 확인해 주세요.' }
  }
  if (wb.SheetNames.length === 0) return { ...empty, error: '시트가 없는 파일입니다.' }

  const picked = pickSheetName(wb.SheetNames, kind)
  if (!picked.name) return { ...empty, error: picked.error }

  // 시트 → 2차원 배열. **시험 스크립트와 같은 옵션**이다(읽는 길이 갈리면 시험이 뜻을 잃는다).
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[picked.name], {
    header: 1, defval: null, blankrows: true,
  })
  const parse = parsePriceSheet(rows, kind, picked.name)
  const bytes = new TextEncoder().encode(JSON.stringify(parse.rows)).length
  if (bytes > BODY_BYTE_MAX) {
    parse.errors.push(
      `보낼 내용이 너무 큽니다(${Math.round(bytes / 1024).toLocaleString('ko-KR')}KB). `
      + '시트를 나눠서 올려 주세요.',
    )
  }
  return { parse, sheetNote: picked.note, error: '', bytes }
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function callApi<T>(body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch('/api/price-list-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json?.error || '요청이 실패했습니다.' }
    return { ok: true, data: json as T }
  } catch (e) {
    console.error('[priceListImport] 요청 실패', e)
    return { ok: false, error: '서버에 연결하지 못했습니다.' }
  }
}

/** 미리보기 — DB 와 비교한 건수를 받는다(읽기만 한다). */
export const requestPreview = (sheetName: string, rows: unknown[]) =>
  callApi<{ counts: PreviewCounts; changes: PreviewChange[] }>({ action: 'preview', sheet_name: sheetName, rows })

/** 적용 — 서버가 RPC 를 한 번 부른다(한 트랜잭션). */
export const requestApply = (
  sheetName: string, fileName: string, validText: string | null, rows: unknown[],
) => callApi<{ result: ApplyResult }>({
  action: 'apply', sheet_name: sheetName, file_name: fileName, valid_text: validText, rows,
})

/**
 * 최근 등록 이력. 읽기는 **세션 클라이언트**로 한다 —
 * price_list_imports 의 select 정책이 superadmin 만 허용하므로 권한은 DB 가 본다.
 */
export async function loadImportHistory(
  supabase: SupabaseClient, limit = 20,
): Promise<ImportHistoryRow[]> {
  const { data, error } = await supabase
    .from('price_list_imports')
    .select('import_id, sheet_name, file_name, valid_text, inserted_count, updated_count, unchanged_count, skipped_count, applied_by, applied_at')
    .order('applied_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[priceListImport] 이력 조회 실패', error)
    return []
  }
  const rows = (data ?? []) as Omit<ImportHistoryRow, 'applied_name'>[]

  // 적용자 이름은 따로 읽는다 — 관계 임베드 이름에 기대지 않는다(어긋나면 이력이 통째로 빈다).
  const ids = Array.from(new Set(rows.map(r => r.applied_by).filter((v): v is number => v != null)))
  const names = new Map<number, string>()
  if (ids.length > 0) {
    const { data: people } = await supabase
      .from('engineers')
      .select('engineer_id, name, position')
      .in('engineer_id', ids)
    for (const p of (people ?? []) as { engineer_id: number; name: string; position: string | null }[]) {
      names.set(p.engineer_id, [p.name, p.position].filter(Boolean).join(' '))
    }
  }
  return rows.map(r => ({
    ...r,
    applied_name: r.applied_by != null ? (names.get(r.applied_by) ?? `#${r.applied_by}`) : '알 수 없음',
  }))
}
