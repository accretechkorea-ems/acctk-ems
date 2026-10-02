'use client'

// 작성 완료 — 일본 본사에 보낼 파일을 올리고 의뢰서를 「완료」로 넘긴다.
//
// 상세 화면과 목록 화면이 함께 쓴다. 목록에서도 바로 끝낼 수 있어야 한다 —
// 번호를 받아 서류를 만든 뒤 상세로 들어가 다시 찾는 걸음을 없애려는 것이다.
//
// 흐름은 셋이고 순서가 중요하다.
//   1. 내용 기록 한 건을 만든다(오늘 날짜 + 입력한 내용).
//   2. 고른 파일을 그 기록에 올린다.
//   3. **파일이 전부 올라간 뒤에만** 상태를 '완료' 로 바꾼다.
// 3번을 먼저 하면 「완료인데 보낼 파일이 빠진」 의뢰서가 생긴다. 사람은 끝났다고 믿고
// 아무도 다시 보지 않으므로, 그 상태를 만들지 않는 것이 이 순서의 전부다.
//
// 파일이 일부 막히면 상태를 그대로 두고 모달을 연 채 사유를 보여 준다. 이때 **이미 만든
// 내용 기록의 id 를 들고 있다가** 다시 누르면 그 기록에 실패한 파일만 올린다 —
// 다시 누를 때마다 빈 기록이 쌓이면 아무도 치울 수 없다.
//
// **내용은 필수고 파일은 선택이다.** 끝낸 번호에 「무엇을 보냈는지」가 한 줄도 없으면 나중에
// 그 기록을 읽는 사람이 할 수 있는 일이 없다 — 파일 이름만으로는 맥락이 남지 않는다.
// 그 판정은 아래 canSubmit 하나이고, 버튼의 disabled 와 submit 맨 앞 방어가 같은 함수를 본다.
//
// 서버는 기존 것을 그대로 쓴다(message_add · update · inquiry-attachment). 새 action 은 없다.
// **서버에는 본문 필수를 걸지 않는다** — 일괄 등록·기존 번호 등록이 같은 action 을 빈 본문으로
// 부르기 때문이다(그쪽은 「번호를 쓴 날」만 남긴다). 필수는 이 화면의 규칙이다.

import { useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useToast } from '@/components/common/Toast'
import {
  CARD_BG, BORDER, TEXT, SUB, MUTED, NEUTRAL_BG, BLUE,
  cardHeader, cardTitle, btnPrimary, btnGhost,
} from '@/components/common/ui'
import { todayKST } from '@/lib/date'
import { errorInfo } from '@/lib/errorInfo'
import FilePicker, { failText, uploadFiles } from './files'

/** 내용 길이 상한. 내용 기록 본문과 같은 값이어야 한다(/api/inquiry 의 BODY_MAX). */
const BODY_MAX = 20000

/**
 * 확정할 수 있는가 — **내용이 있어야 한다.** 파일은 선택이다(파일만 있고 내용이 없으면 못 끝낸다).
 *
 * 공백·줄바꿈만 적은 것은 비어 있는 것으로 본다(trim). 전각 공백(U+3000)도 s 에 들어가므로
 * String.prototype.trim 이 함께 떨어낸다 — 눈에 보이지 않는 글자로 필수를 빠져나가지 못한다.
 *
 * 상한도 함께 본다. 입력칸이 maxLength 로 막고 서버도 다시 보지만, 버튼 조건을 한 곳에 모아 두면
 * 「누를 수 있는데 서버가 거절하는」 상태가 생기지 않는다.
 *
 * 순수 함수다 — 스크립트로 그대로 돌려 볼 수 있다.
 */
export function canSubmit(content: string): boolean {
  const t = content.trim()
  return t.length > 0 && content.length <= BODY_MAX
}

const field: React.CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: TEXT, background: CARD_BG, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
}
const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5, display: 'block',
}

