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
import { regionKey, regionLabel2 } from '@/lib/region'
import { matchesCompany } from '@/lib/companySearch'

/** 오래 손대지 않았다고 보는 기준(일). 칩·빨간 글씨가 같은 값을 쓴다. */
export const STALE_DAYS = 90

/** 한 사업장 줄 — 화면이 그리는 데 필요한 것만 추려 둔다. */
export type SiteRow = {
  customer: Customer
  /** 사업장명. 없으면 그 줄의 이름에서 회사명을 뗀 나머지. **비어 있을 수 있다.** */
  siteName: string
  /**
   * 사업장명이 **비어 있는가** — 화면이 빨간 「입력 필요」로 알린다.
   *
   * 전에는 빈 이름을 「본사」로 적어 두었다. 그러면 줄은 채워 보이지만 그 줄이 정말
   * 본사인지 이름을 안 적은 것인지 알 수 없고(742곳이 그랬다), 한 회사에 「본사」가
   * 셋 나란히 서기도 했다. 이제 비면 비었다고 말한다.
   */
  needsName: boolean
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
  /** 회사 메모. 회사 수정 모달이 읽고 쓴다. */
  note: string | null
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
 * 남는 글자가 없으면 **빈 문자열**이다 — 부르는 쪽이 「입력 필요」로 알린다(2026-11-20).
 * 예전 주석: 빈칸을 두면 줄이 비어 보여 어느 사업장인지
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
  return own && own !== company ? own : ''
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
 * 「본사」가 세 줄 나란히 서고 어느 것을 고를지 알 수 없다. 겹치는 줄에만 **주소 꼬리**를
 * 붙인다 — 겹치지 않는 줄은 손대지 않는다.
 *
 * 주소까지 같은 줄에는 전에 「#3014」처럼 id 를 붙였는데, 그 번호는 화면에서 아무 뜻도
 * 없고(고치는 사람에게 보이는 값이 아니다) 트리를 어지럽히기만 했다. 이제 같은 글자로
 * 둔다 — 주소까지 같은 두 줄은 **합칠 후보**이고, 그 일은 사업장 병합이 맡는다.
 */
export function disambiguateSites(sites: SiteRow[]): SiteRow[] {
  const count = new Map<string, number>()
  for (const s of sites) count.set(s.siteName, (count.get(s.siteName) ?? 0) + 1)
  if ([...count.values()].every(n => n === 1)) return sites

  const used = new Map<string, number>()
  return sites.map(s => {
    if ((count.get(s.siteName) ?? 0) <= 1) return s
    const hint = addressHint(s.customer.address)
    // 이름이 비어 있으면 주소만 적어 둔다 — 「 · 화성시」처럼 앞이 비지 않게.
    const label = hint ? (s.siteName ? `${s.siteName} · ${hint}` : hint) : s.siteName
    used.set(label, (used.get(label) ?? 0) + 1)
    return { ...s, siteName: label }
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
  /**
   * 대리점(customers.agency_customer_id). 빈 배열이면 전체 —
   * 「좁히지 않음」은 **빈 배열**이다(상태·분류와 달리 0이 「아무것도 아님」이 아니다).
   * 직판은 `DIRECT_SALE` 로 고른다.
   */
  agencies: number[]
  /** 최근 활동 — 하나만 고른다. 'any' 가 좁히지 않음이다. */
  recent: RecentKey
}

/** 최근 활동 조건. 날짜 계산은 `matchesRecent` 한 곳에서 한다. */
export const RECENT_KEYS = ['any', 'in30', 'no90', 'no365'] as const
export type RecentKey = (typeof RECENT_KEYS)[number]
export const RECENT_LABEL: Record<RecentKey, string> = {
  any: '전체', in30: '30일 이내', no90: '90일 없음', no365: '1년 없음',
}

/** 직판을 고르는 열쇠 — 대리점 id 가 아니라서 음수로 둔다(실제 id 와 겹치지 않는다). */
export const DIRECT_SALE = -1

/** 접점 경과일이 조건에 맞는가. 접점이 아예 없으면 「없음」 쪽 조건에 맞는 것으로 본다. */
export function matchesRecent(days: number | null, key: RecentKey): boolean {
  if (key === 'any') return true
  if (key === 'in30') return days !== null && days <= 30
  if (key === 'no90') return days === null || days >= 90
  return days === null || days >= 365
}

export const EMPTY_FILTER: ListFilter = {
  query: '', regions: [], categories: [], statuses: [], staleOnly: false, openQuotesOnly: false,
  noIndustryOnly: false, agencies: [], recent: 'any',
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
  if (!matchesRecent(site.days, filter.recent)) return false
  if (filter.openQuotesOnly && site.openQuotes === 0) return false
  if (filter.agencies.length > 0) {
    const a = c.agency_customer_id ?? DIRECT_SALE
    if (!filter.agencies.includes(a)) return false
  }

  // 찾는 칸은 **공용 함수 하나**가 본다(lib/companySearch.ts) — 회사명·영문명·사업장명·주소·대리점명.
  // c.company_name 을 따로 더하는 까닭: 그 줄에는 「회사명 사업장명」이 합쳐 들어 있는 옛 자료가 있다.
  return matchesCompany(
    {
      company_name: companyName,
      name_en: companyNameEn,
      site_name: site.siteName,
      address: c.address,
      agency_name: c.agency_name,
    },
    filter.query,
    [c.company_name],
  )
}

/**
 * 지역 한 조각 — **정본 17개 중 하나, 아니면 「없음」**(lib/region.ts).
 *
 * 전에는 region1 을 그대로 쓰고, 비면 주소의 첫 토막을 그대로 썼다. 그래서 칩에
 * 「경기도」·「서울특별시」·「남부」가 섞여 같은 지역이 여러 칸으로 갈렸다.
 * 거르는 값과 보이는 값이 늘 같은 어휘를 쓰도록 한 함수를 지난다.
 */
export function regionOf(c: Pick<Customer, 'address'> & { region1?: string | null }): string {
  return regionKey(c.region1, c.address)
}

/**
 * 화면에 찍는 지역 — **두 단계**다(「경기 화성시」). 거르기는 여전히 시도 하나로 한다
 * (regionOf) — 칩이 17개를 넘지 않아야 하고, 시·군·구까지 칩으로 두면 고를 수 없다.
 */
export function regionTextOf(c: Pick<Customer, 'address'> & { region1?: string | null; region2?: string | null }): string {
  return regionLabel2(c.region1, c.region2, c.address)
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

/**
 * **사업장 이름 비교** — 숫자는 자릿수가 아니라 값으로 센다.
 * 「예산1공장 · 예산2공장 · 예산4공장 · 예산10공장」이 그 순서로 선다
 * (글자로만 비교하면 10공장이 1공장 바로 뒤에 붙는다).
 */
export const compareSiteName = (a: string, b: string): number =>
  a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' })

/**
 * 묶음 안의 사업장은 **늘 이름 순**이다(2026-11-20).
 *
 * 전에는 바깥 목록과 같은 「최근 활동순」을 따랐다. 그런데 한 회사의 사업장은
 * 보통 같은 이름에 번호만 다른 줄이라(예산1·2·4공장), 최근에 다녀온 순서로 세우면
 * 찾으려는 공장이 매번 다른 자리에 있었다. 이름 순은 늘 같은 자리다.
 */
export function sortSites(sites: SiteRow[]): SiteRow[] {
  return [...sites].sort((a, b) => compareSiteName(a.siteName, b.siteName))
}

// ── 묶기 ──────────────────────────────────────────────────────────────────

export type BuildInput = {
  /** 목록 조회가 준 사업장 줄(대리점 전용 줄은 이미 빠져 있다). */
  customers: Customer[]
  /** 회사 줄 — id → {이름, 분류}. */
  companies: Map<number, { company_name: string; industry: string | null; name_en?: string | null; note?: string | null }>
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
    const named = shortSiteName(c, companyName)
    const row: SiteRow = {
      customer: c,
      siteName: named,
      needsName: !named,
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
      note: company?.note ?? null,
      // 이름이 겹치는 사업장은 주소로 가려 준다 — 「본사」가 세 줄 나란히 서지 않게.
      sites: sortSites(disambiguateSites(sites)),
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
