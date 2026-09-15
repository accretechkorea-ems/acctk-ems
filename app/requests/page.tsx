'use client'

// 통합 요청함 — 견적 삭제 요청 · 쇼룸 데모 신청.
//
// 유형을 늘릴 때 건드릴 곳
//   1. REQUEST_TYPES 에 한 줄 추가 — 필터 칸은 이 목록에서 자동으로 늘어난다.
//   2. 그 유형의 조회·처리 라우트 /api/requests/<유형> (GET 목록 · POST 처리)
//   3. 이 화면의 load() 에서 불러 Row 로 바꾸는 부분, 행 그리기(render…)와 처리(act…)
// 목록·처리는 전부 /api/requests/* 를 거친다 — 화면에서 quotes·approval_requests 를 직접 쓰지 않는다.
//   · 견적 삭제 — /api/requests/quote-delete (관리자 팀 권한)
//   · 데모 신청 — /api/requests/showroom-demo. 목록은 관리자 팀 모두 보고, 승인·반려·확인은 superadmin 만 한다
//     (본인 신청은 다른 superadmin 이 처리). 사후 신청은 이미 끝난 사용이라 반려가 없고 [확인]만 있다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { canViewAdmin } from '@/lib/permissions'
import SegmentedControl from '@/components/common/SegmentedControl'
import { numKR } from '@/components/customer/constants'
import { SERVICE_TYPE_COLORS } from '@/lib/categoryColors'
import { normTime } from '@/lib/workHours'
import type { DemoRequestPayload } from '@/lib/showroom'
import { openApprovalPdf } from '@/components/showroom/openApprovalPdf'
import {
  PAGE_BG, BORDER, TEXT, MUTED, SUB, DANGER, FAINT, BLUE, NEUTRAL_BG,
  cardStyle, cardHeader, cardTitle, countBadge,
  rowStyle, ROW_HOVER_BG, rowTitle, rowSub,
  btnPrimary, btnGhost, btnDanger,
  PULSE_KEYFRAMES, skeletonBlock, inputStyle,
} from '@/components/common/ui'

// 유형 정의. dot 색은 새로 만들지 않고 lib/categoryColors.ts 의 서비스 유형 색을 재사용한다
// (견적 삭제 = B/S 색, 데모 신청 = 신규설치 색).
type RequestTypeKey = 'quote_delete' | 'showroom_demo'
type RequestTypeDef = {
  key: RequestTypeKey
  label: string
  dot: string
  /** 사유 영역에 붙일 라벨. */
  reasonLabel: string
}
const REQUEST_TYPES: RequestTypeDef[] = [
  { key: 'quote_delete', label: '견적 삭제', dot: '#f43f5e', reasonLabel: '삭제 사유' },
  { key: 'showroom_demo', label: '데모 신청', dot: SERVICE_TYPE_COLORS['신규설치'].dot, reasonLabel: '신청 사유' },
]

const ALL = '전체'
/** 삭제 승인은 두 번 눌러야 실행된다. 첫 클릭 뒤 이 시간이 지나면 원래대로 돌아간다. */
const CONFIRM_MS = 3000

