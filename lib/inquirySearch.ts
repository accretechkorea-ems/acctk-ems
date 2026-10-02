// 의뢰서 목록의 주소(URL) 해석·페이지 계산·강조 분할. 전부 순수 함수다.
//
// **주소가 정본이다.** 목록이 들고 있는 상태는 주소를 읽어 만든 것뿐이고, 무엇을 바꾸든
// 주소를 다시 쓰는 것으로 끝난다 — 그래야 새로고침·뒤로 가기·링크 공유가 모두 같은 화면을 연다.
// 화면(app/inquiries/page.tsx)은 이 파일의 결과를 그리고 서버에 넘기기만 한다.
//
// 네트워크·DOM 을 쓰지 않아 스크립트로 그대로 돌려 볼 수 있다(그래서 따로 뺐다).

import { INQUIRY_STATUSES, inquiryTypeOf, type InquiryStatus, type InquiryType } from './inquiries'

/** 한 페이지 건수. 연 300건 미만이라 여섯 페이지면 한 해가 다 담긴다. */
export const PAGE_SIZE = 50

/** 연도 선택에서 「전체」를 뜻하는 값. 숫자와 섞이지 않게 문자열로 둔다. */
export const YEAR_ALL = 'all'

export type ListQuery = {
  /** null = 전체 종류. */
  type: InquiryType | null
  /** 숫자면 그 해, 'all' 이면 전체 연도. */
  year: number | typeof YEAR_ALL
  /** null = 전체 상태. */
  status: InquiryStatus | null
  /** null = 전체 담당자. */
  owner: number | null
  /** 빈 문자열 = 검색 없음. 앞뒤 공백은 지운다. */
  q: string
  /** 1부터. */
  page: number
}

/** 주소에서 읽을 수 있는 것만 담은 날것. URLSearchParams 와 같은 모양이면 무엇이든 받는다. */
export type RawParams = { get(key: string): string | null }

/**
 * 연도 기본값 — 주소에 year 가 없을 때.
 *
 *   검색어가 없으면 **올해**다. 평소 보는 것은 올해 번호이고, 해가 바뀌면 자동으로 따라간다.
 *   검색어가 있으면 **전체 연도**다. 검색은 지난 사례를 찾는 일이라 올해로 좁히면
 *   「분명히 있었는데 안 나온다」가 된다.
 */
export function defaultYear(q: string, thisYear: number): number | typeof YEAR_ALL {
  return q.trim() ? YEAR_ALL : thisYear
}

const toInt = (v: string | null): number | null => {
  if (v === null || v.trim() === '') return null
  const n = Number(v)
  return Number.isInteger(n) ? n : null
}

/** 주소 → 상태. 모르는 값·망가진 값은 기본값으로 떨어진다(화면이 비지 않게). */
export function parseListQuery(params: RawParams, thisYear: number): ListQuery {
  const q = (params.get('q') ?? '').trim()

  const rawYear = params.get('year')
  let year: number | typeof YEAR_ALL
  if (rawYear === YEAR_ALL) year = YEAR_ALL
  else {
    const n = toInt(rawYear)
    // 네 자리 연도만 받는다 — 2 나 99999 는 주소를 손으로 고친 경우다.
    year = n !== null && n >= 1000 && n <= 9999 ? n : defaultYear(q, thisYear)
  }

  const rawStatus = params.get('status')
  const status = rawStatus && (INQUIRY_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as InquiryStatus)
    : null

  const owner = (() => {
    const n = toInt(params.get('owner'))
    return n !== null && n >= 1 ? n : null
  })()

  const page = (() => {
    const n = toInt(params.get('page'))
    return n !== null && n >= 1 ? n : 1
  })()

  return { type: inquiryTypeOf(params.get('type')), year, status, owner, q, page }
}

/**
 * 상태 → 주소 문자열. **기본값은 적지 않는다** — 주소가 짧을수록 읽기 쉽고,
 * 「아무것도 안 건드린 상태」와 「기본값을 일부러 고른 상태」가 같은 주소가 된다.
 * 돌려주는 값은 '?' 를 포함하며, 전부 기본값이면 빈 문자열이다.
 */
