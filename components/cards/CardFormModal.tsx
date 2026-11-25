'use client'

/**
 * 명함 등록·수정 창 — 보드 「명함 시안 · 모바일」의 ②③ 그대로 (2026-11-23).
 *
 *   ② 방식 고르기 — 사진 촬영 / 사진 올리기 / 직접 입력 (아이콘은 인라인 SVG)
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

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import { BLUE, BLUE_BORDER, BLUE_TINT, BORDER, CARD_BG, DANGER, MUTED, SUB, TEXT } from '@/components/common/ui'
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
  // 폰(390)에서는 설명이 두 줄로 접힌다 — 높이를 고정하면 글자가 테두리에 닿는다(2026-11-23 실측).
  minHeight: 88, width: '100%', padding: '12px 14px', boxSizing: 'border-box',
  border: `1px solid ${BORDER}`, borderRadius: R.card, background: CARD_BG,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
  fontSize: 14, fontWeight: 700, color: TEXT, cursor: 'pointer', fontFamily: 'inherit',
}
/** 큰 버튼의 첫 줄 — 아이콘 + 이름. */
const bigBtnHead: CSSProperties = { display: 'flex', alignItems: 'center', gap: 7 }

/** 열람 모드의 라벨·값 — 입력칸이 아니라 **글자**다. */
const viewLabel: CSSProperties = { fontSize: 12, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 3 }
const viewValue: CSSProperties = { fontSize: 14, color: TEXT, wordBreak: 'break-word' }

/** 하단의 흐린 버튼(닫기·삭제·취소). */
const ghostBtn: CSSProperties = {
  height: 44, flex: 1, border: `1px solid ${BORDER}`, borderRadius: R.control,
  background: CARD_BG, color: SUB, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
}

/**
 * 방식 셋의 아이콘 — **lucide 모양 인라인 SVG**다(디자인 규칙: 이모지를 아이콘으로 쓰지 않는다).
 * lucide-react 는 미설치라 import 하지 않고 path 를 직접 적는다. stroke-width 2 · 18px.
 */
const svg = (children: ReactNode) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={BLUE}
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)
const ICON = {
  camera: svg(<><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" /><circle cx="12" cy="13" r="3" /></>),
  image: svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></>),
  pen: svg(<><path d="M12 20h9" /><path d="M16.4 3.6a1 1 0 0 1 3 3L7.4 18.6a2 2 0 0 1-.9.5l-2.8.8a.5.5 0 0 1-.6-.6l.8-2.8a2 2 0 0 1 .5-.9Z" /></>),
  stack: svg(<><rect x="7" y="3" width="14" height="14" rx="2" /><path d="M3 7v12a2 2 0 0 0 2 2h12" /></>),
}

type Mode = 'pick' | 'form'

