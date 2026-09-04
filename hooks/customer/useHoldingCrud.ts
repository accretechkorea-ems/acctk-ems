'use client'

// 장비 홀딩(미해결 이슈) CRUD. 모달 열림 상태와 선택된 홀딩도 이 훅이 소유한다
// (useSalesActivityCrud / useOpportunityCrud 와 같은 방식).
//
// 등록·해제 권한은 따로 두지 않는다(현장에서 다른 사람이 해결하는 일이 흔하다).
// created_by 는 누가 걸었는지 남기는 용도일 뿐이다.
// 다만 삭제는 이력을 없애는 유일한 동작이라 등록자 본인·superadmin 으로 제한한다.
// 한 장비에 진행 중 홀딩은 1건으로 제한한다 — 이미 있으면 등록을 막고 기존 건을 열어준다.
//
// 열려 있는 홀딩은 id 만 들고 있다가 매 렌더에서 목록에서 찾아 쓴다(스냅샷을 복사하지 않는다).
// 예전처럼 객체를 state 에 복사해 두면 메모를 고쳐도 목록만 갱신되고 모달은 옛 내용을 그렸다.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { josa } from '@/lib/josa'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { isSuperAdmin } from '@/lib/permissions'
import type { HoldingReport } from '@/components/customer/holding'
import type { Holding, HoldingForm, HoldingNote } from '@/components/customer/types'

// 레포트 파일 경로 — 과거 데이터에 전체 URL 이 들어 있어 버킷 안 경로만 잘라 쓴다.
// (useServiceCrud 의 toReportPath 와 같은 규칙)
const toReportPath = (stored: string): string => {
  const marker = '/service-report/'
  const idx = stored.indexOf(marker)
  return idx >= 0 ? stored.slice(idx + marker.length) : stored
}

// 조회 응답 모양(필요한 필드만)
type ServiceRow = {
  service_id: number; visit_date: string | null; service_type: string | null
  service_notes: string | null; report_url: string | null
  service_engineers: { engineers: { name: string | null } | null }[] | null
}

// customerId 가 null 이면 신규 등록은 못 하고 조회·메모·해제만 된다 (홀딩 현황 화면에서 그렇게 쓴다).
type Args = {
  customerId: number | null
  // 화면이 들고 있는 홀딩 목록. 열려 있는 홀딩의 최신 내용을 여기서 찾는다.
  holdings: Holding[]
  engineerId: number | null
  fetchDetail: () => Promise<boolean>
  // 장비별 진행 중 홀딩 — 중복 등록을 막는 데 쓴다 (목록 화면에서는 등록을 안 하므로 생략 가능)
  activeHoldingByDevice?: Map<number, Holding>
  // 메모 수정·삭제 판정용. superadmin 은 남의 메모도 고칠 수 있다.
  role?: string | null
}

