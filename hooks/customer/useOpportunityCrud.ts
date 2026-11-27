'use client'

// 영업기회 CRUD. 모달 열림 상태와 선택된 기회도 이 훅이 소유한다
// (useSalesActivityCrud 와 같은 방식).
//
// RLS 가 로그인 사용자 전원 허용이라 담당자 판정은 여기서 한다.
// 담당 영업 본인 또는 superadmin 만 수정·삭제.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logCustomerEvent } from '@/lib/customerEventLog'
import { recordStageChange } from '@/lib/opportunityStageHistory'
import { krwShort } from '@/lib/forecastBoard'
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

  /**
   * **단계 이력 한 줄** (2026-11-28, 야간4 4-1·4-2).
   *
   * 두 군데에 남는다. 쓰는 곳이 둘인 까닭이 다르다:
   *   ① opportunity_stage_history — **자국**이다. 이력 요약(「상담 9/4 → 협상 10/15」)이
   *      이것을 읽는다. 표가 아직 없으면 사건으로 떨어진다(42P01 폴백).
   *   ② customer_events(forecast_stage_changed) — **활동 이력에 보일 한 줄**이다.
   *      옮긴 때만 적는다(만든 때는 forecast_created 가 이미 적는다).
   *
   * 저장이 끝난 **뒤에** 부른다 — 이력을 적지 못해도 단계 이동은 그대로 끝난 일이다.
   */
  const logStage = (
    o: { opportunity_id: number; customer_id: number; title?: string | null },
    from: string | null,
    to: string,
  ) => {
    void recordStageChange(supabase, {
      opportunityId: o.opportunity_id,
      fromStage: from,
      toStage: to,
      changedBy: engineerId,
      customerId: o.customer_id,
      logEvent: row => { void logCustomerEvent(row) },
    })
    // 만든 때(from 이 없다)는 적지 않는다 — forecast_created 와 두 줄이 되기 때문이다.
    if (from == null || from === to) return
    void logCustomerEvent({
      customerId: o.customer_id,
      type: 'forecast_stage_changed',
      payload: { opportunity_id: o.opportunity_id, title: o.title ?? null, from_stage: from, to_stage: to },
    })
  }

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
    // 새로 만든 줄의 id 가 필요하다(첫 단계 이력을 그 id 로 적는다).
    const { data: saved, error } = editingOpp
      ? await supabase.from('sales_opportunities')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('opportunity_id', editingOpp.opportunity_id)
          .select('opportunity_id, customer_id').maybeSingle()
      : await supabase.from('sales_opportunities')
          .insert({ ...payload, customer_id: resolveCustomerId(form) })
          .select('opportunity_id, customer_id').maybeSingle()
    setIsSavingOpp(false)

    if (error) {
      console.error('[customer] save sales_opportunity failed', error)
      toast.error(error.message || '포캐스트 저장 중 오류가 발생했습니다')
      return
    }
    const wasEditing = !!editingOpp
    // 단계 이력 — 만든 때는 **첫 줄**, 고친 때는 단계가 **바뀐 때만**.
    // 금액·제목 같은 잡 변경은 담지 않는다(4-1 의 규칙).
    if (saved?.opportunity_id != null) {
      const row = { opportunity_id: Number(saved.opportunity_id), customer_id: Number(saved.customer_id), title: payload.title }
      if (!wasEditing) logStage(row, null, payload.stage)
      else if (editingOpp && editingOpp.stage !== payload.stage) logStage(row, editingOpp.stage, payload.stage)
    }
    // 고객 이력에 한 줄 (2026-11-27 야간3 2-2) — **새로 만든 때만**이다.
    // 「진행(단계 고침)」은 적지 않는다: 단계는 자주 오르내려 이력이 그 줄로 덮인다.
    if (!wasEditing) {
      void logCustomerEvent({
        customerId: resolveCustomerId(form),
        type: 'forecast_created',
        payload: {
          title: payload.title,
          amount_text: payload.expected_amount ? krwShort(payload.expected_amount) : null,
          stage: payload.stage,
        },
      })
    }
    closeOppModal()
    // 목록 갱신이 실패하면 fetchDetail 쪽에서 알리므로 성공 안내는 띄우지 않는다.
    if (await fetchDetail()) toast.success(wasEditing ? '포캐스트가 수정되었습니다' : '포캐스트가 등록되었습니다')
  }

  const handleDeleteOpp = async () => {
    if (!editingOpp) return
    if (!canEditOpp(editingOpp)) { toast.error('담당자 본인만 삭제할 수 있습니다'); return }
    const ok = await confirmDialog({
      title: '포캐스트 삭제',
      message: `'${editingOpp.title}'${josa(editingOpp.title, '을')} 삭제하시겠습니까?\n연결된 활동 기록은 남고 포캐스트 연결만 풀립니다.`,
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
      toast.error(error.message || '포캐스트 삭제 중 오류가 발생했습니다')
      return
    }
    closeOppModal()
    if (await fetchDetail()) toast.success('포캐스트가 삭제되었습니다')
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
    logStage(o, o.stage, next)
    if (await fetchDetail()) toast.success(`'${o.title}'${josa(o.title, '을')} ${next}${josa(next, '으로')} 옮겼습니다`)
    return true
  }

  /**
   * 실주·종료를 **사유와 함께** 적는다 (2026-11-26, 지시 L2).
   *
   * 전에는 단계를 「실주」로 바꾸면 영업기회 수정 창이 통째로 열려, 사유를 적으려고 제목·금액·
   * 마감까지 다시 보게 됐다. 지금은 사유 창 하나가 이 길로 들어온다
   * (components/forecast/LostModal.tsx).
   *
   * ── 칸이 아직 없을 때 ────────────────────────────────────────────────────
   *   lost_reason_id · competitor · lost_at 은 db/lost_reasons_20261126.sql 이 더한다.
   *   없으면(42703) 그 셋을 빼고 **다시 쓴다** — 사유 글자와 메모는 옛 칸에 들어가므로
   *   적용 전에도 실주 처리가 끝까지 된다.
   *
   * close 를 주면 stage 는 그대로 두고 closed_at 만 찍는다(칸반의 「종료」).
   */
  const markLost = async (
    o: SalesOpportunity,
    patch: { lost_reason: string; lost_reason_id: number | null; lost_note: string | null; competitor: string | null; lost_at: string },
    opts: { stage?: string; closeOnly?: boolean } = {},
  ): Promise<boolean> => {
    if (!canEditOpp(o)) { toast.error('담당자 본인만 바꿀 수 있습니다'); return false }
    const now = new Date().toISOString()
    const base: Record<string, unknown> = {
      lost_reason: patch.lost_reason,
      lost_note: patch.lost_note,
      closed_at: o.closed_at ?? now,
      updated_at: now,
    }
    if (!opts.closeOnly && opts.stage) base.stage = opts.stage
    const full = { ...base, lost_reason_id: patch.lost_reason_id, competitor: patch.competitor, lost_at: patch.lost_at }

    let { error } = await supabase.from('sales_opportunities').update(full).eq('opportunity_id', o.opportunity_id)
    // 칸이 아직 없으면 셋을 빼고 다시 — 반쪽으로 끝내지 않는다.
    if (error && (error.code === '42703' || error.code === 'PGRST204')) {
      console.warn('[opportunity] 실주 사유 칸이 아직 없다 — 글자만 적는다', error.code)
      ;({ error } = await supabase.from('sales_opportunities').update(base).eq('opportunity_id', o.opportunity_id))
    }
    // 옛 **글자** 칸에 값 목록을 못 박은 CHECK 가 남아 있으면 23514 로 막힌다 —
    // 새 사유 이름이 그 목록에 없기 때문이다(2026-11-26 실측에서 실주가 **전부** 막혀 있었다).
    // 그때는 글자 칸을 빼고 **id 로만** 적는다 — 사유를 잃는 것보다 낫다. 제약을 떼면
    // (db/lost_reason_drop_check_20261126.sql) 첫 시도에서 글자까지 함께 들어간다.
    if (error && error.code === '23514') {
      console.warn('[opportunity] 옛 lost_reason CHECK 가 막는다 — 글자 칸을 빼고 id 로만 적는다', error.code)
      const noText = { ...full }
      delete (noText as Record<string, unknown>).lost_reason
      ;({ error } = await supabase.from('sales_opportunities').update(noText).eq('opportunity_id', o.opportunity_id))
    }
    if (error) {
      console.error('[opportunity] mark lost failed', error)
      toast.error(error.message || '실주 처리 중 오류가 발생했습니다')
      return false
    }
    // 단계 이력 — 실주로 **옮긴** 때만이다. closeOnly(종료만 찍기)는 단계가 그대로다.
    if (!opts.closeOnly && opts.stage && opts.stage !== o.stage) logStage(o, o.stage, opts.stage)
    // 고객 이력에 한 줄 (2026-11-27 야간3 2-2).
    void logCustomerEvent({
      customerId: o.customer_id,
      type: 'forecast_closed', occurredAt: patch.lost_at || undefined,
      payload: {
        title: o.title,
        result: opts.closeOnly ? '종료' : (opts.stage ?? '실주'),
        reason: patch.lost_reason || null,
        competitor: patch.competitor || null,
        amount_text: o.expected_amount ? krwShort(o.expected_amount) : null,
      },
    })
    if (await fetchDetail()) {
      toast.success(opts.closeOnly
        ? `'${o.title}'${josa(o.title, '을')} 종료했습니다`
        : `'${o.title}'${josa(o.title, '을')} 실주로 처리했습니다`)
    }
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
    // 고객 이력에 한 줄 — **종료할 때만**이다(종료 해제는 적지 않는다).
    if (close) {
      void logCustomerEvent({
        customerId: o.customer_id,
        type: 'forecast_closed',
        payload: { title: o.title, result: '종료', amount_text: o.expected_amount ? krwShort(o.expected_amount) : null },
      })
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
    canEditOpp, changeStage, setClosed, markLost,
    openNewOpp, openEditOpp, closeOppModal,
    handleSaveOpp, handleDeleteOpp,
  }
}
