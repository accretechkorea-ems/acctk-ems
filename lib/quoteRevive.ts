/**
 * 미수주(실패) 견적을 **「견적중」으로 되돌리기** (2026-11-25).
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────
 * 발주서 등록을 놓쳐 유효기간이 지나면 자동 실주(/api/auto-fail)가 '실패' 로 바꾼다.
 * 상태만 '견적중' 으로 되돌려 놓으면 **다음 번 자동 실주가 또 실패로 돌린다** —
 * 만료 기준이 작성일이고, 그 작성일은 이미 한 달을 넘겼기 때문이다.
 *
 * 그래서 되돌린 **그 날**을 적고(revived_at), 만료 기준일을
 * **coalesce(revived_at, quote_date)** 로 본다. 되돌린 날부터 다시 1개월이 산다.
 * 그 기간이 또 지나면 다시 실패가 되는 것은 정상이다(기간 상수는 그대로다).
 *
 * ── 누가 ─────────────────────────────────────────────────────────────────
 * 이 저장소에 'admin' **등급은 없다** — engineers.permission_level 은 superadmin·member
 * 둘뿐이다(lib/permissions.ts). 그래서 「admin 이상」은 **관리 메뉴 권한**으로 읽는다:
 * canViewMenu(me, 'admin') — 관리 메뉴를 켠 팀 + superadmin. 영역 판정(canViewAdmin)은
 * 영업 메뉴로도 열려(DERIVED_PERMS.admin) 이 자리에는 넓다.
 *
 * 화면·라우트·하네스가 같은 값을 쓴다 — 서버 전용 코드는 넣지 않는다.
 */

import { kstYmd } from '@/lib/date'
import { canViewMenu, type EngineerLike } from '@/lib/permissions'
import { isBackfilled } from '@/lib/quoteBackfill'
import { FAIL_STATUS, PENDING_STATUS } from '@/lib/quoteStatus'

/** 되돌리기를 다루는 데 필요한 견적의 칸들. 없는 칸은 undefined 로 들어온다. */
export type RevivableQuote = {
  quote_id?: number
  quote_number?: string | null
  status?: string | null
  fail_reason?: string | null
  quote_date?: string | null
  /** db/quote_revive_20261125.sql 전에는 undefined 다. */
  revived_at?: string | null
  /** 사후 실적 입력으로 적어 넣은 줄이면 그 시각(db/quote_backfill_20261123.sql). */
  backfilled_at?: string | null
}

/** 되돌리기에 필요한 메뉴 권한 — 「관리」. */
export const REVIVE_MENU = 'admin'

/**
 * 그 견적을 되돌릴 수 있나.
 *   · 관리 메뉴를 가진 사람(+ superadmin)만
 *   · 상태가 '실패' 일 때만 — **미수주 사유는 무엇이든 된다**(자동 실주도 포함)
 *   · **사후 실적 입력 줄은 아니다** — EMS 밖에서 끝난 건이라 되살릴 흐름이 없다
 */
export function canReviveQuote(
  me: EngineerLike | null | undefined,
  quote: RevivableQuote | null | undefined,
): boolean {
  if (!me || !quote) return false
  if (!canViewMenu(me, REVIVE_MENU)) return false
  if (quote.status !== FAIL_STATUS) return false
  if (isBackfilled(quote)) return false
  return true
}

/** 되돌린 뒤의 상태 — 화면과 라우트가 같은 값을 쓴다. */
export const REVIVED_STATUS = PENDING_STATUS

/**
 * 유효기간을 세는 **기준일** — 되돌린 날이 있으면 그 날, 없으면 작성일.
 * 자동 실주와 목록의 D-day 가 모두 이 함수를 지난다(기준이 두 군데로 갈리지 않게).
 */
export function expiryBase(quote: RevivableQuote | null | undefined): string | null {
  const revived = String(quote?.revived_at ?? '').trim()
  if (revived) return kstYmd(revived)
  const made = String(quote?.quote_date ?? '').trim()
  return made || null
}

/** 되돌린 건인가 — 뱃지를 둘지 정한다. */
export function isRevived(quote: RevivableQuote | null | undefined): boolean {
  return String(quote?.revived_at ?? '').trim() !== ''
}

/** 목록·상세의 작은 뱃지 — 「되돌림 26-11-25」. 되돌린 건이 아니면 빈 글자. */
export function reviveBadge(quote: RevivableQuote | null | undefined): string {
  if (!isRevived(quote)) return ''
  return `되돌림 ${kstYmd(String(quote!.revived_at)).slice(2)}`
}

// ── 사유 ──────────────────────────────────────────────────────────────────
export const REASON_MAX = 200

/** 사유를 적었나 — 못 보낼 까닭을 돌려준다(없으면 null). */
export function reviveBlockedReason(reason: string | null | undefined): string | null {
  const v = String(reason ?? '').trim()
  if (!v) return '되돌리는 이유를 입력해주세요'
  if (v.length > REASON_MAX) return `이유는 ${REASON_MAX}자까지입니다`
  return null
}

/**
 * note 끝에 붙이는 한 줄 — 「[되돌림 26-11-25 홍길동: 발주서 등록 누락]」.
 * 견적 사건 표가 없는 자리라, 되돌린 자국을 사람이 읽는 칸에도 남긴다.
 */
export function reviveNoteLine(at: string, name: string | null | undefined, reason: string): string {
  const who = String(name ?? '').trim()
  const why = String(reason ?? '').trim()
  return `[되돌림 ${kstYmd(at).slice(2)}${who ? ` ${who}` : ''}: ${why}]`
}

/** 그 줄을 note 끝에 덧붙인다 — 기존 글은 지우지 않는다. */
export function appendNote(note: string | null | undefined, line: string): string {
  const had = String(note ?? '').trim()
  return had ? `${had}\n${line}` : line
}

// ── 화면 글자 ─────────────────────────────────────────────────────────────
export const REVIVE_LABEL = '견적중으로 되돌리기'
export const REVIVE_TITLE = '견적중으로 되돌리기'
export const REASON_LABEL = '되돌리는 이유'
export const REASON_PLACEHOLDER = '예: 발주서 등록 누락'
export const REVIVE_CONFIRM = '되돌리기'
/** 창 안의 안내 — 무엇이 바뀌는지 먼저 적는다. */
export const REVIVE_NOTICE =
  '상태를 견적중으로 바꾸고 미수주 사유를 지웁니다. 유효기간은 **되돌린 날부터** 다시 1개월입니다'
export const BACKFILL_BLOCKED = '사후 실적으로 적어 넣은 줄은 되돌리지 않습니다'
export const SCHEMA_MESSAGE =
  '되돌리기를 쓰려면 db/quote_revive_20261125.sql 을 먼저 적용해야 합니다'
export const FORBIDDEN_MESSAGE = '견적을 되돌릴 권한이 없습니다'
export const DONE_MESSAGE = '견적중으로 되돌렸습니다'
