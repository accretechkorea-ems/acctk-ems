'use client'

// 의뢰서 상세 — 보기 + 업체명·담당자·발행일·상태 수정 + 취소 + 내용 기록.
//
// 정보 카드 항목 순서 — 발행일 · 업체명 · 내용 · 담당자 · 상태. 「내용」은 가장 최근 내용 기록의
// 본문 한 줄을 **읽기 전용**으로 보여 준다(고치는 자리는 오른쪽 내용 기록 카드 하나뿐이다).
//
// 고치는 자리는 두 곳이고 방식이 같다: 평소에는 읽기 전용으로 보여 주고, 오른쪽 위의
// 수정 아이콘을 누르면 그 자리에서 입력으로 바뀌며, 바뀐 칸이 있을 때만 저장이 켜진다.
//   · 정보 카드 — 업체명·담당자·발행일·상태를 한 번에 저장한다.
//   · 내용 기록 카드 — 날짜·본문·추가 파일. 모달을 띄우지 않는다(고칠 대상을 보면서 고친다).
// 「내용 추가」만 모달이다 — 새로 만드는 일이라 고칠 대상이 화면에 없다.
//
// 내용 기록은 본사와 오간 문답을 날짜순으로 쌓아 보여 준다. 한 건 = 날짜 + 내용 + 첨부 여러 개.
// 읽기는 브라우저가 직접(RLS), 쓰기는 /api/inquiry(내용 기록)와 /api/inquiry-attachment(파일)가 맡는다.
//
// 보냄/받음 구분은 두지 않는다 — 일본 본사가 우리가 보낸 파일에 답을 적어 그대로 돌려주는
// 방식이라, 한 기록이 보낸 것이기도 받은 것이기도 하다. 굳이 고르게 하면 틀리게 고를 뿐이다.
// (DB 의 inquiry_messages.direction 컬럼은 남아 있지만 코드는 읽지도 쓰지도 않는다.)
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
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import SegmentedControl from '@/components/common/SegmentedControl'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/common/Toast'
import ModalOverlay from '@/components/common/ModalOverlay'
import FilePicker, { failText, sizeText, uploadFiles } from '@/components/inquiry/files'
import CompleteModal from '@/components/inquiry/CompleteModal'
import {
  PAGE_BG, CARD_BG, BORDER, TEXT, MUTED, SUB, NEUTRAL_BG, BLUE,
  cardStyle, cardHeader, cardTitle, countBadge, btnPrimary, btnGhost,
} from '@/components/common/ui'
import { todayKST } from '@/lib/date'
import { engineerLabel, isCurrentlyEmployed } from '@/lib/engineers'
import { errorInfo } from '@/lib/errorInfo'
import { safeBackTo } from '@/lib/inquirySearch'
import {
  EDITABLE_STATUSES, INQUIRY_DIRECTION_COLOR, INQUIRY_DIRECTION_LABEL, INQUIRY_DIRECTION_OPTIONS,
  INQUIRY_STATUS_DOT, INQUIRY_TYPE_LABEL,
  directionOf, inquiryOneLine, inquiryStatusLabel, type InquiryDirection, type InquiryType,
} from '@/lib/inquiries'

const TITLE_MAX = 200

/** 내용 기록 본문 길이 상한. 서버(/api/inquiry 의 BODY_MAX)와 같은 값이어야 한다. */
const BODY_MAX = 20000

/** 왼쪽 정보 카드의 폭. 고객사 상세(340)보다 조금 좁다 — 담을 칸이 네 개뿐이다. */
const INFO_COL = 320
/** 판 전체 상한. 왼쪽(320) + 간격(16) + 오른쪽 904 = 1240. */
const SHELL_MAX = 1240

