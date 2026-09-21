'use client'

// 서비스 레포트 첨부파일 UI.
//   ServiceAttachmentEditor — 서비스 수정 모달. 레포트 본체와 첨부를 한 목록에 모아 보여준다.
//   ServiceFilesButton      — 서비스 카드의 「파일 N」 버튼. 레포트 본체와 첨부를 함께 펼친다.
//   AttachmentListBox·AttachmentRow — 추가 모달도 같은 행 모양을 쓰도록 내보낸다.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ServiceAttachment } from './types'
import { useToast } from '@/components/common/Toast'
import {
  ATTACH_ACCEPT, ATTACH_MAX, UPLOAD_TRIES,
  deleteAttachment, openAttachment, uploadAttachments,
} from './attachments'

/** 「삭제」는 두 번 눌러야 실행된다. 요청함·쇼룸과 같은 3초다. */
const CONFIRM_MS = 3000
/** 목록이 길어져도 모달이 밀리지 않도록 여기서 끊고 안에서 스크롤한다. */
const LIST_MAX_HEIGHT = 200

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** 파일명에 쓸 수 없는 문자를 _ 로 바꾼다. 「A/S」 → 「A_S」. */
export function safeFileNamePart(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '_').trim()
}

/**
 * 레포트를 내려받을 때 쓸 이름 — yyyymmdd_업체명_서비스유형_서비스레포트.확장자
 * 스토리지의 실제 파일명(report-<id>-<시각>.pdf)은 한글 문제로 바꾸지 않는다.
 * 대신 서명 URL 의 download 옵션과 화면 표시에 이 이름을 쓴다.
 */
export function reportDownloadName({ visitDate, companyName, serviceType, storedPath }: {
  visitDate: string | null
  companyName: string | null
  serviceType: string | null
  /** 저장된 파일명. 확장자만 가져온다(수정 모달에서 pdf 가 아닌 파일을 올렸을 수 있다). */
  storedPath: string | null
}): string {
  const date = (visitDate ?? '').replace(/-/g, '') || '날짜없음'
  const company = safeFileNamePart(companyName ?? '') || '업체미상'
  const type = safeFileNamePart(serviceType ?? '') || '서비스'
  const m = /\.([A-Za-z0-9]+)$/.exec(storedPath ?? '')
  const ext = m ? m[1].toLowerCase() : 'pdf'
  return `${date}_${company}_${type}_서비스레포트.${ext}`
}

/** 목록 상자 — 테두리 하나로 감싸고 넘치면 안에서만 스크롤한다. */
export function AttachmentListBox({ children, maxHeight = LIST_MAX_HEIGHT }: { children: ReactNode; maxHeight?: number }) {
  return (
    <div style={{
      border: '1px solid #ebebeb', borderRadius: 6, background: '#fff',
      maxHeight, overflowY: 'auto', marginBottom: 8,
    }}>
      {children}
    </div>
  )
}

/**
 * 목록 한 줄. 파일명이 남는 자리를 전부 차지하고 버튼은 오른쪽에 고정된다.
 * 파일명은 길어도 한 줄로 자른다 — 줄바꿈되면 행 높이가 들쭉날쭉해진다.
 * onClick 을 주면 줄 전체가 하나의 버튼이 된다(카드에서 파일을 바로 여는 목록).
 */
