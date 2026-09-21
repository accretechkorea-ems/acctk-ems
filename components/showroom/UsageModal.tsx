'use client'

// 쇼룸 사용 신청 · 사용 기록 수정 모달. 장비 카드 [사용 신청], 전체기록 탭 [사용 신청]·수정·복사,
// 「내 사용 신청」 [재작성]이 모두 이 모달을 연다. 엑셀 「장비 사용승인서」 항목을 담는다.
//
// 2026-09-21 — 목적 5종(측정대행·고객 데모·유지보수·교육·기타)이 전부 신청·승인을 거친다.
//   새로 쓰는 것(복사 포함)·반려 건 재작성 → 사용 신청(/api/showroom/requests, 관리자 승인)
//   이미 있는 기록을 고치는 것             → 사용 기록 수정(/api/showroom/usage PATCH)
//     사전·사후는 사용일자로 정한다(고르는 칸이 없다) — 오늘 뒤면 사전 신청(승인되면 사용 기록이 생긴다),
//     오늘까지면 사후 신청(사용 기록이 바로 생기고 관리자 확인을 받는다). 서버도 날짜로 다시 판정한다.
//     신청할 때는 결과·견적 연결이 없다 — 승인된 뒤 만들어진 사용 기록을 수정할 때 적는다.
//   신청으로 만든 기록은 목적을 바꿀 수 없고, 다른 목적의 기록을 고객 데모로 바꿀 수도 없다(서버도 막는다).
// 반려된 신청 재작성은 그 신청의 목적으로 고정되고 PATCH 로 다시 신청한다.
//
// 모달 껍데기·입력칸 치수는 ServiceAddModal.tsx:88-296 과 같고, 폭은 900(좁은 화면은 90vw)이다.
// 어떤 칸이 보이는지는 lib/showroom.ts 의 PURPOSE_FIELDS(사용 기록)·requestHasField(신청)가 정하고,
// 라우트도 같은 표로 거른다. 목적을 바꾸면 새 목적에 없는 칸의 값은 지운다. 섹션은 접지 않는다.
// 본문은 2열 — 좌: 사용 정보(공통) · 고객 / 보안 · 영업 연결 / 우: 작업 내용 · 결과(신청이면 기대결과만).
// 신청 사유 칸은 따로 없다 — 상세 내용이 곧 사유라 서버가 같은 값을 approval_requests.reason 에 넣는다.
// 760px 미만은 한 열. 비고는 두 열 중 짧은 쪽 끝에 붙인다 — 고객 데모 기록(항목이 가장 많다)은 좌측, 나머지는 우측.
// 신규 작성은 목적이 비어 있고, 고르기 전에는 목적별 칸 자리에 안내만 보인다.

import { useState, type CSSProperties, type ReactNode } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { toMin, computeWorkHours, lunchOverlapHours } from '@/lib/workHours'
import { getCategoryColor } from '@/lib/categoryColors'
import { todayKST } from '@/lib/date'
import { numKR } from '@/components/customer/constants'
import {
  USAGE_PURPOSES, USAGE_PURPOSE_COLORS, NDA_STATUSES, RESULT_CATEGORIES, DEMO_PURPOSE,
  purposeNeedsCustomer, purposeHasField, requestHasField, requestPurpose, isRetroactiveDate, deviceTitle,
  DEFAULT_START_TIME, DEFAULT_END_TIME, type DemoRequestRow, type ShowroomDevice, type UsageField,
} from '@/lib/showroom'
import { BLUE, BLUE_HOVER, BORDER, CARD_BG, TEXT, SUB, MUTED, FAINT, DANGER, NEUTRAL_BG } from '@/components/common/ui'
import TimeStepper from './TimeStepper'
import EngineerPicker, { type PickerEngineer } from './EngineerPicker'
import CustomerSearch, { type CustomerHit } from './CustomerSearch'
import QuotePicker, { type QuoteHit } from './QuotePicker'

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: SUB, marginBottom: 6, display: 'block' }
// 모바일에서 iOS 자동 확대를 막으려면 입력 글자가 16 이어야 한다(기존 모달과 같은 값).
const fieldStyle: CSSProperties = {
  width: '100%', height: 44, padding: '0 12px', border: `1px solid ${BORDER}`, borderRadius: 6,
  boxSizing: 'border-box', color: TEXT, background: CARD_BG, outline: 'none', fontSize: 16, fontFamily: 'inherit',
}
const dateFieldStyle: CSSProperties = { ...fieldStyle, colorScheme: 'light' }
const areaStyle: CSSProperties = {
  width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 6,
  boxSizing: 'border-box', color: TEXT, background: CARD_BG, outline: 'none', fontSize: 16,
  resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit',
}

