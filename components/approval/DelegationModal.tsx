'use client'

// 위임 설정 모달 — 결재 화면에서 연다.
//
// 세 덩이다.
//   위 : 내가 맡긴 위임 — 기간·대리인·범위·사유·상태, [해제](두 번 눌러야 지운다)
//   중 : 위임 추가 — 대리인·기간·범위·사유. 서버가 돌려준 거절 사유(겹침·사슬)를 폼 아래에 그대로 보여 주고
//        모달은 열어 둔다(고쳐서 다시 누르는 것이 보통이라 닫으면 입력을 다시 해야 한다).
//   아래: 내가 대리 결재를 맡은 위임 — 읽기 전용. 해제는 맡긴 사람이 한다.
//
// superadmin 에게만 맨 위에 「위임자」 고르기가 보인다. 고르면 그 사람의 목록·추가가 된다.
//
// 검증은 서버가 정본이다(app/api/approval/delegations). 화면은 보낼 수 없는 상태에서 버튼만 잠그고,
// 겹침·사슬 같은 판정은 서버 메시지를 그대로 보여 준다 — 같은 규칙을 두 곳에 적어 두지 않기 위해서다.

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { Z } from '@/lib/zIndex'
import { todayKST } from '@/lib/date'
import { DOC_TYPES } from '@/lib/approval/docTypes'
import { REASON_MAX, type DelegationStatus } from '@/lib/approval/delegation'
import {
  BLUE, BORDER, CARD_BG, DANGER, FAINT, MUTED, NEUTRAL_BG, SUB, TEXT,
  btnGhost, btnPrimary, inputStyle,
} from '@/components/common/ui'

/** 직급 순서. 결재선 지정 모달(LinePickerModal)과 같은 표를 쓴다(없는 직급은 맨 뒤). */
const POSITION_ORDER: Record<string, number> = {
  '사장': 0, '총괄': 1, '관리자': 2, '수석': 3, '책임': 4, '선임': 5, '사원': 6,
}

type Person = { engineer_id: number; name: string | null; position: string | null }

/** 라우트가 이름·상태를 붙여 돌려주는 행. */
type Row = {
  delegation_id: number
  owner_id: number
  delegate_id: number
  start_date: string
  end_date: string
  doc_type: string | null
  reason: string | null
  owner_label: string
  delegate_label: string
  scope_label: string
  status: DelegationStatus
}

/**
 * 상태 dot 색 — 새 색을 만들지 않고 결재 목록의 문서 상태 dot(app/approval/page.tsx 의 STATUS_DOT)과
 * 같은 값을 쓴다. 글자는 중립으로 두고 색은 dot 에만 준다(디자인 규칙).
 */
const STATUS_DOT: Record<DelegationStatus, string> = {
  '진행 중': BLUE,
  '예정': FAINT,
  '종료': MUTED,
}

const label12 = { fontSize: 12, fontWeight: 600, color: SUB } as const
const caption = { fontSize: 11, fontWeight: 600, color: MUTED } as const
const sectionTitle = { fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 6 } as const

/** 사람 이름 — 「이름 직급」. 모르는 번호는 #번호. */
const personLabel = (p: Person): string => [p.name ?? `#${p.engineer_id}`, p.position ?? ''].filter(Boolean).join(' ')

function StatusBadge({ status }: { status: DelegationStatus }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
      background: NEUTRAL_BG, borderRadius: 99, padding: '1px 8px',
      fontSize: 11, fontWeight: 700, color: SUB,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[status], flexShrink: 0 }} />
      {status}
    </span>
  )
}

/** 한 행의 본문 — 맡긴 목록과 맡은 목록이 같은 모양으로 보이게 함께 쓴다. */
function RowBody({ row, who }: { row: Row; who: string }) {
  return (
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{who}</span>
        <StatusBadge status={row.status} />
      </span>
      <span style={{ display: 'block', fontSize: 11, color: MUTED, marginTop: 3 }}>
        {row.start_date} ~ {row.end_date}
        <span style={{ color: FAINT }}> · </span>
        {row.scope_label}
      </span>
      {row.reason && (
        <span style={{ display: 'block', fontSize: 12, color: SUB, marginTop: 3, wordBreak: 'break-word' }}>
          {row.reason}
        </span>
      )}
    </span>
  )
}

/** 해제는 두 번 눌러야 실행된다. 쇼룸·회수와 같은 3초다. */
const CONFIRM_MS = 3000

