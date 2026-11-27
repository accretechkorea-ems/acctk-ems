// 견적서에 찍는 E.U(최종 사용 업체) 이름.
//
// 회사 아래 사업장이 여러 행으로 나뉘어 있다(예: 「네오오토」 아래 「네오오토 예산4공장」).
// 안에서 고르는 것은 사업장이지만 **고객에게 나가는 문서에는 회사 이름이 찍혀야 한다** —
// 「네오오토 예산4공장」은 사내에서 쓰는 구분이고, 견적서에 적기에는 어색하다.
//
// 수신처(「○○ 귀하」)에는 같은 규칙이 이미 들어가 있다(app/quote/page.tsx 의 handleCustomerSelect
// 가 parentCompanyName 으로 회사 이름을 덮어쓴다). E.U 에만 빠져 있던 것을 맞춘다.
//
// 회사 이름을 구하는 조회는 components/customer/ParentPicker.ts 의 parentCompanyName 을 그대로
// 쓴다(수신처가 쓰는 함수다). 여기에는 **고른 뒤의 표기 규칙**만 둔다 — 조회·화면 의존이 없어야
// 스크립트로 검증할 수 있다.

/**
 * 견적서에 찍을 E.U 이름 — 회사 이름이 있으면 회사 이름, 없으면 사업장 이름.
 *
 * 둘 다 trim 한다. 회사 이름이 공백뿐이면 「없음」으로 본다 —
 * parentCompanyName 도 공백은 null 로 접어 돌려주지만(`?.trim() || null`), 이 함수를 그 결과에만
 * 묶어 두지 않기 위해 여기서 한 번 더 본다(초안·복제에서 다른 경로로 들어올 수 있다).
 *
 * 저장값은 바꾸지 않는다 — quotes.customer_id 는 그대로 **사업장**을 가리킨다.
 * 거래 이력·실적이 붙는 곳은 사업장이어야 하고, 바뀌는 것은 문서에 보이는 글자뿐이다.
 */
export function euDisplayName(input: {
  /** 고른 사업장 이름(화면 입력칸에 보이는 값). */
  siteName: string | null | undefined
  /** 그 사업장을 묶는 회사 이름. 없으면 null. */
  parentName: string | null | undefined
}): string {
  const parent = (input.parentName ?? '').trim()
  if (parent) return parent
  return (input.siteName ?? '').trim()
}

// ── 사명이 비어 있는 견적 ──────────────────────────────────────────────────
//   quotes.customer_id 는 NULL 을 받는다(필수 칸은 quote_id·quote_number·quote_date·created_by
//   네 칸뿐이다). 지금 NULL 인 줄은 0건이지만, 대리점 건의 E.U 를 **나중에 채우는** 길을
//   열어 두려면 비어 있는 동안에도 읽히는 글자가 있어야 한다
//   (2026-11-28, 야간4 8-2 · docs/hanamuyeok-quotes-20261128.md).
//
//   전에는 어느 표나 `|| '-'` 였다. `-` 하나로는 **「아직 안 적었다」와 「내가 못 보는
//   사명」**이 같아 보인다 — 뒤쪽은 고객사 열람 권한이 없을 때 나는 모습이라 사람이 할
//   일이 없고, 앞쪽은 **고치라는 표시**다. 둘을 갈라 적는다.

/** 사명(E.U)이 비어 있는 견적에 적는 글자. 한 곳에서 정한다. */
export const EU_UNSET_LABEL = 'E.U 미지정'

/**
 * 견적 표의 사명 칸 글자.
 *
 *   사명 id 가 없다       → 「E.U 미지정」
 *   id 는 있고 이름이 없다 → fallback(기본 `-`) — 권한으로 가려진 경우다
 */
export function quoteCustomerLabel(
  customerId: number | null | undefined,
  name: string | null | undefined,
  fallback = '-',
): string {
  if (customerId == null) return EU_UNSET_LABEL
  return (name ?? '').trim() || fallback
}
