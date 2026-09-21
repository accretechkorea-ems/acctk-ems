'use client'

// 건의사항 게시판 — 로그인 사용자 전원 열람/작성, superadmin 이 답변·상태 변경.
// RLS 가 전원 허용이므로 본인 글 판정·삭제 제한은 이 화면에서 처리한다.

import React, { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { josa } from '@/lib/josa'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { canViewAll, isSuperAdmin } from '@/lib/permissions'
import { Z } from '@/lib/zIndex'

const BLUE = '#234ea2'
const PAGE_BG = '#f4f5f7'
const CARD_BG = '#ffffff'
const BORDER = '#ebebeb'
const TEXT = '#111113'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'

const STATUSES = ['접수', '검토중', '완료', '보류'] as const
type Status = typeof STATUSES[number]
const STATUS_TABS = ['전체', ...STATUSES]

// 관리자가 직접 고를 수 있는 상태. 「접수」는 등록 시 자동으로 붙는 값이라 선택지에서 뺀다.
const ADMIN_STATUSES = ['검토중', '완료', '보류'] as const

/** 건의 1건에 붙일 수 있는 스크린샷 수. 라우트의 MAX_IMAGES 와 같아야 한다. */
const MAX_IMAGES = 3
const SHOT_ACCEPT = 'image/png,image/jpeg,image/webp'
/** 스크린샷 축소 기준 — 글자가 많아 명함용(1600px·JPEG 0.8)보다 크고 덜 깎는다. */
const SHOT_MAX_EDGE = 1920
const SHOT_JPEG_QUALITY = 0.92

/**
 * 스크린샷을 올리기 좋은 크기로 줄인다. 긴 변 1920px, PNG 는 PNG 로 유지하고 그 밖은 JPEG 0.92.
 * lib/leadCardImage 의 downsizeImage 는 사진용(1600px·JPEG 0.8)이라 글자가 번진다 —
 * 같은 방식이되 값만 달리해 여기에 둔다.
 */
async function downsizeScreenshot(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, SHOT_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) { bitmap.close(); throw new Error('이미지를 줄이지 못했습니다') }
  const keepPng = file.type === 'image/png'
  // JPEG 는 투명을 못 담아 검게 나온다. 흰 바탕을 먼저 깐다.
  if (!keepPng) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h) }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', SHOT_JPEG_QUALITY)
}

// suggestions.category 의 CHECK 제약과 같은 값이어야 한다.
const CATEGORIES = ['80', '20', '영업관리', '견적서', '기타'] as const
type Category = typeof CATEGORIES[number]
const CATEGORY_TABS = ['전체', ...CATEGORIES]

// 상태 뱃지 — 배경은 공용 회색 pill 하나로 통일하고 글자색만 기존 토큰에서 가져다 쓴다.
const STATUS_TEXT: Record<string, string> = {
  '접수': GRAY,
  '검토중': BLUE,
  '완료': '#15803d',
  '보류': '#d97706',
}

const PAGE_SIZE = 15

type Suggestion = {
  suggestion_id: number
  engineer_id: number
  title: string
  content: string
  category: string
  status: string
  admin_reply: string | null
  replied_by: number | null
  replied_at: string | null
  created_at: string
  updated_at: string
  /** suggestion-images 버킷 안의 파일명들. 전체 URL 이 아니다. */
  image_urls: string[] | null
  engineers?: { name: string; position: string | null } | null
}

const fmtDate = (s: string | null) => (s ? s.slice(0, 10) : '-')
const fmtDateTime = (s: string | null) => (s ? s.slice(0, 16).replace('T', ' ') : '-')

