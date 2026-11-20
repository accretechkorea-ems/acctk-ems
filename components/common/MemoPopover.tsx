'use client'

// **메모 아이콘 + 팝오버** — 목록 한 줄에 달린 메모를 보고 고치는 한 가지 길.
//
// ── 왜 한곳에 두는가 ───────────────────────────────────────────────────────
//   메모가 쓰이는 자리가 열여섯 곳인데 모양도 규칙도 제각각이었다. 어떤 곳은 이모지를
//   눌러야 펼쳐지고(20 수리), 어떤 곳은 상태가 맞아야만 보이고 고칠 길이 아예 없었다
//   (내 견적의 발주 요청 메모). 아이콘·여는 법·권한을 여기 하나로 모은다.
//
// ── 규칙 ──────────────────────────────────────────────────────────────────
//   아이콘  lucide message-square-text 20px. 메모가 있으면 파랑(#234ea2), 없으면
//           흐린 회색(#c0c4cc). **없어도 자리는 남긴다** — 열이 행마다 어긋나지 않게.
//   호버    읽기. 글자 길이에 맞춰 늘고, 320px 를 넘으면 그 안에서만 구른다.
//   클릭    고칠 수 있으면 **그 자리에서 편집**(글상자 + 저장/취소), 고칠 수 없으면
//           팝오버를 **고정**한다(손을 떼도 닫히지 않아 읽을 시간을 준다).
//   Esc     편집 중이면 취소. 바깥을 누르면 **고친 것이 있을 때만** 묻는다
//           (「저장하지 않고 닫을까요?」 — 입력 폼 모달과 같은 규칙).
//
// 제목 줄은 부르는 쪽이 준다 — 「고객사 · 모델 · S/N」, 「견적번호 · 고객사」처럼
// 그 메모가 **어느 건의 것인지** 한 줄로 알 수 있어야 한다.

import { useEffect, useRef, useState } from 'react'
import Popover from '@/components/common/Popover'
import { useConfirmOptional } from '@/components/common/confirmContext'
import { R } from '@/lib/radius'

/** 메모 길이 상한 — 화면이 여기서 막고, 서버도 같은 값으로 자른다. */
export const MEMO_MAX = 1000
/** 팝오버가 커질 수 있는 한계. 넘으면 안에서 구른다. */
export const MEMO_MAX_HEIGHT = 320

const BLUE = '#234ea2'
const DIM = '#c0c4cc'
const BORDER = '#ebebeb'
const MUTED = '#9ca3af'
const TEXT = '#111827'

/**
 * 떠오르는 판의 **생김새** — 메모를 보여 주는 자리는 전부 이것을 쓴다
 * (이 파일의 팝오버와, 아이콘 없이 글자로 보여 주는 MemoHoverText).
 * 폭은 부르는 쪽이 정한다(편집 중에는 360).
 */
export const MEMO_PANEL_STYLE: React.CSSProperties = {
  background: '#fff', border: `1px solid ${BORDER}`, borderRadius: R.control,
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)', padding: '10px 12px',
  minWidth: 220, maxWidth: 380, textAlign: 'left',
  // 편집 중에는 글상자를 눌러야 하므로 손을 받아야 한다. 읽기만 할 때도
  // 판 위에서 손이 머물면 닫히지 않게 둔다(아래 onMouseEnter).
  pointerEvents: 'auto',
}

/** 메모가 있는가 — 공백만 있는 값은 없는 것으로 본다(아이콘 색 판정). */
export const hasMemo = (value: string | null | undefined): boolean => !!(value ?? '').trim()

/** 아이콘 색 — 있으면 파랑, 없으면 흐린 회색. */
export const memoIconColor = (value: string | null | undefined): string => (hasMemo(value) ? BLUE : DIM)

export type MemoPopoverProps = {
  /** 어느 건의 메모인지 한 줄. 예: 「파카코리아 · RF-05A · S/N 240530」 */
  title: string
  /** 지금 메모. 없으면 null. */
  value: string | null | undefined
  /** 고칠 수 있는가. false 면 읽기 전용(클릭하면 고정만 된다). */
  canEdit?: boolean
  /**
   * 저장. true 를 돌려주면 닫는다(실패하면 false — 팝오버를 열어 둔 채 고칠 수 있게).
   * canEdit 이어도 이것이 없으면 읽기 전용이다.
   */
  onSave?: (text: string) => Promise<boolean> | boolean
  /** 아이콘 옆에 붙일 작은 이름표(「요청」·「영업관리」처럼 두 메모를 가릴 때). */
  badge?: string
  /** 비어 있을 때 글상자에 비치는 글. */
  placeholder?: string
  /** 아이콘 도움말·aria-label 의 앞말. 기본 '메모'. */
  label?: string
  maxLength?: number
}

