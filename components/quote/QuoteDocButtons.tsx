'use client'

// 견적 목록 행의 **문서 단추 둘** — 거래명세서 · 수리내역서.
//
// 누르면 그 자리에서 만들어 올리고 **새 탭으로 연다**(lib/quoteDocGenerate.ts).
// 다시 누르면 같은 이름으로 덮어쓴다 — 문서번호가 견적번호에서 나오므로 한 견적에
// 거래명세서는 늘 하나다.
//
// ── 어느 행에 나오나 ────────────────────────────────────────────────────────
//   거래명세서  **모든 견적**(수리 건이 아니어도 낸다 — 그때는 품명에 S/N 이 빠진다)
//   수리내역서  수리 건이 걸린 견적만
//
// 새 탭은 **누른 직후** 빈 창으로 열어 둔다. 만드는 데 몇 초가 걸리는데 그 뒤에 열면
// 브라우저가 팝업으로 보고 막는다(사용자 제스처에서 멀어진다).

import { useState } from 'react'
import { DOC_LABEL, type QuoteDocKind } from '@/lib/quoteDocs'
import { generateQuoteDoc } from '@/lib/quoteDocGenerate'

export type QuoteDocButtonsProps = {
  quoteId: number
  /** 수리 건이 걸린 견적인가 — 수리내역서는 그때만 낸다. */
  isRepair: boolean
  /** 확정된 견적인가. 아니면 두 단추 다 잠근다. */
  enabled: boolean
  toast: { success: (m: string) => void; error: (m: string) => void }
}

const base: React.CSSProperties = {
  padding: '3px 7px', background: '#fff', border: '1px solid #ebebeb', borderRadius: 6,
  fontSize: 10, fontWeight: 700, color: '#234ea2', whiteSpace: 'nowrap',
}

export default function QuoteDocButtons({ quoteId, isRepair, enabled, toast }: QuoteDocButtonsProps) {
  const [busy, setBusy] = useState<QuoteDocKind | null>(null)

  const run = async (kind: QuoteDocKind) => {
    if (busy || !enabled) return
    const tab = window.open('', '_blank')
    setBusy(kind)
    try {
      const r = await generateQuoteDoc(quoteId, kind)
      if (!r.ok) {
        tab?.close()
        toast.error(r.error)
        return
      }
      toast.success(`${DOC_LABEL[kind]} ${r.name} 을 만들었습니다`)
      if (tab) tab.location.href = r.url
      else window.open(r.url, '_blank')
    } finally {
      setBusy(null)
    }
  }

  const btn = (kind: QuoteDocKind) => (
    <button
      key={kind}
      onClick={() => void run(kind)}
      disabled={!enabled || busy !== null}
      title={enabled ? `${DOC_LABEL[kind]}를 만들어 새 탭으로 엽니다` : '확정된 견적만 문서를 낼 수 있습니다'}
      style={{
        ...base,
        color: !enabled || busy !== null ? '#9ca3af' : '#234ea2',
        cursor: !enabled || busy !== null ? 'not-allowed' : 'pointer',
      }}
    >
      {busy === kind ? '만드는 중…' : DOC_LABEL[kind]}
    </button>
  )

  return <>{btn('transaction')}{isRepair ? btn('repair') : null}</>
}
