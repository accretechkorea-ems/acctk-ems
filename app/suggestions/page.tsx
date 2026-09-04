'use client'

// 건의사항 게시판 — 로그인 사용자 전원 열람/작성, superadmin 이 답변·상태 변경.
// RLS 가 전원 허용이므로 본인 글 판정·삭제 제한은 이 화면에서 처리한다.

import React, { useEffect, useState } from 'react'
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
  engineers?: { name: string; position: string | null } | null
}

const fmtDate = (s: string | null) => (s ? s.slice(0, 10) : '-')
const fmtDateTime = (s: string | null) => (s ? s.slice(0, 16).replace('T', ' ') : '-')
// created_at 과 updated_at 은 초 단위까지 같지 않을 수 있어 1초 이상 차이날 때만 수정으로 본다.
const isEdited = (s: Suggestion) => new Date(s.updated_at).getTime() - new Date(s.created_at).getTime() > 1000

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

  // 상세 모달
  const [detail, setDetail] = useState<Suggestion | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyStatus, setReplyStatus] = useState<Status>('접수')
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
  const canEdit = (s: Suggestion) => isMine(s) || superAdmin
  // 답변이 달린 글은 작성자가 지울 수 없다(관리자 답변까지 사라지므로). superadmin 은 항상 가능.
  const canDelete = (s: Suggestion) => superAdmin || (isMine(s) && !s.admin_reply)

  const asCategory = (v: string): Category =>
    (CATEGORIES as readonly string[]).includes(v) ? (v as Category) : '기타'

  const openNew = () => {
    setEditing(null); setFormTitle(''); setFormContent(''); setFormCategory('기타'); setFormOpen(true)
  }
  const openEdit = (s: Suggestion) => {
    setEditing(s); setFormTitle(s.title); setFormContent(s.content); setFormCategory(asCategory(s.category)); setFormOpen(true)
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
    const { error } = editing
      // 수정 — updated_at 자동 갱신 트리거 유무가 확인되지 않아 앱에서 명시적으로 넣는다.
      ? await supabase.from('suggestions')
          .update({ title: formTitle.trim(), content: formContent.trim(), category: formCategory, updated_at: nowIso })
          .eq('suggestion_id', editing.suggestion_id)
      : await supabase.from('suggestions')
          .insert({ engineer_id: engineer.engineer_id, title: formTitle.trim(), content: formContent.trim(), category: formCategory })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    setFormOpen(false)
    // 목록 갱신이 실패하면 load() 가 원인을 알리므로 성공 안내는 띄우지 않는다.
    if (await load()) toast.success(editing ? '수정되었습니다' : '건의사항이 등록되었습니다')
  }

  const handleDelete = async (s: Suggestion) => {
    const ok = await confirmDialog({
      title: '건의사항 삭제',
      message: `'${s.title}'${josa(s.title, '을')} 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
      confirmText: '삭제', variant: 'danger',
    })
    if (!ok) return
    const { error } = await supabase.from('suggestions').delete().eq('suggestion_id', s.suggestion_id)
    if (error) { toast.error(error.message); return }
    setDetail(null)
    if (await load()) toast.success('삭제되었습니다')
  }

  const openDetail = (s: Suggestion) => {
    setDetail(s)
    setReplyText(s.admin_reply ?? '')
    setReplyStatus((STATUSES as readonly string[]).includes(s.status) ? (s.status as Status) : '접수')
  }

  const handleReplySave = async () => {
    if (!detail || !superAdmin) return
    if (!replyErr.validate({ reply: replyText.trim() ? null : '답변 내용을 입력해주세요' })) return
    setReplySaving(true)
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
    if (await load()) toast.success('답변이 저장되었습니다')
  }

  // 답변 없이 상태만 바꾸는 경우(예: 검토중으로만 이동)
  const handleStatusOnly = async (next: Status) => {
    if (!detail || !superAdmin) return
    setReplyStatus(next)
    const { error } = await supabase.from('suggestions')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('suggestion_id', detail.suggestion_id)
    if (error) { toast.error(error.message); return }
    await load()
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
                      {isEdited(s) && <span style={{ marginLeft: 6, fontSize: 11, color: MUTED, fontWeight: 500 }}>(수정됨)</span>}
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
                  {isEdited(detail) && <span style={{ marginLeft: 6, fontSize: 11, color: MUTED, fontWeight: 500 }}>(수정됨)</span>}
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
                      {STATUSES.map(s => (
                        <button key={s} onClick={() => handleStatusOnly(s)}
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
                        {replySaving ? '저장 중...' : (detail.admin_reply ? '답변 수정' : '답변 등록')}
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
