// 견적 사명 칸 — **한 칸에서 사업장과 대리점을 함께 고른다**(2026-11-20).
//
// ── 전에는 ─────────────────────────────────────────────────────────────────
//   사명 칸 오른쪽에 「대리점」 체크박스가 있었고, 그 체크가 **검색 대상 자체**를 갈랐다
//   (직판이면 사업장, 켜면 대리점 줄만). 고르려는 곳이 대리점인지 먼저 알아야 검색이
//   되는 순서였고, 체크를 잊은 채 이름이 안 나오면 「등록이 안 된 업체」로 보였다.
//
// ── 지금은 ─────────────────────────────────────────────────────────────────
//   한 번 검색해 양쪽을 다 보여 주고, 대리점 줄에는 「대리점」 꼬리표를 붙인다.
//   **고른 줄의 역할이 체크박스를 대신한다** — 대리점을 고르면 E.U 칸이 열린다.
//
// ── 같은 줄이 두 번 뜨는 이유 ──────────────────────────────────────────────
//   대리점 45줄 중 15줄은 사업장이기도 하다(이룸지텍·하나무역처럼 우리 장비를 쓰는
//   대리점 — lib/customerAgency.ts 머리말). 그 줄은 **역할 두 줄**로 내보낸다.
//   같은 customer_id 라도 어느 컬럼에 들어가는지가 달라서다(아래 quoteCustomerColumns).
//
// 순수 함수만 둔다 — 하네스가 그대로 돌린다(scripts/quote-dealer-pick-check.js).

/** 사명 칸에서 고른 줄의 역할. 비어 있으면 사업장으로 본다(옛 호출부 호환). */
export type CustomerRole = 'site' | 'agency'

/** 역할 판정 — 한 곳에서 정한다. */
export function isAgencyPick(row: { role?: CustomerRole } | null | undefined): boolean {
  return row?.role === 'agency'
}

/** 후보 목록의 key — 같은 줄이 역할만 달리 두 번 뜨므로 id 만으로는 겹친다. */
export function pickKey(row: { customer_id: number; role?: CustomerRole }): string {
  return `${row.customer_id}:${row.role ?? 'site'}`
}

/**
 * 두 조회 결과를 **한 목록으로** 세운다.
 *
 *   사업장 먼저, 대리점 나중. 흔한 쪽이 위에 오는 편이 손이 덜 간다(견적 158건 중
 *   대리점 건은 23건이다). 각 조회가 이미 limit 를 걸고 오므로 여기서는 자르지 않는다.
 *
 * 역할은 **어느 조회에서 왔는지**로 정한다 — 줄의 is_agency 값으로 정하면 양쪽에 다 뜨는
 * 15줄이 전부 대리점으로 보인다.
 */
export function mergeCustomerPicks<T extends { customer_id: number }>(
  sites: T[],
  agencies: T[],
): (T & { role: CustomerRole })[] {
  return [
    ...sites.map(r => ({ ...r, role: 'site' as const })),
    ...agencies.map(r => ({ ...r, role: 'agency' as const })),
  ]
}

/**
 * **저장되는 두 칸** — quotes.customer_id · quotes.dealer_id.
 *
 *   직판    customer_id = 고른 사업장,  dealer_id = null
 *   대리점  customer_id = **E.U 사업장**, dealer_id = 고른 대리점
 *
 * E.U 전용 컬럼은 없다. 대리점 건의 수요처가 곧 E.U 라서, 대리점을 고르면 E.U 칸이
 * 필수가 된다(app/quote/page.tsx 의 검증). 2026-11-20 이전 158건도 이 규칙으로
 * 저장돼 있어 **규칙을 바꾸지 않는다** — 바꾸면 지난 줄의 뜻이 달라진다.
 *
 * 저장하는 자리(hooks/quote/useQuoteSubmit.tsx)가 이 함수를 그대로 쓴다.
 */
export function quoteCustomerColumns(input: {
  /** 사명 칸에서 고른 줄이 대리점인가. */
  isDealer: boolean
  /** 사명 칸에서 고른 줄의 id. */
  customerId: number | null
  /** E.U 칸에서 고른 사업장의 id(직판이면 쓰이지 않는다). */
  euCustomerId: number | null
}): { customer_id: number | null; dealer_id: number | null } {
  const { isDealer, customerId, euCustomerId } = input
  return {
    customer_id: isDealer ? euCustomerId : customerId,
    dealer_id: isDealer ? customerId : null,
  }
}

/**
 * 수신인 후보를 읽을 업체들 — **대리점 건은 양쪽에서 고른다**.
 * 대리점 담당자에게 보내는 건도, E.U 담당자에게 보내는 건도 있다.
 * 순서가 곧 화면의 묶음 순서다(사명 쪽 먼저).
 */
export function recipientCustomerIds(input: {
  isDealer: boolean
  customerId: number | null
  euCustomerId: number | null
}): number[] {
  const ids = [input.customerId, input.isDealer ? input.euCustomerId : null]
  return ids.filter((v): v is number => v != null)
}

/** 수신인 후보의 묶음 하나 — 어느 업체의 담당자들인가. */
export type RecipientSource = { customerId: number; label: string }

/**
 * 수신인 후보를 **업체별로 묶는다**. 대리점 건이면 두 묶음(대리점 · E.U)이 나온다.
 * 묶음 순서는 건네준 순서 그대로이고, 담당자가 없는 묶음은 빼 둔다(빈 제목만 남으면
 * 고를 것이 있는 것처럼 보인다).
 */
export function groupRecipients<T extends { customer_id?: number | null }>(
  contacts: T[],
  sources: RecipientSource[],
): { customerId: number; label: string; contacts: T[] }[] {
  return sources
    .map(s => ({ ...s, contacts: contacts.filter(c => c.customer_id === s.customerId) }))
    .filter(g => g.contacts.length > 0)
}