export default function CompleteModal({
  inquiryId, inquiryNo, title, onClose, onDone,
}: {
  inquiryId: string
  inquiryNo: string
  /** 업체명. 비어 있으면 자리표시를 보여 준다. */
  title: string | null
  onClose: () => void
  /** 상태가 '완료' 로 바뀐 뒤. 부르는 쪽이 화면을 다시 읽는다. */
  onDone: () => void
}) {
  const toast = useToast()
  const today = todayKST()

  const [files, setFiles] = useState<File[]>([])
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /**
   * 이미 만든 내용 기록. 파일이 일부 막혀 다시 누를 때 새로 만들지 않으려고 들고 있는다.
   * null 이면 아직 만들기 전이다.
   */
  const [messageId, setMessageId] = useState<number | null>(null)

  // 내용 추가 모달과 같은 규칙 — 내용이 비면 기록을 만들지 않는다(파일만으로는 끝낼 수 없다).
  const ready = canSubmit(content)

  const submit = async () => {
    if (busy || !ready) return
    setBusy(true)
    setError('')
    try {
      // ── 1. 내용 기록(없을 때만) ──
      let id = messageId
      if (id === null) {
        const res = await fetch('/api/inquiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // 발신 고정 — 작성 완료는 내가 보낸 것을 끝내는 동작이라 방향을 고르지 않는다.
            action: 'message_add', inquiry_id: inquiryId, entry_date: today, direction: 'sent', body: content,
          }),
        })
        const json = await res.json().catch(() => null)
        if (!res.ok) { setError(json?.error || `기록을 남기지 못했습니다 (HTTP ${res.status})`); return }
        const made = Number(json?.message?.id)
        if (!Number.isInteger(made)) { setError('기록은 저장됐지만 번호를 읽지 못했습니다. 상세에서 확인해주세요.'); return }
        id = made
        setMessageId(made)
      }

      // ── 2. 파일 ──
      if (files.length > 0) {
        const failed = await uploadFiles(id, files)
        if (failed.length > 0) {
          // 올라간 것은 덜어 내고 실패한 것만 남긴다 — 다시 누르면 그것만 재시도한다.
          setFiles(files.filter(f => failed.some(x => x.name === f.name)))
          setError(`올리지 못한 파일이 있어 「작성 중」으로 둡니다. 고친 뒤 다시 눌러주세요.\n${failText(failed)}`)
          return
        }
        setFiles([])
      }

      // ── 3. 상태 ──
      // 취소된 의뢰서는 서버가 409 로 막는다(종전 규칙 그대로). 그 사유를 그대로 보여 준다.
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: inquiryId, status: 'done' }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error || `상태를 바꾸지 못했습니다 (HTTP ${res.status})`)
        return
      }

      toast.success(`${inquiryNo} 작성 완료했습니다`)
      onDone()
      onClose()
    } catch (e) {
      console.error('[inquiries] 작성 완료 실패', errorInfo(e))
      setError('처리하지 못했습니다. 잠시 뒤 다시 시도해주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{
        background: CARD_BG, borderRadius: 8, padding: '14px 16px', width: '100%', maxWidth: 520,
        maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
      }}>
        <div style={cardHeader}>
          <span style={cardTitle}>작성 완료</span>
        </div>

        {/* 어느 번호를 끝내는지 — 목록에서 바로 열 수 있으므로 번호가 크게 보여야 한다. */}
        <div style={{
          background: NEUTRAL_BG, borderRadius: 8, padding: '12px 14px', marginBottom: 12,
        }}>
          <div style={{
            fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px', color: BLUE,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {inquiryNo}
          </div>
          <div style={{ fontSize: 13, color: title?.trim() ? SUB : MUTED, marginTop: 2 }}>
            {title?.trim() || '(업체명 없음)'}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>파일 등록</label>
          <FilePicker files={files} onChange={setFiles} disabled={busy} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label} htmlFor="cp-content">내용 (필수)</label>
          <textarea
            id="cp-content" value={content} rows={4} maxLength={BODY_MAX} disabled={busy}
            placeholder="일본 본사로 보낸 내용을 적어 주세요"
            onChange={e => setContent(e.target.value)}
            style={{ ...field, resize: 'vertical', lineHeight: 1.6 }}
          />
        </div>

        {/* 날짜는 고르지 않는다 — 「오늘 끝냈다」는 기록이라 바꿀 이유가 없다. */}
        <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.6, marginBottom: 12 }}>
          기록 날짜 <span style={{ color: TEXT, fontWeight: 600 }}>{today.replace(/-/g, '.')}</span>
          <span style={{ color: MUTED }}> · 끝내면 상태가 「완료」가 됩니다.</span>
        </div>

        {error && (
          <div style={{
            fontSize: 12, lineHeight: 1.6, color: '#be123c', background: '#fef2f2',
            border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px', marginBottom: 12,
            whiteSpace: 'pre-line', wordBreak: 'break-word',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ ...btnGhost(busy), flex: 1 }}>
            닫기
          </button>
          <button
            type="button" onClick={submit} disabled={busy || !ready}
            style={{ ...btnPrimary(busy || !ready), flex: 1 }}
          >
            {busy ? '처리 중...' : '작성 완료'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
