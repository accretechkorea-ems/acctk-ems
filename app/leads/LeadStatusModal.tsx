'use client'

// 리드 「상태 변경」 모달 — 관리 카드의 붉은 패널을 대신한다.
//
// 왜 모달인가 — 예전에는 카드 안에서 영역이 펼쳐졌다. 카드가 세로로 길어지며 메모·처리 줄과
// 섞여, 지금 무엇을 하는 중인지가 흐려졌다(「리드 처리」를 눌렀는데 삭제 확인 문구가 나와
// 놀라는 제보가 있었다). 한 번에 한 가지만 묻는 자리로 떼어 낸다.
//
// 이 모달이 하는 일은 셋뿐이다: 담당자 지정·변경, 배정 불가 처리, 배정 불가 해제. **삭제는 없다** —
// 진행하지 않은 리드도 「배정 불가 + 사유」로 남겨야 어디서 들어온 리드를 왜 안 했는지가 남는다.
//
// 이미 배정 불가인 리드에서는 해제 하나만 보인다. 닫힌 건에 담당자를 붙이는 길을 열어 두면
// 「배정불가인데 담당자가 있는」 행이 생기고, DB 의 CHECK(leads_blocked_actor_check)와도 어긋난다.
// 먼저 풀고, 그다음에 배정하는 두 걸음으로 나눈다.
//
// 권한 판정은 부모가 넘겨준다(canAssign·canBlock). 서버(/api/lead-manage)가 같은 판정을
// 다시 하므로 여기서 감추는 것은 편의일 뿐이다 — 막는 것은 라우트다.

import { useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import SegmentedControl from '@/components/common/SegmentedControl'
import {
  CARD_BG, BORDER, TEXT, SUB, MUTED, NEUTRAL_BG, DANGER,
  cardHeader, cardTitle, btnPrimary, btnGhost, btnDanger,
} from '@/components/common/ui'
import { LEAD_STATUS_BLOCKED, MAX_LEN, SKIP_REASON_MIN } from '@/lib/leadOptions'

/** 경고 상자 배경 — 리드 화면·관리자 화면이 쓰던 값과 같다(새로 만든 색이 아니다). */
const DANGER_BG = '#fef2f2'

/** 이 모달이 보는 리드의 최소 모양. 화면의 Lead 타입이 그대로 들어맞는다. */
export type StatusModalLead = {
  lead_id: number
  customer_company: string
  status: string
  assigned_to: number | null
}

const field: React.CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: TEXT, background: CARD_BG, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
}
const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5, display: 'block',
}

