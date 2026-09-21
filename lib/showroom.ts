// 쇼룸 공용 정의. 화면과 API 라우트가 함께 쓴다('use client' 를 붙이지 않는 이유).
//
// 값은 DB check 제약과 반드시 같아야 한다 — showroom_schema_v2.sql 을 보고 맞춘 것이므로
// 한쪽만 고치지 마라.
//
// 쇼룸 장비는 따로 등록하지 않는다. showroom_sites 에 지정한 사무실(customers)에 딸린
// devices 가 곧 쇼룸 장비이고, showroom_devices 는 그 장비의 '설정'만 담는다(없으면 기본값).

import type { SupabaseClient } from '@supabase/supabase-js'
import { SERVICE_TYPE_COLORS, FALLBACK_COLOR, type CategoryColor } from '@/lib/categoryColors'
import { addDays, daysBetween, ymdParts } from '@/lib/date'

// ── 사용목적 (2026-09-14 5종으로 축소 — 고객 평가·내부 시험 제거) ─────────
export const USAGE_PURPOSES = ['측정대행', '고객 데모', '유지보수', '교육', '기타'] as const
export type UsagePurpose = (typeof USAGE_PURPOSES)[number]

/**
 * 목적별 색. 새 색을 만들지 않고 서비스 유형 색을 빌린다(값을 복사하지 않고 참조만 한다).
 * ACTIVITY_TYPE_COLORS 가 영업 4종에 서비스 색을 빌리는 것과 같은 방식이다.
 */
export const USAGE_PURPOSE_COLORS: Record<string, CategoryColor> = {
  '측정대행': SERVICE_TYPE_COLORS['A/S'],            // 의뢰받아 처리하는 작업
  '고객 데모': SERVICE_TYPE_COLORS['신규설치'],      // 고객 대상 현장 성격
  '유지보수': SERVICE_TYPE_COLORS['유선기술지원'],   // 비영업·기술 지원
  '교육': SERVICE_TYPE_COLORS['교육'],
  '기타': FALLBACK_COLOR,                            // 회색(dot #9ca3af)
}

/** 대상 고객사가 반드시 있어야 하는 목적. DB 제약 su_customer_required 와 같다. */
export const CUSTOMER_REQUIRED_PURPOSES: readonly string[] = ['측정대행', '고객 데모']

export const purposeNeedsCustomer = (purpose: string): boolean => CUSTOMER_REQUIRED_PURPOSES.includes(purpose)

/**
 * 견적·수주 전환율의 분모가 되는 목적. 측정대행은 견적으로 이어지는 일이 아니라 넣지 않는다.
 *   견적 전환율 = 고객 데모 중 견적이 연결된 건 ÷ 고객 데모 건수
 */
export const DEMO_PURPOSE = '고객 데모'

export const isUsagePurpose = (v: unknown): v is UsagePurpose =>
  typeof v === 'string' && (USAGE_PURPOSES as readonly string[]).includes(v)

// ── 목적별 입력 항목 ──────────────────────────────────────────────
// 사용 기록 모달은 목적에 있는 항목만 보이고, 라우트는 목적에 없는 항목을 화면이 무엇을 보냈든 null 로 저장한다
// (외부반출은 NOT NULL 이라 false). 두 쪽이 이 표 하나를 본다 — 한쪽만 고치지 마라.
// 공통 항목(장비·날짜·시간·참여 엔지니어)은 모든 목적에 있어 표에 넣지 않는다.
export type UsageField =
  | 'project_name' | 'content' | 'customer' | 'customer_dept' | 'nda_status' | 'expected_result'
  | 'sample_material' | 'carried_out' | 'expected_cost'
  | 'result_category' | 'result' | 'issue' | 'follow_up' | 'quote' | 'note'

/** 측정대행 — 결과·견적 연결은 없다(견적으로 이어지는 일이 아니다). */
const AGENCY_FIELDS: readonly UsageField[] = [
  'project_name', 'content', 'customer', 'customer_dept', 'nda_status',
  'sample_material', 'carried_out', 'expected_cost', 'note',
]
/** 고객 데모 — 전체 항목. */
const DEMO_FIELDS: readonly UsageField[] = [
  'project_name', 'content', 'customer', 'customer_dept', 'nda_status', 'expected_result',
  'sample_material', 'carried_out', 'expected_cost',
  'result_category', 'result', 'issue', 'follow_up', 'quote', 'note',
]
/** 유지보수·교육·기타 — 상세 내용과 비고만. */
const SIMPLE_FIELDS: readonly UsageField[] = ['content', 'note']

