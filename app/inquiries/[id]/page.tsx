'use client'

// 의뢰서 상세 — 보기 + 업체명·담당자·발행일·상태 수정 + 취소 + 내용 기록.
//
// 고치는 자리는 두 곳이고 방식이 같다: 평소에는 읽기 전용으로 보여 주고, 오른쪽 위의
// 수정 아이콘을 누르면 그 자리에서 입력으로 바뀌며, 바뀐 칸이 있을 때만 저장이 켜진다.
//   · 정보 카드 — 업체명·담당자·발행일·상태를 한 번에 저장한다.
//   · 내용 기록 카드 — 날짜·본문·추가 파일. 모달을 띄우지 않는다(고칠 대상을 보면서 고친다).
// 「내용 추가」만 모달이다 — 새로 만드는 일이라 고칠 대상이 화면에 없다.
//
// 교신 기록은 본사와 오간 문답을 날짜순으로 쌓아 보여 준다. 한 건 = 보냄/받음 + 날짜 +
// 내용 + 첨부 여러 개. 읽기는 브라우저가 직접(RLS), 쓰기는 /api/inquiry(교신)와
// /api/inquiry-attachment(파일)가 맡는다.
//
// 레일은 두지 않는다. 목록(/inquiries)이 레일을 갖고, 여기는 한 건만 보는 자리다.
// 그래도 메인 사이드바는 접힌 채다 — lib/railPaths.ts 의 RAIL_PATHS 가 하위 경로까지 보기 때문이다.
//
// 읽기는 브라우저 supabase 클라이언트가 직접 한다(RLS inquiries_select).
// 쓰기(수정·취소)는 전부 /api/inquiry 를 거친다 — inquiries 에는 쓰기 정책이 없다.
//
// 취소는 두 갈래로 끝난다. 어느 쪽인지는 서버(DB 함수 cancel_inquiry)가 판정한다.
//   released  — 마지막 번호라 반환했다. 행이 지워졌으므로 이 화면은 더 존재하지 않는다 → 목록으로.
//   abandoned — 뒤에 이미 다른 번호가 나가 버렸다. 취소 상태로 남는다 → 그대로 다시 읽는다.
// 화면은 어느 쪽인지 미리 단정하지 않는다.

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import SegmentedControl from '@/components/common/SegmentedControl'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/common/Toast'
import ModalOverlay from '@/components/common/ModalOverlay'
import FilePicker, { failText, sizeText, uploadFiles } from '@/components/inquiry/files'
import {
  PAGE_BG, CARD_BG, BORDER, TEXT, MUTED, SUB, NEUTRAL_BG, BLUE,
  cardStyle, cardHeader, cardTitle, btnPrimary, btnGhost, btnDanger,
} from '@/components/common/ui'
import { todayKST } from '@/lib/date'
import { engineerLabel, isCurrentlyEmployed } from '@/lib/engineers'
import { errorInfo } from '@/lib/errorInfo'
import {
  EDITABLE_STATUSES, INQUIRY_STATUS_DOT, INQUIRY_TYPE_LABEL,
  inquiryStatusLabel, type InquiryType,
} from '@/lib/inquiries'

const TITLE_MAX = 200

/** 내용 기록 본문 길이 상한. 서버(/api/inquiry 의 BODY_MAX)와 같은 값이어야 한다. */
const BODY_MAX = 20000

/** 내용 기록의 입력 칸 — 추가 모달과 카드 편집이 같은 모양을 쓴다. */
const msgField: React.CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: TEXT, background: CARD_BG, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
}
const msgLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5, display: 'block',
}

/** 상세에서 고치는 칸 — 목록 모달의 입력과 같은 모양이다. 폭을 묶어 줄이 흔들리지 않게 한다. */
const editStyle: React.CSSProperties = {
  width: '100%', maxWidth: 320, padding: '8px 10px', border: `1px solid ${BORDER}`,
  borderRadius: 6, fontSize: 13, color: TEXT, background: CARD_BG,
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}

/** 취소 확인 문구 — 어느 쪽으로 끝날지 단정하지 않는다. 판정은 서버가 한다. */
const CANCEL_MESSAGE =
  '이 번호가 마지막으로 발급된 번호이면 반환되어 다음 작성 때 다시 쓰입니다. '
  + '이후 번호가 이미 발급됐다면 취소 상태로 남고 다시 쓰이지 않습니다.'

type Detail = {
  id: string
  inquiry_no: string
  inquiry_type: string
  equipment_series: string | null
  title: string | null
  status: string
  issued_date: string
  cancelled_at: string | null
  created_by: number | null
  engineers: { name: string | null; position: string | null } | null
}

/** 담당자 고르기 — 목록 화면과 같은 모양(engineer_id·name·position·resigned_date). */
type PickEngineer = { engineer_id: number; name: string | null; position: string | null; resigned_date: string | null }

// 목록과 같은 이유로 제약 이름을 명시한다(engineers 를 여러 번 참조하게 될 표다).
const SELECT_COLUMNS =
  'id, inquiry_no, inquiry_type, equipment_series, title, status, issued_date, cancelled_at, created_by,'
  + ' engineers!inquiries_created_by_fkey(name, position)'

const dateText = (ymd: string | null): string => (ymd ? ymd.replace(/-/g, '.') : '')

/** timestamptz → 'YYYY.MM.DD HH:mm'(KST). 취소 시각은 분까지 보이면 충분하다. */
const stampText = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  const kst = new Date(d.getTime() + 9 * 3600_000)
  return `${kst.getUTCFullYear()}.${p(kst.getUTCMonth() + 1)}.${p(kst.getUTCDate())}`
    + ` ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`
}

