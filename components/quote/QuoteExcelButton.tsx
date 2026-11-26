'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { fetchQuotesForExcel, buildQuoteSheet } from '@/lib/quoteExcel'
import { todayKST } from '@/lib/date'
import ExcelIconButton from '@/components/common/ExcelIconButton'

/**
 * 선택한 견적들을 "이익률 분석표" 엑셀로 내보내는 버튼.
 * exceljs 는 클릭 시점에 동적 import 한다(초기 번들에 포함되지 않도록).
 *
 * ⚠ **생김새는 공용 ⬇ 아이콘 하나다** (2026-11-26 묶음2 E).
 *   전에는 화면마다 style 을 밖에서 받아 파란 글자 버튼(「엑셀 내보내기 (3)」)으로 섰다 —
 *   발주·실적 현황·내 견적이 각각 다른 여백·글자 크기였다. 지금은 세 자리가 같은 부품이고,
 *   고른 건수는 **툴팁**이 말한다(「엑셀 내보내기 (3건)」). 크기만 자리에 맞춘다.
 */
type Props = {
  quoteIds: number[]
  engineerId: number | null   // download_logs 기록용
  /** 단추 크기. 줄이 빽빽한 자리는 26, 넉넉한 자리는 28(기본)·30 을 쓴다. */
  size?: number
  onDone?: () => void         // 성공 후 선택 해제 등
}

// PDF 다운로드와 동일한 금칙문자 처리
const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '')

export default function QuoteExcelButton({ quoteIds, engineerId, size, onDone }: Props) {
  const supabase = createClient()
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const disabled = loading || quoteIds.length === 0

  const handleExport = async () => {
    if (disabled) return
    setLoading(true)
    try {
      const [{ default: ExcelJS }, quotes] = await Promise.all([
        import('exceljs'),
        fetchQuotesForExcel(quoteIds),
      ])
      if (quotes.length === 0) {
        toast.error('내보낼 견적을 불러오지 못했습니다')
        return
      }

      const wb = new ExcelJS.Workbook()
      for (const q of quotes) buildQuoteSheet(wb, q)

      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

      const ymd = todayKST().replace(/-/g, '')
      const fileName = safeFileName(
        quotes.length === 1 ? `${quotes[0].quote_number}.xlsx` : `견적_분석표_${ymd}_${quotes.length}건.xlsx`
      )

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)

      // 견적 1건당 1행. 실패해도 다운로드 자체는 이미 끝났으므로 막지 않는다.
      await supabase.from('download_logs').insert(
        quotes.map(q => ({
          engineer_id: engineerId,
          quote_id: q.quote_id,
          quote_number: q.quote_number,
          company_name: q.customers?.company_name ?? null,
          action: 'excel_export',
        }))
      )

      toast.success(`엑셀 ${quotes.length}건을 내보냈습니다`)
      onDone?.()
    } catch (e) {
      console.error(e)
      toast.error('엑셀 내보내기에 실패했습니다')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ExcelIconButton
      onClick={() => void handleExport()}
      disabled={quoteIds.length === 0}
      busy={loading}
      count={quoteIds.length}
      size={size}
    />
  )
}