export default function LeadStatusModal({
  lead, assigneeName, options, canAssign, canBlock, canUnblock,
  blockReason, blockedLabel, busy, onClose, onAssign, onBlock, onUnblock,
}: {
  lead: StatusModalLead
  /** 현재 담당자 「이름 직급」. 미배정이면 빈 문자열. */
  assigneeName: string
  /** 담당자 후보. 화면의 규칙(리드 권한이 있는 재직자 + 지금 배정된 사람)을 그대로 받는다. */
  options: { id: number; label: string }[]
  canAssign: boolean
  canBlock: boolean
  canUnblock: boolean
  /** 배정 불가 상태일 때의 사유. 요약 줄에 그대로 보여 준다. */
  blockReason: string | null
  /** 「이름 직급 · 2026.09.30 14:20」. 칸이 생기기 전에 닫힌 건은 빈 문자열이다. */
  blockedLabel: string
  busy: boolean
  onClose: () => void
  /** 성공하면 null, 실패하면 모달 안에 띄울 사유를 돌려준다. */
  onAssign: (assignedTo: number) => Promise<string | null>
  onBlock: (reason: string) => Promise<string | null>
  onUnblock: () => Promise<string | null>
}) {
  const assigned = lead.assigned_to != null
  const blocked = lead.status === LEAD_STATUS_BLOCKED
  // 미배정이면 「지정」, 이미 붙어 있으면 「변경」 — 같은 동작이지만 하는 말이 달라야 덜 헷갈린다.
  const assignLabel = assigned ? '담당자 변경' : '담당자 지정'
  // 배정 불가인 리드에서는 해제만 할 수 있다. 풀고 나면 평소의 두 선택지로 돌아온다.
  const kinds = blocked
    ? (canUnblock ? [{ label: '배정 불가 해제', value: 'unblock' }] : [])
    : [
        ...(canAssign ? [{ label: assignLabel, value: 'assign' }] : []),
        ...(canBlock ? [{ label: '배정 불가 처리', value: 'block' }] : []),
      ]

  const [kind, setKind] = useState(kinds[0]?.value ?? 'assign')
  const [pick, setPick] = useState<number | ''>('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  // 같은 사람을 다시 고르는 것은 변경이 아니다 — 서버도 그 경우 파트너사 메일을 보내지 않는다.
  const assignReady = pick !== '' && pick !== lead.assigned_to
  const blockReady = reason.trim().length >= SKIP_REASON_MIN
  // 해제는 더 받을 값이 없다 — 누르면 바로 실행이라 늘 준비된 상태다.
  const ready = kind === 'assign' ? assignReady : kind === 'block' ? blockReady : true

  const submit = async () => {
    if (busy || !ready) return
    setError('')
    const err = kind === 'assign'
      ? await onAssign(Number(pick))
      : kind === 'block'
        ? await onBlock(reason.trim())
        : await onUnblock()
    // 실패하면 모달을 열어 둔 채로 사유를 보여 준다 — 닫아 버리면 고쳐서 다시 할 길이 없다.
    if (err) { setError(err); return }
    onClose()
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{
        background: CARD_BG, borderRadius: 8, padding: '14px 16px', width: '100%', maxWidth: 460,
        maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
      }}>
        <div style={cardHeader}>
          <span style={cardTitle}>상태 변경</span>
        </div>

        {/* 지금 상태 한 줄 — 무엇을 바꾸려는 것인지가 선택지보다 먼저 보여야 한다. */}
        <div style={{
          background: NEUTRAL_BG, borderRadius: 8, padding: '10px 12px', marginBottom: 12,
          fontSize: 13, color: SUB, lineHeight: 1.6, wordBreak: 'break-word',
        }}>
          <span style={{ fontWeight: 700, color: TEXT }}>{lead.customer_company}</span>
          <br />
          담당자{' '}
          {assigned
            ? <span style={{ color: TEXT, fontWeight: 600 }}>{assigneeName || '-'}</span>
            : <span style={{ color: DANGER, fontWeight: 700 }}>미배정</span>}
          <span style={{ color: MUTED }}> · </span>
          상태 <span style={{ color: TEXT, fontWeight: 600 }}>{lead.status}</span>
          {/* 배정 불가인 건은 왜·누가 닫았는지까지 요약에 넣는다 — 풀지 말지 판단할 근거다. */}
          {blocked && (
            <>
              <br />
              사유 <span style={{ color: TEXT }}>{blockReason?.trim() || '기록 없음'}</span>
              <br />
              처리 <span style={{ color: blockedLabel ? TEXT : MUTED }}>
                {blockedLabel || '처리자 기록 없음'}
              </span>
            </>
          )}
        </div>

        {kinds.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <SegmentedControl
              options={kinds}
              value={kind}
              onChange={v => { setKind(v); setError('') }}
            />
          </div>
        )}

        {kind === 'assign' && (
          <div style={{ marginBottom: 12 }}>
            <label style={label} htmlFor="lsm-owner">담당자</label>
            <select
              id="lsm-owner" value={pick} disabled={busy} style={field}
              onChange={e => setPick(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">고르기</option>
              {options.map(o => (
                <option key={o.id} value={o.id}>
                  {/* 지금 배정된 사람에게는 표시를 붙인다 — 고르면 확정이 켜지지 않는 이유가 보이게. */}
                  {o.id === lead.assigned_to ? `${o.label} (현재 담당자)` : o.label}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.6, marginTop: 6 }}>
              배정하면 상태가 「진행중」이 되고, 새 담당자에게 알림이 갑니다.
              파트너사 이메일이 있으면 담당자 안내 메일도 나갑니다.
            </div>
          </div>
        )}

        {kind === 'block' && (
          <div style={{ marginBottom: 12 }}>
            {/* 문구는 서버(app/api/lead-manage/route.ts 의 action === 'block')가 실제로 하는 일 그대로다. */}
            <div style={{
              background: DANGER_BG, border: `1px solid ${BORDER}`, borderRadius: 8,
              padding: '10px 12px', marginBottom: 10, fontSize: 13, color: TEXT, lineHeight: 1.7,
            }}>
              담당자를 붙이지 않고 이 리드를 닫습니다. 상태가 「배정불가」가 되고 사유·처리자·시각이 남습니다.
              {assigned && (
                <><br />배정된 담당자({assigneeName || '-'})는 해제되고 알림을 받습니다.</>
              )}
              {/* 예전에는 「되돌릴 수 없습니다」였다. 해제(unblock)가 생겨 더는 사실이 아니라 고쳤다. */}
              <br />관리자가 배정 불가를 해제하면 신규 상태로 되돌릴 수 있습니다.
              배정됐던 담당자는 자동으로 복원되지 않습니다.
            </div>
            <label style={label} htmlFor="lsm-reason">배정 불가 사유</label>
            <textarea
              id="lsm-reason" value={reason} rows={3} disabled={busy}
              maxLength={MAX_LEN.skip_reason}
              placeholder={`배정 불가 사유 (${SKIP_REASON_MIN}자 이상)`}
              onChange={e => setReason(e.target.value)}
              style={{ ...field, resize: 'vertical', lineHeight: 1.6 }}
            />
          </div>
        )}

        {kind === 'unblock' && (
          <div style={{
            background: NEUTRAL_BG, borderRadius: 8, padding: '10px 12px', marginBottom: 12,
            fontSize: 13, color: TEXT, lineHeight: 1.7,
          }}>
            이 리드를 신규·미배정 상태로 되돌립니다. 이전 배정 불가 사유와 처리 기록은 감사 기록에 남습니다.
            되돌린 뒤 담당자를 다시 지정할 수 있습니다.
          </div>
        )}

        {/* 고를 것이 아무것도 없는 경우(권한이 없어 선택지가 비었다). 빈 모달을 그대로 두지 않는다. */}
        {kinds.length === 0 && (
          <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.7, marginBottom: 12 }}>
            이 리드에 할 수 있는 작업이 없습니다.
          </div>
        )}

        {error && (
          <div style={{
            fontSize: 12, lineHeight: 1.6, color: DANGER, background: DANGER_BG,
            border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px', marginBottom: 12,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ ...btnGhost(busy), flex: 1 }}>
            닫기
          </button>
          {kind === 'assign' && (
            <button
              type="button" onClick={submit} disabled={busy || !assignReady}
              style={{ ...btnPrimary(busy || !assignReady), flex: 1 }}
            >
              {busy ? '처리 중...' : assignLabel}
            </button>
          )}
          {kind === 'block' && (
            <button
              type="button" onClick={submit} disabled={busy || !blockReady}
              style={{ ...btnDanger(busy || !blockReady), flex: 1 }}
            >
              {busy ? '처리 중...' : '배정 불가 처리'}
            </button>
          )}
          {/* 해제는 되돌리는 동작이지 파괴하는 동작이 아니다 — 붉은색을 쓰지 않는다. */}
          {kind === 'unblock' && (
            <button
              type="button" onClick={submit} disabled={busy}
              style={{ ...btnPrimary(busy), flex: 1 }}
            >
              {busy ? '처리 중...' : '배정 불가 해제'}
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>
  )
}
