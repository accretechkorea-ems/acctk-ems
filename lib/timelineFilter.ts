// 활동 이력의 **필터** — 종류·사업장·기간. 순수 함수만 둔다(화면은 이것을 그린다).
//
// 왜 머리줄에서 모달로 옮겼나(2026-11-20)
//   종류는 단일 선택 세그먼트, 사업장은 칩 줄, 기간은 아예 없었다. 머리줄이 길어
//   사업장이 여섯 곳만 넘어도 옆으로 밀렸고, 「서비스 + 제천 1공장 + 올해」처럼
//   둘 이상을 겹쳐 보는 일이 안 됐다. 이제 모달에서 겹쳐 고르고, 머리줄에는
//   **적용된 것만 칩으로** 남는다 — 무엇이 걸러진 상태인지 한 눈에 보이게.
//
// 「좁히지 않음」의 뜻: 묶음을 **전부** 고른 상태다. 전부 고른 것과 아무것도 고르지
// 않은 것을 같게 보지 않는다 — 아무것도 고르지 않으면 0건이 맞다(사람이 그렇게 골랐다).

export const TIMELINE_KINDS = ['영업', '서비스', '견적', '포캐스트', '홀딩', '사건'] as const
export type TimelineKind = (typeof TIMELINE_KINDS)[number]

export type TimelineFilter = {
  kinds: TimelineKind[]
  siteIds: number[]
  /** 'YYYY-MM-DD' 또는 ''. */
  from: string
  to: string
}

/** 걸러지는 줄이 갖춰야 하는 것만. 화면의 Item 이 이 꼴을 만족한다. */
export type FilterableRow = {
  kind: string
  date: string | null
  siteId?: number | null
}

/** 처음 상태 — 종류·사업장을 **전부** 고른 채로 둔다. */
export const allSelected = (kinds: readonly TimelineKind[], siteIds: readonly number[]): TimelineFilter =>
  ({ kinds: [...kinds], siteIds: [...siteIds], from: '', to: '' })

export const sameSet = (a: readonly (string | number)[], b: readonly (string | number)[]): boolean =>
  a.length === b.length && new Set(a).size === new Set([...a, ...b]).size

/** 종류를 좁혔는가 — 고를 수 있는 전부를 고른 상태면 아니다. */
export const narrowsKind = (f: TimelineFilter, available: readonly TimelineKind[]): boolean =>
  !sameSet(f.kinds, available)

export const narrowsSite = (f: TimelineFilter, available: readonly number[]): boolean =>
  available.length > 0 && !sameSet(f.siteIds, available)

export const narrowsPeriod = (f: TimelineFilter): boolean => f.from !== '' || f.to !== ''

/**
 * 거르기. 좁히지 않은 묶음은 건너뛴다.
 *   · 사업장으로 좁히면 **사업장이 없는 줄**(siteId null)은 빠진다 — 어느 사업장인지
 *     모르는 줄을 고른 사업장의 줄이라고 할 수 없다.
 *   · 기간으로 좁히면 **날짜 없는 줄**도 빠진다(visit_date 가 빈 옛 서비스 기록).
 */
export function applyFilter<T extends FilterableRow>(
  rows: T[],
  f: TimelineFilter,
  available: { kinds: readonly TimelineKind[]; siteIds: readonly number[] },
): T[] {
  const byKind = narrowsKind(f, available.kinds)
  const bySite = narrowsSite(f, available.siteIds)
  const byPeriod = narrowsPeriod(f)
  if (!byKind && !bySite && !byPeriod) return rows

  const kinds = new Set<string>(f.kinds)
  const sites = new Set<number>(f.siteIds)
  return rows.filter(r => {
    if (byKind && !kinds.has(r.kind)) return false
    if (bySite && (r.siteId == null || !sites.has(r.siteId))) return false
    if (byPeriod) {
      if (!r.date) return false
      if (f.from && r.date < f.from) return false
      if (f.to && r.date > f.to) return false
    }
    return true
  })
}

/** 종류별 건수 — 모달의 체크 칩 옆에 붙는다. 기간·사업장은 이미 걸린 묶음에서 센다. */
export function countByKind(rows: FilterableRow[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of TIMELINE_KINDS) out[k] = 0
  for (const r of rows) out[r.kind] = (out[r.kind] ?? 0) + 1
  return out
}

/** 사업장별 건수 — 모달의 사업장 체크 옆에 붙는다. */
export function countBySite(rows: FilterableRow[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const r of rows) {
    if (r.siteId == null) continue
    out.set(r.siteId, (out.get(r.siteId) ?? 0) + 1)
  }
  return out
}

export type FilterChip = {
  /** 지우는 데 쓰는 열쇠. */
  key: string
  label: string
  /** 무엇을 지울 것인가. */
  drop: { kind: TimelineKind } | { siteId: number } | { period: true }
}

/**
 * 머리줄에 남길 칩 — **좁힌 묶음만** 내보낸다. 전부 고른 묶음은 칩이 없다
 * (「전체」 칩은 아무것도 말해 주지 않는다).
 */
export function filterChips(
  f: TimelineFilter,
  available: { kinds: readonly TimelineKind[]; siteIds: readonly number[] },
  siteName: (id: number) => string,
): FilterChip[] {
  const out: FilterChip[] = []
  if (narrowsKind(f, available.kinds)) {
    for (const k of available.kinds) {
      if (f.kinds.includes(k)) out.push({ key: `kind:${k}`, label: k, drop: { kind: k } })
    }
  }
  if (narrowsSite(f, available.siteIds)) {
    for (const id of available.siteIds) {
      if (f.siteIds.includes(id)) out.push({ key: `site:${id}`, label: siteName(id) || `사업장 ${id}`, drop: { siteId: id } })
    }
  }
  if (narrowsPeriod(f)) {
    const label = f.from && f.to ? `${f.from} ~ ${f.to}` : f.from ? `${f.from} 이후` : `${f.to} 이전`
    out.push({ key: 'period', label, drop: { period: true } })
  }
  return out
}

/** 칩 하나를 지운 결과. 마지막 하나를 지우면 그 묶음은 **전부 고른 상태**로 돌아간다. */
export function dropChip(
  f: TimelineFilter,
  chip: FilterChip,
  available: { kinds: readonly TimelineKind[]; siteIds: readonly number[] },
): TimelineFilter {
  if ('period' in chip.drop) return { ...f, from: '', to: '' }
  if ('kind' in chip.drop) {
    const gone = chip.drop.kind
    const kinds = f.kinds.filter(k => k !== gone)
    return { ...f, kinds: kinds.length === 0 ? [...available.kinds] : kinds }
  }
  const id = chip.drop.siteId
  const siteIds = f.siteIds.filter(s => s !== id)
  return { ...f, siteIds: siteIds.length === 0 ? [...available.siteIds] : siteIds }
}
