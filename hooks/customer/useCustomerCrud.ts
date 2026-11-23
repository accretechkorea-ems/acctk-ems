'use client'

// 업체 정보 수정 · 삭제. 수정 모달의 열림 상태도 여기서 들고 있다
// (삭제가 끝나면 모달을 닫고 목록으로 보내야 하므로 핸들러와 같은 곳에 둔다).

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveCustomerEdit } from '@/lib/saveCustomerEdit'
import { useToast } from '@/components/common/Toast'
import type { Customer, CustomerEditFormData } from '@/components/customer/types'
import { customerDelete } from '@/lib/customerDelete.client'
import { EMPTY_COUNTS, type DeleteCounts } from '@/lib/customerDelete'

type Args = {
  customer: Customer | null
  fetchDetail: () => Promise<boolean>
}

export function useCustomerCrud({ customer, fetchDetail }: Args) {
  const router = useRouter()
  const toast = useToast()

  const [isEditCustomerModalOpen, setIsEditCustomerModalOpen] = useState(false)
  const [isSavingCustomerEdit, setIsSavingCustomerEdit] = useState(false)
  const [isDeletingCustomer, setIsDeletingCustomer] = useState(false)
  /** 지우기 창이 떠 있는가 + 연결 기록 수. */
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteCounts, setDeleteCounts] = useState<DeleteCounts | null>(null)

  const handleUpdateCustomer = async (form: CustomerEditFormData) => {
    if (!customer) return
    // 사용자 검증(업체명/주소)은 CustomerEditModal 에서 인라인으로 처리한다.
    // 저장 규칙 자체는 lib/saveCustomerEdit.ts 하나다 — 목록 보기의 사업장 표도 같은 길을 쓴다.
    setIsSavingCustomerEdit(true)
    const r = await saveCustomerEdit(customer, form)
    setIsSavingCustomerEdit(false)
    if (!r.ok) { toast.error(r.message); return }
    toast.success('사업장 정보가 수정되었습니다')
    setIsEditCustomerModalOpen(false)
    await fetchDetail()
  }
  /**
   * 사업장 삭제 — **숨기기다**(deleted_at). 2026-11-23 에 바뀌었다.
   *
   * 전에는 견적이 없으면 진짜 DELETE 였다. service_engineers → service_history →
   * contacts → devices → customers 를 차례로 지우다 중간에 실패하면 「일부만 지워졌을 수
   * 있습니다」로 끝났고, 그 사슬에 sales_activities 가 없어서 영업활동이 한 건이라도 있으면
   * **마지막 DELETE 가 FK 에 막혔다**(지워지지 않는 사업장이 생겼다).
   *
   * 이제 라우트가 한 문장으로 숨긴다 — 중간이 없고, 되돌릴 수 있고, 까닭이 남는다.
   * 창(DeleteCustomerModal)이 연결 기록 수를 보여 주고 까닭을 받는다.
   */
  const openDeleteCustomer = () => {
    if (!customer) return
    setDeleteCounts(null)   // 지난 번 센 값이 잠깐 보이지 않게 — 열 때 비운다
    setDeleteOpen(true)
  }

  // 창이 뜨면 연결 기록을 센다.
  useEffect(() => {
    // 창이 닫혀 있으면 아무것도 하지 않는다 — 효과에서 바로 상태를 바꾸지 않으려고
    // 「닫으면 비우기」는 닫는 쪽(setDeleteOpen(false) 을 부르는 자리)이 아니라 여는 쪽에서 한다.
    if (!deleteOpen || !customer) return
    let cancelled = false
    void (async () => {
      const r = await customerDelete({ action: 'counts', target: 'site', id: customer.customer_id })
      if (!cancelled) setDeleteCounts(r.ok ? (r.data.counts as DeleteCounts) : EMPTY_COUNTS)
    })()
    return () => { cancelled = true }
  }, [deleteOpen, customer])

  const confirmDeleteCustomer = async (reason: string) => {
    if (!customer) return
    setIsDeletingCustomer(true)
    const r = await customerDelete({
      action: 'delete', target: 'site', id: customer.customer_id, reason,
      counts: deleteCounts ?? undefined,
    })
    setIsDeletingCustomer(false)
    if (!r.ok) { toast.error(r.error); return }
    setDeleteOpen(false)
    setIsEditCustomerModalOpen(false)
    toast.success('사업장을 숨겼습니다')
    router.push('/')
  }

  return {
    isEditCustomerModalOpen, setIsEditCustomerModalOpen,
    isSavingCustomerEdit, isDeletingCustomer,
    handleUpdateCustomer,
    // 삭제 — 창을 열고(openDeleteCustomer), 창이 까닭과 함께 부른다(confirmDeleteCustomer).
    deleteOpen, setDeleteOpen, deleteCounts, openDeleteCustomer, confirmDeleteCustomer,
  }
}
