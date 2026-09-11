'use client'

// 통합 요청함. 1차는 견적 삭제 요청 하나만 다룬다.
//
// 유형을 늘릴 때는 REQUEST_TYPES 에 한 줄 추가하고 그 유형의 조회·처리 라우트를 붙이면 된다.
// 목록·처리는 전부 /api/requests/* 를 거친다 — 화면에서 quotes 를 직접 쓰지 않는다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { canViewAdmin } from '@/lib/permissions'
import SegmentedControl from '@/components/common/SegmentedControl'
import { numKR } from '@/components/customer/constants'
import {
  PAGE_BG, BORDER, TEXT, MUTED, SUB, DANGER, FAINT,
  cardStyle, cardHeader, cardTitle, countBadge,
  rowStyle, ROW_HOVER_BG, rowTitle, rowSub,
  btnPrimary, btnGhost, btnDanger,
  PULSE_KEYFRAMES, skeletonBlock, inputStyle,
} from '@/components/common/ui'

// 유형 정의. dot 색은 새로 만들지 않고 lib/categoryColors.ts 의 B/S 색(#f43f5e)을 재사용한다.
type RequestTypeDef = {
  key: string
  label: string
  dot: string
  /** 사유 영역에 붙일 라벨. */
  reasonLabel: string
}
const REQUEST_TYPES: RequestTypeDef[] = [
  { key: 'quote_delete', label: '견적 삭제', dot: '#f43f5e', reasonLabel: '삭제 사유' },
]

const ALL = '전체'
/** 삭제 승인은 두 번 눌러야 실행된다. 첫 클릭 뒤 이 시간이 지나면 원래대로 돌아간다. */
const CONFIRM_MS = 3000

type PendingRequest = {
  quote_id: number
  quote_number: string | null
  quote_date: string | null
  customer_name: string | null
  total_supply: number | null
  engineer_name: string | null
  delete_reason: string | null
  requested_at: string | null
  requester_name: string | null
  prev_status: string | null
}
type Row = PendingRequest & { type: string }

