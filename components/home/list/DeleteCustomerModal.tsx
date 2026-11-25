'use client'

// 고객사 **지우기 창** — 무엇이 함께 숨겨지는지 보여 주고 까닭을 받는다 (2026-11-23).
//
// 창이 하는 말의 순서가 곧 이 창의 뜻이다.
//   ① 지우지 마세요 — 거래가 끊긴 업체는 **상태를 이탈로** 바꿀 일이다.
//   ② 지우면 무엇이 함께 숨는가 — 영업활동·서비스·견적·의뢰·장비·담당자 건수.
//   ③ 까닭(필수) — 적지 않으면 나중에 남는 것은 「누군가 지웠다」뿐이다.
//   ④ 지워도 되돌릴 수 있다 — 겁을 주되 막다른 길로 몰지는 않는다.

import { useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import { Z } from '@/lib/zIndex'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import { R } from '@/lib/radius'
import { BAND_BG, BORDER, CARD_BG, DANGER, DANGER_TINT, MUTED, SUB, TEXT } from '@/components/common/ui'
import {
  DELETE_NOTE, DELETE_REASON_MAX, EMPTY_COUNTS, LEAVE_LABEL, TARGET_LABEL,
  adviceFor, deleteBlockedReason, hiddenWithText, type DeleteCounts, type DeleteTarget,
} from '@/lib/customerDelete'


export type DeleteCustomerModalProps = {
  target: DeleteTarget
  /** 지울 줄의 이름 — 제목 아래 그대로 적는다. */
  name: string
  /** 연결 기록 수. 아직 못 셌으면 null(세는 중이라고 적는다). */
  counts: DeleteCounts | null
  busy?: boolean
  onClose: () => void
  onDelete: (reason: string) => void
  /**
   * 「이탈로 바꾸기」 — **사업장에만** 넘긴다(2026-11-25 지시).
   * 넘기지 않으면 버튼이 서지 않는다. 창이 「이탈로 바꾸세요」라고 말해 놓고 그 길이
   * 다른 화면에 있으면 읽은 사람은 그냥 지운다.
   */
  onLeave?: () => void
}

export default function DeleteCustomerModal({
  target, name, counts, busy = false, onClose, onDelete, onLeave,
}: DeleteCustomerModalProps) {
  // 까닭은 창이 떠 있는 동안만 산다. **창을 새로 열면 비어 있어야 한다** — 부르는 쪽이
  // 대상이 바뀔 때 key 를 갈아 끼워 이 컴포넌트를 새로 만든다(효과에서 지우지 않는다).
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)

  const blocked = deleteBlockedReason(reason, busy)
  const hidden = hiddenWithText(counts ?? EMPTY_COUNTS)
  const label = TARGET_LABEL[target]
  /**
   * 연결 기록을 **세는 대상**인가 — 업체 셋만 센다(부르는 쪽이 counts 를 받아 온다).
   * 담당자·장비는 null 로 들어오는데, 전에는 그 창에 「연결된 기록을 세는 중…」이
   * 끝까지 떠 있었다(세는 쪽이 없으므로 영원히 끝나지 않는다). 지금은 아무 말도 하지 않는다.
   */
  const counting = counts === null && (target === 'site' || target === 'company' || target === 'agency')

  return (
    /**
     * **확인 층**에 띄운다(Z.confirm, 2026-11-25).
     * 이 창은 늘 **다른 창 위에서** 열린다 — 장비·담당자는 그 수정 창에서, 사업장은 상세
     * 화면에서 부른다. 기본 층(Z.modal)이면 같은 층의 수정 창과 **DOM 차례**로 가려져
     * 뒤에 떴다(2026-11-25: 장비 삭제 확인창이 수정 창 뒤에 깔려 누를 수 없었다).
     */
    <ModalOverlay onClose={busy ? () => {} : onClose} closeOn={busy ? 'none' : 'both'} confirmClose dirty={reason.trim().length > 0}
      style={{ zIndex: Z.confirm }}>
      <ModalCard
        width={460}
        closeX
        {...keepPads({ x: 20, top: 16, bottom: 14 }, 16, 0)}
        headStyle={{ alignItems: 'center', padding: '16px 20px', borderBottom: `1px solid ${BORDER}` }}
        bodyStyle={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}
        footStyle={{ padding: '14px 20px', borderTop: `1px solid ${BORDER}`, background: BAND_BG }}
        title={<span style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{label} 삭제</span>}
        footer={<>
          <span style={{ fontSize: 12, color: MUTED, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {blocked ?? '되돌릴 수 있습니다'}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} disabled={busy}
            style={{
              height: 34, padding: '0 12px', borderRadius: R.control, border: `1px solid ${BORDER}`,
              background: CARD_BG, color: SUB, fontSize: 13, fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', flexShrink: 0,
            }}>
            취소
          </button>
          <button type="button" disabled={!!blocked}
            onClick={() => { setTouched(true); if (!blocked) onDelete(reason.trim()) }}
            style={{
              height: 34, padding: '0 16px', borderRadius: R.control, border: 'none',
              background: DANGER, color: CARD_BG, fontSize: 13, fontWeight: 700,
              cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.5 : 1,
              fontFamily: 'inherit', flexShrink: 0,
            }}>
            {busy ? '지우는 중…' : '삭제'}
          </button>
        </>}
      >
        {/* ① 지우지 마세요 — 업체는 긴 글, 담당자·장비는 한 줄이다(lib/customerDelete.ts). */}
        <div style={{
          padding: '10px 12px', borderRadius: R.control, background: DANGER_TINT,
          border: `1px solid ${DANGER_TINT}`, fontSize: 13, color: DANGER, fontWeight: 600, lineHeight: 1.6,
        }}>
          {adviceFor(target)}
        </div>

        {/* ② 무엇이 함께 숨는가 */}
        <div>
          <div style={{ fontSize: 13, color: TEXT, fontWeight: 700, marginBottom: 6, wordBreak: 'break-all' }}>{name}</div>
          {counting ? (
            <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7 }}>연결된 기록을 세는 중…</div>
          ) : counts !== null ? (
            <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7 }}>{hidden || '연결된 기록이 없습니다.'}</div>
          ) : null}
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4, lineHeight: 1.7 }}>{DELETE_NOTE}</div>
        </div>

        {/* ③ 까닭(필수) */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: SUB, marginBottom: 6 }}>
            지우는 까닭 <span style={{ color: DANGER }}>*</span>
          </div>
          <textarea value={reason} onChange={e => setReason(e.target.value.slice(0, DELETE_REASON_MAX))}
            onBlur={() => setTouched(true)}
            placeholder="예: 폐업 확인(2026-11-20 통화) · 중복 등록"
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '9px 11px',
              border: `1px solid ${touched && !reason.trim() ? DANGER : BORDER}`, borderRadius: R.control,
              color: TEXT, background: CARD_BG, fontSize: 13, outline: 'none',
              fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.6,
            }} />
          <div className="num" style={{ fontSize: 11, color: MUTED, textAlign: 'right', marginTop: 2 }}>
            {reason.length} / {DELETE_REASON_MAX}
          </div>

          {/* 대신 할 일 — 사업장에만 선다. 까닭을 적지 않아도 누를 수 있다(지우는 길이 아니다). */}
          {onLeave && (
            <button type="button" onClick={onLeave} disabled={busy}
              style={{
                marginTop: 10, width: '100%', height: 34, borderRadius: R.control,
                border: `1px solid ${BORDER}`, background: CARD_BG, color: SUB,
                fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}>
              {LEAVE_LABEL}
            </button>
          )}
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}
