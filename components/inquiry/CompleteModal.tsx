'use client'

// 작성 완료 — 일본 본사에 보낼 파일을 올리고 의뢰서를 「완료」로 넘긴다.
//
// 상세 화면과 목록 화면이 함께 쓴다. 목록에서도 바로 끝낼 수 있어야 한다 —
// 번호를 받아 서류를 만든 뒤 상세로 들어가 다시 찾는 걸음을 없애려는 것이다.
//
// 흐름은 셋이고 순서가 중요하다.
//   1. 내용 기록 한 건을 만든다(오늘 날짜 + 메모).
//   2. 고른 파일을 그 기록에 올린다.
//   3. **파일이 전부 올라간 뒤에만** 상태를 '완료' 로 바꾼다.
// 3번을 먼저 하면 「완료인데 보낼 파일이 빠진」 의뢰서가 생긴다. 사람은 끝났다고 믿고
// 아무도 다시 보지 않으므로, 그 상태를 만들지 않는 것이 이 순서의 전부다.
//
// 파일이 일부 막히면 상태를 그대로 두고 모달을 연 채 사유를 보여 준다. 이때 **이미 만든
// 내용 기록의 id 를 들고 있다가** 다시 누르면 그 기록에 실패한 파일만 올린다 —
// 다시 누를 때마다 빈 기록이 쌓이면 아무도 치울 수 없다.
//
// 서버는 기존 것을 그대로 쓴다(message_add · update · inquiry-attachment). 새 action 은 없다.

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

/** 메모 길이 상한. 내용 기록 본문과 같은 값이어야 한다(/api/inquiry 의 BODY_MAX). */
const BODY_MAX = 20000

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
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /**
   * 이미 만든 내용 기록. 파일이 일부 막혀 다시 누를 때 새로 만들지 않으려고 들고 있는다.
   * null 이면 아직 만들기 전이다.
   */
  const [messageId, setMessageId] = useState<number | null>(null)

  // 내용 기록과 같은 규칙 — 빈 기록은 만들지 않는다.
  const ready = files.length > 0 || memo.trim().length > 0

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
            action: 'message_add', inquiry_id: inquiryId, entry_date: today, body: memo,
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
          <label style={label} htmlFor="cp-memo">
            메모 <span style={{ fontWeight: 500 }}>(선택 · 파일만 올려도 됩니다)</span>
          </label>
          <textarea
            id="cp-memo" value={memo} rows={4} maxLength={BODY_MAX} disabled={busy}
            placeholder="보내는 내용이나 남길 말을 적습니다"
            onChange={e => setMemo(e.target.value)}
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
