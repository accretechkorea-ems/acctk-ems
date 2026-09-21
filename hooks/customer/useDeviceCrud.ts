'use client'

// 장비 CRUD + 장비 사진 + 납입의사록·패킹리스트.
// 패킹리스트 업로드(uploadPackingFile)는 장비 추가·수정에서도 쓰이고 카드에서 직접 올릴 때도 쓰여서
// 장비 도메인 안에 함께 둔다.

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { downsizeImage } from '@/lib/leadCardImage'
import type { Device, DeviceForm } from '@/components/customer/types'

// ── 장비 사진 ──
// 카드의 사진 아이콘과 「사진 등록」 모달이 같은 경로를 쓰도록 훅 바깥에 둔다.
const DEVICE_IMAGE_BUCKET = 'device-images'
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const DEVICE_IMAGE_MAX_BYTES = 10 * 1024 * 1024

/**
 * 던져진 오류에서 보여줄 문구를 꺼낸다.
 * 스토리지 오류는 Error 지만 PostgrestError 는 평범한 객체라 둘 다 본다.
 */
function errText(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m) return m
  }
  return fallback
}

/**
 * 공개 URL 에서 버킷 안 파일명만 꺼낸다.
 * 기본 이미지(default_*)면 null 을 돌려준다 — 여러 장비가 함께 쓰는 파일이라 절대 지우면 안 된다.
 */
export function deviceImageFileName(url: string | null | undefined): string | null {
  if (!url) return null
  const marker = `/${DEVICE_IMAGE_BUCKET}/`
  const i = url.indexOf(marker)
  const name = (i >= 0 ? url.slice(i + marker.length) : url).split('?')[0]
  if (!name || name.includes('/')) return null
  if (/^default[_-]/i.test(name)) return null
  return name
}

/**
 * data URL 을 Blob 으로 바꾼다.
 * fetch(dataUrl) 로 하면 안 된다 — 그 요청은 CSP 의 connect-src 를 타는데(next.config.ts)
 * 거기에 data: 가 없어 브라우저가 막고 「Failed to fetch」 로 떨어진다. 여기서 직접 디코딩한다.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('이미지를 변환하지 못했습니다')
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/jpeg'
  const bin = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * 장비 사진 1장 업로드.
 * 명함과 같은 방식으로 브라우저에서 줄여(긴 변 1600px, JPEG 0.8) 올린다 — 원본 그대로 올리면
 * 카드 한 장에 수 MB 짜리가 걸린다. 갈아 끼운 뒤에는 옛 파일을 지운다(기본 이미지는 제외).
 * 실패하면 어느 단계였는지 함께 남긴다 — 축소·변환·업로드·갱신이 각각 다른 이유로 실패한다.
 */
export async function uploadDeviceImage(
  device: Device,
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { ok: false, error: 'JPG, PNG, WEBP, GIF 형식의 이미지만 업로드 가능합니다' }
  }
  if (file.size > DEVICE_IMAGE_MAX_BYTES) {
    return { ok: false, error: '파일 크기는 10MB 이하여야 합니다' }
  }

  const supabase = createClient()
  let step = '준비'
  try {
    step = '이미지 축소'
    const { dataUrl } = await downsizeImage(file)

    step = '이미지 변환'
    const blob = dataUrlToBlob(dataUrl)
    const fileName = `device-${device.device_id}-${Date.now()}.jpg`

    step = '스토리지 업로드'
    const { error: uploadError } = await supabase.storage
      .from(DEVICE_IMAGE_BUCKET)
      .upload(fileName, blob, { upsert: true, contentType: 'image/jpeg' })
    if (uploadError) throw uploadError

    step = 'DB 갱신'
    const { data } = supabase.storage.from(DEVICE_IMAGE_BUCKET).getPublicUrl(fileName)
    const { error: updateError } = await supabase
      .from('devices').update({ image_url: data.publicUrl }).eq('device_id', device.device_id)
    if (updateError) throw updateError

    // 옛 파일 정리. 여기서 실패해도 교체 자체는 끝난 것이라 되돌리지 않고 로그만 남긴다.
    const old = deviceImageFileName(device.image_url)
    if (old && old !== fileName) {
      const { error } = await supabase.storage.from(DEVICE_IMAGE_BUCKET).remove([old])
      if (error) console.error('[장비사진] 옛 파일 삭제 실패 — 고아 파일이 남는다', { old, error })
    }
    return { ok: true, url: data.publicUrl }
  } catch (error) {
    console.error('[장비사진] 업로드 실패', {
      step, deviceId: device.device_id, fileName: file.name, fileType: file.type, fileSize: file.size, error,
    })
    return { ok: false, error: `${errText(error, '장비 사진 업로드 중 오류가 발생했습니다')} (${step})` }
  }
}

/** 개별 사진을 지운다 — image_url 을 비우고 파일도 지운다. 화면은 기본 이미지로 돌아간다. */
export async function removeDeviceImage(device: Device): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient()
  try {
    const { error } = await supabase
      .from('devices').update({ image_url: null }).eq('device_id', device.device_id)
    if (error) throw error

    const old = deviceImageFileName(device.image_url)
    if (old) {
      const { error: rmErr } = await supabase.storage.from(DEVICE_IMAGE_BUCKET).remove([old])
      if (rmErr) console.error('[장비사진] 파일 삭제 실패 — 고아 파일이 남는다', { old, error: rmErr })
    }
    return { ok: true }
  } catch (error) {
    console.error('[장비사진] 삭제 실패', { deviceId: device.device_id, error })
    return { ok: false, error: errText(error, '장비 사진 삭제 중 오류가 발생했습니다') }
  }
}

type Args = {
  customerId: number
  fetchDetail: () => Promise<boolean>
}

export function useDeviceCrud({ customerId, fetchDetail }: Args) {
  const supabase = createClient()
  const toast = useToast()
  const confirmDialog = useConfirm()

  const [isAddDeviceModalOpen, setIsAddDeviceModalOpen] = useState(false)
  // 파일 열기 연타 가드(렌더를 기다리지 않는다). 화면에는 빈 탭이 먼저 떠 반응이 보인다.
  const openBusyRef = useRef(false)
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

  // ── 장비 사진 업로드 (모달) ──
  // 실제 업로드는 카드와 공유하는 uploadDeviceImage 가 한다. 여기서는 모달 상태와 목록 갱신만 맡는다.
  const handleUploadDeviceImage = async (file: File) => {
    if (!selectedImageDevice) return
    setIsSavingDeviceImage(true)
    const r = await uploadDeviceImage(selectedImageDevice, file)
    setIsSavingDeviceImage(false)
    if (!r.ok) { toast.error(r.error); return }
    toast.success('장비 사진이 등록되었습니다')
    setSelectedImageDevice(null)
    await fetchDetail()
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
    // 렌더를 기다리지 않는 연타 가드 — 두 번 들어오면 탭이 두 개 열린다.
    if (openBusyRef.current) return
    openBusyRef.current = true
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
    } finally {
      openBusyRef.current = false   // 실패해도 다시 누를 수 있어야 한다
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
