'use client'

// 고객 담당자(contacts) CRUD. 모달의 열림 상태(추가 모달 / 선택된 담당자)도 여기서 들고 있다.
// 핸들러가 그 상태를 그대로 읽으므로 상태와 핸들러를 같은 곳에 둔다.

import { useState } from 'react'
import { customerChange } from '@/lib/customerChange'
import { customerDelete } from '@/lib/customerDelete.client'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import type { Contact, ContactForm } from '@/components/customer/types'
import {
  CONTACT_FIELDS, CONTACT_INPUT_METHOD, COPY_TO_CARDS_MESSAGE, COPY_TO_CARDS_TITLE,
  cardPatchFromContact,
} from '@/lib/contactForm'

type Args = {
  customerId: number
  fetchDetail: () => Promise<boolean>
  /**
   * 이 사업장(대리점) — 담당자를 **명함첩에도 담을 때** 회사·주소를 여기서 가져온다.
   * 넘기지 않으면 묻지 않는다(명함을 만들 밑값이 없다).
   */
  site?: { company?: string | null; address?: string | null; website?: string | null }
}

/** 담당자 칸 한 벌 — 추가·수정이 같은 모양을 보낸다(라우트의 흰 목록과 짝이다). */
const contactPatch = (form: ContactForm) => {
  const out: Record<string, string | null> = {}
  for (const f of CONTACT_FIELDS) {
    const v = String(form[f] ?? '').trim()
    out[f] = f === 'name' ? v : (v || null)
  }
  return out
}

/**
 * 담당자 한 사람을 **명함첩에도** 한 장 담는다 (2026-11-25).
 *
 * 복사일 뿐이다 — 연결 키는 두지 않는다(지시). 사업부는 라우트가 등록하는 사람의 것으로
 * 채운다. 표의 CHECK 에 'contact' 가 아직 없으면(SQL 미적용) 라우트가 'manual' 로 담는다.
 */
async function copyToCards(
  form: ContactForm,
  site: { company?: string | null; address?: string | null; website?: string | null },
): Promise<boolean> {
  try {
    const res = await fetch('/api/business-card', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        patch: cardPatchFromContact(form, site),
        input_method: CONTACT_INPUT_METHOD,
      }),
    })
    return res.ok
  } catch (e) {
    console.error('[contact] 명함첩에 담지 못했다', e)
    return false
  }
}

export function useContactCrud({ customerId, fetchDetail, site }: Args) {
  const toast = useToast()
  const confirmDialog = useConfirm()

  const [isAddContactModalOpen, setIsAddContactModalOpen] = useState(false)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [isSavingContact, setIsSavingContact] = useState(false)
  const [isSavingContactEdit, setIsSavingContactEdit] = useState(false)

  const handleAddContact = async (form: ContactForm) => {
    setIsSavingContact(true)
    const r = await customerChange({ action: 'contact-add', customerId, patch: contactPatch(form) })
    setIsSavingContact(false)
    if (!r.ok) { toast.error(r.error || '고객 담당자 추가 중 오류가 발생했습니다'); return }
    toast.success('고객 담당자가 추가되었습니다')
    setIsAddContactModalOpen(false)
    await fetchDetail()
    // 명함첩에도 담을지 — 묻고 나서만 한다(사업장 값이 있을 때).
    if (site) {
      const yes = await confirmDialog({
        title: COPY_TO_CARDS_TITLE,
        message: COPY_TO_CARDS_MESSAGE,
        confirmText: '예, 담기',
        cancelText: '아니요',
      })
      if (yes) {
        const ok = await copyToCards(form, site)
        if (ok) toast.success('명함첩에도 담았습니다')
        else toast.error('명함첩에 담지 못했습니다')
      }
    }
  }

  const handleUpdateContact = async (form: ContactForm) => {
    if (!selectedContact) return
    setIsSavingContactEdit(true)
    const r = await customerChange({ action: 'contact-edit', id: selectedContact.contact_id, patch: contactPatch(form) })
    setIsSavingContactEdit(false)
    if (!r.ok) { toast.error(r.error || '고객 담당자 수정 중 오류가 발생했습니다'); return }
    toast.success('고객 담당자 정보가 수정되었습니다')
    setSelectedContact(null)
    await fetchDetail()
  }

  /**
   * 담당자 삭제 — **숨기기다**(deleted_at). 라우트가 한다(2026-11-23).
   * 슈퍼관리자만 할 수 있고, 까닭을 받아 사건으로 남긴다. 창은 부르는 화면이 띄운다.
   */
  const [deleteContactOpen, setDeleteContactOpen] = useState(false)
  const openDeleteContact = () => { if (selectedContact) setDeleteContactOpen(true) }
  const confirmDeleteContact = async (reason: string) => {
    if (!selectedContact) return
    setIsSavingContactEdit(true)
    const r = await customerDelete({ action: 'delete', target: 'contact', id: selectedContact.contact_id, reason })
    setIsSavingContactEdit(false)
    if (!r.ok) { toast.error(r.error); return }
    setDeleteContactOpen(false)
    toast.success('담당자를 숨겼습니다')
    setSelectedContact(null)
    await fetchDetail()
  }

  return {
    isAddContactModalOpen, setIsAddContactModalOpen,
    selectedContact, setSelectedContact,
    isSavingContact, isSavingContactEdit,
    handleAddContact, handleUpdateContact,
    // 삭제 — 창을 열고(openDeleteContact), 창이 까닭과 함께 부른다.
    deleteContactOpen, setDeleteContactOpen, openDeleteContact, confirmDeleteContact,
  }
}