export function useHoldingCrud({ customerId, holdings, engineerId, fetchDetail, activeHoldingByDevice, role }: Args) {
  const activeByDevice = activeHoldingByDevice ?? new Map<number, Holding>()
  const supabase = createClient()
  const toast = useToast()
  const confirmDialog = useConfirm()
  const superAdmin = isSuperAdmin({ permission_level: role })

  const [modalOpen, setModalOpen] = useState(false)
  // 상세에서 함께 보여줄 서비스 레포트 — 열 때만 읽는다(목록 조회에는 필요 없다)
  const [holdingReports, setHoldingReports] = useState<HoldingReport[]>([])
  const [reportsLoading, setReportsLoading] = useState(false)
  // 보고 있는 홀딩은 id 로만 기억한다 (null = 신규 등록)
  const [viewingId, setViewingId] = useState<number | null>(null)
  const [newHoldingTarget, setNewHoldingTarget] = useState<{ deviceId: number; serviceId: number | null } | null>(null)
  const [isSavingHolding, setIsSavingHolding] = useState(false)
  // 해제 모달 — 상세에서 누른 경우와 레포트 저장 후 물어보는 경우가 같이 쓴다
  const [resolveTarget, setResolveTarget] = useState<Holding | null>(null)
  const [resolveNotice, setResolveNotice] = useState<string | null>(null)

  // 목록에서 매번 찾으므로 메모를 고치거나 지워도 다음 렌더에 바로 반영된다.
  // 목록에서 사라졌으면(삭제됨) null 이 되고, 아래 isHoldingModalOpen 이 false 가 되어 모달이 닫힌다.
  const viewingHolding = viewingId === null ? null : holdings.find(h => h.holding_id === viewingId) ?? null
  const isHoldingModalOpen = modalOpen && (newHoldingTarget !== null || viewingHolding !== null)

  const closeHoldingModal = () => {
    setModalOpen(false)
    setViewingId(null)
    setNewHoldingTarget(null)
  }

  const openResolve = (h: Holding, notice: string | null = null) => {
    setResolveTarget(h)
    setResolveNotice(notice)
  }
  const closeResolve = () => { setResolveTarget(null); setResolveNotice(null) }

  /**
   * 홀딩 기간에 그 장비를 방문한 서비스 레포트를 끌어온다.
   * 범위: device_id 가 같고 visit_date 가 [started_at, resolved_at] 안.
   *   - 진행 중이면 위쪽 경계 없이 오늘까지 계속 붙는다.
   *   - 날짜가 없는(visit_date null) 기록은 어느 홀딩에 속하는지 알 수 없어 제외된다.
   * 홀딩당 몇 건 수준이라 모달을 열 때만 읽는다.
   */
  const loadReports = async (h: Holding) => {
    setHoldingReports([])
    setReportsLoading(true)
    let q = supabase
      .from('service_history')
      .select('service_id, visit_date, service_type, service_notes, report_url, service_engineers(engineers(name))')
      .eq('device_id', h.device_id)
      .gte('visit_date', h.started_at)
      .order('visit_date', { ascending: true })
    if (h.resolved_at) q = q.lte('visit_date', h.resolved_at)
    const { data, error } = await q
    setReportsLoading(false)
    if (error) {
      console.error('[holding] load reports failed', error)
      return
    }
    setHoldingReports(((data ?? []) as unknown as ServiceRow[]).map(r => ({
      service_id: r.service_id,
      visit_date: r.visit_date,
      service_type: r.service_type,
      service_notes: r.service_notes,
      report_url: r.report_url,
      engineerNames: (r.service_engineers ?? []).map(se => se.engineers?.name ?? '').filter(Boolean).join(', '),
    })))
  }

  const openHolding = (h: Holding) => {
    setViewingId(h.holding_id)
    setNewHoldingTarget(null)
    setModalOpen(true)
    loadReports(h)
  }

  // 레포트 PDF 열기 — 비공개 버킷이라 서명 URL 을 받아 새 탭에 띄운다.
  const handleOpenReport = async (report: HoldingReport) => {
    if (!report.report_url) return
    const win = window.open('', '_blank')
    try {
      const path = toReportPath(report.report_url)
      const { data, error } = await supabase.storage.from('service-report').createSignedUrl(path, 3600)
      if (error || !data?.signedUrl) throw error || new Error('레포트를 열 수 없습니다.')
      if (win) { win.opener = null; win.location.href = data.signedUrl }
      else window.open(data.signedUrl, '_blank')
    } catch (e) {
      if (win) win.close()
      console.error('[holding] open report failed', e)
      toast.error('레포트를 여는 중 오류가 발생했습니다')
    }
  }

  // 장비 카드에서 등록. 진행 중인 건이 있으면 그 상세를 대신 연다.
  const openNewHolding = (deviceId: number, serviceId: number | null = null) => {
    const existing = activeByDevice.get(deviceId)
    if (existing) {
      toast.error('이 장비에 진행 중인 홀딩이 있습니다')
      openHolding(existing)
      return
    }
    setViewingId(null)
    setNewHoldingTarget({ deviceId, serviceId })
    setModalOpen(true)
  }

  const handleCreateHolding = async (form: HoldingForm) => {
    if (!newHoldingTarget || customerId === null) return
    if (!engineerId) { toast.error('사용자 정보를 불러오는 중입니다'); return }
    // 모달을 띄운 사이에 다른 사람이 걸었을 수도 있어 저장 직전에 다시 본다
    if (activeByDevice.has(newHoldingTarget.deviceId)) {
      toast.error('이 장비에 진행 중인 홀딩이 있습니다')
      return
    }

    setIsSavingHolding(true)
    const { data: inserted, error } = await supabase.from('holdings').insert({
      customer_id: customerId,
      device_id: newHoldingTarget.deviceId,
      service_id: newHoldingTarget.serviceId,
      title: form.title.trim(),
      started_at: form.started_at,
      created_by: engineerId,
    }).select('holding_id').single()

    if (error || !inserted) {
      setIsSavingHolding(false)
      console.error('[customer] create holding failed', error)
      toast.error(error?.message || '홀딩 등록 중 오류가 발생했습니다')
      return
    }

    // 최초 메모는 선택 사항. 실패해도 홀딩 자체는 남으므로 안내만 하고 넘어간다.
    if (form.first_note.trim()) {
      const { error: noteErr } = await supabase.from('holding_notes').insert({
        holding_id: inserted.holding_id,
        engineer_id: engineerId,
        content: form.first_note.trim(),
      })
      if (noteErr) {
        console.error('[customer] create holding note failed', noteErr)
        toast.error('홀딩은 등록됐지만 메모 저장에 실패했습니다')
      }
    }
    setIsSavingHolding(false)
    closeHoldingModal()
    if (await fetchDetail()) toast.success('홀딩이 등록되었습니다')
  }

  // 제목·시작일을 한 번에 저장한다(저장 버튼을 둘로 나누지 않기 위해).
  const handleUpdateHolding = async (h: Holding, title: string, startedAt: string) => {
    if (!title.trim()) { toast.error('제목을 입력해주세요'); return }
    if (!startedAt) { toast.error('시작일을 입력해주세요'); return }
    // 해제된 홀딩은 시작일이 해제일을 넘어설 수 없다(경과일수가 음수가 된다).
    if (h.resolved_at && startedAt > h.resolved_at) {
      toast.error(`시작일은 해제일(${h.resolved_at}) 이전이어야 합니다`)
      return
    }
    setIsSavingHolding(true)
    const { error } = await supabase.from('holdings')
      .update({ title: title.trim(), started_at: startedAt, updated_at: new Date().toISOString() })
      .eq('holding_id', h.holding_id)
    setIsSavingHolding(false)
    if (error) {
      console.error('[customer] update holding failed', error)
      toast.error(error.message || '수정 중 오류가 발생했습니다')
      return
    }
    // 시작일이 바뀌면 끌어오는 레포트 범위도 달라지므로 다시 읽는다.
    if (startedAt !== h.started_at) await loadReports({ ...h, started_at: startedAt })
    if (await fetchDetail()) toast.success('수정되었습니다')
  }

  // 삭제는 이력을 없애므로 등록자 본인 또는 superadmin 만.
  const canDeleteHolding = (h: Holding) =>
    superAdmin || (engineerId !== null && h.created_by === engineerId)

  /**
   * 홀딩 삭제 — 메모를 먼저 지우고 홀딩을 지운다(FK 가 NO ACTION 이라 순서가 강제된다).
   * 메모만 지워지고 홀딩이 남는 반쪽 상태를 만들지 않도록 단계마다 error 를 확인한다.
   */
  const handleDeleteHolding = async (h: Holding) => {
    if (!canDeleteHolding(h)) { toast.error('등록한 사람만 삭제할 수 있습니다'); return }
    const ok = await confirmDialog({
      title: '홀딩 삭제',
      message: `'${h.title}'${josa(h.title, '을')} 삭제하시겠습니까?\n메모를 포함한 기록이 완전히 사라지며 되돌릴 수 없습니다.`,
      confirmText: '삭제', variant: 'danger',
    })
    if (!ok) return

    setIsSavingHolding(true)
    const { error: noteErr } = await supabase.from('holding_notes').delete().eq('holding_id', h.holding_id)
    if (noteErr) {
      setIsSavingHolding(false)
      console.error('[customer] delete holding notes failed', noteErr)
      toast.error(`메모 삭제에 실패해 홀딩을 지우지 않았습니다 (${noteErr.code || noteErr.message})`)
      return
    }
    const { error } = await supabase.from('holdings').delete().eq('holding_id', h.holding_id)
    setIsSavingHolding(false)
    if (error) {
      console.error('[customer] delete holding failed', error)
      toast.error(`메모는 지워졌지만 홀딩 삭제에 실패했습니다 (${error.code || error.message})`)
      await fetchDetail()
      return
    }
    closeHoldingModal()
    if (await fetchDetail()) toast.success('홀딩이 삭제되었습니다')
  }

  /**
   * 해제 취소 — 다시 진행 중으로 되돌린다.
   * 한 장비에 진행 중 홀딩은 1건이므로, 그 사이 같은 장비에 새 홀딩이 걸렸으면 막는다.
   * (화면의 목록이 아니라 DB 를 직접 확인한다 — 다른 사람이 방금 걸었을 수 있다)
   */
  const handleReopen = async (h: Holding) => {
    const { data: existing, error: checkErr } = await supabase.from('holdings')
      .select('holding_id, title')
      .eq('device_id', h.device_id).is('resolved_at', null)
      .limit(1)
    if (checkErr) {
      console.error('[customer] reopen check failed', checkErr)
      toast.error('상태를 확인하지 못했습니다')
      return
    }
    if (existing && existing.length > 0) {
      toast.error(`이 장비에 진행 중인 홀딩이 있습니다 ('${existing[0].title}')`)
      return
    }

    const ok = await confirmDialog({
      title: '해제 취소',
      message: '이 홀딩을 다시 진행 중으로 되돌리시겠습니까?\n해제 사유도 함께 지워집니다.',
      confirmText: '해제 취소',
    })
    if (!ok) return

    setIsSavingHolding(true)
    const { error } = await supabase.from('holdings')
      .update({ resolved_at: null, resolved_note: null, updated_at: new Date().toISOString() })
      .eq('holding_id', h.holding_id)
    setIsSavingHolding(false)
    if (error) {
      console.error('[customer] reopen holding failed', error)
      toast.error(error.message || '해제 취소 중 오류가 발생했습니다')
      return
    }
    // 진행 중으로 돌아가면 레포트 범위의 위쪽 경계가 없어진다.
    await loadReports({ ...h, resolved_at: null })
    if (await fetchDetail()) toast.success('다시 진행 중으로 되돌렸습니다')
  }

  const handleAddNote = async (holdingId: number, content: string) => {
    if (!content.trim()) { toast.error('메모를 입력해주세요'); return }
    if (!engineerId) { toast.error('사용자 정보를 불러오는 중입니다'); return }
    setIsSavingHolding(true)
    const { error } = await supabase.from('holding_notes').insert({
      holding_id: holdingId, engineer_id: engineerId, content: content.trim(),
    })
    setIsSavingHolding(false)
    if (error) {
      console.error('[customer] add holding note failed', error)
      toast.error(error.message || '메모 저장 중 오류가 발생했습니다')
      return
    }
    if (await fetchDetail()) toast.success('메모가 추가되었습니다')
  }

  // 메모는 쓴 사람만 고칠 수 있다(superadmin 은 전부). 홀딩 자체의 등록·해제 권한과는 별개다.
  const canEditNote = (n: HoldingNote) =>
    superAdmin || (engineerId !== null && n.engineer_id === engineerId)

  const handleUpdateNote = async (noteId: number, content: string) => {
    if (!content.trim()) { toast.error('메모를 입력해주세요'); return }
    setIsSavingHolding(true)
    const { error } = await supabase.from('holding_notes')
      .update({ content: content.trim() })
      .eq('note_id', noteId)
    setIsSavingHolding(false)
    if (error) {
      console.error('[holding] update note failed', error)
      toast.error(error.message || '메모 수정 중 오류가 발생했습니다')
      return
    }
    if (await fetchDetail()) toast.success('메모가 수정되었습니다')
  }

  const handleDeleteNote = async (noteId: number) => {
    const ok = await confirmDialog({
      title: '메모 삭제', message: '이 메모를 삭제하시겠습니까?',
      confirmText: '삭제', variant: 'danger',
    })
    if (!ok) return
    setIsSavingHolding(true)
    const { error } = await supabase.from('holding_notes').delete().eq('note_id', noteId)
    setIsSavingHolding(false)
    if (error) {
      console.error('[holding] delete note failed', error)
      toast.error(error.message || '메모 삭제 중 오류가 발생했습니다')
      return
    }
    if (await fetchDetail()) toast.success('메모가 삭제되었습니다')
  }

  // 해제. 누구나 할 수 있고, 해제 후에도 이력은 그대로 남는다.
  const handleResolve = async (holdingId: number, resolvedNote: string, resolvedAt: string) => {
    setIsSavingHolding(true)
    const { error } = await supabase.from('holdings').update({
      resolved_at: resolvedAt,
      resolved_note: resolvedNote.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('holding_id', holdingId)
    setIsSavingHolding(false)
    if (error) {
      console.error('[customer] resolve holding failed', error)
      toast.error(error.message || '홀딩 해제 중 오류가 발생했습니다')
      return
    }
    closeResolve()
    closeHoldingModal()
    if (await fetchDetail()) toast.success('홀딩이 해제되었습니다')
  }

  return {
    isHoldingModalOpen, viewingHolding, newHoldingTarget, isSavingHolding,
    resolveTarget, resolveNotice, openResolve, closeResolve,
    openHolding, openNewHolding, closeHoldingModal,
    handleCreateHolding, handleUpdateHolding, handleAddNote, handleResolve,
    canDeleteHolding, handleDeleteHolding, handleReopen,
    holdingReports, reportsLoading, handleOpenReport,
    canEditNote, handleUpdateNote, handleDeleteNote,
  }
}