export function AttachmentRow({ badge, name, meta, title, actions, divider, onClick }: {
  badge?: string
  name: string
  meta?: string
  title?: string
  actions?: ReactNode
  divider: boolean
  onClick?: () => void
}) {
  const inner = (
    <>
      {badge && (
        <span style={{
          flexShrink: 0, padding: '2px 7px', borderRadius: 99, background: '#f3f4f6',
          fontSize: 11, fontWeight: 700, color: '#6b7280',
        }}>
          {badge}
        </span>
      )}
      <span title={title ?? name} style={{
        flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: '#111827',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {name}
      </span>
      {meta && <span className="num" style={{ flexShrink: 0, fontSize: 11, fontWeight: 500, color: '#9ca3af' }}>{meta}</span>}
      {actions && <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>{actions}</span>}
    </>
  )
  const base: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
    borderBottom: divider ? '1px solid #ebebeb' : 'none',
  }
  if (!onClick) return <div style={base}>{inner}</div>
  return (
    <button type="button" onClick={onClick} style={{
      ...base, width: '100%', boxSizing: 'border-box', textAlign: 'left',
      background: '#fff', border: 'none', borderBottom: base.borderBottom, cursor: 'pointer',
    }}>
      {inner}
    </button>
  )
}

/** 표시 순서 — sort_order 가 같으면 올린 시각 순. 배지 번호도 이 순서를 따른다. */
const byOrder = (a: ServiceAttachment, b: ServiceAttachment) =>
  (a.sort_order - b.sort_order) || a.created_at.localeCompare(b.created_at)

const rowBtn: CSSProperties = {
  border: '1px solid #ebebeb', borderRadius: 6, background: '#fff', color: '#6b7280',
  fontSize: 12, fontWeight: 600, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap',
}
/** 확정 대기 상태의 삭제 버튼 — 요청함·쇼룸과 같은 채운 danger 버튼이다. */
const dangerBtn: CSSProperties = {
  border: 'none', borderRadius: 6, background: '#ef4444', color: '#fff',
  fontSize: 12, fontWeight: 700, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
}
export const footerBtn: CSSProperties = {
  border: '1px solid #ebebeb', borderRadius: 6, background: '#fff', color: '#6b7280',
  fontSize: 13, fontWeight: 600, padding: '7px 12px', cursor: 'pointer',
}

/** 수정 모달이 넘겨주는 레포트 본체. 동작은 모달(훅)이 그대로 맡는다. */
export type ReportSlot = {
  fileName: string
  /** 아직 저장하지 않은 교체 파일이 있을 때의 안내 */
  pending: boolean
  /** 서버에 올라간 레포트가 있을 때만 열 수 있다. */
  canOpen: boolean
  onOpen: () => void
  onReplace: () => void
  onDelete: () => void
}

// ── 수정 모달용 ─────────────────────────────────────────────────────
export function ServiceAttachmentEditor({ serviceId, initial, report, onPickReport, onChanged }: {
  serviceId: number
  initial: ServiceAttachment[]
  /** 레포트 본체가 있거나 교체 파일을 고른 상태일 때만 넘어온다. */
  report: ReportSlot | null
  /** 레포트가 아직 없을 때 파일을 고르게 한다. */
  onPickReport: () => void
  /** 올리거나 지운 직후 부른다 — 뒤쪽 화면이 바로 따라오게. */
  onChanged?: () => void
}) {
  const toast = useToast()
  const [list, setList] = useState<ServiceAttachment[]>(initial)
  /** 0 = 업로드 중 아님. 1 이상이면 그 번째 시도 중이다. */
  const [attempt, setAttempt] = useState(0)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearConfirm = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setConfirmId(null)
  }

  // 다른 곳을 클릭하면 확정 대기를 푼다. 버튼 자신의 클릭은 다음 틱부터 듣게 해 빠뜨리지 않는다.
  // (요청함 app/requests/page.tsx·쇼룸 UsageList 와 같은 방식이다.)
  useEffect(() => {
    if (confirmId == null) return
    const off = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } setConfirmId(null) }
    const id = setTimeout(() => document.addEventListener('click', off), 0)
    return () => { clearTimeout(id); document.removeEventListener('click', off) }
  }, [confirmId])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const uploading = attempt > 0

  const handlePick = async (files: File[]) => {
    if (files.length === 0) return
    if (list.length + files.length > ATTACH_MAX) {
      toast.error(`첨부파일은 ${ATTACH_MAX}개까지 올릴 수 있습니다.`)
      return
    }
    setAttempt(1)
    // 콜드 스타트로 처음 몇 번이 실패해도 여기서 다시 건다(2초 간격, 최대 3회).
    const r = await uploadAttachments(serviceId, files, a => setAttempt(a))
    setAttempt(0)
    if (!r.ok) { toast.error(r.error); return }
    setList(prev => [...prev, ...r.attachments])
    onChanged?.()
    toast.success(`첨부파일 ${r.attachments.length}개를 올렸습니다`)
  }

  const handleOpen = async (a: ServiceAttachment) => {
    const r = await openAttachment(a.attachment_id)
    if (!r.ok) toast.error(r.error)
  }

  const handleDelete = async (a: ServiceAttachment) => {
    clearConfirm()
    setDeletingId(a.attachment_id)
    const r = await deleteAttachment(a.attachment_id)
    setDeletingId(null)
    if (!r.ok) { toast.error(r.error); return }
    setList(prev => prev.filter(x => x.attachment_id !== a.attachment_id))
    onChanged?.()
    toast.success('첨부파일을 삭제했습니다')
  }

  const armConfirm = (id: number) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setConfirmId(id)
    timerRef.current = setTimeout(() => { timerRef.current = null; setConfirmId(null) }, CONFIRM_MS)
  }

  const full = list.length >= ATTACH_MAX
  const rows = [...list].sort(byOrder)
  const lastIndex = rows.length - 1

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>서비스 레포트 및 첨부파일</span>
        <span className="num" style={{ fontSize: 12, color: '#9ca3af' }}>첨부 {list.length} / {ATTACH_MAX}</span>
      </div>

      {(report || list.length > 0) && (
        <AttachmentListBox>
          {/* 레포트 본체 — 맨 위 한 줄. 동작은 기존 그대로다(열기·교체·삭제 모두 모달이 맡는다). */}
          {report && (
            <AttachmentRow
              badge="레포트"
              name={report.fileName}
              meta={report.pending ? '저장 시 교체' : undefined}
              actions={
                <>
                  {report.canOpen && <button type="button" onClick={report.onOpen} style={rowBtn}>열기</button>}
                  <button type="button" onClick={report.onReplace} style={rowBtn}>교체</button>
                  <button type="button" onClick={report.onDelete} style={{ ...rowBtn, color: '#9ca3af' }}>삭제</button>
                </>
              }
              divider={list.length > 0}
            />
          )}

          {rows.map((a, i) => {
            const armed = confirmId === a.attachment_id
            const busy = deletingId === a.attachment_id
            return (
              <AttachmentRow
                key={a.attachment_id}
                badge={`첨부 ${i + 1}`}
                name={a.file_name}
                meta={formatBytes(a.byte_size)}
                title={`${a.file_name}${a.engineers ? ` · ${a.engineers.name} ${a.engineers.position ?? ''}`.trimEnd() : ''}`}
                actions={
                  <>
                    <button type="button" onClick={() => handleOpen(a)} style={rowBtn}>열기</button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => { if (armed) void handleDelete(a); else armConfirm(a.attachment_id) }}
                      style={armed || busy
                        ? { ...dangerBtn, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }
                        : { ...rowBtn, color: '#9ca3af' }}
                    >
                      {busy ? '삭제 중...' : armed ? '삭제 확인' : '삭제'}
                    </button>
                  </>
                }
                divider={i < lastIndex}
              />
            )
          })}
        </AttachmentListBox>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || full}
          style={{ ...footerBtn, color: (uploading || full) ? '#d1d5db' : '#6b7280', cursor: (uploading || full) ? 'default' : 'pointer' }}
        >
          {uploading ? `올리는 중... (${attempt}/${UPLOAD_TRIES})` : full ? '최대 10개' : '첨부 추가'}
        </button>
        {!report && (
          <button type="button" onClick={onPickReport} style={footerBtn}>레포트 파일 선택</button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACH_ACCEPT}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          void handlePick(files)
        }}
        style={{ display: 'none' }}
      />
    </div>
  )
}