export const PURPOSE_FIELDS: Record<UsagePurpose, readonly UsageField[]> = {
  '측정대행': AGENCY_FIELDS,
  '고객 데모': DEMO_FIELDS,
  '유지보수': SIMPLE_FIELDS,
  '교육': SIMPLE_FIELDS,
  '기타': SIMPLE_FIELDS,
}

/**
 * '신청'에 없는 항목 — 결과 4종과 견적 연결. 그 값들은 승인된 뒤 만들어진 사용 기록을 수정할 때 적는다.
 * 신청 사유 칸도 없다 — 상세 내용(content)이 곧 사유라 서버가 같은 값을 approval_requests.reason 에 넣는다.
 */
const REQUEST_EXCLUDED_FIELDS: readonly UsageField[] = ['result_category', 'result', 'issue', 'follow_up', 'quote']

/** 이 목적에 그 항목이 있는지. 목적이 비었거나 5종이 아니면 false. */
export const purposeHasField = (purpose: string, field: UsageField): boolean =>
  isUsagePurpose(purpose) && PURPOSE_FIELDS[purpose].includes(field)

/**
 * 사용 신청(모달·/api/showroom/requests)에서 다루는 항목.
 * 2026-09-21 부터 5종 전부 신청·승인을 거친다 — 목적마다 보이는 칸은 종전 규칙 그대로이고,
 * 결과·견적 연결만 뺀다(그 값은 승인 뒤 사용 기록을 수정할 때 적는다).
 */
export const requestHasField = (purpose: string, field: UsageField): boolean =>
  purposeHasField(purpose, field) && !REQUEST_EXCLUDED_FIELDS.includes(field)

// ── 선택 항목 (DB check 와 같은 값) ────────────────────────────────
export const NDA_STATUSES = ['해당없음', '확인완료', '확인필요'] as const
export type NdaStatus = (typeof NDA_STATUSES)[number]

export const RESULT_CATEGORIES = ['완료(성공)', '완료(부분성공)', '재평가 필요', '중단', '실패'] as const
export type ResultCategory = (typeof RESULT_CATEGORIES)[number]

export const DEVICE_STATUSES = ['가동', '점검', '수리', '미사용'] as const
export type DeviceStatus = (typeof DEVICE_STATUSES)[number]

/** 값이 목록에 있거나 비어 있으면 통과. 비어 있으면 null 로 저장한다. */
export const optionalOneOf = (v: unknown, list: readonly string[]): { ok: boolean; value: string | null } => {
  if (v === undefined || v === null || v === '') return { ok: true, value: null }
  if (typeof v === 'string' && list.includes(v)) return { ok: true, value: v }
  return { ok: false, value: null }
}

// ── 사무실 ────────────────────────────────────────────────────────
export type ShowroomSite = {
  customer_id: number
  /** customers.company_name 원본 */
  name: string
  /** 표시용 짧은 이름 — siteShortName(name) */
  short: string
}

/**
 * 사무실 짧은 이름 — 「아크레텍코리아 동탄사무실」→「동탄」. 표시에만 쓰고 원본 이름은 건드리지 않는다.
 * 떼고 나서 비면(이름이 그 말뿐인 경우) 원본을 그대로 쓴다.
 */
export const siteShortName = (name: string): string =>
  name.replace(/^아크레텍코리아\s*/, '').replace(/사무실/g, '').trim() || name

// ── 장비 설정 기본값 ──────────────────────────────────────────────
/** showroom_devices 행이 없는 장비에 적용할 값. DB 기본값과 같다. */
export const DEFAULT_DAILY_HOURS = 8
export const DEFAULT_DEVICE_STATUS: DeviceStatus = '가동'
/** DB check: daily_hours > 0 and daily_hours <= 24 */
export const MAX_DAILY_HOURS = 24

export const DEFAULT_START_TIME = '08:30'
export const DEFAULT_END_TIME = '17:30'


