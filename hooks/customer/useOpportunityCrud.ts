'use client'

// 영업기회 CRUD. 모달 열림 상태와 선택된 기회도 이 훅이 소유한다
// (useSalesActivityCrud 와 같은 방식).
//
// RLS 가 로그인 사용자 전원 허용이라 담당자 판정은 여기서 한다.
// 담당 영업 본인 또는 superadmin 만 수정·삭제.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { josa } from '@/lib/josa'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { isSuperAdmin } from '@/lib/permissions'
import { isClosedStage, monthToDate } from '@/components/customer/opportunity'
import type { OpportunityForm, SalesOpportunity } from '@/components/customer/types'

// customerId 가 null 이면 신규 등록은 못 하고 기존 기회 수정만 된다 (파이프라인 화면에서 그렇게 쓴다).
type Args = {
  customerId: number | null
  engineerId: number | null
  role: string | null
  fetchDetail: () => Promise<boolean>
}

export function useOpportunityCrud({ customerId, engineerId, role, fetchDetail }: Args) {
  const supabase = createClient()
  const toast = useToast()
  const confirmDialog = useConfirm()

  const [isOppModalOpen, setIsOppModalOpen] = useState(false)
  const [editingOpp, setEditingOpp] = useState<SalesOpportunity | null>(null)
  const [isSavingOpp, setIsSavingOpp] = useState(false)

  const superAdmin = isSuperAdmin({ permission_level: role })
  // 담당 영업 본인이거나 superadmin 이면 수정·삭제 가능
  const canEditOpp = (o: SalesOpportunity) =>
    superAdmin || (engineerId !== null && o.engineer_id === engineerId)

  const openNewOpp = () => { setEditingOpp(null); setIsOppModalOpen(true) }
  const openEditOpp = (o: SalesOpportunity) => { setEditingOpp(o); setIsOppModalOpen(true) }
  const closeOppModal = () => { setIsOppModalOpen(false); setEditingOpp(null) }

  // 어느 업체 건인지 — 업체 상세에서 열었으면 그 업체로 고정, 파이프라인에서 열었으면 폼에서 고른 값
  const resolveCustomerId = (form: OpportunityForm) => customerId ?? form.customer_id

  const handleSaveOpp = async (form: OpportunityForm) => {
    if (!engineerId) { toast.error('사용자 정보를 불러오는 중입니다'); return }
    if (!editingOpp && resolveCustomerId(form) === null) { toast.error('업체를 선택해주세요'); return }
    if (editingOpp && !canEditOpp(editingOpp)) { toast.error('담당자 본인만 수정할 수 있습니다'); return }

    const closed = isClosedStage(form.stage)
    const amount = form.expected_amount.replace(/[^\d]/g, '')
    // 진행 단계로 되돌리면 closed_at 을 지우고, 실주가 아니면 실주 사유도 비운다.
    const payload = {
      title: form.title.trim(),
      stage: form.stage,
      expected_amount: amount ? Number(amount) : null,
      expected_close: monthToDate(form.expected_close),
      engineer_id: form.engineer_id ?? engineerId,
      lost_reason: form.stage === '실주' ? (form.lost_reason || null) : null,
      lost_note: form.stage === '실주' ? (form.lost_note.trim() || null) : null,
      // 실주면 종료 시점을 남긴다. 실주가 아니면 기존 closed_at 을 그대로 둔다
      // (매출완료로 자동 종료된 건이 제목만 고쳐도 다시 열리면 곤란하므로).
      closed_at: closed ? (editingOpp?.closed_at ?? new Date().toISOString()) : (editingOpp?.closed_at ?? null),
    }

    setIsSavingOpp(true)
    const { error } = editingOpp
      ? await supabase.from('sales_opportunities')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('opportunity_id', editingOpp.opportunity_id)
      : await supabase.from('sales_opportunities').insert({ ...payload, customer_id: resolveCustomerId(form) })
    setIsSavingOpp(false)

    if (error) {
      console.error('[customer] save sales_opportunity failed', error)
      toast.error(error.message || '영업기회 저장 중 오류가 발생했습니다')
      return
    }
    const wasEditing = !!editingOpp
    closeOppModal()
    // 목록 갱신이 실패하면 fetchDetail 쪽에서 알리므로 성공 안내는 띄우지 않는다.
    if (await fetchDetail()) toast.success(wasEditing ? '영업기회가 수정되었습니다' : '영업기회가 등록되었습니다')
  }

  const handleDeleteOpp = async () => {
    if (!editingOpp) return
    if (!canEditOpp(editingOpp)) { toast.error('담당자 본인만 삭제할 수 있습니다'); return }
    const ok = await confirmDialog({
      title: '영업기회 삭제',
      message: `'${editingOpp.title}'${josa(editingOpp.title, '을')} 삭제하시겠습니까?\n연결된 활동 기록은 남고 기회 연결만 풀립니다.`,
      confirmText: '삭제', variant: 'danger',
    })
    if (!ok) return

    setIsSavingOpp(true)
    // 활동은 지우지 않고 연결만 끊는다 (기록 자체는 보존)
    const { error: unlinkErr } = await supabase.from('sales_activities')
      .update({ opportunity_id: null }).eq('opportunity_id', editingOpp.opportunity_id)
    if (unlinkErr) {
      setIsSavingOpp(false)
      console.error('[customer] unlink sales_activities failed', unlinkErr)
      toast.error(unlinkErr.message || '활동 연결을 푸는 중 오류가 발생했습니다')
      return
    }
    const { error } = await supabase.from('sales_opportunities').delete().eq('opportunity_id', editingOpp.opportunity_id)
    setIsSavingOpp(false)
    if (error) {
      console.error('[customer] delete sales_opportunity failed', error)
      toast.error(error.message || '영업기회 삭제 중 오류가 발생했습니다')
      return
    }
    closeOppModal()
    if (await fetchDetail()) toast.success('영업기회가 삭제되었습니다')
  }

  // 단계만 바꾸는 경로. 업체 상세(요약 패널)와 파이프라인(카드)이 같이 쓴다.
  // 실주는 사유가 필요해 여기로 오지 않고 모달을 거친다.
  // 반환값 = 저장 성공 여부. 파이프라인의 낙관적 업데이트가 되돌릴지 판단하는 데 쓴다.
  const changeStage = async (o: SalesOpportunity, next: string): Promise<boolean> => {
    if (!canEditOpp(o)) { toast.error('담당자 본인만 단계를 바꿀 수 있습니다'); return false }
    if (next === o.stage) return false
    // 실주로 가면 종료 시점을 남기고, 그 외 단계로 옮기면 종료를 푼다(수주는 여전히 진행 중).
    const closed = isClosedStage(next)
    const { error } = await supabase.from('sales_opportunities').update({
      stage: next,
      closed_at: closed ? (o.closed_at ?? new Date().toISOString()) : null,
      lost_reason: null,
      lost_note: null,
      updated_at: new Date().toISOString(),
    }).eq('opportunity_id', o.opportunity_id)
    if (error) {
      console.error('[opportunity] change stage failed', error)
      toast.error(error.message || '단계 변경 중 오류가 발생했습니다')
      return false
    }
    if (await fetchDetail()) toast.success(`'${o.title}'${josa(o.title, '을')} ${next}${josa(next, '으로')} 옮겼습니다`)
    return true
  }

  // 수동 종료 / 종료 해제. 종료 여부는 stage 가 아니라 closed_at 하나로 표현한다.
  const setClosed = async (o: SalesOpportunity, close: boolean) => {
    if (!canEditOpp(o)) { toast.error('담당자 본인만 바꿀 수 있습니다'); return false }
    const { error } = await supabase.from('sales_opportunities').update({
      closed_at: close ? (o.closed_at ?? new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    }).eq('opportunity_id', o.opportunity_id)
    if (error) {
      console.error('[opportunity] set closed failed', error)
      toast.error(error.message || (close ? '종료 처리 중 오류가 발생했습니다' : '종료 해제 중 오류가 발생했습니다'))
      return false
    }
    if (await fetchDetail()) {
      toast.success(close
        ? `'${o.title}'${josa(o.title, '을')} 종료했습니다`
        : `'${o.title}'${josa(o.title, '을')} 다시 진행 중으로 되돌렸습니다`)
    }
    return true
  }

  return {
    isOppModalOpen, editingOpp, isSavingOpp,
    canEditOpp, changeStage, setClosed,
    openNewOpp, openEditOpp, closeOppModal,
    handleSaveOpp, handleDeleteOpp,
  }
}
