'use client'

/**
 * 미수주 견적을 **「견적중」으로 되돌리는 창** (2026-11-25).
 *
 * 되돌리는 **이유가 필수**다 — 발주서 등록을 놓쳐 만료된 건을 되살리는 자리이고,
 * 그 까닭이 남지 않으면 「누가 왜 되살렸나」를 알 수 없다. 사유는 revive_reason 칸과
 * note 끝의 한 줄로 함께 남는다(lib/quoteRevive).
 *
 * 유효기간은 **되돌린 날부터** 다시 1개월이다. 그 기간이 또 지나면 다시 실패가 된다.
 */

import { useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import { BAND_BG, BLUE, BORDER, CARD_BG, DANGER, MUTED, SUB, TEXT } from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'
import { R } from '@/lib/radius'
import { Z } from '@/lib/zIndex'
import {
  REASON_LABEL, REASON_MAX, REASON_PLACEHOLDER, REVIVE_CONFIRM, REVIVE_NOTICE, REVIVE_TITLE,
  reviveBlockedReason,
} from '@/lib/quoteRevive'

export default function QuoteReviveModal({ quote, busy, onClose, onRevive }: {
  quote: {
    quote_number?: string | null
    company?: string | null
    fail_reason?: string | null
  }
  busy?: boolean
  onClose: () => void
  onRevive: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const blocked = reviveBlockedReason(reason)

  const run = () => {
    if (blocked || busy) return
    onRevive(reason.trim())
  }

  return (
    /* 이 창도 **다른 창 위에서** 열린다(상태 창의 「견적중으로 되돌리기」) — 확인 층에 둔다.
       기본 층이면 같은 층의 창과 DOM 차례로 가려진다(2026-11-25 장비 삭제 확인창과 같은 자리). */
    <ModalOverlay onClose={onClose} confirmClose dirty={reason.trim() !== ''} style={{ zIndex: Z.confirm }}>
      <ModalCard
        width={380}
        onClose={onClose}
        title={<div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{REVIVE_TITLE}</div>}
        footer={<>
          <button type="button" onClick={onClose}
            style={{
              height: 38, flex: 1, border: `1px solid ${BORDER}`, borderRadius: R.control,
              background: CARD_BG, color: SUB, fontWeight: 600, fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            취소
          </button>
          <button type="button" onClick={run} disabled={blocked != null || busy}
            style={{
              height: 38, flex: 1, border: 'none', borderRadius: R.control,
              background: blocked || busy ? BORDER : BLUE,
              color: blocked || busy ? MUTED : '#fff',
              fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
              cursor: blocked || busy ? 'default' : 'pointer',
            }}>
            {busy ? '되돌리는 중...' : REVIVE_CONFIRM}
          </button>
        </>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 어느 건인가 — 번호·회사·실패 사유 */}
          <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.7 }}>
            <b style={{ fontWeight: 700 }}>{quote.quote_number ?? ''}</b>
            {quote.company ? <span style={{ color: SUB }}> · {quote.company}</span> : null}
          </div>
          {quote.fail_reason ? (
            <div style={{
              padding: '8px 10px', borderRadius: R.control, background: BAND_BG,
              fontSize: 12, color: SUB, lineHeight: 1.6, whiteSpace: 'pre-wrap',
            }}>
              미수주 사유: {quote.fail_reason}
            </div>
          ) : null}

          <div>
            <label htmlFor="revive-reason"
              style={{ fontSize: 12, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 4, display: 'block' }}>
              {REASON_LABEL} <span style={{ color: DANGER }}>*</span>
            </label>
            <textarea id="revive-reason" value={reason} maxLength={REASON_MAX} rows={3}
              onChange={e => setReason(e.target.value)} placeholder={REASON_PLACEHOLDER}
              style={{
                width: '100%', padding: '9px 10px', boxSizing: 'border-box',
                border: `1px solid ${reason.trim() ? BORDER : DANGER}`, borderRadius: R.control,
                background: CARD_BG, fontSize: 13, color: TEXT, outline: 'none',
                fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.6,
              }} />
          </div>

          <div style={{ fontSize: 12, color: SUB, lineHeight: 1.8 }}>
            {REVIVE_NOTICE.replace(/\*\*/g, '')}
          </div>
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}
