'use client'

// 담당자 CRUD. 담당자 모달의 열림 상태(추가 모달 / 선택된 담당자)도 여기서 들고 있다.
// 핸들러가 그 상태를 그대로 읽으므로 상태와 핸들러를 같은 곳에 둔다.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import type { Contact, ContactForm } from '@/components/customer/types'

type Args = {
  customerId: number
  fetchDetail: () => Promise<boolean>
}

export function useContactCrud({ customerId, fetchDetail }: Args) {
  const supabase = createClient()
  const toast = useToast()
  const confirmDialog = useConfirm()

  const [isAddContactModalOpen, setIsAddContactModalOpen] = useState(false)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [isSavingContact, setIsSavingContact] = useState(false)
  const [isSavingContactEdit, setIsSavingContactEdit] = useState(false)

  const handleAddContact = async (form: ContactForm) => {
    setIsSavingContact(true)
    const { error } = await supabase.from('contacts').insert([{ customer_id: customerId, name: form.name.trim(), department: form.department.trim() || null, position: form.position.trim() || null, phone: form.phone.trim() || null, email: form.email.trim() || null }])
    setIsSavingContact(false)
    if (error) { toast.error(error.message || '담당자 추가 중 오류가 발생했습니다'); return }
    toast.success('담당자가 추가되었습니다')
    setIsAddContactModalOpen(false)
    await fetchDetail()
  }

  const handleUpdateContact = async (form: ContactForm) => {
    if (!selectedContact) return
    setIsSavingContactEdit(true)
    const { error } = await supabase.from('contacts').update({ name: form.name.trim(), department: form.department.trim() || null, position: form.position.trim() || null, phone: form.phone.trim() || null, email: form.email.trim() || null }).eq('contact_id', selectedContact.contact_id)
    setIsSavingContactEdit(false)
    if (error) { toast.error(error.message || '담당자 수정 중 오류가 발생했습니다'); return }
    toast.success('담당자 정보가 수정되었습니다')
    setSelectedContact(null)
    await fetchDetail()
  }

  const handleDeleteContact = async () => {
    if (!selectedContact) return
    const ok = await confirmDialog({ title: '담당자 삭제', message: '이 담당자를 삭제하시겠습니까?', confirmText: '삭제', variant: 'danger' })
    if (!ok) return
    setIsSavingContactEdit(true)
    const { error } = await supabase.from('contacts').update({ deleted_at: new Date().toISOString() }).eq('contact_id', selectedContact.contact_id)
    setIsSavingContactEdit(false)
    if (error) { toast.error(error.message || '담당자 삭제 중 오류가 발생했습니다'); return }
    toast.success('담당자가 삭제되었습니다')
    setSelectedContact(null)
    await fetchDetail()
  }

  return {
    isAddContactModalOpen, setIsAddContactModalOpen,
    selectedContact, setSelectedContact,
    isSavingContact, isSavingContactEdit,
    handleAddContact, handleUpdateContact, handleDeleteContact,
  }
}
