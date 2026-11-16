'use client'

// 견적 한 줄의 **아이콘 셋** — 문서(견적서) · 공구(수리 정보) · 영수증(거래명세서).
//
// 세 목록이 같은 것을 쓴다(수리품 목록 · 내 견적 · 실적 현황). 글자 단추와 상태 뱃지를
// 늘어놓던 자리를 아이콘으로 바꿨다 — 한 행에 들어가는 폭이 정해져 있는데 단추 이름이
// 길어 열이 밀렸다.
//
// ── 색이 내용을 말한다 ─────────────────────────────────────────────────────
//   흐린 회색  아직 아무것도 없다
//   파랑       볼 것이 있다
//     문서   늘 파랑(확정된 견적에는 PDF 가 있다)
//     공구   수리 정보 줄이 있으면 파랑 — 툴팁에 미작성/작성중/완료
//     영수증 거래명세서 PDF 가 버킷에 있으면 파랑. 없으면 눌렀을 때 만들고 연다.

import { useState } from 'react'
import { DOC_LABEL } from '@/lib/quoteDocs'
import { existingQuoteDoc, generateQuoteDoc } from '@/lib/quoteDocGenerate'
import { openPdf, shouldUseNewTab } from '@/lib/pdfViewer'
import { REPAIR_INFO_LABEL, type RepairInfoState } from '@/lib/quoteRepairInfo'

/** 아이콘 한 칸 — lucide 선 아이콘(stroke 2), 20px. */
const ICON = 20
const BLUE = '#234ea2'
/** 내용이 없는 아이콘 — 흐린 회색. */
const DIM = '#c0c4cc'

export type QuoteRowIconsProps = {
  quoteId: number
  /** 수리 정보 줄이 있는가 — 공구 아이콘 색. */
  hasInfo: boolean
  /** 수리 정보 작성 상태 — 공구 툴팁. */
  state: RepairInfoState
  /** 거래명세서 PDF 가 이미 있는가 — 영수증 아이콘 색. */
  hasTransaction: boolean
  /** 견적서 PDF 를 여는 길 — 화면마다 다르다(목록은 경로, 수리 화면은 id). */
  onOpenQuotePdf: () => void
  /** 수리 정보 모달 열기. */
  onOpenInfo: () => void
  toast: { success: (m: string) => void; error: (m: string) => void }
  /** 거래명세서를 이미 만들었다고 부르는 쪽에 알린다(아이콘 색을 그 자리에서 바꾼다). */
  onTransactionMade?: () => void
}

const btnStyle = (on: boolean, busy: boolean): React.CSSProperties => ({
  width: ICON + 6, height: ICON + 6, padding: 0, background: 'none', border: 'none',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  color: on ? BLUE : DIM, cursor: busy ? 'progress' : 'pointer', flexShrink: 0,
  opacity: busy ? 0.5 : 1, transition: 'color 0.15s ease, opacity 0.15s ease',
})

export default function QuoteRowIcons({
  quoteId, hasInfo, state, hasTransaction, onOpenQuotePdf, onOpenInfo, toast, onTransactionMade,
}: QuoteRowIconsProps) {
  const [busy, setBusy] = useState(false)

  /** 거래명세서 — 있으면 열고, 없으면 만들어서 연다(둘 다 같은 이름의 한 파일이다). */
  const openTransaction = async () => {
    if (busy) return
    const tab = shouldUseNewTab() ? window.open('', '_blank') : null
    setBusy(true)
    try {
      // 이미 있으면 **그 파일을 그대로 연다** — 다시 그리는 데 20초가 걸린다.
      const r = hasTransaction
        ? await existingQuoteDoc(quoteId, 'transaction')
        : await generateQuoteDoc(quoteId, 'transaction')
      if (!r.ok) { tab?.close(); toast.error(r.error); return }
      if (!hasTransaction) {
        toast.success(`${DOC_LABEL.transaction} ${r.name} 을 만들었습니다`)
        onTransactionMade?.()
      }
      openPdf({ url: r.url, name: r.name }, tab)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {/* 견적서 — lucide file-text */}
      <button onClick={onOpenQuotePdf} aria-label="견적서 보기" title="견적서 보기" style={btnStyle(true, false)}>
        <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <line x1="10" y1="9" x2="8" y2="9" />
        </svg>
      </button>

      {/* 수리 정보 — lucide wrench */}
      <button onClick={onOpenInfo}
        aria-label={`수리 정보 ${REPAIR_INFO_LABEL[state]}`}
        title={hasInfo ? `수리 정보 — ${REPAIR_INFO_LABEL[state]}` : '수리 정보 — 미작성'}
        style={btnStyle(hasInfo, false)}>
        <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      </button>

      {/* 거래명세서 — lucide receipt */}
      <button onClick={() => void openTransaction()}
        aria-label="거래명세서" title={hasTransaction ? '거래명세서 보기' : '거래명세서 만들어 보기'}
        disabled={busy} style={btnStyle(hasTransaction, busy)}>
        <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" />
          <line x1="8" y1="8" x2="16" y2="8" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="8" y1="16" x2="13" y2="16" />
        </svg>
      </button>
    </span>
  )
}