// ── 가동률 경계 ───────────────────────────────────────────────────
/** 이 값 미만이면 저가동. 경계값(0.3)은 정상에 넣는다. */
export const LOW_UTIL = 0.3
/** 이 값 초과면 과부하. 경계값(0.8)은 정상에 넣는다. */
export const HIGH_UTIL = 0.8

// ── 수주 판정 ─────────────────────────────────────────────────────
/**
 * 쇼룸 통계에서 '수주'로 보는 견적 상태. 통계는 이 목록만 참조한다(여기 한 곳에만 둔다).
 * lib/quoteStatus.ts 의 ORDERED_STATUSES 와 달리 옛 값 '수주'가 없다 — 지금은 만들어지지 않는
 * 상태이고, 쇼룸 기록이 연결하는 견적은 쇼룸 기록 도입(2026-09) 이후 건이다.
 */
export const ORDER_STATUSES = ['발주(주문 대기)', '주문완료', '세금계산서 요청', '매출완료'] as const

export const isOrderStatus = (status: string | null | undefined): boolean =>
  !!status && (ORDER_STATUSES as readonly string[]).includes(status)

// ── 가동률 계산 ───────────────────────────────────────────────────
// 기간(월·분기·반기·연·지정)이 달라도 식은 하나다.
//   평일     = 그 기간의 월~금 중 company_holidays 에 없는 날 (진행 중인 기간은 오늘까지)
//   기준시간 = 일 가용시간 × 평일 수
//   휴일사용 = 주말·공휴일 날짜의 실사용시간 합
//   분모     = 기준시간 + 휴일사용
//   분자     = 그 기간 실사용시간 합 (work_hours — 점심시간을 뺀 작업시간)
//   가동률   = 분자 ÷ 분모 (분모 0 이면 null)
// 아직 오지 않은 기간은 계산하지 않는다(null).

export type UtilBand = 'low' | 'normal' | 'high'

export const UTIL_BAND_LABEL: Record<UtilBand, string> = { low: '저가동', normal: '정상', high: '과부하' }

/** 새 색을 만들지 않는다 — 저가동 = A/S 주황, 정상 = 교육 초록, 과부하 = B/S 자홍. */
export const UTIL_BAND_COLORS: Record<UtilBand, CategoryColor> = {
  low: SERVICE_TYPE_COLORS['A/S'],
  normal: SERVICE_TYPE_COLORS['교육'],
  high: SERVICE_TYPE_COLORS['B/S'],
}

export const utilBand = (rate: number | null): UtilBand | null =>
  rate == null ? null : rate < LOW_UTIL ? 'low' : rate > HIGH_UTIL ? 'high' : 'normal'

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 0=일 … 6=토. 'YYYY-MM-DD' 를 UTC 로 읽으므로 실행 환경의 시간대와 무관하다. */
export function weekdayOfDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** 쉬는 날(주말 또는 회사 공휴일)인지 — 이날의 사용은 '휴일사용'으로 분모에 더한다. */
export const isOffDay = (date: string, holidays: ReadonlySet<string>): boolean => {
  const w = weekdayOfDate(date)
  return w === 0 || w === 6 || holidays.has(date)
}

/** 기간의 집계 창. 날짜는 'YYYY-MM-DD' 이고 양 끝을 포함한다. */
export type PeriodWindow = {
  /** 아직 오지 않은 기간 — 아무것도 집계하지 않는다. */
  future: boolean
  /** 진행 중인 기간(오늘이 이 기간 안) */
  ongoing: boolean
  from: string
  /** 집계 마지막 날. 진행 중인 기간은 오늘, 지난 기간은 끝날, 미래 기간은 null. */
  to: string | null
  /** 평일 수 — from~to 의 월~금 중 공휴일이 아닌 날 */
  weekdays: number
}

/** from~to(양 끝 포함)의 집계 창. 진행 중인 기간은 오늘까지만 센다. */
export function periodWindow(from: string, to: string, holidays: ReadonlySet<string>, today: string): PeriodWindow {
  if (from > today) return { future: true, ongoing: false, from, to: null, weekdays: 0 }
  const ongoing = to >= today
  const last = ongoing ? today : to
  let weekdays = 0
  for (let d = from; d <= last; d = addDays(d, 1)) {
    if (!isOffDay(d, holidays)) weekdays++
  }
  return { future: false, ongoing, from, to: last, weekdays }
}