export default function SuggestionsPage() {
  const supabase = createClient()
  const toast = useToast()
  const confirmDialog = useConfirm()
  const { engineer, loading: guardLoading, authorized } = usePageGuard(canViewAll)
  const superAdmin = isSuperAdmin(engineer)

  const [rows, setRows] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('전체')
  const [categoryFilter, setCategoryFilter] = useState('전체')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  // 작성·수정 모달 (editing === null 이면 신규)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Suggestion | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formCategory, setFormCategory] = useState<Category>('기타')
  const [saving, setSaving] = useState(false)
  const formErr = useFieldErrors<'title' | 'content'>()

  // 스크린샷 — 새로 고른 것(formImages)은 저장할 때 올리고, 기존 것(existingImages)은 즉시 지운다.
  const [formImages, setFormImages] = useState<{ name: string; dataUrl: string }[]>([])
  const [existingImages, setExistingImages] = useState<string[]>([])
  const [shotBusy, setShotBusy] = useState(false)
  const [shotConfirm, setShotConfirm] = useState<string | null>(null)
  const [shotRemoving, setShotRemoving] = useState<string | null>(null)
  const shotTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shotInputRef = useRef<HTMLInputElement | null>(null)
  // 상세 모달에서 보여줄 서명 URL. 파일명 → URL.
  const [shotUrls, setShotUrls] = useState<Record<string, string>>({})

  // 상세 모달
  const [detail, setDetail] = useState<Suggestion | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyStatus, setReplyStatus] = useState<Status>('검토중')
  const [replySaving, setReplySaving] = useState(false)
  const replyErr = useFieldErrors<'reply'>()

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => { formErr.setErrors({}) }, [formOpen])
  useEffect(() => { replyErr.setErrors({}) }, [detail])
  /* eslint-enable react-hooks/exhaustive-deps */

  // suggestions 는 engineers 를 engineer_id(작성자)·replied_by(답변자) 두 번 참조한다.
  // 그냥 engineers(...) 로 쓰면 어느 관계인지 정해지지 않아 PGRST201 로 조회 전체가 실패하므로
  // 제약 이름으로 작성자 쪽을 지정한다. (답변자 이름은 화면에서 쓰지 않아 가져오지 않는다)
  // 반환값: 조회 성공 여부. 호출한 쪽이 성공 안내를 띄울지 판단하는 데 쓴다.
  const load = async (): Promise<boolean> => {
    setLoading(true)
    const { data, error } = await supabase
      .from('suggestions')
      .select('*, engineers!suggestions_engineer_id_fkey(name, position)')
      .order('created_at', { ascending: false })
    setLoading(false)
    if (error) {
      console.error('[suggestions] load failed', error)
      toast.error(`건의사항을 불러오지 못했습니다 (${error.code || error.message})`)
      return false
    }
    setRows((data ?? []) as unknown as Suggestion[])
    return true
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (authorized) load() }, [authorized])

  // 목록이 갱신되면 열려 있는 상세도 최신 내용으로 맞춘다.
  useEffect(() => {
    if (!detail) return
    const fresh = rows.find(r => r.suggestion_id === detail.suggestion_id)
    if (fresh && fresh !== detail) setDetail(fresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  // 작성·수정 모달이 열려 있는 동안에는 어디서 붙여넣어도 스크린샷으로 받는다(캡처 후 Ctrl+V).
  // 포커스가 모달 밖에 있을 수도 있어 window 에 건다.
  useEffect(() => {
    if (!formOpen) return
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
        .map(it => it.getAsFile())
        .filter((f): f is File => f != null)
      if (files.length === 0) return
      e.preventDefault()
      void addScreenshots(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen, existingImages.length, formImages.length])

  useEffect(() => () => { if (shotTimer.current) clearTimeout(shotTimer.current) }, [])

  // 비공개 버킷이라 파일명만으로는 그릴 수 없다. 지금 보고 있는 쪽(상세 또는 수정 모달)의
  // 스크린샷에 대해 서명 URL 을 받아 둔다.
  const shotTargetId = detail?.suggestion_id ?? (formOpen && editing ? editing.suggestion_id : null)
  const shotNames = detail ? (detail.image_urls ?? []) : (formOpen && editing ? existingImages : [])
  const shotKey = shotNames.join(',')

  useEffect(() => {
    if (shotTargetId == null || !shotKey) { setShotUrls({}); return }
    let alive = true
    void (async () => {
      const entries = await Promise.all(shotKey.split(',').map(async name => {
        try {
          const res = await fetch(`/api/suggestion-image?suggestionId=${shotTargetId}&fileName=${encodeURIComponent(name)}`)
          if (!res.ok) return null
          const body = await res.json() as { signedUrl?: string }
          return body.signedUrl ? ([name, body.signedUrl] as [string, string]) : null
        } catch (e) {
          console.error('[건의] 스크린샷 서명 URL 실패', { name, error: e })
          return null
        }
      }))
      if (!alive) return
      setShotUrls(Object.fromEntries(entries.filter((x): x is [string, string] => x != null)))
    })()
    return () => { alive = false }
  }, [shotTargetId, shotKey])

  const filtered = rows.filter(r => {
    const matchStatus = statusFilter === '전체' || r.status === statusFilter
    const matchCategory = categoryFilter === '전체' || r.category === categoryFilter
    const q = search.trim().toLowerCase()
    const matchSearch = !q ||
      r.title.toLowerCase().includes(q) ||
      r.content.toLowerCase().includes(q) ||
      (r.engineers?.name ?? '').toLowerCase().includes(q)
    return matchStatus && matchCategory && matchSearch
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages)
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)

  // ── 권한 판정 (RLS 가 전원 허용이라 여기서 막는다) ──
  const isMine = (s: Suggestion) => engineer?.engineer_id === s.engineer_id
  // 수정은 작성자 본인만 — superadmin 이라도 남이 쓴 건의 내용은 고치지 않는다.
  // 답변이 달린 뒤에는 내용이 바뀌면 답변이 어긋나므로 숨긴다.
  const canEdit = (s: Suggestion) => isMine(s) && !s.admin_reply
  const canDelete = (s: Suggestion) => isMine(s) || superAdmin

  const asCategory = (v: string): Category =>
    (CATEGORIES as readonly string[]).includes(v) ? (v as Category) : '기타'

  const openNew = () => {
    setEditing(null); setFormTitle(''); setFormContent(''); setFormCategory('기타')
    setFormImages([]); setExistingImages([]); setShotConfirm(null)
    setFormOpen(true)
  }
  const openEdit = (s: Suggestion) => {
    setEditing(s); setFormTitle(s.title); setFormContent(s.content); setFormCategory(asCategory(s.category))
    setFormImages([]); setExistingImages(s.image_urls ?? []); setShotConfirm(null)
    setFormOpen(true)
  }

  // ── 스크린샷 ──
  /** 고른 파일을 줄여 대기 목록에 넣는다. 파일 선택과 붙여넣기가 함께 쓴다. */
  const addScreenshots = async (files: File[]) => {
    if (files.length === 0) return
    const room = MAX_IMAGES - existingImages.length - formImages.length
    if (room <= 0) { toast.error(`스크린샷은 ${MAX_IMAGES}장까지 올릴 수 있습니다`); return }
    setShotBusy(true)
    const added: { name: string; dataUrl: string }[] = []
    for (const file of files.slice(0, room)) {
      try {
        added.push({ name: file.name || '스크린샷.png', dataUrl: await downsizeScreenshot(file) })
      } catch (e) {
        console.error('[건의] 스크린샷을 읽지 못했다', { name: file.name, error: e })
        toast.error('이미지를 읽지 못했습니다')
      }
    }
    setShotBusy(false)
    if (added.length > 0) setFormImages(prev => [...prev, ...added])
    if (files.length > room) toast.error(`스크린샷은 ${MAX_IMAGES}장까지입니다`)
  }

  /** 기존 스크린샷 삭제는 두 번 눌러야 실행된다. 3초가 지나면 원래대로 돌아간다. */
  const armShotRemove = (fileName: string) => {
    if (shotTimer.current) clearTimeout(shotTimer.current)
    setShotConfirm(fileName)
    shotTimer.current = setTimeout(() => { shotTimer.current = null; setShotConfirm(null) }, 3000)
  }

  const removeExistingShot = async (fileName: string) => {
    if (!editing) return
    if (shotTimer.current) { clearTimeout(shotTimer.current); shotTimer.current = null }
    setShotConfirm(null)
    setShotRemoving(fileName)
    try {
      const res = await fetch('/api/suggestion-image', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: editing.suggestion_id, fileName }),
      })
      const body = await res.json().catch(() => null) as { error?: string; imageUrls?: string[] } | null
      if (!res.ok) { toast.error(body?.error || '스크린샷을 지우지 못했습니다'); return }
      setExistingImages(body?.imageUrls ?? existingImages.filter(n => n !== fileName))
      await load()
    } catch (e) {
      console.error('[건의] 스크린샷 삭제 실패', { fileName, error: e })
      toast.error('스크린샷을 지우지 못했습니다')
    } finally {
      setShotRemoving(null)
    }
  }

  /** 대기 중인 스크린샷을 올린다. 성공 여부만 돌려준다 — 실패해도 건의 저장은 되돌리지 않는다. */
  const uploadScreenshots = async (suggestionId: number): Promise<boolean> => {
    if (formImages.length === 0) return true
    try {
      const res = await fetch('/api/suggestion-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId, images: formImages.map(i => i.dataUrl) }),
      })
      if (!res.ok) {
        console.error('[건의] 스크린샷 업로드 실패', { suggestionId, status: res.status, body: await res.text() })
        return false
      }
      return true
    } catch (e) {
      console.error('[건의] 스크린샷 업로드 요청 실패', { suggestionId, error: e })
      return false
    }
  }

  /**
   * 알림 라우트 호출. 부가 작업이라 실패해도 저장을 되돌리지 않고 로그만 남긴다.
   * 알림 생성은 service role 라우트가 한다(남의 engineer_id 로 넣는 일이라 화면에서 못 한다).
   * 무엇을 보낼지는 라우트가 DB 를 다시 읽어 정한다 — 여기서 보내는 값은 건 번호와
   * 저장 직전의 상태(답변 유무·이전 상태)뿐이다.
   */
  const postNotify = async (body: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/suggestion-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) console.error('[건의] 알림 실패', { body, status: res.status, text: await res.text() })
    } catch (e) {
      console.error('[건의] 알림 요청 실패', { body, error: e })
    }
  }

  const handleSave = async () => {
    const ok = formErr.validate({
      title: formTitle.trim() ? null : '제목을 입력해주세요',
      content: formContent.trim() ? null : '내용을 입력해주세요',
    })
    if (!ok) return
    if (!engineer?.engineer_id) { toast.error('사용자 정보를 불러오는 중입니다'); return }

    setSaving(true)
    const nowIso = new Date().toISOString()
    // 새로 등록한 건은 알림·스크린샷을 걸어야 해서 두 갈래 모두 suggestion_id 를 돌려받는다.
    const saved = editing
      // 수정 — updated_at 자동 갱신 트리거 유무가 확인되지 않아 앱에서 명시적으로 넣는다.
      ? await supabase.from('suggestions')
          .update({ title: formTitle.trim(), content: formContent.trim(), category: formCategory, updated_at: nowIso })
          .eq('suggestion_id', editing.suggestion_id)
          .select('suggestion_id').single()
      // 상태는 등록과 동시에 「접수」로 시작한다.
      : await supabase.from('suggestions')
          .insert({ engineer_id: engineer.engineer_id, title: formTitle.trim(), content: formContent.trim(), category: formCategory, status: '접수' })
          .select('suggestion_id').single()
    if (saved.error) { setSaving(false); toast.error(saved.error.message); return }

    // 스크린샷은 건의가 저장된 뒤에 올린다(신규는 여기서 처음 suggestion_id 가 나온다).
    const shotsOk = saved.data ? await uploadScreenshots(saved.data.suggestion_id) : true
    setSaving(false)
    if (!editing && saved.data) void postNotify({ action: 'created', suggestionId: saved.data.suggestion_id })
    setFormOpen(false)
    // 목록 갱신이 실패하면 load() 가 원인을 알리므로 성공 안내는 띄우지 않는다.
    const refreshed = await load()
    if (!shotsOk) {
      toast.error(editing
        ? '건의는 저장되었습니다. 스크린샷 업로드에 실패했습니다'
        : '건의는 등록되었습니다. 스크린샷 업로드에 실패했습니다')
      return
    }
    if (refreshed) toast.success(editing ? '수정되었습니다' : '건의사항이 등록되었습니다')
  }

  const handleDelete = async (s: Suggestion) => {
    const ok = await confirmDialog({
      title: '건의사항 삭제',
      message: `'${s.title}'${josa(s.title, '을')} 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
      confirmText: '삭제', variant: 'danger',
    })
    if (!ok) return
    // 스토리지 파일은 행과 함께 사라지지 않는다 — 먼저 치운다.
    if ((s.image_urls ?? []).length > 0) {
      try {
        const res = await fetch('/api/suggestion-image', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ suggestionId: s.suggestion_id, all: true }),
        })
        if (!res.ok) console.error('[건의] 스크린샷 정리 실패 — 고아 파일이 남는다', { id: s.suggestion_id, status: res.status })
      } catch (e) {
        console.error('[건의] 스크린샷 정리 요청 실패', { id: s.suggestion_id, error: e })
      }
    }
    const { error } = await supabase.from('suggestions').delete().eq('suggestion_id', s.suggestion_id)
    if (error) { toast.error(error.message); return }
    setDetail(null)
    if (await load()) toast.success('삭제되었습니다')
  }

  const openDetail = (s: Suggestion) => {
    setDetail(s)
    setReplyText(s.admin_reply ?? '')
    // 「접수」는 선택지에 없다. 아직 접수면 답변과 함께 검토중으로 넘어간다.
    setReplyStatus((ADMIN_STATUSES as readonly string[]).includes(s.status) ? (s.status as Status) : '검토중')
  }

  /** 답변과 상태를 한 번에 저장한다. */
  const handleReplySave = async () => {
    if (!detail || !superAdmin) return
    if (!replyErr.validate({ reply: replyText.trim() ? null : '답변 내용을 입력해주세요' })) return
    setReplySaving(true)
    // 무엇이 바뀌었는지는 저장하고 나면 알 수 없다 — 저장 직전 값을 남겨 라우트에 함께 보낸다.
    const prevHadReply = !!detail.admin_reply
    const prevStatus = detail.status
    const nowIso = new Date().toISOString()
    const { error } = await supabase.from('suggestions').update({
      admin_reply: replyText.trim(),
      status: replyStatus,
      replied_by: engineer?.engineer_id ?? null,
      replied_at: nowIso,
      updated_at: nowIso,
    }).eq('suggestion_id', detail.suggestion_id)
    setReplySaving(false)
    if (error) { toast.error(error.message); return }
    void postNotify({ action: 'replied', suggestionId: detail.suggestion_id, prevHadReply, prevStatus })
    if (await load()) toast.success(detail.admin_reply ? '답변이 저장되었습니다' : '답변이 등록되었습니다')
  }

  const inp: React.CSSProperties = {
    padding: '8px 11px', border: `1px solid ${BORDER}`, borderRadius: 6,
    background: CARD_BG, color: TEXT, fontSize: 13, outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box',
  }
  // 상태·분류 공용 뱃지. 배경은 회색 pill 하나로 통일하고, 상태만 글자색을 달리 한다
  // (분류는 STATUS_TEXT 에 없으므로 기본 GRAY 로 떨어진다).
  const badge = (label: string) => (
    <span style={{ padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: '#f3f4f6', color: STATUS_TEXT[label] ?? GRAY, whiteSpace: 'nowrap' }}>{label}</span>
  )

  const filterLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap' }
  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap',
    background: active ? BLUE : '#f3f4f6', color: active ? '#fff' : TEXT,
  })

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <style>{`
        @keyframes modal-in {
          from { opacity: 0; transform: scale(0.97) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: TEXT, margin: 0, letterSpacing: '-0.3px' }}>건의사항</h1>
          <p style={{ fontSize: 13, color: GRAY, marginTop: 6 }}>개선 요청이나 불편한 점을 남겨주세요. 관리자가 확인 후 답변합니다.</p>
        </div>

        {/* 필터 카드 */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="제목 / 내용 / 작성자 검색" style={{ ...inp, flex: 1, minWidth: 200 }} />
            {STATUS_TABS.map(s => (
              <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }} style={tabBtn(statusFilter === s)}>
                {s}
              </button>
            ))}
            <button onClick={openNew}
              style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', background: BLUE, color: '#fff' }}>
              + 건의사항 작성
            </button>
          </div>

          {/* 분류 필터 — 상태 필터와 AND 로 함께 걸린다 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            <span style={filterLabel}>분류</span>
            {CATEGORY_TABS.map(c => (
              <button key={c} onClick={() => { setCategoryFilter(c); setPage(1) }} style={tabBtn(categoryFilter === c)}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* 목록 */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: MUTED, fontSize: 13 }}>불러오는 중...</div>
          ) : paged.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: MUTED, fontSize: 13 }}>건의사항이 없습니다</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                  {['제목', '분류', '작성자', '상태', '답변', '작성일'].map(h => (
                    <th key={h} style={{ padding: '9px 10px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap', background: '#f8fafc' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map(s => (
                  <tr key={s.suggestion_id} style={{ borderBottom: `1px solid ${BORDER}`, cursor: 'pointer', transition: 'background 0.12s ease' }}
                    onClick={() => openDetail(s)}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <td style={{ padding: '10px 12px', color: TEXT, fontWeight: 600, maxWidth: 460, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.title}
                      {(s.image_urls ?? []).length > 0 && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          style={{ marginLeft: 6, verticalAlign: 'text-bottom' }}>
                          <title>스크린샷 첨부</title>
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>{badge(s.category)}</td>
                    <td style={{ padding: '10px 12px', color: GRAY, whiteSpace: 'nowrap', textAlign: 'center' }}>
                      {s.engineers ? `${s.engineers.name}${s.engineers.position ? ' ' + s.engineers.position : ''}` : '-'}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>{badge(s.status)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {s.admin_reply
                        ? <span style={{ fontSize: 11, fontWeight: 700, color: BLUE }}>답변완료</span>
                        : <span style={{ fontSize: 11, color: MUTED }}>대기</span>}
                    </td>
                    <td style={{ padding: '10px 12px', color: MUTED, whiteSpace: 'nowrap', textAlign: 'center', fontSize: 11 }}>{fmtDate(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 페이징 */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={pageSafe === 1}
              style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${BORDER}`, background: CARD_BG, color: pageSafe === 1 ? MUTED : TEXT, cursor: pageSafe === 1 ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700 }}>이전</button>
            <span style={{ fontSize: 12, color: GRAY }}>{pageSafe} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={pageSafe === totalPages}
              style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${BORDER}`, background: CARD_BG, color: pageSafe === totalPages ? MUTED : TEXT, cursor: pageSafe === totalPages ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700 }}>다음</button>
          </div>
        )}
      </div>

      {/* ── 작성·수정 모달 ── */}
      {formOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 8, padding: 24, width: '100%', maxWidth: 560, boxShadow: '0 20px 60px rgba(0,0,0,0.22)', animation: 'modal-in 0.18s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: TEXT }}>{editing ? '건의사항 수정' : '건의사항 작성'}</div>
              <button onClick={() => setFormOpen(false)} style={{ width: 30, height: 30, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 14, color: GRAY }}>✕</button>
            </div>

            <label style={{ fontSize: 12, fontWeight: 700, color: GRAY, display: 'block', marginBottom: 4 }}>분류</label>
            <select value={formCategory} onChange={e => setFormCategory(e.target.value as Category)}
              style={{ ...inp, width: '100%' }}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <label style={{ fontSize: 12, fontWeight: 700, color: GRAY, display: 'block', margin: '14px 0 4px' }}>제목</label>
            <input value={formTitle} onChange={e => { setFormTitle(e.target.value); formErr.clearError('title') }}
              placeholder="예: 견적서 화면 검색 개선 요청"
              style={{ ...inp, width: '100%', border: formErr.errors.title ? errBorder : `1px solid ${BORDER}` }} />
            <FieldError message={formErr.errors.title} />

            <label style={{ fontSize: 12, fontWeight: 700, color: GRAY, display: 'block', margin: '14px 0 4px' }}>내용</label>
            <textarea value={formContent} onChange={e => { setFormContent(e.target.value); formErr.clearError('content') }}
              rows={8} placeholder="불편한 점이나 개선 아이디어를 자유롭게 적어주세요"
              style={{ ...inp, width: '100%', resize: 'vertical', lineHeight: 1.7, border: formErr.errors.content ? errBorder : `1px solid ${BORDER}` }} />
            <FieldError message={formErr.errors.content} />

            {/* 스크린샷 — 새로 고른 것은 저장할 때 올라가고, 기존 것은 누르는 즉시 지워진다 */}
            <label style={{ fontSize: 12, fontWeight: 700, color: GRAY, display: 'block', margin: '14px 0 4px' }}>
              스크린샷
              <span style={{ marginLeft: 6, fontWeight: 500, color: MUTED }}>
                {existingImages.length + formImages.length} / {MAX_IMAGES}
              </span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => shotInputRef.current?.click()}
                disabled={shotBusy || existingImages.length + formImages.length >= MAX_IMAGES}
                style={{
                  padding: '7px 12px', borderRadius: 6, border: `1px solid ${BORDER}`, background: CARD_BG,
                  color: (shotBusy || existingImages.length + formImages.length >= MAX_IMAGES) ? MUTED : GRAY,
                  fontWeight: 700, fontSize: 12,
                  cursor: (shotBusy || existingImages.length + formImages.length >= MAX_IMAGES) ? 'not-allowed' : 'pointer',
                }}>
                {shotBusy ? '넣는 중...' : '이미지 선택'}
              </button>
              <span style={{ fontSize: 11, color: MUTED }}>캡처 후 Ctrl+V 로 붙여넣을 수 있습니다</span>
            </div>

            {(existingImages.length > 0 || formImages.length > 0) && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                {existingImages.map(name => (
                  <div key={name} style={{ width: 104 }}>
                    <div
                      role="img"
                      aria-label="스크린샷"
                      style={{
                        width: '100%', aspectRatio: '4 / 3', borderRadius: 6, border: `1px solid ${BORDER}`,
                        background: '#f8fafc', backgroundSize: 'cover', backgroundPosition: 'center',
                        backgroundImage: shotUrls[name] ? `url("${shotUrls[name]}")` : undefined,
                      }}
                    />
                    <button type="button" disabled={shotRemoving === name}
                      onClick={() => { if (shotConfirm === name) void removeExistingShot(name); else armShotRemove(name) }}
                      style={{
                        width: '100%', marginTop: 4, padding: '4px 0', borderRadius: 6, border: 'none',
                        cursor: shotRemoving === name ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 11,
                        background: (shotConfirm === name || shotRemoving === name) ? '#dc2626' : '#f3f4f6',
                        color: (shotConfirm === name || shotRemoving === name) ? '#fff' : GRAY,
                      }}>
                      {shotRemoving === name ? '삭제 중...' : shotConfirm === name ? '삭제 확인' : '삭제'}
                    </button>
                  </div>
                ))}
                {formImages.map((img, i) => (
                  <div key={`${img.name}-${i}`} style={{ width: 104 }}>
                    <div
                      role="img"
                      aria-label={img.name}
                      title={img.name}
                      style={{
                        width: '100%', aspectRatio: '4 / 3', borderRadius: 6, border: `1px solid ${BORDER}`,
                        background: '#f8fafc', backgroundSize: 'cover', backgroundPosition: 'center',
                        backgroundImage: `url("${img.dataUrl}")`,
                      }}
                    />
                    <button type="button" onClick={() => setFormImages(prev => prev.filter((_, idx) => idx !== i))}
                      style={{
                        width: '100%', marginTop: 4, padding: '4px 0', borderRadius: 6, border: 'none',
                        cursor: 'pointer', fontWeight: 700, fontSize: 11, background: '#f3f4f6', color: GRAY,
                      }}>
                      제거
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input
              ref={shotInputRef}
              type="file"
              accept={SHOT_ACCEPT}
              multiple
              onChange={e => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                void addScreenshots(files)
              }}
              style={{ display: 'none' }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setFormOpen(false)}
                style={{ padding: '9px 16px', background: '#f3f4f6', color: TEXT, border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>취소</button>
              <button onClick={handleSave} disabled={saving}
                style={{ padding: '9px 18px', background: BLUE, color: '#fff', border: 'none', borderRadius: 6, cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13, opacity: saving ? 0.7 : 1 }}>
                {saving ? '저장 중...' : (editing ? '수정' : '등록')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 상세 모달 ── */}
      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 8, padding: 24, width: '100%', maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.22)', animation: 'modal-in 0.18s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, wordBreak: 'break-all' }}>
                  {detail.title}
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {badge(detail.status)}
                  {badge(detail.category)}
                  <span>{detail.engineers ? `${detail.engineers.name}${detail.engineers.position ? ' ' + detail.engineers.position : ''}` : '-'}</span>
                  <span>·</span>
                  <span>{fmtDateTime(detail.created_at)}</span>
                </div>
              </div>
              <button onClick={() => setDetail(null)} style={{ width: 30, height: 30, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 14, color: GRAY, flexShrink: 0 }}>✕</button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, marginTop: 12 }}>
              <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.8, whiteSpace: 'pre-wrap', padding: '14px 16px', background: '#f8fafc', border: `1px solid ${BORDER}`, borderRadius: 8 }}>
                {detail.content}
              </div>

              {/* 스크린샷 — 누르면 새 탭에서 원본(1시간 서명 URL) */}
              {(detail.image_urls ?? []).length > 0 && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                  {(detail.image_urls ?? []).map(name => (
                    <button
                      key={name}
                      type="button"
                      title="원본 열기"
                      aria-label="스크린샷 원본 열기"
                      disabled={!shotUrls[name]}
                      onClick={() => { const u = shotUrls[name]; if (u) window.open(u, '_blank', 'noopener') }}
                      style={{
                        width: 132, aspectRatio: '4 / 3', padding: 0, borderRadius: 6,
                        border: `1px solid ${BORDER}`, background: '#f8fafc',
                        backgroundSize: 'cover', backgroundPosition: 'center',
                        backgroundImage: shotUrls[name] ? `url("${shotUrls[name]}")` : undefined,
                        cursor: shotUrls[name] ? 'pointer' : 'default',
                      }}
                    />
                  ))}
                </div>
              )}

              {/* 관리자 답변 */}
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 3, height: 14, background: BLUE, borderRadius: 6 }} />
                  <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>관리자 답변</span>
                  {detail.replied_at && <span style={{ fontSize: 11, color: MUTED }}>{fmtDateTime(detail.replied_at)}</span>}
                </div>

                {superAdmin ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: GRAY, fontWeight: 700 }}>상태</span>
                      {ADMIN_STATUSES.map(s => (
                        <button key={s} onClick={() => setReplyStatus(s)}
                          style={{ padding: '4px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 11, background: replyStatus === s ? BLUE : '#f3f4f6', color: replyStatus === s ? '#fff' : TEXT }}>
                          {s}
                        </button>
                      ))}
                    </div>
                    <textarea value={replyText} onChange={e => { setReplyText(e.target.value); replyErr.clearError('reply') }}
                      rows={5} placeholder="답변 내용을 입력하세요"
                      style={{ ...inp, width: '100%', resize: 'vertical', lineHeight: 1.7, border: replyErr.errors.reply ? errBorder : `1px solid ${BORDER}` }} />
                    <FieldError message={replyErr.errors.reply} />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                      <button onClick={handleReplySave} disabled={replySaving}
                        style={{ padding: '7px 16px', background: BLUE, color: '#fff', border: 'none', borderRadius: 6, cursor: replySaving ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 12, opacity: replySaving ? 0.7 : 1 }}>
                        {replySaving ? '저장 중...' : (detail.admin_reply ? '답변 저장' : '답변 등록')}
                      </button>
                    </div>
                  </>
                ) : detail.admin_reply ? (
                  <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.8, whiteSpace: 'pre-wrap', padding: '14px 16px', background: '#f0f4ff', border: '1px solid #c7d7f8', borderRadius: 8 }}>
                    {detail.admin_reply}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: MUTED, padding: '14px 16px', background: '#f8fafc', border: `1px solid ${BORDER}`, borderRadius: 8 }}>
                    아직 답변이 등록되지 않았습니다
                  </div>
                )}
              </div>
            </div>

            {/* 작성자 · 관리자 액션 */}
            {(canEdit(detail) || canDelete(detail)) && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${BORDER}` }}>
                {canEdit(detail) && (
                  <button onClick={() => { const d = detail; setDetail(null); openEdit(d) }}
                    style={{ padding: '8px 14px', background: '#f3f4f6', color: TEXT, border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>수정</button>
                )}
                {canDelete(detail) && (
                  <button onClick={() => handleDelete(detail)}
                    style={{ padding: '8px 14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>삭제</button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
