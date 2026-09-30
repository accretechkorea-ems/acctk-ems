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
//   · 본문: 번호 · 제목 · 상태 · 담당자 · 발행일. 발행일 내림차순, 같으면 순번 내림차순.
// 그 패턴이 공용 컴포넌트가 아니라 그 파일 안의 인라인 CSS 라 복사밖에 방법이 없다.
// 셋째 화면이 같은 배치를 쓰게 되면 그때 공용으로 뽑는 편이 낫다.
//
// 보는 자리는 주소(?type=)가 원본이다 — 새로고침·뒤로 가기에도 고른 종류가 남는다.
//
// 목록은 브라우저 supabase 클라이언트로 직접 읽는다. RLS(inquiries_select)가
// has_team_perm('customers') 로 걸러 주므로 화면이 따로 거르지 않는다.

import { Suspense, useEffect, useState } from 'react'
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
  cardStyle, cardHeader, cardTitle, countBadge, rowStyle, rowTitle, rowSub,
  btnPrimary, btnGhost,
} from '@/components/common/ui'
import {
  INQUIRY_TYPE_ITEMS, INQUIRY_TYPE_LABEL, inquiryTypeOf, inquiryStatusLabel,
  INQUIRY_STATUS_DOT, EDITABLE_STATUSES, REQ80_SERIES, previewInquiryNo, buildInquiryNo,
  type InquiryStatus, type InquiryType,
} from '@/lib/inquiries'
import { isCurrentlyEmployed } from '@/lib/engineers'

/** 결재 화면과 같은 전환 기준. 두 화면의 레일이 다르게 움직이면 어색하다. */
const MOTION_MS = 140
const MOTION_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

/** 표 열 폭 — 머리와 행이 같은 값을 써야 줄이 맞는다(결재 화면과 같은 방식). */
const COL = { status: 108, person: 96, date: 92, gap: 10 }
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
  @container (max-width: 900px) {
    .iq-body { flex-direction: column; }
    .iq-rail { width: 100%; flex-direction: row; overflow-x: auto; gap: 4px; align-items: center; }
    .iq-typebtn { width: auto !important; flex: 0 0 auto; }
  }
  @media (prefers-reduced-motion: reduce) {
    .iq-shell, .iq-shell * { transition: none !important; animation: none !important; }
  }
