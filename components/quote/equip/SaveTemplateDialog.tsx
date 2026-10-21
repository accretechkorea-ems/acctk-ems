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

/**
 * 구성 이름 기본값 — 「만든 사람 · 기종 · N항목」.
 *
 * **placeholder 가 아니라 실제 입력값**으로 넣는다. 안내문으로만 띄우면 사람이 그대로
 * 저장을 눌렀을 때 이름이 빈 채로 서버에 가고 「템플릿 이름을 입력해주세요」로 막힌다 —
 * 화면에는 글자가 보이는데 막히니 이유를 알 수 없다.
 */
export const buildTemplateName = (who: string, modelKey: string, count: number): string =>
  [who.trim(), modelKey.trim(), `${count}항목`].filter(Boolean).join(' · ')

export type SaveTemplateDialogProps = {
  /** 지금 고른 템플릿(없으면 새 구성이다). */
  picked: QuoteTemplate | null
  /** 내가 만든 것인가 — 「원본 수정」을 앞에 둘지 정한다. */
  mine: boolean
  /** 만든 사람 이름·직급. 이름 기본값의 앞머리가 된다. */
  who: string
  modelKey: string
  setModelKey: (v: string) => void
  itemCount: number
  busy: boolean
  /** 빈 문자열이면 성공, 그 밖은 보여 줄 오류 문구다. */
  onSave: (name: string, mode: 'copy' | 'overwrite') => Promise<string>
  onClose: () => void
}

export function SaveTemplateDialog(props: SaveTemplateDialogProps) {
  const { picked, mine, who, modelKey, setModelKey, itemCount, busy, onSave, onClose } = props
  // 이름은 **상태 하나**다. 화면에 그리는 값과 보내는 값이 같은 변수여야 한다 —
  // 「화면용 파생값 + 전송용 상태」로 나누면 사람이 손대기 전에는 둘이 다른 값이 되고,
  // 눈에는 이름이 보이는데 서버는 빈 이름을 받는다(「템플릿 이름을 입력해주세요」).
  const [name, setName] = useState(() => buildTemplateName(who, modelKey, itemCount))
  // 사람이 이름을 손댔는가 — 손댄 뒤에는 기종을 바꿔도 그 글자를 덮지 않는다.
  const [touched, setTouched] = useState(false)
  const [err, setErr] = useState('')

  /** 기종을 치면 이름도 **같은 변수**를 고쳐 따라가게 한다(손대기 전까지만). */
  const changeModelKey = (v: string) => {
    setModelKey(v)
    if (!touched) setName(buildTemplateName(who, v, itemCount))
  }

  const run = async (mode: 'copy' | 'overwrite') => {
    // 기종은 왼쪽 목록을 묶는 열쇠다 — 비면 어느 기종 구성인지 알 수 없다.
    if (!modelKey.trim()) {
      setErr('기종을 입력해주세요')
      return
    }
    if (!name.trim()) {
      setErr('구성 이름을 입력해주세요')
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
          체크 여부·수량·판매단가가 함께 저장됩니다. 가격표 품목의 구입가는 열 때 다시 계산하고, 직접 적은 줄의 구입가·원가는 그대로 저장합니다.
        </div>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.DIM, marginBottom: 4 }}>
          기종 (필수)
        </label>
        <input
          value={modelKey}
          onChange={e => changeModelKey(e.target.value)}
          placeholder="예) SURFCOM NEX 200"
          style={{ ...S.input, marginBottom: 12 }}
        />

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.DIM, marginBottom: 4 }}>
          구성 이름 ({itemCount}항목)
        </label>
        <input
          value={name}
          onChange={e => { setTouched(true); setName(e.target.value.slice(0, TEMPLATE_NAME_MAX)) }}
          style={S.input}
        />
        <div style={{ fontSize: 11, fontWeight: 500, color: C.DIM, marginTop: 4 }}>
          기종을 적으면 이름도 따라 바뀝니다. 직접 고치면 그대로 둡니다.
        </div>

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
