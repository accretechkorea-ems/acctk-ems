// 업체를 **한 줄로 부르는 이름** — 「회사명 사업장명」.
//
//   (주)현대자동차 + 감마세타엔진공장 → 「(주)현대자동차 감마세타엔진공장」
//   (주)현대자동차 + (빈칸)          → 「(주)현대자동차」
//
// ── 왜 한곳에 두는가 ───────────────────────────────────────────────────────
//   회사명과 사업장명은 서로 다른 줄에 있다(회사는 customers 의 is_parent 줄, 사업장은
//   그 자식 줄). 화면마다 둘을 제 나름대로 이어 붙이면 「현대자동차 / 감마세타엔진공장」,
//   「현대자동차(감마세타엔진공장)」처럼 표기가 갈린다. 이어 붙이는 규칙은 여기 하나다.
//
// ── 어디에 쓰고 어디에 안 쓰는가 ───────────────────────────────────────────
//   쓴다    화면 표시 · 거래명세서 · 수리내역서 · 서비스 리포트 · 엑셀
//   안 쓴다 견적서의 「○○ 귀하」와 E.U — 그 두 자리는 **회사명만** 찍는다.
//           「현대트랜시스 성연공장 귀하」는 고객에게 나가기에 어색하다
//           (hooks/quote/useQuoteCustomer.ts · lib/quoteEuName.ts 의 규칙 그대로).

/** 「회사명 사업장명」. 둘 다 trim 하고 공백 한 칸으로 잇는다. 사업장이 비면 회사명만. */
export function customerLabel(
  companyName: string | null | undefined,
  siteName: string | null | undefined,
): string {
  const company = (companyName ?? '').trim()
  const site = (siteName ?? '').trim()
  if (!company) return site
  if (!site) return company
  return `${company} ${site}`
}

/** 한 줄로 부르는 데 필요한 칸들. 조회에서 읽어 그대로 넘긴다. */
export type CustomerNameRow = {
  /** 그 줄에 적혀 있는 이름. 이관 전에는 사업장명, 이관 뒤에는 합친 이름이 들어 있다. */
  company_name?: string | null
  /** 사업장명(새 칸). 비어 있으면 회사명만 쓴다. */
  site_name?: string | null
}

/**
 * 업체 한 줄의 이름 — 회사(부모) 이름을 알고 있을 때.
 *
 * 회사명은 **부모 줄의 이름**이고 사업장명은 **자기 site_name** 이다. 부모가 없는 줄
 * (이관 전에 들어온 줄)은 자기 company_name 을 회사명으로 본다.
 *
 * 사업장명이 비어 있으면 **그 줄에 적혀 있던 이름을 그대로** 돌려준다. 이관 중에는
 * 자식 줄의 company_name 이 아직 옛 표기(예: 「하이드로텍」인데 부모는 「㈜나노믹」)인
 * 경우가 있어서, 부모 이름으로 덮어쓰면 화면에서 글자가 사라진다.
 */
export function customerLabelOf(
  row: CustomerNameRow,
  parentCompanyName: string | null | undefined,
): string {
  const own = (row.company_name ?? '').trim()
  const site = (row.site_name ?? '').trim()
  if (!site) return own || (parentCompanyName ?? '').trim()
  const company = (parentCompanyName ?? '').trim() || own
  return customerLabel(company, site)
}

// ── 조회에서 이름을 읽는 법 ────────────────────────────────────────────────
//   회사명은 **부모 줄**에 있으므로 함께 읽어야 한다. supabase 의 내장 조인으로
//   한 번에 가져온다(자기 참조 FK 라 `parent:parent_customer_id(...)` 로 쓴다).
//
//       .select(`customer_id, ${CUSTOMER_NAME_SELECT}, address`)
//
//   읽어 온 줄은 customerDisplayName() 에 그대로 넘긴다.

/** 이름에 필요한 칸들 — select 문자열에 그대로 붙인다. */
export const CUSTOMER_NAME_SELECT = 'company_name, site_name, parent:parent_customer_id(company_name)'

/** 내장 조인으로 함께 읽은 부모(한 줄이지만 배열로 올 때도 있어 둘 다 받는다). */
export type ParentNameJoin = { company_name?: string | null } | { company_name?: string | null }[] | null

export type CustomerNameRowWithParent = CustomerNameRow & { parent?: ParentNameJoin }

/** 조인해 온 부모에서 이름만. */
export function parentNameOf(parent: ParentNameJoin | undefined): string | null {
  const one = Array.isArray(parent) ? parent[0] : parent
  const name = (one?.company_name ?? '').trim()
  return name || null
}

/**
 * 화면·문서·엑셀이 쓰는 **한 줄 이름**. 조회가 CUSTOMER_NAME_SELECT 를 쓴 줄을 넘긴다.
 * 회사 줄(is_parent)은 자기 이름이 곧 회사명이라 그대로 나온다.
 */
export function customerDisplayName(row: CustomerNameRowWithParent | null | undefined): string {
  if (!row) return ''
  return customerLabelOf(row, parentNameOf(row.parent))
}

/**
 * **회사명만** — 견적서의 「○○ 귀하」와 E.U 칸이 쓴다(사업장명은 빼는 자리다).
 * 부모가 있으면 부모 이름, 없으면 그 줄의 이름이다.
 */
export function customerCompanyName(row: CustomerNameRowWithParent | null | undefined): string {
  if (!row) return ''
  return parentNameOf(row.parent) ?? (row.company_name ?? '').trim()
}

/** 같은 이름이 여럿일 때 가려 주는 꼬리 — 「… — 경기도 화성시 동탄…」. */
export function customerLabelWithAddress(
  label: string,
  address: string | null | undefined,
  maxAddress = 18,
): string {
  const addr = (address ?? '').trim()
  if (!addr) return label
  const head = addr.length > maxAddress ? `${addr.slice(0, maxAddress)}…` : addr
  return `${label} — ${head}`
}
