// 리드를 배정할 때 쓰는 **고객사 찾기·포캐스트 만들기** 규칙 — 순수 함수만 둔다.
//
// 배정이 곧 전환이다. 관리자가 담당자를 지정하면 고객사와 포캐스트가 함께 만들어지므로,
// 「이 리드의 회사가 이미 우리 고객사인가」를 그 자리에서 판정해야 한다. 그 판정이 틀리면
// 같은 회사가 둘로 늘어나거나(새로 등록), 엉뚱한 업체에 포캐스트가 붙는다(잘못 연결).
// 그래서 규칙을 화면·서버가 **같은 함수**로 보고, 값으로 증명할 수 있게 여기 모은다.
//
// DB·화면을 모른다(import 가 없다) — scripts/lead-assign-check.js 가 그대로 돌린다.

/**
 * 회사 이름 비교용 열쇠.
 *   · 법인 표기(㈜ · (주) · (유) · 주식회사 · 유한회사)를 앞뒤 어디에 있든 지운다
 *   · 공백을 전부 지운다(전각 공백·탭 포함)
 *   · 영문은 소문자로 맞춘다
 * 예) '㈜ 한국 ACCRETECH' · '주식회사 한국accretech' → '한국accretech'
 *
 * 괄호 안의 다른 말(사업장·공장 표기)은 **지우지 않는다** — 「한국정밀(천안)」과
 * 「한국정밀(대구)」는 다른 사업장이고, 우리 고객사도 그렇게 나뉘어 있다.
 */
export function normalizeCompanyName(name: string | null | undefined): string {
  if (!name) return ''
  return String(name)
    .replace(/㈜|㈚|\(주\)|\(유\)|주식회사|유한회사/g, '')
    .replace(/[\s　]+/g, '')
    .toLowerCase()
}

/** 후보 판정에 쓰는 고객사의 최소 모양. */
export type CustomerLike = {
  customer_id: number
  company_name: string | null
  address?: string | null
  deleted_at?: string | null
}

/**
 * 그 회사 이름과 **같은 이름**인 고객사들.
 *
 * 비슷한 이름(부분 일치)은 후보로 올리지 않는다 — 「대한정밀」과 「대한정밀기계」가 섞이면
 * 고르는 사람이 더 헷갈린다. 지운 업체(deleted_at)는 빼고, 이름이 빈 행도 뺀다.
 * 이름을 못 읽으면 빈 배열이다(그 경우 부르는 쪽이 새로 등록한다).
 */
export function findCustomerCandidates(
  company: string | null | undefined, customers: readonly CustomerLike[],
): CustomerLike[] {
  const key = normalizeCompanyName(company)
  if (key === '') return []
  return customers.filter(c => !c.deleted_at && normalizeCompanyName(c.company_name) === key)
}

/**
 * 포캐스트의 **첫 예상월** — 「이번 달 + 1」의 말일 'YYYY-MM-DD'.
 *
 * 말일로 두는 이유는 영업기회 입력칸과 같다(components/customer/opportunity.ts 의 monthToDate):
 * 1일로 저장하면 그 달이 한참 남았는데도 2일부터 마감이 지난 것으로 잡힌다.
 * today 는 한국 날짜 'YYYY-MM-DD' 다.
 */
export function nextMonthEnd(today: string): string {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  if (!y || !m) return ''
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  // 다음 달 0일 = 그 달의 말일. UTC 로 만들어 시간대가 끼어들지 않게 한다.
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

/**
 * 포캐스트 제목 — 「{회사명} {관심제품}」. 관심제품이 없으면 「{회사명} 문의」.
 * 둘 다 없으면 빈 글자를 돌려주고, 부르는 쪽이 저장을 막는다(제목 없는 안건은 목록에서 못 찾는다).
 */
export function leadForecastTitle(company: string | null | undefined, product: string | null | undefined): string {
  const c = (company ?? '').trim()
  const p = (product ?? '').trim()
  if (c === '') return p
  return p ? `${c} ${p}` : `${c} 문의`
}

/**
 * 포캐스트에 남기는 **출처 한 줄**. 활동 기록의 맨 앞에 붙는다.
 * sales_opportunities 에 메모 칸이 없어 활동 기록이 그 자리를 대신한다
 * (docs/forecast-gap-analysis.md 의 D-1 — 안건에 더 필요한 칸 목록).
 */
export const leadSourceLine = (leadNo: string | null | undefined): string =>
  (leadNo && leadNo.trim() ? `[리드 ${leadNo.trim()}]` : '[리드]')
