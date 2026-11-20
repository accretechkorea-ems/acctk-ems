// 고객사 필터의 **칩**과 「좁혔는가」 판정 — 지도·목록이 함께 쓴다.
//
// 규칙은 활동 이력 필터(lib/timelineFilter.ts)와 같다:
//   · 고를 수 있는 것을 **전부** 고른 묶음은 좁히지 않은 것이다 → 칩이 없다.
//   · 아무것도 고르지 않으면 0건이다(전부 고른 것과 같게 보지 않는다).
//   · 칩을 지우면 그 묶음이 **전체로 돌아온다**(0건으로 떨어뜨리지 않는다).
// 묶음의 종류만 다르다 — 상태·장비 계열·대리점·지역·최근 활동.

import { sameSet } from './timelineFilter'
import { DIRECT_SALE, RECENT_LABEL, type ListFilter, type RecentKey } from './customerList'

export type FilterOptions = {
  statuses: readonly string[]
  categories: readonly string[]
  regions: readonly string[]
  /** 대리점 목록 — 직판(DIRECT_SALE)을 맨 앞에 둔 채로 넘긴다. */
  agencies: readonly { id: number; name: string }[]
}

export type CustomerChip = {
  key: string
  label: string
  drop: (f: ListFilter) => ListFilter
}

const agencyName = (opts: FilterOptions, id: number) =>
  (id === DIRECT_SALE ? 'ACCT-K' : opts.agencies.find(a => a.id === id)?.name) ?? `대리점 ${id}`

/** 묶음별로 좁혔는가 — 칩을 낼지, 「필터 N」의 N 에 셀지 정한다. */
export const narrows = {
  status: (f: ListFilter, o: FilterOptions) => !sameSet(f.statuses, o.statuses),
  category: (f: ListFilter, o: FilterOptions) => !sameSet(f.categories, o.categories),
  region: (f: ListFilter) => f.regions.length > 0,
  agency: (f: ListFilter) => f.agencies.length > 0,
  recent: (f: ListFilter) => f.recent !== 'any',
  openQuotes: (f: ListFilter) => f.openQuotesOnly,
  noIndustry: (f: ListFilter) => f.noIndustryOnly,
}

/**
 * 머리줄에 남길 칩. 상태·장비 계열은 **고른 것을 한 칩으로 묶는다**
 * (「활성·잠재」) — 셋을 각각 칩으로 내면 줄이 금세 넘친다.
 * 지역·대리점은 하나씩 낸다(무엇을 골랐는지가 곧 정보다).
 */
export function customerFilterChips(f: ListFilter, o: FilterOptions): CustomerChip[] {
  const out: CustomerChip[] = []
  if (narrows.status(f, o)) {
    out.push({
      key: 'status',
      label: f.statuses.length === 0 ? '상태 없음' : f.statuses.join('·'),
      drop: x => ({ ...x, statuses: [...o.statuses] }),
    })
  }
  if (narrows.category(f, o)) {
    out.push({
      key: 'category',
      label: f.categories.length === 0 ? '계열 없음' : f.categories.join('·'),
      drop: x => ({ ...x, categories: [...o.categories] }),
    })
  }
  for (const r of f.regions) {
    out.push({ key: `region:${r}`, label: r, drop: x => ({ ...x, regions: x.regions.filter(v => v !== r) }) })
  }
  for (const id of f.agencies) {
    out.push({
      key: `agency:${id}`,
      label: agencyName(o, id),
      drop: x => ({ ...x, agencies: x.agencies.filter(v => v !== id) }),
    })
  }
  if (narrows.recent(f)) {
    out.push({ key: 'recent', label: RECENT_LABEL[f.recent], drop: x => ({ ...x, recent: 'any' as RecentKey }) })
  }
  if (narrows.openQuotes(f)) {
    out.push({ key: 'openQuotes', label: '진행 견적', drop: x => ({ ...x, openQuotesOnly: false }) })
  }
  if (narrows.noIndustry(f)) {
    out.push({ key: 'noIndustry', label: '분류 없음', drop: x => ({ ...x, noIndustryOnly: false }) })
  }
  return out
}

/** 「필터 N」의 N — 칩 수와 같다. 0 이면 배지를 내지 않는다. */
export const appliedCount = (f: ListFilter, o: FilterOptions): number => customerFilterChips(f, o).length

/** 처음 상태 — 상태·장비 계열은 전부 고른 채, 나머지는 비어 있다. */
export function defaultFilter(o: FilterOptions, base: ListFilter): ListFilter {
  return {
    ...base,
    statuses: [...o.statuses],
    categories: [...o.categories],
    regions: [],
    agencies: [],
    recent: 'any',
    openQuotesOnly: false,
    noIndustryOnly: false,
  }
}
