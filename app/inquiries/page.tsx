'use client'

// 의뢰서 — 목록 + 번호 발급.
//
// 목록에서 하는 일은 고르기·새 번호 발급·기존 번호 등록이다.
// 한 건을 고치거나 취소하는 것은 상세(/inquiries/<id>)다. 파일 등록은 다음 단계에서 붙인다.
// 종류·상태의 코드값과 화면 문구, 번호 조립은 lib/inquiries.ts 한 곳에만 둔다.
//
// 배치 — 결재 화면(app/approval/page.tsx)의 .ap-* 패턴을 접두사만 .iq-* 로 바꿔 옮겼다.
//   · 왼쪽: 종류 목록(180px). 좁아지면 가로 탭으로 떨어진다(@container).
//   · 본문 위: 종류별 「다음 사용 번호」 카드. 작성·등록은 전부 이 카드에서 시작한다
//     — 어느 종류로 시작하는지가 버튼 자리로 드러나, 모달에서 종류를 다시 고를 일이 없다.
//   · 본문: 번호 · 업체명 · 상태 · 담당자 · 발행일. 발행일 내림차순, 같으면 순번 내림차순.
// 그 패턴이 공용 컴포넌트가 아니라 그 파일 안의 인라인 CSS 라 복사밖에 방법이 없다.
// 셋째 화면이 같은 배치를 쓰게 되면 그때 공용으로 뽑는 편이 낫다.
//
// 보는 자리는 주소(?type=)가 원본이다 — 새로고침·뒤로 가기에도 고른 종류가 남는다.
//
// 목록은 브라우저 supabase 클라이언트로 직접 읽는다. RLS(inquiries_select)가
// has_team_perm('customers') 로 걸러 주므로 화면이 따로 거르지 않는다.

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { daysBetween, todayKST } from '@/lib/date'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import {
  PAGE_BG, CARD_BG, BORDER, TEXT, MUTED, SUB, NEUTRAL_BG, BLUE, ROW_HOVER_BG,
  cardStyle, cardHeader, cardTitle, countBadge, rowStyle, inputStyle, FAINT,
  btnPrimary, btnGhost,
} from '@/components/common/ui'
import {
  INQUIRY_DIRECTION_COLOR, INQUIRY_TYPE_ITEMS, INQUIRY_TYPE_LABEL, inquiryStatusLabel,
  INQUIRY_STATUS_DOT, INQUIRY_STATUSES, REQ80_SERIES, previewInquiryNo, buildInquiryNo, BULK_IMPORT_ENABLED,
  type InquiryStatus, type InquiryType,
} from '@/lib/inquiries'
import { engineerLabel, isCurrentlyEmployed } from '@/lib/engineers'
import {
  PAGE_SIZE, YEAR_ALL, clampPage, contentPreview, isFiltered, pageRange, pageWindow, parseListQuery,
  replyView, searchWords, splitHighlight, toListQueryString, totalPages, withFilter, yearOptions,
  type InquiryExtras, type ListQuery,
} from '@/lib/inquirySearch'
import FilePicker, { failText, uploadFiles, type UploadFail } from '@/components/inquiry/files'
import CompleteModal from '@/components/inquiry/CompleteModal'
import DeskGuideModal from '@/components/inquiry/DeskGuideModal'
// TEMP-BULK-IMPORT ↓ (일괄 등록이 끝나면 이 줄과 아래 두 군데를 지운다)
import BulkImportModal from '@/components/inquiry/bulk/BulkImportModal'
// TEMP-BULK-IMPORT ↑
import { errorInfo } from '@/lib/errorInfo'

/** 결재 화면과 같은 전환 기준. 두 화면의 레일이 다르게 움직이면 어색하다. */
const MOTION_MS = 140
const MOTION_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

/** 표 열 폭 — 머리와 행이 같은 값을 써야 줄이 맞는다(결재 화면과 같은 방식). */
// 상태 칸은 「작성 중 N일째」 + 「작성 완료」 버튼이 한 줄에 들어갈 만큼 넓다.
/**
 * 열 폭. 머리 줄과 행이 **이 상수 하나**를 함께 쓴다 — 두 벌이면 한쪽만 고쳐져 줄이 어긋난다.
 *   no·status·reply·person·date — 고정 폭(flexShrink: 0)
 *   업체명·내용 — 남는 폭을 나눠 쓴다(flex). 내용이 더 넓다(title 1 : content 1.6).
 * status 는 「작성 중 N일째」가 「작성 중」으로 짧아진 만큼 176 → 128 로 줄였다
 * ([작성 완료] 버튼이 라벨 바로 뒤에 붙는 폭까지 계산한 값이다).
 */
const COL = { no: 156, status: 128, reply: 92, person: 112, date: 92, gap: 10 }

/** 업체명 : 내용 의 폭 비율. 내용이 길어 더 넓게 준다. */
const FLEX_TITLE = 1
const FLEX_CONTENT = 1.6
/** 카드 좌우 여백(16) + 행 좌우 여백(12). 머리는 카드 끝까지 늘이고 글자만 행과 맞춘다. */
const HEAD_PAD = 28

/**
 * 화면 안 레일 + 본문.
 *
 * container-type 이 있어야 @container 가 동작한다 — 이 줄이 빠지면 좁은 화면에서
 * 레일이 가로 탭으로 떨어지지 않고 180px 인 채로 본문을 밀어낸다.
 */
const SHELL_CSS = `
  .iq-shell { container-type: inline-size; }
  .iq-body { display: flex; gap: 12px; align-items: flex-start; }
  .iq-rail { width: 180px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; }
  .iq-main { flex: 1; min-width: 0; }
  /* 다음 사용 번호 카드 — 열 수를 폭 구간마다 못 박는다.
     auto-fit/minmax 로 두면 폭에 따라 5+1, 4+2 처럼 마지막 줄이 어중간하게 남는다.
     6 의 약수(6·3·2)만 써서 어느 구간에서도 줄이 꽉 찬다. */
  .iq-cards { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  @container (min-width: 620px) { .iq-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @container (min-width: 1040px) { .iq-cards { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
  /* 한 종류만 볼 때는 카드 하나가 가로를 다 쓴다(번호를 더 크게 보여 준다). */
  .iq-cards.one { grid-template-columns: minmax(0, 1fr); }
  .iq-typebtn { transition: background ${MOTION_MS}ms ${MOTION_EASE}; }
  .iq-typebtn:hover { background: ${NEUTRAL_BG}; }
  /* 접수 창구 안내 — 종류 필터가 아니라 모달을 여는 항목이다. 아래 「전체」와 가는 선으로 가른다.
     라벨이 길어 한 줄에 안 들어가면 두 줄로 넘긴다(말줄임하면 무슨 항목인지 알 수 없다). */
  .iq-desk { white-space: normal; text-align: left; line-height: 1.4; }
  .iq-deskwrap { padding-bottom: 6px; margin-bottom: 6px; border-bottom: 1px solid ${BORDER}; }
  @container (max-width: 900px) {
    /* 가로 탭이 되면 선을 오른쪽으로 옮기고, 맨 앞에서 밀리지 않게 한다. */
    .iq-deskwrap { padding: 0 6px 0 0; margin: 0 6px 0 0; border-bottom: none; border-right: 1px solid ${BORDER}; flex-shrink: 0; }
    .iq-desk { white-space: nowrap; }
  }
  @container (max-width: 900px) {
    .iq-body { flex-direction: column; }
    .iq-rail { width: 100%; flex-direction: row; overflow-x: auto; gap: 4px; align-items: center; }
    .iq-typebtn { width: auto !important; flex: 0 0 auto; }
    /* 「내용」과 「담당자」 열을 접는다 — 남는 폭을 업체명이 혼자 쓴다(flex 라 가로 스크롤이 없다).
       담당자를 함께 접는 이유: 회신 열이 늘면서 고정 열 합이 커졌다. 두 열을 접으면 합이
       468 + gap 40 = 508px 로, 회신 열이 없던 때(576px)보다 오히려 작아 더 좁은 폭까지 버틴다.
       담당자를 고른 이유는 행을 누르면 상세에서 바로 보이는 값이기 때문이다(번호·업체명·상태·회신은 아니다).
       !important — 칸에 안쪽 배치용 인라인 display 가 있어 그냥 두면 이 규칙을 이긴다
       (쇼룸 사용 기록 표가 같은 이유로 !important 를 쓴다). */
    .iq-content, .iq-person { display: none !important; }
  }
  /* 전화기 폭 — 고정 열 네 개(번호 156 · 상태 128 · 회신 92 · 발행일 92)와 gap 40 을 합치면
     468 + 40 = 508px 이라(컨테이너 564px) 그보다 좁으면 칸이 삐져나가 가로 스크롤이 생긴다.
     그래서 분기를 570px 에 둔다 — 위 단계가 버티는 564px 보다 커서 두 단계가 틈 없이 맞물린다.
     발행일을 접고(번호가 날짜를 품고 있다 — BY26-81-007 의 26 이 연도다) 번호가 줄어들 수 있게 한다.
     !important — 칸의 인라인 width·flexShrink 를 이겨야 한다(스타일시트의 !important 가 인라인을 이긴다).
     이렇게 두면 번호가 말줄임으로 줄어들어 **어떤 폭에서도 넘치지 않는다**. */
  @container (max-width: 570px) {
    .iq-date { display: none !important; }
    .iq-no { flex: 0 1 auto !important; min-width: 0 !important; }
  }
  @media (prefers-reduced-motion: reduce) {
    .iq-shell, .iq-shell * { transition: none !important; animation: none !important; }
  }
`

