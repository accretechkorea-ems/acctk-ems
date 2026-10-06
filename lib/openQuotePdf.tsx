'use client'

// 견적서 PDF 열기 — 화면 쪽 공용 헬퍼.
//
// 길이 둘이고, 게이트가 갈라 준다(lib/approval/quoteApprovalKeys.ts 의 gateOf).
//   exempt   — 결재 도입 전 견적. **저장된 파일**이 정본이다. 지금까지 쓰던 서명 URL 경로를 그대로 쓴다.
//   그 밖     — 결재 대상 견적. 확정 때 만든 파일에는 승인일이 없어 열면 안 된다.
//              저장값을 받아(/api/quote-approval 의 'pdf-data') **그 자리에서 PDF 를 만든다.**
//              결재가 완료된 문서면 날짜 자리에 완료일이, 아니면 빨간 안내가 들어간다.
//
// 세 화면(실적 현황·내 견적·검토표)과 수리 화면이 같은 함수를 쓴다 — 따로 짜면 한쪽만 고쳐진다.
//
// 폰트는 확정 흐름과 같다. app/quote/QuotePDFDoc.tsx 가 공개 경로('/fonts/…')로 등록하므로
// **브라우저에서 만들 때만** 쓸 수 있다(서버 렌더는 파일 경로가 필요하다 — 그 파일 머리말).

import { pdf } from '@react-pdf/renderer'
import { QuotePDFDoc } from '@/app/quote/QuotePDFDoc'
import { buildQuotePdfProps, type PdfItemRow, type PdfQuoteRow } from '@/lib/quotePdfData'
import { createClient } from '@/lib/supabase/client'
import type { QuoteGate } from '@/lib/approval/quoteApprovalKeys'

export type OpenResult = { ok: true } | { ok: false; error: string }

type PdfDataResponse = {
  pdf: {
    quote: PdfQuoteRow
    items: PdfItemRow[]
    company: string | null
    engineerName: string | null
    engineerTel: string | null
    approvedAt: string | null
  }
  meta: {
    quoteId: number
    quoteNumber: string | null
    customerName: string | null
  }
}

