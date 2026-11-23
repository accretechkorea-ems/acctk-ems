/**
 * 사후 실적 입력 — **EMS 밖에서 끝난 건을 손으로 적어 넣는다** (2026-11-23).
 *
 * ── 무엇을 적나 ───────────────────────────────────────────────────────────
 * 실적 숫자가 보는 칸은 셋뿐이다(lib/salesStats.ts).
 *   · 견적 제출 — quote_date + total_supply
 *   · 수주     — status 가 수주 묶음 + purchase_order_at
 *   · 매출     — status 가 매출완료 + tax_invoice_completed_at
 * 그래서 이 창은 **상태를 고르면 그 상태가 쓰는 날짜 칸**을 받는다. 날짜를 비워 두면
 * 그 지표의 어느 기간에도 잡히지 않는다 — 적어 넣고도 숫자가 안 늘어나는 일이 생긴다.
 *
 * ── 금액 ─────────────────────────────────────────────────────────────────
 * 실적은 전부 원화로 센다. 엔화·달러로 끝난 건은 **통화와 환율을 함께 받아** 원화로
 * 바꿔 담는다(그 두 값은 품목 한 줄에 남겨 나중에 되짚을 수 있게 한다).
 *
 * ── 왜 표시하나 ──────────────────────────────────────────────────────────
 * 적어 넣은 줄은 EMS 가 만든 줄과 생김새가 같다. 구분이 없으면 「이 숫자가 어디서
 * 왔는가」를 알 수 없다. db/quote_backfill_20261123.sql 의 두 칸이 그 자국이고,
 * 목록은 BACKFILL_BADGE 를 띄운다.
 */

// ── 뱃지 ──────────────────────────────────────────────────────────────────

/** 목록에서 적어 넣은 줄에 붙는 글자. */
export const BACKFILL_BADGE = '사후 입력'

/** 그 줄이 사후 입력인가. 칸이 없는 DB 에서는 늘 거짓이다. */
export function isBackfilled(q: { backfilled_at?: string | null } | null | undefined): boolean {
  return !!q?.backfilled_at
}

// ── 상태와 날짜 ───────────────────────────────────────────────────────────

/** 사후 입력으로 고를 수 있는 상태 — 실적에 잡히는 것만 둔다. */
export const BACKFILL_STATUSES = ['견적중', '수주', '매출완료'] as const
export type BackfillStatus = (typeof BACKFILL_STATUSES)[number]

/**
 * 그 상태가 쓰는 **날짜 칸**. 견적중은 quote_date 하나로 끝난다.
 * 값은 quotes 의 칸 이름 그대로다 — 라우트가 이것으로 담는다.
 */
export function statusDateField(status: string): 'purchase_order_at' | 'tax_invoice_completed_at' | null {
  if (status === '수주') return 'purchase_order_at'
  if (status === '매출완료') return 'tax_invoice_completed_at'
  return null
}

/** 그 날짜 칸을 사람에게 뭐라고 부르나. */
export function statusDateLabel(status: string): string | null {
  if (status === '수주') return '발주일'
  if (status === '매출완료') return '세금계산서 완료일'
  return null
}

/** 그 상태인가. */
export function isBackfillStatus(v: unknown): v is BackfillStatus {
  return (BACKFILL_STATUSES as readonly string[]).includes(String(v))
}

// ── 통화 ──────────────────────────────────────────────────────────────────

/** 고를 수 있는 통화. 원화는 환율을 받지 않는다. */
export const CURRENCIES = ['KRW', 'JPY', 'USD'] as const
export type Currency = (typeof CURRENCIES)[number]

export function isCurrency(v: unknown): v is Currency {
  return (CURRENCIES as readonly string[]).includes(String(v))
}

/** 원화로 바꾼 금액(원 단위, 반올림). 원화면 환율을 보지 않는다. */
export function amountKrw(amount: number, currency: string, rate: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  if (currency === 'KRW') return Math.round(amount)
  if (!Number.isFinite(rate) || rate <= 0) return 0
  return Math.round(amount * rate)
}

// ── 적을 수 있는가 ────────────────────────────────────────────────────────