/** 한 달의 집계 창 — 연간 보기의 월별 칸에 쓴다. */
export function monthWindow(year: number, month: number, holidays: ReadonlySet<string>, today: string): PeriodWindow {
  const r = monthsRange(year, month, 1)
  return periodWindow(r.from, r.to, holidays, today)
}

export type Utilization = { base: number; denominator: number; rate: number | null }

/** usedHours 는 휴일사용을 포함한 그 달 실사용 전체다. */
export function computeUtilization(dailyHours: number, weekdays: number, usedHours: number, holidayHours: number): Utilization {
  const base = dailyHours * weekdays
  const denominator = base + holidayHours
  return { base, denominator, rate: denominator > 0 ? usedHours / denominator : null }
}

/** 소수 첫째 자리 반올림 — 시간 합계는 0.5 단위 값을 더하므로 부동소수 누적 오차를 끊는다. */
export const round1 = (n: number): number => Math.round(n * 10) / 10

// ── 기간 ──────────────────────────────────────────────────────────
// 가동률 탭의 기간. 월·분기·반기·연은 달력 단위, 지정은 시작일~종료일을 직접 고른 것이다.
// stats 라우트는 기간을 from~to 로만 받는다 — 이 모양(Period)은 화면에서만 쓴다.
export type Period =
  | { mode: 'month'; year: number; month: number }
  | { mode: 'quarter'; year: number; quarter: number }
  | { mode: 'half'; year: number; half: number }
  | { mode: 'year'; year: number }
  | { mode: 'custom'; from: string; to: string }
export type PeriodMode = Period['mode']

export const PERIOD_MODES: { value: PeriodMode; label: string }[] = [
  { value: 'month', label: '월' },
  { value: 'quarter', label: '분기' },
  { value: 'half', label: '반기' },
  { value: 'year', label: '연' },
  { value: 'custom', label: '지정' },
]

/** 직전 기간 비교 문구의 기준 이름 — 「전월 대비」「전 분기 대비」… */
export const PREVIOUS_PERIOD_LABEL: Record<PeriodMode, string> = {
  month: '전월', quarter: '전 분기', half: '전 반기', year: '전년', custom: '직전 기간',
}

/** 한 번에 집계할 수 있는 최대 일수. 연 단위(윤년 366일)까지 들어간다. 지정 기간도 이 안에서 고른다. */
export const MAX_PERIOD_DAYS = 366

/** 'YYYY-MM-DD' 이면서 실제로 있는 날짜인지(2026-02-30 같은 값은 거른다). */
export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  return addDays(s, 0) === s
}

/** 달 번호(연×12 + 월−1) — 달을 넘나드는 계산을 한 줄로 하려고 쓴다. */
const monthIndex = (y: number, m: number) => y * 12 + (m - 1)
const fromMonthIndex = (idx: number) => ({ y: Math.floor(idx / 12), m: (idx % 12) + 1 })
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** y년 m월부터 count 개월의 첫날~마지막날. */
function monthsRange(y: number, m: number, count: number): { from: string; to: string } {
  const end = fromMonthIndex(monthIndex(y, m) + count - 1)
  return { from: `${y}-${pad2(m)}-01`, to: `${end.y}-${pad2(end.m)}-${pad2(lastDayOf(end.y, end.m))}` }
}

/** 기간 → from~to(양 끝 포함). */
export function periodRange(p: Period): { from: string; to: string } {
  switch (p.mode) {
    case 'month': return monthsRange(p.year, p.month, 1)
    case 'quarter': return monthsRange(p.year, (p.quarter - 1) * 3 + 1, 3)
    case 'half': return monthsRange(p.year, (p.half - 1) * 6 + 1, 6)
    case 'year': return monthsRange(p.year, 1, 12)
    case 'custom': return { from: p.from, to: p.to }
  }
}

/** 헤더 표시 — 「2026년 9월」「2026년 3분기」「2026년 하반기」「2026년」「2026-08-01 ~ 2026-09-15」 */
export function periodLabel(p: Period): string {
  switch (p.mode) {
    case 'month': return `${p.year}년 ${p.month}월`
    case 'quarter': return `${p.year}년 ${p.quarter}분기`
    case 'half': return `${p.year}년 ${p.half === 1 ? '상' : '하'}반기`
    case 'year': return `${p.year}년`
    case 'custom': return `${p.from} ~ ${p.to}`
  }
}

