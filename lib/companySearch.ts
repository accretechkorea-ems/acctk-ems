/**
 * 회사를 글자로 찾는 **한 곳** (2026-11-23).
 *
 * 전에는 자리마다 보는 칸이 달랐다 —
 *   · 고객사 카드 보기 : 회사명 · 주소 · 상태 · 대리점명 · 장비
 *   · 고객사 목록 보기 : 회사명 · 영문명 · 사업장명 · 주소 · 대리점명
 *   · 대리점 고르기   : 회사명뿐
 *   · 상위 회사 고르기 : 회사명뿐
 *   · 회사 이동 창     : 회사명 · 영문명
 * 그래서 「HYUNDAI」로 찾으면 어떤 자리에서는 나오고 어떤 자리에서는 안 나왔다.
 *
 * 이제 다섯 칸을 한 함수가 본다 — **회사명 · 영문명 · 사업장명 · 주소 · 대리점명**.
 * 자리마다 더 보고 싶은 것이 있으면(장비·상태) 자기 칸을 덧붙인다(matchesCompany 의 extra).
 *
 * 서버에서 찾을 때는 companySearchOr 를 쓴다. 영문명 칸이 아직 없는 DB 가 있어
 * lib/nameEn.ts 의 withNameEnFallback 과 짝으로 쓴다.
 */

/** 검색이 보는 칸 — 전부 선택이다(없는 칸은 빈 글자로 친다). */
export type CompanyLike = {
  company_name?: string | null
  /** 영문 회사명(customers.name_en). 칸이 없는 DB 도 있다. */
  name_en?: string | null
  /** 사업장명. 회사 줄에는 없다. */
  site_name?: string | null
  address?: string | null
  /** 대리점 줄의 이름(lib/customerAgency.ts 가 붙인다). 직판이면 비어 있다. */
  agency_name?: string | null
}

/** 사람이 읽는 칸 이름 — 안내 글과 하네스가 같은 말을 쓰게. */
export const COMPANY_SEARCH_FIELDS = ['회사명', '영문명', '사업장명', '주소', '대리점명'] as const

/** 입력칸 안내 글 — 어디서 찾는지 적어 둔다. */
export const COMPANY_SEARCH_PLACEHOLDER = '회사명 · 영문명 · 사업장명 · 주소 · 대리점'

/** 다섯 칸을 한 줄로 모은다(소문자). 빈 칸은 건너뛴다. */
export function companyHaystack(c: CompanyLike): string {
  return [c.company_name, c.name_en, c.site_name, c.address, c.agency_name]
    .map(v => (v ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/**
 * 그 회사가 검색어에 걸리는가. 검색어가 비면 **전부 참**이다(거르지 않는다).
 * extra 로 그 자리만 보는 칸을 더 넘길 수 있다(장비 줄·상태 등).
 */
export function matchesCompany(c: CompanyLike, query: string, extra?: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const extraHay = (extra ?? []).map(v => (v ?? '').trim()).filter(Boolean).join(' ').toLowerCase()
  return companyHaystack(c).includes(q) || (extraHay !== '' && extraHay.includes(q))
}

/**
 * PostgREST 의 or 조건 — 서버에서 찾을 때.
 * withNameEn 이 거짓이면 영문명만 빼고 나머지 넷을 본다(칸이 아직 없는 DB).
 *
 * ※ 대리점명은 **다른 줄의 이름**이라 한 번의 or 로 걸 수 없다 — 그 줄을 따로 읽어
 *   화면에서 matchesCompany 로 거른다(쓰는 자리는 고객사 목록뿐이다).
 */
export function companySearchOr(query: string, withNameEn: boolean): string {
  const q = query.trim()
  const base = [`company_name.ilike.%${q}%`, `site_name.ilike.%${q}%`, `address.ilike.%${q}%`]
  if (withNameEn) base.splice(1, 0, `name_en.ilike.%${q}%`)
  return base.join(',')
}
