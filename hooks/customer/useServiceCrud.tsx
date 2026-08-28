'use client'

// 서비스 기록 CRUD 와 서비스 레포트(PDF·서명 URL)를 한 훅에 둔다.
// 레포트를 따로 떼면 toReportPath / uploadReportFile 을 양쪽이 나눠 쓰고,
// handleDeleteReport 가 selectedService 를 갱신해야 해서 훅끼리 서로를 참조하게 된다.
// 실제로 같은 상태를 공유하는 한 덩어리라 분리하지 않았다.
// 레포트 PDF 를 만들 때 JSX 를 쓰므로 이 파일만 .tsx 다.

import { useCallback, useState } from 'react'
import { pdf } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import ServiceReportDoc from '@/components/customer/ServiceReportDoc'
import type { Customer, Device, Contact, ServiceHistory, Engineer, ServiceForm, Holding } from '@/components/customer/types'

type Args = {
  customerId: number
  customer: Customer | null
  contacts: Contact[]
  engineers: Engineer[]
  fetchDetail: () => Promise<boolean>
  // 새 레포트를 저장한 뒤 그 장비에 진행 중인 홀딩이 있으면 해제를 물어본다.
  // (수정 시에는 묻지 않는다 — 신규 작성만 해당)
  onActiveHoldingFound?: (h: Holding) => void
}

