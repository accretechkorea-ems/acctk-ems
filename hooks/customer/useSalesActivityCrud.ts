'use client'

// 영업 활동 CRUD. 모달 열림 상태와 선택된 활동도 이 훅이 소유한다
// (useServiceCrud / useContactCrud 와 같은 방식).
//
// RLS 가 로그인 사용자 전원 허용이라 본인 글 판정은 여기서 한다.
// suggestions 와 같은 방식: 작성자 본인 또는 superadmin 만 수정·삭제.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { isSuperAdmin } from '@/lib/permissions'
import type { SalesActivity, SalesActivityForm } from '@/components/customer/types'

type Args = {
  customerId: number
  engineerId: number | null
  role: string | null
  fetchDetail: () => Promise<boolean>
}

export function useSalesActivityCrud({ customerId, engineerId, role, fetchDetail }: Args) {
  const supabase = createClient()
  const toast = useToast()
  const confirmDialog = useConfirm()

  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false)
  const [editingActivity, setEditingActivity] = useState<SalesActivity | null>(null)
  const [isSavingActivity, setIsSavingActivity] = useState(false)

  const superAdmin = isSuperAdmin({ permission_level: role })
  // 작성자 본인이거나 superadmin 이면 수정·삭제 가능
  const canEditActivity = (a: SalesActivity) =>
    superAdmin || (engineerId !== null && a.engineer_id === engineerId)

  const openNewActivity = () => { setEditingActivity(null); setIsActivityModalOpen(true) }
  const openEditActivity = (a: SalesActivity) => { setEditingActivity(a); setIsActivityModalOpen(true) }
  const closeActivityModal = () => { setIsActivityModalOpen(false); setEditingActivity(null) }

  const handleSaveActivity = async (form: SalesActivityForm) => {
    if (!engineerId) { toast.error('사용자 정보를 불러오는 중입니다'); return }
    if (editingActivity && !canEditActivity(editingActivity)) { toast.error('본인이 작성한 기록만 수정할 수 있습니다'); return }

    setIsSavingActivity(true)
    const nowIso = new Date().toISOString()
    const { error } = editingActivity
      ? await supabase.from('sales_activities').update({
          opportunity_id: form.opportunity_id,
          activity_date: form.activity_date,
          activity_type: form.activity_type,
          contact_id: form.contact_id,
          content: form.content.trim(),
          updated_at: nowIso,
        }).eq('activity_id', editingActivity.activity_id)
      : await supabase.from('sales_activities').insert({
          customer_id: customerId,
          engineer_id: engineerId,
          opportunity_id: form.opportunity_id,
          activity_date: form.activity_date,
          activity_type: form.activity_type,
          contact_id: form.contact_id,
          content: form.content.trim(),
        })
    setIsSavingActivity(false)

    if (error) {
      console.error('[customer] save sales_activity failed', error)
      toast.error(error.message || '영업 활동 저장 중 오류가 발생했습니다')
      return
    }
    const wasEditing = !!editingActivity
    closeActivityModal()
    // 목록 갱신이 실패하면 fetchDetail 쪽에서 알리므로 성공 안내는 띄우지 않는다.
    if (await fetchDetail()) toast.success(wasEditing ? '영업 활동이 수정되었습니다' : '영업 활동이 기록되었습니다')
  }

  const handleDeleteActivity = async () => {
    if (!editingActivity) return
    if (!canEditActivity(editingActivity)) { toast.error('본인이 작성한 기록만 삭제할 수 있습니다'); return }
    const ok = await confirmDialog({
      title: '영업 활동 삭제',
      message: '이 기록을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.',
      confirmText: '삭제', variant: 'danger',
    })
    if (!ok) return

    setIsSavingActivity(true)
    const { error } = await supabase.from('sales_activities').delete().eq('activity_id', editingActivity.activity_id)
    setIsSavingActivity(false)
    if (error) {
      console.error('[customer] delete sales_activity failed', error)
      toast.error(error.message || '영업 활동 삭제 중 오류가 발생했습니다')
      return
    }
    closeActivityModal()
    if (await fetchDetail()) toast.success('영업 활동이 삭제되었습니다')
  }

  return {
    isActivityModalOpen, editingActivity, isSavingActivity,
    canEditActivity,
    openNewActivity, openEditActivity, closeActivityModal,
    handleSaveActivity, handleDeleteActivity,
  }
}
