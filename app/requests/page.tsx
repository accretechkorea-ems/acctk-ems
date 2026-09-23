'use client'

// 통합 요청함 — 견적 삭제 요청 · 쇼룸 데모 신청.
//
// 두 축으로 거른다: 상태(대기 · 처리완료 · 전체, 기본 대기) × 유형(전체 · 견적 삭제 · 데모 신청).
//   대기     — 처리할 건. 처리 버튼이 있다. 요청 시각 내림차순.
//   처리완료 — 승인·반려·확인된 건(유형마다 최근 50건). 버튼 대신 처리 결과(무엇 · 누가 · 언제)를 보인다.
//              처리일시 내림차순. 그 상태를 처음 볼 때 불러온다(대기만 보는 동안은 부르지 않는다).
//   전체     — 대기 건 위, 처리완료 건 아래.
//
// 유형을 늘릴 때 건드릴 곳
//   1. REQUEST_TYPES 에 한 줄 추가 — 유형 필터 칸은 이 목록에서 자동으로 늘어난다.
//   2. 그 유형의 조회·처리 라우트 /api/requests/<유형> (GET 목록 · POST 처리, 처리완료 목록)
//   3. 이 화면의 load()·loadDone() 에서 불러 Row 로 바꾸는 부분, 행 그리기(render…)와 처리(act)
// 목록·처리는 전부 /api/requests/* 를 거친다 — 화면에서 quotes·approval_requests 를 직접 쓰지 않는다.
//   · 견적 삭제 — 대기·처리 /api/requests/quote-delete (관리자 팀 권한).
//                 처리완료는 /api/requests/quote-delete-history — 처리 이력 테이블이 없어 감사 기록에서 되살린다.
//   · 데모 신청 — /api/requests/showroom-demo (?status=done 이면 처리완료). 목록은 관리자 팀 모두 보고,
//     승인·반려·확인은 superadmin 만 한다(본인 신청은 다른 superadmin 이 처리).
//     사후 신청은 이미 끝난 사용이라 반려가 없고 [확인]만 있다.
//     [승인]·[확인]을 누르면 행 아래에 의견 입력칸(선택)이 열리고 [승인 확정]·[확인 완료]로 처리한다.
//     의견은 approval_requests.comment 에 저장되어 승인서 PDF 의견란에 들어간다. 반려는 사유가 필수다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import SegmentedControl from '@/components/common/SegmentedControl'
import { numKR } from '@/components/customer/constants'
import { SERVICE_TYPE_COLORS, getCategoryColor } from '@/lib/categoryColors'
import { normTime } from '@/lib/workHours'
import { demoStatusLabel, requestPurpose, USAGE_PURPOSE_COLORS, type DemoRequestPayload } from '@/lib/showroom'
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
  { key: 'showroom_demo', label: '사용 신청', dot: SERVICE_TYPE_COLORS['신규설치'].dot, reasonLabel: '신청 사유' },
]

const ALL = '전체'
// 상태 축
const STATUS_PENDING = '대기'
const STATUS_DONE = '처리완료'
const STATUS_ALL = '전체'
const STATUS_OPTIONS = [STATUS_PENDING, STATUS_DONE, STATUS_ALL]

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
/** 처리가 끝난 견적 삭제 요청(감사 기록에서 되살린 것). */
type QuoteDeleteHistory = {
  key: string
  result: 'approved' | 'rejected'
  decided_at: string
  decider_name: string | null
  quote_number: string | null
  customer_name: string | null
  total_supply: number | null
  engineer_name: string | null
  delete_reason: string | null
  reject_reason: string | null
  restored_status: string | null
}
type DemoRequest = {
  request_id: number
  status: string
  created_at: string
  decided_at: string | null
  reason: string | null
  comment: string | null
  has_pdf: boolean
  requester_name: string
  approver_name: string | null
  is_self: boolean
  can_decide: boolean
  payload: DemoRequestPayload
}
/** 목록 한 줄. key 는 유형·상태까지 넣은 고유값(견적 id 와 신청 id 가 겹칠 수 있다). at 은 정렬 시각. */
type Row =
  | { type: 'quote_delete'; state: 'pending'; key: string; at: string | null; quote: QuoteDeleteRequest }
  | { type: 'quote_delete'; state: 'done'; key: string; at: string | null; history: QuoteDeleteHistory }
  | { type: 'showroom_demo'; state: 'pending' | 'done'; key: string; at: string | null; demo: DemoRequest }
