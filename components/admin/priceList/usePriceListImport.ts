'use client'

// 가격표 등록 모달의 상태 — 종류 고르기 → 파일 읽기 → 미리보기 → 적용 → 결과.
//
// 단계를 따로 두지 않고 **가진 값으로 단계를 판정한다**(kind 없으면 1단계, parse 없으면 2단계…).
// 단계 변수를 따로 들면 값과 단계가 어긋나는 순간이 생긴다.

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ParseResult } from '@/lib/priceListParse'
import type { PriceListKind } from '@/lib/priceListKinds'
import {
  loadImportHistory, readPriceWorkbook, requestApply, requestPreview,
} from './priceListImport'
import type { ApplyResult, ImportHistoryRow, PreviewChange, PreviewCounts } from './priceListImport'

export function usePriceListImport() {
  const [supabase] = useState(() => createClient())

  const [kind, setKind] = useState<PriceListKind | null>(null)
  const [fileName, setFileName] = useState('')
  const [parse, setParse] = useState<ParseResult | null>(null)
  const [sheetNote, setSheetNote] = useState('')
  const [bytes, setBytes] = useState(0)

  const [counts, setCounts] = useState<PreviewCounts | null>(null)
  const [changes, setChanges] = useState<PreviewChange[]>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ApplyResult | null>(null)

  const [history, setHistory] = useState<ImportHistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  const reloadHistory = useCallback(async () => {
    setHistoryLoading(true)
    const rows = await loadImportHistory(supabase)
    setHistory(rows)
    setHistoryLoading(false)
  }, [supabase])

  useEffect(() => {
    let cancelled = false
    loadImportHistory(supabase).then(rows => {
      if (cancelled) return
      setHistory(rows)
      setHistoryLoading(false)
    })
    return () => { cancelled = true }
  }, [supabase])

  /** 고른 파일을 지운다(종류를 바꿀 때도 지운다 — 다른 종류의 미리보기가 남으면 안 된다). */
  const clearFile = useCallback(() => {
    setFileName('')
    setParse(null)
    setSheetNote('')
    setBytes(0)
    setCounts(null)
    setChanges([])
    setResult(null)
    setError('')
  }, [])

  const chooseKind = useCallback((next: PriceListKind | null) => {
    setKind(next)
    clearFile()
  }, [clearFile])

  /**
   * 파일 하나를 읽고 바로 미리보기까지 간다.
   * 파싱에서 오류가 났으면 서버를 부르지 않는다 — 보낼 수 없는 내용이다.
   */
  const chooseFile = useCallback(async (file: File) => {
    if (!kind) return
    clearFile()
    setFileName(file.name)
    setBusy(true)

    const read = await readPriceWorkbook(file, kind)
    setSheetNote(read.sheetNote)
    setBytes(read.bytes)
    if (read.error || !read.parse) {
      setError(read.error || '파일을 읽지 못했습니다.')
      setBusy(false)
      return
    }
    setParse(read.parse)
    if (read.parse.errors.length > 0 || read.parse.rows.length === 0) {
      setBusy(false)
      return
    }

    const res = await requestPreview(kind.sheet, read.parse.rows)
    if (!res.ok) setError(res.error)
    else {
      setCounts(res.data.counts)
      setChanges(res.data.changes)
    }
    setBusy(false)
  }, [kind, clearFile])

  /** 적용 — 성공하면 결과를 남기고 이력을 다시 읽는다. */
  const apply = useCallback(async (): Promise<string> => {
    if (!kind || !parse || parse.rows.length === 0) return '등록할 내용이 없습니다.'
    setBusy(true)
    setError('')
    const res = await requestApply(kind.sheet, fileName, parse.validText, parse.rows)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return res.error
    }
    setResult(res.data.result)
    await reloadHistory()
    return ''
  }, [kind, parse, fileName, reloadHistory])

  /**
   * 머리글을 아예 찾지 못했는가(headerRow 0). 그때는 머리글 규칙 안내를 펼쳐 보여 준다 —
   * 사람이 할 수 있는 일이 「엑셀 머리글 고치기」뿐이라서다.
   */
  const headerFailed = parse !== null && parse.headerRow === 0

  /** 적용을 막는 이유(없으면 빈 문자열). 경고는 막지 않는다. */
  const blockReason = (() => {
    if (!kind) return '종류를 먼저 고르세요.'
    if (!parse) return '엑셀 파일을 고르세요.'
    if (parse.errors.length > 0) return parse.errors[0]
    if (parse.rows.length === 0) return '등록 대상이 0건입니다.'
    if (error) return error
    if (!counts) return '미리보기를 기다리는 중입니다.'
    return ''
  })()

  return {
    kind, chooseKind,
    fileName, parse, sheetNote, bytes, clearFile, chooseFile, headerFailed,
    counts, changes,
    busy, error, result, apply, blockReason,
    history, historyLoading,
  }
}

export type PriceListImportCtx = ReturnType<typeof usePriceListImport>
