'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Font, pdf } from '@react-pdf/renderer'
import { geocodeAddress } from '@/lib/geocode'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/common/Toast'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { canAccess80, isSuperAdmin } from '@/lib/permissions'

import type { Customer, Device, Contact, ServiceHistory, Engineer, Quote, ServiceForm, DeviceForm, ContactForm, CustomerEditFormData } from '@/components/customer/types'
import { PAGE_BG, TEXT_MUTED } from '@/components/customer/constants'

import CustomerInfoPanel from '@/components/customer/CustomerInfoPanel'
import ContactSection from '@/components/customer/ContactSection'
import DeviceSection from '@/components/customer/DeviceSection'
import ServiceReportDoc from '@/components/customer/ServiceReportDoc'
import QuoteHistoryModal from '@/components/customer/modals/QuoteHistoryModal'
import CustomerEditModal from '@/components/customer/modals/CustomerEditModal'
import ContactAddModal from '@/components/customer/modals/ContactAddModal'
import ContactEditModal from '@/components/customer/modals/ContactEditModal'
import DeviceAddModal from '@/components/customer/modals/DeviceAddModal'
import DeviceEditModal from '@/components/customer/modals/DeviceEditModal'
import ServiceAddModal from '@/components/customer/modals/ServiceAddModal'
import ServiceEditModal from '@/components/customer/modals/ServiceEditModal'
import SignModal from '@/components/customer/modals/SignModal'
import DeviceImageModal from '@/components/customer/modals/DeviceImageModal'

Font.register({
  family: 'NotoSansCJK',
  src: 'https://fonts.gstatic.com/s/notosanskr/v36/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLTq8H4hfeE.ttf',
})

