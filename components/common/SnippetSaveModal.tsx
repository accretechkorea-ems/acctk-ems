'use client'

/**
 * 문구를 **담는·고치는 작은 창** (2026-11-25).
 *
 * 시안(Snippets.dc.html)의 네 번째 장면 그대로 — 제목 · 용도 · 범위(개인용/공용) · 내용.
 * 고르기 드롭다운의 「＋ 지금 내용을 문구로 저장」과 내 문구 탭의 「＋ 문구 추가」가
 * **같은 창**을 쓴다. 고치기도 이 창이다(initial 을 주면 제목이 「문구 수정」이 된다).
 */

import { useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import { BLUE, BLUE_BORDER, BLUE_TINT, BORDER, CARD_BG, MUTED, SUB, TEXT } from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'
import { R } from '@/lib/radius'
import {
  BODY_MAX, KIND_LABEL, SCOPE_PICK_LABEL, SHARED_NOTICE, SNIPPET_KINDS, SNIPPET_SCOPES,
  TITLE_MAX, snippetBlockedReason, type Snippet, type SnippetKind, type SnippetScope,
} from '@/lib/snippets'
import type { SnippetForm } from '@/hooks/useSnippets'

const labelStyle: CSSProperties = {
  fontSize: 12, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 4, display: 'block',
}
const field: CSSProperties = {
  width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box',
  border: `1px solid ${BORDER}`, borderRadius: R.control, background: CARD_BG,
  fontSize: 13, color: TEXT, outline: 'none', fontFamily: 'inherit',
}

export default function SnippetSaveModal({ initial, defaultKind, defaultBody, busy, onClose, onSave }: {
  /** 고치는 중이면 그 문구. 새로 담는 중이면 null. */
  initial?: Snippet | null
  /** 새로 담을 때의 용도 — 부른 자리의 용도다. */
  defaultKind?: SnippetKind
  /** 새로 담을 때의 내용 — 지금 칸에 적혀 있던 글이다. */
  defaultBody?: string
  busy?: boolean
  onClose: () => void
  onSave: (form: SnippetForm) => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? defaultBody ?? '')
  const [kind, setKind] = useState<SnippetKind>(initial?.kind ?? defaultKind ?? 'common')
  const [scope, setScope] = useState<SnippetScope>(initial?.scope ?? 'private')

  const blocked = snippetBlockedReason({ title, body })
  const editing = initial != null

  const save = () => {
    if (blocked || busy) return
    onSave({ title: title.trim(), body, kind, scope })
  }

  /** 적은 것이 있나 — 없으면 Esc·바깥 클릭에 묻지 않는다(ModalOverlay). */
  const dirty = title !== (initial?.title ?? '')
    || body !== (initial?.body ?? defaultBody ?? '')
    || kind !== (initial?.kind ?? defaultKind ?? 'common')
    || scope !== (initial?.scope ?? 'private')

  return (
    <ModalOverlay onClose={onClose} confirmClose dirty={dirty}>
      <ModalCard
        width={380}
        onClose={onClose}
        title={<div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{editing ? '문구 수정' : '문구로 저장'}</div>}
        footer={<>
          <button type="button" onClick={onClose}
            style={{
              height: 38, flex: 1, border: `1px solid ${BORDER}`, borderRadius: R.control,
              background: CARD_BG, color: SUB, fontWeight: 600, fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            취소
          </button>
          <button type="button" onClick={save} disabled={blocked != null || busy}
            style={{
              height: 38, flex: 1, border: 'none', borderRadius: R.control,
              background: blocked || busy ? BORDER : BLUE,
              color: blocked || busy ? MUTED : '#fff',
              fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
              cursor: blocked || busy ? 'default' : 'pointer',
            }}>
            {busy ? '저장 중...' : '저장'}
          </button>
        </>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelStyle} htmlFor="snip-title">제목</label>
            <input id="snip-title" value={title} maxLength={TITLE_MAX}
              onChange={e => setTitle(e.target.value)} placeholder="예: 정기 점검 기본" style={field} />
          </div>

          <div>
            <label style={labelStyle} htmlFor="snip-kind">용도</label>
            <select id="snip-kind" value={kind} onChange={e => setKind(e.target.value as SnippetKind)}
              style={{ ...field, cursor: 'pointer' }}>
              {SNIPPET_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </div>

          <div>
            <span style={labelStyle}>범위</span>
            {/* 세그먼트 둘 — 고른 쪽만 테마 파랑(디자인 규칙의 단일 선택 모양). */}
            <div style={{ display: 'flex', gap: 8 }}>
              {SNIPPET_SCOPES.map(s => (
                <button key={s} type="button" onClick={() => setScope(s)}
                  style={{
                    flex: 1, height: 34, borderRadius: R.control, fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                    border: `1px solid ${scope === s ? BLUE_BORDER : BORDER}`,
                    background: scope === s ? BLUE_TINT : CARD_BG,
                    color: scope === s ? BLUE : SUB,
                  }}>
                  {SCOPE_PICK_LABEL[s]}
                </button>
              ))}
            </div>
            {scope === 'shared' && (
              <div style={{ fontSize: 11, color: SUB, marginTop: 6, lineHeight: 1.7 }}>{SHARED_NOTICE}</div>
            )}
          </div>

          <div>
            <label style={labelStyle} htmlFor="snip-body">내용</label>
            <textarea id="snip-body" value={body} maxLength={BODY_MAX}
              onChange={e => setBody(e.target.value)} rows={5}
              placeholder="자리표를 쓸 수 있습니다 — {수신인} {직급} {장비} …"
              style={{ ...field, height: 'auto', padding: '9px 10px', resize: 'vertical', lineHeight: 1.6 }} />
          </div>

          {blocked && <div style={{ fontSize: 12, color: SUB }}>{blocked}</div>}
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}
