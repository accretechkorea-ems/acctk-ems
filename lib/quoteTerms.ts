// 견적서 PDF 아래의 조건 네 줄 — 기본값과 작성자가 고친 값을 다루는 순수 모듈.
//
//   1.납품일정 : 담당자와 협의
//   2.지불조건 : 익월말 현금 결제
//   3.인도조건 : 지정장소
//   4.견적유효 : 작성일로부터 1개월
//
// 예전에는 이 네 줄이 app/quote/QuotePDFDoc.tsx 안에 글자로 박혀 있었다. 작성자가 고칠 수 있게
// 하려면 **견적에 저장돼야 한다** — 저장하지 않으면 「다시쓰기」로 되살린 견적이 기본 문구로
// 돌아가고, 결재 검토표도 무엇이 적혀 나가는지 보여 줄 수 없다.
//
// 저장 모양(quotes.terms jsonb):
//   { "delivery_schedule": …, "payment_terms": …, "delivery_terms": …, "validity": … }
//   **null = 네 줄 모두 기본값**이다. 기본값과 같은 값을 적어 두지 않는다 — 그러면 나중에
//   기본 문구를 고칠 때 옛 견적만 옛 문구로 굳어 버린다. 기존 견적은 backfill 하지 않는다.
//
// DB·화면에 의존하지 않는다(import 가 없다) — 스크립트로 그대로 돌려 볼 수 있다.

/**
 * 저장·전달에 쓰는 칸의 열쇠. 순서가 곧 PDF 의 1~5번 순서다.
 * **보증(warranty)은 장비 양식에서만** 쓴다 — termKeysFor 가 양식별로 걸러낸다.
 */
export const TERM_KEYS = ['delivery_schedule', 'payment_terms', 'delivery_terms', 'validity', 'warranty'] as const

export type TermKey = typeof TERM_KEYS[number]
export type Terms = Record<TermKey, string>

/** 지금까지 PDF 에 박혀 있던 문구. **한 글자도 바꾸지 마라** — 옛 견적이 이 값으로 그려진다. */
export const DEFAULT_TERMS: Terms = {
  delivery_schedule: '담당자와 협의',
  payment_terms: '익월말 현금 결제',
  delivery_terms: '지정장소',
  validity: '작성일로부터 1개월',
  warranty: '설치 후 1년',
}

/**
 * **양식마다 다른** 기본 문구. 적어 두지 않은 칸은 위 DEFAULT_TERMS 그대로다.
 *
 * 왜 DEFAULT_TERMS 를 직접 고치지 않는가 — 그 값은 **옛 견적을 그리는 값**이다
 * (조건을 바꾸지 않은 견적은 quotes.terms 가 null 이라, 그릴 때 기본값을 채워 넣는다).
 * 한 벌뿐인 기본값을 고치면 80 견적의 지난 문서까지 함께 바뀐다.
 */
const TERMS_BY_FORM: Record<string, Partial<Terms>> = {
  // 20 견적서(예비품) — 지불조건이 다르다(2026-10-21).
  general20: { payment_terms: '납입 후 익월 말 현금 결제' },
}

/**
 * 그 양식의 기본 문구 한 벌. 양식을 모르면 DEFAULT_TERMS 그대로다.
 *
 * **읽는 쪽도 같은 값을 써야 한다.** 조건을 바꾸지 않은 견적은 terms 가 null 로 저장되므로,
 * 나중에 그 견적을 그리거나 되살릴 때 양식을 모르면 다른 문구가 나온다
 * (다시쓰기·검토표·PDF 가 모두 이 함수를 거친다).
 */
export function defaultTermsFor(formKind: string | null | undefined): Terms {
  const over = formKind ? TERMS_BY_FORM[formKind] : undefined
  return over ? { ...DEFAULT_TERMS, ...over } : { ...DEFAULT_TERMS }
}

/**
 * 조건을 바꾸는 손잡이 — 화면이 훅·카드에 넘긴다.
 * **null 을 주면 그 양식의 기본값으로 되돌린다**(손대지 않은 상태로 돌아간다).
 */