// ── 교신 기록 ───────────────────────────────────────────────────────


/** 본문이 이보다 길면 접어 둔다(글자 수). */
const FOLD_AT = 400

type Attachment = {
  id: number
  message_id: number
  file_name: string
  byte_size: number | null
  sort_order: number
}

type Message = {
  id: number
  direction: string
  entry_date: string
  body: string
  created_by: number | null
  engineers: { name: string | null; position: string | null } | null
}

// 목록과 같은 이유로 제약 이름을 명시한다(engineers 를 여러 번 참조하게 될 표다).
const MESSAGE_COLUMNS =
  'id, direction, entry_date, body, created_by, engineers!inquiry_messages_created_by_fkey(name, position)'

const DIRECTION_LABEL: Record<string, string> = { sent: '보냄', received: '받음' }

/** 방향 뱃지 색 — 기존 토큰만 쓴다. 보냄은 액센트, 받음은 중립. */
const directionTone = (d: string) =>
  d === 'sent' ? { bg: '#eff4ff', fg: BLUE } : { bg: NEUTRAL_BG, fg: SUB }

/**
 * 수정 아이콘 버튼.
 *
 * 고객사 정보 패널(components/customer/CustomerInfoPanel.tsx:38)의 것과 같은 모양이다 —
 * 같은 뜻의 버튼이 화면마다 달라 보이지 않게 치수·색·hover 를 그대로 가져왔다.
 * lucide 의 square-pen 을 인라인 SVG 로 둔다(lucide-react 는 설치되어 있지 않다).
 */
function EditIconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick} aria-label={label} title={label}
      onMouseEnter={e => { e.currentTarget.style.borderColor = BLUE; e.currentTarget.style.color = BLUE }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = MUTED }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6, flexShrink: 0,
        background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6,
        cursor: 'pointer', color: MUTED, transition: 'border-color 0.15s ease, color 0.15s ease',
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    </button>
  )
}

/**
 * 편집 중인 카드가 부모에게서 받는 한 벌.
 *
 * 값과 동작을 전부 부모가 들고 있다. 편집은 한 번에 한 카드만 열리고, 다른 카드로 옮길 때
 * 「저장하지 않은 변경을 버리겠는가」를 물어야 하는데, 그 판단(dirty)이 카드 안에 있으면
 * 부모가 물을 수 없다. 그래서 초안과 버튼 동작을 통째로 내려 준다.
 */
type MsgEditBox = {
  date: string
  setDate: (v: string) => void
  body: string
  setBody: (v: string) => void
  /** 새로 올릴 파일(아직 서버에 없다). 이미 올라간 첨부는 msg 쪽 files 로 온다. */
  files: File[]
  setFiles: (v: File[]) => void
  /** 원본과 다른 곳이 있는가. 없으면 저장 버튼이 꺼진다. */
  dirty: boolean
  busy: boolean
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  onDeleteFile: (a: Attachment) => void
}

/**
 * 교신 한 건.
 *
 * 보기 모드에서는 본문이 길면 접어 두고, 첨부는 눌러서 내려받는다. 머리 줄 오른쪽 끝의
 * 수정 아이콘 하나만 눌리며, 그것도 적은 사람과 superadmin 에게만 보인다(서버도 같은 기준).
 *
 * 편집은 모달을 띄우지 않고 이 카드 자리에서 한다 — 고칠 대상이 바로 위에 보이는 채로
 * 고치는 편이 낫고, 첨부를 하나씩 지우는 일은 목록을 눈으로 보면서 해야 한다.
 *
 * 본문이 빈 기록(파일만 남긴 경우)은 컴팩트하게 그린다 — 본문 영역과 그 여백을 아예 없애
 * 첨부 줄이 머리 줄 바로 아래에 붙는다.
 */
