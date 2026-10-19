'use client'

// 견적 분류 관리 모달 — /admin 의 「견적 분류 관리」 카드가 연다.
//
// 표는 public.quote_categories 이고 쓰기 권한은 **RLS 가 본다**(superadmin 만).
// 그래서 이 화면은 권한을 직접 판정하지 않고, DB 가 거절한 것을 한글로 보여 준다
// (lib/quoteCategories.ts 의 categoryErrorMessage). 버튼 잠금은 거들기일 뿐이다 —
// 다른 관리 카드와 같은 방식으로 superadmin 이 아니면 눌리지 않게 해 둔다.
//
// ── 할 수 있는 것 ──────────────────────────────────────────────────────────
//   추가 · 표기 이름 변경 · 활성/비활성 전환 · 위아래 순서 이동.
//
// ── 할 수 없는 것 ──────────────────────────────────────────────────────────
//   **삭제가 없다.** 세 표가 code 를 참조하고(quotes · quote_items · quote_templates),
//   지울 수 있다 해도 과거 견적의 분류가 사라져 통계가 어긋난다. 쓰지 않게 된 분류는 비활성한다.
//   **code 변경도 없다.** 같은 이유다 — 바꾸면 이미 쓴 견적이 없는 분류를 가리킨다.

import { useEffect, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { inputStyle, BLUE, BORDER, CARD_BG, DANGER, FAINT, MUTED, NEUTRAL_BG, SUB, TEXT } from '@/components/common/ui'
import {
  addQuoteCategory, moveQuoteCategory, nextSortOrder, renameQuoteCategory,
  setQuoteCategoryActive, useQuoteCategories, validateNewCode, type QuoteCategory,
} from '@/lib/quoteCategories'

/** 코드 · 표기 · 순서 · 활성 · 버튼. 사무실 관리 표(OFFICE_GRID)와 같은 방식이다. */
const GRID = '130px minmax(150px, 1fr) 56px 56px 210px'

export type QuoteCategoryManagerProps = {
  onClose: () => void
  /** superadmin 인가. 아니면 버튼을 잠근다(실제 통제는 RLS 가 한다). */
  canEdit: boolean
}

export default function QuoteCategoryManager({ onClose, canEdit }: QuoteCategoryManagerProps) {
  const toast = useToast()
  const confirmDialog = useConfirm()
  const { categories, loading, reload } = useQuoteCategories()

  // 저장이 도는 동안 모든 버튼을 잠근다 — 순서 이동은 여러 행을 차례로 갱신하므로
  // 중간에 다른 버튼이 눌리면 결과가 어긋난다.
  const [busy, setBusy] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newLabel, setNewLabel] = useState('')

  // 표기 이름 변경 — 한 번에 한 행만 연다.
  const [editCode, setEditCode] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')

  // 모달을 닫으면 열려 있던 폼을 접는다(다시 열 때 지난 입력이 남지 않게).
  useEffect(() => () => { setAddOpen(false); setEditCode(null) }, [])

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
    const msg = validateNewCode(categories, code)
    if (msg) { toast.error(msg); return }
    if (newLabel.trim() === '') { toast.error('표기 이름을 입력해주세요'); return }
    const ok = await run(
      () => addQuoteCategory(code, newLabel, nextSortOrder(categories)),
      '분류를 추가했습니다',
    )
    if (ok) { setNewCode(''); setNewLabel(''); setAddOpen(false) }
  }

  const handleRename = async (c: QuoteCategory) => {
    const ok = await run(() => renameQuoteCategory(c.code, editLabel), '표기 이름을 바꿨습니다')
    if (ok) setEditCode(null)
  }

  const handleToggle = async (c: QuoteCategory) => {
    if (c.is_active) {
      const ok = await confirmDialog({
        title: '분류 비활성화',
        message: `${c.label} 분류를 비활성화합니다. 새 견적에서는 고를 수 없지만, 이미 쓴 견적의 분류 표기는 그대로 남습니다.`,
        confirmText: '비활성화',
        variant: 'danger',
      })
      if (!ok) return
      await run(() => setQuoteCategoryActive(c.code, false), '비활성화했습니다')
      return
    }
    await run(() => setQuoteCategoryActive(c.code, true), '다시 사용하도록 바꿨습니다')
  }

  const handleMove = (c: QuoteCategory, dir: -1 | 1) =>
    run(() => moveQuoteCategory(categories, c.code, dir), '순서를 바꿨습니다')

  const lockMsg = canEdit ? undefined : '분류는 슈퍼관리자만 바꿀 수 있습니다'
  const locked = busy || !canEdit

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 820, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.22)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>견적 분류 관리</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: NEUTRAL_BG, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUB }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7, marginBottom: 16 }}>
          비활성 분류는 새 견적에서 고를 수 없고, 이미 쓴 견적의 분류 표기는 그대로 남습니다.
          <br />코드는 견적·품목이 참조하는 값이라 만든 뒤에는 바꿀 수 없습니다. 표기 이름만 고칠 수 있습니다.
        </div>

        {/* 추가 폼 — 어쩌다 한 번 쓰므로 접어 둔다(사무실 관리와 같은 방식). */}
        {!addOpen ? (
          <button onClick={() => setAddOpen(true)} disabled={locked} title={lockMsg}
            style={{ padding: '9px 16px', background: NEUTRAL_BG, color: locked ? MUTED : TEXT, border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: locked ? 'not-allowed' : 'pointer', marginBottom: 16, alignSelf: 'flex-start' }}>
            + 새 분류 추가
          </button>
        ) : (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 12 }}>새 분류</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: SUB, marginBottom: 5 }}>코드 *</div>
                <input value={newCode}
                  onChange={e => setNewCode(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === 'Enter') void handleAdd() }}
                  placeholder="예: HARDNESS" style={inputStyle} />
                <div style={{ fontSize: 11, color: MUTED, marginTop: 4, lineHeight: 1.6 }}>
                  영문 대문자·숫자·밑줄. 만든 뒤에는 바꿀 수 없습니다.
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: SUB, marginBottom: 5 }}>표기 이름 *</div>
                <input value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleAdd() }}
                  placeholder="예: Hardness" style={inputStyle} />
                <div style={{ fontSize: 11, color: MUTED, marginTop: 4, lineHeight: 1.6 }}>
                  견적 화면·PDF 에 나오는 이름입니다. 나중에 고칠 수 있습니다.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => { setAddOpen(false); setNewCode(''); setNewLabel('') }} disabled={busy}
                style={{ padding: '9px 16px', background: CARD_BG, color: SUB, borderRadius: 8, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>취소</button>
              <button onClick={() => void handleAdd()} disabled={locked} title={lockMsg}
                style={{ padding: '9px 18px', background: locked ? MUTED : BLUE, color: '#ffffff', borderRadius: 8, border: 'none', cursor: locked ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13 }}>
                {busy ? '저장 중...' : '추가'}</button>
            </div>
          </div>
        )}

        {/* 목록 */}
        <div style={{ overflowY: 'auto', border: `1px solid ${BORDER}`, borderRadius: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fafafa', borderBottom: `1px solid ${BORDER}`, fontSize: 11, fontWeight: 700, color: SUB }}>
            <div>코드</div><div>표기</div><div>순서</div><div>활성</div><div />
          </div>
          {loading && categories.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: MUTED, fontSize: 13 }}>불러오는 중...</div>
          ) : categories.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: MUTED, fontSize: 13 }}>등록된 분류가 없습니다</div>
          ) : categories.map((c, i) => (
            <div key={c.code} style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 12, color: c.is_active ? TEXT : MUTED }}>
              <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.code}>{c.code}</div>
              {editCode === c.code ? (
                <input value={editLabel} autoFocus
                  onChange={e => setEditLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void handleRename(c)
                    if (e.key === 'Escape') setEditCode(null)
                  }}
                  style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }} />
              ) : (
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.label}>{c.label}</div>
              )}
              <div>{c.sort_order}</div>
              <div>{c.is_active ? '사용' : '중지'}</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                {editCode === c.code ? (
                  <>
                    <button onClick={() => setEditCode(null)} disabled={busy}
                      style={{ padding: '5px 10px', background: CARD_BG, color: SUB, border: `1px solid ${BORDER}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>취소</button>
                    <button onClick={() => void handleRename(c)} disabled={locked} title={lockMsg}
                      style={{ padding: '5px 10px', background: locked ? MUTED : BLUE, color: '#ffffff', border: 'none', borderRadius: 6, cursor: locked ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700 }}>저장</button>
                  </>
                ) : (
                  <>
                    {/* 순서 이동 — 맨 위·맨 아래에서는 눌리지 않는다. */}
                    <button onClick={() => void handleMove(c, -1)} disabled={locked || i === 0} title={lockMsg ?? '위로'}
                      style={{ width: 26, height: 26, padding: 0, background: NEUTRAL_BG, color: (locked || i === 0) ? FAINT : SUB, border: 'none', borderRadius: 6, cursor: (locked || i === 0) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
                    </button>
                    <button onClick={() => void handleMove(c, 1)} disabled={locked || i === categories.length - 1} title={lockMsg ?? '아래로'}
                      style={{ width: 26, height: 26, padding: 0, background: NEUTRAL_BG, color: (locked || i === categories.length - 1) ? FAINT : SUB, border: 'none', borderRadius: 6, cursor: (locked || i === categories.length - 1) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                    </button>
                    <button onClick={() => { setEditCode(c.code); setEditLabel(c.label) }} disabled={locked} title={lockMsg}
                      style={{ padding: '5px 10px', background: NEUTRAL_BG, color: locked ? MUTED : TEXT, border: 'none', borderRadius: 6, cursor: locked ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>이름 변경</button>
                    <button onClick={() => void handleToggle(c)} disabled={locked} title={lockMsg}
                      style={{ padding: '5px 10px', background: c.is_active ? DANGER : NEUTRAL_BG, color: c.is_active ? '#ffffff' : (locked ? MUTED : TEXT), border: 'none', borderRadius: 6, cursor: locked ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', opacity: locked ? 0.6 : 1 }}>
                      {c.is_active ? '비활성화' : '다시 사용'}</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.7, marginTop: 12 }}>
          * 순서 이동은 여러 행을 차례로 고칩니다. 중간에 실패하면 순서가 어중간하게 남을 수 있는데, 다시 누르면 정리됩니다.
          <br />* 작성 화면은 분류 목록을 세션당 한 번만 읽습니다. 바꾼 내용은 해당 사용자가 새로고침한 뒤에 보입니다.
        </div>
      </div>
    </ModalOverlay>
  )
}