// ── 서비스 카드용 ───────────────────────────────────────────────────
/** 카드 목록의 최대 높이. 모달(200)보다 낮게 잡아 카드가 길어지지 않게 한다. */
const CARD_LIST_MAX_HEIGHT = 160

/** 카드에서 여는 레포트 본체. 여는 동작은 카드가 맡는다(서명 URL 경로 그대로). */
export type CardReport = { fileName: string; busy: boolean; onOpen: () => void }

/**
 * 「파일 N」 하나로 레포트 본체와 첨부를 함께 연다.
 * 좁은 카드에 버튼을 여러 개 두면 이름이 밀리므로 한 개로 합쳤다. 0 건이면 버튼이 나오지 않는다.
 * 목록이 버튼과 같은 줄에 끼어 옆 버튼을 밀어내지 않도록, 버튼 줄 전체를 이 컴포넌트가 들고 있다
 * (trailing 은 그 줄의 오른쪽에 함께 놓을 버튼 — 「레포트 작성」).
 */
export function ServiceFilesButton({ attachments, report, trailing }: {
  attachments: ServiceAttachment[]
  report: CardReport | null
  trailing?: ReactNode
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)

  const count = (report ? 1 : 0) + attachments.length
  const rows = [...attachments].sort(byOrder)

  const handleOpen = async (a: ServiceAttachment) => {
    const r = await openAttachment(a.attachment_id)
    if (!r.ok) toast.error(r.error)
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginTop: 8 }}>
        {count > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}
            style={{
              padding: '4px 10px', background: '#fff', color: '#111827',
              borderRadius: 6, border: '1px solid #ebebeb', cursor: 'pointer',
              fontWeight: 600, fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >
            파일 {count} {open ? '▲' : '▼'}
          </button>
        )}
        {trailing}
      </div>

      {count > 0 && open && (
        <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
          <AttachmentListBox maxHeight={CARD_LIST_MAX_HEIGHT}>
            {report && (
              <AttachmentRow
                badge="레포트"
                name={report.busy ? '여는 중…' : report.fileName}
                divider={attachments.length > 0}
                onClick={report.busy ? undefined : report.onOpen}
              />
            )}
            {rows.map((a, i) => (
              <AttachmentRow
                key={a.attachment_id}
                badge={`첨부 ${i + 1}`}
                name={a.file_name}
                meta={formatBytes(a.byte_size)}
                divider={i < attachments.length - 1}
                onClick={() => { void handleOpen(a) }}
              />
            ))}
          </AttachmentListBox>
        </div>
      )}
    </>
  )
}