/**
 * 「납품 예정」 장비 줄의 **주인** — 누구의 할 일인가 (2026-11-27, 묶음4 G1).
 *
 * ── 차례 ─────────────────────────────────────────────────────────────────
 *   ① 그 줄을 만든 견적(`source_quote_id`)의 **작성자**
 *        발주에서 생긴 줄이다. 그 장비를 들여오기로 한 사람이 뒷일도 본다.
 *   ② 없으면 **그 줄을 만든 사람**(`devices.created_by`)
 *        손으로 넣은 줄이다. 넣은 사람이 안다.
 *   ③ 둘 다 없으면 **주인이 없다** — 홈 할 일에 띄우지 않고 **사업장 화면에만** 둔다.
 *        옛 줄이 그렇다(작성자가 어디에도 남아 있지 않다). 틀린 사람에게 할 일을
 *        붙이는 것보다, 그 사업장을 보는 사람이 보게 두는 쪽이 낫다.
 *
 * 이 파일은 **순수 함수**다 — 조회는 부르는 쪽이 한다(hooks/dashboard/useToday.ts).
 */

/** 주인을 정하는 데 필요한 것만. 조회한 줄에서 이 셋만 뽑아 넘긴다. */
export type DeviceOwnerInput = {
  /** 그 줄을 만든 견적의 작성자(engineers.engineer_id). 견적이 없으면 null. */
  sourceQuoteEngineerId?: number | null
  /** 그 줄을 만든 사람. 칸이 아직 없는 DB 에서는 늘 null 이다. */
  createdBy?: number | null
}

/** 주인을 어디서 찾았나 — 보고서·하네스가 읽는 말이다. */
export type OwnerVia = 'quote' | 'created_by' | 'none'

export type DeviceOwner = {
  /** 주인의 engineer_id. 없으면 null. */
  ownerId: number | null
  via: OwnerVia
}

const asId = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** 위 차례대로 한 번에 정한다. */
export function deviceOwnerOf(input: DeviceOwnerInput): DeviceOwner {
  const fromQuote = asId(input.sourceQuoteEngineerId)
  if (fromQuote !== null) return { ownerId: fromQuote, via: 'quote' }
  const made = asId(input.createdBy)
  if (made !== null) return { ownerId: made, via: 'created_by' }
  return { ownerId: null, via: 'none' }
}

/**
 * 이 줄이 **그 사람의 홈 할 일**에 서는가.
 * 주인이 없으면 누구의 할 일도 아니다 — 사업장 화면에만 선다(규칙 ③).
 */
export function isHomeTaskOf(input: DeviceOwnerInput, engineerId: number | null | undefined): boolean {
  const me = asId(engineerId)
  if (me === null) return false
  const { ownerId } = deviceOwnerOf(input)
  return ownerId !== null && ownerId === me
}

/** 사업장 화면은 **주인과 무관하게** 전부 보여 준다 — 그 사업장에 들어올 장비이기 때문이다. */
export const SHOWS_ON_SITE_ALWAYS = true
