'use client'

// 문서 상세 — 목록 행 아래에서 그대로 펼쳐진다(아코디언). 목록을 떠나지 않고 처리한다.
//
// 아마란스 문서 양식을 따른다. 위에서부터
//   머리(왼쪽 문서 정보 표 · 오른쪽 결재표) → 문서 내용(요약) → 이력
//   → 「상기와 같이 …를 제출합니다」 → 처리 버튼
// 처리 버튼은 미결함에서만 보이고, 상신함은 회수·재작성, 참조함은 아무 버튼도 두지 않는다.
//
// 이력은 approval_history 를 화면에서 바로 읽는다 — 그 문서의 상신자·결재선 참여자만 읽히도록
// RLS 가 이미 걸려 있어서(ah_select), 목록에 보이는 문서면 이력도 읽힌다.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import {
  BORDER, DANGER, FAINT, MUTED, NEUTRAL_BG, SUB, TEXT,
  btnDanger, btnGhost, btnPrimary, inputStyle,
} from '@/components/common/ui'
import ApprovalTable, { type ProgressPerson } from './ApprovalTable'
import DocInfo from './DocInfo'
import { summaryRows } from './summary'
import { panelOf } from './panels'
import { nextPendingLine } from '@/lib/approval/engine'
import { canRejectDocument, canResubmitDocument, DOC_TYPES } from '@/lib/approval/docTypes'
import { DISCARDABLE_STATUSES, type ApprovalLine, type ApprovalDocument } from '@/lib/approval/types'

export type ApprovalDoc = ApprovalDocument & {
  approval_lines: ApprovalLine[]
  progress?: { total: number; done: number; currentStep: number | null; currentApproverId: number | null }
  delegated?: boolean
}

type HistoryRow = {
  history_id: number
  action: string
  actor_id: number
  step: number | null
  comment: string | null
  created_at: string
}

/** 「회수」는 두 번 눌러야 실행된다. 쇼룸·첨부와 같은 3초다. */
const CONFIRM_MS = 3000

/** 「…을/를」 — 마지막 글자의 받침으로 고른다. 문서 종류 이름이 유형마다 달라 규칙으로 둔다. */
const objectParticle = (word: string): string => {
  const code = word.charCodeAt(word.length - 1)
  if (code < 0xac00 || code > 0xd7a3) return '를'
  return (code - 0xac00) % 28 === 0 ? '를' : '을'
}

