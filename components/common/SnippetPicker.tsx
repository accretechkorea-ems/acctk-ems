'use client'

/**
 * **문구 고르기** — 라벨 옆의 「문구 ▾」 (2026-11-25).
 *
 * 시안(Snippets.dc.html)의 두 번째 장면 그대로:
 *   검색칸 / 「내 문구」 / 「공용」 / 「다른 용도 문구 전체 보기 ›」 / 「＋ 지금 내용을 문구로 저장」
 *
 * ── 조작은 SearchSelect 와 같은 규칙이다 ─────────────────────────────────
 *   ↑↓ 이동(끝에서 돌아온다) · Enter 고르기 · Esc 닫기(쌓임이 받는다 — 모달은 안 닫힌다) ·
 *   Tab 닫고 다음 칸 · 마우스 hover 는 색을 칠하지 않고 **고른 자리만** 옮긴다 ·
 *   IME 조합 중에는 키를 가로채지 않는다. 목록은 Popover 로 body 에 띄운다(모달 안에서도
 *   잘리지 않는다).
 *
 * ── 끼울 때 ──────────────────────────────────────────────────────────────
 *   자리표를 그 화면의 값으로 바꾸고(applyVars) **커서 자리에** 넣는다. 기존 글은
 *   지우지 않는다(lib/snippets 의 insertAtCursor).
 */

import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import Popover from '@/components/common/Popover'
import { useOverlayEsc } from '@/components/common/overlayStack'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import SnippetSaveModal from '@/components/common/SnippetSaveModal'
import { useSnippets, type SnippetForm } from '@/hooks/useSnippets'
import { useToast } from '@/components/common/Toast'
import { BLUE, BORDER, CARD_BG, MUTED, NEUTRAL_BG, SUB, TEXT } from '@/components/common/ui'
import { R } from '@/lib/radius'
import { PICK_CLASS } from '@/lib/focusRing'
import {
  EMPTY_MESSAGE, KIND_LABEL, OTHER_KINDS_LABEL, PICK_LABEL, SAVE_CURRENT_LABEL,
  applyVars, matchSnippet, oneLine, visibleKinds,
  type Snippet, type SnippetCtx, type SnippetKind,
} from '@/lib/snippets'

type Props = {
  /** 이 자리의 용도 — 그 용도와 '공통' 을 먼저 보여 준다. */
  kind: SnippetKind
  /** 자리표를 바꿀 값들. */
  ctx?: SnippetCtx
  /** 고른 글(자리표를 바꾼 뒤)을 받는다 — 부르는 쪽이 커서 자리에 끼운다. */
  onPick: (text: string) => void
  /** 지금 칸에 적혀 있는 글 — 「지금 내용을 문구로 저장」의 시작값이다. */
  currentValue?: string
}