/**
 * 2단 배치 — 왼쪽 정보 카드(고정 폭) + 오른쪽 내용 기록(남는 폭 전부).
 *
 * 고객사 상세(app/customer/[id]/page.tsx 의 .cust-grid)와 같은 방식이다:
 * grid 두 칸 · align-items: start · 왼쪽만 sticky · 좁아지면 1단으로 떨어뜨린다.
 *
 * 다른 점 하나 — 분기를 @media 가 아니라 @container 로 둔다. 사이드바가 접히면 본문 폭이
 * 168px 넓어지는데 화면 폭으로 재면 그 변화가 보이지 않아, 고객사 상세는 사이드바 232px 를
 * 상수로 가정하고 1131px 라는 경계를 쓴다. 의뢰서 목록(.iq-shell)이 이미 @container 를
 * 쓰고 있어 같은 방식으로 맞췄다 — 접힘·펼침 어느 쪽이든 「내용 폭 900」이 기준이다.
 *
 * sticky 는 container-type 조상 안에서도 동작한다(헤드리스 브라우저로 실측 확인:
 * 폭 1400·1000 에서 top 20 에 고정, 860 에서 1단으로 풀리며 static 이 된다).
 * 본문 스크롤은 문서(body)가 한다 — .ems-main 에 overflow 가 없어 뷰포트가 곧 스크롤 컨테이너다.
 */
const SHELL_CSS = `
  .iqd-shell { container-type: inline-size; }
  .iqd-grid {
    display: grid;
    grid-template-columns: ${INFO_COL}px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  /* 오른쪽이 길어도 정보 카드는 같은 자리에 남는다. main 의 위 여백(24)만큼 띄운다.
     카드가 화면보다 길어지면(편집 모드) 카드 안에서 스크롤해 아래가 잘리지 않게 한다. */
  .iqd-left { position: sticky; top: 24px; max-height: calc(100vh - 48px); overflow-y: auto; }
  .iqd-right { min-width: 0; }
  @container (max-width: 900px) {
    .iqd-grid { grid-template-columns: minmax(0, 1fr); }
    .iqd-left { position: static; max-height: none; overflow-y: visible; }
  }
  @media (prefers-reduced-motion: reduce) {
    .iqd-shell * { transition: none !important; animation: none !important; }
  }
`

/**
 * 두 카드의 머리 줄.
 *
 * 왼쪽(정보)과 오른쪽(내용 기록) 카드의 구분선이 **같은 y 에 와야** 두 판이 한 줄에서 시작한 것으로
 * 보인다. 그런데 담는 것이 달라(왼쪽은 아이콘 버튼, 오른쪽은 「내용 추가」 버튼) 자연 높이가
 * 2~3px 어긋난다. 그래서 높이를 숫자로 못 박는다 — 안쪽 것들은 가운데 정렬로 떠 있는다.
 * 값 32 는 가장 큰 자식(btnPrimary: 글자 13 + 위아래 여백 7)이 들어가는 높이다.
 */
const CARD_HEAD: React.CSSProperties = { ...cardHeader, height: 32, boxSizing: 'content-box' }

/**
 * 큰 카드 안의 항목 한 줄(내용 기록 하나).
 *
 * 기록마다 테두리 있는 카드를 쌓으면 카드 안에 카드가 되어 선이 두 겹으로 보인다.
 * 큰 카드 하나 안에서 1px 구분선으로만 나눈다(목록 행과 같은 방식).
 * 좌우로 12 를 내밀고 같은 값만큼 안쪽 여백을 줘, 글자는 카드 안쪽 여백(16)에 그대로 맞고
 * 구분선과 편집 중 배경만 카드 끝 가까이까지 간다.
 */
/**
 * 내용 기록 한 항목.
 *
 * 방향은 **왼쪽 세로 막대**로 구분한다 — 항목 배경을 칠하지 않는 이유가 두 가지다.
 *   · 편집 중 강조(NEUTRAL_BG)와 겹쳐 둘 중 하나가 묻힌다. 막대는 배경과 따로 보인다.
 *   · 긴 본문이 쌓이는 자리라 넓은 색 면이 글을 읽기 어렵게 만든다.
 * 막대 색은 기존 토큰의 dot 값이다(lib/inquiries.ts INQUIRY_DIRECTION_COLOR — 새 색 아님).
 */
