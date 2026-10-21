// 포캐스트 집계 — **새 표 없이** 지금 있는 데이터로 「안건 한 줄」을 만든다.
//
// 배경과 빠진 칸 목록은 docs/forecast-gap-analysis.md 에 있다. 이 파일은 그중
// **지금 데이터만으로 되는 부분**을 순수 함수로 구현한 것이다. DB·화면을 모른다
// (조회는 lib/forecastData.ts 가 한다) — 그래서 스크립트로 그대로 돌려 값으로 증명할 수 있다.
//
// ── 한 줄은 어디서 오는가 ───────────────────────────────────────────────────
//   견적(quotes)       — 금액·고객·분류가 확정된 줄. **대표**다.
//   영업기회(sales_opportunities) — 견적 전 단계의 예상 줄.
//   견적이 영업기회를 가리키면(quotes.opportunity_id) 그 영업기회는 **빼고 견적만 센다** —
//   같은 건이 두 줄이 되면 합계가 두 배가 된다.
//
// ── 예상월을 무엇으로 잡는가 ───────────────────────────────────────────────
//   영업기회 : expected_close 의 월. 그 칸은 **월 단위로 입력받아 그 달 말일로 저장**된다
//              (components/customer/opportunity.ts 의 monthToDate) — 월을 그대로 읽으면 된다.
//   견적     : **유효기간이 끝나는 달**이다(lib/quoteStatus.ts 의 quoteExpiry — 작성일로부터
//              1개월). 견적서에 찍히는 「작성일로부터 1개월」과 같은 값이라, 고객이 받은 문서와
//              예상 시점이 어긋나지 않는다.
//   수주확정 : **발주일**(purchase_order_at)의 월. 없으면 견적일의 월로 떨어뜨린다.
//
// ── 금액 ───────────────────────────────────────────────────────────────────
//   견적은 total_supply(공급가), 영업기회는 expected_amount. 부가세·원가는 보지 않는다.

import { kstYmd } from './date'
import { quoteExpiry } from './quoteStatus'

// ── 상태 ────────────────────────────────────────────────────────────────────

/**
 * 포캐스트 줄의 상태. 본사 보고 엑셀의 8값에서 **목표금액을 뺀 7값**이다
 * (목표금액은 줄이 아니라 sales_targets 에서 와서 합계에만 더해진다).
 *
 * ⚠ 포캐스트(40)·포캐스트(80)은 **지금 만들어지지 않는다.** 확률을 담는 칸이 어디에도 없어서다
 *   (docs/forecast-gap-analysis.md 의 F-6). 값만 열어 두고, 생기면 그때 판정을 더한다.
 */
export const FORECAST_STATUSES = [
  '포캐스트', '포캐스트(80)', '포캐스트(40)', '지연', '수주확정', '실주', '구매취소',
] as const

export type ForecastStatus = (typeof FORECAST_STATUSES)[number]

/** 합계 칸의 열쇠 — 목표가 하나 더 붙는다. */
export const BUCKET_KEYS = ['목표', '포캐스트', '지연', '수주확정', '실주', '구매취소'] as const
export type BucketKey = (typeof BUCKET_KEYS)[number]
export type Bucket = Record<BucketKey, number>

/** 상태를 합계 칸으로 — 확률 변형은 「포캐스트」 한 칸에 모은다. */
export const bucketOf = (s: ForecastStatus): BucketKey =>
  (s === '포캐스트(80)' || s === '포캐스트(40)' ? '포캐스트' : s)

export const emptyBucket = (): Bucket =>
  ({ 목표: 0, 포캐스트: 0, 지연: 0, 수주확정: 0, 실주: 0, 구매취소: 0 })

// ── 들어오는 값 ─────────────────────────────────────────────────────────────

/** quotes 에서 읽는 칸만. (quotes 에는 updated_at 이 없다 — 아래 ForecastRow.updatedAt 참조) */
export type ForecastQuote = {
  quote_id: number
  quote_number: string | null
  status: string | null
  quote_date: string | null
  purchase_order_at: string | null
  fail_reason: string | null
  total_supply: number | null
  category: string | null
  form_kind: string | null
  engineer_id: number | null
  customer_id: number | null
  dealer_id: number | null
  opportunity_id: number | null
  created_at: string | null
  /** 저장된 견적서 PDF 경로. 화면이 번호를 눌렀을 때 연다(집계에는 쓰지 않는다). */
  pdf_url: string | null
}

