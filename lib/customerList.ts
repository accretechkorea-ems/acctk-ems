// 고객사 **목록 보기**(분할 보기)의 셈법 — 회사로 묶고, 거르고, 세우는 일.
//
// ── 왜 따로 두는가 ────────────────────────────────────────────────────────
//   지도 보기는 「사업장 한 줄」이 단위다. 목록 보기는 **회사**가 단위이고, 그 아래
//   사업장이 달린다. 묶기·거르기·정렬이 화면 조각에 흩어지면 좌 패널의 건수와 우측
//   표의 줄이 어긋난다 — 그 둘은 같은 셈법이어야 한다. 그래서 순수 함수로 여기 둔다
//   (화면은 결과만 그린다. scripts/customer-list-check.js 가 이 규칙을 지킨다).
//
// ── 무엇이 한 줄인가 ─────────────────────────────────────────────────────
//   회사  customers.is_parent = true 인 줄. 이름이 곧 회사명이다.
//   사업장 그 회사를 parent_customer_id 로 가리키는 줄.
//   **회사 줄이 없는 사업장**(부모 없음)은 「미연결」이다 — 이번 회차에서는 탭 자리만
//   만들고 세기만 한다.
//   **대리점 전용 줄**(is_agency 이고 회사도 부모도 없는 줄)은 고객사가 아니다 —
//   목록 조회에서 이미 빠져 있다(lib/customerAgency.ts 의 NOT_AGENCY_ONLY).

import type { Customer } from '@/lib/home'
import type { LastTouch } from '@/lib/customerLastTouch'
import { regionKey } from '@/lib/region'

/** 오래 손대지 않았다고 보는 기준(일). 칩·빨간 글씨가 같은 값을 쓴다. */
export const STALE_DAYS = 90

/** 한 사업장 줄 — 화면이 그리는 데 필요한 것만 추려 둔다. */
export type SiteRow = {
  customer: Customer
  /** 사업장명. 없으면 그 줄의 이름에서 회사명을 뗀 나머지, 그것도 없으면 '본사'. */
  siteName: string
  deviceCount: number
  openQuotes: number
  touch: LastTouch | null
  /** 마지막 접점에서 오늘까지 며칠. 접점이 없으면 null. */
  days: number | null
}

/** 한 회사 묶음. */
export type CompanyGroup = {
  /** 회사 줄(customers.is_parent). 미연결 묶음은 null. */
  companyId: number
  companyName: string
  industry: string | null
  /** 회사 영문명(있으면). 검색과 회사 카드가 쓴다. */
  nameEn: string | null
  sites: SiteRow[]
  /** 묶음 안에서 가장 최근 접점(없으면 null). 정렬이 쓴다. */
  touch: LastTouch | null
  deviceCount: number
  openQuotes: number
}

