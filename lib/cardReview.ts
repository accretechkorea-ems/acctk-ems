/**
 * 명함 **검토 대기**의 규칙 한 곳 (2026-11-25).
 *
 * 여러 장 등록이 읽은 줄은 바로 명함첩에 들어가지 않는다. `status='draft'` 로 담기고,
 * 담당자가 쪽 이미지와 대조해 **승인**해야 `active` 가 된다. 목록·검색·엑셀·중복 판정은
 * active 만 본다.
 *
 * 화면(검토 페이지)·라우트·하네스가 같은 값을 쓴다. 서버 전용 코드는 넣지 않는다.
 */

/** 줄의 상태. 칸은 db/business_cards_draft_20261125.sql 이 더한다. */
export const STATUS_DRAFT = 'draft'
export const STATUS_ACTIVE = 'active'
export type CardStatus = typeof STATUS_DRAFT | typeof STATUS_ACTIVE

/** 사건 이름 — 건너뛴 쪽도 자국을 남긴다. */
export const EVENT_SKIPPED = 'card_skipped'
export const EVENT_APPROVED = 'card_approved'

/** 검토 화면이 보여 줄 한 쪽의 상태. */
export type ReviewState =
  /** 사람 명함 — 아직 보지 않았다. */
  | 'wait'
  /** 승인했다(active 가 됐다). */
  | 'approved'
  /** 건너뛰었다(그 draft 를 지웠다). */
  | 'skipped'
  /** 앞 명함에 합쳐진 면. */
  | 'merged'
  /** 이미 있는 명함과 같다. */
  | 'dup'
  /** 사람이 없는 면(광고·뒷면). */
  | 'none'
  /** 빈 면. */
  | 'empty'

/** 뱃지 글자 — 시안 그대로. */
export const REVIEW_LABEL: Record<ReviewState, string> = {
  wait: '대기', approved: '승인', skipped: '건너뜀',
  merged: '합침', dup: '중복', none: '없음', empty: '빈 면',
}

/** 사람이 손볼 수 있는 줄인가 — 대기만 승인·건너뛰기를 할 수 있다. */
export const isPending = (s: ReviewState) => s === 'wait'

/** 한 번에 읽는 쪽 수 — 20쪽마다 멈춰 검토한다(사람이 지치지 않는 단위). */
export const REVIEW_CHUNK = 20

/** 「1~20쪽」. 0부터 세는 쪽 번호를 사람 말로. */
export function pageRangeLabel(from: number, to: number): string {
  return `${from + 1}~${to + 1}쪽`
}

/** 「14쪽」. */
export function pageLabel(page: number): string {
  return `${page + 1}쪽`
}

/** 왼쪽 목록의 한 줄 글자 — 사람 명함은 「이름 · 회사」, 그 밖은 까닭. */
export function rowLabel(row: {
  state: ReviewState; name?: string | null; company?: string | null; mergedInto?: number | null
}): string {
  if (row.state === 'merged') {
    // **합쳐 들어간 쪽 번호**를 적는다(2026-11-25 3차) — 「뒷면」이라는 말은 걷었다.
    // 앞뒷면만 합치는 것이 아니라, 몇 쪽 떨어진 같은 사람의 면도 합친다.
    return row.mergedInto != null ? `↳ ${pageLabel(row.mergedInto)}에 합침` : '↳ 앞면에 합침'
  }
  if (row.state === 'none') return '사람 없는 면'
  if (row.state === 'empty') return '빈 면'
  const name = String(row.name ?? '').trim()
  const company = String(row.company ?? '').trim()
  if (!name && !company) return '읽지 못함'
  return [name, company].filter(Boolean).join(' · ')
}

/** 집계 한 줄 — 시안의 하단 바. */
export type ReviewTally = {
  approved: number; wait: number; skipped: number
  merged: number; dup: number; none: number; empty: number
}

