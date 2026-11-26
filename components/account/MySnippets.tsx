'use client'

/**
 * 내 정보의 **「내 문구」 탭** (2026-11-25).
 *
 * 시안(Snippets.dc.html)의 첫 장면 그대로 — 검색 · 용도 · 범위로 걸러 보고, 용도별로
 * 묶어 보여 준다. 내 것은 「수정」「삭제」, 공용은 「내 것으로 복사」(만든 사람과
 * admin 이상은 공용도 고치고 지울 수 있다 — 판정은 lib/snippets 의 canEditSnippet 한 곳).
 *
 * 쓰기는 라우트(app/api/snippets)만 한다. 아래 단추는 그 라우트를 부른다.
 */

import { useEffect, useMemo, useState } from 'react'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import SnippetSaveModal from '@/components/common/SnippetSaveModal'
import { useSnippets, type SnippetForm } from '@/hooks/useSnippets'
import {
  BLUE, BLUE_BORDER, BLUE_TINT, BORDER, CARD_BG, DANGER, MUTED, NEUTRAL_BG, SUB, TEXT,
} from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'
import { R } from '@/lib/radius'
import {
  EMPTY_MESSAGE, KIND_LABEL, SCOPE_LABEL, SNIPPET_KINDS, SNIPPET_SCOPES, SNIPPET_VARS,
  VAR_HELP_HEAD, VAR_HELP_TAIL, canEditSnippet, deleteQuestion, groupByKind, groupLabel,
  isMine, matchSnippet, oneLine, type Snippet, type SnippetKind, type SnippetScope,
} from '@/lib/snippets'

const field = {
  height: 32, padding: '0 10px', boxSizing: 'border-box' as const,
  border: `1px solid ${BORDER}`, borderRadius: R.control, background: CARD_BG,
  fontSize: 13, color: TEXT, outline: 'none', fontFamily: 'inherit',
}
const linkBtn = (danger = false) => ({
  border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
  fontSize: 12, fontWeight: 600, color: danger ? DANGER : BLUE, flexShrink: 0,
})
const tag = (kind: 'me' | 'pub' | 'kind') => ({
  fontSize: 11, fontWeight: 600, borderRadius: R.tag, padding: '1px 6px', flexShrink: 0,
  background: kind === 'me' ? BLUE_TINT : kind === 'pub' ? '#ecfdf5' : NEUTRAL_BG,
  color: kind === 'me' ? BLUE : kind === 'pub' ? '#047857' : SUB,
})

