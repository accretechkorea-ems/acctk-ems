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

export const TIMELINE_KINDS = ['영업', '서비스', '견적', '의뢰', '포캐스트', '홀딩', '사건', '변경'] as const
export type TimelineKind = (typeof TIMELINE_KINDS)[number]

/**
 * **처음에 꺼 두는 종류**(2026-11-23).
 *
 * 「변경」은 사람이 밖에서 한 일이 아니라 **화면에서 고친 자국**이다(상태·대리점·분류·
 * 사업장·담당자·장비 수정, 이동·병합). 찾을 수 있어야 하지만 평소 이력을 덮으면 안 된다 —
 * 그래서 목록에는 있고 **기본 필터에서는 꺼져 있다**. 모달에서 켜면 보인다.
 * 최근 활동(lib/customerLastTouch.ts)은 이 줄을 아예 보지 않는다.
 */
export const DEFAULT_OFF_KINDS: readonly TimelineKind[] = ['변경']

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

/**
 * 처음 상태 — 종류·사업장을 **전부** 고른 채로 둔다.
 * 다만 기본으로 꺼 두는 종류(DEFAULT_OFF_KINDS)는 빼고 시작한다.
 */
export const allSelected = (kinds: readonly TimelineKind[], siteIds: readonly number[]): TimelineFilter =>
  ({ kinds: kinds.filter(k => !DEFAULT_OFF_KINDS.includes(k)), siteIds: [...siteIds], from: '', to: '' })

export const sameSet = (a: readonly (string | number)[], b: readonly (string | number)[]): boolean =>
  a.length === b.length && new Set(a).size === new Set([...a, ...b]).size

/**
 * 종류를 좁혔는가 — **처음 상태와 같으면 아니다**.
 *
 * 기준이 「고를 수 있는 전부」가 아니라 **처음 상태**(allSelected)인 까닭: 기본으로 꺼 두는
 * 종류(변경)가 생기면서, 아무것도 건드리지 않은 화면이 「좁혀진 상태」로 보이고 칩이
 * 일곱 개 깔렸다. 사람이 고른 것이 아니면 칩을 내지 않는다.
 */
export const narrowsKind = (f: TimelineFilter, available: readonly TimelineKind[]): boolean =>
  !sameSet(f.kinds, available.filter(k => !DEFAULT_OFF_KINDS.includes(k)))

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
  // 거르기는 **실제로 고른 집합**을 본다 — 칩(narrowsKind)과 기준이 다르다.
  // 기본으로 꺼 둔 종류(변경)는 「사람이 좁힌 것」은 아니지만 **걸러지기는 해야 한다**.
  const byKind = !sameSet(f.kinds, available.kinds)
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
    // 마지막 하나를 지우면 **처음 상태**로 돌아간다(0건이 되지 않게). 기본으로 꺼 두는
    // 종류는 그대로 꺼진 채다 — 지웠더니 안 보이던 것이 켜지면 사람이 놀란다.
    return { ...f, kinds: kinds.length === 0 ? allSelected(available.kinds, []).kinds : kinds }
  }
  const id = chip.drop.siteId
  const siteIds = f.siteIds.filter(s => s !== id)
  return { ...f, siteIds: siteIds.length === 0 ? [...available.siteIds] : siteIds }
}

// ── 떠날 때의 필터를 기억한다 ─────────────────────────────────────────────
//
// 회사 화면에서 사업장으로 들어가면 그 화면(CompanyPane)은 **아예 사라진다** — 우측
// pane 을 사업장 화면으로 갈아 끼우기 때문이다. 돌아오면 새로 그려지므로 필터는
// 처음 상태로 되돌아갔다.
//
// 전에는 그 자리를 「돌아올 때 그 사업장 칩을 자동으로 거는」 것으로 메웠다. 보던 자리를
// 지켜 주려던 것인데, 돌아오면 늘 한 사업장으로 좁혀진 이력이 떠서 회사 전체를 다시
// 보려면 매번 필터를 풀어야 했다(2026-11-21에 걷었다). 대신 **떠날 때의 필터 그대로**
// 되살린다 — 사람이 고른 것은 사람이 풀 때까지 그대로다.
//
// 기억은 **이 세션(탭)에서만** 산다. 새로고침하면 처음 상태다 — 저장해 두면 어제 걸어
// 둔 필터 때문에 「왜 이 회사는 기록이 없나」를 다시 겪는다. 열쇠는 업체 번호이므로
// 회사와 사업장, 다른 회사끼리 서로 섞이지 않는다.

const memory = new Map<number, TimelineFilter>()

/** 그 화면의 필터를 기억해 둔다. 좁히지 않은 상태면 기억을 지운다(처음 상태가 곧 기본이다). */
export function rememberFilter(
  customerId: number | null | undefined,
  f: TimelineFilter,
  available: { kinds: readonly TimelineKind[]; siteIds: readonly number[] },
): void {
  if (customerId == null) return
  const narrowed = narrowsKind(f, available.kinds) || narrowsSite(f, available.siteIds) || narrowsPeriod(f)
  if (narrowed) memory.set(customerId, { ...f, kinds: [...f.kinds], siteIds: [...f.siteIds] })
  else memory.delete(customerId)
}

/**
 * 기억해 둔 필터. 없으면 null.
 * 사업장 목록이 그 사이에 바뀌었으면(사업장을 지웠다·더했다) **없는 사업장은 떨어낸다** —
 * 없는 번호가 남으면 0건이 뜬다. 떨어내고 하나도 남지 않으면 그 묶음은 전부 고른 상태다.
 */
export function recallFilter(
  customerId: number | null | undefined,
  available: { kinds: readonly TimelineKind[]; siteIds: readonly number[] },
): TimelineFilter | null {
  if (customerId == null) return null
  const f = memory.get(customerId)
  if (!f) return null
  const siteIds = f.siteIds.filter(id => available.siteIds.includes(id))
  const kinds = f.kinds.filter(k => available.kinds.includes(k))
  return {
    ...f,
    kinds: kinds.length > 0 ? kinds : [...available.kinds],
    siteIds: siteIds.length > 0 ? siteIds : [...available.siteIds],
  }
}

/** 기억을 비운다 — 하네스가 쓴다(화면은 부르지 않는다). */
export function clearFilterMemory(): void {
  memory.clear()
}