export function tallyOf(states: readonly ReviewState[]): ReviewTally {
  const t: ReviewTally = { approved: 0, wait: 0, skipped: 0, merged: 0, dup: 0, none: 0, empty: 0 }
  for (const s of states) {
    if (s === 'approved') t.approved += 1
    else if (s === 'wait') t.wait += 1
    else if (s === 'skipped') t.skipped += 1
    else if (s === 'merged') t.merged += 1
    else if (s === 'dup') t.dup += 1
    else if (s === 'none') t.none += 1
    else t.empty += 1
  }
  return t
}

export function tallyLabel(t: ReviewTally): string {
  return `승인 ${t.approved} · 대기 ${t.wait} · 건너뜀 ${t.skipped} · 합침 ${t.merged} · 중복 ${t.dup} · 없음 ${t.none}`
}

/** 대기가 남아 있으면 다음으로 못 간다 — 그 까닭을 한 줄로. */
export function blockedReason(t: ReviewTally): string | null {
  return t.wait > 0 ? `아직 검토하지 않은 ${t.wait}건이 있습니다 — 승인하거나 건너뛰어 주세요` : null
}

/** 파일 이름을 기억해 두는 자리(브라우저). 표에는 적지 않는다. */
export const FILE_NAME_KEY = 'cards.import.fileName'

/** 묶음 → 파일 이름. 없으면 null. */
export function readFileName(batchId: string): string | null {
  try {
    const raw = window.localStorage.getItem(FILE_NAME_KEY)
    if (!raw) return null
    const map = JSON.parse(raw) as Record<string, string>
    return map[batchId] ?? null
  } catch {
    return null
  }
}

export function writeFileName(batchId: string, name: string): void {
  try {
    const raw = window.localStorage.getItem(FILE_NAME_KEY)
    const map = raw ? JSON.parse(raw) as Record<string, string> : {}
    map[batchId] = name
    window.localStorage.setItem(FILE_NAME_KEY, JSON.stringify(map))
  } catch {
    // 저장이 막혀 있어도 검토는 돌아간다 — 이름 대신 날짜만 보인다.
  }
}

/** 목록 위의 띠 글자. */
export function pendingBannerLabel(count: number): string {
  return `검토 대기 ${count}장`
}

/** 버리기 전에 묻는 말. */
export function discardQuestion(count: number): string {
  return `검토 대기 ${count}장을 버립니다. 읽은 글자가 사라지고 되돌릴 수 없습니다.`
}

// ── 다음 묶음 읽기 ────────────────────────────────────────────────────────
/**
 * 「다음 20쪽 읽기」 (2026-11-25).
 *
 * 남은 쪽이 20보다 적으면 그 수를 적는다 — 「다음 20쪽」인데 5쪽만 읽히면
 * 무엇이 잘못된 줄 안다. 읽기는 **올린 파일을 그대로** 쓴다(다시 올리지 않는다).
 */
export function nextChunkCount(left: number): number {
  return Math.min(Math.max(0, left), REVIEW_CHUNK)
}

export function nextChunkLabel(left: number): string {
  return `등록하고 다음 ${nextChunkCount(left)}쪽 읽기 →`
}

export function nextChunkTitle(left: number): string {
  return `다음 ${nextChunkCount(left)}쪽을 읽을까요?`
}

export function nextChunkMessage(left: number): string {
  return `올린 파일에서 ${nextChunkCount(left)}쪽을 이어서 읽습니다. 남은 쪽은 ${Math.max(0, left - REVIEW_CHUNK)}쪽입니다.`
}

/** 새로고침해서 올린 파일이 사라졌을 때 — 되살릴 길이 없다(서버에 올리지 않는다). */
export const RELOAD_NOTICE =
  '올린 파일은 저장하지 않으므로, 남은 쪽을 읽으려면 목록의 「여러 장 등록」에서 그 파일을 다시 올려 주세요.'
