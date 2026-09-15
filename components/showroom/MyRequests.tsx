'use client'

// 내 데모 신청 — 전체기록 탭 위쪽. 내가 낸 신청 중 대기중·반려만 보인다(없으면 카드 자체를 그리지 않는다).
//   · 대기중 — 승인(사후 신청은 확인)을 기다리는 중
//   · 반려   — 반려 사유와 [재작성]. 재작성하면 다시 대기중이 된다.
// 읽기는 화면에서 직접 한다 — approval_requests 의 읽기 정책이 본인 신청을 허용한다.
// 조회는 effect 에서 외부 응답을 받은 콜백으로만 반영한다 — '불러오는 중'은 요청 키로 파생시킨다.

import { useEffect, useState } from 'react'
import type { createClient } from '@/lib/supabase/client'
import { normTime } from '@/lib/workHours'
import {
  DEMO_REQUEST_TYPE, REQUEST_PENDING, REQUEST_REJECTED,
  type DemoRequestRow,
} from '@/lib/showroom'
import {
  BLUE, BORDER, TEXT, MUTED, SUB, DANGER, FAINT,
  cardStyle, cardHeader, countBadge,
} from '@/components/common/ui'
import { openApprovalPdf } from './openApprovalPdf'

type Browser = ReturnType<typeof createClient>

const linkBtn = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: BLUE, fontFamily: 'inherit', whiteSpace: 'nowrap' } as const

type Props = {
  supabase: Browser
  myId: number | null
  /** 신청·재작성 뒤 올라가는 값. 바뀌면 다시 읽는다. */
  reloadKey: number
  onRewrite: (row: DemoRequestRow) => void
}

export default function MyRequests({ supabase, myId, reloadKey, onRewrite }: Props) {
  const [rows, setRows] = useState<DemoRequestRow[]>([])
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<number, string>>({})

  const key = `${myId}-${reloadKey}`

  useEffect(() => {
    if (myId == null || loadedKey === key) return
    let cancelled = false
    supabase
      .from('approval_requests')
      .select('request_id, status, payload, reason, comment, pdf_url, created_at, decided_at')
      .eq('request_type', DEMO_REQUEST_TYPE)
      .eq('requester_id', myId)
      .in('status', [REQUEST_PENDING, REQUEST_REJECTED])
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('[showroom] my requests load failed', error)
        setRows(error ? [] : (data ?? []) as unknown as DemoRequestRow[])
        setLoadedKey(key)
      })
    return () => { cancelled = true }
  }, [supabase, myId, key, loadedKey])

  if (rows.length === 0) return null

  const openPdf = async (row: DemoRequestRow) => {
    setRowError(prev => ({ ...prev, [row.request_id]: '' }))
    const message = await openApprovalPdf(row.request_id)
    if (message) setRowError(prev => ({ ...prev, [row.request_id]: message }))
  }

  return (
    <div style={{ ...cardStyle, marginBottom: 12 }}>
      <div style={{ ...cardHeader, paddingBottom: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>내 데모 신청</span>
        <span style={countBadge}>{rows.length}건</span>
      </div>
      {rows.map((r, i) => {
        const p = r.payload
        const rejected = r.status === REQUEST_REJECTED
        const err = rowError[r.request_id]
        return (
          <div key={r.request_id} style={{ padding: '8px 0', borderTop: i === 0 ? 'none' : `1px solid ${BORDER}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* 상태 — 색은 점에만 */}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: rejected ? DANGER : MUTED }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: TEXT }}>
                  {rejected ? '반려' : p.is_retroactive ? '확인 대기' : '승인 대기'}
                </span>
              </span>
              <span style={{ color: FAINT }}>·</span>
              <span className="num" style={{ fontSize: 12, color: SUB }}>{p.request_no}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{p.device_name}</span>
              <span style={{ fontSize: 13, color: SUB }}>{p.customer_name}</span>
              <span className="num" style={{ fontSize: 12, color: MUTED }}>
                {p.usage_date} {normTime(p.start_time)}~{normTime(p.end_time)}
              </span>
              {p.is_retroactive && <span style={{ fontSize: 11, fontWeight: 700, color: SUB }}>사후</span>}
              <div style={{ flex: 1 }} />
              {r.pdf_url && <button type="button" onClick={() => openPdf(r)} style={linkBtn}>승인서</button>}
              {rejected && <button type="button" onClick={() => onRewrite(r)} style={linkBtn}>재작성</button>}
            </div>
            {rejected && r.comment && (
              <div style={{ marginTop: 4, fontSize: 12, color: SUB, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <span style={{ fontWeight: 700, color: DANGER }}>반려 사유 </span>{r.comment}
              </div>
            )}
            {err && <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: DANGER }}>{err}</div>}
          </div>
        )
      })}
    </div>
  )
}