const msgItem = (first: boolean, editing: boolean, dir: InquiryDirection): React.CSSProperties => ({
  margin: '0 -12px',
  padding: '12px',
  borderTop: first ? 'none' : `1px solid ${BORDER}`,
  background: editing ? NEUTRAL_BG : undefined,
  borderRadius: editing ? 8 : undefined,
  borderLeft: `3px solid ${INQUIRY_DIRECTION_COLOR[dir].dot}`,
  // 막대가 3px 를 먹으므로 왼쪽 여백에서 그만큼 뺀다 — 글자 왼쪽 선이 흔들리지 않게.
  paddingLeft: 9,
})

/** 방향 뱃지 — 기존 pill 모양(radius 99 · 11/700)에 토큰 쌍만 방향별로 바꾼다. */
function DirectionBadge({ dir }: { dir: InquiryDirection }) {
  const c = INQUIRY_DIRECTION_COLOR[dir]
  return (
    <span style={{
      flexShrink: 0, background: c.bg, color: c.text, borderRadius: 99,
      padding: '1px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      {INQUIRY_DIRECTION_LABEL[dir]}
    </span>
  )
}

/**
 * 「발신 / 회신」 분할 선택 한 칸의 폭. 두 라벨이 같은 두 글자(13px, 약 26px)라
 * SegmentedControl 기본 좌우 여백 12px 씩을 더한 값이다. 추가 모달과 카드 편집이 같은 폭을 쓴다.
 */
const DIR_TAB_W = 50

/** 내용 기록의 입력 칸 — 추가 모달과 카드 편집이 같은 모양을 쓴다. */
const msgField: React.CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: TEXT, background: CARD_BG, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
}
const msgLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5, display: 'block',
}

/**
 * 상세에서 고치는 칸 — 목록 모달의 입력과 같은 모양이다.
 * 폭 상한을 두지 않는다: 왼쪽 카드가 이미 320px 로 좁아, 상한을 또 걸면 카드 안에서 입력만
 * 더 좁아져 글자가 안 보인다. 카드 폭을 그대로 채운다.
 */
const editStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: `1px solid ${BORDER}`,
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

// ── 내용 기록 ───────────────────────────────────────────────────────


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
  entry_date: string
  body: string
  /** 'sent'·'received'·null. 표시는 directionOf 로 정규화한다(null 은 발신으로 읽는다). */
  direction: string | null
  created_by: number | null
  engineers: { name: string | null; position: string | null } | null
}

// 목록과 같은 이유로 제약 이름을 명시한다(engineers 를 여러 번 참조하게 될 표다).
const MESSAGE_COLUMNS =
  'id, entry_date, body, direction, created_by, engineers!inquiry_messages_created_by_fkey(name, position)'

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
  /** 고르고 있는 구분. 저장된 값이 null 이면 directionOf 로 'sent' 가 들어온다. */
  direction: InquiryDirection
  setDirection: (v: InquiryDirection) => void
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
 * 내용 기록 한 건.
 *
 * 보기 모드에서는 본문이 길면 접어 두고, 첨부는 눌러서 내려받는다. 머리 줄 오른쪽 끝의
 * 수정 아이콘 하나만 눌리며, 그것도 적은 사람과 superadmin 에게만 보인다(서버도 같은 기준).
 *
 * 편집은 모달을 띄우지 않고 이 카드 자리에서 한다 — 고칠 대상이 바로 위에 보이는 채로
 * 고치는 편이 낫고, 첨부를 하나씩 지우는 일은 목록을 눈으로 보면서 해야 한다.
 *
 * 본문이 빈 기록(파일만 남긴 경우)은 컴팩트하게 그린다 — 본문 영역과 그 여백을 아예 없애
 * 첨부 줄이 머리 줄 바로 아래에 붙는다.
 *
 * 제 테두리를 갖지 않는다. 「내용 기록」 큰 카드 안의 한 항목이고, 위 항목과는 구분선으로만
 * 갈린다(msgItem). 편집 중인 항목만 옅은 배경으로 떠 보인다.
 */
