/**
 * 명함 목록의 **조건을 주소에 남긴다** (2026-11-23).
 *
 * 찾아 둔 목록을 그대로 보내거나 새로고침해도 같은 화면이 떠야 한다. 조건이 화면
 * 상태로만 있으면 그 둘이 안 된다 — 주소(URL 쿼리)가 정본이다.
 *
 * 순수 모듈이다 — 조회도 화면도 없다. 하네스가 돌린다.
 */

import type { BusinessCard } from './businessCard'
import { matchesCard } from './businessCard'

export type CardFilter = {
  /** 검색어 — 이름·회사·부서·전화·이메일. */
  q: string
  /** 사업부. 빈 글자면 전체. */
  division: string
  /** 등록자(engineer_id). 0이면 전체. */
  engineerId: number
  /** 등록자 팀. 빈 글자면 전체. */
  team: string
  /** 등록 기간 — YYYY-MM-DD. 빈 글자면 열려 있다. */
  from: string
  to: string
  /**
   * 확인 상태 (2026-11-24). `'none'` 이면 **확인 전**(verified_at 이 비어 있는 줄)만.
   * 여러 장 등록으로 담은 줄이 여기에 모인다 — 아무도 눈으로 보지 않았기 때문이다.
   */
  checked: '' | 'none'
}

export const EMPTY_FILTER: CardFilter =
  { q: '', division: '', engineerId: 0, team: '', from: '', to: '', checked: '' }

/** 주소에 적는 이름 — 짧게 둔다(붙여 넣은 주소가 읽히게). */
const KEYS = {
  q: 'q', division: 'div', engineerId: 'by', team: 'team', from: 'from', to: 'to', checked: 'checked',
} as const

/** 주소 → 조건. 모르는 값은 기본값으로 떨어진다(깨진 주소로도 화면이 뜬다). */
export function filterFromQuery(params: URLSearchParams | Record<string, string | undefined>): CardFilter {
  const get = (k: string): string => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k]
    return String(v ?? '').trim()
  }
  const by = Number(get(KEYS.engineerId))
  const div = get(KEYS.division)
  return {
    q: get(KEYS.q),
    division: div === '계측' || div === '반도체' ? div : '',
    engineerId: Number.isInteger(by) && by > 0 ? by : 0,
    team: get(KEYS.team),
    from: get(KEYS.from),
    to: get(KEYS.to),
    checked: get(KEYS.checked) === 'none' ? 'none' : '',
  }
}

/** 조건 → 주소. **기본값은 적지 않는다** — 주소가 길어지면 읽히지 않는다. */
export function queryFromFilter(f: CardFilter): string {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set(KEYS.q, f.q.trim())
  if (f.division) p.set(KEYS.division, f.division)
  if (f.engineerId > 0) p.set(KEYS.engineerId, String(f.engineerId))
  if (f.team) p.set(KEYS.team, f.team)
  if (f.from) p.set(KEYS.from, f.from)
  if (f.to) p.set(KEYS.to, f.to)
  if (f.checked === 'none') p.set(KEYS.checked, 'none')
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** 조건이 하나라도 걸려 있나 — 「조건 없음」을 말할 때 쓴다. */
export function hasFilter(f: CardFilter): boolean {
  return queryFromFilter(f) !== ''
}

/**
 * 조건에 맞는 명함만.
 * `allowed` 는 그 사람이 볼 수 있는 사업부다(lib/businessCard.ts 의 visibleDivisions) —
 * **조건보다 먼저** 걸린다. 주소를 손으로 고쳐도 남의 사업부는 보이지 않는다.
 */
export function applyCardFilter(
  rows: readonly BusinessCard[],
  f: CardFilter,
  allowed: readonly string[],
): BusinessCard[] {
  return rows.filter(c => {
    if (c.deleted_at) return false
    if (!allowed.includes(c.division)) return false
    if (f.division && c.division !== f.division) return false
    if (f.engineerId > 0 && Number(c.engineer_id ?? 0) !== f.engineerId) return false
    if (f.team && String(c.registered_team ?? '') !== f.team) return false
    const day = String(c.registered_at ?? '').slice(0, 10)
    if (f.from && day < f.from) return false
    if (f.to && day > f.to) return false
    if (f.checked === 'none' && !isUnchecked(c)) return false
    return matchesCard(c, f.q)
  })
}

/** 아직 아무도 눈으로 보지 않은 줄인가 — 마지막 확인(verified_at)이 비어 있다. */
export function isUnchecked(c: Pick<BusinessCard, 'verified_at'>): boolean {
  return String(c.verified_at ?? '').trim() === ''
}

/**
 * 「확인 전 N건」의 N — **사업부가 보이는 줄 중에서만** 센다.
 * 검색어·기간 같은 다른 조건은 보지 않는다(그 칩을 누르면 조건이 바뀌므로,
 * 세는 수는 「지금 조건에서 몇 건」이 아니라 「이 사람에게 몇 건 남았나」가 맞다).
 */
export function countUnchecked(rows: readonly BusinessCard[], allowed: readonly string[]): number {
  return rows.filter(c => !c.deleted_at && allowed.includes(c.division) && isUnchecked(c)).length
}
