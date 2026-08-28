'use client'

// 장비 홀딩 등록·상세 모달.
//   holding === null → 등록 (제목 / 시작일 / 최초 메모)
//   holding 있음     → 상세 (제목 수정 · 경과 타임라인 + 메모 추가 · 해제)
//
// 경과 타임라인은 네 가지를 시간순으로 섞는다.
//   · 홀딩 등록/해제 — 홀딩 자체의 시작·끝(해제 사유 포함)
//   · 메모          — 방문 없이 생긴 진전(본사 회신, 입고 예정일 등). 쓴 사람이 고칠 수 있다.
//   · 서비스 레포트  — 그 장비를 홀딩 기간에 방문한 기록. 읽기 전용이고 정본은 레포트 PDF 다.
// 재방문 내용을 레포트와 메모에 두 번 적지 않게 하려는 것이 목적이다.

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { elapsedLabel, todayStr, type HoldingReport } from '../holding'
import type { Holding, HoldingForm, HoldingNote, ServiceHistory } from '../types'

type Props = {
  isOpen: boolean
  holding: Holding | null
  // 등록 모드에서 보여줄 대상 정보
  targetDeviceName: string
  linkedService: ServiceHistory | null
  isSaving: boolean
  onClose: () => void
  onCreate: (form: HoldingForm) => void
  // 제목과 시작일은 한 번에 저장한다(저장 버튼을 둘로 나누지 않기 위해)
  onUpdateHolding: (h: Holding, title: string, startedAt: string) => void
  onAddNote: (holdingId: number, content: string) => void
  onRequestResolve: (h: Holding) => void
  // 해제 취소 · 삭제 (권한 판정은 호출부가 넘긴다)
  onReopen?: (h: Holding) => void
  canDelete?: boolean
  onDeleteHolding?: (h: Holding) => void
  // 상세 타임라인에 함께 그릴 서비스 레포트(자동 수집)
  reports?: HoldingReport[]
  reportsLoading?: boolean
  onOpenReport?: (r: HoldingReport) => void
  // 메모 수정·삭제 (권한 판정은 호출부가 넘긴다)
  canEditNote?: (n: HoldingNote) => boolean
  onUpdateNote?: (noteId: number, content: string) => void
  onDeleteNote?: (noteId: number) => void
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: 6,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}
const dateFieldStyle: CSSProperties = { ...fieldStyle, colorScheme: 'light' }
const areaStyle: CSSProperties = { ...fieldStyle, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }


// 타임라인 한 줄. 종류가 달라도 같은 모양으로 그린다.
type Row =
  | { kind: '등록' | '해제'; key: string; date: string; body: string; who: string }
  | { kind: '메모'; key: string; date: string; body: string; who: string; note: HoldingNote }
  | { kind: '레포트'; key: string; date: string; body: string; who: string; report: HoldingReport }

// 같은 날짜면 등록 → 메모·레포트 → 해제 순으로 둔다.
const KIND_RANK: Record<Row['kind'], number> = { '등록': 0, '메모': 1, '레포트': 1, '해제': 2 }
const KIND_LABEL: Record<Row['kind'], string> = { '등록': '홀딩 등록', '메모': '메모', '레포트': '서비스 레포트', '해제': '홀딩 해제' }