function MessageCard({
  msg, files, first, canEdit, readOnly, edit, onStartEdit, onOpenFile,
}: {
  msg: Message
  files: Attachment[]
  /** 목록의 첫 항목이면 위 구분선을 긋지 않는다(머리 줄 아래 선과 겹친다). */
  first: boolean
  canEdit: boolean
  /** 취소된 의뢰서 — 수정 아이콘을 감춘다. */
  readOnly: boolean
  /** null 이면 보기 모드. 값이 있으면 이 카드가 편집 중이다. */
  edit: MsgEditBox | null
  onStartEdit: (m: Message) => void
  onOpenFile: (a: Attachment) => void
}) {
  const [open, setOpen] = useState(false)
  const long = msg.body.length > FOLD_AT
  const shown = long && !open ? msg.body.slice(0, FOLD_AT) : msg.body
  const editable = canEdit && !readOnly
  const hasBody = msg.body.trim().length > 0
  // 편집 중이면 고르고 있는 값으로, 아니면 저장된 값으로 뱃지·막대를 그린다 —
  // 구분을 바꾸면 저장 전에도 바로 보여야 어떤 쪽으로 바꾸는지 알 수 있다.
  const dir = edit ? edit.direction : directionOf(msg.direction)

  return (
    <div style={msgItem(first, edit !== null, dir)}>
      {/* 머리 줄 — 구분 뱃지 · 날짜 · 작성자, 오른쪽 끝에 수정 아이콘. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <DirectionBadge dir={dir} />
        <span style={{ fontSize: 13, fontWeight: 700, color: TEXT, flexShrink: 0 }}>{dateText(msg.entry_date)}</span>
        <span style={{ fontSize: 12, color: MUTED }}>{engineerLabel(msg.engineers) || '-'}</span>
        {editable && !edit && (
          <span style={{ marginLeft: 'auto', display: 'flex', flexShrink: 0 }}>
            <EditIconButton label="이 내용 기록 수정" onClick={() => onStartEdit(msg)} />
          </span>
        )}
      </div>

      {edit ? (
        <div style={{ marginTop: 10 }}>
          {/* 구분과 날짜를 한 줄에 — 추가 모달과 같은 배치다(구분 고정 폭 + 날짜 남는 폭). */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ flexShrink: 0 }}>
              <span style={msgLabel}>구분</span>
              <SegmentedControl
                equal minItemWidth={DIR_TAB_W}
                value={edit.direction}
                options={INQUIRY_DIRECTION_OPTIONS}
                onChange={v => edit.setDirection(v as InquiryDirection)}
              />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
            <label style={msgLabel} htmlFor={`me-date-${msg.id}`}>날짜</label>
            <input
              id={`me-date-${msg.id}`} type="date" value={edit.date} disabled={edit.busy}
              onChange={e => edit.setDate(e.target.value)}
              style={{ ...msgField, colorScheme: 'light' }}
            />
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
 * 한 가지 일만 한다: 날짜·내용·파일을 받아 내용 기록을 만들고 파일을 이어 올린다.
 *
 * 쓰이는 때는 주로 「작성 완료」 뒤다 — 일본에서 회신이 오면 그 파일과 내용을 여기에 쌓는다.
 *
 * 본문은 비워도 된다. 받은 파일만 붙여 두는 기록이 실제로 많다. 다만 본문도 파일도 없는
 * 빈 기록은 막는다 — 서버는 내용 기록을 만드는 시점에 파일이 아직 없어 이 판정을 할 수 없으므로
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
  const [entryDate, setEntryDate] = useState(todayKST())
  /**
   * 기본값은 **회신**이다. 손으로 내용을 남기는 일은 대개 본사에서 온 답을 붙여 넣는 것이고,
   * 발신 기록은 작성 완료·번호 등록이 자동으로 남긴다(그쪽은 'sent' 고정이다).
   */
  const [dir, setDir] = useState<InquiryDirection>('received')
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 내용이 필수다 — 공백만 있는 입력은 비어 있는 것으로 본다. 파일은 선택이다.
  const ready = text.trim().length > 0

  const submit = async () => {
    if (busy) return
    if (!ready) { setError('내용을 입력해주세요.'); return }
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'message_add', inquiry_id: inquiryId, entry_date: entryDate,
          direction: dir, body: text,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error || `저장하지 못했습니다 (HTTP ${res.status})`); return }

      // 내용 기록은 이미 저장됐으므로 파일이 막혀도 되돌리지 않는다 — 어느 파일이 왜 막혔는지
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
      console.error('[inquiries] 내용 기록 저장 실패', errorInfo(e))
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

        {/* 맨 윗줄 — 왼쪽 구분(고정 폭), 오른쪽 날짜(남는 폭). 둘 다 위에 작은 라벨을 둔다. */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flexShrink: 0 }}>
            <span style={msgLabel}>구분</span>
            <SegmentedControl
              equal minItemWidth={DIR_TAB_W}
              value={dir}
              options={INQUIRY_DIRECTION_OPTIONS}
              onChange={v => setDir(v as InquiryDirection)}
            />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={msgLabel} htmlFor="ms-date">날짜</label>
            <input id="ms-date" type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
              style={{ ...msgField, colorScheme: 'light' }} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={msgLabel} htmlFor="ms-body">내용 (필수)</label>
          <textarea
            id="ms-body" value={text} rows={7} maxLength={BODY_MAX}
            placeholder="메일 본문이나 메모를 붙여 넣으세요"
            onChange={e => setText(e.target.value)}
            style={{ ...msgField, resize: 'vertical', lineHeight: 1.6 }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={msgLabel}>파일 등록</label>
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
/**
 * 「라벨 위 / 값 아래」 한 칸. 값이 없으면 부르는 쪽이 아예 그리지 않는다.
 *
 * 예전에는 96px 라벨 열 + 값의 가로 2단이었다. 카드가 가로로 넓던 때는 읽혔지만,
 * 320px 왼쪽 열로 들어오면서 값 자리가 190px 밖에 남지 않아 입력·드롭다운이 다 눌렸다.
 * 세로로 쌓으면 값이 카드 폭을 그대로 쓴다.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // 위아래 7 — 좁은 카드에 네댓 줄이 들어가므로 한 줄이라도 낮춰야 한 화면에 여유 있게 담긴다.
    <div style={{ padding: '7px 0', borderTop: `1px solid ${BORDER}` }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.6, minWidth: 0 }}>{children}</div>
    </div>
  )
}

export default function InquiryDetailPage() {
  const { loading: guardLoading, authorized } = usePageGuard()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const search = useSearchParams()
  /**
   * 목록으로 돌아갈 주소. 목록이 from 으로 실어 보낸 "보던 조건" 그대로다.
   * 주소를 직접 열었으면 from 이 없어 /inquiries 로 간다. 바깥 주소는 safeBackTo 가 막는다.
   */
  const backTo = safeBackTo(search.get('from'))
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
  /** 「작성 완료」 모달이 열려 있는가. */
  const [completeOpen, setCompleteOpen] = useState(false)
  /**
   * 제자리 편집 — 한 번에 한 카드만이다. 초안을 부모가 들고 있어야
   * 다른 카드로 옮길 때 「버리겠는가」를 물을 수 있다(MsgEditBox 머리말 참고).
   */
  const [editId, setEditId] = useState<number | null>(null)
  const [draftDate, setDraftDate] = useState('')
  const [draftDir, setDraftDir] = useState<InquiryDirection>('sent')
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
   * 내용 기록과 첨부를 함께 읽는다. 정렬은 entry_date · id 오름차순 — 오래된 것이 위,
   * 새 내용 기록이 아래에 쌓인다(메일 스레드와 같은 방향).
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
      console.error('[inquiries] 내용 기록 조회 실패', { id, mErr, aErr })
      return
    }
    setMessages((msgs ?? []) as unknown as Message[])
    setFiles((atts ?? []) as Attachment[])
  }, [id])

  // 나를 확인한다 — 내용 기록 수정·삭제 버튼을 누구에게 보일지 정하는 데 쓴다.
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

  /**
   * 정보 카드의 「내용」 칸에 보일 값 — **가장 최근 내용 기록의 본문**.
   * messages 는 날짜·id 오름차순으로 읽어 두었으므로 마지막 것이 가장 최근이다(추가 조회 없음).
   * 본문이 비어 있는 기록(파일만 올린 건 등)은 건너뛴다 — 목록의 「내용」 열과 같은 규칙이다.
   */
  const latestBody = [...messages].reverse().find(m => m.body.trim().length > 0)?.body ?? ''
  const latestLine = inquiryOneLine(latestBody)

  /** 편집 중인 카드. 목록을 다시 읽어도 같은 id 를 따라간다. */
  const editingMsg = editId === null ? null : messages.find(m => m.id === editId) ?? null

  /**
   * 원본과 다른 곳이 있는가. 날짜·본문이 달라졌거나, 올릴 파일을 골랐으면 변경이다.
   * 첨부 개별 삭제는 확인 즉시 서버에 반영되므로 여기에 넣지 않는다 — 저장할 것이 없다.
   */
  const msgDirty = editingMsg !== null && (
    draftDate !== editingMsg.entry_date
    // 저장된 값이 null 인 기록은 화면에서 'sent' 로 보인다. 그 상태에서 저장을 눌러도
    // 변경으로 보지 않는다(비교 양쪽을 directionOf 로 정규화한다) — 뜻이 같은 값을 다시 쓰지 않는다.
    || draftDir !== directionOf(editingMsg.direction)
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
        router.replace(backTo)
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
    setDraftDir(directionOf(m.direction))
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
      const patch: { entry_date?: string; direction?: InquiryDirection; body?: string } = {}
      if (draftDate !== m.entry_date) patch.entry_date = draftDate
      if (draftDir !== directionOf(m.direction)) patch.direction = draftDir
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

  /** 내용 기록 삭제 — 되돌릴 수 없어 확인을 받는다. 첨부 파일도 함께 사라진다. */
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
      console.error('[inquiries] 내용 기록 삭제 실패', e)
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
      onClick={() => router.push(backTo)}
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
      <style>{SHELL_CSS}</style>

      {/* container-type 을 가진 바깥 상자. @container 분기가 이 상자의 폭을 본다 —
          사이드바가 접히고 펼쳐져도 「내용 폭」 기준으로 같은 판단이 나온다. */}
      <div className="iqd-shell" style={{ maxWidth: SHELL_MAX, margin: '0 auto' }}>
        {/* 의뢰서를 못 읽은 두 경우(불러오는 중·찾을 수 없음)에는 카드 헤더가 없어
            화살표도 없다 — 그때만 예전처럼 「← 목록」을 윗줄에 둔다. 돌아갈 길은 늘 있어야 한다. */}
        {(state !== 'ready' || !row) && back}

        {state === 'loading' ? (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: MUTED, fontSize: 13 }}>불러오는 중...</div>
        ) : state === 'gone' || !row ? (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: MUTED, fontSize: 13, lineHeight: 1.7 }}>
            찾을 수 없습니다<br />
            <span style={{ fontSize: 12 }}>취소되어 번호가 반환된 의뢰서일 수 있습니다.</span>
          </div>
        ) : (
          /* 2단 — 왼쪽 정보 카드(sticky) · 오른쪽 내용 기록(남는 폭 전부).
             폭이 좁아지면 세로로 쌓이고 sticky 도 풀린다(SHELL_CSS). */
          <div className="iqd-grid">
            <div className="iqd-left">
              <div style={cardStyle}>
                {/* 머리 줄 — 종류 이름과 수정 아이콘 하나뿐이다.
                    번호 취소는 여기 두지 않는다: 되돌릴 수 없는 동작이 카드를 열자마자 보이는 자리에
                    있으면 잘못 누른다. 편집 모드 하단으로 내려, 고치려고 들어온 사람에게만 보인다
                    (내용 기록 카드의 「이 내용 기록 삭제」와 같은 자리·같은 모양). */}
                <div style={CARD_HEAD}>
                  {/* 목록으로 돌아가는 화살표. 카드 밖에 따로 한 줄을 쓰던 「← 목록」을 여기로 들였다 —
                      한 줄을 돌려받고, 1단으로 쌓이는 좁은 폭에서도 카드가 맨 위라 늘 보인다.
                      테두리를 두지 않는다: 이 카드에 대한 동작이 아니라 화면을 떠나는 길이고,
                      오른쪽 수정 아이콘(테두리 있음)과 역할이 달라 보여야 한다.
                      marginLeft 음수는 버튼 안쪽 여백만큼 당겨 화살표를 카드 왼쪽 선에 맞춘다. */}
                  <button
                    type="button" onClick={() => router.push(backTo)}
                    aria-label="의뢰서 목록으로" title="의뢰서 목록으로"
                    onMouseEnter={e => { e.currentTarget.style.color = BLUE }}
                    onMouseLeave={e => { e.currentTarget.style.color = MUTED }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: 6, marginLeft: -6, border: 'none', background: 'transparent',
                      color: MUTED, cursor: 'pointer', flexShrink: 0,
                      transition: 'color 0.15s ease',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5" />
                      <path d="m12 19-7-7 7-7" />
                    </svg>
                  </button>
                  <span style={cardTitle}>{INQUIRY_TYPE_LABEL[row.inquiry_type as InquiryType] ?? row.inquiry_type}</span>
                  {!cancelled && !infoEditing && (
                    <span style={{ marginLeft: 'auto', display: 'flex', flexShrink: 0 }}>
                      <EditIconButton label="의뢰서 정보 수정" onClick={() => setInfoEdit(true)} />
                    </span>
                  )}
                </div>

                {/* 번호 — 사람이 받아 적는 값이다. 취소된 건은 취소선을 긋는다.
                    좁은 카드(320px)로 들어오면서 20 → 17 로 줄였다(목록 카드가 좁을 때 쓰는 크기와 같다).
                    줄바꿈은 막는다 — 번호가 두 줄로 갈라지면 받아 적다 틀린다. 그래도 넘치면
                    말줄임으로 자르고 title 로 전문을 남긴다(실제 번호 형식은 전부 이 폭에 들어온다). */}
                <div style={{
                  background: NEUTRAL_BG, borderRadius: 8, padding: '12px 14px', display: 'flex',
                  alignItems: 'center', gap: 10,
                }}>
                  <span title={row.inquiry_no} style={{
                    flex: 1, minWidth: 0, fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px',
                    color: cancelled ? MUTED : BLUE,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    textDecoration: cancelled ? 'line-through' : 'none',
                  }}>
                    {row.inquiry_no}
                  </span>
                  <button type="button" onClick={copy}
                    style={{ ...btnGhost(), padding: '5px 10px', fontSize: 12, flexShrink: 0 }}>
                    {copied ? '복사했습니다' : '번호 복사'}
                  </button>
                </div>

                {/* 작성 중인 건은 여기서 바로 끝낸다 — 편집 모드에 들어갈 필요가 없다.
                    번호를 받아 서류를 만든 다음 할 일이 이것뿐이라 가장 눈에 띄는 자리에 둔다.
                    완료·취소된 건에는 보이지 않는다(끝난 것을 다시 끝낼 수는 없다). */}
                {!cancelled && row.status === 'drafting' && (
                  <button
                    type="button" onClick={() => setCompleteOpen(true)} disabled={busy}
                    style={{ ...btnPrimary(busy), width: '100%', marginTop: 12 }}
                  >
                    작성 완료
                  </button>
                )}

                {cancelled && (
                  <div style={{
                    marginTop: 12, fontSize: 12, lineHeight: 1.7, color: MUTED,
                    background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px',
                  }}>
                    취소된 의뢰서입니다. 번호는 재사용되지 않으며 내용을 고칠 수 없습니다.
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  {row.equipment_series && <Field label="장비 계열">{row.equipment_series}</Field>}

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

                  {/* 내용 — 가장 최근 내용 기록의 본문 한 줄. **읽기 전용이다**(편집 모드에서도).
                      고치는 자리는 오른쪽 「내용 기록」 카드 하나뿐이다 — 같은 값을 두 자리에서 고치면
                      어느 쪽이 맞는지 알 수 없고, 기록은 날짜·구분·첨부가 함께 붙은 한 덩어리라
                      본문만 떼어 고치는 칸을 만들 수 없다. 이미 읽어 둔 messages 를 쓴다(추가 조회 없음). */}
                  <Field label="내용">
                    <span
                      title={latestBody || undefined}
                      style={{
                        display: 'block', color: latestLine ? TEXT : MUTED,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {latestLine || '(내용 없음)'}
                    </span>
                    {infoEditing && (
                      <span style={{ display: 'block', fontSize: 11, color: MUTED, lineHeight: 1.6, marginTop: 4 }}>
                        내용은 오른쪽 「내용 기록」에서 고칩니다.
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

                  {cancelled && row.cancelled_at && <Field label="취소 시각">{stampText(row.cancelled_at)}</Field>}

                  <Field label="상태">
                    {infoEditing ? (
                      <SegmentedControl
                        options={EDITABLE_STATUSES.map(v => ({ label: inquiryStatusLabel(v), value: v }))}
                        value={status}
                        onChange={setStatus}
                        equal
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

                  {/* 하단 — 왼쪽은 번호 취소, 오른쪽은 편집 끝내기. 저장은 하나다
                      (업체명·담당자·발행일·상태를 한 번에 보낸다).
                      이름을 갈라 둔다: 편집 중단은 「취소」, 번호를 무르는 것은 「이 번호 취소」다.
                      flexWrap 을 둬서 카드가 더 좁아져도 오른쪽 묶음이 아래로 내려갈 뿐 깨지지 않는다. */}
                  {infoEditing && (
                    <div style={{
                      display: 'flex', alignItems: 'center', flexWrap: 'wrap',
                      gap: 8, rowGap: 8, paddingTop: 12,
                    }}>
                      {/* 표시 조건은 종전 「취소하기」와 같다 — 담당자 본인 또는 superadmin,
                          그리고 아직 취소되지 않은 건(canCancel 이 둘 다 본다). */}
                      {canCancel && (
                        <button
                          type="button" onClick={cancelInquiry} disabled={busy}
                          style={{
                            border: 'none', background: 'transparent', padding: 0,
                            color: '#be123c', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                            cursor: busy ? 'not-allowed' : 'pointer',
                          }}
                        >
                          이 번호 취소
                        </button>
                      )}
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button type="button" onClick={cancelInfoEdit} disabled={busy} style={btnGhost(busy)}>
                          취소
                        </button>
                        <button
                          type="button" onClick={() => save(edited)} disabled={busy || !dirty}
                          style={btnPrimary(busy || !dirty)}
                        >
                          {busy ? '저장 중...' : '저장'}
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 내용 기록 — 본사와 오간 문답. 취소된 의뢰서에서는 읽기 전용이다.
                이 가지는 state === 'ready' 이고 row 가 있을 때만 그려진다(위 삼항) —
                예전에 따로 두었던 같은 조건의 가드를 지웠다. */}
            <div className="iqd-right">
              {/* 오른쪽도 카드 하나다. 제목 줄이 카드 밖에 떠 있으면 두 판의 시작점이 어긋나
                  왼쪽 카드만 한 단 올라가 보인다. 머리 줄은 왼쪽과 같은 CARD_HEAD 를 쓴다. */}
              <div style={cardStyle}>
                <div style={CARD_HEAD}>
                  <span style={cardTitle}>내용 기록</span>
                  {messages.length > 0 && (
                    <span style={countBadge}>{messages.length}건</span>
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
                  <div style={{ textAlign: 'center', padding: 40, color: MUTED, fontSize: 13, lineHeight: 1.7 }}>
                    아직 내용 기록이 없습니다<br />
                    <span style={{ fontSize: 12 }}>본사와 주고받은 메일과 파일을 여기에 남깁니다.</span>
                  </div>
                ) : (
                  messages.map((m, i) => (
                    <MessageCard
                      key={m.id}
                      first={i === 0}
                      msg={m}
                      files={files.filter(f => f.message_id === m.id)}
                      canEdit={amAdmin || (myId != null && m.created_by === myId)}
                      readOnly={cancelled}
                      edit={editId === m.id ? {
                        date: draftDate, setDate: setDraftDate,
                        direction: draftDir, setDirection: setDraftDir,
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
            </div>
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

      {completeOpen && row && (
        <CompleteModal
          inquiryId={row.id}
          inquiryNo={row.inquiry_no}
          title={row.title}
          onClose={() => setCompleteOpen(false)}
          // 상태(완료)와 새 내용 기록을 둘 다 다시 읽는다.
          onDone={() => { load(); loadThread() }}
        />
      )}
    </main>
  )
}