/** sales_opportunities 에서 읽는 칸만. **분류 칸이 없다**(그래서 category 는 늘 null 이다). */
export type ForecastOpportunity = {
  opportunity_id: number
  stage: string | null
  expected_close: string | null
  expected_amount: number | null
  engineer_id: number | null
  customer_id: number | null
  closed_at: string | null
  created_at: string | null
  updated_at: string | null
}

/** 팀을 붙이려고 받는 최소 정보. */
export type ForecastEngineer = { engineer_id: number; team_id: number | null }

export type ForecastRow = {
  source: 'quote' | 'opportunity'
  id: number
  /** 견적번호. 영업기회 줄은 null 이다. */
  no: string | null
  engineerId: number | null
  teamId: number | null
  customerId: number | null
  /** 대리점을 거친 건인가(견적만). Distributor/Direct 의 근거다. */
  dealerId: number | null
  /** quote_categories.code. **영업기회 줄은 늘 null**(그 표에 분류 칸이 없다). */
  category: string | null
  /** quotes.form_kind(general20·parts80·equip80). 영업기회 줄은 null. */
  formKind: string | null
  /** 'YYYY-MM' */
  month: string
  status: ForecastStatus
  amount: number
  /** 판정 전의 저장값(quotes.status · sales_opportunities.stage) — 왜 그 상태가 됐는지 보려고 싣는다. */
  rawStatus: string | null
  createdAt: string | null
  /** quotes 에는 updated_at 칸이 없어 **견적 줄은 늘 null** 이다(영업기회만 값이 있다). */
  updatedAt: string | null
  /** 저장된 견적서 PDF 경로(견적 줄만). 집계에는 쓰지 않고 화면이 열 때만 쓴다. */
  pdfUrl: string | null
}

// ── 날짜 ────────────────────────────────────────────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}/
/** 'YYYY-MM-DD…' → 'YYYY-MM'. 모양이 아니면 빈 글자. */
export const monthOf = (ymd: string | null | undefined): string =>
  (ymd && YMD.test(ymd) ? ymd.slice(0, 7) : '')
/** timestamptz → **한국 기준** 'YYYY-MM'. 한국 새벽에 찍힌 시각이 전달로 밀리지 않게 한다. */
export const monthOfInstant = (at: string | null | undefined): string =>
  (at ? monthOf(kstYmd(at)) : '')

/**
 * 회계연도 — **4월 시작**이다. 지금 /sales 가 쓰는 규칙을 그대로 가져왔다
 * (app/sales/page.tsx 의 getFiscalYear). 1~3월은 전년도 회계연도에 든다.
 */
export const fiscalYearOfMonth = (month: string): number => {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return m >= 4 ? y : y - 1
}

/** 그 회계연도의 열두 달 'YYYY-MM' (4월 → 다음해 3월). */
export function fiscalMonths(fy: number): string[] {
  const out: string[] = []
  for (let i = 0; i < 12; i++) {
    const m = 4 + i
    const y = m <= 12 ? fy : fy + 1
    const mm = m <= 12 ? m : m - 12
    out.push(`${y}-${String(mm).padStart(2, '0')}`)
  }
  return out
}

// ── 한 줄 만들기 ────────────────────────────────────────────────────────────

/** 수주로 본다 — lib/quoteStatus.ts 의 ORDERED_STATUSES 와 같은 값이다(그 파일이 정본). */
const ORDERED = new Set(['수주', '발주(주문 대기)', '주문완료', '세금계산서 요청', '매출완료'])
/** 영업기회의 진행 단계(아직 끝나지 않은 것). components/customer/opportunity.ts 의 STAGES 중 앞 네 개. */
const OPEN_STAGES = new Set(['상담', '사양검토', '견적제출', '협상'])

/**
 * 미수주 사유가 「고객이 취소한 것」인가 — 들어 있으면 실주가 아니라 **구매취소**로 센다.
 * 자유 입력 칸이라 글자로 가린다(실데이터에는 「유효기간 만료」류가 대부분이다).
 */
