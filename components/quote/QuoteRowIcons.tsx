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
//     공구   수리 정보 줄이 있으면 파랑. **누르는 곳이 상태에 따라 갈린다** —
//            아직 안 적었으면 작성 모달, 적어 둔 것이 있으면 **수리내역서 PDF** 가 먼저
//            열린다(그 뷰어의 「정보 수정」이 작성 모달로 보낸다 — lib/repairDocFlow.ts).
//     영수증 거래명세서 PDF 가 **한 번이라도 만들어졌으면** 파랑.
//
// ── 문서는 누를 때마다 다시 그린다 ─────────────────────────────────────────
//   거래명세서·수리내역서는 버킷의 파일을 그대로 열지 않는다. 자료가 그 뒤에 바뀌었으면
//   옛 문서가 열리기 때문이다 — 고객에게 나가는 서류라 그 여지를 두지 않는다. 그리는 데
//   스무 초쯤 걸리므로 그동안 아이콘 자리에 **도는 고리**를 낸다.
//   견적서는 다르다 — 확정 시점의 파일 그대로가 정본이다.

import { useState } from 'react'
import { DOC_LABEL } from '@/lib/quoteDocs'
import { generateQuoteDoc } from '@/lib/quoteDocGenerate'
import { openPdf, shouldUseNewTab } from '@/lib/pdfViewer'
import { REPAIR_INFO_LABEL, type RepairInfoState } from '@/lib/quoteRepairInfo'
import { openRepairDoc } from '@/lib/repairDocFlow'

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
  /** 수리 정보 **작성 모달** 열기. fromDoc 이면 저장 뒤 수리내역서로 돌아간다. */
  onOpenInfo: (fromDoc: boolean) => void
  /** 「+ 견적서」 — 아직 견적이 없는 줄에서만 준다(수리품 목록). 주면 아이콘이 이것 하나다. */
  onCreateQuote?: () => void
  toast: { success: (m: string) => void; error: (m: string) => void }
  /** 거래명세서를 이미 만들었다고 부르는 쪽에 알린다(아이콘 색을 그 자리에서 바꾼다). */
  onTransactionMade?: () => void
}

const btnStyle = (on: boolean, busy: boolean): React.CSSProperties => ({
  width: ICON + 6, height: ICON + 6, padding: 0, background: 'none', border: 'none',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  color: on ? BLUE : DIM, cursor: busy ? 'progress' : 'pointer', flexShrink: 0,
  opacity: 1, transition: 'color 0.15s ease',
})

/**
 * 만드는 중 — 아이콘 자리에서 도는 고리(lucide loader-2).
 * 아이콘을 흐리게만 하면 「눌리지 않는 단추」와 구별되지 않는다. 문서 한 장을 그리는 데
 * 스무 초쯤 걸려서, 뭔가 돌고 있다는 표시가 없으면 한 번 더 누르게 된다.
 */
const Spinner = () => (
  <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ animation: 'qri-spin 0.8s linear infinite' }}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)

export default function QuoteRowIcons({
  quoteId, hasInfo, state, hasTransaction, onOpenQuotePdf, onOpenInfo, toast, onTransactionMade,
  onCreateQuote,
}: QuoteRowIconsProps) {
  const [busy, setBusy] = useState(false)
  const [docBusy, setDocBusy] = useState(false)

  /** 견적이 없는 줄 — 쓰러 가는 「+」 하나만 낸다. */
  if (onCreateQuote) {
    return (
      <button onClick={onCreateQuote} aria-label="견적서 작성" title="견적서 작성" style={btnStyle(true, false)}>
        <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    )
  }

  /**
   * 공구 — 적어 둔 것이 없으면 작성 모달, 있으면 **문서부터**.
   * 적어 둔 건을 다시 볼 때 보고 싶은 것은 완성된 문서다(lib/repairDocFlow.ts 주석).
   */
  const onWrench = async () => {
    if (!hasInfo) { onOpenInfo(false); return }
    if (docBusy) return
    setDocBusy(true)
    try {
      await openRepairDoc({ quoteId, toast, onEdit: () => onOpenInfo(true) })
    } finally {
      setDocBusy(false)
    }
  }

  /** 거래명세서 — **지금 자료로 다시 그려서** 연다(같은 이름의 한 파일을 덮어쓴다). */
  const openTransaction = async () => {
    if (busy) return
    const tab = shouldUseNewTab() ? window.open('', '_blank') : null
    setBusy(true)
    try {
      const r = await generateQuoteDoc(quoteId, 'transaction')
      if (!r.ok) { tab?.close(); toast.error(r.error); return }
      toast.success(`${DOC_LABEL.transaction} ${r.name} 을 만들었습니다`)
      // 처음 만든 줄이면 아이콘 색이 그 자리에서 파랑으로 바뀐다.
      if (!hasTransaction) onTransactionMade?.()
      openPdf({ url: r.url, name: r.name }, tab)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <style>{'@keyframes qri-spin { to { transform: rotate(360deg); } }'}</style>
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

      {/* 수리 정보 — lucide wrench. 이름도 상태에 따라 다르다(누르면 가는 곳이 다르다). */}
      <button onClick={() => void onWrench()}
        aria-label={hasInfo ? '수리내역서 보기' : '수리 정보 작성'}
        title={hasInfo ? `수리내역서 보기 — 수리 정보 ${REPAIR_INFO_LABEL[state]}` : '수리 정보 작성'}
        disabled={docBusy}
        style={btnStyle(hasInfo, docBusy)}>
        {docBusy ? <Spinner /> : (
          <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        )}
      </button>

      {/* 거래명세서 — lucide receipt */}
      <button onClick={() => void openTransaction()}
        aria-label="거래명세서" title={hasTransaction ? '거래명세서 보기' : '거래명세서 만들어 보기'}
        disabled={busy} style={btnStyle(hasTransaction, busy)}>
        {busy ? <Spinner /> : (
          <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" />
            <line x1="8" y1="8" x2="16" y2="8" />
            <line x1="8" y1="12" x2="16" y2="12" />
            <line x1="8" y1="16" x2="13" y2="16" />
          </svg>
        )}
      </button>
    </span>
  )
}
