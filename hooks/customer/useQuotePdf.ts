'use client'

// 견적 PDF 열기. 실적 현황·내 견적과 같은 방식이다.
//   저장값이 예전 synology 전체 URL 이면 그대로 열고,
//   그 외에는 quote-pdfs 버킷 경로만 뽑아 /api/quote-pdf 로 서명 URL 을 받아 연다.
// 여는 데 성공하면 download_logs 에 조회 기록을 남긴다.

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import type { Customer, Quote } from '@/components/customer/types'

type Args = {
  customer: Customer | null
  engineerId: number | null
}

export function useQuotePdf({ customer, engineerId }: Args) {
  const supabase = createClient()
  const toast = useToast()
  // 여는 중인 견적 id. 서명 URL 왕복이 0.5초 안팎이라 그동안 아무 반응이 없으면 다시 누르게 된다.
  // 0 은 pdf_url 만 있고 id 를 모르는 호출(openQuotePdfByUrl)의 표식이다.
  const [pdfBusyId, setPdfBusyId] = useState<number | null>(null)
  const busyRef = useRef(false)

  const openQuotePdf = async (q: Quote) => {
    // state 는 다음 렌더에야 반영돼 같은 틱의 연타를 못 막는다 — 판정은 ref 로 한다.
    if (busyRef.current) return
    if (!q.pdf_url) { toast.error('저장된 견적서 PDF가 없습니다'); return }
    if (q.pdf_url.includes('synology')) { window.open(q.pdf_url, '_blank'); return }
    const path = q.pdf_url.startsWith('quote-pdfs/') ? q.pdf_url.replace('quote-pdfs/', '') : q.pdf_url.split('/quote-pdfs/')[1]
    if (!path) { toast.error('견적서 PDF 경로를 확인할 수 없습니다'); return }
    busyRef.current = true
    setPdfBusyId(q.quote_id)
    try {
      const res = await fetch(`/api/quote-pdf?path=${encodeURIComponent(path)}`)
      const json = await res.json()
      if (!json.signedUrl) { toast.error(json.error || '견적서를 열 수 없습니다'); return }
      window.open(json.signedUrl, '_blank')
      await supabase.from('download_logs').insert({
        engineer_id: engineerId,
        quote_id: q.quote_id,
        quote_number: q.quote_number,
        company_name: customer?.company_name ?? null,
        action: 'view',
      })
    } finally {
      // 실패해도 버튼은 반드시 원래대로 돌아와야 한다.
      busyRef.current = false
      setPdfBusyId(null)
    }
  }

  // 영업기회 모달처럼 Quote 전체가 아니라 pdf_url·견적번호만 있는 경우
  const openQuotePdfByUrl = (pdfUrl: string | null | undefined, quoteNumber: string) =>
    openQuotePdf({ pdf_url: pdfUrl ?? null, quote_number: quoteNumber, quote_id: 0 } as Quote)

  return { openQuotePdf, openQuotePdfByUrl, pdfBusyId }
}