// 2열 본문. 760px 미만은 한 열, 480px 미만은 칸 안의 2칸 줄도 한 칸으로.
const LAYOUT_CSS = `
  @keyframes modal-in {
    from { opacity: 0; transform: scale(0.97) translateY(8px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }
  .sr-mcols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
  .sr-mcol { display: grid; gap: 12px; min-width: 0; }
  .sr-row2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
  @media (max-width: 759px) { .sr-mcols { grid-template-columns: minmax(0, 1fr); gap: 12px; } }
  @media (max-width: 479px) { .sr-row2 { grid-template-columns: minmax(0, 1fr); } }
`

/** 섹션 제목. 열 안에서 둘째 섹션부터는 위를 조금 띄운다. */
function SectionTitle({ children, spaced }: { children: ReactNode; spaced?: boolean }) {
  return (
    <div data-section="" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: spaced ? 12 : 4 }}>
      <div style={{ width: 3, height: 14, background: BLUE, borderRadius: 6, flexShrink: 0 }} />
      <span style={{ fontWeight: 800, fontSize: 13, color: TEXT }}>{children}</span>
    </div>
  )
}

const purposeColor = (p: string): string => {
  const c = getCategoryColor(USAGE_PURPOSE_COLORS, p)
  return c.dot ?? c.text
}

/** 사용 기록 저장 본문(/api/showroom/usage). 목적에 없는 칸은 null(외부반출은 false) — 라우트도 같은 규칙으로 다시 거른다. */
export type UsagePayload = {
  device_id: number
  usage_date: string
  start_time: string
  end_time: string
  purpose: string
  project_name: string | null
  customer_id: number | null
  customer_dept: string | null
  content: string | null
  sample_material: string | null
  carried_out: boolean
  expected_cost: number | null
  nda_status: string | null
  expected_result: string | null
  result: string | null
  result_category: string | null
  issue: string | null
  follow_up: string | null
  quote_id: number | null
  note: string | null
  engineer_ids: number[]
}

/**
 * 사용 신청 본문(/api/showroom/requests). 사전·사후는 서버가 사용일자로 정한다(플래그를 보내지 않는다).
 * 목적에 없는 칸은 빈 값으로 보내고, 서버도 같은 표로 다시 거른다.
 */
export type DemoRequestBody = {
  device_id: number
  usage_date: string
  start_time: string
  end_time: string
  engineer_ids: number[]
  purpose: string
  project_name: string
  content: string
  /** 측정대행·고객 데모만 필수. 나머지 목적은 null */
  customer_id: number | null
  customer_dept: string
  nda_status: string | null
  expected_result: string
  sample_material: string
  carried_out: boolean
  expected_cost: number | null
  note: string
}

/** 모달이 부모에게 넘기는 저장 요청 — 무엇을 어디로 보낼지 모달이 정한다(showroomData saveSubmission). */
export type UsageSubmission =
  | { kind: 'usage'; usageId: number | null; payload: UsagePayload }
  | { kind: 'request'; requestId: number | null; body: DemoRequestBody }

export type UsageInitial = {
  /** 있으면 그 기록을 수정한다. null 이면 채워진 값으로 새로 쓴다(복사로 연 경우). */
  usage_id: number | null
  /** 데모 신청으로 만든 기록이면 그 신청 — 목적을 바꿀 수 없다 */
  request_id: number | null
  device_id: number
  usage_date: string
  start_time: string
  end_time: string
  purpose: string
  project_name: string
  customer: CustomerHit | null
  customer_dept: string
  content: string
  sample_material: string
  carried_out: boolean
  expected_cost: number | null
  nda_status: string | null
  expected_result: string
  result: string
  result_category: string | null
  issue: string
  follow_up: string
  quote: QuoteHit | null
  note: string
  engineer_ids: number[]
}