/** 목록 한 줄. engineers 는 제약 이름을 명시해 가져온다(아래 SELECT 주석 참고). */
/**
 * 목록 한 줄 — DB 함수 search_inquiries 가 돌려주는 모양 그대로다
 * (inquiries_search_function.sql). 담당자 이름은 조인해서 평평하게 온다.
 *
 * 임베드(engineers!…)를 쓰지 않는다. 한 페이지만 받아 오는 일이라 함수 쪽에서 조인하는 편이
 * 단순하고, 검색에 쓰는 발췌·맞은 파일명도 같은 함수가 함께 만들어 준다.
 */
type ListRow = {
  id: string
  inquiry_no: string
  title: string | null
  status: string
  inquiry_type: string
  seq: number
  issued_date: string
  created_by: number | null
  owner_name: string | null
  owner_position: string | null
  /** 검색어가 내용 기록 본문에서 걸렸을 때의 발췌. 아니면 null. */
  snippet: string | null
  /** 검색어가 걸린 첨부 파일명(최대 3개). 검색어가 없으면 빈 배열. */
  match_files: string[]
}

const dateText = (ymd: string | null): string => (ymd ? ymd.replace(/-/g, '.') : '')

/** 회신 뱃지 색 — 상세 카드의 회신 뱃지와 **같은 토큰**이다(lib/inquiries.ts). */
const REPLY_COLOR = INQUIRY_DIRECTION_COLOR.received

/** 첨부 클립 — lucide 모양의 인라인 SVG(패키지는 쓰지 않는다). 결재 목록의 것과 같은 모양이다. */
function Clip() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

/**
 * 검색어가 맞은 조각을 굵게. 색을 새로 만들지 않고 굵기만 바꾼다(디자인 규칙).
 * 자르는 규칙은 lib/inquirySearch.ts 의 splitHighlight 하나뿐이다 — 정규식 특수문자도 안전하다.
 */
function Hi({ text, words }: { text: string; words: string[] }) {
  if (words.length === 0) return <>{text}</>
  return (
    <>
      {splitHighlight(text, words).map((p, i) => (
        p.hit
          ? <b key={i} style={{ fontWeight: 800, color: TEXT }}>{p.text}</b>
          : <span key={i}>{p.text}</span>
      ))}
    </>
  )
}

/**
 * 작성 중인 건이 며칠째인지. 발행 당일이 1일째다.
 * 날짜 계산은 KST 기준이다 — 서버·브라우저 시간대를 타면 하루가 밀린다(lib/date.ts 머리말).
 */
const draftingDays = (issuedDate: string, today: string): number => daysBetween(issuedDate, today) + 1

/**
 * 며칠째부터 흐리게 볼 것인가. 오래 붙잡고 있는 건을 눈에 띄게 하려는 것이라
 * 자동으로 상태를 바꾸거나 목록에서 빼지 않는다 — 사람이 보고 판단할 몫이다.
 */
const STALE_DAYS = 7

/** 발급된 의뢰서 — 라우트가 돌려주는 값 중 화면이 쓰는 것만. */
type MadeInquiry = { inquiry_no: string }

/** 등록된 의뢰서 — 첨부를 붙이려면 id 가, 알림 문구에는 번호가 필요하다. */
type RegisteredInquiry = { id: string; inquiry_no: string }

/** peek 이 돌려주는 종류별 카운터. */
type Counter = { type: InquiryType; period_key: string; last_seq: number; next_seq: number }

/** 담당자 고르기 — 기존 모달들과 같은 모양(engineer_id·name·position·resigned_date). */
type PickEngineer = { engineer_id: number; name: string | null; position: string | null; resigned_date: string | null }

/** 안내판 문구. 이 번호가 예약이 아니라는 점을 분명히 한다. */
const PEEK_NOTICE =
  '이 번호는 예약이 아닙니다. 번호를 쓰기 전에 작성하기 버튼으로 먼저 점유하세요. '
  + '점유하면 번호가 다른 사람에게 나가지 않습니다.'

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: TEXT, background: CARD_BG, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
}
const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5, display: 'block',
}

/**
 * 기존 번호 등록 — 이미 바깥에 나간 번호를 뒤늦게 넣는다.
 *
 * 새로 작성하기와 결정적으로 다른 점: 번호를 **사람이 정한다**. 그래서 일련번호·발행일·담당자를
 * 직접 받고, 조립한 번호를 미리보기로 보여 준다. 저장되는 번호는 서버가 같은 함수로 다시 만든다.
 *
 * 배치는 사람이 채우는 순서다 — 맨 위에 「등록될 번호」를 띠로 두고(무엇을 만드는지 먼저 보인다),
 * 업체명 → 발행일·일련번호 → 담당자 → 파일 순으로 내려간다.
 *
 * 상태는 묻지 않는다. 이미 바깥에 나간 번호를 적는 자리라 언제나 완료다 —
 * 골라야 할 것이 하나 줄면 그만큼 빨리 끝난다. 나중에 달라지면 상세에서 고친다.
 *
 * 파일은 한 칸에 받는다. 저장할 때 내용 기록 한 건을 만들고 그 아래에 전부 붙인다
 * — 첨부는 내용 기록에 매달리는 구조이기 때문이다(inquiry_messages_schema.sql).
 * 보냄/받음은 나누지 않는다: 일본 본사가 보낸 파일에 답을 적어 돌려주므로 한 파일이 둘 다다.
 *
 * 카운터를 건너뛰게 되면(지금 다음 번호보다 큰 값) 먼저 확인을 받는다 — 한 번 올린 카운터는
 * 내릴 수 없어서, 사이에 낀 번호들이 「사용된 것」이 되어 버린다.
 */