export default function MemoPopover({
  title, value, canEdit = false, onSave, badge, placeholder = '메모를 적습니다', label = '메모',
  maxLength = MEMO_MAX,
}: MemoPopoverProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const confirm = useConfirmOptional()
  const [hovered, setHovered] = useState(false)
  /** 클릭으로 붙잡아 둔 상태 — 편집 중이거나, 못 고치는 메모를 읽는 중이다. */
  const [pinned, setPinned] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const text = (value ?? '').trim()
  const editable = canEdit && !!onSave
  const open = hovered || pinned
  const dirty = editing && draft.trim() !== text

  const closeAll = () => { setPinned(false); setEditing(false); setHovered(false) }

  /** 바깥을 눌렀을 때 — 고친 것이 있으면 묻는다(입력 폼 모달과 같은 규칙). */
  const requestClose = async () => {
    if (!dirty) { closeAll(); return }
    if (confirm) {
      const ok = await confirm({
        title: '저장하지 않고 닫을까요?',
        message: '작성 중인 내용은 저장되지 않습니다.',
        confirmText: '닫기', cancelText: '계속 작성', variant: 'danger',
      })
      if (!ok) return
    }
    closeAll()
  }

  /**
   * Esc — **이 팝오버만** 닫는다.
   *
   * 팝오버는 모달(내 견적 팝업·수리 정보) 안에서 열린다. Popover 도, 그 모달도 각자
   * document 에 keydown 을 달고 있어 그대로 두면 Esc 한 번에 두 겹이 닫혔다.
   * 그래서 **내려가는 길(capture)에서 먼저 받아** 멈춘다 — PDF 뷰어와 같은 규칙이다.
   */
  useEffect(() => {
    if (!pinned && !editing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeAll()                 // 편집 중이면 취소, 고정만 돼 있으면 닫기
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [pinned, editing])

  const startEdit = () => {
    setDraft(text)
    setEditing(true)
    setPinned(true)
  }

  const save = async () => {
    if (!onSave || saving) return
    setSaving(true)
    try {
      const ok = await onSave(draft.trim())
      if (ok) closeAll()
    } finally {
      setSaving(false)
    }
  }

  const btnStyle: React.CSSProperties = {
    width: 26, height: 26, padding: 0, background: 'none', border: 'none',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    color: memoIconColor(value), cursor: 'pointer', flexShrink: 0,
    transition: 'color 0.15s ease',
  }

  return (
    <span ref={anchorRef}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button type="button"
        onClick={e => {
          e.stopPropagation()
          if (editable) { if (editing) return; startEdit(); return }
          setPinned(p => !p)       // 못 고치는 메모는 눌러서 고정·해제만 한다
        }}
        title={`${label}${hasMemo(value) ? '' : ' (없음)'}`}
        aria-label={`${label}${hasMemo(value) ? '' : ' 없음'}`}
        style={btnStyle}>
        {/* lucide message-square-text */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <line x1="7" y1="9" x2="17" y2="9" />
          <line x1="7" y1="13" x2="13" y2="13" />
        </svg>
      </button>
      {badge && (
        <span style={{ fontSize: 10, fontWeight: 700, color: hasMemo(value) ? BLUE : MUTED, whiteSpace: 'nowrap' }}>{badge}</span>
      )}

      <Popover
        anchorRef={anchorRef}
        open={open}
        onClose={() => { void requestClose() }}
        align="end"
        gap={6}
        width={editing ? 360 : undefined}
        maxHeight={MEMO_MAX_HEIGHT}
        style={MEMO_PANEL_STYLE}
      >
        <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => { if (!pinned) setHovered(false) }}>
          {/* 제목 — 어느 건의 메모인지 */}
          <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>

          {editing ? (
            <>
              <textarea
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value.slice(0, maxLength))}
                onKeyDown={e => {
                  if (e.key === 'Escape') { e.stopPropagation(); closeAll() }   // 편집 중 Esc = 취소
                }}
                placeholder={placeholder}
                rows={5}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '8px 9px', borderRadius: R.icon,
                  border: `1px solid ${BORDER}`, outline: 'none', resize: 'vertical',
                  fontSize: 12, lineHeight: 1.6, color: TEXT, fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <span style={{ fontSize: 10, color: MUTED }}>{`${draft.length} / ${maxLength}`}</span>
                <span style={{ flex: 1 }} />
                <button type="button" onClick={closeAll} disabled={saving}
                  style={{ padding: '4px 9px', borderRadius: R.icon, border: `1px solid ${BORDER}`, background: '#fff', color: MUTED, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  취소
                </button>
                <button type="button" onClick={() => void save()} disabled={saving}
                  style={{ padding: '4px 10px', borderRadius: R.icon, border: 'none', background: BLUE, color: '#fff', fontSize: 11, fontWeight: 700, cursor: saving ? 'progress' : 'pointer' }}>
                  {saving ? '저장 중…' : '저장'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, lineHeight: 1.7, color: text ? TEXT : MUTED, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {text || '메모가 없습니다'}
              </div>
              {editable && (
                <div style={{ marginTop: 8, fontSize: 10, color: MUTED }}>눌러서 고치기</div>
              )}
            </>
          )}
        </div>
      </Popover>
    </span>
  )
}