type Props = {
  /** 사용 기록 수정·복사의 값. null 이면 신규 작성. */
  initial: UsageInitial | null
  /** 반려된 데모 신청 재작성 — 주면 목적이 고객 데모로 고정되고 그 신청을 다시 보낸다(PATCH). */
  rewrite?: DemoRequestRow | null
  /** 미리 고를 장비(카드에서 열었을 때). initial·rewrite 가 있으면 무시된다. */
  presetDeviceId?: number | null
  devices: ShowroomDevice[]
  engineers: PickerEngineer[]
  currentUserEngineerId: number | null
  onClose: () => void
  /** 저장 성공이면 null, 실패면 화면에 띄울 메시지를 돌려준다. */
  onSubmit: (submission: UsageSubmission) => Promise<string | null>
}

/** 천 단위 콤마가 붙은 문자열에서 숫자만 뽑는다. */
const digits = (s: string) => s.replace(/[^0-9]/g, '')

export default function UsageModal({
  initial, rewrite, presetDeviceId, devices, engineers, currentUserEngineerId, onClose, onSubmit,
}: Props) {
  const today = todayKST()
  // 재작성이면 반려된 신청의 내용으로, 아니면 기록(수정·복사) 값으로 채운다. 둘 다 없으면 빈 값.
  const rp = rewrite?.payload ?? null
  const cost0 = rp ? rp.expected_cost : initial?.expected_cost ?? null

  // ── 공통: 사용 정보 ──
  const [deviceId, setDeviceId] = useState<number | null>(
    rp?.device_id ?? initial?.device_id ?? presetDeviceId ?? devices[0]?.device_id ?? null
  )
  const [usageDate, setUsageDate] = useState(rp?.usage_date ?? initial?.usage_date ?? today)
  const [startTime, setStartTime] = useState(rp?.start_time ?? initial?.start_time ?? DEFAULT_START_TIME)
  const [endTime, setEndTime] = useState(rp?.end_time ?? initial?.end_time ?? DEFAULT_END_TIME)
  const [engineerIds, setEngineerIds] = useState<number[]>(
    rp?.engineer_ids ?? initial?.engineer_ids ?? (currentUserEngineerId ? [currentUserEngineerId] : [])
  )
  const [expandEngineers, setExpandEngineers] = useState(false)

  // ── 사용목적 — 신규 작성은 비어 있다. 재작성은 고객 데모로 고정 ──
  const [purpose, setPurpose] = useState<string>(rp ? requestPurpose(rp) : initial?.purpose ?? '')

  // ── 목적별 칸 ──
  const [projectName, setProjectName] = useState(rp?.project_name ?? initial?.project_name ?? '')
  const [content, setContent] = useState(rp?.content ?? initial?.content ?? '')
  const [sampleMaterial, setSampleMaterial] = useState(rp?.sample_material ?? initial?.sample_material ?? '')
  const [carriedOut, setCarriedOut] = useState(rp?.carried_out ?? initial?.carried_out ?? false)
  const [expectedCost, setExpectedCost] = useState(cost0 != null ? numKR(cost0) : '')
  const [customer, setCustomer] = useState<CustomerHit | null>(
    // 대상 고객사가 없는 목적(유지보수·교육·기타)의 재작성은 고객 칸 자체가 없다.
    rp && rp.customer_id != null
      ? { customer_id: rp.customer_id, company_name: rp.customer_name ?? '', address: null, status: null }
      : initial?.customer ?? null
  )
  const [customerDept, setCustomerDept] = useState(rp?.customer_dept ?? initial?.customer_dept ?? '')
  const [ndaStatus, setNdaStatus] = useState(rp?.nda_status ?? initial?.nda_status ?? '')
  const [expectedResult, setExpectedResult] = useState(rp?.expected_result ?? initial?.expected_result ?? '')
  const [resultCategory, setResultCategory] = useState(initial?.result_category ?? '')
  const [result, setResult] = useState(initial?.result ?? '')
  const [issue, setIssue] = useState(initial?.issue ?? '')
  const [followUp, setFollowUp] = useState(initial?.follow_up ?? '')
  const [quote, setQuote] = useState<QuoteHit | null>(initial?.quote ?? null)
  const [note, setNote] = useState(initial?.note ?? '')

  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { errors, clearError, validate } = useFieldErrors<'device' | 'usage_date' | 'purpose' | 'customer' | 'engineers'>()

  // 실사용시간 = 점심(12:00~13:00)을 뺀 작업시간. 저장할 때 서버가 같은 식으로 다시 계산한다.
  const orderValid = toMin(endTime) > toMin(startTime)
  const lunchHours = lunchOverlapHours(startTime, endTime)
  const workHours = computeWorkHours(startTime, endTime)
  const timeValid = orderValid && workHours > 0

  // ── 이 모달이 무엇을 만드는지 ──
  const editing = initial?.usage_id != null
  const rewriting = rewrite != null
  /** 사용 신청을 만드는지 — 새로 쓰는 것(복사 포함)과 재작성. 기존 기록 수정만 신청이 아니다. */
  const asRequest = rewriting || !editing
  const retroactive = isRetroactiveDate(usageDate, today)
  /** 사전 신청 — 시간이 '계획'이다 */
  const planned = asRequest && !retroactive
  /** 목적을 바꿀 수 없음 — 재작성, 신청으로 만든 기록의 수정 */
  const purposeLocked = rewriting || (editing && initial?.request_id != null)
  /** 다른 목적의 기존 기록은 고객 데모로 바꿀 수 없다(데모는 신청으로만 들어온다) */
  const demoBlocked = editing && initial?.purpose !== DEMO_PURPOSE

  const chosen = purpose !== ''
  /** 그 목적·방식에서 보이는 칸. 신청이면 결과·견적 연결을 뺀 목적별 항목, 사용 기록이면 목적별 항목 전부. */
  const fieldsOf = (p: string, request: boolean) => (f: UsageField) =>
    request ? requestHasField(p, f) : purposeHasField(p, f)
  const has = fieldsOf(purpose, asRequest)
  const needsCustomer = purposeNeedsCustomer(purpose)

  /** 목적을 바꾸면 새 목적(방식)에 없는 칸의 값을 지운다 — 보이지 않는 값이 저장되지 않게. */
  const choosePurpose = (next: string) => {
    setPurpose(next)
    clearError('purpose')
    clearError('customer')
    const keep = fieldsOf(next, rewriting || !editing)
    if (!keep('project_name')) setProjectName('')
    if (!keep('content')) setContent('')
    if (!keep('customer')) { setCustomer(null); setQuote(null) }
    if (!keep('customer_dept')) setCustomerDept('')
    if (!keep('nda_status')) setNdaStatus('')
    if (!keep('expected_result')) setExpectedResult('')
    if (!keep('sample_material')) setSampleMaterial('')
    if (!keep('carried_out')) setCarriedOut(false)
    if (!keep('expected_cost')) setExpectedCost('')
    if (!keep('result_category')) setResultCategory('')
    if (!keep('result')) setResult('')
    if (!keep('issue')) setIssue('')
    if (!keep('follow_up')) setFollowUp('')
    if (!keep('quote')) setQuote(null)
    if (!keep('note')) setNote('')
  }

  const handleSave = async () => {
    const ok = validate({
      device: deviceId ? null : '장비를 선택해주세요',
      usage_date: usageDate.trim() ? null : '사용일자를 입력해주세요',
      purpose: chosen ? null : '사용목적을 선택해주세요',
      customer: needsCustomer && !customer ? '대상 고객사를 선택해주세요' : null,
      engineers: engineerIds.length > 0 ? null : '참여 엔지니어를 선택해주세요',
    })
    if (!ok || !timeValid || !deviceId) return

    const cost = digits(expectedCost)
    let submission: UsageSubmission
    if (asRequest) {
      // 목적에 없는 칸은 화면에 값이 남아 있어도 보내지 않는다(사용 기록 저장과 같은 규칙).
      const sent = (f: UsageField, v: string) => (has(f) ? v : '')
      submission = {
        kind: 'request',
        requestId: rewrite?.request_id ?? null,
        body: {
          device_id: deviceId,
          usage_date: usageDate,
          start_time: startTime,
          end_time: endTime,
          engineer_ids: engineerIds,
          purpose,
          project_name: sent('project_name', projectName),
          content: sent('content', content),
          customer_id: has('customer') ? customer?.customer_id ?? null : null,
          customer_dept: sent('customer_dept', customerDept),
          nda_status: has('nda_status') ? ndaStatus || null : null,
          expected_result: sent('expected_result', expectedResult),
          sample_material: sent('sample_material', sampleMaterial),
          carried_out: has('carried_out') ? carriedOut : false,
          expected_cost: has('expected_cost') && cost ? Number(cost) : null,
          note: sent('note', note),
        },
      }
    } else {
      // 목적에 없는 칸은 화면에 값이 남아 있어도 보내지 않는다.
      const text = (f: UsageField, v: string) => (has(f) ? v : null)
      submission = {
        kind: 'usage',
        usageId: initial?.usage_id ?? null,
        payload: {
          device_id: deviceId,
          usage_date: usageDate,
          start_time: startTime,
          end_time: endTime,
          purpose,
          project_name: text('project_name', projectName),
          customer_id: has('customer') ? customer?.customer_id ?? null : null,
          customer_dept: text('customer_dept', customerDept),
          content: text('content', content),
          sample_material: text('sample_material', sampleMaterial),
          carried_out: has('carried_out') ? carriedOut : false,
          expected_cost: has('expected_cost') && cost ? Number(cost) : null,
          nda_status: has('nda_status') ? ndaStatus || null : null,
          expected_result: text('expected_result', expectedResult),
          result: text('result', result),
          result_category: has('result_category') ? resultCategory || null : null,
          issue: text('issue', issue),
          follow_up: text('follow_up', followUp),
          quote_id: has('quote') ? quote?.quote_id ?? null : null,
          note: text('note', note),
          engineer_ids: engineerIds,
        },
      }
    }

    setSaving(true)
    setSubmitError(null)
    const message = await onSubmit(submission)
    setSaving(false)
    // 실패해도 모달을 닫지 않는다 — 입력을 다시 치게 하지 않기 위해서다.
    if (message) setSubmitError(message)
  }

  const toggleBtn = (on: boolean): CSSProperties => ({
    flex: 1, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 700,
    background: on ? CARD_BG : 'transparent', color: on ? TEXT : MUTED, transition: 'color 0.15s ease',
  })

  // 비고 — 두 열 중 짧은 쪽에 붙인다(파일 머리 설명). 좌측이 긴 목적은 견적 연결이 있는 고객 데모 기록뿐이다.
  const noteLeft = has('quote')
  const noteBlock = (
    <>
      <SectionTitle spaced>비고</SectionTitle>
      <div>
        <label style={labelStyle}>비고</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="선택" style={areaStyle} />
      </div>
    </>
  )

  const title = rewriting ? '신청 재작성' : editing ? '사용 기록 수정' : '장비 사용 신청'
  const saveLabel = saving ? (asRequest ? '신청 중...' : '저장 중...') : asRequest ? '신청' : '저장'

  return (
    <ModalOverlay onClose={onClose} style={{ padding: 12 }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(900px, 90vw)', maxHeight: 'calc(100dvh - 32px)',
        background: CARD_BG, borderRadius: 8, boxSizing: 'border-box',
        boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: `1px solid ${BORDER}`,
        animation: 'modal-in 0.18s ease', display: 'flex', flexDirection: 'column',
      }}>
        <style>{LAYOUT_CSS}</style>

        {/* 헤더 — 고정. 제목이 목적에 따라 바뀐다(고객 데모 = 신청) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', flexShrink: 0, borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, letterSpacing: '-0.3px' }}>{title}</div>
          <button onClick={onClose} title="닫기"
            onMouseEnter={e => (e.currentTarget.style.color = TEXT)}
            onMouseLeave={e => (e.currentTarget.style.color = SUB)}
            style={{ width: 30, height: 30, borderRadius: '50%', background: NEUTRAL_BG, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUB, transition: 'color 0.15s ease' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 본문 — 스크롤 */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 20px', display: 'grid', gap: 16 }}>

          {/* 재작성 — 반려 사유를 먼저 보인다 */}
          {rewriting && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', background: NEUTRAL_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: DANGER, whiteSpace: 'nowrap' }}>반려 사유</span>
              <span style={{ fontSize: 12, color: TEXT, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>{rewrite?.comment ?? '-'}</span>
            </div>
          )}

          {/* 사용목적 — 맨 위, 5종을 한 번에. 고른 것만 목적 색으로 채운다. */}
          <div>
            <span style={labelStyle}>사용목적<span style={{ color: DANGER, marginLeft: 4 }}>*</span></span>
            <div role="radiogroup" aria-label="사용목적" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {USAGE_PURPOSES.map(p => {
                const on = purpose === p
                const color = purposeColor(p)
                const disabled = purposeLocked ? !on : p === DEMO_PURPOSE && demoBlocked
                const why = !disabled ? undefined
                  : purposeLocked ? '이 기록은 사용목적을 바꿀 수 없습니다' : '고객 데모는 사용 신청으로 등록합니다'
                return (
                  <button key={p} type="button" role="radio" aria-checked={on} disabled={disabled} title={why}
                    onClick={() => choosePurpose(p)}
                    style={{
                      height: 36, padding: '0 14px', borderRadius: 6, fontFamily: 'inherit',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      border: on ? `1px solid ${color}` : errors.purpose ? errBorder : `1px solid ${BORDER}`,
                      background: on ? color : CARD_BG, color: on ? '#ffffff' : disabled ? FAINT : TEXT,
                      fontSize: 13, fontWeight: on ? 700 : 600,
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}>
                    {!on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: disabled ? FAINT : color, flexShrink: 0 }} />}
                    {p}
                  </button>
                )
              })}
            </div>
            <FieldError message={errors.purpose} />
            {/* 신청 안내 — 목적 5종 모두에 보인다. 사용일자로 사전·사후가 갈린다 */}
            {asRequest && (
              <div style={{ marginTop: 8, fontSize: 12, color: MUTED }}>
                {retroactive
                  ? '이미 진행된 사용입니다. 사용 기록이 바로 생성되고 관리자 확인을 받습니다'
                  : '관리자 승인 후 사용 기록이 생성됩니다'}
              </div>
            )}
          </div>

          <div className="sr-mcols">
            {/* ── 좌 ── */}
            <div className="sr-mcol">
              <SectionTitle>{planned ? '사용 계획' : '사용 정보'}</SectionTitle>

              <div className="sr-row2">
                <div>
                  <label style={labelStyle}>장비</label>
                  <select value={deviceId ?? ''} onChange={e => { setDeviceId(e.target.value ? Number(e.target.value) : null); clearError('device') }}
                    style={errors.device ? { ...fieldStyle, border: errBorder } : fieldStyle}>
                    <option value="">장비 선택</option>
                    {devices.map(d => (
                      <option key={d.device_id} value={d.device_id}>
                        {deviceTitle(d)}{d.serial_number ? ` (${d.serial_number})` : ''}
                      </option>
                    ))}
                  </select>
                  <FieldError message={errors.device} />
                </div>
                <div>
                  {/* 날짜 제한 없음 — 고객 데모는 이 날짜로 사전·사후가 갈린다 */}
                  <label style={labelStyle}>사용일자</label>
                  <input type="date" className="date-fit" value={usageDate}
                    onChange={e => { setUsageDate(e.target.value); clearError('usage_date') }}
                    style={errors.usage_date ? { ...dateFieldStyle, border: errBorder } : dateFieldStyle} />
                  <FieldError message={errors.usage_date} />
                </div>
              </div>

              <div className="sr-row2">
                <div>
                  <label style={labelStyle}>{planned ? '계획 시작' : '시작시간'}</label>
                  <TimeStepper value={startTime} onChange={setStartTime} />
                </div>
                <div>
                  <label style={labelStyle}>{planned ? '계획 종료' : '종료시간'}</label>
                  <TimeStepper value={endTime} onChange={setEndTime} />
                </div>
              </div>

              {/* 실사용(계획) 시간 자동 표시 */}
              {!orderValid ? (
                <div style={{ fontSize: 12, color: DANGER }}>종료시간을 시작시간 이후로 설정해주세요</div>
              ) : workHours <= 0 ? (
                <div style={{ fontSize: 12, color: DANGER }}>점심시간을 제외하면 작업시간이 0입니다</div>
              ) : (
                <div style={{ fontSize: 12, color: MUTED }}>
                  {planned ? '계획' : '실사용'} {workHours}h{lunchHours > 0 ? ` (점심 ${lunchHours}h 제외)` : ''}
                </div>
              )}

              <div>
                <EngineerPicker
                  engineers={engineers}
                  selectedIds={engineerIds}
                  onChange={ids => { setEngineerIds(ids); clearError('engineers') }}
                  expanded={expandEngineers}
                  onToggleExpand={setExpandEngineers}
                  invalid={!!errors.engineers}
                />
                <FieldError message={errors.engineers} />
              </div>

              {has('customer') && (
                <>
                  <SectionTitle spaced>고객 / 보안</SectionTitle>
                  <div>
                    <label style={labelStyle}>
                      대상 고객사{needsCustomer && <span style={{ color: DANGER, marginLeft: 4 }}>*</span>}
                    </label>
                    <CustomerSearch
                      value={customer}
                      onChange={c => { setCustomer(c); clearError('customer'); if (!c) setQuote(null) }}
                      placeholder={needsCustomer ? '업체명 검색 (필수)' : '업체명 검색 (선택)'}
                      invalid={!!errors.customer}
                    />
                    <FieldError message={errors.customer} />
                  </div>
                  <div className="sr-row2">
                    {has('customer_dept') && (
                      <div>
                        <label style={labelStyle}>고객부서</label>
                        <input value={customerDept} onChange={e => setCustomerDept(e.target.value)} placeholder="선택" style={fieldStyle} />
                      </div>
                    )}
                    {has('nda_status') && (
                      <div>
                        <label style={labelStyle}>NDA</label>
                        <select value={ndaStatus} onChange={e => setNdaStatus(e.target.value)} style={fieldStyle}>
                          <option value="">선택 안 함</option>
                          {NDA_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </>
              )}

              {has('quote') && (
                <>
                  <SectionTitle spaced>영업 연결</SectionTitle>
                  <div>
                    <label style={labelStyle}>
                      견적 연결
                      {customer && <span style={{ color: FAINT, fontWeight: 500, marginLeft: 6 }}>{customer.company_name}</span>}
                    </label>
                    <QuotePicker customerId={customer?.customer_id ?? null} value={quote} onChange={setQuote} />
                  </div>
                </>
              )}

              {has('note') && noteLeft && noteBlock}
            </div>

            {/* ── 우 ── */}
            <div className="sr-mcol">
              {!chosen ? (
                <div style={{
                  minHeight: 180, border: `1px dashed ${BORDER}`, borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 600, color: MUTED, textAlign: 'center', padding: 16,
                }}>
                  사용목적을 먼저 선택하세요
                </div>
              ) : (
                <>
                  <SectionTitle>작업 내용</SectionTitle>
                  {(has('project_name') || has('sample_material')) && (
                    <div className="sr-row2">
                      {has('project_name') && (
                        <div>
                          <label style={labelStyle}>프로젝트명</label>
                          <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="선택" style={fieldStyle} />
                        </div>
                      )}
                      {has('sample_material') && (
                        <div>
                          <label style={labelStyle}>샘플 / 자재</label>
                          <input value={sampleMaterial} onChange={e => setSampleMaterial(e.target.value)} placeholder="선택" style={fieldStyle} />
                        </div>
                      )}
                    </div>
                  )}
                  {has('content') && (
                    <div>
                      <label style={labelStyle}>상세 내용</label>
                      {/* 상세 내용 한 칸뿐인 목적(유지보수·교육·기타)은 칸을 넉넉하게 */}
                      <textarea value={content} onChange={e => setContent(e.target.value)}
                        rows={has('project_name') ? 3 : 6}
                        placeholder={`${planned ? '어떤 데모를 할지 입력하세요' : '어떤 작업을 했는지 입력하세요'}${asRequest ? ' (신청 사유로 함께 쓰입니다)' : ''}`}
                        style={areaStyle} />
                    </div>
                  )}
                  {(has('carried_out') || has('expected_cost')) && (
                    <div className="sr-row2">
                      {has('carried_out') && (
                        <div>
                          <label style={labelStyle}>외부반출</label>
                          <div style={{ display: 'flex', background: NEUTRAL_BG, borderRadius: 6, padding: 3, height: 44, boxSizing: 'border-box' }}>
                            <button type="button" onClick={() => setCarriedOut(false)} style={toggleBtn(!carriedOut)}>없음</button>
                            <button type="button" onClick={() => setCarriedOut(true)} style={toggleBtn(carriedOut)}>있음</button>
                          </div>
                        </div>
                      )}
                      {has('expected_cost') && (
                        <div>
                          <label style={labelStyle}>예상비용</label>
                          <div style={{ position: 'relative' }}>
                            <input inputMode="numeric" value={expectedCost}
                              onChange={e => setExpectedCost(digits(e.target.value) ? numKR(Number(digits(e.target.value))) : '')}
                              placeholder="0" style={{ ...fieldStyle, paddingRight: 32 }} />
                            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: MUTED, pointerEvents: 'none' }}>원</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 결과 — 신청이면 결과 대신 기대결과만 */}
                  {(has('expected_result') || has('result_category')) && (
                    <>
                      <SectionTitle spaced>{asRequest ? '기대결과' : '결과'}</SectionTitle>
                      {has('expected_result') && (
                        <div>
                          <label style={labelStyle}>기대결과</label>
                          <textarea value={expectedResult} onChange={e => setExpectedResult(e.target.value)} rows={2}
                            placeholder="선택" style={areaStyle} />
                        </div>
                      )}
                      {has('result_category') && (
                        <div>
                          <label style={labelStyle}>결과분류</label>
                          <select value={resultCategory} onChange={e => setResultCategory(e.target.value)} style={fieldStyle}>
                            <option value="">선택 안 함</option>
                            {RESULT_CATEGORIES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      )}
                      {has('result') && (
                        <div>
                          <label style={labelStyle}>사용결과</label>
                          <textarea value={result} onChange={e => setResult(e.target.value)} rows={2} placeholder="선택" style={areaStyle} />
                        </div>
                      )}
                      {(has('issue') || has('follow_up')) && (
                        <div className="sr-row2">
                          {has('issue') && (
                            <div>
                              <label style={labelStyle}>문제 / 이상발생</label>
                              <textarea value={issue} onChange={e => setIssue(e.target.value)} rows={2} placeholder="선택" style={areaStyle} />
                            </div>
                          )}
                          {has('follow_up') && (
                            <div>
                              <label style={labelStyle}>후속조치</label>
                              <textarea value={followUp} onChange={e => setFollowUp(e.target.value)} rows={2} placeholder="선택" style={areaStyle} />
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {has('note') && !noteLeft && noteBlock}
                </>
              )}
            </div>
          </div>
        </div>

        {/* 푸터 — 고정. 고객 데모 신청이면 「신청」 */}
        <div style={{ padding: '14px 20px', paddingBottom: 'calc(14px + env(safe-area-inset-bottom))', flexShrink: 0, borderTop: `1px solid ${BORDER}` }}>
          {submitError && (
            <div style={{ marginBottom: 10, fontSize: 12, fontWeight: 600, color: DANGER, whiteSpace: 'pre-wrap' }}>
              {submitError}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose} disabled={saving}
              style={{ padding: '9px 16px', background: CARD_BG, color: SUB, borderRadius: 6, border: `1px solid ${BORDER}`, cursor: saving ? 'default' : 'pointer', fontWeight: 600, fontSize: 13 }}>
              취소
            </button>
            <button onClick={handleSave} disabled={saving || !timeValid}
              onMouseEnter={e => { if (!saving && timeValid) e.currentTarget.style.background = BLUE_HOVER }}
              onMouseLeave={e => { if (!saving && timeValid) e.currentTarget.style.background = BLUE }}
              style={{ padding: '9px 18px', background: BLUE, color: '#fff', borderRadius: 6, border: 'none', cursor: (saving || !timeValid) ? 'default' : 'pointer', fontWeight: 700, fontSize: 13, opacity: (saving || !timeValid) ? 0.6 : 1, transition: 'background 0.15s ease' }}>
              {saveLabel}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  )
}