type QuotePendingRow = Extract<Row, { type: 'quote_delete'; state: 'pending' }>
type QuoteDoneRow = Extract<Row, { type: 'quote_delete'; state: 'done' }>
type DemoRow = Extract<Row, { type: 'showroom_demo' }>

const typeDef = (key: RequestTypeKey) => REQUEST_TYPES.find(t => t.key === key) ?? REQUEST_TYPES[0]
/** 시각 내림차순(없으면 뒤). */
const byAtDesc = (a: Row, b: Row) => (b.at ?? '').localeCompare(a.at ?? '')

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

/** 사유 상자 — 견적 삭제는 붉은 바탕(되돌릴 수 없는 일), 그 밖은 중립 바탕. */
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

/** 처리 결과 — 「승인 · 홍길동 · 2026-09-15 14:30」. 처리완료 행에서 버튼 자리에 놓인다. */
function ResultLine({ label, name, at }: { label: string; name: string | null; at: string | null }) {
  return (
    <span style={{ fontSize: 12, color: SUB, whiteSpace: 'nowrap' }}>
      <span style={{ fontWeight: 700, color: TEXT }}>{label}</span>
      <span style={{ color: FAINT }}> · </span>{name ?? '-'}
      <span style={{ color: FAINT }}> · </span>{fmtDateTime(at)}
    </span>
  )
}

const dot = { color: FAINT } as const
const linkBtn = {
  background: 'none', border: 'none', padding: '7px 4px', cursor: 'pointer',
  fontSize: 13, fontWeight: 700, color: BLUE, fontFamily: 'inherit', whiteSpace: 'nowrap',
} as const

