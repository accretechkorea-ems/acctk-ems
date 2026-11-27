// 지도 핀 팝업과 좌측 카드 — **제목과 가는 길** (2026-11-28, 야간4 6).
//
// ── 무엇이 바뀌나 ──────────────────────────────────────────────────────────
//   제목이 `company_name` 한 줄이었다. 그 칸은 **합친 이름**이다 —
//   「(주)현대자동차 감마세타엔진공장」. 읽으면 뜻은 통하지만,
//     · 회사와 사업장의 **경계가 보이지 않고**,
//     · 회사 쪽으로 갈 길이 팝업 안에 없었다(사업장 상세로만 갔다).
//   이제 「**회사명** » 사업장명」으로 가르고, 회사명은 **점선 밑줄 링크**다.
//
//   사업장이 한 곳뿐인 회사에서는 「회사 보기」가 **사업장 상세와 같은 화면**이다 —
//   같은 곳으로 가는 단추를 둘 두지 않는다(showCompanyButton 이 가린다).
//
// ── 어디로 가나 ────────────────────────────────────────────────────────────
//   분할 보기 한 곳이다(app/page.tsx 가 ?view=list&company=·&site= 을 읽는다).
//   단독 상세 페이지(`/customer/{id}`)로 보내지 않는다 — 7절이 걷는 길이다.
//
// 순수 함수만 둔다 — 하네스가 그대로 돌린다(scripts/map-popup-check.js).

/** 팝업·카드가 읽는 칸만. lib/home.ts 의 Customer 가 이미 담고 있다. */
export type PopupCustomer = {
  customer_id: number
  /** 합친 한 줄 이름 — 「회사명 사업장명」. */
  company_name: string
  /** 사업장명만. 없으면 회사 줄이거나 옛 줄이다. */
  site_name?: string | null
  /** 회사명만. 없으면 company_name 에서 사업장명을 떼어 쓴다. */
  company_only?: string | null
  parent_customer_id?: number | null
}

/**
 * 제목 두 토막 — 「회사명 » 사업장명」.
 *
 * 사업장명이 없으면(회사 줄·옛 줄) 회사명만 돌려준다. 회사명을 따로 모르면 합친 이름에서
 * **사업장명을 떼어** 쓴다 — 이관 중인 줄은 company_only 가 비어 있을 수 있다.
 */
export function popupTitle(c: PopupCustomer): { company: string; site: string | null } {
  const full = (c.company_name ?? '').trim()
  const site = (c.site_name ?? '').trim()
  const own = (c.company_only ?? '').trim()
  if (own) return { company: own, site: site || null }
  if (site && full.endsWith(site)) {
    const head = full.slice(0, full.length - site.length).trim()
    if (head) return { company: head, site }
  }
  return { company: full, site: site || null }
}

/** 회사 화면으로 가는 길. 회사를 모르면 null — 그때는 단추를 내지 않는다. */
export function companyHref(c: PopupCustomer): string | null {
  const id = Number(c.parent_customer_id ?? 0)
  return Number.isInteger(id) && id > 0 ? `/?view=list&company=${id}` : null
}

/** 사업장 상세로 가는 길 — 회사를 알면 함께 적어 트리가 그 자리에서 펴진다. */
export function siteHref(c: PopupCustomer): string {
  const parent = Number(c.parent_customer_id ?? 0)
  const q = Number.isInteger(parent) && parent > 0 ? `&company=${parent}` : ''
  return `/?view=list${q}&site=${c.customer_id}`
}

/**
 * 「회사 보기」를 낼까.
 *
 *   회사를 모르면         내지 않는다(갈 곳이 없다).
 *   그 회사의 사업장이 1곳 내지 않는다 — **같은 화면으로 가는 단추가 둘**이 된다.
 *   그 밖                 낸다.
 *
 * @param siteCount 그 회사에 묶인 사업장 수(**거르기 전** 전체에서 센 값이다 —
 *   화면 필터로 한 곳만 남은 회사에서 단추가 사라지면 안 된다).
 */
export function showCompanyButton(c: PopupCustomer, siteCount: number | undefined): boolean {
  if (companyHref(c) === null) return false
  return (siteCount ?? 0) > 1
}

/** 회사명 링크의 밑줄 — 점선이다(눌리는 글자이지만 단추는 아니다). */
export const COMPANY_LINK_CSS = 'text-decoration:underline; text-decoration-style:dotted; text-underline-offset:3px;'
