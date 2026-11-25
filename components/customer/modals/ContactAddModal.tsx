'use client'

/**
 * 고객 담당자 **추가** 창 (2026-11-25 개편).
 *
 * 전에는 창을 열면 바로 다섯 칸이 떴다. 이제 명함 탭과 같이 **방식을 먼저 고른다** —
 * 사진으로 읽거나, 직접 입력한다. 어느 쪽이든 **같은 폼**으로 들어간다.
 *
 *   ① 방식 고르기 — 사진으로 읽기 / 직접 입력 (아이콘은 인라인 SVG)
 *   ② 칸 아홉 개  — 명함과 같다(회사·주소·홈페이지는 사업장 것이라 없다)
 *
 * 사진은 **남지 않는다** — 줄여서 한 번 보내고 버린다(components/cards/useCardOcr).
 */

import { useRef, useState } from 'react'
import type { ContactForm } from '../types'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import ContactFields, { EMPTY_CONTACT } from './ContactFields'
import { BLUE, BLUE_TINT, BLUE_BORDER, BORDER, CARD_BG, MUTED, SUB, TEXT } from '@/components/common/ui'
import { useCardOcr } from '@/components/cards/useCardOcr'
import { OCR_NOTICE } from '@/lib/businessCardOcr'
import {
  CONTACT_FIELDS, canSaveContact, missingLabel, type ContactField,
} from '@/lib/contactForm'
import { R } from '@/lib/radius'
import { bigPickButton, bigPickHead, PICK_ICON } from './pickStyle'

type Props = {
  isOpen: boolean
  isSaving: boolean
  onClose: () => void
  onSave: (form: ContactForm) => void
}

const PADS = keepPads({ x: 16, top: 14, bottom: 10 }, 10, 12)
const emptyForm = EMPTY_CONTACT as ContactForm

export default function ContactAddModal({ isOpen, isSaving, onClose, onSave }: Props) {
  const [mode, setMode] = useState<'pick' | 'form'>('pick')
  const [form, setForm] = useState<ContactForm>(emptyForm)
  /** 사진에서 읽어 들어왔나 — 「사진에서 읽음 · 확인 필요」 띠를 둘지 정한다. */
  const [fromPhoto, setFromPhoto] = useState(false)
  const ocr = useCardOcr()
  /**
   * 사진 한 길 — 폰에서는 고르기 판이 **카메라**까지 함께 띄운다. 명함 탭처럼 촬영과
   * 올리기를 나누지 않는다(이 창의 방식은 둘뿐이라는 지시).
   */
  const photoRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null

  const reset = () => { setForm(emptyForm); setMode('pick'); setFromPhoto(false); ocr.reset() }
  const handleClose = () => { reset(); onClose() }

  const set = (f: ContactField, v: string) => setForm(p => ({ ...p, [f]: v }))

  /** 읽은 결과를 폼에 얹는다 — 사람이 이미 적은 칸은 덮지 않는다. */
  const pickPhoto = async (file: File | null | undefined) => {
    if (!file) return
    setFromPhoto(true)
    setMode('form')
    const fields = await ocr.read(file)
    if (!fields) return
    setForm(p => {
      const next = { ...p }
      for (const f of CONTACT_FIELDS) {
        const v = String(fields[f] ?? '').trim()
        if (v && next[f].trim() === '') next[f] = v
      }
      return next
    })
  }

  const blocked = !canSaveContact(form)
  const left = missingLabel(form)

  const handleSave = () => {
    if (blocked || isSaving) return
    onSave(form)
    setForm(emptyForm)
  }

  /** 적은 것이 있는가 — 없으면 Esc·바깥 클릭에 확인을 받지 않는다(ModalOverlay). */
  const dirty = JSON.stringify(form) !== JSON.stringify(emptyForm)

  // ── ① 방식 고르기 ───────────────────────────────────────────────────────
  if (mode === 'pick') {
    return (
      <ModalOverlay onClose={handleClose}>
        <ModalCard
          width={420}
          closeX={false}
          {...PADS}
          title={<div style={{ fontSize: 17, fontWeight: 800, color: TEXT }}>담당자 추가</div>}
          footer={
            <button type="button" onClick={handleClose}
              style={{
                height: 44, flex: 1, border: `1px solid ${BORDER}`, borderRadius: R.control,
                background: CARD_BG, color: SUB, fontWeight: 600, fontSize: 13,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              닫기
            </button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button type="button" style={bigPickButton} onClick={() => photoRef.current?.click()}>
              <span style={bigPickHead}>{PICK_ICON.camera}사진으로 읽기</span>
              <span style={{ fontSize: 12, color: SUB, fontWeight: 400 }}>
                명함을 찍거나 올리면 글자를 읽어 칸을 채웁니다 · 사진은 저장하지 않습니다
              </span>
            </button>
            <button type="button" style={bigPickButton} onClick={() => { setFromPhoto(false); setMode('form') }}>
              <span style={bigPickHead}>{PICK_ICON.pen}직접 입력</span>
              <span style={{ fontSize: 12, color: SUB, fontWeight: 400 }}>칸에 하나씩 입력</span>
            </button>
            <div style={{ fontSize: 12, color: SUB, padding: '4px 2px', lineHeight: 1.7 }}>
              사진으로 읽은 값은 틀릴 수 있으니 저장 전에 꼭 확인해 주세요.
            </div>
            <input ref={photoRef} type="file" accept="image/*,application/pdf" hidden
              onChange={e => void pickPhoto(e.target.files?.[0])} />
          </div>
        </ModalCard>
      </ModalOverlay>
    )
  }

  // ── ② 칸 채우기 ─────────────────────────────────────────────────────────
  return (
    <ModalOverlay onClose={handleClose} confirmClose dirty={dirty}>
      {/* 오른쪽 위 닫기 표시는 onClose 를 주지 않는다 — 오버레이가 내려 준 닫기 요청(Esc·바깥 클릭과
          **같은 함수**)을 쓴다. 그래서 적은 것이 있으면 세 길 모두 먼저 묻는다. */}
      <ModalCard
        title="담당자 추가"
        width={560}
        {...PADS}
        footer={<>
          <button type="button" onClick={handleClose}
            style={{
              height: 44, flex: 1, border: `1px solid ${BORDER}`, borderRadius: R.control,
              background: CARD_BG, color: SUB, fontWeight: 600, fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            취소
          </button>
          <button type="button" onClick={handleSave} disabled={blocked || isSaving}
            style={{
              height: 44, flex: 2, border: 'none', borderRadius: R.control,
              background: blocked || isSaving ? BORDER : BLUE,
              color: blocked || isSaving ? MUTED : '#fff',
              fontWeight: 700, fontSize: 14, fontFamily: 'inherit',
              cursor: blocked || isSaving ? 'default' : 'pointer',
            }}>
            {isSaving ? '저장 중...' : (left || '저장')}
          </button>
        </>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {fromPhoto && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
              background: BLUE_TINT, border: `1px solid ${BLUE_BORDER}`, borderRadius: R.control,
              fontSize: 12, color: TEXT,
            }}>
              {ocr.phase === 'reading' ? ocr.message : OCR_NOTICE}
            </div>
          )}
          {ocr.phase === 'error' && (
            <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7 }}>{ocr.message}</div>
          )}
          <ContactFields values={form} onChange={set} />
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}