function MessageCard({
  msg, files, canEdit, readOnly, edit, onStartEdit, onOpenFile,
}: {
  msg: Message
  files: Attachment[]
  canEdit: boolean
  /** 취소된 의뢰서 — 수정 아이콘을 감춘다. */
  readOnly: boolean
  /** null 이면 보기 모드. 값이 있으면 이 카드가 편집 중이다. */
  edit: MsgEditBox | null
  onStartEdit: (m: Message) => void
  onOpenFile: (a: Attachment) => void
}) {
  const [open, setOpen] = useState(false)
  const tone = directionTone(msg.direction)
  const long = msg.body.length > FOLD_AT
  const shown = long && !open ? msg.body.slice(0, FOLD_AT) : msg.body
  const editable = canEdit && !readOnly
  const hasBody = msg.body.trim().length > 0

  return (
    <div style={{ ...cardStyle, marginBottom: 8 }}>
      {/* 머리 줄 — 방향·날짜·작성자, 오른쪽 끝에 수정 아이콘 하나뿐이다. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
          background: tone.bg, color: tone.fg, flexShrink: 0,
        }}>
          {DIRECTION_LABEL[msg.direction] ?? msg.direction}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{dateText(msg.entry_date)}</span>
        <span style={{ fontSize: 12, color: MUTED }}>{engineerLabel(msg.engineers) || '-'}</span>
        {editable && !edit && (
          <span style={{ marginLeft: 'auto', display: 'flex', flexShrink: 0 }}>
            <EditIconButton label="이 내용 기록 수정" onClick={() => onStartEdit(msg)} />
          </span>
        )}
      </div>

      {edit ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={msgLabel} htmlFor={`me-date-${msg.id}`}>날짜</label>
              <input
                id={`me-date-${msg.id}`} type="date" value={edit.date} disabled={edit.busy}
                onChange={e => edit.setDate(e.target.value)}
                style={{ ...msgField, colorScheme: 'light' }}
              />
            </div>
            <div>
              {/* 방향은 고치지 않는다 — 바꾸면 첨부의 맥락까지 뒤집힌다(서버도 막는다). */}
              <label style={msgLabel}>방향</label>
              <div style={{ ...msgField, background: NEUTRAL_BG, color: SUB }}>
                {DIRECTION_LABEL[msg.direction] ?? msg.direction}
              </div>
            </div>
          </div>

          <label style={msgLabel} htmlFor={`me-body-${msg.id}`}>내용</label>
          <textarea
            id={`me-body-${msg.id}`} value={edit.body} rows={7} maxLength={BODY_MAX} disabled={edit.busy}
            onChange={e => edit.setBody(e.target.value)}
            style={{ ...msgField, resize: 'vertical', lineHeight: 1.6, marginBottom: 10 }}
          />

          {files.length > 0 && (
            <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {files.map(a => (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  border: `1px solid ${BORDER}`, borderRadius: 6, background: CARD_BG, padding: '6px 10px',
                }}>
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 12, color: TEXT,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {a.file_name}
                  </span>
                  <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{sizeText(a.byte_size)}</span>
                  {/* 확인 창을 거친 즉시 삭제다. 「삭제 대기」 표시를 두지 않는다 —
                      저장을 누르지 않아도 이미 지워졌다는 사실이 화면에 그대로 보여야 한다. */}
                  <button
                    type="button" disabled={edit.busy} onClick={() => edit.onDeleteFile(a)}
                    aria-label={`${a.file_name} 삭제`}
                    style={{
                      border: 'none', background: 'transparent', cursor: edit.busy ? 'not-allowed' : 'pointer',
                      color: MUTED, fontSize: 12, padding: 0, flexShrink: 0, fontFamily: 'inherit',
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginBottom: 10 }}>
            <FilePicker compact label="파일 추가" files={edit.files} onChange={edit.setFiles} disabled={edit.busy} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* 삭제는 왼쪽 끝이다 — 저장·취소와 멀리 떼어 놓아 잘못 누르지 않게 한다. */}
            <button
              type="button" onClick={edit.onDelete} disabled={edit.busy}
              style={{
                border: 'none', background: 'transparent', padding: 0,
                color: '#be123c', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                cursor: edit.busy ? 'not-allowed' : 'pointer',
              }}
            >
              이 내용 기록 삭제
            </button>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
              <button type="button" onClick={edit.onCancel} disabled={edit.busy} style={btnGhost(edit.busy)}>
                취소
              </button>
              <button
                type="button" onClick={edit.onSave} disabled={edit.busy || !edit.dirty}
                style={btnPrimary(edit.busy || !edit.dirty)}
              >
                {edit.busy ? '저장 중...' : '저장'}
              </button>
            </span>
          </div>
        </div>
      ) : (
        <>
          {hasBody && (
            <div style={{
              fontSize: 13, color: TEXT, lineHeight: 1.7, marginTop: 10,
              // 줄바꿈을 그대로 살린다 — 메일 본문을 붙여 넣는 자리다.
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {shown}{long && !open && '…'}
              {long && (
                <button type="button" onClick={() => setOpen(v => !v)}
                  style={{
                    display: 'block', marginTop: 6, border: 'none', background: 'transparent', padding: 0,
                    color: BLUE, fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  {open ? '접기' : '더 보기'}
                </button>
              )}
            </div>
          )}

          {files.length > 0 && (
            // 본문이 없으면 여백을 줄여 머리 줄 바로 아래에 붙인다(컴팩트 카드).
            <div style={{ marginTop: hasBody ? 10 : 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {files.map(a => (
                <button
                  key={a.id} type="button" onClick={() => onOpenFile(a)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    border: `1px solid ${BORDER}`, borderRadius: 6, background: CARD_BG,
                    padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                  }}
                >
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 12, color: BLUE, fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {a.file_name}
                  </span>
                  <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{sizeText(a.byte_size)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * 내용 추가 모달.
 *
 * 수정은 여기서 하지 않는다 — 카드 제자리에서 한다(MessageCard). 이 모달은 새로 남기는
 * 한 가지 일만 한다: 방향·날짜·내용·파일을 받아 교신을 만들고 파일을 이어 올린다.
 *
 * 본문은 비워도 된다. 받은 파일만 붙여 두는 기록이 실제로 많다. 다만 본문도 파일도 없는
 * 빈 기록은 막는다 — 서버는 교신을 만드는 시점에 파일이 아직 없어 이 판정을 할 수 없으므로
 * 화면에서만 막는다.
 */
function MessageModal({
  inquiryId, onClose, onSaved,
}: {
  inquiryId: string
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [direction, setDirection] = useState('sent')
  const [entryDate, setEntryDate] = useState(todayKST())
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const ready = text.trim().length > 0 || files.length > 0

  const submit = async () => {
    if (busy) return
    if (!ready) { setError('내용이나 파일 중 하나는 있어야 합니다.'); return }
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'message_add', inquiry_id: inquiryId, direction, entry_date: entryDate, body: text,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error || `저장하지 못했습니다 (HTTP ${res.status})`); return }

      // 교신은 이미 저장됐으므로 파일이 막혀도 되돌리지 않는다 — 어느 파일이 왜 막혔는지
      // 알려 주고, 카드의 수정 아이콘으로 다시 올릴 수 있게 한다.
      if (files.length > 0) {
        const messageId = Number(json?.message?.id)
        if (Number.isInteger(messageId)) {
          const failed = await uploadFiles(messageId, files)
          if (failed.length > 0) {
            toast.error(`내용은 저장했지만 파일을 올리지 못했습니다\n${failText(failed)}`)
            onSaved()
            onClose()
            return
          }
        }
      }
      toast.success('내용 기록을 남겼습니다')
      onSaved()
      onClose()
    } catch (e) {
      console.error('[inquiries] 교신 저장 실패', errorInfo(e))
      setError('저장하지 못했습니다. 잠시 뒤 다시 시도해주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{
        background: CARD_BG, borderRadius: 8, padding: '14px 16px', width: '100%', maxWidth: 520,
        maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
      }}>
        <div style={cardHeader}>
          <span style={cardTitle}>내용 추가</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={msgLabel} htmlFor="ms-dir">방향</label>
            <select id="ms-dir" value={direction} onChange={e => setDirection(e.target.value)} style={msgField}>
              <option value="sent">보냄</option>
              <option value="received">받음</option>
            </select>
          </div>
          <div>
            <label style={msgLabel} htmlFor="ms-date">날짜</label>
            <input id="ms-date" type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
              style={{ ...msgField, colorScheme: 'light' }} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={msgLabel} htmlFor="ms-body">
            내용 <span style={{ fontWeight: 500 }}>(파일만 올려도 됩니다)</span>
          </label>
          <textarea
            id="ms-body" value={text} rows={7} maxLength={BODY_MAX}
            placeholder="메일 본문이나 메모를 붙여 넣으세요"
            onChange={e => setText(e.target.value)}
            style={{ ...msgField, resize: 'vertical', lineHeight: 1.6 }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={msgLabel}>첨부 파일</label>
          <FilePicker files={files} onChange={setFiles} disabled={busy} />
        </div>

        {error && (
          <div style={{
            fontSize: 12, lineHeight: 1.6, color: '#be123c', background: '#fef2f2',
            border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px', marginBottom: 12,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ ...btnGhost(), flex: 1 }}>닫기</button>
          <button type="button" onClick={submit} disabled={busy || !ready}
            style={{ ...btnPrimary(busy || !ready), flex: 1 }}>
            {busy ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
/** 「이름 : 값」 한 줄. 값이 없으면 부르는 쪽이 아예 그리지 않는다. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '9px 0', borderTop: `1px solid ${BORDER}` }}>
      <span style={{ width: 96, flexShrink: 0, fontSize: 12, fontWeight: 700, color: MUTED }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: TEXT, lineHeight: 1.6 }}>{children}</span>
    </div>
  )
}

export default function InquiryDetailPage() {
  const { loading: guardLoading, authorized } = usePageGuard()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = typeof params?.id === 'string' ? params.id : ''
  const toast = useToast()
  const confirmDialog = useConfirm()

  const [row, setRow] = useState<Detail | null>(null)
  // null = 아직 읽는 중, 'gone' = 없다(처음부터 없거나 반환되어 지워졌다)
  const [state, setState] = useState<'loading' | 'ready' | 'gone'>('loading')
  const [title, setTitle] = useState('')
  const [ownerId, setOwnerId] = useState<number | ''>('')
  const [issuedDate, setIssuedDate] = useState('')
  const [engineerList, setEngineerList] = useState<PickEngineer[]>([])
  const [status, setStatus] = useState('')
  /** 정보 카드가 편집 모드인가. 평소에는 읽기 전용으로 보여 준다. */
  const [infoEdit, setInfoEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  // 내용 기록.
  const [messages, setMessages] = useState<Message[]>([])
  const [files, setFiles] = useState<Attachment[]>([])
  /** 「내용 추가」 모달이 열려 있는가. */
  const [msgOpen, setMsgOpen] = useState(false)
  /**
   * 제자리 편집 — 한 번에 한 카드만이다. 초안을 부모가 들고 있어야
   * 다른 카드로 옮길 때 「버리겠는가」를 물을 수 있다(MsgEditBox 머리말 참고).
   */
  const [editId, setEditId] = useState<number | null>(null)
  const [draftDate, setDraftDate] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftFiles, setDraftFiles] = useState<File[]>([])
  const [msgBusy, setMsgBusy] = useState(false)
  const [myId, setMyId] = useState<number | null>(null)
  const [amAdmin, setAmAdmin] = useState(false)

  const load = useCallback(async () => {
    if (!id) { setState('gone'); return }
    const supabase = createClient()
    const { data, error } = await supabase.from('inquiries').select(SELECT_COLUMNS).eq('id', id).maybeSingle()
    if (error) {
      console.error('[inquiries] 상세 조회 실패', { id, error })
      setState('gone')
      return
    }
    if (!data) { setState('gone'); return }
    const d = data as unknown as Detail
    setRow(d)
    // 고치는 칸은 읽어 온 값으로 되돌린다 — 저장 뒤 다시 읽을 때도 같은 자리를 지난다.
    setTitle(d.title ?? '')
    setOwnerId(d.created_by ?? '')
    setIssuedDate(d.issued_date)
    setStatus(d.status)
    setState('ready')
  }, [id])

  /**
   * 교신과 첨부를 함께 읽는다. 정렬은 entry_date · id 오름차순 — 오래된 것이 위,
   * 새 교신이 아래에 쌓인다(메일 스레드와 같은 방향).
   */
  const loadThread = useCallback(async () => {
    if (!id) return
    const supabase = createClient()
    const [{ data: msgs, error: mErr }, { data: atts, error: aErr }] = await Promise.all([
      supabase.from('inquiry_messages').select(MESSAGE_COLUMNS)
        .eq('inquiry_id', id).order('entry_date', { ascending: true }).order('id', { ascending: true }),
      supabase.from('inquiry_attachments').select('id, message_id, file_name, byte_size, sort_order')
        .eq('inquiry_id', id).order('sort_order', { ascending: true }),
    ])
    if (mErr || aErr) {
      console.error('[inquiries] 교신 조회 실패', { id, mErr, aErr })
      return
    }
    setMessages((msgs ?? []) as unknown as Message[])
    setFiles((atts ?? []) as Attachment[])
  }, [id])

  // 나를 확인한다 — 교신 수정·삭제 버튼을 누구에게 보일지 정하는 데 쓴다.
  // 서버도 같은 기준으로 다시 막으므로 이 값은 화면 표시용일 뿐이다.
  // 담당자 고르기에 쓸 직원 목록도 여기서 같이 읽는다(목록 화면과 같은 칸).
  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    const loadMe = async () => {
      const supabase = createClient()
      const [{ data: auth }, { data: engs }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('engineers').select('engineer_id, name, position, resigned_date').order('engineer_id'),
      ])
      if (cancelled) return
      setEngineerList((engs ?? []) as PickEngineer[])
      const email = auth?.user?.email
      if (!email) return
      const { data: me } = await supabase
        .from('engineers').select('engineer_id, permission_level').eq('email', email).maybeSingle()
      if (cancelled || !me) return
      const m = me as { engineer_id: number; permission_level: string | null }
      setMyId(m.engineer_id)
      setAmAdmin(m.permission_level === 'superadmin')
    }
    loadMe()
    return () => { cancelled = true }
  }, [authorized])

  useEffect(() => { if (authorized) { load(); loadThread() } }, [authorized, load, loadThread])

  const cancelled = row?.status === 'cancelled'
  const today = todayKST()

  // 새 배정은 재직자만. 다만 지금 담당자는 퇴사했어도 남겨 둔다 —
  // 목록에 없으면 select 가 빈 칸으로 보여, 고칠 생각이 없어도 바꾸게 된다.
  const ownerOptions = engineerList.filter(
    e => isCurrentlyEmployed(e.resigned_date, today) || e.engineer_id === row?.created_by,
  )

  // 읽어 온 값과 다른 칸만 모은다. 하나도 없으면 저장 버튼이 꺼진다.
  // 상태도 여기에 들어간다 — 예전에는 고르는 즉시 저장했는데, 한 카드 안에서 어떤 칸은
  // 즉시 저장되고 어떤 칸은 버튼을 눌러야 하는 것이 헷갈렸다.
  const edited: { title?: string; created_by?: number; issued_date?: string; status?: string } = {}
  if (row) {
    if (title.trim() !== (row.title ?? '').trim()) edited.title = title.trim()
    if (ownerId !== '' && ownerId !== row.created_by) edited.created_by = ownerId
    if (issuedDate && issuedDate !== row.issued_date) edited.issued_date = issuedDate
    if (status && status !== row.status) edited.status = status
  }
  const dirty = Object.keys(edited).length > 0

  /** 취소된 건에서는 편집 모드로 들어가지 않는다(수정 아이콘도 숨긴다). */
  const infoEditing = infoEdit && !cancelled

  /**
   * 「취소하기」는 담당자 본인과 superadmin 에게만 보인다(서버도 같은 기준으로 막는다 —
   * app/api/inquiry/route.ts 의 cancel). row.created_by 를 보므로, 담당자를 바꿔 저장하면
   * 곧바로 다시 읽어 새 담당자 기준이 된다.
   */
  const canCancel = !cancelled && (amAdmin || (myId != null && row?.created_by === myId))

  /** 편집 중인 카드. 목록을 다시 읽어도 같은 id 를 따라간다. */
  const editingMsg = editId === null ? null : messages.find(m => m.id === editId) ?? null

  /**
   * 원본과 다른 곳이 있는가. 날짜·본문이 달라졌거나, 올릴 파일을 골랐으면 변경이다.
   * 첨부 개별 삭제는 확인 즉시 서버에 반영되므로 여기에 넣지 않는다 — 저장할 것이 없다.
   */
  const msgDirty = editingMsg !== null && (
    draftDate !== editingMsg.entry_date
    || draftBody !== editingMsg.body
    || draftFiles.length > 0
  )

  /**
   * 바뀐 칸만 보낸다. 취소된 건은 서버도 조건부 UPDATE 로 막지만 화면에서도 잠근다.
   *
   * 칸마다 저장 버튼을 두지 않는다 — 업체명·담당자·발행일은 대개 같이 고치는데,
   * 버튼이 셋이면 세 번 눌러야 하고 어디까지 저장됐는지도 흐려진다.
   */
  const save = async (patch: {
    title?: string; status?: string; created_by?: number; issued_date?: string
  }) => {
    if (Object.keys(patch).length === 0) return
    if (!row || cancelled || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: row.id, ...patch }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error || `저장하지 못했습니다 (${res.status})`); return }
      toast.success('저장했습니다')
      setInfoEdit(false)
      await load()
    } catch (e) {
      console.error('[inquiries] 저장 실패', e)
      toast.error('저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const cancelInquiry = async () => {
    if (!row || cancelled || busy) return
    const ok = await confirmDialog({
      title: '의뢰서 취소',
      message: CANCEL_MESSAGE,
      confirmText: '취소하기',
      variant: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', id: row.id }),
      })
      // 본문이 JSON 이 아니면 null 이다 — 빈 객체({})로 만들면 「사유가 없다」와
      // 「JSON 이 아니다」가 구분되지 않는다. 그 구분이 곧 무엇을 고쳐야 하는지다.
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        // 서버가 준 error 를 그대로 보여준다. 예전에는 이 자리에서 사유를 버려
        // 「취소하지 못했습니다」만 떴고, DB 에 함수가 없다는 사실조차 알 수 없었다.
        const reason = typeof json?.error === 'string' && json.error
          ? json.error
          : json === null
            ? `서버가 JSON 이 아닌 응답을 보냈습니다 (HTTP ${res.status})`
            : `알 수 없는 오류 (HTTP ${res.status})`
        console.error('[inquiries] 취소 실패', { status: res.status, jsonBody: json !== null, body: json })
        toast.error(`취소하지 못했습니다 — ${reason}`)
        return
      }
      if (!json) { toast.error('취소 결과를 읽지 못했습니다. 목록에서 상태를 확인해주세요.'); return }

      const no = json.inquiryNo ?? row.inquiry_no
      // 파일 정리가 실패해도 취소 자체는 끝났다. 성공 문구에 덧붙여 알린다
      // — 조용히 넘기면 버킷에 고아 파일이 남은 것을 아무도 모른다.
      const warn = typeof json.storageWarning === 'string' && json.storageWarning
        ? `\n${json.storageWarning}`
        : ''
      if (json.outcome === 'released') {
        toast.success(`번호 ${no}가 반환되었습니다. 다음 새 작성 때 다시 쓰입니다.${warn}`)
        // 행이 지워졌다 — 이 주소에는 더 볼 것이 없다.
        router.replace('/inquiries')
        return
      }
      if (json.outcome === 'abandoned') {
        // 버림이 된 이유는 둘이다(뒤에 다른 번호가 이미 나갔거나, 소급 등록 건이거나).
        // 서버는 어느 쪽인지 알려주지 않으므로 이유를 단정하지 않는다.
        toast.success(`취소되었습니다. ${no}는 재사용되지 않습니다.${warn}`)
      } else if (json.outcome === 'already_cancelled') {
        toast.error('이미 취소된 의뢰서입니다')
      }
      await load()
    } catch (e) {
      console.error('[inquiries] 취소 실패', errorInfo(e))
      toast.error(`취소하지 못했습니다 — ${e instanceof Error ? e.message : '네트워크 오류'}`)
    } finally {
      setBusy(false)
    }
  }

  /** 정보 카드 편집을 접는다. 고친 것이 있으면 버릴지 먼저 묻는다. */
  const cancelInfoEdit = async () => {
    if (dirty) {
      const ok = await confirmDialog({
        title: '저장하지 않은 변경',
        message: '고친 내용을 버릴까요?',
        confirmText: '버리기',
        variant: 'danger',
      })
      if (!ok) return
    }
    // 초안을 읽어 온 값으로 되돌린다 — 다시 열었을 때 지난 편집이 남아 있으면 안 된다.
    if (row) {
      setTitle(row.title ?? '')
      setOwnerId(row.created_by ?? '')
      setIssuedDate(row.issued_date)
      setStatus(row.status)
    }
    setInfoEdit(false)
  }

  const closeMsgEdit = () => { setEditId(null); setDraftFiles([]) }

  /** 카드를 편집 모드로 연다. 다른 카드에 고친 것이 남아 있으면 먼저 묻는다. */
  const startEditMessage = async (m: Message) => {
    if (editId !== null && editId !== m.id && msgDirty) {
      const ok = await confirmDialog({
        title: '저장하지 않은 변경',
        message: '고친 내용을 버리고 다른 기록을 열까요?',
        confirmText: '버리고 열기',
        variant: 'danger',
      })
      if (!ok) return
    }
    setEditId(m.id)
    setDraftDate(m.entry_date)
    setDraftBody(m.body)
    setDraftFiles([])
  }

  const cancelEditMessage = async () => {
    if (msgDirty) {
      const ok = await confirmDialog({
        title: '저장하지 않은 변경',
        message: '고친 내용을 버릴까요?',
        confirmText: '버리기',
        variant: 'danger',
      })
      if (!ok) return
    }
    closeMsgEdit()
  }

  /**
   * 편집 내용을 저장한다 — 바뀐 칸만 message_update 로 보내고, 고른 파일을 이어 올린다.
   *
   * 파일이 일부 막히면 편집 모드를 유지하고 실패한 파일만 남긴다. 같은 자리에서 다시
   * 누르면 되게 하려는 것이다 — 모달이었을 때는 창이 닫혀 어디서 다시 올릴지 찾아야 했다.
   */
  const saveMessage = async () => {
    const m = editingMsg
    if (!m || msgBusy || !msgDirty) return
    setMsgBusy(true)
    try {
      const patch: { entry_date?: string; body?: string } = {}
      if (draftDate !== m.entry_date) patch.entry_date = draftDate
      if (draftBody !== m.body) patch.body = draftBody
      if (Object.keys(patch).length > 0) {
        const res = await fetch('/api/inquiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'message_update', id: m.id, ...patch }),
        })
        const json = await res.json().catch(() => null)
        if (!res.ok) { toast.error(json?.error || `저장하지 못했습니다 (HTTP ${res.status})`); return }
      }
      const failed = draftFiles.length > 0 ? await uploadFiles(m.id, draftFiles) : []
      await loadThread()
      if (failed.length > 0) {
        // 올라간 파일은 이미 목록에 보인다. 실패한 것만 남겨 두고 편집 모드를 지킨다.
        setDraftFiles(draftFiles.filter(f => failed.some(x => x.name === f.name)))
        toast.error(`올리지 못한 파일\n${failText(failed)}`)
        return
      }
      toast.success('내용 기록을 고쳤습니다')
      closeMsgEdit()
    } catch (e) {
      console.error('[inquiries] 내용 기록 저장 실패', errorInfo(e))
      toast.error('저장하지 못했습니다. 잠시 뒤 다시 시도해주세요.')
    } finally {
      setMsgBusy(false)
    }
  }

  /**
   * 첨부 하나만 지운다 — 확인 창을 거친 즉시 서버에 반영된다(되돌릴 수 없다).
   * 저장 버튼과 묶지 않는다: 「지웠는데 저장을 안 눌러서 살아 있는」 상태를 만들지 않으려는 것이다.
   */
  const deleteFile = async (a: Attachment) => {
    const ok = await confirmDialog({
      title: '첨부 파일 삭제',
      message: `${a.file_name} 을 지웁니다. 되돌릴 수 없습니다.`,
      confirmText: '삭제',
      variant: 'danger',
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/inquiry-attachment?attachmentId=${a.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { toast.error(json?.error || `지우지 못했습니다 (HTTP ${res.status})`); return }
      toast.success('첨부 파일을 지웠습니다')
      await loadThread()
    } catch (e) {
      console.error('[inquiries] 첨부 삭제 실패', errorInfo(e))
      toast.error('지우지 못했습니다.')
    }
  }

  /** 교신 삭제 — 되돌릴 수 없어 확인을 받는다. 첨부 파일도 함께 사라진다. */
  const deleteMessage = async (m: Message) => {
    const n = files.filter(f => f.message_id === m.id).length
    const ok = await confirmDialog({
      title: '내용 기록 삭제',
      message: n > 0
        ? `이 내용과 첨부 파일 ${n}개가 함께 지워집니다. 되돌릴 수 없습니다.`
        : '이 내용 기록을 지웁니다. 되돌릴 수 없습니다.',
      confirmText: '삭제',
      variant: 'danger',
    })
    if (!ok) return
    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'message_delete', id: m.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error || `지우지 못했습니다 (${res.status})`); return }
      toast.success('내용 기록을 지웠습니다')
      // 지운 카드가 열려 있었으면 편집 모드도 함께 닫는다.
      if (editId === m.id) closeMsgEdit()
      await loadThread()
    } catch (e) {
      console.error('[inquiries] 교신 삭제 실패', e)
      toast.error('지우지 못했습니다.')
    }
  }

  /** 첨부 내려받기 — 서명 URL 을 받아 새 창으로 연다(Content-Disposition 이 attachment 다). */
  const openFile = async (a: Attachment) => {
    try {
      const res = await fetch(`/api/inquiry-attachment?attachmentId=${a.id}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.signedUrl) { toast.error(json.error || '파일을 열 수 없습니다.'); return }
      window.open(json.signedUrl, '_blank', 'noopener')
    } catch (e) {
      console.error('[inquiries] 파일 열기 실패', e)
      toast.error('파일을 열 수 없습니다.')
    }
  }

  const copy = async () => {
    if (!row) return
    try {
      await navigator.clipboard.writeText(row.inquiry_no)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('복사하지 못했습니다. 번호를 직접 선택해 복사해주세요')
    }
  }

  if (!authorized) return <AccessGate loading={guardLoading} />

  const back = (
    <button
      type="button"
      onClick={() => router.push('/inquiries')}
      style={{
        border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 0 12px',
        fontSize: 13, fontWeight: 700, color: SUB, fontFamily: 'inherit',
      }}
    >
      ← 목록
    </button>
  )

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        {back}

        {state === 'loading' ? (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: MUTED, fontSize: 13 }}>불러오는 중...</div>
        ) : state === 'gone' || !row ? (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: MUTED, fontSize: 13, lineHeight: 1.7 }}>
            찾을 수 없습니다<br />
            <span style={{ fontSize: 12 }}>취소되어 번호가 반환된 의뢰서일 수 있습니다.</span>
          </div>
        ) : (
          <div style={cardStyle}>
            <div style={cardHeader}>
              <span style={cardTitle}>{INQUIRY_TYPE_LABEL[row.inquiry_type as InquiryType] ?? row.inquiry_type}</span>
              {canCancel && (
                <button
                  type="button" onClick={cancelInquiry} disabled={busy}
                  style={{ ...btnDanger(busy), marginLeft: 'auto' }}
                >
                  취소하기
                </button>
              )}
            </div>

            {/* 번호 — 사람이 받아 적는 값이라 크게. 취소된 건은 취소선을 긋는다. */}
            <div style={{
              background: NEUTRAL_BG, borderRadius: 8, padding: '16px', display: 'flex',
              alignItems: 'center', gap: 12,
            }}>
              <span style={{
                flex: 1, minWidth: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px',
                color: cancelled ? MUTED : BLUE, wordBreak: 'break-all',
                textDecoration: cancelled ? 'line-through' : 'none',
              }}>
                {row.inquiry_no}
              </span>
              <button type="button" onClick={copy} style={{ ...btnGhost(), flexShrink: 0 }}>
                {copied ? '복사했습니다' : '번호 복사'}
              </button>
            </div>

            {cancelled && (
              <div style={{
                marginTop: 12, fontSize: 12, lineHeight: 1.7, color: MUTED,
                background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px',
              }}>
                취소된 의뢰서입니다. 번호는 재사용되지 않으며 내용을 고칠 수 없습니다.
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              {/* 수정 아이콘은 정보 영역의 오른쪽 위다. 헤더의 「취소하기」와 나란히 두지 않는다
                  — 되돌릴 수 없는 동작과 일상적인 수정이 한 줄에 있으면 잘못 누른다. */}
              {!cancelled && !infoEditing && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <EditIconButton label="의뢰서 정보 수정" onClick={() => setInfoEdit(true)} />
                </div>
              )}

              {row.equipment_series && <Field label="장비 계열">{row.equipment_series}</Field>}

              <Field label="업체명">
                {infoEditing ? (
                  <input
                    value={title} maxLength={TITLE_MAX} placeholder="업체명을 입력하세요"
                    onChange={e => setTitle(e.target.value)} style={editStyle}
                  />
                ) : (
                  <span style={{ color: row.title?.trim() ? TEXT : MUTED }}>
                    {row.title?.trim() || '(업체명 없음)'}
                  </span>
                )}
              </Field>

              <Field label="담당자">
                {infoEditing ? (
                  <select
                    value={ownerId} style={editStyle}
                    onChange={e => setOwnerId(e.target.value ? Number(e.target.value) : '')}
                  >
                    {/* 담당자 없는 의뢰서는 만들지 않는다 — 값이 들어간 뒤에는 빈 칸을 고를 수 없다. */}
                    {ownerId === '' && <option value="">고르기</option>}
                    {ownerOptions.map(e => (
                      <option key={e.engineer_id} value={e.engineer_id}>{engineerLabel(e)}</option>
                    ))}
                  </select>
                ) : (
                  engineerLabel(row.engineers) || '-'
                )}
              </Field>

              <Field label="발행일">
                {infoEditing ? (
                  <>
                    <input
                      type="date" value={issuedDate} onChange={e => setIssuedDate(e.target.value)}
                      style={{ ...editStyle, colorScheme: 'light' }}
                    />
                    {/* 80 스페어파츠만 번호에 발행일이 박혀 있다(001-K260929). 번호는 이미 바깥에
                        나간 값이라 다시 만들지 않는다 — 날짜만 고치면 둘이 어긋나므로 미리 알린다. */}
                    {row.inquiry_type === 'spare80' && (
                      <span style={{ display: 'block', fontSize: 11, color: MUTED, lineHeight: 1.6, marginTop: 4 }}>
                        번호의 날짜 부분은 바뀌지 않습니다.
                      </span>
                    )}
                  </>
                ) : dateText(row.issued_date)}
              </Field>

              {cancelled && row.cancelled_at && <Field label="취소 시각">{stampText(row.cancelled_at)}</Field>}

              <Field label="상태">
                {infoEditing ? (
                  <SegmentedControl
                    options={EDITABLE_STATUSES.map(v => ({ label: inquiryStatusLabel(v), value: v }))}
                    value={status}
                    onChange={setStatus}
                  />
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: SUB }}>
                    <span style={{
                      width: 9, height: 9, borderRadius: '50%',
                      background: INQUIRY_STATUS_DOT[row.status] ?? '#d1d5db',
                    }} />
                    {inquiryStatusLabel(row.status)}
                  </span>
                )}
              </Field>

              {/* 저장 버튼은 하나다 — 업체명·담당자·발행일·상태를 한 번에 보낸다. */}
              {infoEditing && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12 }}>
                  <button type="button" onClick={cancelInfoEdit} disabled={busy} style={btnGhost(busy)}>
                    취소
                  </button>
                  <button
                    type="button" onClick={() => save(edited)} disabled={busy || !dirty}
                    style={btnPrimary(busy || !dirty)}
                  >
                    {busy ? '저장 중...' : '저장'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 교신 기록 — 본사와 오간 문답. 취소된 의뢰서에서는 읽기 전용이다. */}
        {state === 'ready' && row && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ ...cardTitle, fontSize: 17 }}>내용 기록</span>
              {messages.length > 0 && (
                <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>{messages.length}건</span>
              )}
              {!cancelled && (
                <button
                  type="button"
                  onClick={() => setMsgOpen(true)}
                  style={{ ...btnPrimary(), marginLeft: 'auto' }}
                >
                  내용 추가
                </button>
              )}
            </div>

            {messages.length === 0 ? (
              <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: MUTED, fontSize: 13, lineHeight: 1.7 }}>
                아직 내용 기록이 없습니다<br />
                <span style={{ fontSize: 12 }}>본사와 주고받은 메일과 파일을 여기에 남깁니다.</span>
              </div>
            ) : (
              messages.map(m => (
                <MessageCard
                  key={m.id}
                  msg={m}
                  files={files.filter(f => f.message_id === m.id)}
                  canEdit={amAdmin || (myId != null && m.created_by === myId)}
                  readOnly={cancelled}
                  edit={editId === m.id ? {
                    date: draftDate, setDate: setDraftDate,
                    body: draftBody, setBody: setDraftBody,
                    files: draftFiles, setFiles: setDraftFiles,
                    dirty: msgDirty, busy: msgBusy,
                    onSave: saveMessage,
                    onCancel: cancelEditMessage,
                    onDelete: () => deleteMessage(m),
                    onDeleteFile: deleteFile,
                  } : null}
                  onStartEdit={startEditMessage}
                  onOpenFile={openFile}
                />
              ))
            )}
          </div>
        )}
      </div>

      {msgOpen && row && (
        <MessageModal
          inquiryId={row.id}
          onClose={() => setMsgOpen(false)}
          onSaved={loadThread}
        />
      )}
    </main>
  )
}