export function toListQueryString(s: ListQuery, thisYear: number): string {
  const p = new URLSearchParams()
  if (s.q) p.set('q', s.q)
  if (s.type) p.set('type', s.type)
  // 연도는 「지금 검색어에서의 기본값」과 다를 때만 적는다.
  if (String(s.year) !== String(defaultYear(s.q, thisYear))) p.set('year', String(s.year))
  if (s.status) p.set('status', s.status)
  if (s.owner !== null) p.set('owner', String(s.owner))
  if (s.page > 1) p.set('page', String(s.page))
  const out = p.toString()
  return out ? `?${out}` : ''
}

/** 기본값에서 벗어난 것이 하나라도 있는가 — 「초기화」를 보일지 정한다(페이지는 제외). */
export function isFiltered(s: ListQuery, thisYear: number): boolean {
  return Boolean(s.q) || s.type !== null || s.status !== null || s.owner !== null
    || String(s.year) !== String(defaultYear(s.q, thisYear))
}

/** 조건을 바꾸면 페이지는 늘 1로 돌아간다 — 3페이지를 보다 좁히면 빈 화면이 된다. */
export function withFilter(s: ListQuery, part: Partial<ListQuery>): ListQuery {
  return { ...s, ...part, page: 1 }
}

export const totalPages = (total: number): number => Math.max(1, Math.ceil(total / PAGE_SIZE))

/** 건수가 확정된 뒤 범위를 넘은 페이지를 끌어내린다(조용히 마지막 페이지로). */
export const clampPage = (page: number, total: number): number =>
  Math.min(Math.max(1, page), totalPages(total))

/** 지금 페이지가 보여 주는 번째 범위. 0건이면 null. */
export function pageRange(page: number, total: number): { from: number; to: number } | null {
  if (total <= 0) return null
  const p = clampPage(page, total)
  const from = (p - 1) * PAGE_SIZE + 1
  return { from, to: Math.min(p * PAGE_SIZE, total) }
}

/** 페이지 버튼에 쓸 번호. 사이가 끊기는 자리에는 '…' 를 넣는다. */
export type PageItem = number | '…'

/**
 * 처음·끝과 현재 주변만 보여 준다.
 * 가장자리(1~4, 끝에서 4개)에서는 '…' 가 한쪽에만 생겨 버튼 수가 들쭉날쭉하지 않게 한다.
 */
export function pageWindow(page: number, total: number, around = 1): PageItem[] {
  const last = totalPages(total)
  const cur = clampPage(page, total)
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1)

  const set = new Set<number>([1, last, cur])
  for (let d = 1; d <= around; d++) { set.add(cur - d); set.add(cur + d) }
  // 가장자리에서는 반대쪽을 한 칸 더 보여 준다(버튼 수를 비슷하게 유지).
  if (cur <= 3) { set.add(2); set.add(3); set.add(4) }
  if (cur >= last - 2) { set.add(last - 1); set.add(last - 2); set.add(last - 3) }

  const nums = [...set].filter(n => n >= 1 && n <= last).sort((a, b) => a - b)
  const out: PageItem[] = []
  let prev = 0
  for (const n of nums) {
    if (prev && n - prev > 1) out.push('…')
    out.push(n)
    prev = n
  }
  return out
}

/** 연도 선택지 — 전체 + 올해부터 가장 오래된 해까지 내림차순. */
export function yearOptions(oldestYear: number | null, thisYear: number): number[] {
  const from = oldestYear && oldestYear < thisYear ? oldestYear : thisYear
  const out: number[] = []
  for (let y = thisYear; y >= from; y--) out.push(y)
  return out
}

// ── 강조 ────────────────────────────────────────────────────────────

/** 검색어를 단어로. 서버(inquiry_search_words)와 같은 규칙이어야 강조와 결과가 어긋나지 않는다. */
export function searchWords(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean).slice(0, 5)
}

/** 정규식에서 뜻을 갖는 글자를 글자 그대로 바꾼다. 검색어에 . * ( ) 가 들어와도 안전하다. */
export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export type Piece = { text: string; hit: boolean }

/**
 * 글을 「맞은 조각 / 아닌 조각」으로 나눈다. 화면은 hit 인 조각만 굵게 그린다.
 *
 * 대소문자를 가리지 않는다. 한글·일본어에서도 동작한다 — 낱말 경계(\b)를 쓰지 않고
 * 단순 부분 일치로만 자르기 때문이다(서버의 strpos 와 같은 기준).
 * 긴 단어를 먼저 보아 겹치는 단어에서 더 긴 쪽이 통째로 잡히게 한다.
 */
