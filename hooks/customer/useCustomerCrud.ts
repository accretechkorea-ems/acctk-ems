'use client'

// 업체 정보 수정 · 삭제. 수정 모달의 열림 상태도 여기서 들고 있다
// (삭제가 끝나면 모달을 닫고 목록으로 보내야 하므로 핸들러와 같은 곳에 둔다).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { geocodeAddress } from '@/lib/geocode'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import type { Customer, CustomerEditFormData } from '@/components/customer/types'

type Args = {
  customer: Customer | null
  fetchDetail: () => Promise<boolean>
}

export function useCustomerCrud({ customer, fetchDetail }: Args) {
  const supabase = createClient()
  const router = useRouter()
  const toast = useToast()
  const confirmDialog = useConfirm()

  const [isEditCustomerModalOpen, setIsEditCustomerModalOpen] = useState(false)
  const [isSavingCustomerEdit, setIsSavingCustomerEdit] = useState(false)
  const [isDeletingCustomer, setIsDeletingCustomer] = useState(false)

  const handleUpdateCustomer = async (form: CustomerEditFormData) => {
    if (!customer) return
    // 사용자 검증(업체명/주소)은 CustomerEditModal 에서 인라인으로 처리한다.
    setIsSavingCustomerEdit(true)
    try {
      const coords = await geocodeAddress(form.address.trim())
      const { error } = await supabase.from('customers').update({
        company_name: form.company_name.trim(), address: form.address.trim(),
        agency: form.agency.trim() || null, status: form.status,
        latitude: coords.latitude, longitude: coords.longitude,
      }).eq('customer_id', customer.customer_id)
      setIsSavingCustomerEdit(false)
      if (error) { toast.error(error.message || '업체 정보 수정 중 오류가 발생했습니다'); return }
      toast.success('업체 정보가 수정되었습니다')
      setIsEditCustomerModalOpen(false)
      await fetchDetail()
    } catch (error: any) {
      setIsSavingCustomerEdit(false)
      toast.error(error?.message || '업체 정보 수정 중 오류가 발생했습니다')
    }
  }

  // 업체 삭제 — 견적 이력 유무로 갈린다.
  //   견적 있음 → 매출 기록이므로 숨김(deleted_at)만. 물리 삭제하지 않는다.
  //   견적 없음 → 자식까지 실제 DELETE.
  // 삭제 순서는 FK 의존 관계를 따른다(전부 NO ACTION 이라 DB 가 순서를 강제한다):
  //   service_engineers → service_history → contacts · devices → customers
  //   service_history 가 contacts·devices 를 참조하므로 그 둘보다 반드시 먼저 지워야 한다.
  const handleDeleteCustomer = async () => {
    if (!customer) return
    const cid = customer.customer_id
    setIsDeletingCustomer(true)
    try {
      // 1) 연결 건수 조회 — 이 결과로 확인 창과 동작이 갈린다.
      const [quoteRes, dealerRes, contactRes, deviceRes, historyRes] = await Promise.all([
        supabase.from('quotes').select('quote_id', { count: 'exact', head: true }).eq('customer_id', cid),
        supabase.from('quotes').select('quote_id', { count: 'exact', head: true }).eq('dealer_id', cid),
        supabase.from('contacts').select('contact_id', { count: 'exact', head: true }).eq('customer_id', cid),
        supabase.from('devices').select('device_id', { count: 'exact', head: true }).eq('customer_id', cid),
        supabase.from('service_history').select('service_id', { count: 'exact', head: true }).eq('customer_id', cid),
      ])
      const countErr = [quoteRes, dealerRes, contactRes, deviceRes, historyRes].find(r => r.error)?.error
      if (countErr) {
        console.error('[customer] delete precheck failed', countErr)
        toast.error(`연결된 데이터를 확인하지 못했습니다 (${countErr.code || countErr.message})`)
        return
      }
      const quoteCount = (quoteRes.count ?? 0) + (dealerRes.count ?? 0)
      const contactCount = contactRes.count ?? 0
      const deviceCount = deviceRes.count ?? 0
      const historyCount = historyRes.count ?? 0

      // ── 견적이 있으면 숨김만 ──
      if (quoteCount > 0) {
        const ok = await confirmDialog({
          title: '업체 숨김',
          message: `견적 ${quoteCount}건이 연결되어 있어 기록은 보존되며 목록에서만 숨겨집니다.\n계속하시겠습니까?`,
          confirmText: '숨기기', variant: 'danger',
        })
        if (!ok) return
        const { error } = await supabase.from('customers')
          .update({ deleted_at: new Date().toISOString() }).eq('customer_id', cid)
        if (error) {
          console.error('[customer] soft delete failed', error)
          toast.error(error.message || '업체 숨김 처리 중 오류가 발생했습니다')
          return
        }
        toast.success('업체가 목록에서 숨겨졌습니다')
        setIsEditCustomerModalOpen(false)
        router.push('/')
        return
      }

      // ── 견적이 없으면 완전 삭제 ──
      const ok = await confirmDialog({
        title: '업체 완전 삭제',
        message: `담당자 ${contactCount}명, 장비 ${deviceCount}대, 서비스 기록 ${historyCount}건이 함께 삭제되며 되돌릴 수 없습니다.\n계속하시겠습니까?`,
        confirmText: '완전 삭제', variant: 'danger',
      })
      if (!ok) return

      // 중간에 실패하면 그 지점에서 멈춘다. 어디까지 지워졌는지 알려주고 화면을 다시 읽는다.
      const abort = async (step: string, message: string) => {
        toast.error(`${step} 삭제에 실패해 중단했습니다. 일부만 지워졌을 수 있습니다 (${message})`)
        await fetchDetail()
      }

      const { data: svc, error: svcErr } = await supabase
        .from('service_history').select('service_id').eq('customer_id', cid)
      if (svcErr) {
        console.error('[customer] service_history lookup failed', svcErr)
        toast.error(`서비스 기록을 조회하지 못했습니다 (${svcErr.code || svcErr.message})`)
        return
      }
      const serviceIds = (svc ?? []).map(s => s.service_id)

      if (serviceIds.length > 0) {
        const { error: e1 } = await supabase.from('service_engineers').delete().in('service_id', serviceIds)
        if (e1) { console.error('[customer] delete service_engineers failed', e1); await abort('서비스 담당자', e1.message); return }
      }

      const { error: e2 } = await supabase.from('service_history').delete().eq('customer_id', cid)
      if (e2) { console.error('[customer] delete service_history failed', e2); await abort('서비스 기록', e2.message); return }

      const { error: e3 } = await supabase.from('contacts').delete().eq('customer_id', cid)
      if (e3) { console.error('[customer] delete contacts failed', e3); await abort('담당자', e3.message); return }

      const { error: e4 } = await supabase.from('devices').delete().eq('customer_id', cid)
      if (e4) { console.error('[customer] delete devices failed', e4); await abort('장비', e4.message); return }

      const { error: e5 } = await supabase.from('customers').delete().eq('customer_id', cid)
      if (e5) { console.error('[customer] delete customer failed', e5); await abort('업체', e5.message); return }

      toast.success('업체가 완전히 삭제되었습니다')
      setIsEditCustomerModalOpen(false)
      router.push('/')
    } finally {
      setIsDeletingCustomer(false)
    }
  }

  return {
    isEditCustomerModalOpen, setIsEditCustomerModalOpen,
    isSavingCustomerEdit, isDeletingCustomer,
    handleUpdateCustomer, handleDeleteCustomer,
  }
}
