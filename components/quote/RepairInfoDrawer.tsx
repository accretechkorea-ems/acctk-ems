'use client'

// 견적 목록에서 여는 **수리 정보 드로어** — 내 견적·실적 현황 두 목록이 함께 쓴다.
//
// 목록 행의 「수리 정보」 단추가 이것을 연다. 안은 작성 화면과 **같은 패널**이고
// (components/quote/RepairInfoPanel.tsx), 여기서는 저장된 견적이라 「저장」이 바로 쓴다.
//
// 모달이 아니라 오른쪽에 붙는 드로어인 까닭 — 목록에서 한 건씩 훑으며 적는 일이라,
// 가운데 모달이 뜨면 뒤의 목록이 가려 어느 줄을 보던 중인지 놓친다.

import { useEffect, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import RepairInfoPanel from '@/components/quote/RepairInfoPanel'
import {
  deleteRepairPhoto, fetchRepairInfo, movePhoto, orderRepairPhotos, photoRoom,
  repairInfoState, saveRepairInfo, uploadRepairPhotos,
  MAX_PHOTOS,
  type RepairBrief, type RepairInfoFields, type RepairInfoState, type RepairPhoto,
} from '@/lib/quoteRepairInfo'

const BORDER = '#ebebeb'

export type RepairInfoDrawerProps = {
  quoteId: number
  quoteNumber: string
  onClose: () => void
  /** 저장이 끝나면 목록 뱃지를 그 자리에서 고친다(다시 불러오지 않는다). */
  onSaved?: (quoteId: number, state: RepairInfoState) => void
  toast: { success: (m: string) => void; error: (m: string) => void }
}

const EMPTY: RepairInfoFields = { symptom: null, cause: null, result: null }

export default function RepairInfoDrawer({ quoteId, quoteNumber, onClose, onSaved, toast }: RepairInfoDrawerProps) {
  const [loading, setLoading] = useState(true)
  const [repair, setRepair] = useState<RepairBrief | null>(null)
  const [value, setValue] = useState<RepairInfoFields>(EMPTY)
  const [canEdit, setCanEdit] = useState(false)
  /** 사진 — 라우트가 준 차례 그대로. 서명 URL 이 함께 온다. */
  const [photos, setPhotos] = useState<RepairPhoto[]>([])
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  /**
   * 저장하지 않은 글자가 있는가 — 받아 온 값과 지금 값을 견준다.
   *
   * 증상·원인·결과와 **사진 설명**이 그 대상이다(사진 자체·차례는 고르는 즉시 저장되므로
   * 닫아도 잃을 것이 없다). 바뀐 것이 없으면 묻지 않는다 — 열어 보고 그냥 닫는 흐름이
   * 대부분이라, 그때까지 확인을 받으면 성가신 쪽이 이긴다(ModalOverlay 의 dirty).
   */
  const [saved, setSaved] = useState<{ info: RepairInfoFields; captions: string }>({ info: EMPTY, captions: '' })
  const captionKey = (list: RepairPhoto[]) => list.map(p => `${p.photo_id}:${p.caption ?? ''}`).join('|')
  const dirty = JSON.stringify(value) !== JSON.stringify(saved.info) || captionKey(photos) !== saved.captions

  useEffect(() => {
    let alive = true
    ;(async () => {
      const d = await fetchRepairInfo(quoteId)
      if (!alive) return
      setRepair(d?.repair ?? null)
      setValue(d?.info ?? EMPTY)
      setPhotos(d?.photos ?? [])
      setCanEdit(!!d?.canEdit)
      setSaved({ info: d?.info ?? EMPTY, captions: captionKey(d?.photos ?? []) })
      setLoading(false)
    })()
    return () => { alive = false }
  }, [quoteId])

  /** 설명 글자는 저장 버튼이 함께 쓴다 — 사진 줄마다 지금 화면 값을 모아 보낸다. */
  const save = async (): Promise<boolean> => {
    const captions = Object.fromEntries(photos.map(p => [p.photo_id, p.caption ?? '']))
    const r = await saveRepairInfo(quoteId, value, captions)
    if (!r.ok) { toast.error(r.error ?? '저장하지 못했습니다'); return false }
    toast.success('수리 정보를 저장했습니다')
    setSaved({ info: value, captions: captionKey(photos) })
    onSaved?.(quoteId, repairInfoState(value, photos.length))
    return true
  }

  /**
   * 사진 올리기 — **고르는 즉시** 간다(파일이라 저장 버튼까지 들고 있을 수 없다).
   * 넉 장을 넘겨 고르면 들어갈 만큼만 받고 나머지는 알린다.
   */
  const addPhotos = async (files: File[]) => {
    const room = photoRoom(photos.length)
    if (room === 0) { toast.error(`사진은 ${MAX_PHOTOS}장까지 올릴 수 있습니다`); return }
    const take = files.slice(0, room)
    if (files.length > room) toast.error(`사진은 ${MAX_PHOTOS}장까지입니다 — ${take.length}장만 올립니다`)
    setUploading({ done: 0, total: take.length })
    const r = await uploadRepairPhotos(quoteId, take, (done, total) => setUploading({ done, total }))
    setUploading(null)
    if (!r.ok) { toast.error(r.error ?? '사진을 올리지 못했습니다'); return }
    setPhotos(r.photos ?? [])
    setSaved(s => ({ ...s, captions: captionKey(r.photos ?? []) }))
    toast.success(`사진 ${take.length}장을 올렸습니다`)
    onSaved?.(quoteId, repairInfoState(value, (r.photos ?? []).length))
  }

  const removePhoto = async (photoId: number) => {
    const r = await deleteRepairPhoto(quoteId, photoId)
    if (!r.ok) { toast.error(r.error ?? '사진을 지우지 못했습니다'); return }
    setPhotos(r.photos ?? [])
    setSaved(s => ({ ...s, captions: captionKey(r.photos ?? []) }))
    toast.success('사진을 지웠습니다')
    onSaved?.(quoteId, repairInfoState(value, (r.photos ?? []).length))
  }

  /** 차례 — 화면을 먼저 바꾸고 그 차례를 그대로 보낸다(한 칸 위/아래라 되돌릴 일이 드물다). */
  const reorder = async (photoId: number, dir: -1 | 1) => {
    const next = movePhoto(photos, photoId, dir)
    if (next === photos) return
    setPhotos(next)
    const r = await orderRepairPhotos(quoteId, next.map(p => p.photo_id))
    if (!r.ok) { toast.error(r.error ?? '순서를 바꾸지 못했습니다'); setPhotos(photos) }
  }

  return (
    <ModalOverlay onClose={onClose} confirmClose dirty={dirty} style={{ justifyContent: 'flex-end', alignItems: 'stretch', padding: 0 }}>
      <div style={{
        width: 'min(460px, 100vw)', height: '100%', background: '#fff',
        borderLeft: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column',
        animation: 'modal-in 0.15s ease',
      }}>
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 3, height: 14, background: '#234ea2', borderRadius: 6, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 800, color: '#111827' }}>수리 정보</span>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>{quoteNumber}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} title="닫기"
            style={{ width: 24, height: 24, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
          {loading
            ? <div style={{ fontSize: 12, color: '#9ca3af' }}>불러오는 중…</div>
            : (
              <RepairInfoPanel
                repair={repair}
                value={value}
                onChange={setValue}
                mode="saved"
                onSave={save}
                canEdit={canEdit}
                photos={photos}
                onAddPhotos={addPhotos}
                onDeletePhoto={removePhoto}
                onMovePhoto={reorder}
                onCaption={(id, caption) => setPhotos(prev => prev.map(p => (p.photo_id === id ? { ...p, caption } : p)))}
                uploading={uploading}
              />
            )}
        </div>
      </div>
    </ModalOverlay>
  )
}
