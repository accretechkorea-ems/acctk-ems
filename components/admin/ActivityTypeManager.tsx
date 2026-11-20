'use client'

// 영업활동 종류 관리 모달 — /admin 의 「영업활동 종류 관리」 카드가 연다.
//
// 표는 public.activity_types 이고 쓰기 권한은 **RLS 가 본다**(superadmin 만).
// 그래서 이 화면은 권한을 직접 판정하지 않고, DB 가 거절한 것을 한글로 보여 준다
// (lib/activityTypes.ts 의 typeErrorMessage). 버튼 잠금은 거들기일 뿐이다.
// 모양·문구는 견적 분류 관리(QuoteCategoryManager)를 그대로 따른다.
//
// ── 할 수 있는 것 ──────────────────────────────────────────────────────────
//   추가 · 이름 변경 · 활성/비활성 전환 · 순서 이동 · 비방문(원격) 전환.
//
// ── 할 수 없는 것 ──────────────────────────────────────────────────────────
//   **쓰는 활동이 있으면 지울 수 없다.** sales_activities 가 이름을 참조한다(FK) —
//   지우면 과거 활동이 없는 종류를 가리킨다. 그때는 비활성만 된다.
//   **0건일 때만 삭제 버튼이 나온다**(잘못 만든 종류를 되돌리는 길이다).
//   **code 변경도 없다.** PK 다.
//   **system 줄(「리드 등록」)은 손대지 못한다.** 리드 전환이 자동으로 남기는 줄이라
//   이름이 바뀌면 /api/lead-manage 가 넣는 값과 어긋나고, 비활성해도 그 줄은 계속 생긴다.
//
// 이름 변경은 FK 가 `on update cascade` 라 **과거 활동의 값도 함께 따라간다** — 그래서
// 지울 수 없어도 표기는 고칠 수 있다.