export function useServiceCrud({ customerId, customer, contacts, engineers, fetchDetail, onActiveHoldingFound }: Args) {
  const supabase = createClient()
  const toast = useToast()
  const confirmDialog = useConfirm()

  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null)
  const [selectedService, setSelectedService] = useState<ServiceHistory | null>(null)
  const [isSavingService, setIsSavingService] = useState(false)
  const [isSavingServiceEdit, setIsSavingServiceEdit] = useState(false)

  // ── 서비스 CRUD ──
  const handleAddService = async (form: ServiceForm, engineerIds: number[]) => {
    if (!selectedDeviceId) return
    setIsSavingService(true)
    const engineerSnapshot = engineerIds
      .map(id => engineers.find(e => e.engineer_id === id))
      .filter(Boolean)
      .map(e => `${e!.name} ${e!.position ?? ''}`.trim())
      .join(', ')
    const { data: newService, error } = await supabase.from('service_history').insert([{
      customer_id: customerId, device_id: selectedDeviceId,
      visit_date: form.visit_date.trim(), service_notes: form.service_notes.trim(),
      etc_notes: form.etc_notes.trim() || null,
      visitor: engineerSnapshot || null, service_type: form.service_type,
      contact_id: form.contact_id || null, is_paid: form.is_paid,
      work_hours: form.work_hours ? parseFloat(form.work_hours) : null,
      start_time: form.start_time || null, end_time: form.end_time || null,
    }]).select().single()
    if (error) { setIsSavingService(false); toast.error(error.message || '서비스 기록 저장 중 오류가 발생했습니다'); return }
    const { error: engineerError } = await supabase.from('service_engineers').insert(engineerIds.map(eid => ({ service_id: newService.service_id, engineer_id: eid })))
    setIsSavingService(false)
    if (engineerError) { toast.error(engineerError.message || '엔지니어 연결 저장 중 오류가 발생했습니다'); return }
    toast.success('서비스 기록이 추가되었습니다')
    const savedDeviceId = selectedDeviceId
    setSelectedDeviceId(null)
    // 목록을 먼저 갱신하고, 그 다음에 해제 모달을 띄운다.
    // (fetchDetail 이 끝나기 전에 띄우면 갱신 렌더에 모달이 묻힌다)
    await fetchDetail()
    if (!onActiveHoldingFound) return
    const { data: active, error: holdingErr } = await supabase
      .from('holdings')
      .select('*, devices(device_name, device_name2, serial_number), engineers(name, position), holding_notes(*, engineers(name, position))')
      .eq('device_id', savedDeviceId)
      .is('resolved_at', null)
      .limit(1)
    if (holdingErr) { console.error('[customer] active holding lookup failed', holdingErr); return }
    if (active && active.length > 0) onActiveHoldingFound(active[0] as Holding)
  }

  const handleUpdateService = async (form: ServiceForm, engineerIds: number[], reportFile: File | null) => {
    if (!selectedService) return
    setIsSavingServiceEdit(true)
    try {
      const engineerSnapshot = engineerIds
        .map(id => engineers.find(e => e.engineer_id === id))
        .filter(Boolean)
        .map(e => `${e!.name} ${e!.position ?? ''}`.trim())
        .join(', ')

      const updatePayload: Record<string, unknown> = {
        visit_date: form.visit_date.trim(),
        service_notes: form.service_notes.trim(), etc_notes: form.etc_notes.trim() || null,
        visitor: engineerSnapshot || null,
        service_type: form.service_type, contact_id: form.contact_id || null,
        is_paid: form.is_paid, work_hours: form.work_hours ? parseFloat(form.work_hours) : null,
        start_time: form.start_time || null, end_time: form.end_time || null,
      }

      // 새 레포트 파일이 선택됐으면 업로드 후 경로 갱신
      let newReportPath: string | null = null
      if (reportFile) {
        newReportPath = await uploadReportFile(selectedService.service_id, reportFile)
        updatePayload.report_url = newReportPath
      }

      const { error } = await supabase.from('service_history').update(updatePayload).eq('service_id', selectedService.service_id)
      if (error) throw error

      await supabase.from('service_engineers').delete().eq('service_id', selectedService.service_id)
      await supabase.from('service_engineers').insert(engineerIds.map(eid => ({ service_id: selectedService.service_id, engineer_id: eid })))

      // 레포트 교체 시 기존 파일 삭제
      if (newReportPath && selectedService.report_url) {
        const oldPath = toReportPath(selectedService.report_url)
        if (oldPath && oldPath !== newReportPath) await supabase.storage.from('service-report').remove([oldPath])
      }

      toast.success('서비스 기록이 수정되었습니다')
      setSelectedService(null)
      await fetchDetail()
    } catch (error: any) {
      toast.error(error?.message || '서비스 기록 수정 중 오류가 발생했습니다')
    } finally {
      setIsSavingServiceEdit(false)
    }
  }

  const handleDeleteService = async () => {
    if (!selectedService) return
    const ok = await confirmDialog({ title: '서비스 기록 삭제', message: '이 서비스 기록을 삭제하시겠습니까?', confirmText: '삭제', variant: 'danger' })
    if (!ok) return
    setIsSavingServiceEdit(true)
    const { error } = await supabase.from('service_history').delete().eq('service_id', selectedService.service_id)
    setIsSavingServiceEdit(false)
    if (error) { toast.error(error.message || '서비스 기록 삭제 중 오류가 발생했습니다'); return }
    toast.success('서비스 기록이 삭제되었습니다')
    setSelectedService(null)
    await fetchDetail()
  }

  // ── 서비스 레포트 (비공개 버킷 + 서명 URL) ──
  // 저장값에서 service-report 버킷 내 경로만 추출 (과거 전체 URL 데이터 호환)
  const toReportPath = (stored: string): string => {
    const marker = '/service-report/'
    const idx = stored.indexOf(marker)
    return idx >= 0 ? stored.slice(idx + marker.length) : stored
  }

  // 사인 완료 후 PDF를 생성해 service-report 버킷에 저장 (다운로드 X)
  const handlePrintReport = useCallback(async (service: ServiceHistory, device: Device, engineerSignDataUrl?: string, customerSignDataUrl?: string) => {
    try {
      const contact = contacts.find(c => c.contact_id === service.contact_id) ?? null
      const engineers = service.service_engineers ?? []
      const engineerNames = engineers.map(se => `${se.engineers.name} ${se.engineers.position ?? ''}`.trim()).join(', ')
      const firstEngineerName = engineers[0]?.engineers.name ?? ''
      const blob = await pdf(
        <ServiceReportDoc
          service={service} device={device} customer={customer!} contact={contact}
          engineerNames={engineerNames} firstEngineerName={firstEngineerName}
          engineerSignDataUrl={engineerSignDataUrl} customerSignDataUrl={customerSignDataUrl}
        />
      ).toBlob()

      const fileName = `report-${service.service_id}-${Date.now()}.pdf`
      const { error: upErr } = await supabase.storage.from('service-report').upload(fileName, blob, { upsert: true, contentType: 'application/pdf' })
      if (upErr) throw upErr

      const { error: updErr } = await supabase.from('service_history').update({ report_url: fileName }).eq('service_id', service.service_id)
      if (updErr) throw updErr

      // 기존 레포트가 있으면 스토리지에서 삭제 (고아 파일 방지)
      if (service.report_url) {
        const oldPath = toReportPath(service.report_url)
        if (oldPath && oldPath !== fileName) await supabase.storage.from('service-report').remove([oldPath])
      }

      toast.success('레포트가 저장되었습니다')
      await fetchDetail()
    } catch (error: any) {
      toast.error(error?.message || '레포트 저장 중 오류가 발생했습니다')
    }
  }, [contacts, customer])

  // 저장된 레포트를 서명 URL로 열기
  const handleOpenReport = async (service: ServiceHistory) => {
    if (!service.report_url) return
    const win = window.open('', '_blank')
    try {
      const path = toReportPath(service.report_url)
      const { data, error } = await supabase.storage.from('service-report').createSignedUrl(path, 3600)
      if (error || !data?.signedUrl) throw error || new Error('레포트를 열 수 없습니다.')
      if (win) { win.opener = null; win.location.href = data.signedUrl }
      else window.open(data.signedUrl, '_blank')
    } catch (error: any) {
      if (win) win.close()
      toast.error(error?.message || '레포트를 여는 중 오류가 발생했습니다')
    }
  }

  // 저장된 레포트 삭제 — 스토리지 파일 제거 + report_url 비움 (재작성 가능하도록)
  const handleDeleteReport = async (service: ServiceHistory) => {
    if (!service.report_url) return
    const ok = await confirmDialog({ title: '레포트 삭제', message: '이 레포트를 삭제하시겠습니까?\n삭제 후 다시 작성할 수 있습니다.', confirmText: '삭제', variant: 'danger' })
    if (!ok) return
    try {
      const path = toReportPath(service.report_url)
      await supabase.storage.from('service-report').remove([path])
      const { error } = await supabase.from('service_history').update({ report_url: null }).eq('service_id', service.service_id)
      if (error) throw error
      setSelectedService(prev => prev ? { ...prev, report_url: null } : prev)
      await fetchDetail()
      toast.success('레포트가 삭제되었습니다')
    } catch (error: any) {
      toast.error(error?.message || '레포트 삭제 중 오류가 발생했습니다')
    }
  }

  // 서비스 레포트 파일 업로드 → 저장 경로(파일명) 반환
  const uploadReportFile = async (serviceId: number, file: File): Promise<string> => {
    if (file.size > 20 * 1024 * 1024) throw new Error('파일 크기는 20MB 이하여야 합니다.')
    const ext = file.name.split('.').pop()
    const fileName = `report-${serviceId}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('service-report').upload(fileName, file, { upsert: true })
    if (error) throw error
    return fileName
  }

  return {
    selectedDeviceId, setSelectedDeviceId,
    selectedService, setSelectedService,
    isSavingService, isSavingServiceEdit,
    handleAddService, handleUpdateService, handleDeleteService,
    handlePrintReport, handleOpenReport, handleDeleteReport,
  }
}