/** ◀ ▶ — 그 모드의 한 단위만큼 옮긴다. 지정 기간은 같은 일수만큼 통째로 옮긴다. */
export function shiftPeriod(p: Period, delta: number): Period {
  switch (p.mode) {
    case 'month': {
      const t = fromMonthIndex(monthIndex(p.year, p.month) + delta)
      return { mode: 'month', year: t.y, month: t.m }
    }
    case 'quarter': {
      const i = p.year * 4 + (p.quarter - 1) + delta
      return { mode: 'quarter', year: Math.floor(i / 4), quarter: (i % 4) + 1 }
    }
    case 'half': {
      const i = p.year * 2 + (p.half - 1) + delta
      return { mode: 'half', year: Math.floor(i / 2), half: (i % 2) + 1 }
    }
    case 'year': return { mode: 'year', year: p.year + delta }
    case 'custom': {
      const span = daysBetween(p.from, p.to) + 1
      return { mode: 'custom', from: addDays(p.from, span * delta), to: addDays(p.to, span * delta) }
    }
  }
}

/**
 * 직전 기간 — 증감 비교의 기준. 기간이 달 단위로 딱 떨어지면(1일~말일) 같은 개월 수만큼 앞의 달들,
 * 아니면 같은 일수만큼 앞의 날들이다. 월=전월, 분기=전 분기, 반기=전 반기, 연=전년이 저절로 나온다.
 * 진행 중인 달(9/1~9/30, 오늘 9/15)도 달 단위라 직전은 8월 전체다 — 기존 월간 보기와 같다.
 */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const f = ymdParts(from)
  const t = ymdParts(to)
  if (f.d === 1 && t.d === lastDayOf(t.y, t.m)) {
    const count = monthIndex(t.y, t.m) - monthIndex(f.y, f.m) + 1
    const start = fromMonthIndex(monthIndex(f.y, f.m) - count)
    return monthsRange(start.y, start.m, count)
  }
  const span = daysBetween(from, to) + 1
  return { from: addDays(from, -span), to: addDays(from, -1) }
}

/** 기간이 한 해 전체(1/1~12/31)면 그 해, 아니면 null — 연간 보기(히트맵·월별 추이)를 만들지 정한다. */
export function wholeYearOf(from: string, to: string): number | null {
  const y = from.slice(0, 4)
  return from === `${y}-01-01` && to === `${y}-12-31` ? Number(y) : null
}

/**
 * from~to 를 알맞은 기간 모드로 되돌린다. 전체기록 탭은 주소에 from·to 만 남기므로, 새로고침한 뒤에도
 * 표시(「2026년 3분기」)와 ◀ ▶ 단위를 되살리려고 쓴다. 달력 단위에 딱 맞지 않으면 지정 기간이다.
 */
export function periodFromRange(from: string, to: string): Period {
  const f = ymdParts(from)
  const t = ymdParts(to)
  if (f.y === t.y && f.d === 1 && t.d === lastDayOf(t.y, t.m)) {
    const span = t.m - f.m + 1
    if (span === 1) return { mode: 'month', year: f.y, month: f.m }
    if (span === 3 && (f.m - 1) % 3 === 0) return { mode: 'quarter', year: f.y, quarter: (f.m - 1) / 3 + 1 }
    if (span === 6 && (f.m - 1) % 6 === 0) return { mode: 'half', year: f.y, half: (f.m - 1) / 6 + 1 }
    if (span === 12) return { mode: 'year', year: f.y }
  }
  return { mode: 'custom', from, to }
}

// ── 통계 응답 (/api/showroom/stats) ──────────────────────────────
export type PurposeStat = { purpose: string; count: number; hours: number }

export type MonthMetrics = {
  count: number
  hours: number
  /** 고객 데모 건수 — 견적·수주 전환율의 분모 */
  demoCount: number
  /** 고객 데모 중 견적이 연결된 건 */
  quoteLinked: number
  /** 그중 연결 견적의 현재 상태가 ORDER_STATUSES 인 건 */
  orderLinked: number
  /** quoteLinked ÷ demoCount (데모가 없으면 null) */
  quoteRate: number | null
  /** orderLinked ÷ demoCount (데모가 없으면 null) */
  orderRate: number | null
  /** 연결 견적 공급가 합 — 같은 견적이 여러 기록에 걸려도 한 번만 더한다 */
  quoteAmount: number
  orderAmount: number
  /** 활성 장비 전체의 가중 평균 = Σ실사용 ÷ Σ분모. 미래 기간·기록 없는 기간은 null */
  avgUtilization: number | null
  byPurpose: PurposeStat[]
}

