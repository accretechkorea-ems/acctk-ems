'use client'

/**
 * 회사 **삭제 요청** 창 — 지울 수 없는 사람이 지워 달라고 하는 자리 (2026-11-23).
 *
 * 사업장 0곳 회사를 찾아내는 사람은 자기 회사를 정리하는 담당자다. 그런데 지우는 일은
 * 슈퍼관리자의 몫이라, 전에는 그 사람에게 「삭제」가 보이고 누르면 403 이었다.
 * 이제 이 창이 그 자리를 대신한다 — 까닭을 적으면 슈퍼관리자에게 알림이 가고,
 * 정리 필요 탭의 그 줄에 「삭제 요청됨」이 붙는다.
 *
 * 지우는 창(DeleteCustomerModal)과 **모양을 맞춘다** — 까닭 한 칸, 못 누르는 까닭 한 줄.
 * 다른 점은 빨강이 아니라는 것이다. 이 창은 아무것도 지우지 않는다.
 */

import { useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import { Z } from '@/lib/zIndex'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import { BLUE, BORDER, MUTED, SUB, TEXT } from '@/components/common/ui'
import { TEXT_LABEL, LABEL_WEIGHT } from '@/lib/textTokens'
import { DELETE_REASON_MAX, DELETE_REQUEST_LABEL, DELETE_REQUEST_NOTE, requestBlockedReason } from '@/lib/customerDelete'
import { R } from '@/lib/radius'

const PADS = keepPads({ x: 22, top: 22, bottom: 22 }, 0, 18)

export default function DeleteRequestModal({ name, busy, onSend, onClose }: {
  /** 지워 달라고 하는 회사 이름. */
  name: string
  busy: boolean
  onSend: (reason: string) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const blocked = requestBlockedReason(reason, busy)

  return (
    // 삭제 **요청** 창도 다른 창 위에서 열린다 — 확인 층에 둔다(2026-11-25).
    <ModalOverlay onClose={onClose} confirmClose dirty={reason.trim() !== ''} style={{ zIndex: Z.confirm }}>
      <ModalCard
        width={420}
        closeX={false}
        {...PADS}
        title={<>
          <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, marginBottom: 6 }}>{DELETE_REQUEST_LABEL}</div>
          <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7, marginBottom: 14 }}>
            <b style={{ color: TEXT }}>{name}</b> 를 지워 달라고 알립니다.
          </div>
        </>}
        footer={<>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ padding: '9px 15px', background: '#fff', color: SUB, borderRadius: R.icon, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            닫기
          </button>
          <button type="button" onClick={() => onSend(reason.trim())} disabled={blocked != null}
            style={{
              padding: '9px 17px', background: blocked ? '#e5e7eb' : BLUE, color: blocked ? MUTED : '#fff',
              borderRadius: R.icon, border: 'none', cursor: blocked ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13,
            }}>
            {busy ? '보내는 중…' : '요청 보내기'}
          </button>
        </>}
      >
        <label htmlFor="dr-reason" style={{ fontSize: 11, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 5, display: 'block' }}>
          지워야 하는 까닭
        </label>
        <textarea
          id="dr-reason"
          value={reason}
          maxLength={DELETE_REASON_MAX}
          onChange={e => setReason(e.target.value)}
          placeholder="예) 같은 회사가 두 줄이라 이쪽은 쓰지 않습니다"
          style={{
            width: '100%', minHeight: 78, padding: '9px 10px', border: `1px solid ${BORDER}`,
            borderRadius: R.control, fontSize: 13, color: TEXT, background: '#fff', outline: 'none',
            boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical',
          }}
        />
        <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7, marginTop: 10 }}>{DELETE_REQUEST_NOTE}</div>
        {/* 왜 못 누르는지 적어 둔다 — 비활성 버튼만 두면 까닭을 찾아 헤맨다. */}
        {blocked && <div style={{ fontSize: 12, color: SUB, marginTop: 8 }}>{blocked}</div>}
      </ModalCard>
    </ModalOverlay>
  )
}
