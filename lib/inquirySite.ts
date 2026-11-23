/**
 * 의뢰서의 **회사 → 사업장 → 장비** 고르기 규칙 (2026-11-23).
 *
 * ── 왜 셋인가 ─────────────────────────────────────────────────────────────
 * 전에는 업체를 **글자로만** 적었다(inquiries.title). 그래서 같은 회사가 사람마다 다르게
 * 적혔고, 「이 사업장으로 나간 의뢰서」를 찾을 길이 없었다. 이제 **고른다**.
 *   · 회사   — 844곳. 많아서 검색해 고른다(회사명·영문명, lib/companySearch.ts ⓑ).
 *   · 사업장 — **그 회사의 것만**. 칸을 누르면 바로 펼쳐진다(적게는 1곳, 많아야 수십 곳).
 *   · 장비   — **그 사업장의 것만**. 같은 방식이다.
 * 사업장은 **골라야 한다**. 장비는 고르지 않아도 된다 — 장비가 정해지기 전에 번호부터
 * 받는 일이 있다.
 *
 * ── 회사에 묶이지 않은 사업장 ────────────────────────────────────────────
 * 사업장 1,299곳 중 30곳은 회사 줄이 없다(2026-11-23 실측). 회사부터 고르게 하면 그 30곳이
 * 갈 곳을 잃는다. 그래서 **회사 칸의 후보**에 「회사 줄」과 「회사에 묶이지 않은 사업장」을
 * 함께 둔다. 뒤엣것을 고르면 그 줄이 곧 사업장이다(sitesOfCompany 가 그 줄 하나를 돌려준다).
 * 자식이 없는 회사 줄도 같은 길로 떨어진다 — 고르고 나서 「사업장이 없습니다」로 막히지 않는다.
 */

/** 회사 칸의 한 줄 — 회사 줄이거나, 회사에 묶이지 않은 사업장. */
export type CompanyRow = {
  customer_id: number
  company_name: string | null
  site_name?: string | null
  address?: string | null
  name_en?: string | null
  is_parent?: boolean | null
}

/** 사업장 칸의 한 줄. */
export type SiteRow = {
  customer_id: number
  company_name: string | null
  site_name: string | null
  address: string | null
  parent_customer_id?: number | null
}

export type DeviceRow = {
  device_id: number
  device_name: string | null
  device_name2: string | null
  serial_number: string | null
}

/**
 * 사업장 한 줄의 이름.
 * customers.company_name 은 이미 「회사명 사업장명」을 합친 값이다(crm_cleanup 이후).
 * 그래서 site_name 을 또 붙이면 「일진글로벌 경주공장 경주공장」이 된다 — 끝이 같으면 붙이지 않는다.
 */
export function siteLabel(r: Pick<SiteRow, 'customer_id' | 'company_name' | 'site_name'>): string {
  const full = (r.company_name ?? '').trim()
  const site = (r.site_name ?? '').trim()
  if (!full) return site || `사업장 ${r.customer_id}`
  if (!site || full.endsWith(site)) return full
  return `${full} ${site}`
}

/** 장비 한 줄의 이름. */
export function deviceLabel(d: DeviceRow): string {
  return [[d.device_name, d.device_name2].map(v => (v ?? '').trim()).filter(Boolean).join(' '), d.serial_number]
    .filter(Boolean).join(' · ') || `장비 ${d.device_id}`
}

/** 회사 한 줄의 이름 — 회사에 묶이지 않은 사업장이면 그 사업장 이름이다. */
export function companyLabel(c: CompanyRow): string {
  return (c.company_name ?? '').trim() || `회사 ${c.customer_id}`
}

/**
 * 그 회사의 사업장 목록.
 * 자식이 하나도 없으면 **그 줄 자체**를 사업장으로 돌려준다 — 회사에 묶이지 않은 사업장과
 * 자식 없는 회사 줄이 모두 이 길로 온다(막다른 길을 만들지 않는다).
 */
export function sitesOfCompany(company: CompanyRow, children: SiteRow[]): SiteRow[] {
  if (children.length > 0) return children
  return [{
    customer_id: company.customer_id,
    company_name: company.company_name ?? null,
    site_name: company.site_name ?? null,
    address: company.address ?? null,
    parent_customer_id: null,
  }]
}

/** 고를 것이 하나뿐이면 그것 — 사람이 누를 필요가 없다. 아니면 null. */
export function onlyOne<T>(list: T[]): T | null {
  return list.length === 1 ? list[0] : null
}

/** 사업장을 고르지 않았으면 그 까닭. 고르지 않은 장비는 막지 않는다. */
export function sitePickBlockedReason(siteId: number | null | undefined): string | null {
  return siteId == null ? SITE_REQUIRED_MESSAGE : null
}

/** 사업장을 고르지 않았을 때 버튼 옆에 적는 말. */
export const SITE_REQUIRED_MESSAGE = '사업장을 골라주세요'

/**
 * 발급 전에 적어 두는 안내. 「왜 골라야 하는가」를 한 줄로 말한다 —
 * 그래야 글자로만 적던 사람이 이 칸을 건너뛰려 하지 않는다.
 */
export const SITE_PICK_NOTE =
  '고른 사업장의 활동 이력에 이 의뢰서가 뜹니다. 업체명은 고른 사업장 이름으로 적힙니다.'

/** 이미 발급된 건인데 사업장이 비어 있을 때 띄우는 띠. 옛 건을 채워 넣지는 않는다. */
export const SITE_MISSING_BANNER = '사업장 미연결 — 저장하려면 선택'