function RegisterModal({
  type, engineers, myId, onClose, onDone,
}: {
  /** 어느 카드에서 열었는지. 모달 안에서는 바꾸지 않는다. */
  type: InquiryType
  engineers: PickEngineer[]
  myId: number | null
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const confirmDialog = useConfirm()
  const today = todayKST()

  const [issuedDate, setIssuedDate] = useState(today)
  const [series, setSeries] = useState('')
  const [seq, setSeq] = useState('')
  const [title, setTitle] = useState('')
  const [ownerPick, setOwnerPick] = useState<number | ''>('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /**
   * 담당자는 고르기 전까지 자기 자신이다.
   *
   * useState 초기값으로 myId 를 읽으면 안 된다 — myId 는 로그인 확인과 engineers 조회,
   * 두 번의 비동기 뒤에 오므로 모달이 처음 그려지는 순간에는 거의 항상 null 이고,
   * 초기값은 그 뒤로 다시 계산되지 않아 「고르기」로 굳는다. 파생값으로 두면 값이 늦게 와도 맞는다.
   */
  const createdBy: number | '' = ownerPick === '' ? (myId ?? '') : ownerPick

  // 신규 배정은 재직자만(기존 모달들과 같은 isCurrentlyEmployed 판정).
  const selectable = engineers.filter(e => isCurrentlyEmployed(e.resigned_date, today))

  const needsSeries = type === 'req80'
  const seqNum = Number(seq)
  const seqOk = Number.isInteger(seqNum) && seqNum >= 1 && seqNum <= 99999
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(issuedDate)
  const ready = dateOk && seqOk && createdBy !== ''
    && (!needsSeries || REQ80_SERIES.includes(series))

  // 미리보기 — 사람이 형식을 눈으로 확인하는 자리다. 저장값은 서버가 다시 만든다.
  // 번호의 연도는 발행일의 연도다(번호가 매년 1월 1일에 리셋되므로).
  let preview = ''
  if (dateOk && seqOk && (!needsSeries || REQ80_SERIES.includes(series))) {
    try {
      preview = buildInquiryNo(type, { seq: seqNum, year: issuedDate.slice(0, 4), series, issuedDate })
    } catch { preview = '' }
  }

  /**
   * 번호를 등록한다. 성공하면 만들어진 건을, 사람이 물러섰거나 실패했으면 null 을 돌려준다.
   *
   * 번호를 건너뛰는 경우에는 확인을 받고 **같은 입력으로** 한 번 더 보낸다. 고른 파일은
   * 화면 상태에 그대로 있으므로 확인을 거쳐도 사라지지 않는다.
   */
  const sendRegister = async (confirmBump: boolean): Promise<RegisteredInquiry | null> => {
    const res = await fetch('/api/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'register', type, issued_date: issuedDate,
        equipment_series: needsSeries ? series : undefined,
        // 이미 바깥에 나간 번호라 상태는 언제나 완료다.
        seq: seqNum, title, status: 'done', created_by: createdBy,
        ...(confirmBump ? { confirm_bump: true } : {}),
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setError(json.error || `등록하지 못했습니다 (${res.status})`); return null }

    // 건너뛰는 번호가 생긴다 — 사람에게 알리고 같은 요청을 다시 보낸다.
    if (json.needs_confirm) {
      const ok = await confirmDialog({
        title: '번호를 건너뜁니다',
        message: `${json.skipped_from}~${json.skipped_to}번은 사용된 번호가 되고, `
          + `다음 사용 번호가 ${json.next_after}번이 됩니다.`,
        confirmText: '등록',
        variant: 'danger',
      })
      if (!ok) return null
      return sendRegister(true)
    }
    return (json.inquiry ?? null) as RegisteredInquiry | null
  }

  /**
   * 고른 파일을 내용 기록 한 건에 붙인다. 올리지 못한 파일을 사유와 함께 돌려준다.
   * 파일이 없으면 기록을 만들지 않는다 — 빈 기록만 남으면 목록만 지저분해진다.
   *
   * 내용 기록의 날짜는 발행일로 둔다 — 소급 등록이라 「오늘」이 아니라 그 번호가 나간 날이 맞다.
   * 번호는 이미 등록됐으므로 여기서 실패해도 되돌리지 않는다. 무엇이 빠졌는지 알려 줄 뿐이다.
   */
  const attachFiles = async (inquiryId: string): Promise<UploadFail[]> => {
    if (files.length === 0) return []
    const res = await fetch('/api/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 발신 고정 — 번호를 쓴 날을 남기는 기록이다(사람이 고를 것이 없다).
        action: 'message_add', inquiry_id: inquiryId, entry_date: issuedDate, direction: 'sent', body: '',
      }),
    })
    const json = await res.json().catch(() => ({}))
    const messageId = Number(json.message?.id)
    if (!res.ok || !Number.isInteger(messageId)) {
      const reason = json.error || `내용 기록을 만들지 못했습니다 (${res.status})`
      console.error('[inquiries] 내용 기록 생성 실패', { status: res.status, error: json })
      return files.map(f => ({ name: f.name, reason }))
    }
    return uploadFiles(messageId, files)
  }

  const submit = async () => {
    if (busy || !ready) return
    setBusy(true)
    setError('')
    try {
      const made = await sendRegister(false)
      if (!made) return
      const failed = await attachFiles(made.id)
      if (failed.length > 0) {
        // 번호는 등록됐다. 빠진 것은 파일뿐이라는 점을 분명히 한다 — 다시 등록하면 번호가 겹친다.
        toast.error(`${made.inquiry_no} 등록했습니다. 올리지 못한 파일은 상세에서 다시 올려주세요\n${failText(failed)}`)
      } else {
        toast.success(`${made.inquiry_no} 등록했습니다`)
      }
      onDone()
      onClose()
    } catch (e) {
      console.error('[inquiries] 등록 실패', e)
      setError('등록하지 못했습니다. 잠시 뒤 다시 시도해주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{
        background: CARD_BG, borderRadius: 8, padding: '14px 16px', width: '100%', maxWidth: 500,
        maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
      }}>
        {/* 종류는 카드에서 정해져 들어온다 — 모달 안에서 고르지 않고 머리글로 보여 준다. */}
        <div style={cardHeader}>
          <span style={cardTitle}>기존 번호 등록 — {INQUIRY_TYPE_LABEL[type]}</span>
        </div>

        {/* 등록될 번호 띠 — 맨 위다. 무엇을 만드는 중인지가 입력보다 먼저 보여야 한다. */}
        <div style={{
          background: NEUTRAL_BG, borderRadius: 8, padding: '12px 14px', marginBottom: 12,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 4 }}>등록될 번호</div>
          <div style={{
            fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px', wordBreak: 'break-all',
            color: preview ? BLUE : MUTED,
          }}>
            {preview || '아래를 채우면 번호가 보입니다'}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle} htmlFor="rg-title">업체명 <span style={{ fontWeight: 500 }}>(선택)</span></label>
          <input id="rg-title" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} style={fieldStyle} />
        </div>

        {/* 발행일·일련번호는 번호를 만드는 값이라 한 줄에 둔다(80 의뢰서는 계열까지 세 칸). */}
        <div style={{
          display: 'grid', gap: 10, marginBottom: 12,
          gridTemplateColumns: needsSeries ? '1.2fr 0.9fr 0.9fr' : '1fr 1fr',
        }}>
          <div>
            <label style={labelStyle} htmlFor="rg-date">발행일</label>
            <input id="rg-date" type="date" value={issuedDate} onChange={e => setIssuedDate(e.target.value)}
              style={{ ...fieldStyle, colorScheme: 'light' }} />
          </div>
          {needsSeries && (
            <div>
              <label style={labelStyle} htmlFor="rg-series">장비 계열</label>
              <select id="rg-series" value={series} onChange={e => setSeries(e.target.value)} style={fieldStyle}>
                <option value="">고르기</option>
                {REQ80_SERIES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          )}
          <div>
            <label style={labelStyle} htmlFor="rg-seq">일련번호</label>
            <input id="rg-seq" inputMode="numeric" value={seq} placeholder="예: 62"
              onChange={e => setSeq(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
              style={fieldStyle} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle} htmlFor="rg-owner">담당자</label>
          <select id="rg-owner" value={createdBy} style={fieldStyle}
            onChange={e => setOwnerPick(e.target.value ? Number(e.target.value) : '')}>
            {/* 자기 자신이 들어간 뒤에는 빈 값을 고를 일이 없다 — 담당자 없는 의뢰서는 만들지 않는다. */}
            {createdBy === '' && <option value="">고르기</option>}
            {selectable.map(e => (
              <option key={e.engineer_id} value={e.engineer_id}>{engineerLabel(e)}</option>
            ))}
          </select>
        </div>

        {/* 파일 — 저장할 때 내용 기록 한 건으로 들어간다(없으면 기록을 만들지 않는다). */}
        <div style={{ marginBottom: 12 }}>
          <FilePicker label="파일 등록" files={files} onChange={setFiles} disabled={busy} />
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
            {busy ? '등록 중...' : '등록'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
/**
 * 새로 작성하기 — 번호를 발급한다.
 *
 * 두 단계다. 발급 전에는 입력, 발급 뒤에는 번호와 복사 버튼만 남긴다 —
 * 같은 창에서 계속 누를 수 있게 두면 번호를 연달아 소진한다.
 */
function CreateModal({
  type, onClose, onCreated,
}: {
  /** 어느 카드에서 열었는지. 모달 안에서는 바꾸지 않는다. */
  type: InquiryType
  onClose: () => void
  onCreated: () => void
}) {
  const toast = useToast()
  const [series, setSeries] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState<MadeInquiry | null>(null)
  const [copied, setCopied] = useState(false)

  // 장비 계열은 80 의뢰서에서만 고른다. 20 의뢰서는 '20' 하나뿐이라 서버가 강제하고,
  // 나머지 종류는 번호에 쓰이지 않아 서버가 null 로 지운다.
  const needsSeries = type === 'req80'
  const ready = !needsSeries || REQ80_SERIES.includes(series)

  const submit = async () => {
    // busy 를 먼저 본다 — 한 번 누를 때 번호가 정확히 한 번만 나가야 한다.
    if (busy || !ready || made) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', type, equipment_series: needsSeries ? series : undefined, title }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `발급에 실패했습니다 (${res.status})`); return }
      setMade(json.inquiry as MadeInquiry)
    } catch (e) {
      console.error('[inquiries] 발급 실패', e)
      setError('발급에 실패했습니다. 잠시 뒤 다시 시도해주세요.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!made) return
    try {
      await navigator.clipboard.writeText(made.inquiry_no)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 클립보드는 권한·보안 맥락에 따라 막힌다. 번호는 화면에 그대로 있으니 알리기만 한다.
      toast.error('복사하지 못했습니다. 번호를 직접 선택해 복사해주세요')
    }
  }

  /** 발급이 끝난 뒤 닫으면 목록을 다시 읽는다. 발급 전에 닫으면 아무 일도 없었다. */
  const close = () => {
    if (made) onCreated()
    onClose()
  }

  const field: React.CSSProperties = {
    width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
    fontSize: 13, color: TEXT, background: CARD_BG, outline: 'none', boxSizing: 'border-box',
    fontFamily: 'inherit',
  }
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5, display: 'block' }

  return (
    <ModalOverlay onClose={close}>
      <div style={{
        background: CARD_BG, borderRadius: 8, padding: '14px 16px', width: '100%', maxWidth: 420,
        boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
      }}>
        <div style={cardHeader}>
          <span style={cardTitle}>
            {made ? '번호가 발급되었습니다' : `새로 작성하기 — ${INQUIRY_TYPE_LABEL[type]}`}
          </span>
        </div>

        {made ? (
          <>
            {/* 발급된 번호. 사람이 받아 적는 값이라 크게 보인다. */}
            <div style={{
              background: NEUTRAL_BG, borderRadius: 8, padding: '18px 16px', textAlign: 'center',
              fontSize: 20, fontWeight: 800, color: BLUE, letterSpacing: '-0.5px', wordBreak: 'break-all',
            }}>
              {made.inquiry_no}
            </div>
            <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.7, marginTop: 10 }}>
              목록에 「작성 중」으로 추가되었습니다. 업체명과 상태는 그 건을 눌러 고칠 수 있습니다.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" onClick={copy} style={{ ...btnGhost(), flex: 1 }}>
                {copied ? '복사했습니다' : '번호 복사'}
              </button>
              <button type="button" onClick={close} style={{ ...btnPrimary(), flex: 1 }}>닫기</button>
            </div>
          </>
        ) : (
          <>
            {/* 종류는 카드에서 정해져 들어온다 — 제목에 있고 여기서는 고르지 않는다. */}
            {needsSeries && (
              <div style={{ marginBottom: 12 }}>
                <label style={label} htmlFor="iq-series">장비 계열</label>
                <select id="iq-series" value={series} onChange={e => setSeries(e.target.value)} style={field}>
                  <option value="">계열을 골라주세요</option>
                  {REQ80_SERIES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={label} htmlFor="iq-title">업체명 <span style={{ fontWeight: 500 }}>(선택)</span></label>
              <input
                id="iq-title" value={title} maxLength={200} placeholder="나중에 넣어도 됩니다"
                onChange={e => setTitle(e.target.value)} style={field}
              />
            </div>

            {error && (
              <div style={{
                fontSize: 12, lineHeight: 1.6, color: '#be123c', background: '#fef2f2',
                border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px', marginBottom: 12,
              }}>
                {error}
              </div>
            )}

            <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.7 }}>
              누르면 번호가 바로 발급됩니다. 취소할 때 그 번호가 마지막으로 발급된 번호이면
              반환되어 다음 작성 때 다시 쓰이고, 이후 번호가 이미 발급됐다면 취소 상태로 남습니다.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="button" onClick={close} style={{ ...btnGhost(), flex: 1 }}>닫기</button>
              <button type="button" onClick={submit} disabled={busy || !ready} style={{ ...btnPrimary(busy || !ready), flex: 1 }}>
                {busy ? '발급 중...' : '번호 발급'}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  )
}

/**
 * 다음 사용 번호 카드 한 장.
 *
 * 카드 전체를 누를 수 있게 만들지 않는다 — 헛클릭 한 번이 곧 번호 점유가 되기 때문이다.
 * 눌리는 것은 버튼 둘뿐이다.
 */
function NextNoCard({
  type, label, no, loading, wide, onCreate, onRegister,
}: {
  type: InquiryType
  label: string
  /** 아직 못 읽었으면 null. */
  no: string | null
  loading: boolean
  /** 한 종류만 볼 때 — 가로를 다 쓰므로 번호를 더 크게. */
  wide: boolean
  onCreate: (t: InquiryType) => void
  onRegister: (t: InquiryType) => void
}) {
  return (
    <div style={{
      background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8,
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>{label}</div>
      <div style={{
        fontSize: wide ? 28 : 17, fontWeight: 800, color: BLUE,
        letterSpacing: wide ? '-0.5px' : '-0.3px', lineHeight: 1.2, wordBreak: 'break-all',
      }}>
        {loading && no === null ? '확인 중...' : (no ?? '-')}
      </div>
      {/* 남는 높이를 먹어 카드 높이가 달라도 버튼이 아래에 나란히 선다. */}
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', flexDirection: wide ? 'row' : 'column', gap: 6 }}>
        <button type="button" onClick={() => onCreate(type)} style={{ ...btnPrimary(), width: wide ? 'auto' : '100%' }}>
          작성하기
        </button>
        <button
          type="button"
          onClick={() => onRegister(type)}
          style={{ ...btnGhost(), width: wide ? 'auto' : '100%', padding: '5px 10px', fontSize: 12 }}
        >
          기존 번호 등록
        </button>
      </div>
    </div>
  )
}

/**
 * 다음 사용 번호 안내판.
 *
 * 여기 보이는 번호는 **예약이 아니다** — 다른 사람이 먼저 점유하면 달라진다. 그래서
 * 화면에서 미리 계산해 두지 않고 peek 으로 매번 서버에서 읽는다(창이 다시 포커스를 받을 때도).
 * 실제로 나가는 번호는 발급 응답이 정본이다.
 *
 * 종류 탭이면 그 종류 한 장만 가로로 넓게, 「전체」면 여섯 장을 격자로 둔다.
 * 카드는 한 컴포넌트(NextNoCard)를 그대로 쓰고 wide 만 다르다.
 */
function NextNoBoard({
  type, counters, loading, onCreate, onRegister, rightSlot,
}: {
  /** 한 종류만 볼 때. null 이면 6종 전부. */
  type: InquiryType | null
  counters: Counter[] | null
  loading: boolean
  onCreate: (t: InquiryType) => void
  onRegister: (t: InquiryType) => void
  // TEMP-BULK-IMPORT ↓ (안내 문구 줄 오른쪽에 들어가는 것. 지울 때 이 prop 과 아래 쓰임을 함께 지운다)
  rightSlot?: React.ReactNode
  // TEMP-BULK-IMPORT ↑
}) {
  const today = todayKST()
  const year = today.slice(0, 4)

  /** 카운터에서 그 종류의 다음 번호 문자열. 아직 못 읽었으면 null. */
  const nextNo = (t: InquiryType): string | null => {
    const c = counters?.find(x => x.type === t)
    if (!c) return null
    return previewInquiryNo(t, { seq: c.next_seq, year, issuedDate: today })
  }

  const items = type
    ? INQUIRY_TYPE_ITEMS.filter(i => i.type === type)
    : INQUIRY_TYPE_ITEMS

  return (
    <div style={{ marginBottom: 12 }}>
      <div className={type ? 'iq-cards one' : 'iq-cards'}>
        {items.map(item => (
          <NextNoCard
            key={item.type}
            type={item.type}
            label={item.label}
            no={nextNo(item.type)}
            loading={loading}
            wide={type !== null}
            onCreate={onCreate}
            onRegister={onRegister}
          />
        ))}
      </div>
      {/* 안내는 카드마다 반복하지 않고 묶음 아래 한 줄로만 둔다. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: SUB, lineHeight: 1.7 }}>{PEEK_NOTICE}</span>
        {/* TEMP-BULK-IMPORT ↓ */}
        {rightSlot}
        {/* TEMP-BULK-IMPORT ↑ */}
      </div>
    </div>
  )
}

function InquiriesPageInner() {
  const { loading: guardLoading, authorized } = usePageGuard()
  const router = useRouter()
  const params = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  // ── 주소가 정본 ────────────────────────────────────────────────
  // 화면이 들고 있는 조건은 전부 주소를 읽어 만든 것이다. 무엇을 바꾸든 주소를 다시 쓰는 것으로
  // 끝난다 — 새로고침·뒤로 가기·링크 공유가 모두 같은 화면을 연다(lib/inquirySearch.ts).
  const thisYear = Number(todayKST().slice(0, 4))
  const query = parseListQuery(params, thisYear)
  const { type, year, status, owner, q, page } = query

  const [rows, setRows] = useState<ListRow[] | null>(null)
  const [typeCounts, setTypeCounts] = useState<Record<string, number> | null>(null)
  /**
   * 「내용」·「회신」 열의 값(의뢰서 id → extras). 목록과 **같은 요청 번호**로 묶어 받는다.
   * 비어 있어도 목록은 그려진다 — DB 함수(inquiry_list_extras)를 아직 적용하지 않았거나
   * 호출이 실패하면 두 열만 흐린 「-」로 남는다(오류 토스트를 띄우지 않는다).
   */
  const [extras, setExtras] = useState<Record<string, InquiryExtras>>({})
  const [loadError, setLoadError] = useState('')
  /** 조회 중 — 이전 행을 지우지 않고 이것만 표시한다(깜빡임 방지). */
  const [busy, setBusy] = useState(false)
  /** 가장 오래된 발행 연도. 연도 선택지를 만든다. 한 번만 읽는다. */
  const [oldestYear, setOldestYear] = useState<number | null>(null)
  /** 검색 입력은 주소보다 앞서 움직인다(입력 중 300ms 는 주소를 안 건드린다). */
  const [qInput, setQInput] = useState(q)
  const composing = useRef(false)
  /** 낡은 응답이 최신 결과를 덮지 않게 요청마다 번호를 매긴다. */
  const reqNo = useRef(0)

  // 모달은 카드에서만 열린다. 값이 있으면 그 종류로 열려 있다는 뜻이다
  // (따로 open 플래그를 두지 않는다 — 두 값이 어긋날 자리를 만들지 않으려고).
  const [createType, setCreateType] = useState<InquiryType | null>(null)
  const [registerType, setRegisterType] = useState<InquiryType | null>(null)
  /** 「작성 완료」 모달을 연 행. 상세로 들어가지 않고 목록에서 바로 끝낸다. */
  const [completeFor, setCompleteFor] = useState<ListRow | null>(null)
  /** 접수 창구 안내 모달. 닫을 때 포커스를 레일 항목으로 되돌린다. */
  const [deskOpen, setDeskOpen] = useState(false)
  const deskBtnRef = useRef<HTMLButtonElement>(null)
  // TEMP-BULK-IMPORT ↓
  const [bulkOpen, setBulkOpen] = useState(false)
  // TEMP-BULK-IMPORT ↑
  const [counters, setCounters] = useState<Counter[] | null>(null)
  const [peeking, setPeeking] = useState(false)
  const [engineers, setEngineers] = useState<PickEngineer[]>([])
  const [myId, setMyId] = useState<number | null>(null)
  // 발급 뒤 목록을 다시 읽는 방아쇠. 값이 바뀌면 아래 효과가 다시 돈다(지금 조건은 그대로).
  const [reloadKey, setReloadKey] = useState(0)

  /** 주소를 다시 쓴다. replace 라 필터를 바꿔도 뒤로 가기가 쌓이지 않는다. */
  const push = (next: ListQuery) => {
    router.replace(`/inquiries${toListQueryString(next, thisYear)}`, { scroll: false })
  }
  /** 조건 바꾸기 — 무엇을 바꾸든 페이지는 1로 돌아간다. */
  const setFilter = (part: Partial<ListQuery>) => push(withFilter(query, part))

  // 주소의 검색어가 밖에서 바뀌면(초기화·뒤로 가기) 입력칸도 맞춘다.
  useEffect(() => { setQInput(q) }, [q])

  // 검색어 — 입력이 멎고 300ms 뒤에 주소로 옮긴다. IME 조합 중에는 보내지 않는다
  // (「ㄱ」·「가」 처럼 완성 전 글자로 조회하면 결과가 튄다).
  useEffect(() => {
    if (qInput.trim() === q) return
    const t = setTimeout(() => { if (!composing.current) setFilter({ q: qInput.trim() }) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput, q])

  // 가장 오래된 발행 연도 — 연도 선택지를 만들려고 한 번만 읽는다.
  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    const run = async () => {
      const { data } = await supabase
        .from('inquiries').select('issued_date').order('issued_date', { ascending: true }).limit(1)
      if (cancelled) return
      const d = (data ?? [])[0] as { issued_date: string } | undefined
      if (d) setOldestYear(Number(d.issued_date.slice(0, 4)))
    }
    run()
    return () => { cancelled = true }
  }, [authorized, supabase])

  // ── 목록·건수 조회 ─────────────────────────────────────────────
  // 한 페이지 분량만 받는다. 종류별 건수는 종류 조건을 뺀 같은 기준으로 따로 받는다
  // (레일에 6종을 모두 보여 줘야 하므로 — inquiries_search_function.sql 참고).
  useEffect(() => {
    if (!authorized) return
    const mine = ++reqNo.current
    const run = async () => {
      setBusy(true)
      const yearArg = year === YEAR_ALL ? null : year
      const [list, counts] = await Promise.all([
        supabase.rpc('search_inquiries', {
          p_q: q || null, p_type: type, p_year: yearArg, p_status: status, p_owner: owner,
          p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE,
        }),
        supabase.rpc('count_inquiries_by_type', {
          p_q: q || null, p_year: yearArg, p_status: status, p_owner: owner,
        }),
      ])
      // 늦게 온 낡은 응답은 버린다 — 최신 결과를 덮으면 화면과 주소가 어긋난다.
      if (mine !== reqNo.current) return
      setBusy(false)
      if (list.error || counts.error) {
        console.error('[inquiries] 목록 조회 실패', errorInfo(list.error ?? counts.error))
        setLoadError((list.error ?? counts.error)?.message ?? '목록을 불러오지 못했습니다.')
        return
      }
      setLoadError('')
      const listRows = (list.data ?? []) as ListRow[]
      setRows(listRows)
      const map: Record<string, number> = {}
      for (const c of (counts.data ?? []) as { inquiry_type: string; n: number }[]) {
        map[c.inquiry_type] = Number(c.n)
      }
      setTypeCounts(map)

      // ── 「내용」·「회신」 ──
      // 목록이 그려진 **뒤에** 이어서 받는다. 한 페이지(50건)의 id 를 한 번에 넘긴다.
      // 목록 조회와 묶어 Promise.all 로 보내지 않는 이유 — 이 호출이 실패해도(함수 미적용 등)
      // 목록은 보여야 하고, 두 요청을 묶으면 실패 처리가 한 덩어리가 된다.
      // 앞 페이지의 값을 비워 두지 않는다 — 비우면 새 값이 올 때까지 「-」로 깜빡인다.
      const ids = listRows.map(r => r.id)
      if (ids.length === 0) { setExtras({}); return }
      const ex = await supabase.rpc('inquiry_list_extras', { p_ids: ids })
      if (mine !== reqNo.current) return
      if (ex.error) {
        // 함수가 아직 DB 에 없는 경우도 여기로 온다. 조용히 넘긴다 — 두 열만 「-」가 된다.
        console.error('[inquiries] 내용·회신 조회 실패', errorInfo(ex.error))
        setExtras({})
        return
      }
      const byId: Record<string, InquiryExtras> = {}
      for (const e of (ex.data ?? []) as InquiryExtras[]) byId[e.inquiry_id] = e
      setExtras(byId)
    }
    run()
  }, [authorized, supabase, q, type, year, status, owner, page, reloadKey])

  // 건수가 확정된 뒤 범위를 넘은 페이지면 조용히 마지막 페이지로 옮긴다.
  const total = typeCounts === null
    ? null
    : type
      ? (typeCounts[type] ?? 0)
      : Object.values(typeCounts).reduce((a, b) => a + b, 0)
  useEffect(() => {
    if (total === null) return
    const fixed = clampPage(page, total)
    if (fixed !== page) push({ ...query, page: fixed })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, page])

  // 다음 사용 번호 — 화면이 열릴 때, 발급·등록·취소 직후(reloadKey), 창이 다시 포커스를 받을 때.
  // 예약이 아니라서 남이 먼저 점유하면 달라진다. 보고 있는 동안 낡지 않게 다시 읽는다.
  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    const peek = async () => {
      setPeeking(true)
      try {
        const res = await fetch('/api/inquiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'peek' }),
        })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (res.ok && Array.isArray(json?.counters)) setCounters(json.counters as Counter[])
        // 예전에는 파싱 결과를 그대로 찍어 빈 {} 만 남았다 — 본문이 JSON 이 아니면
        // 대체값이 빈 객체였기 때문이다. 상태 코드·본문 종류·사유를 나눠서 남긴다.
        else console.error('[inquiries] 다음 번호 조회 실패', {
          status: res.status,
          contentType: res.headers.get('content-type'),
          jsonBody: json !== null,
          ...errorInfo(json?.error),
        })
      } catch (e) {
        // fetch 예외(중단·네트워크)는 Error 라서 그대로 찍으면 {} 가 된다.
        if (!cancelled) console.error('[inquiries] 다음 번호 조회 실패', errorInfo(e))
      } finally {
        if (!cancelled) setPeeking(false)
      }
    }
    peek()
    window.addEventListener('focus', peek)
    return () => { cancelled = true; window.removeEventListener('focus', peek) }
  }, [authorized, reloadKey])

  // 담당자 고르기에 쓸 직원 목록 + 나. 기존 모달들과 같은 칸을 읽는다.
  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    const load = async () => {
      const supabase = createClient()
      const [{ data: engs }, { data: auth }] = await Promise.all([
        supabase.from('engineers').select('engineer_id, name, position, resigned_date').order('engineer_id'),
        supabase.auth.getUser(),
      ])
      if (cancelled) return
      setEngineers((engs ?? []) as PickEngineer[])
      const email = auth?.user?.email
      if (!email) return
      const { data: me } = await supabase.from('engineers').select('engineer_id').eq('email', email).maybeSingle()
      if (!cancelled && me) setMyId((me as { engineer_id: number }).engineer_id)
    }
    load()
    return () => { cancelled = true }
  }, [authorized])

  // 카드의 버튼 둘. 어느 카드에서 눌렀는지가 곧 모달의 종류다.
  const startCreate = (t: InquiryType) => setCreateType(t)
  const startRegister = (t: InquiryType) => setRegisterType(t)

  /** 종류를 고른다. 「전체」는 ?type= 을 아예 뺀다. */
  // 종류만 바꾼다 — 연도·상태·담당자·검색어는 그대로 두고 페이지만 1로 돌린다.
  const go = (next: InquiryType | null) => setFilter({ type: next })

  const list = rows ?? []
  // 레일 건수 — 지금 조건(연도·상태·담당자·검색)에서 종류별로 몇 건인가.
  // 종류 조건은 빼고 센다(count_inquiries_by_type). 값이 오기 전에는 빈칸이다.
  const countOf = (t: InquiryType | null): number | null => {
    if (typeCounts === null) return null
    return t ? (typeCounts[t] ?? 0) : Object.values(typeCounts).reduce((a, b) => a + b, 0)
  }
  const words = searchWords(q)
  const filtered = isFiltered(query, thisYear)
  const years = yearOptions(oldestYear, thisYear)
  // 담당자 선택지 — 재직자 + 지금 고른 사람(퇴사했어도 선택이 빈칸이 되지 않게).
  const ownerOptions = engineers.filter(
    e => isCurrentlyEmployed(e.resigned_date, todayKST()) || e.engineer_id === owner,
  )
  const range = total === null ? null : pageRange(page, total)
  /** 상세에서 「목록으로」가 돌아올 주소 — 지금 보던 조건 그대로. */
  const backTo = `/inquiries${toListQueryString(query, thisYear)}`

  // 「오늘」을 렌더마다 새로 만들지 않는다 — 행마다 부르면 같은 목록 안에서 값이 갈릴 수 있다.
  const today = todayKST()
  const here = type ? INQUIRY_TYPE_ITEMS.find(i => i.type === type) : null
  const title = here?.label ?? '전체'

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <style>{SHELL_CSS}</style>

      <div className="iq-shell">
        <div className="iq-body">
          {/* 종류 목록 — 「전체」를 맨 위에 두고 그 아래 여섯 종류(lib/inquiries.ts 순서 그대로) */}
          <nav className="iq-rail" aria-label="의뢰서 종류">
            {/* 종류 필터가 아니다 — 누르면 안내 모달만 열린다. 주소·선택 표시는 그대로 둔다.
                그래서 aria-current 를 주지 않고, 모달이 열려 있어도 선택 스타일을 입히지 않는다. */}
            <div className="iq-deskwrap">
              <button
                ref={deskBtnRef}
                type="button"
                className="iq-typebtn iq-desk"
                onClick={() => setDeskOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  padding: '8px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: 'transparent', color: SUB,
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
                <span>의뢰서 접수 창구 안내</span>
              </button>
            </div>

            {[{ type: null as InquiryType | null, label: '전체' }, ...INQUIRY_TYPE_ITEMS].map(item => {
              const on = item.type === type
              const n = countOf(item.type)
              return (
                <button
                  key={item.type ?? 'all'}
                  type="button"
                  className="iq-typebtn"
                  aria-current={on ? 'page' : undefined}
                  onClick={() => go(item.type)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    padding: '8px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: on ? NEUTRAL_BG : 'transparent',
                    color: on ? TEXT : SUB,
                    fontSize: 13, fontWeight: on ? 700 : 600, fontFamily: 'inherit', textAlign: 'left',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span>{item.label}</span>
                  <span style={{ marginLeft: 'auto', paddingLeft: 6, fontSize: 12, fontWeight: 600, color: MUTED }}>
                    {n === null ? '' : n}
                  </span>
                </button>
              )
            })}
          </nav>

          <div className="iq-main">
            <NextNoBoard
              type={type}
              counters={counters}
              loading={peeking}
              onCreate={startCreate}
              onRegister={startRegister}
              // TEMP-BULK-IMPORT ↓ (지난 파일을 한 번에 넣는 임시 기능. 스위치를 끄면 사라진다)
              rightSlot={BULK_IMPORT_ENABLED ? (
                <button
                  type="button" onClick={() => setBulkOpen(true)}
                  style={{
                    flexShrink: 0, border: `1px solid ${BORDER}`, background: CARD_BG,
                    borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 700,
                    color: MUTED, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                  }}
                >
                  일괄 등록(임시)
                </button>
              ) : undefined}
              // TEMP-BULK-IMPORT ↑
            />

            <div style={cardStyle}>
              <div style={cardHeader}>
                <span style={{ ...cardTitle, fontSize: 20 }}>{title}</span>
                {total !== null && (
                  <span style={countBadge}>
                    {q ? `‘${q}’ 검색 결과 ${total}건` : `${total}건`}
                  </span>
                )}
                {/* 조회 중에는 이전 행을 그대로 두고 이것만 띄운다 — 표가 비었다 차면 눈이 피로하다. */}
                {busy && <span style={{ fontSize: 12, color: MUTED }}>불러오는 중...</span>}
              </div>

              {/* ── 필터 바 ── 리드 화면의 필터 카드와 같은 규칙(inputStyle, 한 줄 flex-wrap). */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
                  <input
                    value={qInput}
                    onChange={e => setQInput(e.target.value)}
                    onCompositionStart={() => { composing.current = true }}
                    onCompositionEnd={e => {
                      composing.current = false
                      setQInput((e.target as HTMLInputElement).value)
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') setFilter({ q: qInput.trim() }) }}
                    placeholder="번호, 업체명, 내용, 파일명 검색"
                    style={{ ...inputStyle, width: '100%', paddingRight: qInput ? 30 : undefined }}
                  />
                  {qInput && (
                    <button
                      type="button" aria-label="검색어 지우기"
                      onClick={() => { setQInput(''); setFilter({ q: '' }) }}
                      style={{
                        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                        border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer',
                        fontSize: 12, padding: 0, lineHeight: 1, fontFamily: 'inherit',
                      }}
                    >
                      ✕
                    </button>
                  )}
                </span>

                <select
                  value={String(year)} aria-label="발행 연도"
                  onChange={e => setFilter({ year: e.target.value === YEAR_ALL ? YEAR_ALL : Number(e.target.value) })}
                  style={inputStyle}
                >
                  <option value={YEAR_ALL}>연도 전체</option>
                  {years.map(y => <option key={y} value={String(y)}>{y}년</option>)}
                </select>

                <select
                  value={status ?? ''} aria-label="상태"
                  onChange={e => setFilter({ status: (e.target.value || null) as ListQuery['status'] })}
                  style={inputStyle}
                >
                  <option value="">상태 전체</option>
                  {INQUIRY_STATUSES.map(v => <option key={v} value={v}>{inquiryStatusLabel(v)}</option>)}
                </select>

                <select
                  value={owner === null ? '' : String(owner)} aria-label="담당자"
                  onChange={e => setFilter({ owner: e.target.value ? Number(e.target.value) : null })}
                  style={inputStyle}
                >
                  <option value="">담당자 전체</option>
                  {ownerOptions.map(e => (
                    <option key={e.engineer_id} value={String(e.engineer_id)}>{engineerLabel(e)}</option>
                  ))}
                </select>

                {/* 기본값에서 벗어난 것이 있을 때만 보인다 — 늘 떠 있으면 누를 이유를 알 수 없다. */}
                {filtered && (
                  <button type="button" onClick={() => router.replace('/inquiries', { scroll: false })}
                    style={btnGhost()}>초기화</button>
                )}
              </div>

              {/* 표 머리 — 카드 끝까지 늘이고 글자만 행과 맞춘다 */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: COL.gap,
                margin: `0 -16px`, padding: `0 ${HEAD_PAD}px 8px`,
                borderBottom: `1px solid ${BORDER}`,
                fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap',
              }}>
                <span className="iq-no" style={{ width: COL.no, flexShrink: 0 }}>번호</span>
                <span style={{ flex: FLEX_TITLE, minWidth: 0 }}>업체명</span>
                <span className="iq-content" style={{ flex: FLEX_CONTENT, minWidth: 0 }}>내용</span>
                <span style={{ width: COL.status, flexShrink: 0 }}>상태</span>
                <span style={{ width: COL.reply, flexShrink: 0 }}>회신</span>
                <span className="iq-person" style={{ width: COL.person, flexShrink: 0 }}>담당자</span>
                <span className="iq-date" style={{ width: COL.date, flexShrink: 0 }}>발행일</span>
              </div>

              {loadError ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#ef4444', fontSize: 13, fontWeight: 700, lineHeight: 1.7 }}>
                  목록을 불러오지 못했습니다<br />
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{loadError}</span>
                </div>
              ) : rows === null ? (
                <div style={{ textAlign: 'center', padding: 40, color: MUTED, fontSize: 13 }}>불러오는 중...</div>
              ) : list.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: MUTED, fontSize: 13, lineHeight: 1.7 }}>
                  {q ? '검색 결과가 없습니다' : type ? `${title} 의뢰서가 없습니다` : '등록된 의뢰서가 없습니다'}
                  {filtered && (
                    <><br />
                      <button type="button" onClick={() => router.replace('/inquiries', { scroll: false })}
                        style={{
                          border: 'none', background: 'transparent', padding: 0, marginTop: 6,
                          color: BLUE, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                        }}>
                        필터 초기화
                      </button>
                    </>
                  )}
                </div>
              ) : (
                list.map((r, i) => {
                  const isCancelled = r.status === 'cancelled'
                  const days = r.status === 'drafting' ? draftingDays(r.issued_date, today) : 0
                  // 흐리게 하는 두 경우 — 취소된 번호(버려진 것)와 오래 붙잡고 있는 작성 중 건.
                  // 목록에서 빼지는 않는다. 번호가 나간 사실 자체는 남아야 한다.
                  const dim = isCancelled || days >= STALE_DAYS
                  const hasHint = Boolean(r.snippet) || r.match_files.length > 0
                  // 「내용」·「회신」 — extras 가 없으면(조회 전·실패·함수 미적용) 둘 다 흐린 「-」가 된다.
                  const ex = extras[r.id]
                  const preview = contentPreview(ex)
                  const reply = replyView(ex)
                  return (
                    <button
                      key={r.id}
                      type="button"
                      // 지금 보던 조건을 들고 간다 — 상세의 화살표가 이 주소로 돌아온다.
                      onClick={() => router.push(`/inquiries/${r.id}?from=${encodeURIComponent(backTo)}`)}
                      onMouseEnter={e => (e.currentTarget.style.background = ROW_HOVER_BG)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      style={{
                        // border 단축 속성은 쓰지 않는다 — rowStyle 이 borderTop(행 구분선)을
                        // 주는데 한 객체에 둘이 섞이면 적용 순서에 따라 결과가 달라진다
                        // (React 가 "conflicting property is set (border)" 로 경고하던 자리다).
                        // 단축 대신 네 변을 개별 속성으로 못 박아 늘 같은 모양이 되게 한다.
                        ...rowStyle(i === 0), display: 'flex',
                        // 보조 줄이 붙으면 세로로 쌓는다. 한 줄일 때의 가운데 정렬은 안쪽 줄이 맡는다.
                        flexDirection: 'column', alignItems: 'stretch', gap: 4,
                        width: '100%', borderRight: 'none', borderBottom: 'none', borderLeft: 'none',
                        background: 'transparent', cursor: 'pointer',
                        fontFamily: 'inherit', textAlign: 'left',
                        opacity: dim ? 0.5 : 1,
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: COL.gap, width: '100%' }}>
                      {/* 번호가 맨 앞이다 — 사람이 번호로 찾는다. 고정 폭이라 줄이 흔들리지 않고,
                          줄바꿈을 막아 두 줄로 벌어지지 않는다. */}
                      <span className="iq-no" style={{
                        width: COL.no, flexShrink: 0, fontSize: 13, fontWeight: 700, color: TEXT,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        textDecoration: isCancelled ? 'line-through' : 'none',
                      }}>
                        <Hi text={r.inquiry_no} words={words} />
                      </span>
                      <span style={{
                        flex: FLEX_TITLE, minWidth: 0, fontSize: 13,
                        color: r.title?.trim() ? TEXT : MUTED,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {r.title?.trim()
                          ? <Hi text={r.title} words={words} />
                          : '(업체명 없음)'}
                      </span>
                      {/* 내용 — 가장 최근 내용 기록 한 줄. 없으면 그 기록의 첫 파일 이름, 둘 다 없으면 「-」.
                          extras 가 아직 없거나(조회 전·실패) 함수가 DB 에 없으면 preview.kind 가 'none' 이다. */}
                      <span className="iq-content" style={{ flex: FLEX_CONTENT, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {preview.kind === 'none' ? (
                          <span style={{ fontSize: 12, color: FAINT }}>-</span>
                        ) : (<>
                          {preview.kind === 'file' && <Clip />}
                          <span
                            title={preview.text}
                            style={{
                              minWidth: 0, fontSize: 12,
                              color: preview.kind === 'body' ? SUB : MUTED,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                          >
                            {preview.text}
                          </span>
                        </>)}
                      </span>
                      {/* 상태 — 색은 dot 에만 주고 글자는 중립으로 둔다(디자인 규칙).
                          며칠째인지는 칸 전체의 title 로 옮겼다 — 목록에 숫자가 줄줄이 서면 읽을 것이 늘고,
                          정작 필요한 때(오래 끌고 있는 건)는 행 흐림으로 이미 드러난다. */}
                      <span
                        title={days > 0 ? `작성 중 ${days}일째` : undefined}
                        style={{
                        width: COL.status, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
                        fontSize: 13, color: SUB, whiteSpace: 'nowrap', minWidth: 0,
                      }}>
                        <span style={{
                          width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                          background: INQUIRY_STATUS_DOT[r.status as InquiryStatus] ?? '#d1d5db',
                        }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {inquiryStatusLabel(r.status)}
                        </span>
                        {/* 작성 중인 건만. 행 전체가 button 이라 안에 또 button 을 넣으면 HTML 파서가
                            바깥 button 을 그 자리에서 닫아 행이 쪼개진다 — 그래서 span 에 role 을 준다.
                            클릭·키보드 모두 전파를 막아 상세로 이동하지 않게 한다. */}
                        {r.status === 'drafting' && (
                          <span
                            role="button" tabIndex={0}
                            aria-label={`${r.inquiry_no} 작성 완료`}
                            onClick={e => { e.stopPropagation(); setCompleteFor(r) }}
                            onKeyDown={e => {
                              if (e.key !== 'Enter' && e.key !== ' ') return
                              e.preventDefault(); e.stopPropagation(); setCompleteFor(r)
                            }}
                            style={{
                              // 라벨 바로 뒤다(오른쪽 끝으로 밀지 않는다) — 눈이 '작성 중' 을 읽은 자리에서
                              // 바로 누를 수 있다. 칸 안 gap(6) 에 2 를 더해 8 로 띄운다.
                              marginLeft: 2, flexShrink: 0, cursor: 'pointer',
                              background: BLUE, color: '#ffffff', borderRadius: 6,
                              padding: '3px 8px', fontSize: 11, fontWeight: 700, lineHeight: '16px',
                            }}
                          >
                            작성 완료
                          </span>
                        )}
                      </span>
                      {/* 회신 — 회신 기록이 하나라도 있으면 뱃지, 없으면 「-」. 「대기」 같은 말은 쓰지 않는다
                          (아직 안 온 것인지 받을 것이 없는 것인지 목록에서는 알 수 없다 — lib/inquirySearch replyView). */}
                      <span
                        title={reply?.title}
                        style={{ width: COL.reply, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}
                      >
                        {reply === null ? (
                          <span style={{ fontSize: 12, color: FAINT }}>-</span>
                        ) : (<>
                          <span style={{
                            flexShrink: 0, borderRadius: 99, padding: '1px 8px',
                            background: REPLY_COLOR.bg, color: REPLY_COLOR.text,
                            fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                          }}>
                            {reply.label}
                          </span>
                          {reply.fileCount > 0 && (<>
                            <Clip />
                            <span className="num" style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{reply.fileCount}</span>
                          </>)}
                        </>)}
                      </span>
                      <span className="iq-person" style={{ width: COL.person, flexShrink: 0, fontSize: 12, color: SUB, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {engineerLabel({ name: r.owner_name, position: r.owner_position }) || '-'}
                      </span>
                      <span className="iq-date" style={{ width: COL.date, flexShrink: 0, fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>
                        {dateText(r.issued_date)}
                      </span>
                      </span>

                      {/* 검색어가 번호·업체명이 아닌 곳에서 걸렸을 때만 — 어디서 맞았는지 알려 준다. */}
                      {hasHint && (
                        <span style={{
                          display: 'block', paddingLeft: COL.no + COL.gap,
                          fontSize: 11, color: MUTED, lineHeight: 1.6,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {r.snippet && (
                            <span>내용 · <Hi text={r.snippet} words={words} /></span>
                          )}
                          {r.snippet && r.match_files.length > 0 && <span style={{ color: FAINT }}> / </span>}
                          {r.match_files.length > 0 && (
                            <span>파일 · <Hi text={r.match_files.join(', ')} words={words} /></span>
                          )}
                        </span>
                      )}
                    </button>
                  )
                })
              )}

              {/* ── 페이지 ── 한 페이지뿐이면 버튼은 감추고 건수만 남긴다. */}
              {total !== null && total > 0 && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                  paddingTop: 12, marginTop: 4, borderTop: `1px solid ${BORDER}`,
                }}>
                  <span style={{ fontSize: 12, color: MUTED }}>
                    총 {total}건{range && ` 중 ${range.from}–${range.to}`}
                  </span>
                  {totalPages(total) > 1 && (
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <button type="button" disabled={page <= 1}
                        onClick={() => push({ ...query, page: page - 1 })}
                        style={{ ...btnGhost(page <= 1), padding: '5px 10px', fontSize: 12 }}>이전</button>
                      {pageWindow(page, total).map((p, i) => (
                        p === '…'
                          ? <span key={`gap-${i}`} style={{ fontSize: 12, color: FAINT, padding: '0 2px' }}>…</span>
                          : (
                            <button
                              key={p} type="button"
                              aria-current={p === page ? 'page' : undefined}
                              onClick={() => push({ ...query, page: p })}
                              style={{
                                border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12,
                                fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                                background: p === page ? BLUE : NEUTRAL_BG,
                                color: p === page ? '#ffffff' : SUB,
                              }}
                            >
                              {p}
                            </button>
                          )
                      ))}
                      <button type="button" disabled={page >= totalPages(total)}
                        onClick={() => push({ ...query, page: page + 1 })}
                        style={{ ...btnGhost(page >= totalPages(total)), padding: '5px 10px', fontSize: 12 }}>다음</button>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {createType && (
        <CreateModal
          type={createType}
          onClose={() => setCreateType(null)}
          onCreated={() => setReloadKey(k => k + 1)}
        />
      )}

      {registerType && (
        <RegisterModal
          type={registerType}
          engineers={engineers}
          myId={myId}
          onClose={() => setRegisterType(null)}
          onDone={() => setReloadKey(k => k + 1)}
        />
      )}

      {/* TEMP-BULK-IMPORT ↓ */}
      {deskOpen && (
        <DeskGuideModal onClose={() => { setDeskOpen(false); deskBtnRef.current?.focus() }} />
      )}

      {bulkOpen && (
        <BulkImportModal
          engineers={engineers}
          myId={myId}
          onClose={() => setBulkOpen(false)}
          onDone={() => setReloadKey(k => k + 1)}
        />
      )}
      {/* TEMP-BULK-IMPORT ↑ */}

      {/* 작성 완료 — 상세 화면과 같은 모달을 쓴다. 끝나면 목록을 다시 읽어 상태가 바로 바뀐다. */}
      {completeFor && (
        <CompleteModal
          inquiryId={completeFor.id}
          inquiryNo={completeFor.inquiry_no}
          title={completeFor.title}
          onClose={() => setCompleteFor(null)}
          onDone={() => setReloadKey(k => k + 1)}
        />
      )}
    </main>
  )
}

/** useSearchParams 는 Suspense 안에서만 쓸 수 있다(결재 화면과 같은 껍데기). */
export default function InquiriesPage() {
  return (
    <Suspense fallback={<main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }} />}>
      <InquiriesPageInner />
    </Suspense>
  )
}