const when = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function DocDetail({
  doc, people, box, onChanged,
}: {
  doc: ApprovalDoc
  people: Record<number, ProgressPerson>
  /** 어느 함에서 펼쳤는가 — 버튼 구성이 갈린다. */
  box: 'pending' | 'done' | 'outbox' | 'cc' | 'all'
  /** 처리 성공 — 목록을 다시 읽게 한다. */
  onChanged: () => void
}) {
  const toast = useToast()
  const [history, setHistory] = useState<HistoryRow[] | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('approval_history')
        .select('history_id, action, actor_id, step, comment, created_at')
        .eq('document_id', doc.document_id)
        .order('created_at', { ascending: true })
      if (cancelled) return
      if (error) {
        console.error('[approval/detail] history load failed', error)
        setHistory([])
        return
      }
      setHistory((data ?? []) as HistoryRow[])
    }
    run()
    return () => { cancelled = true }
  }, [doc.document_id])

  useEffect(() => {
    if (!confirmWithdraw) return
    const t = setTimeout(() => setConfirmWithdraw(false), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [confirmWithdraw])

  useEffect(() => {
    if (!confirmDiscard) return
    const t = setTimeout(() => setConfirmDiscard(false), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [confirmDiscard])

  const nameOf = (id: number) => people[id]?.name ?? `#${id}`
  const current = nextPendingLine(doc.approval_lines)
  // 반려할 수 없는 문서(쇼룸 사후 신청 — 이미 끝난 사용)는 반려 버튼을 감추고 승인을 「확인」이라 부른다.
  // 판정은 서버 반려 라우트와 같은 함수를 쓴다 — 화면에 보이는 버튼과 서버가 받는 것이 어긋나지 않게.
  const def = DOC_TYPES[doc.doc_type]
  const rejectable = def ? canRejectDocument(def, doc.summary) : true
  const approveLabel = rejectable ? '승인' : '확인'
  const rows = summaryRows(doc.doc_type, doc.summary)
  const docLabel = def?.label ?? doc.doc_type
  // 유형별 추가 패널(견적서 검토표 등). 등록표가 고른다 — 여기에 유형 이름을 적지 않는다.
  const Panel = panelOf(doc.doc_type)

  /** 라우트 호출 공통 — 409 는 「이미 처리되었습니다」로 알리고 목록을 다시 읽는다. */
  const call = async (body: Record<string, unknown>, okText: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (res.status === 409) {
        toast.error('이미 처리된 결재입니다')
        onChanged()
        return
      }
      if (!res.ok) { toast.error(json?.error ?? '처리하지 못했습니다'); return }
      toast.success(okText)
      onChanged()
    } catch (e) {
      console.error('[approval/detail] action failed', e)
      toast.error('처리하지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  const approve = () => call({ action: 'approve', documentId: doc.document_id, comment: comment.trim() || undefined }, rejectable ? '결재했습니다' : '확인했습니다')
  const reject = () => {
    if (!comment.trim()) { toast.error('반려 사유를 입력해주세요'); return }
    call({ action: 'reject', documentId: doc.document_id, comment: comment.trim() }, '반려했습니다')
  }
  const withdraw = () => {
    if (!confirmWithdraw) { setConfirmWithdraw(true); return }
    setConfirmWithdraw(false)
    call({ action: 'withdraw', documentId: doc.document_id }, '회수했습니다')
  }
  const resubmit = () => call({ action: 'resubmit', documentId: doc.document_id }, '다시 올렸습니다')
  // 폐기 — 되돌릴 수 없으니 회수와 같은 3초 2단 확인을 둔다.
  const discard = () => {
    if (!confirmDiscard) { setConfirmDiscard(true); return }
    setConfirmDiscard(false)
    call({ action: 'discard', documentId: doc.document_id }, '폐기했습니다')
  }

  const untouched = doc.approval_lines.filter(l => l.kind !== 'cc').every(l => l.state === '대기')
  // 반려·회수된 내 문서만 치울 수 있다(라우트와 같은 판정). 폐기한 문서는 여기서 빠진다.
  const discardable = (DISCARDABLE_STATUSES as string[]).includes(doc.status)
  // 같은 문서로 다시 올릴 수 있는 유형인가(라우트와 같은 판정). 견적서는 내용을 고쳐야 하므로 false 다
  // — 버튼을 그려 두면 눌러서 400 을 받는다. 폐기는 그대로 둔다(치우는 길은 막지 않는다).
  const resubmittable = def ? canResubmitDocument(def) : true
  const rejectedLine = doc.approval_lines.find(l => l.state === '반려')

  return (
    <div style={{ padding: '12px 12px 14px', background: '#fafafa', borderTop: `1px solid ${BORDER}` }}>
      {/* 머리 — 왼쪽 문서 정보, 오른쪽 결재표. 좁으면 결재표가 아래로 내려간다. */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
          <DocInfo
            docNo={doc.doc_no}
            submittedAt={doc.submitted_at ?? doc.created_at}
            requesterId={doc.requester_id}
            title={doc.title}
            lines={doc.approval_lines}
            people={people}
          />
        </div>
        {/* 맨 앞 기안자 칸은 결재선이 아니라 문서 값으로 그린다 — 판정이 기안자를 결재자로 세지 않는다. */}
        <ApprovalTable
          lines={doc.approval_lines}
          people={people}
          currentLineId={current?.line_id ?? null}
          requesterId={doc.requester_id}
          submittedAt={doc.submitted_at}
        />
      </div>

      {/* 문서 내용 — 유형별 항목은 summary.ts 가 뽑는다. */}
      {rows.length > 0 && (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px' }}>
          {rows.map(r => (
            <div key={r.label} style={{ display: 'contents' }}>
              <span style={{ fontSize: 12, color: MUTED }}>{r.label}</span>
              <span style={{ fontSize: 13, color: TEXT, wordBreak: 'break-word' }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* 유형별 추가 패널 — 등록표(panels.ts)가 고른다. `if (doc_type === …)` 분기를 두지 않는다
          (summary.ts 와 같은 방식). 등록되지 않은 유형은 Panel 이 null 이라 아무것도 그리지 않는다.
          패널이 실패해도 아래 처리 버튼은 그대로 동작한다 — 자기 영역에서만 오류를 알린다. */}
      {Panel && <Panel documentId={doc.document_id} />}

      {/* 반려 사유는 눈에 띄게 따로 */}
      {doc.status === '반려' && rejectedLine?.comment && (
        <div style={{ marginTop: 12, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '8px 10px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: DANGER }}>반려 사유</span>
          <div style={{ fontSize: 13, color: TEXT, marginTop: 3, wordBreak: 'break-word' }}>{rejectedLine.comment}</div>
        </div>
      )}

      {/* 이력 */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5 }}>이력</div>
        {history === null ? (
          <div style={{ fontSize: 12, color: MUTED }}>불러오는 중...</div>
        ) : history.length === 0 ? (
          <div style={{ fontSize: 12, color: MUTED }}>기록이 없습니다</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {history.map(h => (
              <div key={h.history_id} style={{ fontSize: 12, color: SUB, lineHeight: 1.6 }}>
                <span style={{ color: MUTED }}>{when(h.created_at)}</span>
                <span style={{ color: FAINT }}> · </span>
                <span style={{ fontWeight: 700, color: TEXT }}>{nameOf(h.actor_id)}</span>
                <span style={{ color: FAINT }}> · </span>
                <span style={{ fontWeight: 600 }}>{h.action}</span>
                {h.comment && <span> — {h.comment}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 문서를 닫는 한 줄 — 아마란스 문서 맨 아래에 늘 붙는 문구다. */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BORDER}`, textAlign: 'center', fontSize: 12, color: SUB }}>
        상기와 같이 {docLabel}{objectParticle(docLabel)} 제출합니다
      </div>

      {/* 처리 */}
      {box === 'pending' && doc.status === '진행중' && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* 위임받아 들어온 건 — 누구를 대신해 누르는지 먼저 알린다. 기록에는 「대결」로 남고
              결재란에는 원래 결재자의 칸에 내 이름이 찍힌다. */}
          {doc.delegated && current && (
            <div style={{ fontSize: 12, color: SUB, background: NEUTRAL_BG, borderRadius: 6, padding: '6px 10px' }}>
              {nameOf(current.approver_id)}님을 대신하여 결재합니다
            </div>
          )}
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={rejectable ? '의견 (반려는 사유 필수)' : '의견 (선택)'}
            rows={2}
            maxLength={500}
            style={{ ...inputStyle, width: '100%', resize: 'vertical', fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={approve} disabled={busy} style={btnPrimary(busy)}>
              {busy ? '처리 중...' : approveLabel}
            </button>
            {rejectable && (
              <button type="button" onClick={reject} disabled={busy || !comment.trim()} style={btnDanger(busy || !comment.trim())}>
                반려
              </button>
            )}
          </div>
        </div>
      )}

      {box === 'outbox' && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          {doc.status === '진행중' && untouched && (
            <button type="button" onClick={withdraw} disabled={busy}
              style={confirmWithdraw ? btnDanger(busy) : btnGhost(busy)}>
              {confirmWithdraw ? '한 번 더 누르면 회수' : '회수'}
            </button>
          )}
          {/* 재작성·폐기는 같은 조건에서 함께 나온다 — 다시 올리거나, 치우거나 둘 중 하나다.
              폐기한 문서에는 둘 다 나오지 않는다(되살리려면 새로 상신한다). */}
          {discardable && (
            <>
              {resubmittable && (
                <button type="button" onClick={resubmit} disabled={busy} style={btnPrimary(busy)}>
                  {busy ? '처리 중...' : '재작성'}
                </button>
              )}
              <button type="button" onClick={discard} disabled={busy}
                style={confirmDiscard ? btnDanger(busy) : btnGhost(busy)}>
                {confirmDiscard ? '한 번 더 누르면 폐기' : '폐기'}
              </button>
            </>
          )}
          {doc.status === '폐기' && (
            <span style={{ fontSize: 12, color: MUTED, background: NEUTRAL_BG, borderRadius: 6, padding: '6px 10px' }}>
              폐기한 문서입니다. 다시 올리려면 새로 상신해주세요
            </span>
          )}
          {doc.status === '진행중' && !untouched && (
            <span style={{ fontSize: 12, color: MUTED, background: NEUTRAL_BG, borderRadius: 6, padding: '6px 10px' }}>
              이미 결재가 시작되어 회수할 수 없습니다
            </span>
          )}
        </div>
      )}
    </div>
  )
}
