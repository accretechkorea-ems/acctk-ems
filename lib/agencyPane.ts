// 대리점 화면의 **거래 사업장 표** — 줄 만들기·거르기·세우기 (2026-11-21).
//
// ── 거래 사업장이란 ───────────────────────────────────────────────────────
//   `customers.agency_customer_id` 가 그 대리점을 가리키는 **살아있는 사업장 전부**다.
//   회사(부모) 줄과 대리점 전용 줄은 목록 조회에서 이미 빠져 있다(hooks/useHomeData.ts).
//   좌 패널의 필터(상태·지역·분류…)는 **걸지 않는다** — 이 표는 「이 대리점이 어디와
//   거래하나」를 다 보여 주는 자리라, 걸러서 37곳이 되면 숫자의 뜻이 달라진다.
//   거르는 것은 표 머리줄의 검색 한 칸뿐이다.
//
// ── 왜 순수 함수로 두는가 ─────────────────────────────────────────────────
//   젠트 한 곳이 187곳을 거느린다(2026-11-21 실측). 정렬·검색이 화면 조각에 섞이면
//   그 187줄의 순서를 눈으로만 확인하게 된다. 하네스가 그대로 돌린다
//   (scripts/agency-pane-check.js).

import type { LastTouch } from '@/lib/customerLastTouch'
import type { Customer } from '@/lib/home'
import { compareSiteName, daysSince, regionTextOf, shortSiteName } from '@/lib/customerList'

/** 표 한 줄. 열 순서가 곧 이 칸들의 순서다(회사 » 사업장 · 지역 · 상태 · 장비 · 진행 견적 · 최근 활동). */
export type AgencySiteRow = {
  customer: Customer
  /** 회사명 — 사업장을 묶는 부모 줄의 이름. 없으면 빈 글자(미연결 사업장이다). */
  companyName: string
  /** 사업장명. 회사명을 뗀 나머지다. 비어 있을 수 있다. */
  siteName: string
  /** 사업장명이 비었는가 — 화면이 빨간 「입력 필요」로 알린다(회사 화면과 같은 규칙). */
  needsName: boolean
  /** 「경기 화성시」 꼴. 비면 빈 글자. */
  region: string
  deviceCount: number
  openQuotes: number
  touch: LastTouch | null
  /** 마지막 접점에서 오늘까지 며칠. 접점이 없으면 null. */
  days: number | null
}

export type BuildAgencyInput = {
  /** 목록 조회가 준 사업장 줄 전체. 이 함수가 대리점으로 거른다. */
  customers: Customer[]
  /** 어느 대리점인가(customers.customer_id 중 is_agency 인 줄). */
  agencyId: number
  /** 회사 줄 — id → 이름. 「회사 » 사업장」의 앞말이다. */
  companyName: (companyId: number) => string | null
  deviceCount: (customerId: number) => number
  openQuotes: (customerId: number) => number
  touchOf: (customerId: number) => LastTouch | null
  /** 오늘(KST 'YYYY-MM-DD') — 며칠 전인지 셈한다. */
  today: string
}

/** 그 대리점의 거래 사업장 줄을 만든다. 순서는 아래 sortAgencySites 가 정한다. */
export function buildAgencySites(input: BuildAgencyInput): AgencySiteRow[] {
  const { customers, agencyId, today } = input
  const rows: AgencySiteRow[] = []
  for (const c of customers) {
    if (c.agency_customer_id !== agencyId) continue
    const parentId = c.parent_customer_id ?? null
    const companyName = (parentId != null ? input.companyName(parentId) : null)
      ?? c.company_only ?? ''
    const named = shortSiteName(c, companyName)
    const touch = input.touchOf(c.customer_id)
    rows.push({
      customer: c,
      companyName,
      siteName: named,
      needsName: !named,
      region: regionTextOf(c),
      deviceCount: input.deviceCount(c.customer_id),
      openQuotes: input.openQuotes(c.customer_id),
      touch,
      days: daysSince(touch?.date ?? null, today),
    })
  }
  return rows
}

/**
 * 표 안 검색 — 회사명·사업장명·지역·상태·주소를 함께 본다.
 * 공백으로 나눈 낱말을 **모두** 포함해야 남는다(「일진 제천」으로 찾을 수 있게).
 */
export function filterAgencySites(rows: AgencySiteRow[], query: string): AgencySiteRow[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return rows
  return rows.filter(r => {
    const hay = [
      r.companyName, r.siteName, r.region, r.customer.status ?? '', r.customer.address ?? '',
    ].join(' ').toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

/** 표의 정렬 기준. 기본은 최근 활동순이다(보드의 「최근 활동순 ▾」). */
export type AgencySort = 'touch' | 'name' | 'quotes' | 'devices'

export const AGENCY_SORT_LABEL: Record<AgencySort, string> = {
  touch: '최근 활동순',
  name: '이름순',
  quotes: '진행 견적순',
  devices: '장비순',
}

/**
 * 줄을 세운다. 어느 기준이든 **마지막 가름은 이름**이다 — 같은 값끼리 매번 자리가
 * 바뀌면 187줄에서 찾던 줄을 다시 잃는다.
 *   touch   최근 접점이 위. 접점이 없는 줄은 맨 아래로 민다(0 이 아니라 뒤다).
 *   name    회사 » 사업장 이름 순. 번호는 값으로 센다(1·2·4·10공장).
 *   quotes  진행 견적 많은 순.
 *   devices 장비 많은 순.
 */
export function sortAgencySites(rows: AgencySiteRow[], key: AgencySort): AgencySiteRow[] {
  const byName = (a: AgencySiteRow, b: AgencySiteRow) =>
    compareSiteName(`${a.companyName} ${a.siteName}`, `${b.companyName} ${b.siteName}`)
  const list = [...rows]
  if (key === 'name') { list.sort(byName); return list }
  if (key === 'quotes') {
    list.sort((a, b) => (b.openQuotes - a.openQuotes) || byName(a, b))
    return list
  }
  if (key === 'devices') {
    list.sort((a, b) => (b.deviceCount - a.deviceCount) || byName(a, b))
    return list
  }
  list.sort((a, b) => {
    const ad = a.touch?.date ?? ''
    const bd = b.touch?.date ?? ''
    if (ad === bd) return byName(a, b)
    if (!ad) return 1
    if (!bd) return -1
    return ad < bd ? 1 : -1
  })
  return list
}

/**
 * 제목 줄의 배지 — 「진행 견적 N건 · 전체 N건」.
 *
 * 그 대리점을 **거쳐 나간 견적 전체**다(quotes.dealer_id). 사업장별 진행 견적
 * (표의 칸)과는 다른 수치다 — 그쪽은 수요처(customer_id) 기준이라 직판 건도 든다.
 * 진행 판정은 회사 카드·견적 이력 창과 같은 「견적중」이다(lib/quoteStatus.ts).
 */
export function agencyQuoteCounts(
  quotes: readonly { status?: string | null }[],
  pendingStatus: string,
): { all: number; pending: number } {
  return {
    all: quotes.length,
    pending: quotes.filter(q => q.status === pendingStatus).length,
  }
}