export default function CardFormModal({
  initial, existing, defaultDivision, busy, canDelete, registrarPosition,
  onSave, onOpenExisting, onDelete, onBulk, onClose,
}: {
  /** 고치는 중이면 그 명함. 새로 담는 중이면 null. */
  initial: BusinessCard | null
  /** 새로 담을 때의 사업부 — **등록하는 사람의 팀 사업부**다(폼에서 바꿀 수 있다). */
  defaultDivision: Division
  /** 중복을 찾을 때 보는 목록(지금 화면이 들고 있는 것). */
  existing: readonly BusinessCard[]
  busy: boolean
  /** 이 사람이 이 명함을 지울 수 있나 — 열람 모드의 「삭제」를 둘지 정한다. */
  canDelete?: boolean
  /** 등록자의 **지금 직급** — engineers 에서 찾아 넘긴다. 없으면 이름만 적는다. */
  registrarPosition?: string | null
  /** 저장한다. 참을 돌려주면 창이 **열람 모드**로 돌아간다. */
  onSave: (form: CardForm) => void | Promise<boolean>
  onOpenExisting: (card: BusinessCard) => void
  onDelete?: () => void
  /** 「여러 장 등록」으로 건너간다 — 방식 고르기의 네 번째 항목. */
  onBulk?: () => void
  onClose: () => void
}) {
  const editing = initial != null
  const [mode, setMode] = useState<Mode>(editing ? 'form' : 'pick')
  /** 이미 담긴 명함은 **읽는 것이 먼저**다. 「수정」을 눌러야 입력칸이 뜬다. */
  const [mode2, setMode2] = useState<'view' | 'edit'>('view')
  /** 폰이면 1단 세로. 넓으면 2단(스크롤 없이 한눈에). */
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 900)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
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
    // 고치던 중이면 저장이 끝난 뒤 **열람 모드**로 돌아간다(창은 닫지 않는다).
    const done = onSave(form)
    if (editing && done && typeof (done as Promise<boolean>).then === 'function') {
      void (done as Promise<boolean>).then(ok => { if (ok) setMode2('view') })
    }
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
              <span style={bigBtnHead}>{ICON.camera}사진 촬영</span>
              <span style={{ fontSize: 12, color: SUB, fontWeight: 400 }}>명함을 찍으면 글자를 읽어 칸을 채웁니다 · 사진은 저장하지 않습니다</span>
            </button>
            <button type="button" style={bigBtn} onClick={() => uploadRef.current?.click()}>
              <span style={bigBtnHead}>{ICON.image}파일 올리기</span>
              <span style={{ fontSize: 12, color: SUB, fontWeight: 400 }}>이미 찍어 둔 사진에서 읽기 (jpg · png · pdf)</span>
            </button>
            <button type="button" style={bigBtn} onClick={() => { setFromPhoto(false); setMode('form') }}>
              <span style={bigBtnHead}>{ICON.pen}직접 입력</span>
              <span style={{ fontSize: 12, color: SUB, fontWeight: 400 }}>명함을 보고 칸에 입력</span>
            </button>
            {/* 네 번째 길 — 수십·수백 장을 한 번에. 검토 화면이 PC 전용이라 **넓은 화면에서만** 둔다. */}
            {onBulk && !narrow && (
              <button type="button" style={bigBtn} onClick={onBulk}>
                <span style={bigBtnHead}>{ICON.stack}여러 장 등록</span>
                <span style={{ fontSize: 12, color: SUB, fontWeight: 400 }}>PDF·사진 여러 장을 한 번에</span>
              </button>
            )}
            <div style={{ fontSize: 12, color: SUB, padding: '4px 2px', lineHeight: 1.7 }}>
              사진으로 읽은 값은 틀릴 수 있으니 저장 전에 꼭 확인해 주세요.
            </div>
            {/* 폰에서는 capture 가 바로 카메라를 연다. PC 에서는 파일 고르기로 떨어진다. */}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
              onChange={e => void pickPhoto(e.target.files?.[0], 'camera')} />
            <input ref={uploadRef} type="file" accept="image/*,application/pdf" hidden
              onChange={e => void pickPhoto(e.target.files?.[0], 'upload')} />
          </div>
        </ModalCard>
      </ModalOverlay>
    )
  }

  // ── ③ 열람 ─────────────────────────────────────────────────────────────
  /**
   * 이미 담긴 명함은 **읽는 것이 먼저**다(2026-11-25). 전에는 열자마자 입력칸이 떠
   * 고치는 창처럼 보였다. 이제 글자로 보여 주고, 「수정」을 눌러야 입력 모드가 된다.
   */
  if (editing && mode2 === 'view') {
    const show = (f: CardField) => {
      const v = String(form[f] ?? '').trim()
      return (
        <div key={f} style={{ minWidth: 0 }}>
          <div style={viewLabel}>{FIELD_LABEL[f]}</div>
          <div style={viewValue}>{v || '—'}</div>
        </div>
      )
    }
    return (
      <ModalOverlay onClose={onClose}>
        <ModalCard
          width={760}
          closeX={false}
          {...PADS}
          ariaLabel="명함"
          title={<div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <b style={{ fontSize: 17, fontWeight: 800, color: TEXT }}>{form.name || '명함'}</b>
            {form.position && <span style={{ fontSize: 13, color: SUB }}>{form.position}</span>}
          </div>}
          footer={<>
            <button type="button" onClick={onClose} style={ghostBtn}>닫기</button>
            {canDelete && onDelete && (
              <button type="button" onClick={onDelete} disabled={busy}
                style={{ ...ghostBtn, color: DANGER }}>
                삭제
              </button>
            )}
            <button type="button" onClick={() => setMode2('edit')}
              style={{
                height: INPUT_H, flex: 2, border: 'none', borderRadius: R.control,
                background: BLUE, color: '#fff', fontWeight: 700, fontSize: 14,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              수정
            </button>
          </>}
        >
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr', gap: '14px 20px' }}>
            {/* 좌 — 누구인가 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {(['name', 'name_en', 'position', 'department', 'company', 'company_en'] as CardField[]).map(show)}
            </div>
            {/* 우 — 어떻게 닿는가 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {(['mobile', 'phone', 'fax', 'email', 'website', 'address'] as CardField[]).map(show)}
            </div>
            {/* 하 — 언제·누가·메모 */}
            {/* 하 — 한 줄로: 사업부 | 등록자(이름 · 직급) | 등록일. 팀은 적지 않는다. */}
            <div style={{
              gridColumn: '1 / -1', display: 'flex', gap: narrow ? 14 : 28, paddingTop: 12,
              flexWrap: 'wrap', borderTop: `1px solid ${BORDER}`,
            }}>
              <div>
                <div style={viewLabel}>사업부</div>
                <div style={viewValue}>{form.division}</div>
              </div>
              <div>
                <div style={viewLabel}>등록자</div>
                <div style={viewValue}>
                  {[String(initial?.registered_name ?? '').trim() || '—', registrarPosition?.trim()]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
              <div>
                <div style={viewLabel}>등록일</div>
                <div style={viewValue}>{String(initial?.registered_at ?? '').slice(0, 10) || '—'}</div>
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={viewLabel}>메모</div>
              <div style={{ ...viewValue, whiteSpace: 'pre-wrap' }}>{form.memo.trim() || '—'}</div>
            </div>
          </div>
        </ModalCard>
      </ModalOverlay>
    )
  }

  // ── ④ 확인·저장 ────────────────────────────────────────────────────────
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
        width={760}
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
          {ocr.phase === 'reading' && (
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
          {/* 이미 담긴 명함을 고치는 중이면 **취소**로 열람 모드에 돌아간다. */}
          <button type="button" onClick={() => { if (editing) setMode2('view'); else onClose() }} style={ghostBtn}>
            {editing ? '취소' : '닫기'}
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
        <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr', gap: 10 }}>
          {row('name', true)}
          {/* 영문은 한글 칸 **바로 아래**에 선다. 선택 입력이다 — 영문이 없는 명함이 더 많다. */}
          {row('name_en', true)}
          {row('position')}
          {row('department')}
          {row('company', true)}
          {row('company_en', true)}
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
          <input ref={backRef} type="file" accept="image/*,application/pdf" hidden onChange={e => void readBack(e.target.files?.[0])} />

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