export function splitHighlight(text: string, words: string[]): Piece[] {
  const list = words.filter(Boolean)
  if (!text || list.length === 0) return [{ text, hit: false }]
  const pattern = [...list]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')
  const re = new RegExp(`(${pattern})`, 'gi')
  const out: Piece[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) out.push({ text: text.slice(last, i), hit: false })
    out.push({ text: m[0], hit: true })
    last = i + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false })
  return out.length > 0 ? out : [{ text, hit: false }]
}

// ── 목록의 「내용」·「회신」 열 ──────────────────────────────────────
// DB 함수 inquiry_list_extras 가 돌려주는 값을 화면 글자로 바꾼다(inquiry_list_extras_function.sql).
// 함수가 아직 DB 에 없거나 호출이 실패하면 extras 가 undefined 로 들어온다 — 그때도 깨지지 않아야 한다.

/** inquiry_list_extras 한 행. 내용 기록이 없는 의뢰서는 **행 자체가 오지 않는다**(함수 설계 ①). */
export type InquiryExtras = {
  inquiry_id: string
  /** 본문이 공백이 아닌 가장 최근 기록의 본문(한 줄로 접혀 120자 + …). 없으면 null. */
  last_body: string | null
  /** 가장 최근 기록에 달린 첫 파일 이름. 없으면 null. */
  last_file_name: string | null
  reply_count: number
  reply_file_count: number
  /** 가장 최근 회신 날짜 'YYYY-MM-DD'. 회신이 없으면 null. */
  last_reply_date: string | null
}

export type ReplyView = {
  /** 「회신 3」 */
  label: string
  /** 그 회신들에 달린 첨부 수. 0 이면 클립을 그리지 않는다. */
  fileCount: number
  /** 마우스 올림 설명 — 「최근 회신 2026-10-01 · 파일 3개」 */
  title: string
}

/**
 * 회신 칸. 회신이 **한 건도 없으면 null** — 화면은 그때 흐린 「-」를 그린다.
 * 「대기」처럼 상태를 짐작하는 말은 쓰지 않는다. 회신이 없는 것은 아직 안 온 것일 수도,
 * 애초에 받을 것이 없는 것일 수도 있어서 둘을 구분할 근거가 목록에 없다.
 */
export function replyView(extras: InquiryExtras | undefined): ReplyView | null {
  const n = extras?.reply_count ?? 0
  if (n <= 0) return null
  const files = extras?.reply_file_count ?? 0
  const when = extras?.last_reply_date
  return {
    label: `회신 ${n}`,
    fileCount: files,
    title: [
      when ? `최근 회신 ${when}` : `회신 ${n}건`,
      files > 0 ? `파일 ${files}개` : null,
    ].filter(Boolean).join(' · '),
  }
}

export type ContentPreview = {
  /** body = 본문 한 줄 · file = 파일 이름 · none = 보여 줄 것이 없다 */
  kind: 'body' | 'file' | 'none'
  /** none 이면 빈 문자열 — 화면이 「-」를 그린다. */
  text: string
}

/**
 * 내용 칸. **본문이 우선**이고, 본문이 없을 때만 파일 이름을 보여 준다.
 * 둘 다 없으면 kind 'none' — 내용 기록이 아예 없는 의뢰서(extras 없음)도 여기로 떨어진다.
 */
export function contentPreview(extras: InquiryExtras | undefined): ContentPreview {
  const body = extras?.last_body?.trim()
  if (body) return { kind: 'body', text: body }
  const file = extras?.last_file_name?.trim()
  if (file) return { kind: 'file', text: file }
  return { kind: 'none', text: '' }
}

/**
 * 상세로 갔다 돌아올 주소. 「/inquiries」로 시작하는 내부 경로만 받는다 —
 * 주소창에 외부 주소를 넣어 사용자를 바깥으로 보내는 길(open redirect)을 막는다.
 */
export function safeBackTo(from: string | null): string {
  if (!from) return '/inquiries'
  // '//evil.com' 는 브라우저가 외부 주소로 읽는다. 슬래시 하나로 시작하는 것만 통과시킨다.
  if (!from.startsWith('/inquiries') || from.startsWith('//')) return '/inquiries'
  return from
}