export default function CustomerDetailPage() {
  const supabase = createClient()
  const { loading: guardLoading, authorized } = usePageGuard(canAccess80)
  const params = useParams()
  const router = useRouter()
  const confirmDialog = useConfirm()
  const toast = useToast()
  const customerId = Number(params.id)

  // ── 데이터 상태 ──
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [history, setHistory] = useState<ServiceHistory[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [engineers, setEngineers] = useState<Engineer[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUserEngineerId, setCurrentUserEngineerId] = useState<number | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)

  // ── 모달 열림 상태 ──
  const [isQuoteHistoryModalOpen, setIsQuoteHistoryModalOpen] = useState(false)
  const [isEditCustomerModalOpen, setIsEditCustomerModalOpen] = useState(false)
  const [isAddContactModalOpen, setIsAddContactModalOpen] = useState(false)
  const [isAddDeviceModalOpen, setIsAddDeviceModalOpen] = useState(false)
  const [isSignModalOpen, setIsSignModalOpen] = useState(false)

  // ── 선택된 항목 (null = 모달 닫힘) ──
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null)
  const [selectedService, setSelectedService] = useState<ServiceHistory | null>(null)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)
  const [selectedImageDevice, setSelectedImageDevice] = useState<Device | null>(null)
  const [pendingReportService, setPendingReportService] = useState<ServiceHistory | null>(null)
  const [pendingReportDevice, setPendingReportDevice] = useState<Device | null>(null)

  // ── 저장 중 상태 ──
  const [isSavingService, setIsSavingService] = useState(false)
  const [isSavingServiceEdit, setIsSavingServiceEdit] = useState(false)
  const [isSavingCustomerEdit, setIsSavingCustomerEdit] = useState(false)
  const [isSavingContact, setIsSavingContact] = useState(false)
  const [isSavingDevice, setIsSavingDevice] = useState(false)
  const [isSavingContactEdit, setIsSavingContactEdit] = useState(false)
  const [isSavingDeviceEdit, setIsSavingDeviceEdit] = useState(false)
  const [isDeletingCustomer, setIsDeletingCustomer] = useState(false)
  const [isSavingDeviceImage, setIsSavingDeviceImage] = useState(false)

  // ── 데이터 페칭 ──
  const fetchDetail = async () => {
    setLoading(true)
    const [
      { data: customerData }, { data: devicesData }, { data: contactsData },
      { data: historyData }, { data: engineersData }, { data: quotesData },
    ] = await Promise.all([
      supabase.from('customers').select('*').eq('customer_id', customerId).single(),
      supabase.from('devices').select('*').is('deleted_at', null).eq('customer_id', customerId).order('device_id', { ascending: true }),
      supabase.from('contacts').select('*').is('deleted_at', null).eq('customer_id', customerId).order('contact_id', { ascending: true }),
      supabase.from('service_history').select('*, service_engineers(engineer_id, engineers(name, position))').eq('customer_id', customerId).order('service_id', { ascending: false }),
      supabase.from('engineers').select('*, email').order('engineer_id', { ascending: true }),
      supabase.from('quotes').select('*, engineers(name, position), quote_items(product_name, price_list(model_jp))').eq('customer_id', customerId).order('quote_date', { ascending: false }),
    ])
    setCustomer(customerData ?? null)
    setDevices(devicesData ?? [])
    setContacts(contactsData ?? [])
    setHistory(historyData ?? [])
    setEngineers(engineersData ?? [])
    setQuotes((quotesData as Quote[]) ?? [])
    const { data: { user } } = await supabase.auth.getUser()
    if (user && engineersData) {
      const me = (engineersData as any[]).find(e => e.email === user.email)
      if (me) {
        setCurrentUserEngineerId(me.engineer_id)
        setCurrentUserRole(me.permission_level ?? null)
      }
    }

    setLoading(false)
  }

  useEffect(() => {
    if (!customerId || Number.isNaN(customerId)) return
    fetchDetail()
  }, [customerId])


  // ── 서비스 CRUD ──
  const handleAddService = async (form: ServiceForm, engineerIds: number[]) => {
    if (!selectedDeviceId) return
    setIsSavingService(true)
    const visitYear = form.visit_date.slice(0, 4)
    const engineerSnapshot = engineerIds
      .map(id => engineers.find(e => e.engineer_id === id))
      .filter(Boolean)
      .map(e => `${e!.name} ${e!.position ?? ''}`.trim())
      .join(', ')
    const { data: newService, error } = await supabase.from('service_history').insert([{
      customer_id: customerId, device_id: selectedDeviceId, visit_year: visitYear,
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
    setSelectedDeviceId(null)
    await fetchDetail()
  }

  const handleUpdateService = async (form: ServiceForm, engineerIds: number[], reportFile: File | null) => {
    if (!selectedService) return
    setIsSavingServiceEdit(true)
    try {
      const visitYear = form.visit_date.slice(0, 4)
      const engineerSnapshot = engineerIds
        .map(id => engineers.find(e => e.engineer_id === id))
        .filter(Boolean)
        .map(e => `${e!.name} ${e!.position ?? ''}`.trim())
        .join(', ')

      const updatePayload: Record<string, unknown> = {
        visit_year: visitYear, visit_date: form.visit_date.trim(),
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

  // ── 업체 CRUD ──
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

  const handleDeleteCustomer = async () => {
    if (!customer) return
    const ok = await confirmDialog({ title: '업체 삭제', message: '이 업체를 삭제하시겠습니까?\n담당자·장비·서비스기록·견적 이력은 보존됩니다.', confirmText: '삭제', variant: 'danger' })
    if (!ok) return
    setIsDeletingCustomer(true)
    const cid = customer.customer_id
    try {
      const { error } = await supabase.from('customers').update({ deleted_at: new Date().toISOString() }).eq('customer_id', cid)
      if (error) throw error
      toast.success('업체가 삭제되었습니다')
      setIsEditCustomerModalOpen(false)
      router.push('/')
    } catch (error: any) {
      toast.error(error?.message || '업체 삭제 중 오류가 발생했습니다')
    } finally {
      setIsDeletingCustomer(false)
    }
  }

  // ── 담당자 CRUD ──
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

  // ── 장비 CRUD ──
  const handleAddDevice = async (form: DeviceForm, packingFile: File | null) => {
    setIsSavingDevice(true)
    try {
      // 장비를 먼저 등록하고 device_id를 받아온다 (패킹 파일명에 사용)
      const { data: inserted, error } = await supabase.from('devices').insert([{
        customer_id: customerId, device_name: form.device_name.trim(),
        device_name2: form.device_name2.trim() || null, option: form.option.trim() || null,
        serial_number: form.serial_number.trim() || null, program: form.program,
        install_date: form.install_date || null, install_year: null, category: form.category,
      }]).select('device_id').single()
      if (error || !inserted) throw error || new Error('장비 추가 실패')

      // 납입의사록·패킹리스트 파일이 있으면 업로드 후 경로 연결
      if (packingFile) {
        const path = await uploadPackingFile(inserted.device_id, packingFile)
        const { error: upErr } = await supabase.from('devices').update({ packing_list_url: path }).eq('device_id', inserted.device_id)
        if (upErr) throw upErr
      }

      toast.success('장비가 추가되었습니다')
      setIsAddDeviceModalOpen(false)
      await fetchDetail()
    } catch (error: any) {
      toast.error(error?.message || '장비 추가 중 오류가 발생했습니다')
    } finally {
      setIsSavingDevice(false)
    }
  }

  const handleUpdateDevice = async (form: DeviceForm, packingFile: File | null) => {
    if (!selectedDevice) return
    setIsSavingDeviceEdit(true)
    try {
      const updatePayload: Record<string, unknown> = {
        device_name: form.device_name.trim(), device_name2: form.device_name2.trim() || null,
        option: form.option.trim() || null, serial_number: form.serial_number.trim() || null,
        program: form.program, install_date: form.install_date || null, install_year: null, category: form.category,
      }
      // 새 납입의사록·패킹리스트 파일이 선택됐으면 업로드 후 경로 갱신
      let newPackingPath: string | null = null
      if (packingFile) {
        newPackingPath = await uploadPackingFile(selectedDevice.device_id, packingFile)
        updatePayload.packing_list_url = newPackingPath
      }
      const { error } = await supabase.from('devices').update(updatePayload).eq('device_id', selectedDevice.device_id)
      if (error) throw error

      // 교체 성공 후 기존 파일은 스토리지에서 삭제 (버킷에 고아 파일이 남지 않도록)
      if (newPackingPath && selectedDevice.packing_list_url) {
        const oldPath = toPackingPath(selectedDevice.packing_list_url)
        if (oldPath && oldPath !== newPackingPath) {
          await supabase.storage.from('packing-lists').remove([oldPath])
        }
      }

      toast.success('장비 정보가 수정되었습니다')
      setSelectedDevice(null)
      await fetchDetail()
    } catch (error: any) {
      toast.error(error?.message || '장비 수정 중 오류가 발생했습니다')
    } finally {
      setIsSavingDeviceEdit(false)
    }
  }

  const handleDeleteDevice = async () => {
    if (!selectedDevice) return
    const ok = await confirmDialog({ title: '장비 삭제', message: '이 장비를 삭제하시겠습니까?', confirmText: '삭제', variant: 'danger' })
    if (!ok) return
    setIsSavingDeviceEdit(true)
    const { error } = await supabase.from('devices').update({ deleted_at: new Date().toISOString() }).eq('device_id', selectedDevice.device_id)
    setIsSavingDeviceEdit(false)
    if (error) { toast.error(error.message || '장비 삭제 중 오류가 발생했습니다'); return }
    toast.success('장비가 삭제되었습니다')
    setSelectedDevice(null)
    await fetchDetail()
  }

  // ── 장비 사진 업로드 ──
  const handleUploadDeviceImage = async (file: File) => {
    if (!selectedImageDevice) return
    const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error('JPG, PNG, WEBP, GIF 형식의 이미지만 업로드 가능합니다')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('파일 크기는 10MB 이하여야 합니다')
      return
    }
    setIsSavingDeviceImage(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `device-${selectedImageDevice.device_id}-${Date.now()}.${fileExt}`
      const { error: uploadError } = await supabase.storage.from('device-images').upload(fileName, file, { upsert: true })
      if (uploadError) throw uploadError
      const { data } = supabase.storage.from('device-images').getPublicUrl(fileName)
      const { error: updateError } = await supabase.from('devices').update({ image_url: data.publicUrl }).eq('device_id', selectedImageDevice.device_id)
      if (updateError) throw updateError
      toast.success('장비 사진이 등록되었습니다')
      setSelectedImageDevice(null)
      await fetchDetail()
    } catch (error: any) {
      toast.error(error?.message || '장비 사진 업로드 중 오류가 발생했습니다')
    } finally {
      setIsSavingDeviceImage(false)
    }
  }

  // ── 납입의사록·패킹리스트 (비공개 버킷 + 서명 URL) ──
  // 파일을 packing-lists 버킷에 올리고 "저장 경로(파일명)"를 반환한다.
  // DB(packing_list_url)에는 전체 URL이 아니라 경로만 저장해, 열 때마다 시간제한 서명 URL을 발급한다.
  const uploadPackingFile = async (deviceId: number, file: File): Promise<string> => {
    const ALLOWED = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'image/jpeg', 'image/png',
    ]
    if (file.type && !ALLOWED.includes(file.type)) {
      throw new Error('PDF, 엑셀, 워드, 이미지 파일만 업로드 가능합니다.')
    }
    if (file.size > 20 * 1024 * 1024) {
      throw new Error('파일 크기는 20MB 이하여야 합니다.')
    }
    const ext = file.name.split('.').pop()
    const fileName = `packing-${deviceId}-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage.from('packing-lists').upload(fileName, file, { upsert: true })
    if (uploadError) throw uploadError
    return fileName
  }

  // 저장값에서 버킷 내 경로만 추출 (과거에 전체 public URL로 저장된 데이터도 호환)
  const toPackingPath = (stored: string): string => {
    const marker = '/packing-lists/'
    const idx = stored.indexOf(marker)
    return idx >= 0 ? stored.slice(idx + marker.length) : stored
  }

  const handleOpenPacking = async (device: Device) => {
    if (!device.packing_list_url) return
    // 팝업 차단 회피: 클릭 시점에 빈 탭을 먼저 연 뒤 서명 URL을 채운다.
    // (주의: window.open 옵션에 'noopener'를 넣으면 null이 반환되어 탭 제어가 불가하므로 넣지 않는다)
    const win = window.open('', '_blank')
    try {
      const path = toPackingPath(device.packing_list_url)
      const { data, error } = await supabase.storage.from('packing-lists').createSignedUrl(path, 3600)
      if (error || !data?.signedUrl) throw error || new Error('파일을 열 수 없습니다.')
      if (win) {
        win.opener = null // 보안: 열린 탭이 원본 창에 접근하지 못하도록
        win.location.href = data.signedUrl
      } else {
        // 팝업이 차단된 경우 현재 탭에서 열기
        window.open(data.signedUrl, '_blank')
      }
    } catch (error: any) {
      if (win) win.close()
      toast.error(error?.message || '파일을 여는 중 오류가 발생했습니다')
    }
  }

  const handleUploadPacking = async (device: Device, file: File) => {
    try {
      const path = await uploadPackingFile(device.device_id, file)
      const { error } = await supabase.from('devices').update({ packing_list_url: path }).eq('device_id', device.device_id)
      if (error) throw error
      toast.success('납입의사록·패킹리스트가 등록되었습니다')
      await fetchDetail()
    } catch (error: any) {
      toast.error(error?.message || '파일 업로드 중 오류가 발생했습니다')
    }
  }

  // ── 파생 상태 ──
  const historyByDevice = useMemo(() => {
    const map = new Map<number, ServiceHistory[]>()
    devices.forEach(d => map.set(d.device_id, []))
    history.forEach(h => {
      if (h.device_id == null) return
      const arr = map.get(Number(h.device_id)) || []
      arr.push(h)
      map.set(Number(h.device_id), arr)
    })
    return map
  }, [devices, history])

  const totalRevenueAmt = useMemo(
    () => quotes.filter(q => q.status === '매출완료').reduce((s, q) => s + (q.total_supply || 0), 0),
    [quotes]
  )

  const globalCss = `
    html, body { background: ${PAGE_BG}; }
    input::placeholder, textarea::placeholder { color: ${TEXT_MUTED}; opacity: 1; }
    select { appearance: none; -webkit-appearance: none; -moz-appearance: none; }
    input[type="date"]::-webkit-calendar-picker-indicator { cursor: pointer; }
    input:focus, textarea:focus, select:focus {
      border-color: #234ea2 !important;
      box-shadow: 0 0 0 3px rgba(35,78,162,0.10) !important;
      outline: none;
    }
    @keyframes modal-in {
      from { opacity: 0; transform: scale(0.97) translateY(6px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes sk-pulse { 0%,100% { opacity:1 } 50% { opacity:0.45 } }
  `

  if (!authorized) return <AccessGate loading={guardLoading} />

  if (loading) {
    return (
      <>
        <style jsx global>{globalCss}</style>
        <main style={{ padding: 20, maxWidth: 1400, margin: '0 auto', background: PAGE_BG, minHeight: '100vh' }}>
          {[{ h: 130, mb: 24 }, { h: 120, mb: 24 }, { h: 400, mb: 0 }].map(({ h, mb }, i) => (
            <div key={i} style={{
              background: '#ffffff', borderRadius: 20, height: h, marginBottom: mb,
              border: '1px solid #e5e7eb',
              animation: 'sk-pulse 1.6s ease-in-out infinite',
              animationDelay: `${i * 0.15}s`,
            }} />
          ))}
        </main>
      </>
    )
  }

  return (
    <>
      <style jsx global>{globalCss}</style>

      <main style={{ padding: 20, maxWidth: 1400, margin: '0 auto', background: PAGE_BG, minHeight: '100vh' }}>

        <CustomerInfoPanel
          customer={customer}
          quotes={quotes}
          totalRevenueAmt={totalRevenueAmt}
          onEdit={() => setIsEditCustomerModalOpen(true)}
          onQuoteHistoryOpen={() => setIsQuoteHistoryModalOpen(true)}
        />

        <ContactSection
          contacts={contacts}
          onAdd={() => setIsAddContactModalOpen(true)}
          onEdit={setSelectedContact}
        />

        <DeviceSection
          devices={devices}
          historyByDevice={historyByDevice}
          onAddDevice={() => setIsAddDeviceModalOpen(true)}
          onEditDevice={setSelectedDevice}
          onAddService={setSelectedDeviceId}
          onEditService={setSelectedService}
          onImageUpload={setSelectedImageDevice}
          onPrintReport={(service, device) => {
            setPendingReportService(service)
            setPendingReportDevice(device)
            setIsSignModalOpen(true)
          }}
          onOpenReport={handleOpenReport}
          onUploadPacking={handleUploadPacking}
          onOpenPacking={handleOpenPacking}
        />

        {/* ── 모달 ── */}
        <QuoteHistoryModal
          isOpen={isQuoteHistoryModalOpen}
          customer={customer}
          quotes={quotes}
          onClose={() => setIsQuoteHistoryModalOpen(false)}
        />
        <CustomerEditModal
          customer={isEditCustomerModalOpen ? customer : null}
          isSaving={isSavingCustomerEdit}
          isDeleting={isDeletingCustomer}
          onClose={() => setIsEditCustomerModalOpen(false)}
          onSave={handleUpdateCustomer}
          onDelete={isSuperAdmin({ permission_level: currentUserRole }) ? handleDeleteCustomer : undefined}
        />
        <ContactAddModal
          isOpen={isAddContactModalOpen}
          isSaving={isSavingContact}
          onClose={() => setIsAddContactModalOpen(false)}
          onSave={handleAddContact}
        />
        <ContactEditModal
          contact={selectedContact}
          isSaving={isSavingContactEdit}
          onClose={() => setSelectedContact(null)}
          onSave={handleUpdateContact}
          onDelete={handleDeleteContact}
        />
        <DeviceAddModal
          isOpen={isAddDeviceModalOpen}
          isSaving={isSavingDevice}
          onClose={() => setIsAddDeviceModalOpen(false)}
          onSave={handleAddDevice}
        />
        <DeviceEditModal
          device={selectedDevice}
          isSaving={isSavingDeviceEdit}
          onClose={() => setSelectedDevice(null)}
          onSave={handleUpdateDevice}
          onDelete={handleDeleteDevice}
          onOpenPacking={() => selectedDevice && handleOpenPacking(selectedDevice)}
        />
        <ServiceAddModal
          deviceId={selectedDeviceId}
          contacts={contacts}
          engineers={engineers}
          currentUserEngineerId={currentUserEngineerId}
          isSaving={isSavingService}
          onClose={() => setSelectedDeviceId(null)}
          onSave={handleAddService}
        />
        <ServiceEditModal
          service={selectedService}
          onOpenReport={() => selectedService && handleOpenReport(selectedService)}
          onDeleteReport={() => selectedService && handleDeleteReport(selectedService)}
          contacts={contacts}
          engineers={engineers}
          isSaving={isSavingServiceEdit}
          onClose={() => setSelectedService(null)}
          onSave={handleUpdateService}
          onDelete={handleDeleteService}
        />
        <SignModal
          isOpen={isSignModalOpen}
          onClose={() => {
            setIsSignModalOpen(false)
            setPendingReportService(null)
            setPendingReportDevice(null)
          }}
          onComplete={async (engineerSign, customerSign) => {
            setIsSignModalOpen(false)
            if (pendingReportService && pendingReportDevice) {
              await handlePrintReport(pendingReportService, pendingReportDevice, engineerSign, customerSign)
            }
            setPendingReportService(null)
            setPendingReportDevice(null)
          }}
        />
        <DeviceImageModal
          device={selectedImageDevice}
          isSaving={isSavingDeviceImage}
          onClose={() => setSelectedImageDevice(null)}
          onSave={handleUploadDeviceImage}
        />

      </main>
    </>
  )
}