export type DeviceUtilStat = {
  device_id: number
  /** 소속 사무실(showroom_sites.customer_id) */
  site_id: number
  name: string
  site_name: string
  device_status: string
  daily_hours: number
  weekdays: number
  base_hours: number
  holiday_hours: number
  used_hours: number
  count: number
  utilization: number | null
  band: UtilBand | null
}

export type HeatmapRow = {
  device_id: number
  site_id: number
  name: string
  site_name: string
  /** 1~12월. 미래 달·기록 없는 달은 null */
  months: (number | null)[]
  /** 기록이 있는 지난·진행 달만 모은 가중 평균 */
  annual: number | null
}

export type MonthTrend = {
  month: number
  future: boolean
  hasData: boolean
  hours: number
  /** 고객 데모 건수 */
  demoCount: number
}

export type CustomerStat = { customer_id: number; name: string; count: number; hours: number; quoteLinked: number; orderLinked: number }

/** 사무실 한 곳의 선택한 기간 평균 가동률(그 사무실 활성 장비의 가중 평균). */
export type SiteUtil = { customer_id: number; short: string; avgUtilization: number | null }

/** 연간 보기 — 기간이 한 해 전체일 때만 만든다. */
export type YearlyStats = {
  year: number
  heatmap: { rows: HeatmapRow[]; monthlyAvg: (number | null)[]; annualAvg: number | null }
  trend: MonthTrend[]
}

export type ShowroomStats = {
  /** 요청한 기간(양 끝 포함) */
  from: string
  to: string
  today: string
  /** showroom_sites 순서(created_at). 화면의 사무실 선택지로 쓴다 */
  sites: ShowroomSite[]
  /** 이 응답이 어느 사무실 기준인지. 'all' 이면 모든 사무실 합산 */
  site: number | 'all'
  /** 집계 창 — 진행 중인 기간은 오늘까지 */
  window: PeriodWindow
  /** 기간 안에 집계할 기록이 있는지 */
  hasData: boolean
  current: MonthMetrics
  /** 직전 기간(previousRange) — 전월·전 분기 … 대비 증감에 쓴다 */
  previous: MonthMetrics
  /** 활성 장비만. 가동률 내림차순(null 은 뒤) */
  devices: DeviceUtilStat[]
  /** 선택한 기간의 사무실별 평균 가동률 — 'all' 에서 장비 목록을 사무실별로 묶을 때 쓴다 */
  siteUtil: SiteUtil[]
  /** 기간이 한 해 전체(1/1~12/31)일 때만 — 연간 보기의 히트맵·월별 추이. 그 밖의 기간은 null */
  yearly: YearlyStats | null
  /** 고객사별 활동 — 기본 상위 10, customers=all 이면 전체(건수 내림차순) */
  customers: CustomerStat[]
  /** 기간 기록에 걸린 고객사 전체 수(기본 호출이면 customers 는 그중 상위 10 만 담는다) */
  customerTotal: number
  holidays: { seeded: boolean }
}

// ── 행 모양 ───────────────────────────────────────────────────────
/**
 * devices 행 그대로. components/customer/types.ts 의 Device 와 같은 모양이라
 * getInstallDisplay·getDefaultImageUrl 에 그대로 넘길 수 있다(형변환 없이).
 */
export type ShowroomDeviceBase = {
  device_id: number
  customer_id: number
  device_name: string | null
  device_name2: string | null
  option: string | null
  serial_number: string | null
  packing_list_url: string | null
  install_date: string | null
  install_year: string | number | null
  program: string | null
  image_url: string | null
  category: string | null
}

/** devices + showroom_devices 설정을 합친 것. 설정 행이 없으면 기본값이 들어간다. */
export type ShowroomDevice = ShowroomDeviceBase & {
  /** 설치위치 — showroom_sites 사무실의 company_name */
  site_name: string
  daily_hours: number
  device_status: string
  is_active: boolean
  sort_order: number
  note: string | null
  /** showroom_devices 행이 실제로 있는지. 없으면 위 값들은 기본값이다. */
  configured: boolean
}