export const isCancelReason = (reason: string | null | undefined): boolean =>
  !!reason && reason.includes('취소')

/**
 * 포캐스트에서 **빼는 줄**인가.
 *
 * 반려된 견적(quotes.status = '반려')이 그것이다. 반려는 그 견적을 다시 올리는 길이 없고
 * 새 견적서를 쓴다(lib/quoteStatus.ts 의 EDIT_STATUSES_REJECTED 가 비어 있는 이유).
 * 그래서 남겨 두면 **같은 건이 두 줄**이 되어 합계가 부풀어 오른다.
 *
 * 보류·취소요청·수리중은 뺀다는 뜻이 아니다 — 그 셋은 아직 살아 있는 건이라 포캐스트에 든다.
 */
export const isExcludedFromForecast = (item: ForecastQuote | ForecastOpportunity): boolean =>
  'quote_id' in item && item.status === '반려'

/**
 * 한 줄 만들기. **빼는 줄인지 먼저 보고 부른다**(isExcludedFromForecast) —
 * buildForecast 가 그렇게 한다. 혼자 부르면 반려 견적도 줄이 된다.
 */
export function toForecastRow(
  item: ForecastQuote | ForecastOpportunity,
  today: string,
): ForecastRow {
  const thisMonth = monthOf(today)

  // ── 견적 ──
  if ('quote_id' in item) {
    const q = item
    const raw = q.status ?? ''
    let status: ForecastStatus
    let month: string
    if (ORDERED.has(raw)) {
      status = '수주확정'
      // 발주일이 없으면 견적일로 떨어뜨린다(실데이터에서는 수주류 전부 발주일이 있다).
      month = monthOfInstant(q.purchase_order_at) || monthOf(q.quote_date)
    } else if (raw === '실패') {
      status = isCancelReason(q.fail_reason) ? '구매취소' : '실주'
      month = monthOf(quoteExpiry(q.quote_date ?? '')) || monthOf(q.quote_date)
    } else {
      // 견적중·수리중·결재중·취소요청·보류 — **아직 살아 있는 건**으로 보고 포캐스트에 넣는다.
      // (반려는 여기 오지 않는다 — buildForecast 가 줄 자체를 만들지 않는다.)
      status = '포캐스트'
      month = monthOf(quoteExpiry(q.quote_date ?? '')) || monthOf(q.quote_date)
    }
    return {
      source: 'quote', id: q.quote_id, no: q.quote_number,
      engineerId: q.engineer_id, teamId: null,
      customerId: q.customer_id, dealerId: q.dealer_id,
      category: q.category, formKind: q.form_kind,
      month, status, amount: q.total_supply ?? 0,
      rawStatus: q.status, createdAt: q.created_at,
      // quotes 에 updated_at 칸이 없다. 있는 척하지 않는다.
      updatedAt: null,
      pdfUrl: q.pdf_url ?? null,
    }
  }

  // ── 영업기회 ──
  const o = item
  const raw = o.stage ?? ''
  const month = monthOf(o.expected_close)
  let status: ForecastStatus
  if (raw === '수주') status = '수주확정'
  else if (raw === '실주') status = '실주'
  else if (OPEN_STAGES.has(raw) && month !== '' && month < thisMonth) status = '지연'
  else status = '포캐스트'

  return {
    source: 'opportunity', id: o.opportunity_id, no: null,
    engineerId: o.engineer_id, teamId: null,
    customerId: o.customer_id, dealerId: null,
    // 영업기회 표에는 분류·양식 칸이 없다(gap 분석 B-11·B-14).
    category: null, formKind: null,
    month, status, amount: o.expected_amount ?? 0,
    rawStatus: o.stage, createdAt: o.created_at, updatedAt: o.updated_at,
    pdfUrl: null,
  }
}

// ── 모아서 집계 ─────────────────────────────────────────────────────────────

export type ForecastTarget = {
  engineer_id: number | null
  year: number | null
  quarter: number | null
  order_target_amount: number | null
}

export type BuildForecastInput = {
  quotes: ForecastQuote[]
  opportunities: ForecastOpportunity[]
  targets: ForecastTarget[]
  engineers?: ForecastEngineer[]
  today: string
  /** 'YYYY-MM'. 주면 그 달 이상만 남긴다(목표도 같이 걸러진다). */
  from?: string
  /** 'YYYY-MM'. 주면 그 달 이하만 남긴다. */
  to?: string
}