`

/** 목록 한 줄. engineers 는 제약 이름을 명시해 가져온다(아래 SELECT 주석 참고). */
type InquiryRow = {
  id: string
  inquiry_no: string
  title: string | null
  status: string
  inquiry_type: string
  seq: number
  issued_date: string
  engineers: { name: string | null } | null
}

/**
 * inquiries 는 engineers 를 여러 번 참조하게 될 표다(지금은 created_by 하나지만
 * 담당자·완료자가 붙을 예정). 지금부터 제약 이름을 박아 두면 칸이 늘어도 조회가 깨지지 않는다.
 * 이름을 생략하면 PGRST201(300 Multiple Choices)로 조회 전체가 실패한다 —
 * quotes·suggestions 에서 이미 겪은 일이다(lib/partSearch.ts:10 참고).
 */
const SELECT_COLUMNS =
  'id, inquiry_no, title, status, inquiry_type, seq, issued_date, engineers!inquiries_created_by_fkey(name)'

const dateText = (ymd: string | null): string => (ymd ? ymd.replace(/-/g, '.') : '')

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
  const [status, setStatus] = useState<string>('done')
  const [createdBy, setCreatedBy] = useState<number | ''>(myId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  const send = async (confirmBump: boolean): Promise<void> => {
    const res = await fetch('/api/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'register', type, issued_date: issuedDate,
        equipment_series: needsSeries ? series : undefined,
        seq: seqNum, title, status, created_by: createdBy,
        ...(confirmBump ? { confirm_bump: true } : {}),
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setError(json.error || `등록하지 못했습니다 (${res.status})`); return }

    // 건너뛰는 번호가 생긴다 — 사람에게 알리고 같은 요청을 다시 보낸다.
    if (json.needs_confirm) {
      const ok = await confirmDialog({
        title: '번호를 건너뜁니다',
        message: `${json.skipped_from}~${json.skipped_to}번은 사용된 번호가 되고, `
          + `다음 사용 번호가 ${json.next_after}번이 됩니다.`,
        confirmText: '등록',
        variant: 'danger',
      })
      if (!ok) return
      await send(true)
      return
    }

    toast.success(`${json.inquiry?.inquiry_no ?? ''} 등록했습니다`)
    onDone()
    onClose()
  }

  const submit = async () => {
    if (busy || !ready) return
    setBusy(true)
    setError('')
    try {
      await send(false)
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
        background: CARD_BG, borderRadius: 8, padding: '14px 16px', width: '100%', maxWidth: 460,
        maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
      }}>
        {/* 종류는 카드에서 정해져 들어온다 — 모달 안에서 고르지 않고 제목으로 보여 준다. */}
        <div style={cardHeader}>
          <span style={cardTitle}>기존 번호 등록 — {INQUIRY_TYPE_LABEL[type]}</span>
        </div>

        <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.7, marginBottom: 12 }}>
          이미 바깥으로 나간 번호를 기록에 남깁니다. 번호는 직접 정합니다.
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle} htmlFor="rg-date">발행일</label>
          <input id="rg-date" type="date" value={issuedDate} onChange={e => setIssuedDate(e.target.value)}
            style={{ ...fieldStyle, colorScheme: 'light' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: needsSeries ? '1fr 1fr' : '1fr', gap: 10, marginBottom: 12 }}>
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

        {/* 미리보기 — 형식을 눈으로 확인한다 */}
        <div style={{
          background: NEUTRAL_BG, borderRadius: 8, padding: '12px 14px', marginBottom: 12,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 4 }}>등록될 번호</div>
          <div style={{
            fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px', wordBreak: 'break-all',
            color: preview ? BLUE : MUTED,
          }}>
            {preview || '입력을 채우면 번호가 보입니다'}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="rg-status">상태</label>
            <select id="rg-status" value={status} onChange={e => setStatus(e.target.value)} style={fieldStyle}>
              {EDITABLE_STATUSES.map(v => <option key={v} value={v}>{inquiryStatusLabel(v)}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="rg-owner">담당자</label>
            <select id="rg-owner" value={createdBy} style={fieldStyle}
              onChange={e => setCreatedBy(e.target.value ? Number(e.target.value) : '')}>
              <option value="">고르기</option>
              {selectable.map(e => (
                <option key={e.engineer_id} value={e.engineer_id}>{`${e.name ?? ''} ${e.position ?? ''}`.trim()}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle} htmlFor="rg-title">제목 <span style={{ fontWeight: 500 }}>(선택)</span></label>
          <input id="rg-title" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} style={fieldStyle} />
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
              목록에 「작성 중」으로 추가되었습니다. 제목과 상태는 그 건을 눌러 고칠 수 있습니다.
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
              <label style={label} htmlFor="iq-title">제목 <span style={{ fontWeight: 500 }}>(선택)</span></label>
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
  type, counters, loading, onCreate, onRegister,
}: {
  /** 한 종류만 볼 때. null 이면 6종 전부. */
  type: InquiryType | null
  counters: Counter[] | null
  loading: boolean
  onCreate: (t: InquiryType) => void
  onRegister: (t: InquiryType) => void
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
      <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7, marginTop: 8 }}>{PEEK_NOTICE}</div>
    </div>
  )
}

function InquiriesPageInner() {
  const { loading: guardLoading, authorized } = usePageGuard()
  const router = useRouter()
  const params = useSearchParams()

  // 고른 종류. 주소가 원본이라 새로고침·뒤로 가기에도 남는다. 모르는 값이면 「전체」.
  const type: InquiryType | null = inquiryTypeOf(params.get('type'))

  const [rows, setRows] = useState<InquiryRow[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  // 모달은 카드에서만 열린다. 값이 있으면 그 종류로 열려 있다는 뜻이다
  // (따로 open 플래그를 두지 않는다 — 두 값이 어긋날 자리를 만들지 않으려고).
  const [createType, setCreateType] = useState<InquiryType | null>(null)
  const [registerType, setRegisterType] = useState<InquiryType | null>(null)
  const [counters, setCounters] = useState<Counter[] | null>(null)
  const [peeking, setPeeking] = useState(false)
  const [engineers, setEngineers] = useState<PickEngineer[]>([])
  const [myId, setMyId] = useState<number | null>(null)
  // 발급 뒤 목록을 다시 읽는 방아쇠. 값이 바뀌면 아래 효과가 다시 돈다.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    const load = async () => {
      setRows(null)
      setLoadError(false)
      const supabase = createClient()
      // 정렬은 DB 에서 한다 — 발행일 내림차순, 같은 날이면 순번 내림차순(그날 나중에 나간 것이 위).
      const { data, error } = await supabase
        .from('inquiries')
        .select(SELECT_COLUMNS)
        .order('issued_date', { ascending: false })
        .order('seq', { ascending: false })
      if (cancelled) return
      if (error) {
        // 빈 목록과 조회 실패는 구분해서 보여준다 — 둘 다 빈 화면이면 장애를 알아챌 수 없다.
        console.error('[inquiries] 목록 조회 실패', error)
        setLoadError(true)
        setRows([])
        return
      }
      setRows((data ?? []) as unknown as InquiryRow[])
    }
    load()
    return () => { cancelled = true }
  }, [authorized, reloadKey])

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
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.ok && Array.isArray(json.counters)) setCounters(json.counters as Counter[])
        else console.error('[inquiries] 다음 번호 조회 실패', json)
      } catch (e) {
        if (!cancelled) console.error('[inquiries] 다음 번호 조회 실패', e)
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
  const go = (next: InquiryType | null) => {
    router.replace(next ? `/inquiries?type=${next}` : '/inquiries')
  }

  // 거르기는 화면에서 한다 — 종류를 옮길 때마다 다시 읽지 않는다(건수가 많지 않다).
  const all = rows ?? []
  const shown = type ? all.filter(r => r.inquiry_type === type) : all
  const countOf = (t: InquiryType | null) =>
    rows === null ? null : (t ? all.filter(r => r.inquiry_type === t).length : all.length)

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
            />

            <div style={cardStyle}>
              <div style={cardHeader}>
                <span style={{ ...cardTitle, fontSize: 20 }}>{title}</span>
                {rows !== null && <span style={countBadge}>{shown.length}건</span>}
              </div>

              {/* 표 머리 — 카드 끝까지 늘이고 글자만 행과 맞춘다 */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: COL.gap,
                margin: `-6px -16px 0`, padding: `0 ${HEAD_PAD}px 8px`,
                borderBottom: `1px solid ${BORDER}`,
                fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap',
              }}>
                <span style={{ flex: 1, minWidth: 0 }}>제목 / 번호</span>
                <span style={{ width: COL.status, flexShrink: 0 }}>상태</span>
                <span style={{ width: COL.person, flexShrink: 0 }}>담당자</span>
                <span style={{ width: COL.date, flexShrink: 0 }}>발행일</span>
              </div>

              {rows === null ? (
                <div style={{ textAlign: 'center', padding: 40, color: MUTED, fontSize: 13 }}>불러오는 중...</div>
              ) : loadError ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#ef4444', fontSize: 13, fontWeight: 700 }}>
                  목록을 불러오지 못했습니다
                </div>
              ) : shown.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: MUTED, fontSize: 13, lineHeight: 1.7 }}>
                  {type ? `${title} 의뢰서가 없습니다` : '등록된 의뢰서가 없습니다'}
                </div>
              ) : (
                shown.map((r, i) => {
                  const isCancelled = r.status === 'cancelled'
                  const days = r.status === 'drafting' ? draftingDays(r.issued_date, today) : 0
                  // 흐리게 하는 두 경우 — 취소된 번호(버려진 것)와 오래 붙잡고 있는 작성 중 건.
                  // 목록에서 빼지는 않는다. 번호가 나간 사실 자체는 남아야 한다.
                  const dim = isCancelled || days >= STALE_DAYS
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => router.push(`/inquiries/${r.id}`)}
                      onMouseEnter={e => (e.currentTarget.style.background = ROW_HOVER_BG)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      style={{
                        ...rowStyle(i === 0), display: 'flex', alignItems: 'center', gap: COL.gap,
                        width: '100%', border: 'none', background: 'transparent', cursor: 'pointer',
                        fontFamily: 'inherit', textAlign: 'left',
                        opacity: dim ? 0.5 : 1,
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ ...rowTitle, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.title?.trim() || '(제목 없음)'}
                        </span>
                        <span style={{
                          ...rowSub, display: 'block',
                          textDecoration: isCancelled ? 'line-through' : 'none',
                        }}>
                          {r.inquiry_no}
                        </span>
                      </span>
                      {/* 상태 — 색은 dot 에만 주고 글자는 중립으로 둔다(디자인 규칙).
                          작성 중이면 며칠째인지 함께 보인다. */}
                      <span style={{
                        width: COL.status, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
                        fontSize: 13, color: SUB, whiteSpace: 'nowrap',
                      }}>
                        <span style={{
                          width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                          background: INQUIRY_STATUS_DOT[r.status as InquiryStatus] ?? '#d1d5db',
                        }} />
                        {days > 0 ? `작성 중 ${days}일째` : inquiryStatusLabel(r.status)}
                      </span>
                      <span style={{ width: COL.person, flexShrink: 0, fontSize: 12, color: SUB, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.engineers?.name ?? '-'}
                      </span>
                      <span style={{ width: COL.date, flexShrink: 0, fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>
                        {dateText(r.issued_date)}
                      </span>
                    </button>
                  )
                })
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