export type ShowroomUsageRow = {
  usage_id: number
  device_id: number
  usage_date: string
  start_time: string
  end_time: string
  work_hours: number
  purpose: string
  customer_id: number | null
  project_name: string | null
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
  /** 데모 신청으로 만든 기록이면 그 신청(approval_requests.request_id) */
  request_id: number | null
  /**
   * 연결된 데모 신청의 처리 정보(showroom_usage.request_id 로 임베딩). 신청이 아닌 기록은 null.
   * 승인자는 id 만 온다 — 이름은 화면이 가진 엔지니어 목록으로 바꾼다. retro 는 payload.is_retroactive(사후 신청).
   * 사후 신청은 확인 전이면 status 가 '대기중'이고 approver_id 가 비어 있다.
   */
  approval_requests: { approver_id: number | null; decided_at: string | null; status: string; retro: boolean | null } | null
  created_by: number
  customers: { company_name: string | null } | null
  quotes: { quote_number: string | null } | null
}

// ── 데모 사용 신청 ────────────────────────────────────────────────
// approval_requests(request_type = 'showroom_demo') 한 행이 신청 한 건이다. 신청 내용은 payload(jsonb),
// 신청 사유는 reason, 승인·반려 의견은 comment 에 둔다. 신청번호도 칼럼이 없어 payload 에 넣는다.
// 흐름과 상태 규칙은 app/api/showroom/requests/shared.ts 머리 설명을 본다.
export const DEMO_REQUEST_TYPE = 'showroom_demo'
export const REQUEST_PENDING = '대기중'
export const REQUEST_APPROVED = '승인'
export const REQUEST_REJECTED = '반려'

/** 승인서 PDF 버킷(비공개). approval_requests.pdf_url 은 '<버킷>/<파일명>' 꼴로 저장한다. */
export const APPROVAL_BUCKET = 'showroom-approvals'

/** 신청 한 건의 내용(approval_requests.payload). 이름들은 신청 시점 값을 적어 둔다(승인서·요청함 표시용). */
export type DemoRequestPayload = {
  /** SR-YYYYMMDD-001 — 신청일(KST) 기준 일련번호 */
  request_no: string
  /** 사후 신청 — 이미 끝난 사용. 신청할 때 사용 기록을 바로 만든다 */
  is_retroactive: boolean
  device_id: number
  device_name: string
  /** 설치위치(쇼룸 사무실 이름) */
  site_name: string
  /** 사전: 계획일 / 사후: 실제 사용일 */
  usage_date: string
  start_time: string
  end_time: string
  work_hours: number
  engineer_ids: number[]
  engineer_names: string[]
  /** 사용목적 5종. 2026-09-21 이전 신청(고객 데모만 신청이던 때)에는 없다 — 그때 건은 고객 데모로 읽는다. */
  purpose?: string
  project_name: string | null
  content: string | null
  /** 대상 고객사 — 측정대행·고객 데모만 필수다(DB 제약과 같다). 나머지 목적은 null. */
  customer_id: number | null
  customer_name: string | null
  customer_dept: string | null
  nda_status: string | null
  expected_result: string | null
  sample_material: string | null
  carried_out: boolean
  expected_cost: number | null
  /** 비고. 2026-09-21 이전 신청에는 없다. */
  note?: string | null
  requester_name: string
  /** 사업부/팀 — 신청자 engineers.teams */
  requester_team: string | null
}

/** 화면(내 신청)이 읽는 신청 행. */
/** 신청에 적힌 사용목적. 목적 칸이 없던 때의 신청은 고객 데모로 본다. */
export const requestPurpose = (p: { purpose?: string } | null | undefined): string =>
  p?.purpose && isUsagePurpose(p.purpose) ? p.purpose : DEMO_PURPOSE

export type DemoRequestRow = {
  request_id: number
  status: string
  payload: DemoRequestPayload
  reason: string | null
  comment: string | null
  pdf_url: string | null
  created_at: string
  decided_at: string | null
}

/**
 * 사후 신청인지 — 사용일자로 정한다(고르는 칸이 없다). 오늘(KST) 까지면 사후(이미 진행된 데모 — 사용 기록을 바로
 * 만들고 관리자 확인을 받는다), 오늘 뒤면 사전(승인되면 사용 기록이 생긴다). 화면과 서버가 같은 식을 쓴다.
 */
