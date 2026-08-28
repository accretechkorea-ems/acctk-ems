'use client'

// 장비 CRUD + 장비 사진 + 납입의사록·패킹리스트.
// 패킹리스트 업로드(uploadPackingFile)는 장비 추가·수정에서도 쓰이고 카드에서 직접 올릴 때도 쓰여서
// 장비 도메인 안에 함께 둔다.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import type { Device, DeviceForm } from '@/components/customer/types'

type Args = {
  customerId: number
  fetchDetail: () => Promise<boolean>
}

export function useDeviceCrud({ customerId, fetchDetail }: Args) {
  const supabase = createClient()
  const toast = useToast()
  const confirmDialog = useConfirm()

  const [isAddDeviceModalOpen, setIsAddDeviceModalOpen] = useState(false)
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)
  const [selectedImageDevice, setSelectedImageDevice] = useState<Device | null>(null)
  const [isSavingDevice, setIsSavingDevice] = useState(false)
  const [isSavingDeviceEdit, setIsSavingDeviceEdit] = useState(false)
  const [isSavingDeviceImage, setIsSavingDeviceImage] = useState(false)

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

  return {
    isAddDeviceModalOpen, setIsAddDeviceModalOpen,
    selectedDevice, setSelectedDevice,
    selectedImageDevice, setSelectedImageDevice,
    isSavingDevice, isSavingDeviceEdit, isSavingDeviceImage,
    handleAddDevice, handleUpdateDevice, handleDeleteDevice,
    handleUploadDeviceImage, handleOpenPacking, handleUploadPacking,
  }
}