/** 파일 이름 — 확정 흐름과 같은 규칙(번호_업체_견적서). 금지 문자를 뺀다. */
const fileNameOf = (quoteNumber: string | null, customer: string | null): string =>
  [quoteNumber, customer, '견적서']
    .filter(Boolean)
    .join('_')
    .replace(/[\\/:*?"<>|]/g, '') + '.pdf'

/**
 * 열람 기록 한 줄 — 기존 방식을 그대로 쓴다(download_logs, action 'view').
 * 실패해도 열기를 막지 않는다. 목록의 PDF 링크가 이미 이렇게 남기고 있다.
 */
async function logView(quoteId: number, quoteNumber: string | null, customer: string | null, engineerId: number | null) {
  try {
    const supabase = createClient()
    const { error } = await supabase.from('download_logs').insert({
      engineer_id: engineerId,
      quote_id: quoteId,
      quote_number: quoteNumber,
      company_name: customer,
      action: 'view',
    })
    if (error) console.error('[quotePdf] 열람 기록 실패', { quoteId, error })
  } catch (e) {
    console.error('[quotePdf] 열람 기록 실패', { quoteId, error: e })
  }
}

/** 저장된 파일을 서명 URL 로 연다 — 결재 도입 전 견적(exempt)의 길. 종전 동작 그대로다. */
async function openStoredPdf(pdfUrl: string): Promise<OpenResult> {
  if (pdfUrl.includes('synology') || pdfUrl.startsWith('http')) {
    window.open(pdfUrl, '_blank')
    return { ok: true }
  }
  const path = pdfUrl.startsWith('quote-pdfs/')
    ? pdfUrl.replace('quote-pdfs/', '')
    : pdfUrl.split('/quote-pdfs/')[1]
  if (!path) return { ok: false, error: '견적서 파일 경로가 올바르지 않습니다' }
  const res = await fetch(`/api/quote-pdf?path=${encodeURIComponent(path)}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.signedUrl) {
    return { ok: false, error: json?.error || '견적서를 열 수 없습니다' }
  }
  window.open(json.signedUrl, '_blank')
  return { ok: true }
}

/**
 * 결재 대상 견적서를 저장값으로 만들어 새 탭에 띄운다.
 *
 * 만든 파일을 스토리지에 올리지 않는다 — 결재가 끝나기 전 문서는 정본이 아니고, 올리면
 * quotes.pdf_url 이 가리키는 「확정 때의 파일」을 덮어쓰게 된다(확정 흐름을 건드리지 않는다).
 */
async function openGeneratedPdf(quoteId: number, engineerId: number | null): Promise<OpenResult> {
  const res = await fetch('/api/quote-approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pdf-data', quote_id: quoteId }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.pdf) {
    return { ok: false, error: json?.error || '견적서를 만들지 못했습니다' }
  }
  const { pdf: data, meta } = json as PdfDataResponse
  const props = buildQuotePdfProps({
    quote: data.quote,
    items: data.items,
    company: data.company,
    engineerName: data.engineerName,
    engineerTel: data.engineerTel,
    approvedAt: data.approvedAt,
  })
  const blob = await pdf(<QuotePDFDoc {...props} />).toBlob()
  const url = URL.createObjectURL(blob)
  // 새 탭으로 연다(내려받기가 아니다 — 결재 전 문서도 볼 수 있어야 하지만 파일로 돌아다니면 안 된다).
  // 탭이 파일을 읽을 틈을 주고 URL 을 거둔다. 파일 이름은 저장 대화상자에서 쓰인다.
  const win = window.open(url, '_blank')
  if (!win) {
    URL.revokeObjectURL(url)
    return { ok: false, error: '팝업이 막혀 있습니다. 이 사이트의 팝업을 허용해 주세요' }
  }
  win.addEventListener('load', () => { try { win.document.title = fileNameOf(meta.quoteNumber, meta.customerName) } catch { /* 무시 */ } })
  setTimeout(() => URL.revokeObjectURL(url), 60_000)

  await logView(quoteId, meta.quoteNumber, meta.customerName, engineerId)
  return { ok: true }
}

export type OpenQuotePdfInput = {
  quoteId: number
  /** 그 견적의 승인 게이트. */
  gate: QuoteGate
  /** 저장된 파일 경로(quotes.pdf_url). exempt 일 때만 쓴다. */
  pdfUrl?: string | null
  /** 열람 기록에 남길 사람. 없으면 null 로 남는다(기존 목록과 같다). */
  engineerId?: number | null
}

/**
 * 게이트에 따라 저장 파일을 열거나 그 자리에서 만들어 연다.
 * 게이트를 아는 화면(실적 현황·내 견적·검토표)이 쓴다.
 */
export async function openQuotePdf(input: OpenQuotePdfInput): Promise<OpenResult> {
  const { quoteId, gate, pdfUrl, engineerId = null } = input
  try {
    if (gate === 'exempt') {
      if (!pdfUrl?.trim()) return { ok: false, error: '견적서 PDF 가 없습니다' }
      return await openStoredPdf(pdfUrl)
    }
    return await openGeneratedPdf(quoteId, engineerId)
  } catch (e) {
    console.error('[quotePdf] 열기 실패', { quoteId, gate, error: e })
    return { ok: false, error: '견적서를 열지 못했습니다' }
  }
}

/**
 * 게이트를 모르는 화면(수리 화면)이 쓴다 — **저장값으로 만들어** 연다.
 *
 * 그 화면은 `/api/repair-quotes?pdf=` 로 저장 파일을 열어 왔고, 결재 대상 견적에서는 그 라우트가
 * 409 + `needsGenerate` 로 「화면에서 만들라」고 돌려준다. 그때 이 함수를 부른다 —
 * 게이트를 따로 읽지 않아 그 화면의 변경이 몇 줄로 끝난다.
 */
export async function openGeneratedQuotePdf(quoteId: number, engineerId: number | null = null): Promise<OpenResult> {
  try {
    return await openGeneratedPdf(quoteId, engineerId)
  } catch (e) {
    console.error('[quotePdf] 생성 열기 실패', { quoteId, error: e })
    return { ok: false, error: '견적서를 열지 못했습니다' }
  }
}