export default function SnippetPicker({ kind, ctx, onPick, currentValue }: Props) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** 다른 용도까지 펼쳤나. */
  const [all, setAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const toast = useToast()
  const snippets = useSnippets()

  const openList = () => {
    setOpen(true)
    void snippets.load()
    // 검색칸으로 커서를 옮긴다 — 열고 바로 칠 수 있게(다음 프레임에 그려진다).
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  /**
   * 이 자리에서 보이는 용도 — **묵혀 둔다**(2026-11-25 실측).
   * 렌더마다 새 배열을 만들면 아래 useMemo 가 매번 다시 돌고, 그 결과로 만든 목록이
   * 키보드 훅에는 「바뀐 목록」으로 보여 고른 자리를 되돌린다. 그 되돌림이 또 렌더를
   * 부르면서 React 가 「너무 많은 렌더」(#301)로 창을 통째로 멈췄다.
   */
  const here = useMemo(() => visibleKinds(kind), [kind])
  const rows = useMemo(() => {
    const matched = snippets.rows.filter(s => matchSnippet(s, query))
    const pool = all || query.trim() !== '' ? matched : matched.filter(s => here.includes(s.kind))
    const mine = pool.filter(s => s.scope === 'private')
    const shared = pool.filter(s => s.scope === 'shared')
    return { mine, shared, count: pool.length }
  }, [snippets.rows, query, all, here])

  /**
   * 한 줄씩 펼친 목록 — 키보드는 이 차례로 돈다(머리글은 건너뛴다).
   * 렌더마다 새 배열이면 아래 키보드 훅이 고른 자리를 되돌려 되돌이가 된다 — 묵혀 둔다.
   */
  const flat: Snippet[] = useMemo(() => [...rows.mine, ...rows.shared], [rows])

  const insert = (s: Snippet) => {
    onPick(applyVars(s.body, ctx))
    setOpen(false)
    setQuery('')
  }

  /**
   * 키보드 훅에 넘기는 목록 — **글자가 같으면 같은 배열**을 쓴다(SearchSelect 와 같은 방식).
   * 위의 묵힘이 깨지는 날에도 되돌이가 생기지 않게 한 겹 더 받쳐 둔다.
   */
  const sig = flat.map(s => s.snippet_id).join(',')
  const ids = useMemo(() => (sig === '' ? [] : sig.split(',').map(Number)), [sig])
  const keys = useListKeyboard<number>(
    ids,
    open && flat.length > 0,
    listRef,
    id => { const s = flat.find(x => x.snippet_id === id); if (s) insert(s) },
  )

  // Esc — **열린 목록만** 닫는다. 모달 위에서 눌러도 모달은 그대로다(SearchSelect 와 같다).
  useOverlayEsc(true, () => setOpen(false), open)

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') return
    if (e.key === 'Tab') { setOpen(false); return }
    keys.onKeyDown(e)
  }

  const save = async (form: SnippetForm) => {
    setSaving(true)
    const r = await snippets.create(form)
    setSaving(false)
    if (!r.ok) { toast.error(r.error); return }
    toast.success('문구를 담았습니다')
    setSaveOpen(false)
  }

  const group = (label: string, list: readonly Snippet[], from: number) => list.length === 0 ? null : (
    <>
      <div style={{ fontSize: 11, fontWeight: 600, color: SUB, padding: '8px 12px 2px' }}>{label}</div>
      {list.map((s, i) => {
        const at = from + i
        return (
          <div key={s.snippet_id} role="option" className={PICK_CLASS} aria-selected={at === keys.active}
            // mousedown 으로 고른다 — click 까지 기다리면 검색칸이 먼저 포커스를 잃어 목록이 닫힌다.
            onMouseDown={e => { e.preventDefault(); insert(s) }}
            onMouseEnter={() => keys.setActive(at)}
            style={{
              padding: '7px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2,
              background: at === keys.active ? NEUTRAL_BG : 'transparent',
            }}>
            <span style={{ fontSize: 13, color: TEXT, display: 'flex', alignItems: 'center', gap: 6 }}>
              {s.title}
              {s.kind !== kind && (
                <span style={{
                  fontSize: 11, fontWeight: 600, color: SUB, background: NEUTRAL_BG,
                  borderRadius: R.tag, padding: '1px 5px',
                }}>
                  {KIND_LABEL[s.kind]}
                </span>
              )}
            </span>
            <span style={{
              fontSize: 11, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {oneLine(s.body, 60)}
            </span>
          </div>
        )
      })}
    </>
  )

  return (
    <>
      <button ref={anchorRef} type="button"
        onClick={() => (open ? setOpen(false) : openList())}
        style={{
          border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 12, fontWeight: 600, color: BLUE,
        }}>
        {PICK_LABEL}
      </button>

      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}
        align="end" width={360} maxHeight={360}
        style={{
          background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.tile,
          boxShadow: '0 8px 24px rgba(0,0,0,0.14)', overflow: 'hidden',
        }}>
        <div style={{ borderBottom: `1px solid ${BORDER}`, padding: '8px 10px' }}>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
            placeholder="문구 검색"
            style={{
              width: '100%', border: 'none', outline: 'none', fontSize: 13, color: TEXT,
              background: 'transparent', fontFamily: 'inherit',
            }} />
        </div>

        <div ref={listRef} role="listbox" style={{ maxHeight: 240, overflowY: 'auto' }}>
          {snippets.loading && <div style={{ padding: '10px 12px', fontSize: 12, color: SUB }}>불러오는 중…</div>}
          {snippets.notice && <div style={{ padding: '10px 12px', fontSize: 12, color: SUB, lineHeight: 1.7 }}>{snippets.notice}</div>}
          {!snippets.loading && !snippets.notice && rows.count === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: MUTED }}>{EMPTY_MESSAGE}</div>
          )}
          {group('내 문구', rows.mine, 0)}
          {group('공용', rows.shared, rows.mine.length)}
        </div>

        {!all && query.trim() === '' && (
          <button type="button" onMouseDown={e => { e.preventDefault(); setAll(true) }}
            style={{
              width: '100%', textAlign: 'left', padding: '7px 12px', border: 'none',
              borderTop: `1px solid ${BORDER}`, background: CARD_BG, color: SUB,
              fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {OTHER_KINDS_LABEL}
          </button>
        )}

        <button type="button"
          onMouseDown={e => { e.preventDefault(); setOpen(false); setSaveOpen(true) }}
          style={{
            width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none',
            borderTop: `1px solid ${BORDER}`, background: CARD_BG, color: BLUE,
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
          {SAVE_CURRENT_LABEL}
        </button>
      </Popover>

      {saveOpen && (
        <SnippetSaveModal
          defaultKind={kind}
          defaultBody={currentValue ?? ''}
          busy={saving}
          onClose={() => setSaveOpen(false)}
          onSave={form => void save(form)}
        />
      )}
    </>
  )
}