const typeDef = (key: string) => REQUEST_TYPES.find(t => t.key === key) ?? REQUEST_TYPES[0]

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function SkeletonRow({ first }: { first: boolean }) {
  return (
    <div style={{ ...rowStyle(first), display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={skeletonBlock(240, 15)} />
      <div style={skeletonBlock(340, 12)} />
    </div>
  )
}

export default function RequestsPage() {
  const { loading: guardLoading, authorized } = usePageGuard(canViewAdmin)

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState(ALL)

  const [busyId, setBusyId] = useState<number | null>(null)
  const [rowError, setRowError] = useState<Record<number, string>>({})
  const [rejectId, setRejectId] = useState<number | null>(null)
  const [rejectText, setRejectText] = useState('')
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearConfirm = useCallback(() => {
    if (confirmTimer.current) { clearTimeout(confirmTimer.current); confirmTimer.current = null }
    setConfirmId(null)
  }, [])

  const armConfirm = (id: number) => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    setConfirmId(id)
    confirmTimer.current = setTimeout(() => { confirmTimer.current = null; setConfirmId(null) }, CONFIRM_MS)
  }

  // 다른 곳을 클릭하면 확정 대기를 푼다. 버튼 자신의 클릭까지 잡히지 않도록 다음 틱부터 듣는다.
  useEffect(() => {
    if (confirmId == null) return
    const off = () => clearConfirm()
    const id = setTimeout(() => document.addEventListener('click', off), 0)
    return () => { clearTimeout(id); document.removeEventListener('click', off) }
  }, [confirmId, clearConfirm])

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current) }, [])

  /** silent 면 스켈레톤을 띄우지 않는다(409 뒤 재조회처럼 화면이 깜빡이면 안 되는 경우). */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/requests/quote-delete')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRows([])
        setLoadError(body?.error || '요청 목록을 불러오지 못했습니다.')
        return
      }
      setRows(((body?.requests ?? []) as PendingRequest[]).map(r => ({ ...r, type: 'quote_delete' })))
      setLoadError(null)
    } catch (e) {
      console.error('[requests] load failed', e)
      setRows([])
      setLoadError('요청 목록을 불러오지 못했습니다.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { if (authorized) load() }, [authorized, load])

  const act = async (row: Row, action: 'approve' | 'reject', comment?: string) => {
    setBusyId(row.quote_id)
    setRowError(prev => ({ ...prev, [row.quote_id]: '' }))
    try {
      const res = await fetch('/api/requests/quote-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: row.quote_id, action, comment }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 409) {
        // 그사이 누가 먼저 처리했다. 목록을 다시 읽어 실제 상태에 맞춘다.
        setRowError(prev => ({ ...prev, [row.quote_id]: body?.error || '이미 처리된 요청입니다' }))
        await load(true)
        return
      }
      if (!res.ok) {
        setRowError(prev => ({ ...prev, [row.quote_id]: body?.error || '처리에 실패했습니다.' }))
        return
      }
      setRows(prev => prev.filter(r => r.quote_id !== row.quote_id))
      setRejectId(null)
      setRejectText('')
      clearConfirm()
    } catch (e) {
      console.error('[requests] action failed', { quoteId: row.quote_id, action, error: e })
      setRowError(prev => ({ ...prev, [row.quote_id]: '처리 중 오류가 발생했습니다.' }))
    } finally {
      setBusyId(null)
    }
  }

  if (!authorized) return <AccessGate loading={guardLoading} />

  const filtered = typeFilter === ALL
    ? rows
    : rows.filter(r => r.type === (REQUEST_TYPES.find(t => t.label === typeFilter)?.key ?? ''))

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <style>{PULSE_KEYFRAMES}</style>

      <div style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* 유형 필터 */}
        <div style={{ ...cardStyle, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <SegmentedControl
              value={typeFilter}
              options={[ALL, ...REQUEST_TYPES.map(t => t.label)]}
              onChange={setTypeFilter}
            />
          </div>
        </div>

        {/* 대기 목록 */}
        <div style={cardStyle}>
          <div style={cardHeader}>
            <span style={cardTitle}>대기 중인 요청</span>
            <span style={countBadge}>{filtered.length}건</span>
          </div>

          {loading ? (
            <>
              <SkeletonRow first />
              <SkeletonRow first={false} />
              <SkeletonRow first={false} />
            </>
          ) : loadError ? (
            <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 14, fontWeight: 600, color: DANGER }}>
              {loadError}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 14, fontWeight: 600, color: SUB }}>
              대기 중인 요청이 없습니다
            </div>
          ) : (
            filtered.map((r, i) => {
              const def = typeDef(r.type)
              const busy = busyId === r.quote_id
              const armed = confirmId === r.quote_id
              const err = rowError[r.quote_id]
              const rejecting = rejectId === r.quote_id
              return (
                <div
                  key={`${r.type}-${r.quote_id}`}
                  style={rowStyle(i === 0)}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = ROW_HOVER_BG }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>

                      {/* 1줄 — 유형 · 견적번호 · 고객사 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          <span style={{ width: 9, height: 9, borderRadius: '50%', background: def.dot }} />
                          <span style={{ fontSize: 12, fontWeight: 500, color: TEXT }}>{def.label}</span>
                        </span>
                        <span style={{ color: FAINT }}>·</span>
                        <span style={rowTitle}>{r.quote_number ?? '-'}</span>
                        <span style={{ fontSize: 13, color: SUB, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.customer_name ?? '-'}
                        </span>
                      </div>

                      {/* 2줄 — 요청자 · 요청일시 · 담당자 · 공급가 · 반려 시 복원 상태 */}
                      <div style={{ ...rowSub, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span>요청자 {r.requester_name ?? '-'}</span>
                        <span style={{ color: FAINT }}>·</span>
                        <span>{fmtDateTime(r.requested_at)}</span>
                        <span style={{ color: FAINT }}>·</span>
                        <span>담당자 {r.engineer_name ?? '-'}</span>
                        <span style={{ color: FAINT }}>·</span>
                        <span>공급가 ₩{numKR(r.total_supply ?? 0)}</span>
                        <span style={{ color: FAINT }}>·</span>
                        <span>반려 시 → {r.prev_status ?? '견적중'}</span>
                      </div>

                      {/* 3줄 — 삭제 사유 */}
                      {r.delete_reason && (
                        <div style={{
                          display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 8,
                          background: '#fef2f2', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px',
                        }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: DANGER, whiteSpace: 'nowrap' }}>{def.reasonLabel}</span>
                          <span style={{ fontSize: 12, color: TEXT, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
                            {r.delete_reason}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 처리 버튼 */}
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        style={btnGhost(busy)}
                        disabled={busy}
                        onClick={() => {
                          clearConfirm()
                          setRejectId(prev => (prev === r.quote_id ? null : r.quote_id))
                          setRejectText('')
                        }}
                      >
                        반려
                      </button>
                      <button
                        style={btnDanger(busy)}
                        disabled={busy}
                        onClick={() => {
                          if (armed) { clearConfirm(); act(r, 'approve'); return }
                          setRejectId(null)
                          armConfirm(r.quote_id)
                        }}
                      >
                        {busy ? '처리 중...' : armed ? '삭제 확정' : '삭제 승인'}
                      </button>
                    </div>
                  </div>

                  {/* 반려 사유 입력 */}
                  {rejecting && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
                      <textarea
                        value={rejectText}
                        onChange={e => setRejectText(e.target.value)}
                        rows={3}
                        placeholder="반려 사유를 입력해주세요"
                        style={{ ...inputStyle, width: '100%', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }}
                      />
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                        <button
                          style={btnGhost(busy)}
                          disabled={busy}
                          onClick={() => { setRejectId(null); setRejectText('') }}
                        >
                          취소
                        </button>
                        <button
                          style={btnPrimary(busy || !rejectText.trim())}
                          disabled={busy || !rejectText.trim()}
                          onClick={() => act(r, 'reject', rejectText)}
                        >
                          반려 확정
                        </button>
                      </div>
                    </div>
                  )}

                  {err && (
                    <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: DANGER }}>{err}</div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: MUTED }}>
          * 삭제 승인은 되돌릴 수 없습니다. 반려하면 요청 직전 상태로 돌아갑니다.
        </div>
      </div>
    </main>
  )
}