export const isRetroactiveDate = (usageDate: string, today: string): boolean => usageDate <= today

/** 상태 표기 — 사후 신청의 승인은 「확인」이다. */
export const demoStatusLabel = (status: string, retroactive: boolean): string =>
  status === REQUEST_APPROVED && retroactive ? '확인' : status

/**
 * showroom_devices 설정 행을 확인하고, 없으면 기본값으로 만든다 — showroom_usage.device_id 가
 * showroom_devices 를 FK 로 참조하므로 설정 행이 없으면 사용 기록 insert 자체가 실패한다.
 * 사용여부가 꺼진 장비면 막는다. 통과하면 null, 막히면 화면에 띄울 메시지. 라우트(service role)에서만 부른다.
 */
export async function ensureDeviceConfig(sb: SupabaseClient, deviceId: number): Promise<string | null> {
  const { data: cfg, error: cfgErr } = await sb
    .from('showroom_devices')
    .select('device_id, is_active')
    .eq('device_id', deviceId)
    .maybeSingle()
  if (cfgErr) {
    console.error('[showroom] device config lookup failed', { deviceId, error: cfgErr })
    return '장비 설정을 읽지 못했습니다.'
  }
  if (cfg) {
    // 설정이 있는데 사용여부가 꺼져 있으면 새 기록을 넣지 않는다.
    return cfg.is_active === false ? '사용하지 않는 장비에는 기록을 남길 수 없습니다.' : null
  }
  const { error: insErr } = await sb.from('showroom_devices').insert({
    device_id: deviceId,
    daily_hours: DEFAULT_DAILY_HOURS,
    device_status: DEFAULT_DEVICE_STATUS,
    is_active: true,
    sort_order: 0,
  })
  if (insErr) {
    console.error('[showroom] device config create failed', { deviceId, error: insErr })
    return '장비 설정을 만들지 못했습니다.'
  }
  return null
}

/** 장비 표시명 — 고객사 상세의 장비 카드와 같은 규칙(이름 + 모델 + 옵션). */
export const deviceTitle = (d: Pick<ShowroomDeviceBase, 'device_name' | 'device_name2' | 'option'>): string =>
  `${d.device_name ?? ''} ${d.device_name2 ?? ''} ${d.option ?? ''}`.replace(/\s+/g, ' ').trim() || '-'

/** 정렬: sort_order → device_name. 설정이 없는 장비는 sort_order 0 이라 앞에 온다. */
export const compareDevices = (a: ShowroomDevice, b: ShowroomDevice): number => {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
  return (a.device_name ?? '').localeCompare(b.device_name ?? '')
}

/**
 * 쇼룸 장비인지 확인한다 — showroom_sites 사무실 소속이고 삭제되지 않은 devices 행.
 * 라우트가 쓰기 전에 반드시 통과시킨다(화면이 보낸 device_id 를 믿지 않는다).
 * 통과하면 null, 막히면 화면에 띄울 메시지를 돌려준다.
 *
 * 클라이언트를 인자로 받으므로 서버 전용 모듈을 끌어오지 않는다(라우트에서만 부른다).
 */
export async function assertShowroomDevice(sb: SupabaseClient, deviceId: number): Promise<string | null> {
  const { data: sites, error: siteErr } = await sb.from('showroom_sites').select('customer_id')
  if (siteErr) {
    console.error('[showroom] site lookup failed', siteErr)
    return '쇼룸 사무실 정보를 읽지 못했습니다.'
  }
  const siteIds = (sites ?? []).map((s: { customer_id: number }) => s.customer_id)
  if (siteIds.length === 0) return '쇼룸 사무실이 지정되어 있지 않습니다.'

  const { data: device, error: devErr } = await sb
    .from('devices')
    .select('device_id, customer_id, deleted_at')
    .eq('device_id', deviceId)
    .maybeSingle()
  if (devErr) {
    console.error('[showroom] device lookup failed', { deviceId, error: devErr })
    return '장비를 확인하지 못했습니다.'
  }
  if (!device || device.deleted_at) return '쇼룸 장비가 아닙니다.'
  if (!siteIds.includes(device.customer_id)) return '쇼룸 장비가 아닙니다.'
  return null
}