export default function MySnippets({ me }: {
  /** 지금 로그인한 사람 — 내 것인지, 공용을 고칠 수 있는지 판정한다. */
  me: { engineer_id: number | null; permission_level?: string | null }
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const snippets = useSnippets()
  const { load } = snippets
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<SnippetKind | ''>('')
  const [scope, setScope] = useState<SnippetScope | ''>('')
  const [editing, setEditing] = useState<Snippet | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  // 열 때 한 번 읽는다 — load 는 상태와 무갈이라 여기서 되돌이가 생기지 않는다(useSnippets).
  useEffect(() => { void load() }, [load])

  const groups = useMemo(() => {
    const rows = snippets.rows.filter(s => matchSnippet(s, query))
      .filter(s => (kind === '' ? true : s.kind === kind))
      .filter(s => (scope === '' ? true : s.scope === scope))
    return groupByKind(rows)
  }, [snippets.rows, query, kind, scope])

  const save = async (form: SnippetForm) => {
    setBusy(true)
    const r = editing ? await snippets.update(editing.snippet_id, form) : await snippets.create(form)
    setBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    toast.success(editing ? '문구를 고쳤습니다' : '문구를 담았습니다')
    setEditing(null)
    setAdding(false)
  }

  const remove = async (s: Snippet) => {
    const yes = await confirm({
      title: '문구를 지울까요?', message: deleteQuestion(s.title),
      confirmText: '지우기', cancelText: '그만두기', variant: 'danger',
    })
    if (!yes) return
    setBusy(true)
    const r = await snippets.remove(s.snippet_id)
    setBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    toast.success('문구를 지웠습니다')
  }

  /** 공용 문구를 **내 것으로** 한 장 복사한다(원본은 그대로 둔다). */
  const copyMine = async (s: Snippet) => {
    setBusy(true)
    const r = await snippets.create({ title: s.title, body: s.body, kind: s.kind, scope: 'private' })
    setBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    toast.success('내 문구로 담았습니다')
  }

  return (
    <div>
      {/* 걸러 보기 — 검색 · 용도 · 범위 · 추가 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="문구 검색"
          style={{ ...field, width: 200 }} />
        <select value={kind} onChange={e => setKind(e.target.value as SnippetKind | '')}
          style={{ ...field, cursor: 'pointer' }}>
          <option value="">용도 전체</option>
          {SNIPPET_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <select value={scope} onChange={e => setScope(e.target.value as SnippetScope | '')}
          style={{ ...field, cursor: 'pointer' }}>
          <option value="">내 것 · 공용</option>
          {SNIPPET_SCOPES.map(s => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setAdding(true)}
          style={{
            height: 32, padding: '0 12px', border: 'none', borderRadius: R.control,
            background: BLUE, color: '#fff', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
          ＋ 문구 추가
        </button>
      </div>

      {snippets.loading && <div style={{ fontSize: 13, color: SUB, padding: '10px 0' }}>불러오는 중…</div>}
      {snippets.notice && (
        <div style={{ fontSize: 13, color: SUB, padding: '10px 0', lineHeight: 1.8 }}>{snippets.notice}</div>
      )}
      {!snippets.loading && !snippets.notice && groups.length === 0 && (
        <div style={{ fontSize: 13, color: MUTED, padding: '10px 0' }}>{EMPTY_MESSAGE}</div>
      )}

      {groups.map(g => (
        <div key={g.kind}>
          <div style={{ fontSize: 12, fontWeight: 600, color: SUB, padding: '10px 0 4px' }}>
            {groupLabel(g.kind, g.rows.length)}
          </div>
          {g.rows.map(s => {
            const canEdit = canEditSnippet({ engineer_id: me.engineer_id, permission_level: me.permission_level }, s)
            return (
              /* 줄에 공용 링을 둔다(2026-11-26 묶음2 D) — 문구 고르개(SnippetPicker)의
                 항목과 같은 모양이어야, 같은 글을 고르는 두 자리가 다르게 보이지 않는다. */
              <div key={s.snippet_id} className="ems-row-hover ems-pick"
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 2px', borderTop: `1px solid ${BORDER}`,
                }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{s.title}</b>
                    <span style={tag(s.scope === 'shared' ? 'pub' : 'me')}>{SCOPE_LABEL[s.scope]}</span>
                    {s.kind === 'common' && <span style={tag('kind')}>{KIND_LABEL.common}</span>}
                    {s.scope === 'shared' && !isMine(s, me.engineer_id) && s.owner_name && (
                      <span style={{ fontSize: 11, color: MUTED }}>{s.owner_name}</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 12, color: SUB, marginTop: 2,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {oneLine(s.body)}
                  </div>
                </div>
                {s.scope === 'shared' && !isMine(s, me.engineer_id) && (
                  <button type="button" style={linkBtn()} disabled={busy}
                    onClick={() => void copyMine(s)}>내 것으로 복사</button>
                )}
                {canEdit && (
                  <>
                    <button type="button" style={linkBtn()} disabled={busy}
                      onClick={() => setEditing(s)}>수정</button>
                    <button type="button" style={linkBtn(true)} disabled={busy}
                      onClick={() => void remove(s)}>삭제</button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {/* 자리표 안내 — 시안의 마지막 줄 */}
      <div style={{
        marginTop: 16, paddingTop: 12, borderTop: `1px solid ${BORDER}`,
        fontSize: 12, color: SUB, lineHeight: 1.9,
      }}>
        <span style={{ fontWeight: LABEL_WEIGHT, color: TEXT_LABEL }}>{VAR_HELP_HEAD}: </span>
        {SNIPPET_VARS.map(v => (
          <span key={v} style={{
            fontFamily: 'ui-monospace, monospace', fontSize: 11, background: NEUTRAL_BG,
            borderRadius: R.tag, padding: '1px 5px', marginRight: 4, color: TEXT_LABEL,
          }}>
            {`{${v}}`}
          </span>
        ))}
        — {VAR_HELP_TAIL} {`공용 문구는 만든 사람과 관리자만 고칠 수 있습니다.`}
      </div>

      {(adding || editing) && (
        <SnippetSaveModal
          initial={editing}
          busy={busy}
          onClose={() => { setAdding(false); setEditing(null) }}
          onSave={form => void save(form)}
        />
      )}
    </div>
  )
}

/** 탭 단추 — 내 정보 페이지가 쓴다(시안의 탭 띠). */
export function AccountTab({ on, onClick, children }: {
  on: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick}
      style={{
        height: 36, padding: '0 12px', border: 'none', background: 'transparent',
        fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
        color: on ? TEXT : SUB,
        borderBottom: `2px solid ${on ? BLUE_BORDER : 'transparent'}`,
      }}>
      {children}
    </button>
  )
}