export default function RequestsPage() {
  const { loading: guardLoading, authorized } = usePageGuard()

  // 대기 목록(처음 들어올 때)과 처리완료 목록(그 상태를 처음 볼 때)은 따로 들고 있다.
  const [pendingRows, setPendingRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErrors, setLoadErrors] = useState<string[]>([])
  const [doneRows, setDoneRows] = useState<Row[]>([])
  const [doneState, setDoneState] = useState<'idle' | 'loading' | 'loaded'>('idle')
  const [doneErrors, setDoneErrors] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState(STATUS_PENDING)
  const [typeFilter, setTypeFilter] = useState(ALL)

  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [rejectKey, setRejectKey] = useState<string | null>(null)
  const [rejectText, setRejectText] = useState('')
  // 데모 신청 승인·확인 의견 — 누른 행 아래에 펼친다(반려 사유 입력과 같은 방식). 의견은 선택이다.
  const [opinion, setOpinion] = useState<{ key: string; action: 'approve' | 'confirm' } | null>(null)
  const [opinionText, setOpinionText] = useState('')
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

  /** 대기 목록 — 두 유형을 함께 읽어 요청 시각 내림차순으로 합친다. silent 면 스켈레톤을 띄우지 않는다(409 뒤 재조회). */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const [quotes, demos] = await Promise.all([
      fetchList<QuoteDeleteRequest>('/api/requests/quote-delete', '견적 삭제'),
      fetchList<DemoRequest>('/api/requests/showroom-demo', '데모 신청'),
    ])
    const merged: Row[] = [
      ...quotes.items.map(q => ({ type: 'quote_delete' as const, state: 'pending' as const, key: `q-${q.quote_id}`, at: q.requested_at, quote: q })),
      ...demos.items.map(d => ({ type: 'showroom_demo' as const, state: 'pending' as const, key: `d-${d.request_id}`, at: d.created_at, demo: d })),
    ].sort(byAtDesc)
    setPendingRows(merged)
    setLoadErrors([quotes.error, demos.error].filter((e): e is string => !!e))
    if (!silent) setLoading(false)
  }, [])

  /** 처리완료 목록 — 유형마다 최근 50건. 처리일시 내림차순으로 합친다. */
  const loadDone = useCallback(async () => {
    setDoneState('loading')
    const [quotes, demos] = await Promise.all([
      fetchList<QuoteDeleteHistory>('/api/requests/quote-delete-history', '견적 삭제'),
      fetchList<DemoRequest>('/api/requests/showroom-demo?status=done', '데모 신청'),
    ])
    const merged: Row[] = [
      ...quotes.items.map(h => ({ type: 'quote_delete' as const, state: 'done' as const, key: `qh-${h.key}`, at: h.decided_at, history: h })),
      ...demos.items.map(d => ({ type: 'showroom_demo' as const, state: 'done' as const, key: `dd-${d.request_id}`, at: d.decided_at, demo: d })),
    ].sort(byAtDesc)
    setDoneRows(merged)
    setDoneErrors([quotes.error, demos.error].filter((e): e is string => !!e))
    setDoneState('loaded')
  }, [])

  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    // 첫 조회 — 결과는 load 안의 setState 로 반영된다(effect 본문에서 곧바로 setState 하지 않는다).
    Promise.resolve().then(() => { if (!cancelled) load() })
    return () => { cancelled = true }
  }, [authorized, load])

  // 처리완료는 그 상태를 볼 때 처음 한 번(처리한 뒤에는 다시) 불러온다.
  const needDone = statusFilter !== STATUS_PENDING
  useEffect(() => {
    if (!authorized || !needDone || doneState !== 'idle') return
    let cancelled = false
    Promise.resolve().then(() => { if (!cancelled) loadDone() })
    return () => { cancelled = true }
  }, [authorized, needDone, doneState, loadDone])

  /** 처리 요청 공통 — 성공이면 대기에서 빼고 처리완료를 다시 읽게 한다. 409 면 다시 읽어 실제 상태에 맞춘다. */
  const send = async (row: Row, url: string, payload: Record<string, unknown>) => {
    setBusyKey(row.key)
    setRowError(prev => ({ ...prev, [row.key]: '' }))
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await res.json().catch(() => ({}))
      if (res.status === 409) {
        setRowError(prev => ({ ...prev, [row.key]: body?.error || '이미 처리된 요청입니다' }))
        await load(true)
        setDoneState('idle')
        return
      }
      if (!res.ok) {
        setRowError(prev => ({ ...prev, [row.key]: body?.error || '처리에 실패했습니다.' }))
        return
      }
      setPendingRows(prev => prev.filter(r => r.key !== row.key))
      setDoneState('idle')   // 처리완료에 방금 건이 들어가도록 다음에 볼 때 다시 읽는다
      setRejectKey(null)
      setRejectText('')
      setOpinion(null)
      setOpinionText('')
      clearConfirm()
    } catch (e) {
      console.error('[requests] action failed', { key: row.key, error: e })
      setRowError(prev => ({ ...prev, [row.key]: '처리 중 오류가 발생했습니다.' }))
    } finally {
      setBusyKey(null)
    }
  }

  const act = (row: QuotePendingRow | DemoRow, action: 'approve' | 'reject' | 'confirm', comment?: string) =>
    row.type === 'quote_delete'
      ? send(row, '/api/requests/quote-delete', { quoteId: row.quote.quote_id, action, comment })
      : send(row, '/api/requests/showroom-demo', { requestId: row.demo.request_id, action, comment })

  const openPdf = async (row: DemoRow) => {
    setRowError(prev => ({ ...prev, [row.key]: '' }))
    const message = await openApprovalPdf(row.demo.request_id)
    if (message) setRowError(prev => ({ ...prev, [row.key]: message }))
  }

  if (!authorized) return <AccessGate loading={guardLoading} />

  // ── 두 축으로 거르기 ──
  const byStatus = statusFilter === STATUS_PENDING ? pendingRows
    : statusFilter === STATUS_DONE ? doneRows
      : [...pendingRows, ...doneRows]
  const typeKey = REQUEST_TYPES.find(t => t.label === typeFilter)?.key
  const filtered = typeFilter === ALL ? byStatus : byStatus.filter(r => r.type === typeKey)
  const showPending = statusFilter !== STATUS_DONE
  const listLoading = (showPending && loading) || (needDone && doneState !== 'loaded')
  const errors = [...(showPending ? loadErrors : []), ...(needDone && doneState === 'loaded' ? doneErrors : [])]
  const title = statusFilter === STATUS_PENDING ? '대기 중인 요청' : statusFilter === STATUS_DONE ? '처리 완료' : '전체 요청'
  const emptyText = statusFilter === STATUS_PENDING ? '대기 중인 요청이 없습니다'
    : statusFilter === STATUS_DONE ? '처리한 요청이 없습니다' : '요청이 없습니다'

  /** 반려 버튼 — 누르면 아래에 사유 입력칸이 열린다. */
  const rejectButton = (r: Row, busy: boolean) => (
    <button style={btnGhost(busy)} disabled={busy}
      onClick={() => { clearConfirm(); setOpinion(null); setRejectKey(prev => (prev === r.key ? null : r.key)); setRejectText('') }}>
      반려
    </button>
  )

  /** 데모 신청 [승인]·[확인] — 누르면 아래에 의견 입력칸이 열린다(다시 누르면 닫힌다). */
  const openOpinion = (r: DemoRow, action: 'approve' | 'confirm') => {
    setRejectKey(null)
    setOpinion(prev => (prev?.key === r.key ? null : { key: r.key, action }))
    setOpinionText('')
  }

  /** 1줄 머리 — 유형 dot · 제목 · 부제. */
  const headLine = (type: RequestTypeKey, titleText: string, subText: string, extra?: React.ReactNode) => {
    const def = typeDef(type)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: def.dot }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: TEXT }}>{def.label}</span>
        </span>
        <span style={dot}>·</span>
        <span style={rowTitle}>{titleText}</span>
        <span style={{ fontSize: 13, color: SUB, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {subText}
        </span>
        {extra}
      </div>
    )
  }

  // ── 견적 삭제 — 대기 ──
  const renderQuote = (r: QuotePendingRow, busy: boolean) => {
    const q = r.quote
    const armed = confirmKey === r.key
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {headLine('quote_delete', q.quote_number ?? '-', q.customer_name ?? '-')}
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
          {q.delete_reason && <ReasonBox label={typeDef('quote_delete').reasonLabel} text={q.delete_reason} danger />}
        </div>
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

  // ── 견적 삭제 — 처리완료(감사 기록에서 되살린 것) ──
  const renderQuoteDone = (r: QuoteDoneRow) => {
    const h = r.history
    const rejected = h.result === 'rejected'
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {headLine('quote_delete', h.quote_number ?? '-', h.customer_name ?? '-')}
          <div style={{ ...rowSub, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>담당자 {h.engineer_name ?? '-'}</span>
            <span style={dot}>·</span>
            <span>공급가 ₩{numKR(h.total_supply ?? 0)}</span>
            {rejected && (<>
              <span style={dot}>·</span>
              <span>복원 → {h.restored_status ?? '-'}</span>
            </>)}
          </div>
          {h.delete_reason && <ReasonBox label={typeDef('quote_delete').reasonLabel} text={h.delete_reason} danger />}
          {rejected && h.reject_reason && <ReasonBox label="반려 사유" text={h.reject_reason} danger={false} />}
        </div>
        <div style={{ flexShrink: 0, paddingTop: 2 }}>
          <ResultLine label={rejected ? '반려' : '승인'} name={h.decider_name} at={h.decided_at} />
        </div>
      </div>
    )
  }

  // ── 사용 신청 — 대기·처리완료 공통 본문 ──
  const demoInfo = (d: DemoRequest) => {
    const p = d.payload
    const retro = p.is_retroactive
    const names = p.engineer_names.filter(Boolean).join(', ')
    // 사용목적 — 2026-09-21 부터 5종 전부 신청을 거친다. 목적 칸이 없던 옛 신청은 고객 데모로 읽는다.
    const purpose = requestPurpose(p)
    const pc = getCategoryColor(USAGE_PURPOSE_COLORS, purpose)
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        {headLine('showroom_demo', p.device_name, p.customer_name ?? '-', (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: pc.dot ?? pc.text }} />
              <span style={{ fontSize: 12, fontWeight: 500, color: TEXT }}>{purpose}</span>
            </span>
            {retro && <span style={{ ...countBadge, padding: '2px 8px' }}>사후</span>}
          </>
        ))}
        {/* 2줄 — 신청자 · 신청일시 · 계획(사용)일시 · 참여 엔지니어 · 신청번호 */}
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
        {d.reason && <ReasonBox label={typeDef('showroom_demo').reasonLabel} text={d.reason} danger={false} />}
        {/* 처리완료 — 반려 사유, 또는 승인 의견 */}
        {d.status === '반려' && d.comment && <ReasonBox label="반려 사유" text={d.comment} danger={false} />}
        {d.status !== '반려' && d.status !== '대기중' && d.comment && <ReasonBox label="의견" text={d.comment} danger={false} />}
      </div>
    )
  }

  // ── 데모 신청 — 대기 ──
  const renderDemo = (r: DemoRow, busy: boolean) => {
    const d = r.demo
    const retro = d.payload.is_retroactive
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {demoInfo(d)}
        {/* 승인서 · 처리 버튼. 사후 신청은 이미 끝난 사용이라 반려 없이 [확인]만 둔다. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {d.has_pdf && <button type="button" style={linkBtn} onClick={() => openPdf(r)}>승인서</button>}
          {!d.can_decide ? (
            <span style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>
              {d.is_self ? '본인 신청 — 다른 관리자가 처리' : 'superadmin 이 처리합니다'}
            </span>
          ) : retro ? (
            <button style={btnPrimary(busy)} disabled={busy} onClick={() => openOpinion(r, 'confirm')}>
              {busy ? '처리 중...' : '확인'}
            </button>
          ) : (
            <>
              {rejectButton(r, busy)}
              <button style={btnPrimary(busy)} disabled={busy} onClick={() => openOpinion(r, 'approve')}>
                {busy ? '처리 중...' : '승인'}
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── 데모 신청 — 처리완료: 버튼 대신 처리 결과, 승인서 링크는 그대로 ──
  const renderDemoDone = (r: DemoRow) => {
    const d = r.demo
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {demoInfo(d)}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {d.has_pdf && <button type="button" style={linkBtn} onClick={() => openPdf(r)}>승인서</button>}
          <ResultLine label={demoStatusLabel(d.status, d.payload.is_retroactive)} name={d.approver_name} at={d.decided_at} />
        </div>
      </div>
    )
  }

  const renderRow = (r: Row, busy: boolean) => {
    if (r.type === 'quote_delete') return r.state === 'pending' ? renderQuote(r, busy) : renderQuoteDone(r)
    return r.state === 'pending' ? renderDemo(r, busy) : renderDemoDone(r)
  }

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <style>{PULSE_KEYFRAMES}</style>

      <div style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* 필터 — 상태 축(대기 · 처리완료 · 전체) × 유형 축(전체 · 견적 삭제 · 데모 신청 — REQUEST_TYPES 에서 자동) */}
        <div style={{ ...cardStyle, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <SegmentedControl value={statusFilter} options={STATUS_OPTIONS} onChange={setStatusFilter} />
            <SegmentedControl
              value={typeFilter}
              options={[ALL, ...REQUEST_TYPES.map(t => t.label)]}
              onChange={setTypeFilter}
            />
          </div>
        </div>

        {/* 목록 */}
        <div style={cardStyle}>
          <div style={cardHeader}>
            <span style={cardTitle}>{title}</span>
            <span style={countBadge}>{listLoading ? '…' : `${filtered.length}건`}</span>
          </div>

          {!listLoading && errors.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {errors.map(e => <div key={e} style={{ fontSize: 13, fontWeight: 600, color: DANGER }}>{e}</div>)}
            </div>
          )}

          {listLoading ? (
            <>
              <SkeletonRow first />
              <SkeletonRow first={false} />
              <SkeletonRow first={false} />
            </>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 14, fontWeight: 600, color: SUB }}>
              {emptyText}
            </div>
          ) : (
            filtered.map((r, i) => {
              const busy = busyKey === r.key
              const err = rowError[r.key]
              const rejecting = rejectKey === r.key
              const op = opinion?.key === r.key ? opinion : null
              return (
                <div
                  key={r.key}
                  style={rowStyle(i === 0)}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = ROW_HOVER_BG }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                >
                  {renderRow(r, busy)}

                  {/* 반려 사유 입력 — 대기 건만 연다 */}
                  {rejecting && r.state === 'pending' && (
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
                          onClick={() => act(r as QuotePendingRow | DemoRow, 'reject', rejectText)}
                        >
                          반려 확정
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 승인·확인 의견 입력 — 데모 신청 대기 건만. 비어 있어도 확정할 수 있다 */}
                  {op && r.type === 'showroom_demo' && r.state === 'pending' && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
                      <textarea
                        value={opinionText}
                        onChange={e => setOpinionText(e.target.value)}
                        rows={3}
                        placeholder="의견 (선택)"
                        style={{ ...inputStyle, width: '100%', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }}
                      />
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                        <button style={btnGhost(busy)} disabled={busy} onClick={() => { setOpinion(null); setOpinionText('') }}>
                          취소
                        </button>
                        <button style={btnPrimary(busy)} disabled={busy} onClick={() => act(r, op.action, opinionText)}>
                          {busy ? '처리 중...' : op.action === 'approve' ? '승인 확정' : '확인 완료'}
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
          사후 신청은 이미 끝난 사용이라 [확인]만 합니다. 승인·확인 때 남긴 의견은 승인서 의견란에 들어갑니다.<br />
          * 처리완료는 유형마다 최근 50건까지 보입니다. 견적 삭제의 처리 이력은 감사 기록에서 가져옵니다.
        </div>
      </div>
    </main>
  )
}
