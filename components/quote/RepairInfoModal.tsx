'use client'

// **수리 정보 모달** — 목록 세 곳(수리품 목록 · 내 견적 · 실적 현황)이 함께 쓴다.
//
// 2026-11-16 에 오른쪽 드로어에서 가운데 모달로 옮겼다. 적는 칸이 셋에 사진까지 붙어
// 460px 폭에서는 글줄이 너무 짧았다. 720px 가운데 창이면 한 줄이 제 길이로 보인다.
//
// ── 치수 ───────────────────────────────────────────────────────────────────
//   가로 720 고정 · 세로는 내용만큼 · 화면의 90% 를 넘으면 **본문만** 구른다
//   (머리줄과 아래 저장 줄은 붙어 있다 — 적다가 저장 단추를 찾아 내려가지 않게).
//
// ── 모션은 이 모달의 것이다 ────────────────────────────────────────────────
//   공용 ModalOverlay 를 건드리지 않는다(29개 모달이 함께 쓴다). 배경 0→1(150ms),
//   창 0→1 · 아래서 8px · 0.98→1(180ms ease-out), 닫힐 때 역순 120ms,
//   prefers-reduced-motion 이면 즉시. 창 안쪽은 PdfViewerModal 과 같은 규칙이다.
//
// 문서 단추는 머리줄 오른쪽에 **수리내역서 하나**다 — 거래명세서는 목록의 영수증
// 아이콘이 맡는다(한 가지 일에 입구를 둘 두지 않는다).

import { useEffect, useRef, useState } from 'react'
import RepairInfoPanel from '@/components/quote/RepairInfoPanel'
import { useConfirmOptional } from '@/components/common/confirmContext'
import { generateQuoteDoc } from '@/lib/quoteDocGenerate'
import { openPdf, shouldUseNewTab } from '@/lib/pdfViewer'
import { Z } from '@/lib/zIndex'
import {
  deleteRepairPhoto, fetchRepairInfo, movePhoto, orderRepairPhotos, photoRoom,
  repairInfoState, saveRepairInfo, uploadRepairPhotos, MAX_PHOTOS,
  type RepairBrief, type RepairInfoFields, type RepairInfoState, type RepairPhoto,
} from '@/lib/quoteRepairInfo'

const BORDER = '#ebebeb'
const MUTED = '#9ca3af'

export type RepairInfoModalProps = {
  quoteId: number
  quoteNumber: string
  onClose: () => void
  /** 저장이 끝나면 목록 아이콘을 그 자리에서 고친다(다시 불러오지 않는다). */
  onSaved?: (quoteId: number, state: RepairInfoState) => void
  toast: { success: (m: string) => void; error: (m: string) => void }
}

const EMPTY: RepairInfoFields = { symptom: null, cause: null, result: null }