/** 'YYYY-MM-DD' 두 날짜 사이의 일수. 오늘이 더 뒤면 양수. */
export function daysSince(date: string | null | undefined, today: string): number | null {
  if (!date) return null
  const a = Date.parse(`${date}T00:00:00+09:00`)
  const b = Date.parse(`${today}T00:00:00+09:00`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}

/** 오래됐는가 — 접점이 아예 없는 줄도 오래된 것으로 본다(한 번도 안 만난 업체다). */
export const isStale = (days: number | null): boolean => days === null || days >= STALE_DAYS

/**
 * 사업장명 한 조각 — 트리와 표에 쓰는 **짧은 이름**이다.
 *
 * `site_name` 이 있으면 그것, 없으면 그 줄의 이름에서 회사명을 떼어 본다. 떼고 나서도
 * 남는 글자가 없으면 「본사」로 적는다 — 빈칸을 두면 줄이 비어 보여 어느 사업장인지
 * 가릴 수가 없다(회사 아래 사업장이 하나뿐인 곳이 대부분이라 흔한 자리다).
 */
export function shortSiteName(row: Pick<Customer, 'company_name' | 'site_name'>, companyName: string): string {
  const site = (row.site_name ?? '').trim()
  if (site) return site
  const own = (row.company_name ?? '').trim()
  const company = (companyName ?? '').trim()
  if (company && own.startsWith(company)) {
    const rest = own.slice(company.length).trim()
    if (rest) return rest
  }
  return own && own !== company ? own : '본사'
}

/**
 * 주소에서 **가려 주는 꼬리** — 「경남 진주시 정촌면 산업로 30」 → 「진주시 정촌면」.
 *
 * 맨 앞 시도는 뗀다(같은 회사 안에서는 대개 같다). 두 토막까지만 쓴다 — 트리 한 줄에
 * 들어가야 한다.
 */
export function addressHint(address: string | null | undefined): string {
  const parts = (address ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return parts[0] ?? ''
  return parts.slice(1, 3).join(' ')
}

/**
 * 한 회사 안에서 **이름이 겹치는 사업장**을 가려 준다.
 *
 * 사업장명이 비어 있는 줄이 많아(실측 2026-11-19: 227개 회사·742 사업장) 그대로 두면
 * 「본사」가 세 줄 나란히 서고 어느 것을 고를지 알 수 없다. 겹치는 줄에만 주소 꼬리를
 * 붙이고, 주소까지 같으면 마지막에 id 를 붙인다 — 겹치지 않는 줄은 손대지 않는다.
 */
export function disambiguateSites(sites: SiteRow[]): SiteRow[] {
  const count = new Map<string, number>()
  for (const s of sites) count.set(s.siteName, (count.get(s.siteName) ?? 0) + 1)
  if ([...count.values()].every(n => n === 1)) return sites

  const used = new Map<string, number>()
  return sites.map(s => {
    if ((count.get(s.siteName) ?? 0) <= 1) return s
    const hint = addressHint(s.customer.address)
    const label = hint ? `${s.siteName} · ${hint}` : s.siteName
    const seen = (used.get(label) ?? 0) + 1
    used.set(label, seen)
    // 주소까지 같은 줄이 또 있으면 id 로 가른다(그 줄은 사실상 중복 등록이다).
    return { ...s, siteName: seen > 1 || !hint ? `${label} #${s.customer.customer_id}` : label }
  })
}

// ── 거르기 ────────────────────────────────────────────────────────────────

export type ListFilter = {
  /** 회사명·사업장명·주소·대리점에 걸리는 검색어(소문자). 빈 값이면 거르지 않는다. */
  query: string
  /** 지역(region1). 빈 배열이면 전체. */
  regions: string[]
  /** 장비 분류(devices.category). 빈 배열이면 전체. */
  categories: string[]
  /** 상태. 빈 배열이면 한 줄도 맞지 않는다(지도 보기와 같은 규칙). */
  statuses: string[]
  /** 90일 넘게 접점이 없는 곳만. */
  staleOnly: boolean
  /** 진행 중인 견적이 있는 곳만. */
  openQuotesOnly: boolean
  /**
   * **분류가 비어 있는 회사**만. 정리 SQL 이 만든 회사 561곳에 분류가 없어(2026-11-19
   * 실측: 763곳 중 거의 전부) 그것만 골라 채우는 길이다. 사업장이 아니라 **회사**를
   * 보는 조건이라 묶은 뒤에 거른다.
   */
  noIndustryOnly: boolean
}

export const EMPTY_FILTER: ListFilter = {
  query: '', regions: [], categories: [], statuses: [], staleOnly: false, openQuotesOnly: false,
  noIndustryOnly: false,
}

/** 한 사업장이 조건에 맞는가. 분류는 **그 사업장의 장비 분류**를 본다. */
export function matchesSite(
  site: SiteRow,
  filter: ListFilter,
  companyName: string,
  deviceCategories: string[],
  allCategories: readonly string[],
  companyNameEn?: string | null,
): boolean {
  const c = site.customer
  if (filter.statuses.length === 0) return false
  if (!filter.statuses.includes(c.status ?? '')) return false

  if (filter.regions.length > 0 && !filter.regions.includes(regionOf(c))) return false

  // 분류 — 칩에 있는 분류를 하나도 갖지 않은 사업장은 거르지 않는다(지도 보기와 같다).
  if (filter.categories.length === 0) return false
  const known = deviceCategories.filter(x => allCategories.includes(x))
  if (known.length > 0 && !known.some(x => filter.categories.includes(x))) return false

  if (filter.staleOnly && !isStale(site.days)) return false
  if (filter.openQuotesOnly && site.openQuotes === 0) return false

  const q = filter.query.trim().toLowerCase()
  if (!q) return true
  const hay = [
    companyName, companyNameEn ?? '', c.company_name ?? '', site.siteName,
    c.address ?? '', c.agency_name ?? '',
  ].join(' ').toLowerCase()
  return hay.includes(q)
}

/** 지역 한 조각 — region1 이 비면 주소 앞 토큰. 둘 다 없으면 빈 문자열. */
export function regionOf(c: Pick<Customer, 'address'> & { region1?: string | null }): string {
  const r = (c.region1 ?? '').trim()
  if (r) return r
  const addr = (c.address ?? '').trim()
  if (!addr) return ''
  return addr.split(/\s+/)[0] ?? ''
}

// ── 세우기 ────────────────────────────────────────────────────────────────

export type SortKey = 'touch' | 'name'

/**
 * 회사 묶음을 세운다.
 *   touch 최근 접점이 위. 접점이 없는 묶음은 **맨 아래**(0 이 아니라 뒤로 민다).
 *   name  이름 가나다순(한글 정렬).
 */
export function sortGroups(groups: CompanyGroup[], key: SortKey): CompanyGroup[] {
  const list = [...groups]
  if (key === 'name') {
    list.sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko'))
    return list
  }
  list.sort((a, b) => {
    const ad = a.touch?.date ?? ''
    const bd = b.touch?.date ?? ''
    if (ad === bd) return a.companyName.localeCompare(b.companyName, 'ko')
    if (!ad) return 1
    if (!bd) return -1
    return ad < bd ? 1 : -1
  })
  return list
}

/** 묶음 안의 사업장도 같은 기준으로 세운다. */
export function sortSites(sites: SiteRow[], key: SortKey): SiteRow[] {
  const list = [...sites]
  if (key === 'name') {
    list.sort((a, b) => a.siteName.localeCompare(b.siteName, 'ko'))
    return list
  }
  list.sort((a, b) => {
    const ad = a.touch?.date ?? ''
    const bd = b.touch?.date ?? ''
    if (ad === bd) return a.siteName.localeCompare(b.siteName, 'ko')
    if (!ad) return 1
    if (!bd) return -1
    return ad < bd ? 1 : -1
  })
  return list
}

// ── 묶기 ──────────────────────────────────────────────────────────────────

export type BuildInput = {
  /** 목록 조회가 준 사업장 줄(대리점 전용 줄은 이미 빠져 있다). */
  customers: Customer[]
  /** 회사 줄 — id → {이름, 분류}. */
  companies: Map<number, { company_name: string; industry: string | null; name_en?: string | null }>
  deviceCount: (customerId: number) => number
  deviceCategories: (customerId: number) => string[]
  openQuotes: (customerId: number) => number
  touchOf: (customerId: number) => LastTouch | null
  today: string
  filter: ListFilter
  allCategories: readonly string[]
  sort: SortKey
}

export type BuildResult = {
  /** 조건에 맞는 회사 묶음(정렬 끝난 상태). */
  groups: CompanyGroup[]
  /** 조건에 맞는 사업장 수 — 「조건 일치 N곳」. */
  siteCount: number
  /** 회사 줄이 없어 묶이지 못한 사업장 수 — 「미연결 N」. */
  unlinkedCount: number
}

/**
 * 회사 트리를 만든다. **거르기는 사업장 단위**이고, 한 곳이라도 남은 회사만 보인다 —
 * 조건에 맞는 사업장이 하나도 없는 회사를 이름만 남겨 두면 눌러도 표가 비어 있다.
 */
export function buildCompanyTree(input: BuildInput): BuildResult {
  const { customers, companies, filter, today } = input
  const byCompany = new Map<number, SiteRow[]>()
  let unlinked = 0
  let siteCount = 0

  for (const c of customers) {
    const parentId = c.parent_customer_id ?? null
    if (parentId == null) { unlinked++; continue }
    const company = companies.get(parentId)
    const companyName = company?.company_name ?? (c.company_only ?? c.company_name ?? '')
    const touch = input.touchOf(c.customer_id)
    const row: SiteRow = {
      customer: c,
      siteName: shortSiteName(c, companyName),
      deviceCount: input.deviceCount(c.customer_id),
      openQuotes: input.openQuotes(c.customer_id),
      touch,
      days: daysSince(touch?.date ?? null, today),
    }
    if (!matchesSite(row, filter, companyName, input.deviceCategories(c.customer_id), input.allCategories, company?.name_en)) continue
    siteCount++
    const list = byCompany.get(parentId)
    if (list) list.push(row)
    else byCompany.set(parentId, [row])
  }

  const groups: CompanyGroup[] = []
  for (const [companyId, sites] of byCompany) {
    const company = companies.get(companyId)
    const best = sites.reduce<LastTouch | null>((acc, s) => {
      if (!s.touch) return acc
      if (!acc || s.touch.date > acc.date) return s.touch
      return acc
    }, null)
    groups.push({
      companyId,
      companyName: company?.company_name ?? `회사 #${companyId}`,
      industry: company?.industry ?? null,
      nameEn: company?.name_en ?? null,
      // 이름이 겹치는 사업장은 주소로 가려 준다 — 「본사」가 세 줄 나란히 서지 않게.
      sites: sortSites(disambiguateSites(sites), input.sort),
      touch: best,
      deviceCount: sites.reduce((n, s) => n + s.deviceCount, 0),
      openQuotes: sites.reduce((n, s) => n + s.openQuotes, 0),
    })
  }

  // 분류 없음 — **회사**를 보는 조건이라 묶은 뒤에 거른다. 거른 뒤의 사업장 수도 다시 센다.
  const kept = filter.noIndustryOnly ? groups.filter(g => !g.industry) : groups
  const keptSites = filter.noIndustryOnly ? kept.reduce((n, g) => n + g.sites.length, 0) : siteCount
  return { groups: sortGroups(kept, input.sort), siteCount: keptSites, unlinkedCount: unlinked }
}

/** 「3일」·「106일」·'-' — 트리와 표의 경과일 칸. */
export const daysLabel = (days: number | null): string => (days === null ? '-' : `${days}일`)
