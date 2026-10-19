'use client'

// 견적 작성 화면 오른쪽의 **PDF 미리보기 칸** — 파란 머리줄(예상 견적번호·대필 배지·확정 버튼)과
// BlobProvider 로 그리는 미리보기 iframe.
//
// app/quote/page.tsx 에서 **그대로 옮겨 온 것**이다(분리 리팩터 3a). JSX·스타일·문구·주석을
// 한 글자도 바꾸지 않았다(들여쓰기 8칸만 덜어냈다).
//
// 미리보기는 **600ms 디바운스된 값**을 쓴다(깜빡임 방지) — 그 값은 화면이 만들어 넘겨 준다.
// 합계도 디바운스된 rows 로 계산한 값을 그대로 받는다(여기서 다시 계산하지 않는다).
//
// 확정 버튼은 번호를 발급하지 않는다 — 검증만 하고 확정 모달을 연다. 이니셜이 없으면 그 자리에서
// 안내하고 멈춘다(번호를 만들 수 없기 때문이다).

import { BlobProvider } from '@react-pdf/renderer'
import { QuotePDFDoc } from '@/app/quote/QuotePDFDoc'
import type { QuoteRow } from '@/app/quote/types'
import type { Terms } from '@/lib/quoteTerms'
import type { OnBehalfAssignee } from '@/lib/quoteMutations'
import { NO_INITIALS_MESSAGE } from '@/hooks/quote/useQuoteSubmit'
import type { useToast } from '@/components/common/Toast'

export type QuotePreviewPaneProps = {
  isClient: boolean
  missingInitials: boolean
  seqLoadError: string | null
  quoteNo: string
  onBehalf: OnBehalfAssignee | null
  isSaving: boolean
  toast: ReturnType<typeof useToast>
  runValidation: () => boolean
  setShowConfirmModal: (v: boolean) => void
  /** 견적 분류·양식을 아직 안 골랐는가. true 면 확정 버튼을 잠그고 이유를 보여 준다. */
  categoryMissing: boolean
  dateDisplay: string
  engineerName: string
  engineerTel: string
  showSignature: boolean
  previewTerms: Terms
  debouncedCompany: string
  debouncedReceiver: string
  debouncedRows: QuoteRow[]
  debouncedFinalRemarks: string
  pdfTotalSupply: number
  pdfTotalTax: number
  pdfTotalAmount: number
}

export default function QuotePreviewPane({
  isClient, missingInitials, seqLoadError, quoteNo, onBehalf, isSaving,
  toast, runValidation, setShowConfirmModal, categoryMissing,
  dateDisplay, engineerName, engineerTel, showSignature, previewTerms,
  debouncedCompany, debouncedReceiver, debouncedRows, debouncedFinalRemarks,
  pdfTotalSupply, pdfTotalTax, pdfTotalAmount,
}: QuotePreviewPaneProps) {
  // PDF 미리보기 — 480px 밑으로 눌리면 글자가 읽히지 않아 그 전에 아래로 내려간다
  return (
<div style={{ flex: '1 1 480px', minWidth: 0 }}>
  <div style={{ background: '#f3f4f6', borderRadius: 8, overflow: 'hidden', border: '1px solid #ebebeb', height: 'calc(100vh - 40px)', position: 'sticky', top: 20, display: 'flex', flexDirection: 'column' }}>

    {/* 헤더 */}
    <div style={{ background: '#234ea2', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 500, marginBottom: 2 }}>예상 견적 번호</div>
        {/* 조회가 실패했으면 번호 대신 그 사실을 낸다 — 잘못된 번호를 그럴듯하게 보여주지 않는다.
            파란 헤더 위라 붉은 글씨는 읽히지 않으므로, 흰 글씨에 반투명 테두리로 구분한다(기존 대필 배지와 같은 방식). */}
        {missingInitials || seqLoadError ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.5)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ fontSize: 12, color: '#ffffff', fontWeight: 700 }}>
              {missingInitials ? '이니셜 미등록 — 견적번호를 만들 수 없습니다' : `예상 번호 조회 실패 (${seqLoadError}) — 번호는 확정할 때 발급됩니다`}
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 14, color: '#ffffff', fontWeight: 600 }}>{quoteNo}</div>
        )}
      </div>
      {/* 대필 중임을 작성하는 내내 보이게 둔다 — 남의 실적으로 저장되는 화면이라 헷갈리면 안 된다. */}
      {onBehalf && (
        <span style={{ padding: '4px 10px', borderRadius: 99, background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.5)', color: '#ffffff', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {`${onBehalf.name} ${onBehalf.position || ''}`.trim()} 대신 작성 중
        </span>
      )}
      {/* 견적 분류·양식을 안 골랐으면 확정을 **막고 그 자리에서 이유를 알린다.**
          품목 입력은 막지 않는다 — 금액을 먼저 잡아 보는 흐름을 끊지 않으려고 여기 한 곳에서만 막는다. */}
      {categoryMissing && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.5)', color: '#ffffff', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          견적 분류·양식을 먼저 선택해주세요
        </span>
      )}
      {/* 번호는 확정할 때 DB 가 발급하므로, 예상 번호를 못 읽었다고 확정을 막지 않는다.
          이니셜이 없으면 번호를 만들 수 없어 누르는 즉시 안내하고 멈춘다. */}
      {(() => {
        const locked = isSaving || categoryMissing
        return (
          <button
            onClick={() => {
              if (missingInitials) { toast.error(NO_INITIALS_MESSAGE); return }
              if (!runValidation()) return
              setShowConfirmModal(true)
            }}
            disabled={locked}
            title={categoryMissing ? '견적 분류·양식을 먼저 선택해주세요' : undefined}
            style={{
              padding: '6px 14px', boxSizing: 'border-box',
              background: locked ? 'transparent' : '#ffffff',
              color: locked ? '#ffffff' : '#234ea2',
              border: locked ? '1px solid #ffffff' : 'none',
              borderRadius: 6, fontWeight: 600, fontSize: 13,
              cursor: locked ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={e => { if (!locked) (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}
            onMouseLeave={e => { if (!locked) (e.currentTarget as HTMLButtonElement).style.background = '#ffffff' }}>
            {isSaving ? '저장 중...' : '견적 확정'}
          </button>
        )
      })()}
    </div>

    {/* PDF — debounced 값 사용으로 깜빡임 방지 */}
    {isClient && (
      <div style={{ flex: 1, minWidth: 0, padding: 0, overflow: 'hidden' }}>
        <BlobProvider document={
          <QuotePDFDoc
            company={debouncedCompany}
            receiver={debouncedReceiver}
            quoteNo={quoteNo}
            dateDisplay={dateDisplay}
            rows={debouncedRows}
            remarks={debouncedFinalRemarks}
            engineerName={engineerName}
            engineerTel={engineerTel}
            totalSupply={pdfTotalSupply}
            totalTax={pdfTotalTax}
            totalAmount={pdfTotalAmount}
            showWatermark={true}
            showSignature={showSignature}
            terms={previewTerms}
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
      </div>
    )}
  </div>
</div>
  )
}