export type SetTerms = (v: Terms | null | ((prev: Terms) => Terms)) => void

/**
 * 화면·검토표·PDF 에서 쓰는 이름(번호 없이).
 * 번호와 콜론은 PDF 가 따로 그린다 — 항목명을 **글자별 상자**로 4글자 폭에 고르게 펴서
 * 「보  증」의 증이 「효」 밑에 오게 하고 콜론 좌우 간격을 같게 하기 때문이다.
 */
export const TERM_LABELS: Record<TermKey, string> = {
  delivery_schedule: '납품일정',
  payment_terms: '지불조건',
  delivery_terms: '인도조건',
  validity: '견적유효',
  // 두 글자다 — PDF 는 4글자 폭에 고르게 펴서 「보  증」으로 그린다(증이 「효」 밑에 온다).
  warranty: '보증',
}

/** 장비 양식에서만 쓰는 칸. 다른 양식에서는 화면·PDF 에 보이지 않고 **저장도 하지 않는다**. */
export const EQUIP_ONLY_TERM_KEYS: readonly TermKey[] = ['warranty']

/**
 * 그 양식에서 **보이고 저장되는** 조건 칸.
 * 장비(equip80)는 다섯 줄, 나머지 양식은 네 줄이다. 양식을 모르면(개편 전 견적·옛 초안)
 * 네 줄로 떨어진다 — 보증은 장비에만 뜻이 있는 문구다.
 */
export function termKeysFor(formKind: string | null | undefined): readonly TermKey[] {
  if (formKind === 'equip80') return TERM_KEYS
  return TERM_KEYS.filter(k => !EQUIP_ONLY_TERM_KEYS.includes(k))
}

/**
 * 한 칸의 길이 상한. PDF 의 그 줄은 한 행이라, 넘으면 오른쪽 회사 정보와 겹치거나 잘린다.
 * **넘으면 자르지 않고 오류로 알린다** — 조용히 자르면 고객에게 반 토막 문구가 나간다.
 */
export const TERM_MAX_LEN = 40

/**
 * 사람이 적은 값을 저장할 모양으로 다듬는다.
 *   · 앞뒤 공백을 지우고, 줄바꿈·탭·연속 공백을 **한 칸으로 접는다**(PDF 의 그 줄은 한 행이다).
 *   · 빈 값은 **기본값으로 둔다**(지우면 줄이 사라지는 것이 아니라 기본 문구로 돌아간다).
 *   · 한 칸이라도 40자를 넘으면 `{ ok: false }` — 어느 칸인지 라벨로 알린다.
 *   · 보는 값이 모두 기본값과 같으면 `terms: null` — **저장하지 않는다**(= 기본).
 *
 * keys 를 주면 **그 칸만** 보고 그 칸만 저장한다(termKeysFor). 장비가 아닌 양식에서
 * 보증을 저장하지 않으려고 둔 인자다 — 주지 않으면 지금까지처럼 모든 칸을 본다.
 */
export type NormalizeResult =
  | { ok: true; terms: Terms; stored: Partial<Terms> | null }
  | { ok: false; message: string }

export function normalizeTerms(
  input: Partial<Record<TermKey, unknown>> | null | undefined,
  keys: readonly TermKey[] = TERM_KEYS,
  base: Terms = DEFAULT_TERMS,
): NormalizeResult {
  const out = { ...base }
  const over: string[] = []

  for (const key of keys) {
    const raw = input?.[key]
    const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
    // 줄바꿈·탭·연속 공백을 한 칸으로. 전각 공백(U+3000)도 눈에는 공백이라 함께 접는다.
    const folded = text.replace(/[\s　]+/g, ' ').trim()
    if (folded === '') continue              // 빈 값 → 기본값 그대로
    if (folded.length > TERM_MAX_LEN) { over.push(TERM_LABELS[key]); continue }
    out[key] = folded
  }

  if (over.length > 0) {
    return { ok: false, message: `${over.join('·')}은 ${TERM_MAX_LEN}자까지 적을 수 있습니다` }
  }
  // 저장값에는 **보는 칸만** 담는다. 담지 않은 칸은 읽을 때 기본값으로 채워진다(termsOf).
  const stored: Partial<Terms> = {}
  for (const key of keys) stored[key] = out[key]
  return { ok: true, terms: out, stored: isAllDefault(out, keys, base) ? null : stored }
}

