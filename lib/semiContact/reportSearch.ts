// 반도체 접촉 보고 — **한 Project 안에서** 보고서를 찾는 규칙 (2026-11-22).
//
// 순수 모듈이다. 상세 화면(app/contact/semi/[projectId]/page.tsx)이 쓰고,
// 하네스(scripts/semi-report-search-check.js)가 키 없이 같은 함수를 시험한다.
// 목록 화면의 검색(lib/semiContact/search.ts)과는 **다른 일**이다 — 그쪽은 Project 를
// 거르고 서버에서 돈다. 이쪽은 **이미 받아 둔 한 Project 의 보고서**를 브라우저에서 센다.
//
// ── 세는 자리와 보이는 자리가 같아야 한다 ────────────────────────────────
//   「N곳 일치」라고 적고서 그 중 하나가 화면에 없으면 사람은 남은 하나를 찾아 헤맨다.
//   그래서 검색 대상은 **읽는 화면에 그리는 칸**으로 못박았다.
//     · 가린 섹션(당사 판단·영업전략 — fields.ts 의 HIDE_SALES_JUDGEMENT)은 **빠진다**.
//     · Project 칸(고객사·사업장/부서·Project/구매안건)도 빠진다 — 그 셋은 보고서가 아니라
//       Project 의 값이라 한 Project 안에서는 모든 보고서가 같다. 거기에 걸리면 「전부 일치」가
//       되어 거르는 뜻이 없고, 화면에서도 보고서 칸이 아니라 머리줄에 있다.
//     · 「직전: ~~값~~」(바뀐 칸의 옛 값)도 빠진다 — 그 보고서의 값이 아니다.
//     · Action 줄의 상태는 셀렉트라 글자를 물들일 수 없어 빠진다. 나머지 다섯 칸은 센다.
//
// 대소문자는 가리지 않는다. 자리 찾기는 **겹치지 않는 앞에서부터**다('aa' 에서 'a' 는 두 곳).

import { FIELDS, isSectionShown, type FieldKey, type ReportInput } from './fields'
import { PROJECT_KEYS } from './project'

/** 검색어 다듬기 — 앞뒤 공백을 지우고 소문자로. 빈 글자면 검색하지 않는다. */
export function normQuery(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/**
 * 검색·하이라이트 대상 칸 — 등록표 순서 그대로.
 * 가린 섹션과 Project 칸을 뺀 나머지 전부다(= 읽는 화면이 그리는 칸).
 */
export const SEARCH_KEYS: readonly FieldKey[] = FIELDS
  .filter(f => isSectionShown(f.section) && !PROJECT_KEYS.includes(f.key))
  .map(f => f.key)

const SEARCH_KEY_SET: ReadonlySet<string> = new Set(SEARCH_KEYS)

/** 그 칸이 검색 대상인가 — 화면이 하이라이트를 걸 때 같은 규칙으로 묻는다. */
export function isSearchKey(key: string): boolean {
  return SEARCH_KEY_SET.has(key)
}

/** Action 줄에서 세는 칸 — 상태(셀렉트)만 뺀다. */
export const ACTION_SEARCH_FIELDS = ['what', 'owner', 'due_date', 'priority', 'note'] as const

/** 세는 데 필요한 Action 줄의 모양. */
export type SearchAction = Record<(typeof ACTION_SEARCH_FIELDS)[number], string>

/** 세는 데 필요한 보고서 한 장의 모양. */
export type SearchableReport = {
  input: ReportInput
  /** 작성자 이름 — 머리줄에 보이므로 센다. */
  authorName: string
  /** 그 보고서의 Action 줄(없으면 빈 배열). */
  actions?: SearchAction[]
}

/** 글자 한 덩어리 안의 일치 자리 — [시작, 끝). 겹치지 않는다. */
export function matchRanges(text: string, q: string): [number, number][] {
  if (!q) return []
  const hay = (text ?? '').toLowerCase()
  const out: [number, number][] = []
  let from = 0
  for (;;) {
    const i = hay.indexOf(q, from)
    if (i < 0) return out
    out.push([i, i + q.length])
    from = i + q.length
  }
}

/** 글자 한 덩어리 안의 일치 수. */
export function countIn(text: string, q: string): number {
  return matchRanges(text, q).length
}

/** 하이라이트용 토막 — 이어 붙이면 원래 글자다. hit 인 토막만 물들인다. */
export function splitHits(text: string, q: string): { text: string; hit: boolean }[] {
  const s = text ?? ''
  const ranges = matchRanges(s, q)
  if (ranges.length === 0) return s ? [{ text: s, hit: false }] : []
  const out: { text: string; hit: boolean }[] = []
  let at = 0
  for (const [a, b] of ranges) {
    if (a > at) out.push({ text: s.slice(at, a), hit: false })
    out.push({ text: s.slice(a, b), hit: true })
    at = b
  }
  if (at < s.length) out.push({ text: s.slice(at), hit: false })
  return out
}

/** 보고서 한 장의 일치 수 — **화면에 물드는 수와 같다**. */
export function reportMatchCount(rep: SearchableReport, q: string): number {
  if (!q) return 0
  let n = 0
  for (const k of SEARCH_KEYS) n += countIn(rep.input[k] ?? '', q)
  n += countIn(rep.authorName ?? '', q)
  for (const a of rep.actions ?? []) {
    for (const f of ACTION_SEARCH_FIELDS) n += countIn(a[f] ?? '', q)
  }
  return n
}

/** 그 보고서가 검색어에 걸리는가. */
export function reportMatches(rep: SearchableReport, q: string): boolean {
  return reportMatchCount(rep, q) > 0
}

/**
 * 걸리는 보고서만 남긴다. 순서는 **넘겨받은 순서 그대로**(정렬은 부르는 쪽 일이다).
 * 검색어가 없으면 넘겨받은 목록을 그대로 돌려준다.
 */
export function filterReports<T extends SearchableReport>(reps: T[], q: string): T[] {
  if (!q) return reps
  return reps.filter(r => reportMatches(r, q))
}

/** 섹션 하나에 일치가 있는가 — 접혀 있는 섹션을 펴 줄지 정하는 데 쓴다. */
export function sectionHasHit(input: ReportInput, keys: readonly string[], q: string): boolean {
  if (!q) return false
  return keys.some(k => isSearchKey(k) && countIn(input[k as FieldKey] ?? '', q) > 0)
}
