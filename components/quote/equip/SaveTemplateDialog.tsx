'use client'

// 「템플릿으로 저장」 창과 「삭제」 확인 창. 둘 다 모달 위에 뜨는 작은 창이다(Z.subModal).
// confirm()·alert() 는 쓰지 않는다 — 화면 안에서 묻고 답한다.
//
// ── 남의 구성을 고친다면 ────────────────────────────────────────────────────
//   기본은 **「내 이름으로 복사 저장」**이다. 원본을 고치는 일은 따로 누르는 버튼으로 둔다.
//   권한으로 막지는 않는다(견적 작성 권한자는 누구나 고칠 수 있다는 규칙) — 기본값으로
//   남의 것을 덮어쓰지 않게 하는 쪽을 택했다.

import { useState } from 'react'
import { Z } from '@/lib/zIndex'
import { TEMPLATE_NAME_MAX } from '@/lib/quoteTemplates'
import type { QuoteTemplate } from '@/lib/quoteTemplates'
import { C, S } from './equipStyles'

const box = {
  position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: Z.subModal,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
}
const panel = {
  background: '#fff', borderRadius: 8, padding: 24, width: '100%', maxWidth: 440,
  boxShadow: '0 20px 60px rgba(0,0,0,0.22)', animation: 'modal-in 0.18s ease',
}
const head = { fontSize: 17, fontWeight: 800, color: C.INK, letterSpacing: '-0.3px', marginBottom: 4 }
const sub = { fontSize: 12, fontWeight: 500, color: C.MUT, marginBottom: 16 }

export type SaveTemplateDialogProps = {
  /** 지금 고른 템플릿(없으면 새 구성이다). */
  picked: QuoteTemplate | null
  /** 내가 만든 것인가 — 「원본 수정」을 앞에 둘지 정한다. */
  mine: boolean
  defaultName: string
  modelKey: string
  setModelKey: (v: string) => void
  itemCount: number
  busy: boolean
  /** 빈 문자열이면 성공, 그 밖은 보여 줄 오류 문구다. */
  onSave: (name: string, mode: 'copy' | 'overwrite') => Promise<string>
  onClose: () => void
}

export function SaveTemplateDialog(props: SaveTemplateDialogProps) {
  const { picked, mine, defaultName, modelKey, setModelKey, itemCount, busy, onSave, onClose } = props
  const [name, setName] = useState(defaultName)
  const [err, setErr] = useState('')

  const run = async (mode: 'copy' | 'overwrite') => {
    if (!name.trim()) {
      setErr('이름을 적어 주세요')
      return
    }
    const msg = await onSave(name, mode)
    if (msg) setErr(msg)
    else onClose()
  }

  return (
    <div style={box} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={head}>구성을 템플릿으로 저장</div>
        <div style={sub}>
          체크 여부·수량·판매단가가 함께 저장됩니다. 구입가는 저장하지 않고 열 때 가격표에서 다시 계산합니다.
        </div>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.DIM, marginBottom: 4 }}>
          기종
        </label>
        <input
          value={modelKey}
          onChange={e => setModelKey(e.target.value)}
          placeholder="예) SURFCOM NEX 200"
          style={{ ...S.input, marginBottom: 12 }}
        />

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.DIM, marginBottom: 4 }}>
          구성 이름 ({itemCount}항목)
        </label>
        <input
          value={name}
          onChange={e => setName(e.target.value.slice(0, TEMPLATE_NAME_MAX))}
          style={S.input}
        />

        {err && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: C.RED }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ ...S.btn, color: C.MUT }}>취소</button>
          {picked && (
            <button type="button" disabled={busy} onClick={() => void run('overwrite')} style={busy ? S.btnOff : S.btn}>
              원본 수정
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void run('copy')} style={busy ? S.btnOff : S.btnPri}>
            {picked && !mine ? '내 이름으로 복사 저장' : '새 구성으로 저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

export type DeleteTemplateDialogProps = {
  target: QuoteTemplate
  busy: boolean
  onDelete: () => Promise<string>
  onClose: () => void
}

export function DeleteTemplateDialog({ target, busy, onDelete, onClose }: DeleteTemplateDialogProps) {
  const [err, setErr] = useState('')
  return (
    <div style={box} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={head}>이 구성을 삭제할까요?</div>
        <div style={sub}>목록에서 사라집니다. 이미 만든 견적서는 그대로 남습니다.</div>
        <div style={{ ...S.pill, margin: '0 0 4px' }}>
          <b style={{ fontWeight: 700 }}>{target.name}</b>
          <span style={{ color: C.MUT }}>{` · 만든 사람 ${target.owner_name}`}</span>
        </div>
        {err && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: C.RED }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ ...S.btn, color: C.MUT }}>취소</button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => { const m = await onDelete(); if (m) setErr(m); else onClose() }}
            style={busy ? S.btnOff : { ...S.btn, color: C.RED }}
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  )
}
