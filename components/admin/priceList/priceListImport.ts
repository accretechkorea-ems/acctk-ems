'use client'

// 가격표 등록의 **브라우저 쪽 일** — 엑셀 읽기, 시트별 서버 호출, 이력 조회.
//
// ── 파일 하나를 통째로 읽는다 ───────────────────────────────────────────────
//   예전에는 종류(시트)를 먼저 고르고 그 시트 하나만 올렸다. 종류가 열넷으로 늘자
//   고르는 일이 곧 실수였다 — 어느 종류가 어느 시트인지 사람이 기억해야 했다.
//   지금은 **80/20 만 고르고 파일을 통째로** 올린다. 시트 이름은 엑셀이 들고 있다.
//
// 엑셀은 여기서 읽는다(xlsx 는 파일을 고를 때 동적으로 불러온다). 파일 자체는 서버로
// 보내지 않고, 시트마다 DB 에 들어갈 칸만 담은 행 배열을 보낸다.

import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWorkbook } from '@/lib/priceListParse'
import type { ParseResult } from '@/lib/priceListParse'
import { isTwentySheet } from '@/lib/priceListKinds'
import type { PriceLine } from '@/lib/priceListKinds'
import { kstYmd } from '@/lib/date'

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
 * 시트 하나씩 보내므로 가장 큰 시트가 기준이다(실측 최대 1.1MB — SFG Spare part 4,909줄).
 */
export const BODY_BYTE_MAX = 3_500_000

/** 시트 하나의 상태 — 등록할 것인가, 건너뛸 것인가. */
export type SheetPlan = {
  parse: ParseResult
  /** 등록 예정이면 true. */
  willImport: boolean
  /** 건너뛰는 이유(등록 예정이면 빈 글자). */
  skipReason: string
  /** 보낼 본문 크기(바이트). */
  bytes: number
}

export type ReadResult = {
  sheets: SheetPlan[]
  /** 파일을 아예 읽지 못한 경우. */
  error: string
}

/** 왜 건너뛰는가 — 사람이 읽을 한 줄. 머리글이 없는 시트는 오류가 아니라 건너뜀이다. */
function skipReasonOf(parse: ParseResult, bytes: number): string {
  // 머리글을 못 찾았다 = 가격표 시트가 아니다(개정 이력·판촉 시트 등). 흔한 일이다.
  if (parse.headerRow === 0) return '머리글 없음'
  if (parse.counts.registered === 0) return '등록 대상 0건'
  if (bytes > BODY_BYTE_MAX) return `내용이 너무 큼(${Math.round(bytes / 1024).toLocaleString('ko-KR')}KB)`
  return ''
}

/** 엑셀 한 개를 읽어 **모든 시트**를 파싱한다. */
export async function readWorkbook(file: File, line: PriceLine): Promise<ReadResult> {
  let XLSX: typeof import('xlsx')
  try {
    XLSX = await import('xlsx')
  } catch {
    return { sheets: [], error: '엑셀을 읽는 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.' }
  }

  let wb: import('xlsx').WorkBook
  try {
    wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  } catch (e) {
    console.error('[priceListImport] 엑셀 읽기 실패', e)
    return { sheets: [], error: '엑셀 파일을 읽지 못했습니다. .xlsx 파일인지 확인해 주세요.' }
  }
  if (wb.SheetNames.length === 0) return { sheets: [], error: '시트가 없는 파일입니다.' }

  const sheets = parseWorkbook(wb, line).map(parse => {
    const bytes = new TextEncoder().encode(JSON.stringify(parse.rows)).length
    const skipReason = skipReasonOf(parse, bytes)
    return { parse, bytes, skipReason, willImport: skipReason === '' }
  })
  return { sheets, error: '' }
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

/**
 * 시트 하나를 적용한다 — 서버가 RPC 를 한 번 부른다(한 트랜잭션).
 * **시트마다 따로 부른다.** DB 함수가 시트 하나씩만 받고, 그래야 한 시트가 실패해도
 * 다른 시트는 그대로 들어간다.
 */
export const requestApply = (
  sheetName: string, fileName: string, validText: string | null, rows: unknown[],
) => callApi<{ result: ApplyResult }>({
  action: 'apply', sheet_name: sheetName, file_name: fileName, valid_text: validText, rows,
})

/** 그 묶음에서 가장 최근에 올린 파일. */
export type LatestFile = { fileName: string; appliedDate: string }

/**
 * 80·20 **각각** 가장 최근에 올린 파일명과 날짜.
 *
 * 이력 표에는 **line 칸이 없다**(시트 이름만 있다). 그래서 sheet_name 으로 가른다 —
 * lib/priceListKinds.ts 의 목록에 20 으로 적힌 시트면 20, 그 밖은 80 이다.
 * 목록에 없는 시트 이름(처음 보는 시트)은 80 으로 셈한다.
 *
 * 한 번 올리면 시트마다 한 줄씩 남으므로(아홉 시트면 아홉 줄) 최근 200줄을 보고 고른다 —
 * 두 묶음의 최근 등록이 그 안에 들어온다.
 */
export async function loadLatestFiles(
  supabase: SupabaseClient,
): Promise<Record<PriceLine, LatestFile | null>> {
  const out: Record<PriceLine, LatestFile | null> = { 80: null, 20: null }
  const { data, error } = await supabase
    .from('price_list_imports')
    .select('sheet_name, file_name, applied_at')
    .order('applied_at', { ascending: false })
    .limit(200)
  if (error) {
    console.error('[priceListImport] 최근 파일 조회 실패', error)
    return out
  }
  for (const r of (data ?? []) as { sheet_name: string; file_name: string; applied_at: string }[]) {
    const line: PriceLine = isTwentySheet(r.sheet_name) ? '20' : '80'
    // 내림차순이라 **처음 만난 줄**이 그 묶음의 최근 등록이다.
    if (!out[line]) out[line] = { fileName: r.file_name, appliedDate: kstYmd(r.applied_at) }
    if (out['80'] && out['20']) break
  }
  return out
}

/**
 * 최근 등록 이력. 읽기는 **세션 클라이언트**로 한다 —
 * price_list_imports 의 select 정책이 superadmin 만 허용하므로 권한은 DB 가 본다.
 * 시트마다 한 줄씩 남으므로, 파일 한 번 올리면 여러 줄이 생긴다.
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
