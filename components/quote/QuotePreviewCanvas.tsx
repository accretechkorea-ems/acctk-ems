'use client'

// 견적서 미리보기의 **그림 부분만** — BlobProvider 로 PDF 를 만들어 iframe 에 띄운다.
//
// 왜 파일을 따로 두는가 — `@react-pdf/renderer` 와 그것을 쓰는 QuotePDFDoc 은 합쳐 약 1.4MB 다.
// 미리보기 칸(QuotePreviewPane)이 그것을 **정적으로** import 하고 있었기 때문에, /quote 를 열면
// 머리줄·버튼을 그리기 전에 PDF 엔진까지 내려받아야 했다(첫 로드 JS 2.4MB 중 1.4MB).
// 여기만 next/dynamic 으로 떼어 두면, 화면은 먼저 뜨고 PDF 엔진은 뒤따라온다.
//
// JSX·props 는 옮겨 온 그대로다 — 미리보기 모양은 바뀌지 않는다.

import { BlobProvider } from '@react-pdf/renderer'
import { QuotePDFDoc } from '@/app/quote/QuotePDFDoc'
import type { QuoteRow } from '@/app/quote/types'
import type { Terms } from '@/lib/quoteTerms'

export type QuotePreviewCanvasProps = {
  company: string
  receiver: string
  quoteNo: string
  dateDisplay: string
  rows: QuoteRow[]
  remarks: string
  engineerName: string
  engineerTel: string
  totalSupply: number
  totalTax: number
  totalAmount: number
  showSignature: boolean
  terms: Terms
  formKind: string
}

export default function QuotePreviewCanvas({
  company, receiver, quoteNo, dateDisplay, rows, remarks,
  engineerName, engineerTel, totalSupply, totalTax, totalAmount,
  showSignature, terms, formKind,
}: QuotePreviewCanvasProps) {
  return (
    <BlobProvider document={
      <QuotePDFDoc
        company={company}
        receiver={receiver}
        quoteNo={quoteNo}
        dateDisplay={dateDisplay}
        rows={rows}
        remarks={remarks}
        engineerName={engineerName}
        engineerTel={engineerTel}
        totalSupply={totalSupply}
        totalTax={totalTax}
        totalAmount={totalAmount}
        showWatermark={true}
        showSignature={showSignature}
        terms={terms}
        formKind={formKind}
      />
    }>
      {({ url }) => url ? (
        <iframe
          title="견적서 미리보기"
          src={`${url}#view=FitH&toolbar=0&navpanes=0&scrollbar=0`}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        />
      ) : null}
    </BlobProvider>
  )
}
