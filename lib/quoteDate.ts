// 견적 **작성 날짜** — 지난 날짜로 쓰는 규칙을 한곳에 모은 순수 모듈.
//
// ── 왜 지난 날짜로 쓸 수 있어야 하는가 ─────────────────────────────────────
//   현장에서 먼저 건네고 시스템에는 며칠 뒤에 넣는 일이 있다. 그때 오늘 날짜로 들어가면
//   고객이 받은 종이와 번호·작성일이 달라지고, 실적도 엉뚱한 달에 잡힌다.
//
// ── DB 는 이미 할 줄 안다 ──────────────────────────────────────────────────
//   create_quote(p_date, …) 가 받은 날짜로 next_quote_seq 를 돌려 **그 날짜의 다음 순번**을
//   준다(10월 5일에 C 까지 있으면 D). quotes.created_at 에는 실제로 입력한 시각이 남으므로
//   「언제 쓴 건을 언제 넣었는지」는 그대로 추적된다. 그래서 화면만 날짜를 고르면 된다.
//
// ── 미래는 고를 수 없다 ────────────────────────────────────────────────────
//   앞당겨 번호를 선점하면 그날 실제로 쓴 사람의 번호와 섞인다. 달력의 max 로 막고,
//   값으로도 막는다(safeQuoteDate) — 손으로 친 값·옛 초안·주소 파라미터가 들어오는 길이 있다.
//
// 날짜는 **'YYYY-MM-DD'(한국 기준)** 한 가지 모양으로만 다룬다. DB 로 보내는 'YYYYMMDD' 는
// compactYmd 가 만든다. 화면·DB 를 모른다(import 는 날짜 유틸 하나뿐) — 스크립트로 그대로 돌아간다.

import { kstYmd, todayKST } from './date'

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/** 'YYYY-MM-DD' 모양인가(달·일의 범위까지 본다 — '2026-13-40' 은 아니다). */
export function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !YMD_RE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  // 그 달에 실제로 있는 날인가(2월 30일을 막는다). UTC 로 만들어 시간대가 끼어들지 않게 한다.
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/** create_quote 의 p_date — 'YYYY-MM-DD' → 'YYYYMMDD'. 모양이 아니면 빈 글자다. */
export const compactYmd = (ymd: string): string => (isYmd(ymd) ? ymd.replace(/-/g, '') : '')

/**
 * 견적서에 찍히는 작성일 — 'YYYY년　MM월　DD일'.
 * 사이 공백은 **전각 공백(U+3000)** 이다. 레퍼런스 양식의 간격이라 바꾸지 않는다.
 */
export const displayYmd = (ymd: string): string =>
  (isYmd(ymd) ? `${ymd.slice(0, 4)}년　${ymd.slice(5, 7)}월　${ymd.slice(8, 10)}일` : '')

/** 그 날짜로 견적을 쓸 수 있는가 — **오늘(한국)까지만** 된다. */
export const isWritableQuoteDate = (ymd: string, today: string = todayKST()): boolean =>
  isYmd(ymd) && ymd <= today

/**
 * 무엇이 와도 **쓸 수 있는 날짜**로 떨어뜨린다(모양이 아니거나 미래면 오늘).
 * 날짜 칸·옛 초안·주소 파라미터가 모두 이 함수를 거친다 — 미래 날짜가 상태에 들어오는
 * 길을 하나도 남기지 않는다.
 */
export function safeQuoteDate(v: unknown, today: string = todayKST()): string {
  return typeof v === 'string' && isWritableQuoteDate(v, today) ? v : today
}

/** 오늘이 아닌 **지난 날짜**로 쓰고 있는가. */
export const isBackdated = (ymd: string, today: string = todayKST()): boolean =>
  isYmd(ymd) && ymd < today

/** 그 날짜가 **이번 달이 아닌가**(실적이 다른 달에 잡힌다는 뜻). */
export const differsInMonth = (ymd: string, today: string = todayKST()): boolean =>
  isYmd(ymd) && ymd.slice(0, 7) !== today.slice(0, 7)

/** 그 날짜의 달(1~12). 모양이 아니면 0 — 「{M}월 실적에 들어갑니다」에 쓴다. */
export const monthOf = (ymd: string): number => (isYmd(ymd) ? Number(ymd.slice(5, 7)) : 0)

/**
 * **지난 날짜로 넣은 견적인가** — 목록의 작은 표시가 이 판정을 쓴다.
 * 견적 날짜(quote_date)와 **실제로 넣은 날**(created_at 을 한국 날짜로 읽은 값)이 다르면 참이다.
 * created_at 이 없으면(옛 데이터·조회에서 빠진 경우) **표시하지 않는다** — 모르는 것을
 * 「지난 날짜」로 단정하지 않는다.
 */
export function isBackdatedQuote(quoteDate: string | null | undefined, createdAt: string | null | undefined): boolean {
  if (!quoteDate || !createdAt) return false
  const made = kstYmd(createdAt)
  return made !== '' && made !== quoteDate
}

/** 그 표시에 마우스를 올렸을 때 나오는 글자 — 「실제 작성 2026-10-21」. */
export const backdatedTitle = (createdAt: string | null | undefined): string => {
  const made = createdAt ? kstYmd(createdAt) : ''
  return made ? `실제 작성 ${made}` : ''
}
