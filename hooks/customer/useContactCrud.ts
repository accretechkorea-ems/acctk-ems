'use client'

// 고객 담당자(contacts) CRUD. 모달의 열림 상태(추가 모달 / 선택된 담당자)도 여기서 들고 있다.
// 핸들러가 그 상태를 그대로 읽으므로 상태와 핸들러를 같은 곳에 둔다.

import { useState } from 'react'
import { customerChange } from '@/lib/customerChange'
import { customerDelete } from '@/lib/customerDelete.client'
import { useToast } from '@/components/common/Toast'
import type { Contact, ContactForm } from '@/components/customer/types'

type Args = {
  customerId: number
  fetchDetail: () => Promise<boolean>
}

/** 담당자 칸 한 벌 — 추가·수정이 같은 모양을 보낸다(라우트의 흰 목록과 짝이다). */
const contactPatch = (form: ContactForm) => ({
  name: form.name.trim(),
  department: form.department.trim() || null,
  position: form.position.trim() || null,
  phone: form.phone.trim() || null,
  email: form.email.trim() || null,
})

export function useContactCrud({ customerId, fetchDetail }: Args) {
  const toast = useToast()

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
