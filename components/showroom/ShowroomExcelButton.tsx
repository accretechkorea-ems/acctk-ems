'use client'

import { useState } from 'react'
import { useToast } from '@/components/common/Toast'
import { btnGhost } from '@/components/common/ui'
import { todayKST } from '@/lib/date'
import type { ShowroomUsageRow } from '@/lib/showroom'
import {
  fetchStatsForExcel, buildStatusSheet, buildUsageSheet, ShowroomStatsError, type UsageSheetContext,
} from '@/lib/showroomExcel'

/**
 * 전체기록 탭의 [엑셀] — 「월간현황」·「사용기록」 두 시트를 한 파일로 내보낸다.
 * exceljs 는 클릭 시점에 동적 import 한다(초기 번들에 넣지 않는다) — 견적·리드 엑셀 버튼과 같은 방식이다.
 *
 * 사용기록은 화면이 필터로 걸러 둔 행 전체(쪽 나눔 무시)를 받는다. 월간현황은 같은 기간을 사무실 「전체」로
 * stats 라우트에서 새로 받는다. 다운로드 이력은 남기지 않는다(download_logs 는 견적 고정 스키마다).
 */
type Props = {
  from: string
  to: string
  /** 필터에 걸린 사용 기록 전체 */
  rows: ShowroomUsageRow[]
  ctx: UsageSheetContext
  /** 목록을 불러오는 중이면 누르지 못하게 한다 — 이전 기간의 행이 섞여 나가지 않도록 */
  disabled?: boolean
}

export default function ShowroomExcelButton({ from, to, rows, ctx, disabled = false }: Props) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const off = disabled || busy

  const handleExport = async () => {
    if (off) return
    setBusy(true)
    try {
      const [{ default: ExcelJS }, stats] = await Promise.all([
        import('exceljs'),
        fetchStatsForExcel(from, to),
      ])

      const wb = new ExcelJS.Workbook()
      buildStatusSheet(wb, stats)
      buildUsageSheet(wb, rows, ctx)

      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `쇼룸_장비운영_${todayKST().replace(/-/g, '')}.xlsx`
      a.click()
      URL.revokeObjectURL(url)

      toast.success(`엑셀을 내보냈습니다 (사용 기록 ${rows.length}건)`)
    } catch (e) {
      console.error('[showroom] excel export failed', e)
      toast.error(e instanceof ShowroomStatsError ? e.message : '엑셀 내보내기에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button onClick={handleExport} disabled={off} aria-busy={busy} style={btnGhost(off)}>
      {busy ? '생성 중...' : '엑셀'}
    </button>
  )
}
