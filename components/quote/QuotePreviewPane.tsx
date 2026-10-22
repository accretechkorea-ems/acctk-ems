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
//
// **그림 부분만 따로 불러온다**(QuotePreviewCanvas). PDF 엔진이 1.4MB 라 정적으로 묶으면
// 머리줄·버튼을 그리기 전에 그것까지 내려받아야 했다. 지금은 화면이 먼저 뜨고, 미리보기 칸에는
// 「PDF 준비 중…」이 한 번 지나간다.

import dynamic from 'next/dynamic'
import type { QuoteRow } from '@/app/quote/types'
import type { Terms } from '@/lib/quoteTerms'
import type { OnBehalfAssignee } from '@/lib/quoteMutations'
import { NO_INITIALS_MESSAGE } from '@/hooks/quote/useQuoteSubmit'
import type { useToast } from '@/components/common/Toast'

/** PDF 엔진(약 1.4MB)은 이 칸을 그릴 때 받아 온다 — /quote 첫 로드에 얹지 않는다. */
const QuotePreviewCanvas = dynamic(() => import('./QuotePreviewCanvas'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#9ca3af' }}>
      PDF 준비 중...
    </div>
  ),
})

export type QuotePreviewPaneProps = {
  isClient: boolean
  missingInitials: boolean
  seqLoadError: string | null
  quoteNo: string
  /** 견적 날짜 'YYYY-MM-DD'(한국). 번호·작성일이 이 날짜를 따른다. */
  quoteDate: string
  /** 날짜 칸을 고쳤을 때. 미래·망가진 값은 화면이 오늘로 떨어뜨린다. */
  onQuoteDate: (v: string) => void
  /** 달력에서 고를 수 있는 마지막 날 — 오늘(한국)이다. */
  maxQuoteDate: string
  /** 지난 날짜로 쓰고 있는가. */
  backdated: boolean
  /** 실적이 잡히는 달이 이번 달과 다르면 그 달(1~12), 같으면 0. */
  otherMonth: number
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
  /** 고른 견적서 양식. 미리보기도 확정 PDF 와 같은 뼈대로 그린다. */
  formKind: string
  debouncedCompany: string
  debouncedReceiver: string
  debouncedRows: QuoteRow[]
  debouncedFinalRemarks: string
  pdfTotalSupply: number
  pdfTotalTax: number
  pdfTotalAmount: number
}

export default function QuotePreviewPane({
  isClient, missingInitials, seqLoadError, quoteNo,
  quoteDate, onQuoteDate, maxQuoteDate, backdated, otherMonth, onBehalf, isSaving,
  toast, runValidation, setShowConfirmModal, categoryMissing,
  dateDisplay, engineerName, engineerTel, showSignature, previewTerms, formKind,
  debouncedCompany, debouncedReceiver, debouncedRows, debouncedFinalRemarks,
  pdfTotalSupply, pdfTotalTax, pdfTotalAmount,
}: QuotePreviewPaneProps) {
  // PDF 미리보기 — 480px 밑으로 눌리면 글자가 읽히지 않아 그 전에 아래로 내려간다
  return (
<div style={{ flex: '1 1 480px', minWidth: 0 }}>
  <div style={{ background: '#f3f4f6', borderRadius: 8, overflow: 'hidden', border: '1px solid #ebebeb', height: 'calc(100vh - 40px)', position: 'sticky', top: 20, display: 'flex', flexDirection: 'column' }}>

    {/* 헤더 */}
    <div style={{ background: '#234ea2', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
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

      {/* 견적 날짜 — 기본은 오늘이고 **지난 날짜로도 쓸 수 있다**(달력의 max 가 오늘이다).
          날짜를 바꾸면 예상 번호가 그 날짜 기준으로 다시 뜬다(그날의 다음 순번).
          확정 뒤에는 번호에 날짜가 박히므로 고칠 수 없다 — 그래서 이 칸은 작성 화면에만 있다. */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 500, marginBottom: 2 }}>견적 날짜</div>
        <input
          type="date"
          value={quoteDate}
          max={maxQuoteDate}
          onChange={e => onQuoteDate(e.target.value)}
          aria-label="견적 날짜"
          style={{
            padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.5)',
            color: '#ffffff', colorScheme: 'dark', cursor: 'pointer',
          }}
        />
        {backdated && (
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
            지난 날짜로 작성
            {otherMonth > 0 && (
              <span style={{ display: 'block', fontWeight: 500 }}>{otherMonth}월 실적에 들어갑니다</span>
            )}
          </div>
        )}
      </div>
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
        <QuotePreviewCanvas
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
          showSignature={showSignature}
          terms={previewTerms}
          formKind={formKind}
        />
      </div>
    )}
  </div>
</div>
  )
}