export type ForecastResult = {
  rows: ForecastRow[]
  /** [engineer_id]['YYYY-MM'] */
  byPersonMonth: Record<string, Record<string, Bucket>>
  /** [분류코드]['YYYY-MM'] — 분류가 없는 줄은 '(미분류)' 로 모인다. */
  byCategoryMonth: Record<string, Record<string, Bucket>>
}

export const UNCATEGORIZED = '(미분류)'

const add = (map: Record<string, Record<string, Bucket>>, key: string, month: string, bucket: BucketKey, amount: number) => {
  if (!key || !month) return
  const byMonth = (map[key] ??= {})
  const b = (byMonth[month] ??= emptyBucket())
  b[bucket] += amount
}

/**
 * 줄을 만들고 합계를 낸다.
 *
 * 이중 집계 방지 — 견적이 가리키는 영업기회(quotes.opportunity_id)는 **견적이 대표**하므로
 * 영업기회 줄을 만들지 않는다. 지금 실데이터에서는 그 연결이 0건이라 아무것도 빠지지 않지만,
 * 연결을 살리는 순간(gap 분석 D-3) 합계가 두 배가 되는 자리라 처음부터 막아 둔다.
 *
 * 목표 — sales_targets 의 **연간 수주 목표 ÷ 12** 를 그 회계연도 열두 달에 똑같이 나눈다
 * (4월 시작). 분기 목표 행(quarter 가 있는 행)은 **보지 않는다** — 지금 쓰는 행은 전부
 * quarter 가 null 이다. 원 단위로 반올림하므로 열두 달 합이 연 목표와 몇 원 다를 수 있다.
 */
export function buildForecast(input: BuildForecastInput): ForecastResult {
  const { quotes, opportunities, targets, engineers, today, from, to } = input

  const teamOf = new Map((engineers ?? []).map(e => [e.engineer_id, e.team_id]))
  const linked = new Set(quotes.map(q => q.opportunity_id).filter((v): v is number => v != null))

  const inRange = (month: string) => (!from || month >= from) && (!to || month <= to)

  const rows: ForecastRow[] = []
  for (const q of quotes) {
    // 반려 견적은 줄을 만들지 않는다(위 isExcludedFromForecast).
    if (isExcludedFromForecast(q)) continue
    const r = toForecastRow(q, today)
    if (!inRange(r.month)) continue
    rows.push({ ...r, teamId: r.engineerId != null ? teamOf.get(r.engineerId) ?? null : null })
  }
  for (const o of opportunities) {
    if (linked.has(o.opportunity_id)) continue
    const r = toForecastRow(o, today)
    if (!inRange(r.month)) continue
    rows.push({ ...r, teamId: r.engineerId != null ? teamOf.get(r.engineerId) ?? null : null })
  }

  const byPersonMonth: Record<string, Record<string, Bucket>> = {}
  const byCategoryMonth: Record<string, Record<string, Bucket>> = {}
  for (const r of rows) {
    const bucket = bucketOf(r.status)
    if (r.engineerId != null) add(byPersonMonth, String(r.engineerId), r.month, bucket, r.amount)
    add(byCategoryMonth, r.category || UNCATEGORIZED, r.month, bucket, r.amount)
  }

  // 목표 — 담당자별로만 둔다. 분류별 목표는 저장되는 곳이 없다(gap 분석 F-7).
  for (const t of targets) {
    if (t.engineer_id == null || t.year == null || t.quarter != null) continue
    const perMonth = Math.round((t.order_target_amount ?? 0) / 12)
    if (perMonth === 0) continue
    for (const month of fiscalMonths(t.year)) {
      if (!inRange(month)) continue
      add(byPersonMonth, String(t.engineer_id), month, '목표', perMonth)
    }
  }

  return { rows, byPersonMonth, byCategoryMonth }
}

/** 합계 칸 하나의 전부 더한 값 — 표 아래 줄을 그릴 때 쓴다. */
export const bucketTotal = (b: Bucket): number =>
  BUCKET_KEYS.reduce((s, k) => s + b[k], 0)
