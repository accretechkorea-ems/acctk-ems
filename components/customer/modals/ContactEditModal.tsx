'use client'

/**
 * 고객 담당자 **수정** 창 (2026-11-25 개편).
 *
 * 추가 창과 **같은 칸·같은 필수 표시**를 쓴다(ContactFields). 전에는 다섯 칸만 있어,
 * 사진으로 읽어 담은 담당자를 고치면 휴대폰·팩스·메모가 화면에서 사라졌다.
 */

import { useEffect, useState } from 'react'
import type { Contact, ContactForm } from '../types'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import ContactFields, { EMPTY_CONTACT } from './ContactFields'
import { BLUE, BORDER, CARD_BG, DANGER, MUTED, SUB } from '@/components/common/ui'
import { CONTACT_FIELDS, canSaveContact, missingLabel, type ContactField } from '@/lib/contactForm'
import { R } from '@/lib/radius'

type Props = {
  contact: Contact | null
  isSaving: boolean
  onClose: () => void
  onSave: (form: ContactForm) => void
  /** 지우기 — 권한이 없으면 넘어오지 않는다(버튼도 내지 않는다). */
  onDelete?: () => void
}

const PADS = keepPads({ x: 16, top: 14, bottom: 10 }, 10, 12)

/** 열었을 때의 값 — 폼의 시작값이자 **변경 여부의 기준**이다(한 곳에서 만든다). */
const formOf = (c: Contact): ContactForm => {
  const out = { ...EMPTY_CONTACT } as ContactForm
  for (const f of CONTACT_FIELDS) {
    out[f] = String((c as unknown as Record<string, unknown>)[f] ?? '')
  }
  return out
}

export default function ContactEditModal({ contact, isSaving, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT as ContactForm)

  useEffect(() => { if (contact) setForm(formOf(contact)) }, [contact])

  if (!contact) return null

  const set = (f: ContactField, v: string) => setForm(p => ({ ...p, [f]: v }))
  const blocked = !canSaveContact(form)
  const left = missingLabel(form)

  const handleSave = () => {
    if (blocked || isSaving) return
    onSave(form)
  }

  /** 열었을 때와 달라졌는가 — 그대로면 확인 없이 닫힌다(ModalOverlay). */
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(contact))

  return (
    <ModalOverlay onClose={onClose} confirmClose dirty={dirty}>
      <ModalCard
        title="담당자 수정"
        width={560}
        {...PADS}
        footStyle={{ justifyContent: 'space-between' }}
        footer={<>
          {onDelete && (
            <button type="button" onClick={onDelete} disabled={isSaving}
              style={{
                height: 44, padding: '0 16px', border: `1px solid ${BORDER}`, borderRadius: R.control,
                background: CARD_BG, color: DANGER, fontWeight: 600, fontSize: 13,
                cursor: 'pointer', fontFamily: 'inherit', opacity: isSaving ? 0.6 : 1,
              }}>
              삭제
            </button>
          )}
          <div style={{ display: 'flex', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose}
              style={{
                height: 44, padding: '0 18px', border: `1px solid ${BORDER}`, borderRadius: R.control,
                background: CARD_BG, color: SUB, fontWeight: 600, fontSize: 13,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              취소
            </button>
            <button type="button" onClick={handleSave} disabled={blocked || isSaving}
              style={{
                height: 44, padding: '0 22px', border: 'none', borderRadius: R.control,
                background: blocked || isSaving ? BORDER : BLUE,
                color: blocked || isSaving ? MUTED : '#fff',
                fontWeight: 700, fontSize: 14, fontFamily: 'inherit',
                cursor: blocked || isSaving ? 'default' : 'pointer',
              }}>
              {isSaving ? '저장 중...' : (left || '저장')}
            </button>
          </div>
        </>}
      >
        <ContactFields values={form} onChange={set} />
      </ModalCard>
    </ModalOverlay>
  )
}
