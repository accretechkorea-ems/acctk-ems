'use client'

// 가격표 등록 모달의 상태 — 80/20 고르기 → 파일 읽기 → 시트별 미리보기 → 시트 순회 등록.
//
// 단계를 따로 두지 않고 **가진 값으로 단계를 판정한다**(line 없으면 1단계, sheets 없으면 2단계…).
// 단계 변수를 따로 들면 값과 단계가 어긋나는 순간이 생긴다.

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PriceLine } from '@/lib/priceListKinds'
import { loadImportHistory, loadLatestFiles, readWorkbook, requestApply } from './priceListImport'
import type { ApplyResult, ImportHistoryRow, LatestFile, SheetPlan } from './priceListImport'

/** 시트 하나의 등록 결과. 실패해도 줄로 남는다 — 무엇이 들어가고 무엇이 안 들어갔는지 봐야 한다. */
export type SheetOutcome = {
  sheetName: string
  ok: boolean
  result: ApplyResult | null
  error: string
}

export function usePriceListImport() {
  const [supabase] = useState(() => createClient())

  const [line, setLine] = useState<PriceLine | null>(null)
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [sheets, setSheets] = useState<SheetPlan[]>([])
  const [error, setError] = useState('')

  const [busy, setBusy] = useState(false)
  /** 등록 중 어디까지 왔는가 — 「3/9 CMM Accessory 등록 중…」. */
  const [progress, setProgress] = useState<{ done: number; total: number; sheetName: string } | null>(null)
  const [outcomes, setOutcomes] = useState<SheetOutcome[]>([])

  const [history, setHistory] = useState<ImportHistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  /** 80·20 각각 지금 등록된 파일(이력에서 읽는다). */
  const [latest, setLatest] = useState<Record<PriceLine, LatestFile | null>>({ 80: null, 20: null })

  const reloadHistory = useCallback(async () => {
    setHistoryLoading(true)
    const [rows, files] = await Promise.all([loadImportHistory(supabase), loadLatestFiles(supabase)])
    setHistory(rows)
    setLatest(files)
    setHistoryLoading(false)
  }, [supabase])

  useEffect(() => {
    let cancelled = false
    Promise.all([loadImportHistory(supabase), loadLatestFiles(supabase)]).then(([rows, files]) => {
      if (cancelled) return
      setHistory(rows)
      setLatest(files)
      setHistoryLoading(false)
    })
    return () => { cancelled = true }
  }, [supabase])

  /** 고른 파일을 지운다(80/20 을 바꿀 때도 지운다 — 다른 묶음의 미리보기가 남으면 안 된다). */
  const clearFile = useCallback(() => {
    setFileName('')
    setFileSize(0)
    setSheets([])
    setOutcomes([])
    setProgress(null)
    setError('')
  }, [])

  const chooseLine = useCallback((next: PriceLine | null) => {
    setLine(next)
    clearFile()
  }, [clearFile])

  /** 파일 하나를 읽어 **모든 시트**를 파싱한다. 서버는 부르지 않는다(등록할 때만 부른다). */
  const chooseFile = useCallback(async (file: File) => {
    if (!line) return
    clearFile()
    setFileName(file.name)
    setFileSize(file.size)
    setBusy(true)
    const read = await readWorkbook(file, line)
    if (read.error) setError(read.error)
    else setSheets(read.sheets)
    setBusy(false)
  }, [line, clearFile])

  const planned = sheets.filter(s => s.willImport)

  /**
   * 등록 — 등록 예정 시트를 **순서대로** 돌며 시트마다 서버를 부른다.
   * 한 시트가 실패해도 멈추지 않는다. 시트마다 트랜잭션이 따로라서, 멈추면 이미 들어간 시트와
   * 남은 시트가 섞인 채로 끝난다 — 끝까지 돌고 **무엇이 실패했는지 표로 보여 주는** 쪽이 낫다.
   */
  const apply = useCallback(async (): Promise<SheetOutcome[]> => {
    if (planned.length === 0) return []
    setBusy(true)
    setError('')
    setOutcomes([])

    const done: SheetOutcome[] = []
    for (let i = 0; i < planned.length; i++) {
      const s = planned[i]
      const name = s.parse.sheetName
      setProgress({ done: i, total: planned.length, sheetName: name })
      const res = await requestApply(name, fileName, s.parse.validText, s.parse.rows)
      done.push(res.ok
        ? { sheetName: name, ok: true, result: res.data.result, error: '' }
        : { sheetName: name, ok: false, result: null, error: res.error })
      // 한 시트가 끝날 때마다 표를 채운다 — 긴 파일에서 진행이 보인다.
      setOutcomes([...done])
    }

    setProgress(null)
    setBusy(false)
    await reloadHistory()
    return done
  }, [planned, fileName, reloadHistory])

  /** 등록을 막는 이유(없으면 빈 문자열). 건너뛰는 시트는 막지 않는다. */
  const blockReason = (() => {
    if (!line) return '80 가격표와 20 가격표 중 하나를 고르세요.'
    if (sheets.length === 0) return '엑셀 파일을 고르세요.'
    if (planned.length === 0) return '등록할 시트가 없습니다 — 머리글을 일곱 글자로 맞춰 주세요.'
    return ''
  })()

  /** 미리보기·결과 맨 위에 올리는 합계. */
  const totals = {
    sheets: sheets.length,
    planned: planned.length,
    skipped: sheets.length - planned.length,
    itemRows: planned.reduce((n, s) => n + s.parse.counts.itemRows, 0),
    registered: planned.reduce((n, s) => n + s.parse.counts.registered, 0),
    noCost: planned.reduce((n, s) => n + s.parse.counts.noCost, 0),
    sections: planned.reduce((n, s) => n + s.parse.counts.sections, 0),
  }

  /** 등록을 마친 뒤의 합계(실패한 시트는 0 으로 센다). */
  const resultTotals = outcomes.reduce((acc, o) => ({
    inserted: acc.inserted + (o.result?.inserted ?? 0),
    updated: acc.updated + (o.result?.updated ?? 0),
    unchanged: acc.unchanged + (o.result?.unchanged ?? 0),
    skipped: acc.skipped + (o.result?.skipped ?? 0),
    failed: acc.failed + (o.ok ? 0 : 1),
  }), { inserted: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 })

  return {
    line, chooseLine,
    fileName, fileSize, sheets, planned, clearFile, chooseFile,
    busy, error, progress, outcomes, apply, blockReason, totals, resultTotals,
    history, historyLoading, latest,
  }
}

export type PriceListImportCtx = ReturnType<typeof usePriceListImport>
