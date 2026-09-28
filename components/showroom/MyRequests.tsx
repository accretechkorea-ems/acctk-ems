'use client'

// 내 사용 신청 — 전체기록 탭 위쪽. 내가 올린 결재 중 끝나지 않은 것만 보인다(없으면 카드 자체를 그리지 않는다).
//   · 진행중 — 결재선을 따라 도는 중(사후 신청은 「확인 대기」)
//   · 반려·회수 — 사유와 [재작성]. 재작성하면 처음부터 다시 돈다.
// 완료된 건은 사용 기록으로 내려가므로 여기서 빠진다.
//
// 4단계부터 신청이 approval_documents 에 산다. 읽기는 화면에서 직접 한다 —
// RLS(ad_select)가 상신자 본인에게 자기 문서를 열어 준다. 진행 상태·반려 사유는 결재선에서 읽는다.
// 조회는 effect 에서 외부 응답을 받은 콜백으로만 반영한다 — '불러오는 중'은 요청 키로 파생시킨다.

import { useEffect, useState } from 'react'
import type { createClient } from '@/lib/supabase/client'
import { normTime } from '@/lib/workHours'
import type { ApprovalLine } from '@/lib/approval/types'
import {
  BLUE, BORDER, TEXT, MUTED, SUB, DANGER, FAINT,
  cardStyle, cardHeader, countBadge,
} from '@/components/common/ui'
import { openApprovalPdf } from './openApprovalPdf'
import type { ShowroomSummary } from '@/lib/approval/showroomUsage'

type Browser = ReturnType<typeof createClient>

const linkBtn = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: BLUE, fontFamily: 'inherit', whiteSpace: 'nowrap' } as const

/** 재작성으로 넘기는 값 — 모달이 이 내용으로 다시 채운다. */
export type RewriteTarget = {
  document_id: number
  summary: ShowroomSummary
  /** 반려 사유 — 재작성 모달 위에 보여 준다. 회수면 없다. */
  comment: string | null
}

type DocRow = {
  document_id: number
  doc_no: string
  status: string
  summary: ShowroomSummary
  approval_lines: ApprovalLine[]
}

type Props = {
  supabase: Browser
  myId: number | null
  /** 신청·재작성 뒤 올라가는 값. 바뀌면 다시 읽는다. */
  reloadKey: number
  onRewrite: (target: RewriteTarget) => void
}

export default function MyRequests({ supabase, myId, reloadKey, onRewrite }: Props) {
  const [rows, setRows] = useState<DocRow[]>([])
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<number, string>>({})

  const key = `${myId}-${reloadKey}`

  useEffect(() => {
    if (myId == null || loadedKey === key) return
    let cancelled = false
    supabase
      .from('approval_documents')
      .select('document_id, doc_no, status, summary, approval_lines(*)')
      .eq('doc_type', 'showroom_usage')
      .eq('requester_id', myId)
      .in('status', ['진행중', '반려', '회수'])
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('[showroom] my requests load failed', error)
        setRows(error ? [] : (data ?? []) as unknown as DocRow[])
        setLoadedKey(key)
      })
    return () => { cancelled = true }
  }, [supabase, myId, key, loadedKey])

  if (rows.length === 0) return null

  const openPdf = async (row: DocRow) => {
    setRowError(prev => ({ ...prev, [row.document_id]: '' }))
    const message = await openApprovalPdf(row.document_id, 'doc')
    if (message) setRowError(prev => ({ ...prev, [row.document_id]: message }))
  }

  return (
    <div style={{ ...cardStyle, marginBottom: 12 }}>
      <div style={{ ...cardHeader, paddingBottom: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>내 사용 신청</span>
        <span style={countBadge}>{rows.length}건</span>
      </div>
      {rows.map((r, i) => {
        const p = r.summary?.payload
        if (!p) return null
        const done = r.status === '반려' || r.status === '회수'
        const retro = r.summary.is_retroactive === true
        const err = rowError[r.document_id]
        // 진행중이면 지금 차례를, 반려면 반려한 사람의 사유를 결재선에서 읽는다.
        const lines = [...(r.approval_lines ?? [])]
          .filter(l => l.kind !== 'cc')
          .sort((a, b) => (a.step ?? 0) - (b.step ?? 0) || a.line_id - b.line_id)
        const waiting = lines.find(l => l.state === '대기')
        const rejected = lines.find(l => l.state === '반려')
        const total = lines.length
        const step = waiting?.step ?? total
        return (
          <div key={r.document_id} style={{ padding: '8px 0', borderTop: i === 0 ? 'none' : `1px solid ${BORDER}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* 상태 — 색은 점에만 */}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: done ? DANGER : MUTED }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: TEXT }}>
                  {r.status === '반려' ? '반려' : r.status === '회수' ? '회수' : retro ? '확인 대기' : '승인 대기'}
                </span>
              </span>
              {r.status === '진행중' && total > 1 && (
                <span className="num" style={{ fontSize: 11, color: MUTED }}>{step}/{total}</span>
              )}
              <span style={{ color: FAINT }}>·</span>
              <span className="num" style={{ fontSize: 12, color: SUB }}>{r.doc_no}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{p.device_name}</span>
              <span style={{ fontSize: 13, color: SUB }}>{p.customer_name ?? '-'}</span>
              <span className="num" style={{ fontSize: 12, color: MUTED }}>
                {p.usage_date} {normTime(p.start_time)}~{normTime(p.end_time)}
              </span>
              {retro && <span style={{ fontSize: 11, fontWeight: 700, color: SUB }}>사후</span>}
              <div style={{ flex: 1 }} />
              {r.summary.pdf_url && <button type="button" onClick={() => openPdf(r)} style={linkBtn}>승인서</button>}
              {done && (
                <button type="button"
                  onClick={() => onRewrite({ document_id: r.document_id, summary: r.summary, comment: rejected?.comment ?? null })}
                  style={linkBtn}>
                  재작성
                </button>
              )}
            </div>
            {r.status === '반려' && rejected?.comment && (
              <div style={{ marginTop: 4, fontSize: 12, color: SUB, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <span style={{ fontWeight: 700, color: DANGER }}>반려 사유 </span>{rejected.comment}
              </div>
            )}
            {err && <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: DANGER }}>{err}</div>}
          </div>
        )
      })}
    </div>
  )
}
