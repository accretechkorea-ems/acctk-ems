'use client'

/**
 * 명함 등록·수정 창 — 보드 「명함 시안 · 모바일」의 ②③ 그대로 (2026-11-23).
 *
 *   ② 방식 고르기 — 📷 사진 촬영 / 🖼 사진 올리기 / ✎ 직접 입력
 *   ③ 확인·저장   — 셋 다 **같은 폼**이다. 사진에서 읽은 칸만 파랗게(.in.auto) 칠하고
 *                   위에 「사진에서 읽음 · 확인 필요」 칩을 단다.
 *
 * 보드와 다르게 한 곳(규칙이 이긴다)
 *   · 파랑은 보드의 #1e40af 가 아니라 토큰 BLUE(#234ea2)다.
 *   · 나이 꼬리표의 틴트 배경은 쓰지 않는다 — 디자인 규칙이 「상태색은 dot 으로만」이다.
 *     (이 창에는 꼬리표가 없다. 목록 쪽 이야기다)
 *
 * 폰에서 한 손으로 — 입력칸 높이 44 · 전화·이메일은 알맞은 키패드 · 하단 고정 바.
 */

import { useMemo, useRef, useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import { BLUE, BLUE_BORDER, BLUE_TINT, BORDER, CARD_BG, MUTED, SUB, TEXT } from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'
import { DIVISIONS, type Division } from '@/lib/division'
import {
  CARD_FIELDS, DUPLICATE_OPEN, DUPLICATE_SAVE, DUPLICATE_TITLE, EMPTY_CARD_FORM,
  FIELD_INPUT_TYPE, FIELD_LABEL, MEMO_MAX, cardBlockedReason, findDuplicate,
  type BusinessCard, type CardField, type CardForm,
} from '@/lib/businessCard'
import { OCR_NOTICE, mergeBack, type OcrFields } from '@/lib/businessCardOcr'
import { useCardOcr } from '@/components/cards/useCardOcr'
import { R } from '@/lib/radius'

/** 폰에서 한 손으로 — 칸 높이 44(보드 값). */
const INPUT_H = 44

const field = (auto: boolean): CSSProperties => ({
  width: '100%', height: INPUT_H, padding: '0 10px', boxSizing: 'border-box',
  border: `1px solid ${auto ? BLUE_BORDER : BORDER}`, borderRadius: R.control,
  background: auto ? BLUE_TINT : CARD_BG,
  fontSize: 14, color: TEXT, outline: 'none', fontFamily: 'inherit',
})
const labelStyle: CSSProperties = {
  fontSize: 12, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 4, display: 'block',
}
/** 공용 카드의 여백 — 보드의 16/12 을 그대로 쓴다. */
const PADS = keepPads({ x: 16, top: 14, bottom: 10 }, 10, 12)

const bigBtn: CSSProperties = {
  height: 88, width: '100%', border: `1px solid ${BORDER}`, borderRadius: R.card, background: CARD_BG,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
  fontSize: 14, fontWeight: 700, color: TEXT, cursor: 'pointer', fontFamily: 'inherit',
}

type Mode = 'pick' | 'form'

export default function CardFormModal({ initial, existing, defaultDivision, busy, onSave, onOpenExisting, onClose }: {
  /** 고치는 중이면 그 명함. 새로 담는 중이면 null. */
  initial: BusinessCard | null
  /** 새로 담을 때의 사업부 — **등록하는 사람의 팀 사업부**다(폼에서 바꿀 수 있다). */
  defaultDivision: Division
  /** 중복을 찾을 때 보는 목록(지금 화면이 들고 있는 것). */
  existing: readonly BusinessCard[]
  busy: boolean
  onSave: (form: CardForm) => void
  onOpenExisting: (card: BusinessCard) => void
  onClose: () => void
}) {
  const editing = initial != null
  const [mode, setMode] = useState<Mode>(editing ? 'form' : 'pick')
  const [form, setForm] = useState<CardForm>(() => {
    if (!initial) return { ...EMPTY_CARD_FORM, division: defaultDivision }
    const next = { ...EMPTY_CARD_FORM }
    for (const f of CARD_FIELDS) next[f] = String(initial[f] ?? '')
    next.division = (initial.division === '반도체' ? '반도체' : '계측') as Division
    return next
  })
  /** 사진에서 읽어 채운 칸 — 그 칸만 파랗게 칠한다. */
  const [autoFilled, setAutoFilled] = useState<Set<CardField>>(new Set())
  /** 사진으로 들어왔나 — 하단 바에 「다시 찍기」를 둘지 정한다. */
  const [fromPhoto, setFromPhoto] = useState(false)
  const [dup, setDup] = useState<BusinessCard | null>(null)
  const ocr = useCardOcr()

  const cameraRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const backRef = useRef<HTMLInputElement>(null)

  const set = (k: keyof CardForm, v: string) => setForm(p => ({ ...p, [k]: v }))

  /** 읽은 결과를 폼에 얹는다. 사람이 이미 고친 칸은 덮지 않는다. */
  const applyOcr = (fields: OcrFields, method: 'camera' | 'upload') => {
    const filled = new Set<CardField>()
    setForm(p => {
      const next = { ...p, input_method: method }
      for (const [k, v] of Object.entries(fields) as [CardField, string][]) {
        if (!v) continue
        if (p[k].trim() !== '') continue
        next[k] = v
        filled.add(k)
      }
      return next
    })
    setAutoFilled(prev => new Set([...prev, ...filled]))
  }

  const pickPhoto = async (file: File | null | undefined, method: 'camera' | 'upload') => {
    if (!file) return
    setFromPhoto(true)
    setMode('form')
    const fields = await ocr.read(file)
    if (fields) applyOcr(fields, method)
  }

  /** 뒷면 — 한 번 더 읽어 **빈 칸만** 채운다. */
  const readBack = async (file: File | null | undefined) => {
    if (!file) return
    const fields = await ocr.read(file)
    if (!fields) return
    const current: OcrFields = {}
    for (const f of CARD_FIELDS) if (form[f].trim()) current[f] = form[f]
    applyOcr(mergeBack(current, fields), form.input_method === 'manual' ? 'upload' : form.input_method as 'camera' | 'upload')
  }

  const blocked = cardBlockedReason(form)
  const duplicate = useMemo(
    () => (editing ? null : findDuplicate(form, existing)),
    [editing, form, existing],
  )

  const trySave = () => {
    if (blocked || busy) return
    if (duplicate) { setDup(duplicate); return }
    onSave(form)
  }

  // ── ② 방식 고르기 ──────────────────────────────────────────────────────
  if (mode === 'pick') {
    return (
      <ModalOverlay onClose={onClose}>
        <ModalCard
          width={420}
          closeX={false}
          {...PADS}
          title={<div style={{ fontSize: 17, fontWeight: 800, color: TEXT }}>명함 등록</div>}
          footer={
            <button type="button" onClick={onClose}
              style={{ height: INPUT_H, flex: 1, border: `1px solid ${BORDER}`, borderRadius: R.control, background: CARD_BG, color: SUB, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              닫기
            </button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button type="button" style={bigBtn} onClick={() => cameraRef.current?.click()}>
              📷 사진 촬영
              <span style={{ fontSize: 12, color: SUB, fontWeight: 400 }}>명함을 찍으면 글자를 읽어 칸을 채웁니다 · 사진은 저장하지 않습니다</span>
            </button>
            <button type="button" style={bigBtn} onClick={() => uploadRef.current?.click()}>
              🖼 사진 올리기
              <span style={{ fontSize: 12, color: SUB, fontWeight: 400 }}>이미 찍어 둔 사진에서 읽기</span>
            </button>
            <button type="button" style={bigBtn} onClick={() => { setFromPhoto(false); setMode('form') }}>
              ✎ 직접 입력
              <span style={{ fontSize: 12, color: SUB, fontWeight: 400 }}>명함을 보고 칸에 입력</span>
            </button>
            <div style={{ fontSize: 12, color: SUB, padding: '4px 2px', lineHeight: 1.7 }}>
              사진으로 읽은 값은 틀릴 수 있으니 저장 전에 꼭 확인해 주세요.
            </div>
            {/* 폰에서는 capture 가 바로 카메라를 연다. PC 에서는 파일 고르기로 떨어진다. */}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
              onChange={e => void pickPhoto(e.target.files?.[0], 'camera')} />
            <input ref={uploadRef} type="file" accept="image/*" hidden
              onChange={e => void pickPhoto(e.target.files?.[0], 'upload')} />
          </div>
        </ModalCard>
      </ModalOverlay>
    )
  }

  // ── ③ 확인·저장 ────────────────────────────────────────────────────────
  /** 칸 한 개. **컴포넌트가 아니라 함수**다 — 렌더마다 새 컴포넌트를 만들면 입력 상태가 날아간다. */
  const row = (f: CardField, wide = false) => (
    <div key={f} style={{ gridColumn: wide ? '1 / -1' : undefined, minWidth: 0 }}>
      <label style={labelStyle} htmlFor={`bc-${f}`}>{FIELD_LABEL[f]}</label>
      <input id={`bc-${f}`} value={form[f]} type={FIELD_INPUT_TYPE[f] ?? 'text'}
        onChange={e => { set(f, e.target.value); setAutoFilled(prev => { const n = new Set(prev); n.delete(f); return n }) }}
        style={field(autoFilled.has(f))} />
    </div>
  )

  return (
    <ModalOverlay onClose={onClose} confirmClose dirty={form.name.trim() !== ''}>
      <ModalCard
        width={460}
        closeX={false}
        {...PADS}
        title={<>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 17, fontWeight: 800, color: TEXT }}>{editing ? '명함' : '명함 등록'}</b>
            <span style={{ flex: 1 }} />
            {autoFilled.size > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: R.pill,
                background: BLUE_TINT, color: BLUE, border: `1px solid ${BLUE_BORDER}`, whiteSpace: 'nowrap',
              }}>
                {OCR_NOTICE}
              </span>
            )}
          </div>
          {/* 읽는 중 — 진행률을 한 줄로 */}
          {(ocr.phase === 'loading' || ocr.phase === 'reading') && (
            <div style={{ marginTop: 8, padding: '7px 10px', background: BLUE_TINT, borderRadius: R.control, fontSize: 12, fontWeight: 700, color: BLUE }}>
              {ocr.message}
            </div>
          )}
          {ocr.phase === 'error' && (
            <div style={{ marginTop: 8, padding: '7px 10px', background: '#fef2f2', borderRadius: R.control, fontSize: 12, color: '#b91c1c' }}>
              {ocr.message}
            </div>
          )}
        </>}
        footer={<>
          {fromPhoto && !editing && (
            <button type="button" onClick={() => cameraRef.current?.click()}
              style={{ height: INPUT_H, flex: 1, border: `1px solid ${BORDER}`, borderRadius: R.control, background: CARD_BG, color: TEXT, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              다시 찍기
            </button>
          )}
          <button type="button" onClick={onClose}
            style={{ height: INPUT_H, flex: 1, border: `1px solid ${BORDER}`, borderRadius: R.control, background: CARD_BG, color: SUB, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            닫기
          </button>
          <button type="button" onClick={trySave} disabled={blocked != null || busy}
            style={{
              height: INPUT_H, flex: 2, border: 'none', borderRadius: R.control,
              background: blocked || busy ? '#e5e7eb' : BLUE, color: blocked || busy ? MUTED : '#fff',
              fontWeight: 700, fontSize: 14, cursor: blocked || busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}>
            {busy ? '저장 중…' : '저장'}
          </button>
        </>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {row('name', true)}
          {row('position')}
          {row('department')}
          {row('company', true)}
          {row('mobile')}
          {row('phone')}
          {row('email', true)}
          {row('address', true)}
          {row('fax')}
          {row('website')}

          <div>
            <label style={labelStyle} htmlFor="bc-division">사업부</label>
            <select id="bc-division" value={form.division} onChange={e => set('division', e.target.value)} style={field(false)}>
              {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>등록일</label>
            {/* 등록일은 고칠 수 없다 — 명함의 나이가 꼬리표 색을 정한다(트리거도 막는다). */}
            <div style={{ ...field(false), display: 'flex', alignItems: 'center', color: SUB, background: '#f9fafb' }}>
              {(initial?.registered_at ?? new Date().toISOString()).slice(0, 10)} (자동)
            </div>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle} htmlFor="bc-memo">메모</label>
            <textarea id="bc-memo" value={form.memo} maxLength={MEMO_MAX}
              onChange={e => set('memo', e.target.value)} placeholder="만난 자리 · 특이사항"
              style={{ ...field(false), height: 64, padding: '9px 10px', resize: 'vertical' }} />
          </div>

          {/* 영문 뒷면 — 한 번 더 읽어 **빈 칸만** 채운다 */}
          <button type="button" onClick={() => backRef.current?.click()}
            style={{
              gridColumn: '1 / -1', height: 36, border: `1px solid ${BORDER}`, borderRadius: R.control,
              background: CARD_BG, color: BLUE, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            뒷면 추가로 읽기
          </button>
          <input ref={backRef} type="file" accept="image/*" hidden onChange={e => void readBack(e.target.files?.[0])} />

          {blocked && <div style={{ gridColumn: '1 / -1', fontSize: 12, color: SUB }}>{blocked}</div>}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
            onChange={e => void pickPhoto(e.target.files?.[0], 'camera')} />
        </div>
      </ModalCard>

      {/* 같은 명함이 이미 있을 때 — 막지 않고 물어본다 */}
      {dup && (
        <ModalOverlay onClose={() => setDup(null)} style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 380, background: CARD_BG, borderRadius: R.modal, padding: 22,
            boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
          }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, marginBottom: 8 }}>{DUPLICATE_TITLE}</div>
            <div style={{ fontSize: 13, color: SUB, lineHeight: 1.8, marginBottom: 16 }}>
              <b style={{ color: TEXT }}>{dup.name}</b>
              {dup.company ? ` · ${dup.company}` : ''}
              <br />
              {dup.mobile ?? dup.email ?? ''} · 등록 {String(dup.registered_at).slice(0, 10)}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => { setDup(null); onOpenExisting(dup) }}
                style={{ flex: 1, height: INPUT_H, border: `1px solid ${BORDER}`, borderRadius: R.control, background: CARD_BG, color: TEXT, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                {DUPLICATE_OPEN}
              </button>
              <button type="button" onClick={() => { setDup(null); onSave(form) }}
                style={{ flex: 1, height: INPUT_H, border: 'none', borderRadius: R.control, background: BLUE, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                {DUPLICATE_SAVE}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </ModalOverlay>
  )
}