/**
 * 옛 **납기** 값을 「납품일정」으로 올린다 — 납기 칸을 없앤 뒤의 호환 규칙.
 *
 * 납기는 quotes.delivery_info 에 따로 저장되던 값이다(화면의 「납기」 칸). 그 칸을 없애고
 * 조건 1번 납품일정 한 곳으로 모았으므로, 옛 견적·옛 초안을 되살릴 때 **납기 값만 있고
 * 납품일정은 기본값인 경우** 납기 값을 납품일정으로 올린다. 둘 다 값이 있으면 조건 쪽이 정본이다.
 *
 * 올리지 않는 경우 — 조용히 엉뚱한 글자가 고객 문서에 들어가지 않게 셋을 막는다.
 *   · 빈 값
 *   · **줄바꿈이 있는 값** — 발주 요청이 같은 칸(delivery_info)을 배송 주소로 덮어쓴다
 *     (app/api/purchase-order/route.ts). 그 주소가 납품일정 줄로 올라가면 안 된다.
 *   · 40자(TERM_MAX_LEN)를 넘는 값 — 그 줄은 PDF 에서 한 행이다.
 */
export function promoteLegacyDelivery(terms: Terms, legacy: string | null | undefined): Terms {
  const raw = legacy ?? ''
  if (raw.includes('\n')) return terms
  const v = raw.replace(/[\s　]+/g, ' ').trim()
  if (v === '' || v.length > TERM_MAX_LEN) return terms
  // 납품일정을 이미 적어 둔 견적은 그 값을 그대로 둔다.
  if (terms.delivery_schedule !== DEFAULT_TERMS.delivery_schedule) return terms
  return { ...terms, delivery_schedule: v }
}

/** 보는 칸이 모두 기본값과 같은가(기본값은 양식마다 다를 수 있다 — defaultTermsFor). */
export const isAllDefault = (
  t: Terms, keys: readonly TermKey[] = TERM_KEYS, base: Terms = DEFAULT_TERMS,
): boolean => keys.every(k => t[k] === base[k])

/**
 * 저장값을 **늘 네 값으로** 풀어 준다. 무엇이 와도 깨지지 않는다.
 *   null · undefined · 깨진 JSON 문자열 · 배열 · 숫자 · 일부 칸만 있는 객체 → 없는 칸은 기본값.
 *
 * jsonb 칸은 보통 객체로 오지만, 문자열로 오는 경로(옛 데이터·수동 입력)도 받아 둔다.
 */
export function termsOf(stored: unknown, base: Terms = DEFAULT_TERMS): Terms {
  const obj = readObject(stored)
  if (!obj) return { ...base }
  const out = { ...base }
  for (const key of TERM_KEYS) {
    const v = obj[key]
    if (typeof v !== 'string') continue
    const folded = v.replace(/[\s　]+/g, ' ').trim()
    if (folded !== '') out[key] = folded
  }
  return out
}

function readObject(v: unknown): Record<string, unknown> | null {
  if (v == null) return null
  if (typeof v === 'object') return Array.isArray(v) ? null : (v as Record<string, unknown>)
  if (typeof v !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(v)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * 기본값과 **다른** 항목만. 검토표가 「조건 변경」 줄에 쓴다.
 * 모두 기본이면 빈 배열 — 부르는 쪽이 아무것도 그리지 않는다.
 */
export function changedTerms(
  stored: unknown, base: Terms = DEFAULT_TERMS,
): { key: TermKey; label: string; value: string }[] {
  const t = termsOf(stored, base)
  return TERM_KEYS
    .filter(k => t[k] !== base[k])
    .map(k => ({ key: k, label: TERM_LABELS[k], value: t[k] }))
}
