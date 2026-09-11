'use client'

import { useState, type CSSProperties } from 'react'
import { useToast } from '@/components/common/Toast'
import { fetchLeadsForExcel, buildLeadSheet } from '@/lib/leadExcel'
import { todayKST } from '@/lib/date'

/**
 * 선택한 리드들을 「리드 목록」 엑셀로 내보내는 버튼.
 * exceljs 는 클릭 시점에 동적 import 한다(초기 번들에 포함되지 않도록) — 견적 엑셀 버튼과 같은 방식이다.
 *
 * 권한 가드는 두지 않는다. leads 는 RLS 가 「superadmin 또는 본인 담당」만 내려주므로
 * 화면에 보이는 것이 곧 내보낼 수 있는 범위다. 다운로드 이력은 남기지 않는다
 * (download_logs 는 quote_id·quote_number 고정 스키마라 리드에 맞지 않는다).
 */
type Props = {
  leadIds: number[]
  /** id → '이름 직급'. 배정자·담당자가 leads 에는 id 로만 있어 화면의 함수를 받는다. */
  engName: (id: number | null) => string
  style?: CSSProperties
  onDone?: () => void   // 성공 후 선택 해제 등
}

// PDF·견적 엑셀과 동일한 금칙문자 처리
const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '')

export default function LeadExcelButton({ leadIds, engName, style, onDone }: Props) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const disabled = loading || leadIds.length === 0

  const handleExport = async () => {
    if (disabled) return
    setLoading(true)
    try {
      const [{ default: ExcelJS }, leads] = await Promise.all([
        import('exceljs'),
        fetchLeadsForExcel(leadIds),
      ])
      if (leads.length === 0) {
        toast.error('내보낼 리드를 불러오지 못했습니다')
        return
      }

      const wb = new ExcelJS.Workbook()
      buildLeadSheet(wb, leads, engName)

      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

      const ymd = todayKST().replace(/-/g, '')
      const fileName = safeFileName(
        leads.length === 1
          ? `${leads[0].lead_no ?? `리드_${leads[0].lead_id}`}.xlsx`
          : `리드_목록_${ymd}_${leads.length}건.xlsx`
      )

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)

      toast.success(`엑셀 ${leads.length}건을 내보냈습니다`)
      onDone?.()
    } catch (e) {
      console.error(e)
      toast.error('엑셀 내보내기에 실패했습니다')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button onClick={handleExport} disabled={disabled} style={{ ...style, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      {loading ? '내보내는 중...' : `엑셀 (${leadIds.length})`}
    </button>
  )
}