export default function RepairInfoModal({ quoteId, quoteNumber, onClose, onSaved, toast }: RepairInfoModalProps) {
  const confirm = useConfirmOptional()
  const [loading, setLoading] = useState(true)
  const [repair, setRepair] = useState<RepairBrief | null>(null)
  const [value, setValue] = useState<RepairInfoFields>(EMPTY)
  const [canEdit, setCanEdit] = useState(false)
  const [photos, setPhotos] = useState<RepairPhoto[]>([])
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [docBusy, setDocBusy] = useState(false)

  /** 저장되지 않은 글자가 있는가 — 받아 온 값·설명과 지금 값을 견준다. */
  const [saved, setSaved] = useState<{ info: RepairInfoFields; captions: string }>({ info: EMPTY, captions: '' })
  const captionKey = (list: RepairPhoto[]) => list.map(p => `${p.photo_id}:${p.caption ?? ''}`).join('|')
  const dirty = JSON.stringify(value) !== JSON.stringify(saved.info) || captionKey(photos) !== saved.captions

  // ── 모션 ──
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [shown, setShown] = useState(reduced)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])

  const closeRef = useRef<() => void>(() => {})
  /** 닫기 — 적다 만 글이 있으면 먼저 묻는다(공용 모달의 규칙과 같은 문구). */
  const requestClose = async () => {
    if (dirty && confirm) {
      const ok = await confirm({
        title: '저장하지 않고 닫을까요?',
        message: '작성 중인 내용은 저장되지 않습니다.',
        confirmText: '닫기', cancelText: '계속 작성', variant: 'danger',
      })
      if (!ok) return
    }
    if (reduced) { onClose(); return }
    setClosing(true)
    setTimeout(onClose, 120)
  }
  closeRef.current = () => { void requestClose() }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  const save = async (): Promise<boolean> => {
    const captions = Object.fromEntries(photos.map(p => [p.photo_id, p.caption ?? '']))
    const r = await saveRepairInfo(quoteId, value, captions)
    if (!r.ok) { toast.error(r.error ?? '저장하지 못했습니다'); return false }
    toast.success('수리 정보를 저장했습니다')
    setSaved({ info: value, captions: captionKey(photos) })
    onSaved?.(quoteId, repairInfoState(value, photos.length))
    return true
  }

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

  const reorder = async (photoId: number, dir: -1 | 1) => {
    const next = movePhoto(photos, photoId, dir)
    if (next === photos) return
    setPhotos(next)
    const r = await orderRepairPhotos(quoteId, next.map(p => p.photo_id))
    if (!r.ok) { toast.error(r.error ?? '순서를 바꾸지 못했습니다'); setPhotos(photos) }
  }

  /** 수리내역서 — 머리줄 오른쪽. 만들어서 모달 뷰어로 띄운다. */
  const openRepairDoc = async () => {
    if (docBusy) return
    const tab = shouldUseNewTab() ? window.open('', '_blank') : null
    setDocBusy(true)
    try {
      const r = await generateQuoteDoc(quoteId, 'repair')
      if (!r.ok) { tab?.close(); toast.error(r.error); return }
      toast.success(`수리내역서 ${r.name} 을 만들었습니다`)
      openPdf({ url: r.url, name: r.name }, tab)
    } finally {
      setDocBusy(false)
    }
  }

  const open = shown && !closing
  const motion = reduced ? 'none' : undefined

  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) closeRef.current() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: Z.modal,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        opacity: open ? 1 : 0,
        transition: motion ?? `opacity ${closing ? 120 : 150}ms ease-out`,
      }}
    >
      <div
        style={{
          width: 720, maxWidth: '100%', maxHeight: '90vh', background: '#fff', borderRadius: 8,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.98)',
          transition: motion ?? `opacity ${closing ? 120 : 180}ms ease-out, transform ${closing ? 120 : 180}ms ease-out`,
        }}
      >
        {/* 머리줄 — 고정 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <div style={{ width: 3, height: 14, background: '#234ea2', borderRadius: 6, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 800, color: '#111827' }}>수리 정보</span>
          <span style={{ fontSize: 12, color: MUTED }}>{quoteNumber}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => void openRepairDoc()} disabled={docBusy || loading || repair === null}
            title={repair === null ? '수리 건이 연결된 견적만 낼 수 있습니다' : '수리내역서를 만들어 봅니다'}
            style={{
              height: 26, padding: '0 10px', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff',
              color: docBusy || loading || repair === null ? MUTED : '#234ea2', fontSize: 11, fontWeight: 700,
              cursor: docBusy || loading || repair === null ? 'not-allowed' : 'pointer',
            }}>
            {docBusy ? '만드는 중…' : '수리내역서'}
          </button>
          <button onClick={() => closeRef.current()} title="닫기" aria-label="닫기"
            style={{ width: 24, height: 24, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: MUTED, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* 본문 — 넘치면 여기만 구른다 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px' }}>
          {loading
            ? <div style={{ fontSize: 12, color: MUTED }}>불러오는 중…</div>
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
                hideSaveRow
              />
            )}
        </div>

        {/* 저장 줄 — 고정 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: MUTED }}>
            {canEdit ? (dirty ? '저장하지 않은 변경이 있습니다' : '') : '작성자만 고칠 수 있습니다'}
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={() => closeRef.current()}
            style={{ height: 30, padding: '0 14px', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', color: '#6b7280', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            닫기
          </button>
          {canEdit && (
            <button onClick={() => void save()} disabled={loading}
              style={{ height: 30, padding: '0 16px', borderRadius: 6, border: 'none', background: '#234ea2', color: '#fff', fontSize: 12, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
              저장
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