type QuoteDeleteRequest = {
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
type DemoRequest = {
  request_id: number
  created_at: string
  reason: string | null
  has_pdf: boolean
  requester_name: string
  is_self: boolean
  can_decide: boolean
  payload: DemoRequestPayload
}
/** 목록 한 줄. key 는 유형까지 넣은 고유값(견적 id 와 신청 id 가 겹칠 수 있다). at 은 정렬용 요청 시각. */
type Row =
  | { type: 'quote_delete'; key: string; at: string | null; quote: QuoteDeleteRequest }
  | { type: 'showroom_demo'; key: string; at: string | null; demo: DemoRequest }

const typeDef = (key: RequestTypeKey) => REQUEST_TYPES.find(t => t.key === key) ?? REQUEST_TYPES[0]

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 목록 조회. 실패하면 화면에 띄울 메시지를 돌려준다(다른 유형은 그대로 보여 준다). */
async function fetchList<T>(url: string, label: string): Promise<{ items: T[]; error: string | null }> {
  try {
    const res = await fetch(url)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { items: [], error: `${label}: ${body?.error || '목록을 불러오지 못했습니다.'}` }
    return { items: (body?.requests ?? []) as T[], error: null }
  } catch (e) {
    console.error('[requests] load failed', { url, error: e })
    return { items: [], error: `${label}: 목록을 불러오지 못했습니다.` }
  }
}

function SkeletonRow({ first }: { first: boolean }) {
  return (
    <div style={{ ...rowStyle(first), display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={skeletonBlock(240, 15)} />
      <div style={skeletonBlock(340, 12)} />
    </div>
  )
}

/** 사유 상자 — 견적 삭제는 붉은 바탕(되돌릴 수 없는 일), 데모 신청은 중립 바탕. */
function ReasonBox({ label, text, danger }: { label: string; text: string; danger: boolean }) {
  return (
    <div style={{
      display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 8,
      background: danger ? '#fef2f2' : NEUTRAL_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px',
    }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: danger ? DANGER : SUB, whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 12, color: TEXT, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>{text}</span>
    </div>
  )
}

const dot = { color: FAINT } as const
const linkBtn = {
  background: 'none', border: 'none', padding: '7px 4px', cursor: 'pointer',
  fontSize: 13, fontWeight: 700, color: BLUE, fontFamily: 'inherit', whiteSpace: 'nowrap',
} as const

export default function RequestsPage() {
  const { loading: guardLoading, authorized } = usePageGuard(canViewAdmin)

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErrors, setLoadErrors] = useState<string[]>([])
  const [typeFilter, setTypeFilter] = useState(ALL)

  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [rejectKey, setRejectKey] = useState<string | null>(null)
  const [rejectText, setRejectText] = useState('')
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearConfirm = useCallback(() => {
    if (confirmTimer.current) { clearTimeout(confirmTimer.current); confirmTimer.current = null }
    setConfirmKey(null)
  }, [])

  const armConfirm = (key: string) => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    setConfirmKey(key)
    confirmTimer.current = setTimeout(() => { confirmTimer.current = null; setConfirmKey(null) }, CONFIRM_MS)
  }

  // 다른 곳을 클릭하면 확정 대기를 푼다. 버튼 자신의 클릭까지 잡히지 않도록 다음 틱부터 듣는다.
  useEffect(() => {
    if (confirmKey == null) return
    const off = () => clearConfirm()
    const id = setTimeout(() => document.addEventListener('click', off), 0)
    return () => { clearTimeout(id); document.removeEventListener('click', off) }
  }, [confirmKey, clearConfirm])

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current) }, [])

  /** 두 유형을 함께 읽어 요청 시각 내림차순으로 합친다. silent 면 스켈레톤을 띄우지 않는다(409 뒤 재조회). */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const [quotes, demos] = await Promise.all([
      fetchList<QuoteDeleteRequest>('/api/requests/quote-delete', '견적 삭제'),
      fetchList<DemoRequest>('/api/requests/showroom-demo', '데모 신청'),
    ])
    const merged: Row[] = [
      ...quotes.items.map(q => ({ type: 'quote_delete' as const, key: `q-${q.quote_id}`, at: q.requested_at, quote: q })),
      ...demos.items.map(d => ({ type: 'showroom_demo' as const, key: `d-${d.request_id}`, at: d.created_at, demo: d })),
    ].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    setRows(merged)
    setLoadErrors([quotes.error, demos.error].filter((e): e is string => !!e))
    if (!silent) setLoading(false)
  }, [])

  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    // 첫 조회 — 결과는 load 안의 setState 로 반영된다(effect 본문에서 곧바로 setState 하지 않는다).
    Promise.resolve().then(() => { if (!cancelled) load() })
    return () => { cancelled = true }
  }, [authorized, load])

  /** 처리 요청 공통 — 성공이면 줄을 빼고, 409 면 다시 읽어 실제 상태에 맞춘다. */
  const send = async (row: Row, url: string, payload: Record<string, unknown>) => {
    setBusyKey(row.key)
    setRowError(prev => ({ ...prev, [row.key]: '' }))
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await res.json().catch(() => ({}))
      if (res.status === 409) {
        setRowError(prev => ({ ...prev, [row.key]: body?.error || '이미 처리된 요청입니다' }))
        await load(true)
        return
      }
      if (!res.ok) {
        setRowError(prev => ({ ...prev, [row.key]: body?.error || '처리에 실패했습니다.' }))
        return
      }
      setRows(prev => prev.filter(r => r.key !== row.key))
      setRejectKey(null)
      setRejectText('')
      clearConfirm()
    } catch (e) {
      console.error('[requests] action failed', { key: row.key, error: e })
      setRowError(prev => ({ ...prev, [row.key]: '처리 중 오류가 발생했습니다.' }))
    } finally {
      setBusyKey(null)
    }
  }

  const act = (row: Row, action: 'approve' | 'reject' | 'confirm', comment?: string) =>
    row.type === 'quote_delete'
      ? send(row, '/api/requests/quote-delete', { quoteId: row.quote.quote_id, action, comment })
      : send(row, '/api/requests/showroom-demo', { requestId: row.demo.request_id, action, comment })

  const openPdf = async (row: Row & { type: 'showroom_demo' }) => {
    setRowError(prev => ({ ...prev, [row.key]: '' }))
    const message = await openApprovalPdf(row.demo.request_id)
    if (message) setRowError(prev => ({ ...prev, [row.key]: message }))
  }

  if (!authorized) return <AccessGate loading={guardLoading} />

  const filtered = typeFilter === ALL
    ? rows
    : rows.filter(r => r.type === (REQUEST_TYPES.find(t => t.label === typeFilter)?.key ?? ''))

  /** 반려 버튼 — 누르면 아래에 사유 입력칸이 열린다. */
  const rejectButton = (r: Row, busy: boolean) => (
    <button style={btnGhost(busy)} disabled={busy}
      onClick={() => { clearConfirm(); setRejectKey(prev => (prev === r.key ? null : r.key)); setRejectText('') }}>
      반려
    </button>
  )

  // ── 견적 삭제 한 줄 ──
  const renderQuote = (r: Row & { type: 'quote_delete' }, busy: boolean) => {
    const q = r.quote
    const def = typeDef(r.type)
    const armed = confirmKey === r.key
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 1줄 — 유형 · 견적번호 · 고객사 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: def.dot }} />
              <span style={{ fontSize: 12, fontWeight: 500, color: TEXT }}>{def.label}</span>
            </span>
            <span style={dot}>·</span>
            <span style={rowTitle}>{q.quote_number ?? '-'}</span>
            <span style={{ fontSize: 13, color: SUB, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {q.customer_name ?? '-'}
            </span>
          </div>
          {/* 2줄 — 요청자 · 요청일시 · 담당자 · 공급가 · 반려 시 복원 상태 */}
          <div style={{ ...rowSub, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>요청자 {q.requester_name ?? '-'}</span>
            <span style={dot}>·</span>
            <span>{fmtDateTime(q.requested_at)}</span>
            <span style={dot}>·</span>
            <span>담당자 {q.engineer_name ?? '-'}</span>
            <span style={dot}>·</span>
            <span>공급가 ₩{numKR(q.total_supply ?? 0)}</span>
            <span style={dot}>·</span>
            <span>반려 시 → {q.prev_status ?? '견적중'}</span>
          </div>
          {/* 3줄 — 삭제 사유 */}
          {q.delete_reason && <ReasonBox label={def.reasonLabel} text={q.delete_reason} danger />}
        </div>
        {/* 처리 버튼 */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {rejectButton(r, busy)}
          <button style={btnDanger(busy)} disabled={busy}
            onClick={() => {
              if (armed) { clearConfirm(); act(r, 'approve'); return }
              setRejectKey(null)
              armConfirm(r.key)
            }}>
            {busy ? '처리 중...' : armed ? '삭제 확정' : '삭제 승인'}
          </button>
        </div>
      </div>
    )
  }

  // ── 데모 신청 한 줄 ──
  const renderDemo = (r: Row & { type: 'showroom_demo' }, busy: boolean) => {
    const d = r.demo
    const p = d.payload
    const def = typeDef(r.type)
    const retro = p.is_retroactive
    const names = p.engineer_names.filter(Boolean).join(', ')
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 1줄 — 유형 · 장비 · 대상 고객사 · 사후 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: def.dot }} />
              <span style={{ fontSize: 12, fontWeight: 500, color: TEXT }}>{def.label}</span>
            </span>
            <span style={dot}>·</span>
            <span style={rowTitle}>{p.device_name}</span>
            <span style={{ fontSize: 13, color: SUB, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.customer_name}
            </span>
            {retro && (
              <span style={{ ...countBadge, padding: '2px 8px' }}>사후</span>
            )}
          </div>
          {/* 2줄 — 신청자 · 신청일시 · 계획(사용)일시 · 참여 엔지니어 */}
          <div style={{ ...rowSub, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>신청자 {d.requester_name}</span>
            <span style={dot}>·</span>
            <span>{fmtDateTime(d.created_at)}</span>
            <span style={dot}>·</span>
            <span>{retro ? '사용' : '계획'} {p.usage_date} {normTime(p.start_time)}~{normTime(p.end_time)}</span>
            <span style={dot}>·</span>
            <span>참여 {names || '-'}</span>
            <span style={dot}>·</span>
            <span className="num">{p.request_no}</span>
          </div>
          {/* 3줄 — 신청 사유 */}
          {d.reason && <ReasonBox label={def.reasonLabel} text={d.reason} danger={false} />}
        </div>
        {/* 승인서 · 처리 버튼. 사후 신청은 이미 끝난 사용이라 반려 없이 [확인]만 둔다. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {d.has_pdf && <button type="button" style={linkBtn} onClick={() => openPdf(r)}>승인서</button>}
          {!d.can_decide ? (
            <span style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>
              {d.is_self ? '본인 신청 — 다른 관리자가 처리' : 'superadmin 이 처리합니다'}
            </span>
          ) : retro ? (
            <button style={btnPrimary(busy)} disabled={busy} onClick={() => act(r, 'confirm')}>
              {busy ? '처리 중...' : '확인'}
            </button>
          ) : (
            <>
              {rejectButton(r, busy)}
              <button style={btnPrimary(busy)} disabled={busy} onClick={() => { setRejectKey(null); act(r, 'approve') }}>
                {busy ? '처리 중...' : '승인'}
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <style>{PULSE_KEYFRAMES}</style>

      <div style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* 유형 필터 — REQUEST_TYPES 에서 칸이 자동으로 늘어난다 */}
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

          {!loading && loadErrors.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {loadErrors.map(e => <div key={e} style={{ fontSize: 13, fontWeight: 600, color: DANGER }}>{e}</div>)}
            </div>
          )}

          {loading ? (
            <>
              <SkeletonRow first />
              <SkeletonRow first={false} />
              <SkeletonRow first={false} />
            </>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 14, fontWeight: 600, color: SUB }}>
              대기 중인 요청이 없습니다
            </div>
          ) : (
            filtered.map((r, i) => {
              const busy = busyKey === r.key
              const err = rowError[r.key]
              const rejecting = rejectKey === r.key
              return (
                <div
                  key={r.key}
                  style={rowStyle(i === 0)}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = ROW_HOVER_BG }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                >
                  {r.type === 'quote_delete' ? renderQuote(r, busy) : renderDemo(r, busy)}

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
                        <button style={btnGhost(busy)} disabled={busy} onClick={() => { setRejectKey(null); setRejectText('') }}>
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

        <div style={{ marginTop: 12, fontSize: 12, color: MUTED, lineHeight: 1.7 }}>
          * 삭제 승인은 되돌릴 수 없습니다. 반려하면 요청 직전 상태로 돌아갑니다.<br />
          * 데모 신청은 superadmin 이 처리합니다. 승인하면 계획 시간으로 사용 기록이 만들어집니다.
          사후 신청은 이미 끝난 사용이라 [확인]만 합니다.
        </div>
      </div>
    </main>
  )
}