function TimelineRow({
  row, first, editing, canEdit, isSaving,
  onOpenReport, onStartEdit, onChangeEdit, onCancelEdit, onSaveEdit, onDelete,
}: {
  row: Row; first: boolean; editing: string | null; canEdit: boolean; isSaving: boolean
  onOpenReport?: () => void
  onStartEdit?: () => void
  onChangeEdit: (v: string) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const showTools = canEdit && editing === null && (hovered || false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderTop: first ? 'none' : '1px solid #ebebeb',
        padding: '9px 2px', position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap', minWidth: 76 }}>{row.date || '-'}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: row.kind === '레포트' ? '#234ea2' : '#6b7280', whiteSpace: 'nowrap' }}>
          {KIND_LABEL[row.kind]}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {showTools && (
            <>
              <button onClick={onStartEdit} title="수정" aria-label="메모 수정"
                style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'inline-flex' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#234ea2' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button onClick={onDelete} title="삭제" aria-label="메모 삭제"
                style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'inline-flex' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#ef4444' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" />
                </svg>
              </button>
            </>
          )}
          <span style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.who}</span>
        </span>
      </div>

      {editing !== null ? (
        <div style={{ marginTop: 6 }}>
          <textarea value={editing} rows={3} onChange={e => onChangeEdit(e.target.value)}
            style={{ width: '100%', padding: '9px 10px', border: '1px solid #ebebeb', borderRadius: 6, boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 13, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
            <button onClick={onCancelEdit}
              style={{ padding: '6px 12px', background: '#f3f4f6', color: '#6b7280', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>취소</button>
            <button onClick={onSaveEdit} disabled={isSaving || !editing.trim()}
              style={{ padding: '6px 12px', background: '#234ea2', color: '#fff', border: 'none', borderRadius: 6, cursor: editing.trim() ? 'pointer' : 'default', fontSize: 12, fontWeight: 700, opacity: editing.trim() ? 1 : 0.5 }}>저장</button>
          </div>
        </div>
      ) : onOpenReport ? (
        <button onClick={onOpenReport} title="레포트 열기"
          onMouseEnter={e => { e.currentTarget.style.color = '#234ea2' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#6b7280' }}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: 0, marginTop: 3, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#6b7280', whiteSpace: 'pre-wrap', wordBreak: 'break-word', transition: 'color 0.15s ease' }}>
          {row.body}
        </button>
      ) : (
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{row.body}</div>
      )}
    </div>
  )
}

export default function HoldingModal({
  isOpen, holding, targetDeviceName, linkedService, isSaving,
  onClose, onCreate, onUpdateHolding, onAddNote, onRequestResolve,
  onReopen, canDelete = false, onDeleteHolding,
  reports = [], reportsLoading = false, onOpenReport,
  canEditNote, onUpdateNote, onDeleteNote,
}: Props) {
  const [form, setForm] = useState<HoldingForm>({ title: '', started_at: todayStr(), first_note: '' })
  const [titleEdit, setTitleEdit] = useState('')
  const [startedEdit, setStartedEdit] = useState('')
  const [note, setNote] = useState('')
  // 인라인 수정 중인 메모 (null = 없음)
  const [editingNote, setEditingNote] = useState<{ id: number; content: string } | null>(null)
  const { errors, setErrors, clearError, validate } = useFieldErrors<'title'>()

  useEffect(() => {
    if (!isOpen) return
    setErrors({})
    setForm({ title: '', started_at: todayStr(), first_note: '' })
    setTitleEdit(holding?.title ?? '')
    setStartedEdit(holding?.started_at ?? '')
    setNote('')
    setEditingNote(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, holding])

  const notes = [...(holding?.holding_notes ?? [])].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
  const done = !!holding?.resolved_at
  // 제목·시작일 중 하나라도 바뀌었을 때만 저장을 연다
  const dirty = !!holding && (titleEdit.trim() !== holding.title || startedEdit !== holding.started_at)

  // 등록 · 메모 · 레포트 · 해제를 한 줄기로. 날짜만 비교하므로(레포트는 방문일뿐 시각이 없다)
  // 같은 날짜는 KIND_RANK 로 순서를 고정해 조회할 때마다 뒤바뀌지 않게 한다.
  const rows = useMemo<Row[]>(() => {
    if (!holding) return []
    const out: Row[] = [{
      kind: '등록', key: 'start', date: holding.started_at,
      body: holding.title, who: holding.engineers?.name ?? '-',
    }]
    for (const n of notes) {
      out.push({
        kind: '메모', key: `note-${n.note_id}`, date: n.created_at.slice(0, 10),
        body: n.content, who: n.engineers?.name ?? '-', note: n,
      })
    }
    for (const r of reports) {
      out.push({
        kind: '레포트', key: `report-${r.service_id}`, date: r.visit_date ?? '',
        body: [r.service_type, r.service_notes].map(v => v?.trim()).filter(Boolean).join(' · ') || '-',
        who: r.engineerNames || '-', report: r,
      })
    }
    if (holding.resolved_at) {
      out.push({
        kind: '해제', key: 'end', date: holding.resolved_at,
        body: holding.resolved_note?.trim() || '홀딩을 해제했습니다', who: '',
      })
    }
    return out.sort((a, b) =>
      a.date === b.date
        ? KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.key.localeCompare(b.key)
        : (a.date < b.date ? -1 : 1)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding, reports, holding?.holding_notes])

  if (!isOpen) return null

  const handleCreate = () => {
    if (!validate({ title: form.title.trim() ? null : '제목을 입력해주세요' })) return
    onCreate(form)
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520, maxHeight: '88vh', background: '#ffffff', borderRadius: 8,
          padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: '1px solid #ebebeb',
          animation: 'modal-in 0.18s ease', display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 18, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', letterSpacing: '-0.3px' }}>
              {holding ? '홀딩' : '홀딩 등록'}
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span>{holding ? (holding.devices?.device_name ?? '-') : targetDeviceName}</span>
              {holding && (
                <>
                  <span style={{ color: '#d1d5db' }}>·</span>
                  <span style={{ fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px', fontSize: 11 }}>
                    {done ? '해제됨' : '진행 중'}
                  </span>
                  <span>{elapsedLabel(holding)}</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            title="닫기"
            onMouseEnter={(e) => (e.currentTarget.style.color = '#111827')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#6b7280')}
            style={{ width: 28, height: 28, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', transition: 'color 0.15s ease', flexShrink: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, display: 'grid', gap: 14 }}>
          {/* ── 등록 모드 ── */}
          {!holding && (
            <>
              <div>
                <label style={labelStyle}>제목 *</label>
                <input value={form.title}
                  onChange={(e) => { setForm(p => ({ ...p, title: e.target.value })); clearError('title') }}
                  placeholder="예: 본사 부품 의뢰 대기"
                  style={errors.title ? { ...fieldStyle, border: errBorder } : fieldStyle} />
                <FieldError message={errors.title} />
              </div>
              <div>
                <label style={labelStyle}>시작일</label>
                <input type="date" value={form.started_at}
                  onChange={(e) => setForm(p => ({ ...p, started_at: e.target.value }))}
                  style={dateFieldStyle} />
              </div>
              <div>
                <label style={labelStyle}>최초 메모</label>
                <textarea value={form.first_note} rows={4}
                  onChange={(e) => setForm(p => ({ ...p, first_note: e.target.value }))}
                  placeholder="지금 상황을 적어두면 나중에 경과를 따라가기 쉽습니다 (선택)"
                  style={areaStyle} />
              </div>
              {linkedService && (
                <div style={{ padding: '10px 12px', background: '#f8fafc', border: '1px solid #ebebeb', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>연결되는 서비스 레포트</div>
                  <div style={{ fontSize: 12, color: '#111827' }}>
                    {linkedService.service_type ?? '-'}
                    <span style={{ color: '#d1d5db' }}> · </span>
                    {linkedService.visit_date ?? '-'}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── 상세 모드 ── */}
          {holding && (
            <>
              {/* 제목·시작일 — 저장은 하나로 묶는다 */}
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={labelStyle}>제목</label>
                    <input value={titleEdit} onChange={(e) => setTitleEdit(e.target.value)} style={fieldStyle} />
                  </div>
                  <div style={{ width: 150, flexShrink: 0 }}>
                    <label style={labelStyle}>시작일</label>
                    <input type="date" value={startedEdit} onChange={(e) => setStartedEdit(e.target.value)} style={dateFieldStyle} />
                  </div>
                  <button
                    onClick={() => onUpdateHolding(holding, titleEdit, startedEdit)}
                    disabled={isSaving || !dirty}
                    style={{
                      padding: '11px 14px', background: '#f3f4f6', border: 'none', borderRadius: 6,
                      cursor: dirty ? 'pointer' : 'default',
                      fontSize: 12, fontWeight: 700, color: '#6b7280', flexShrink: 0,
                      opacity: dirty ? 1 : 0.5,
                    }}
                  >저장</button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
                {holding.resolved_at && (
                  <span style={{ color: '#9ca3af' }}>해제 <span style={{ color: '#111827', fontWeight: 600 }}>{holding.resolved_at}</span></span>
                )}
                <span style={{ color: '#9ca3af' }}>등록 <span style={{ color: '#111827', fontWeight: 600 }}>{holding.engineers?.name ?? '-'}</span></span>
              </div>



              {/* 경과 — 등록 · 메모 · 서비스 레포트 · 해제를 시간순으로 */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>경과</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px' }}>{rows.length}건</span>
                  {reportsLoading && <span style={{ fontSize: 11, color: '#9ca3af' }}>레포트 불러오는 중...</span>}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 10 }}>
                  {rows.map((r, i) => (
                    <TimelineRow
                      key={r.key}
                      row={r}
                      first={i === 0}
                      editing={r.kind === '메모' && editingNote?.id === r.note.note_id ? editingNote.content : null}
                      canEdit={r.kind === '메모' && !!canEditNote?.(r.note)}
                      isSaving={isSaving}
                      onOpenReport={r.kind === '레포트' && r.report.report_url && onOpenReport ? () => onOpenReport(r.report) : undefined}
                      onStartEdit={r.kind === '메모' ? () => setEditingNote({ id: r.note.note_id, content: r.note.content }) : undefined}
                      onChangeEdit={v => setEditingNote(prev => (prev ? { ...prev, content: v } : prev))}
                      onCancelEdit={() => setEditingNote(null)}
                      onSaveEdit={() => { if (editingNote) { onUpdateNote?.(editingNote.id, editingNote.content); setEditingNote(null) } }}
                      onDelete={r.kind === '메모' && onDeleteNote ? () => onDeleteNote(r.note.note_id) : undefined}
                    />
                  ))}
                </div>

                <textarea value={note} rows={3}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="본사 회신, 부품 입고 예정일 등 방문 외 진행 상황을 적어주세요 (방문 기록은 서비스 레포트가 자동으로 올라옵니다)"
                  style={areaStyle} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                  <button
                    onClick={() => { onAddNote(holding.holding_id, note); setNote('') }}
                    disabled={isSaving || !note.trim()}
                    style={{
                      padding: '7px 14px', background: '#234ea2', color: '#fff', border: 'none', borderRadius: 6,
                      cursor: note.trim() ? 'pointer' : 'default', fontSize: 12, fontWeight: 700,
                      opacity: note.trim() ? 1 : 0.5,
                    }}
                  >메모 추가</button>
                </div>
              </div>

            </>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 18, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {holding && (done
              ? onReopen && (
                <button
                  onClick={() => onReopen(holding)}
                  style={{ padding: '9px 14px', background: '#fff', color: '#6b7280', borderRadius: 6, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
                >해제 취소</button>
              )
              : (
                <button
                  onClick={() => onRequestResolve(holding)}
                  style={{ padding: '9px 14px', background: '#fff', color: '#6b7280', borderRadius: 6, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
                >홀딩 해제</button>
              ))}
            {holding && canDelete && onDeleteHolding && (
              <button
                onClick={() => onDeleteHolding(holding)}
                disabled={isSaving}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af' }}
                style={{ padding: '9px 6px', background: 'none', color: '#9ca3af', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, transition: 'color 0.15s ease' }}
              >삭제</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose}
              style={{ padding: '9px 16px', background: '#fff', color: '#6b7280', borderRadius: 6, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >닫기</button>
            {!holding && (
              <button onClick={handleCreate} disabled={isSaving}
                onMouseEnter={(e) => { if (!isSaving) e.currentTarget.style.background = '#1c3e87' }}
                onMouseLeave={(e) => { if (!isSaving) e.currentTarget.style.background = '#234ea2' }}
                style={{ padding: '9px 18px', background: '#234ea2', color: '#fff', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isSaving ? 0.6 : 1, transition: 'background 0.15s ease' }}>
                {isSaving ? '저장 중...' : '등록'}
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalOverlay>
  )
}