import { useEffect, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { inputStyle, BLUE, BORDER, CARD_BG, DANGER, FAINT, MUTED, NEUTRAL_BG, SUB, TEXT } from '@/components/common/ui'
import {
  addActivityType, canDeleteActivityType, countActivityTypeUsage, deleteActivityType,
  moveActivityType, nextSortOrder, renameActivityType,
  setActivityTypeActive, setActivityTypeRemote, useActivityTypesAdmin,
  validateNewCode, validateNewLabel, type ActivityType,
} from '@/lib/activityTypes'
import { R } from '@/lib/radius'

/** 코드 · 이름 · 순서 · 활성 · 방문 · 버튼. 견적 분류 표와 같은 방식이다. */
const GRID = '120px minmax(130px, 1fr) 48px 48px 64px 210px'

export type ActivityTypeManagerProps = {
  onClose: () => void
  /** superadmin 인가. 아니면 버튼을 잠근다(실제 통제는 RLS 가 한다). */
  canEdit: boolean
}

export default function ActivityTypeManager({ onClose, canEdit }: ActivityTypeManagerProps) {
  const toast = useToast()
  const confirmDialog = useConfirm()
  const { types, loading, reload } = useActivityTypesAdmin()

  // 저장이 도는 동안 모든 버튼을 잠근다 — 순서 이동은 여러 줄을 차례로 갱신하므로
  // 중간에 다른 버튼이 눌리면 결과가 어긋난다.
  const [busy, setBusy] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newRemote, setNewRemote] = useState(false)

  // 이름 변경 — 한 번에 한 줄만 연다.
  const [editCode, setEditCode] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')

  /** 종류마다 그것을 쓰는 활동 수 — 0건일 때만 삭제 버튼을 낸다. */
  const [usage, setUsage] = useState<Record<string, number>>({})

  // 모달을 닫으면 열려 있던 폼을 접는다(다시 열 때 지난 입력이 남지 않게).
  useEffect(() => () => { setAddOpen(false); setEditCode(null) }, [])

  // 목록이 바뀔 때마다 쓰임새를 다시 센다(추가·삭제 뒤에도 맞아야 한다).
  useEffect(() => {
    if (types.length === 0) return
    let cancelled = false
    countActivityTypeUsage(types).then(u => { if (!cancelled) setUsage(u) })
    return () => { cancelled = true }
  }, [types])

  /** 쓰기 한 번 — 결과를 토스트로 알리고 목록을 다시 읽는다. */
  const run = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => {
    if (busy) return false
    setBusy(true)
    const r = await fn()
    if (r.ok) { await reload(); toast.success(done) }
    else toast.error(r.error)
    setBusy(false)
    return r.ok
  }

  const handleAdd = async () => {
    const code = newCode.trim().toUpperCase()
    const codeMsg = validateNewCode(types, code)
    if (codeMsg) { toast.error(codeMsg); return }
    const labelMsg = validateNewLabel(types, newLabel)
    if (labelMsg) { toast.error(labelMsg); return }
    const ok = await run(
      () => addActivityType(code, newLabel, nextSortOrder(types), newRemote),
      '활동 종류를 추가했습니다',
    )
    if (ok) { setNewCode(''); setNewLabel(''); setNewRemote(false); setAddOpen(false) }
  }

  const handleRename = async (t: ActivityType) => {
    const next = editLabel.trim()
    if (next !== t.label) {
      const msg = validateNewLabel(types, next)
      if (msg) { toast.error(msg); return }
    }
    const ok = await run(() => renameActivityType(t.code, next), '이름을 바꿨습니다')
    if (ok) setEditCode(null)
  }

  const handleToggle = async (t: ActivityType) => {
    if (t.is_active) {
      const ok = await confirmDialog({
        title: '활동 종류 비활성화',
        message: `${t.label} 을(를) 비활성화합니다. 새 활동에서는 고를 수 없지만, 이미 쓴 활동의 종류 표기와 집계는 그대로 남습니다.`,
        confirmText: '비활성화',
        variant: 'danger',
      })
      if (!ok) return
      await run(() => setActivityTypeActive(t.code, false), '비활성화했습니다')
      return
    }
    await run(() => setActivityTypeActive(t.code, true), '다시 사용하도록 바꿨습니다')
  }

  const handleDelete = async (t: ActivityType) => {
    const ok = await confirmDialog({
      title: '활동 종류 삭제',
      message: `${t.label} 을(를) 지웁니다. 이 종류를 쓰는 활동이 없어 지울 수 있습니다. 되돌릴 수 없습니다.`,
      confirmText: '삭제',
      variant: 'danger',
    })
    if (!ok) return
    await run(() => deleteActivityType(t.code), '활동 종류를 지웠습니다')
  }

  const handleRemote = (t: ActivityType) =>
    run(() => setActivityTypeRemote(t.code, !t.is_remote),
      t.is_remote ? '방문으로 바꿨습니다' : '비방문으로 바꿨습니다')

  const handleMove = (t: ActivityType, dir: -1 | 1) =>
    run(() => moveActivityType(types, t.code, dir), '순서를 바꿨습니다')

  const lockMsg = canEdit ? undefined : '활동 종류는 슈퍼관리자만 바꿀 수 있습니다'
  const locked = busy || !canEdit

  return (
    // 이 화면은 줄마다 즉시 저장한다 — 확인이 필요한 때는 **이름을 고치는 중**일 때뿐이다.
    <ModalOverlay onClose={onClose} confirmClose dirty={editCode !== null}>
      <div style={{ background: CARD_BG, borderRadius: R.modal, padding: 24, width: '100%', maxWidth: 820, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.22)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>영업활동 종류 관리</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: NEUTRAL_BG, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUB }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7, marginBottom: 16 }}>
          고객사 상세의 「영업 활동」 창에서 고르는 종류입니다. 비활성 종류는 새 활동에서 고를 수 없고,
          이미 쓴 활동의 종류 표기와 집계는 그대로 남습니다.
          <br />「비방문」은 실제로 가지 않은 활동입니다 — 동선 지도에서 빠집니다(전화상담처럼).
          <br />자동 줄(리드 등록)은 리드 전환이 남기는 종류라 고칠 수 없습니다.
          <br />쓰는 활동이 **한 건도 없는** 종류에만 [삭제]가 나옵니다 — 그 밖에는 비활성만 됩니다.
        </div>

        {/* 추가 폼 — 어쩌다 한 번 쓰므로 접어 둔다(견적 분류 관리와 같은 방식). */}
        {!addOpen ? (
          <button onClick={() => setAddOpen(true)} disabled={locked} title={lockMsg}
            style={{ padding: '9px 16px', background: NEUTRAL_BG, color: locked ? MUTED : TEXT, border: 'none', borderRadius: R.control, fontWeight: 700, fontSize: 13, cursor: locked ? 'not-allowed' : 'pointer', marginBottom: 16, alignSelf: 'flex-start' }}>
            + 새 종류 추가
          </button>
        ) : (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: R.card, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 12 }}>새 종류</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: SUB, marginBottom: 5 }}>코드 *</div>
                <input value={newCode}
                  onChange={e => setNewCode(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === 'Enter') void handleAdd() }}
                  placeholder="예: DEMO" style={inputStyle} />
                <div style={{ fontSize: 11, color: MUTED, marginTop: 4, lineHeight: 1.6 }}>
                  영문 대문자·숫자·밑줄. 만든 뒤에는 바꿀 수 없습니다.
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: SUB, marginBottom: 5 }}>이름 *</div>
                <input value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleAdd() }}
                  placeholder="예: 데모 시연" style={inputStyle} />
                <div style={{ fontSize: 11, color: MUTED, marginTop: 4, lineHeight: 1.6 }}>
                  활동 기록이 참조하는 값입니다. 나중에 고치면 과거 기록도 함께 바뀝니다.
                </div>
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, cursor: 'pointer', fontSize: 12, color: SUB }}>
              <input type="checkbox" checked={newRemote} onChange={e => setNewRemote(e.target.checked)} />
              비방문(원격) — 동선 지도에서 뺍니다
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => { setAddOpen(false); setNewCode(''); setNewLabel(''); setNewRemote(false) }} disabled={busy}
                style={{ padding: '9px 16px', background: CARD_BG, color: SUB, borderRadius: R.control, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>취소</button>
              <button onClick={() => void handleAdd()} disabled={locked} title={lockMsg}
                style={{ padding: '9px 18px', background: locked ? MUTED : BLUE, color: '#ffffff', borderRadius: R.control, border: 'none', cursor: locked ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13 }}>
                {busy ? '저장 중...' : '추가'}</button>
            </div>
          </div>
        )}

        {/* 목록 */}
        <div style={{ overflowY: 'auto', border: `1px solid ${BORDER}`, borderRadius: R.card }}>
          <div style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fafafa', borderBottom: `1px solid ${BORDER}`, fontSize: 11, fontWeight: 700, color: SUB }}>
            <div>코드</div><div>이름</div><div>순서</div><div>활성</div><div>방문</div><div />
          </div>
          {loading && types.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: MUTED, fontSize: 13 }}>불러오는 중...</div>
          ) : types.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: MUTED, fontSize: 13 }}>등록된 종류가 없습니다</div>
          ) : types.map((t, i) => {
            // system 줄은 잠근다 — 리드 전환이 이 이름으로 줄을 넣는다.
            const rowLocked = locked || t.is_system
            const rowMsg = t.is_system ? '리드 전환이 쓰는 자동 종류라 고칠 수 없습니다' : lockMsg
            return (
              <div key={t.code} style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 12, color: t.is_active ? TEXT : MUTED }}>
                <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.code}>{t.code}</div>
                {editCode === t.code ? (
                  <input value={editLabel} autoFocus
                    onChange={e => setEditLabel(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') void handleRename(t)
                      if (e.key === 'Escape') setEditCode(null)
                    }}
                    style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }} />
                ) : (
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.label}>
                    {t.label}
                    {t.is_system && <span style={{ fontSize: 10, fontWeight: 700, color: MUTED }}>{'  자동'}</span>}
                  </div>
                )}
                <div>{t.sort_order}</div>
                <div>{t.is_active ? '사용' : '중지'}</div>
                <div title={usage[t.code] === undefined ? '세는 중' : `활동 ${usage[t.code]}건`}>
                  {t.is_remote ? '비방문' : '방문'}
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  {editCode === t.code ? (
                    <>
                      <button onClick={() => setEditCode(null)} disabled={busy}
                        style={{ padding: '5px 10px', background: CARD_BG, color: SUB, border: `1px solid ${BORDER}`, borderRadius: R.icon, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>취소</button>
                      <button onClick={() => void handleRename(t)} disabled={rowLocked} title={rowMsg}
                        style={{ padding: '5px 10px', background: rowLocked ? MUTED : BLUE, color: '#ffffff', border: 'none', borderRadius: R.icon, cursor: rowLocked ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700 }}>저장</button>
                    </>
                  ) : (
                    <>
                      {/* 순서 이동 — 맨 위·맨 아래에서는 눌리지 않는다(자동 줄도 옮길 수 있다). */}
                      <button onClick={() => void handleMove(t, -1)} disabled={locked || i === 0} title={lockMsg ?? '위로'}
                        style={{ width: 26, height: 26, padding: 0, background: NEUTRAL_BG, color: (locked || i === 0) ? FAINT : SUB, border: 'none', borderRadius: R.icon, cursor: (locked || i === 0) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
                      </button>
                      <button onClick={() => void handleMove(t, 1)} disabled={locked || i === types.length - 1} title={lockMsg ?? '아래로'}
                        style={{ width: 26, height: 26, padding: 0, background: NEUTRAL_BG, color: (locked || i === types.length - 1) ? FAINT : SUB, border: 'none', borderRadius: R.icon, cursor: (locked || i === types.length - 1) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                      </button>
                      <button onClick={() => void handleRemote(t)} disabled={rowLocked} title={rowMsg ?? '동선 지도에 찍을지'}
                        style={{ padding: '5px 10px', background: NEUTRAL_BG, color: rowLocked ? MUTED : TEXT, border: 'none', borderRadius: R.icon, cursor: rowLocked ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {t.is_remote ? '방문으로' : '비방문으로'}</button>
                      <button onClick={() => { setEditCode(t.code); setEditLabel(t.label) }} disabled={rowLocked} title={rowMsg}
                        style={{ padding: '5px 10px', background: NEUTRAL_BG, color: rowLocked ? MUTED : TEXT, border: 'none', borderRadius: R.icon, cursor: rowLocked ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>이름 변경</button>
                      <button onClick={() => void handleToggle(t)} disabled={rowLocked} title={rowMsg}
                        style={{ padding: '5px 10px', background: t.is_active ? DANGER : NEUTRAL_BG, color: t.is_active ? '#ffffff' : (rowLocked ? MUTED : TEXT), border: 'none', borderRadius: R.icon, cursor: rowLocked ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', opacity: rowLocked ? 0.6 : 1 }}>
                        {t.is_active ? '비활성화' : '다시 사용'}</button>
                      {/* 삭제 — **쓰는 활동이 0건일 때만** 나온다. 쓰는 줄이 있으면
                          버튼 자체가 없다(비활성만 된다). */}
                      {canDeleteActivityType(t, usage[t.code]) && (
                        <button onClick={() => void handleDelete(t)} disabled={locked} title={lockMsg ?? '쓰는 활동이 없어 지울 수 있습니다'}
                          style={{ padding: '5px 10px', background: CARD_BG, color: locked ? MUTED : DANGER, border: `1px solid ${locked ? BORDER : DANGER}`, borderRadius: R.icon, cursor: locked ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          삭제</button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.7, marginTop: 12 }}>
          * 이름을 바꾸면 과거 활동의 종류도 함께 바뀝니다(참조가 이름이라 그렇게 됩니다).
          <br />* 순서 이동은 여러 줄을 차례로 고칩니다. 중간에 실패하면 순서가 어중간하게 남을 수 있는데, 다시 누르면 정리됩니다.
          <br />* 활동 창은 종류 목록을 세션당 한 번만 읽습니다. 바꾼 내용은 해당 사용자가 새로고침한 뒤에 보입니다.
        </div>
      </div>
    </ModalOverlay>
  )
}