export default function DelegationModal({
  open, onClose, myId, isSuper,
}: {
  open: boolean
  onClose: () => void
  /** 로그인한 사람. 본인을 대리인 목록에서 빼는 데 쓴다(위임자를 바꾸면 그 사람을 뺀다). */
  myId: number | null
  /** superadmin 이면 위임자를 고를 수 있다. */
  isSuper: boolean
}) {
  const toast = useToast()
  const today = todayKST()

  const [people, setPeople] = useState<Person[]>([])
  const [ownerId, setOwnerId] = useState<number | null>(null)
  const [given, setGiven] = useState<Row[]>([])
  const [received, setReceived] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState<number | null>(null)

  // 폼
  const [delegateId, setDelegateId] = useState<number | null>(null)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [docType, setDocType] = useState<string>('')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState('')

  const effectiveOwner = ownerId ?? myId

  // 열릴 때마다 처음 상태로 — 닫았다 다시 열면 지난 입력이 남아 있지 않게 한다.
  useEffect(() => {
    if (!open) return
    setOwnerId(myId)
    setDelegateId(null)
    setStartDate(today)
    setEndDate(today)
    setDocType('')
    setReason('')
    setFormError('')
    setConfirmId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, myId])

  // 재직자 명단 — 대리인·위임자 고르기에 쓴다.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const run = async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('engineers')
        .select('engineer_id, name, position')
        .is('resigned_date', null)
        .order('name')
      if (cancelled) return
      if (error) {
        console.error('[approval/delegation] engineers load failed', error)
        toast.error('직원 목록을 불러오지 못했습니다')
        return
      }
      setPeople((data ?? []) as Person[])
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const load = useCallback(async (owner: number | null) => {
    setLoading(true)
    try {
      const q = owner != null ? `?owner=${owner}` : ''
      const res = await fetch(`/api/approval/delegations${q}`)
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        console.error('[approval/delegation] list failed', json)
        toast.error(json?.error || '위임 목록을 불러오지 못했습니다')
        setGiven([]); setReceived([])
        return
      }
      setGiven((json?.given ?? []) as Row[])
      setReceived((json?.received ?? []) as Row[])
    } catch (e) {
      console.error('[approval/delegation] list failed', e)
      toast.error('위임 목록을 불러오지 못했습니다')
      setGiven([]); setReceived([])
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open || effectiveOwner == null) return
    load(effectiveOwner)
  }, [open, effectiveOwner, load])

  useEffect(() => {
    if (confirmId == null) return
    const t = setTimeout(() => setConfirmId(null), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [confirmId])

  const candidates = (() => {
    const rank = (p: Person) => POSITION_ORDER[p.position ?? ''] ?? 99
    return people
      .filter(p => p.engineer_id !== effectiveOwner)
      .sort((a, b) => rank(a) - rank(b) || (a.name ?? '').localeCompare(b.name ?? '', 'ko'))
  })()

  const add = async () => {
    setFormError('')
    if (delegateId == null) { setFormError('대리 결재자를 선택해주세요.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/approval/delegations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_id: effectiveOwner,
          delegate_id: delegateId,
          start_date: startDate,
          end_date: endDate,
          doc_type: docType || null,
          reason: reason.trim() || null,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        // 겹침·사슬 같은 판정은 서버가 사람이 읽을 문장으로 돌려준다. 그대로 보여 주고 모달은 둔다.
        setFormError(json?.error || '위임을 등록하지 못했습니다.')
        return
      }
      toast.success('위임을 등록했습니다')
      setDelegateId(null)
      setReason('')
      await load(effectiveOwner)
    } catch (e) {
      console.error('[approval/delegation] create failed', e)
      setFormError('위임을 등록하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const release = async (row: Row) => {
    if (confirmId !== row.delegation_id) { setConfirmId(row.delegation_id); return }
    setConfirmId(null)
    setBusy(true)
    try {
      const res = await fetch('/api/approval/delegations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.delegation_id }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(json?.error || '해제하지 못했습니다')
        return
      }
      toast.success('위임을 해제했습니다')
      await load(effectiveOwner)
    } catch (e) {
      console.error('[approval/delegation] delete failed', e)
      toast.error('해제하지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const dateInvalid = startDate > endDate || endDate < today

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: Z.modal,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: CARD_BG, borderRadius: 8, padding: 20, width: '100%', maxWidth: 560,
        maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>위임 설정</div>
          <button type="button" onClick={onClose} style={{ ...btnGhost(), padding: '5px 12px' }}>닫기</button>
        </div>

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>

          {/* superadmin — 누구의 위임을 다룰지 */}
          {isSuper && (
            <div>
              <div style={sectionTitle}>위임자</div>
              <select
                value={effectiveOwner ?? ''}
                onChange={e => { setOwnerId(Number(e.target.value) || null); setDelegateId(null); setFormError('') }}
                style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}
              >
                {people.map(p => (
                  <option key={p.engineer_id} value={p.engineer_id}>{personLabel(p)}</option>
                ))}
              </select>
              <div style={{ ...caption, marginTop: 4 }}>
                고른 사람의 위임을 보고 등록·해제합니다
              </div>
            </div>
          )}

          {/* 맡긴 위임 */}
          <div>
            <div style={sectionTitle}>
              {isSuper && effectiveOwner !== myId ? '맡긴 위임' : '내가 맡긴 위임'}
            </div>
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
              {loading ? (
                <div style={{ padding: 12, fontSize: 12, color: MUTED }}>불러오는 중...</div>
              ) : given.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: MUTED }}>맡긴 위임이 없습니다</div>
              ) : given.map((r, i) => (
                <div key={r.delegation_id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 12px',
                  borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`,
                }}>
                  <RowBody row={r} who={r.delegate_label} />
                  <button type="button" onClick={() => release(r)} disabled={busy}
                    style={{
                      ...btnGhost(busy), padding: '4px 10px', fontSize: 12, flexShrink: 0,
                      ...(confirmId === r.delegation_id ? { color: DANGER, borderColor: DANGER } : null),
                    }}>
                    {confirmId === r.delegation_id ? '한 번 더' : '해제'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 추가 */}
          <div>
            <div style={sectionTitle}>위임 추가</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label12}>대리 결재자</span>
                <select
                  value={delegateId ?? ''}
                  onChange={e => { setDelegateId(Number(e.target.value) || null); setFormError('') }}
                  style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}
                >
                  <option value="">선택하세요</option>
                  {candidates.map(p => (
                    <option key={p.engineer_id} value={p.engineer_id}>{personLabel(p)}</option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px' }}>
                  <span style={label12}>시작일</span>
                  <input type="date" value={startDate}
                    onChange={e => { setStartDate(e.target.value); setFormError('') }}
                    style={{ ...inputStyle, width: '100%' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px' }}>
                  <span style={label12}>종료일</span>
                  <input type="date" value={endDate}
                    onChange={e => { setEndDate(e.target.value); setFormError('') }}
                    style={{ ...inputStyle, width: '100%' }} />
                </label>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label12}>적용 범위</span>
                <select
                  value={docType}
                  onChange={e => { setDocType(e.target.value); setFormError('') }}
                  style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}
                >
                  <option value="">전체 문서</option>
                  {Object.values(DOC_TYPES).map(d => (
                    <option key={d.key} value={d.key}>{d.label}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label12}>사유 (선택)</span>
                <input
                  value={reason}
                  onChange={e => { setReason(e.target.value); setFormError('') }}
                  placeholder="예: 해외 출장"
                  maxLength={REASON_MAX}
                  style={{ ...inputStyle, width: '100%' }}
                />
              </label>

              {formError && (
                <div style={{ fontSize: 12, fontWeight: 600, color: DANGER, whiteSpace: 'pre-wrap' }}>
                  {formError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" onClick={add}
                  disabled={busy || delegateId == null || dateInvalid}
                  style={btnPrimary(busy || delegateId == null || dateInvalid)}>
                  {busy ? '처리 중...' : '위임 추가'}
                </button>
              </div>
            </div>
          </div>

          {/* 맡은 위임 — 읽기 전용 */}
          <div>
            <div style={sectionTitle}>
              {isSuper && effectiveOwner !== myId ? '대리 결재를 맡은 위임' : '내가 대리 결재를 맡은 위임'}
            </div>
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
              {loading ? (
                <div style={{ padding: 12, fontSize: 12, color: MUTED }}>불러오는 중...</div>
              ) : received.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: MUTED }}>맡은 위임이 없습니다</div>
              ) : received.map((r, i) => (
                <div key={r.delegation_id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 12px',
                  borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`,
                }}>
                  <RowBody row={r} who={r.owner_label} />
                </div>
              ))}
            </div>
            <div style={{ ...caption, marginTop: 4 }}>해제는 맡긴 분이 합니다</div>
          </div>
        </div>
      </div>
    </div>
  )
}