/** 창이 들고 있는 값. 라우트도 같은 모양으로 받는다. */
export type BackfillForm = {
  customerId: number | null
  formKind: string
  engineerId: number | null
  status: string
  /** 견적을 낸 날 — 어느 상태든 받는다(견적 제출 집계가 본다). */
  quoteDate: string
  /** 상태가 쓰는 날짜(statusDateField). 견적중이면 빈 값이어도 된다. */
  statusDate: string
  amount: number
  currency: string
  exchangeRate: number
  /** 견적번호 — 비워 두면 자동으로 받는다. */
  quoteNumber: string
  /** 자동으로 받을 것인가. */
  autoNumber: boolean
  /** PDF 를 골랐는가(파일 자체는 창이 들고 있다). */
  hasPdf: boolean
  note: string
}

export const NOTE_MAX = 500

/**
 * 못 적는 까닭 — 첫 번째 하나만 돌려준다. 없으면 null(버튼이 켜진다).
 * 순서는 **창에서 위에서 아래로** 읽히는 차례다. 아래 칸을 먼저 나무라지 않는다.
 */
export function backfillBlockedReason(f: BackfillForm): string | null {
  if (f.customerId == null) return '사업장을 골라주세요'
  if (!f.formKind) return '양식을 골라주세요'
  if (f.engineerId == null) return '담당자를 골라주세요'
  if (!isBackfillStatus(f.status)) return '상태를 골라주세요'
  if (!f.quoteDate) return '견적일을 적어주세요'
  const field = statusDateField(f.status)
  if (field && !f.statusDate) return `${statusDateLabel(f.status)}을 적어주세요`
  if (!Number.isFinite(f.amount) || f.amount <= 0) return '금액을 적어주세요'
  if (!isCurrency(f.currency)) return '통화를 골라주세요'
  if (f.currency !== 'KRW' && (!Number.isFinite(f.exchangeRate) || f.exchangeRate <= 0)) return '환율을 적어주세요'
  if (!f.autoNumber && !f.quoteNumber.trim()) return '견적번호를 적거나 자동으로 받으세요'
  if (!f.hasPdf) return 'PDF 를 첨부해주세요'
  if (f.note.length > NOTE_MAX) return `비고는 ${NOTE_MAX}자까지 적을 수 있습니다`
  return null
}

/** 빈 창의 값. */
export const EMPTY_BACKFILL: BackfillForm = {
  customerId: null, formKind: '', engineerId: null, status: '',
  quoteDate: '', statusDate: '', amount: 0, currency: 'KRW', exchangeRate: 0,
  quoteNumber: '', autoNumber: true, hasPdf: false, note: '',
}

// ── 견적번호 ──────────────────────────────────────────────────────────────

/**
 * 자동 번호 — create_quote(DB 함수)와 **같은 규칙**이다(db/create_quote_current.sql).
 *   No.{이니셜}{YYYYMMDD}-{순번을 26진 알파벳으로}
 * 순번은 DB 가 센다(next_quote_seq) — 여기서는 글자만 만든다.
 */
export function quoteNumberOf(initials: string, ymd: string, seq: number): string {
  let n = seq
  let letters = ''
  while (n > 0) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters
    n = Math.floor((n - 1) / 26)
  }
  return `No.${initials.trim().toUpperCase()}${ymd}-${letters}`
}

/** 날짜(YYYY-MM-DD)를 번호가 쓰는 꼴(YYYYMMDD)로. 모양이 아니면 빈 글자. */
export function ymdCompact(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  return m ? `${m[1]}${m[2]}${m[3]}` : ''
}

// ── 칸이 아직 없는 DB ─────────────────────────────────────────────────────

export const BACKFILL_SCHEMA_MESSAGE =
  '사후 실적 입력을 쓰려면 db/quote_backfill_20261123.sql 을 먼저 적용해야 합니다'

/** 그 오류가 「사후 입력 칸이 아직 없다」인가(42703 / PGRST204). */
export function isMissingBackfillColumn(err?: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false
  if (err.code === '42703' || err.code === 'PGRST204') return true
  return typeof err.message === 'string' && err.message.includes('backfilled_')
}
