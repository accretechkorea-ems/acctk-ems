// 견적서 PDF 아래의 조건 네 줄 — 기본값과 작성자가 고친 값을 다루는 순수 모듈.
//
//   1.납품일정 : 담당자와 협의
//   2.지불조건 : 익월말 현금 결제
//   3.인도조건 : 지정장소
//   4.견적유효 : 작성일로부터 1개월
//
// 예전에는 이 네 줄이 app/quote/QuotePDFDoc.tsx 안에 글자로 박혀 있었다. 작성자가 고칠 수 있게
// 하려면 **견적에 저장돼야 한다** — 결재 대상 견적서는 저장된 파일을 열지 않고 저장값으로 다시
// 그리기 때문에(lib/quotePdfData.ts), 저장하지 않으면 확정 때 나간 PDF 와 결재 PDF 가 달라진다.
//
// 저장 모양(quotes.terms jsonb):
//   { "delivery_schedule": …, "payment_terms": …, "delivery_terms": …, "validity": … }
//   **null = 네 줄 모두 기본값**이다. 기본값과 같은 값을 적어 두지 않는다 — 그러면 나중에
//   기본 문구를 고칠 때 옛 견적만 옛 문구로 굳어 버린다. 기존 견적은 backfill 하지 않는다.
//
// DB·화면에 의존하지 않는다(import 가 없다) — 스크립트로 그대로 돌려 볼 수 있다.

/** 저장·전달에 쓰는 네 칸의 열쇠. 순서가 곧 PDF 의 1~4번 순서다. */
export const TERM_KEYS = ['delivery_schedule', 'payment_terms', 'delivery_terms', 'validity'] as const

export type TermKey = typeof TERM_KEYS[number]
export type Terms = Record<TermKey, string>

/** 지금까지 PDF 에 박혀 있던 문구. **한 글자도 바꾸지 마라** — 옛 견적이 이 값으로 그려진다. */
export const DEFAULT_TERMS: Terms = {
  delivery_schedule: '담당자와 협의',
  payment_terms: '익월말 현금 결제',
  delivery_terms: '지정장소',
  validity: '작성일로부터 1개월',
}

/** PDF 의 왼쪽 라벨. 번호까지 포함한 글자 그대로다. */
export const TERM_PDF_LABELS: Record<TermKey, string> = {
  delivery_schedule: '1.납품일정 :',
  payment_terms: '2.지불조건 :',
  delivery_terms: '3.인도조건 :',
  validity: '4.견적유효 :',
}

/** 화면·검토표에서 쓰는 짧은 이름(번호 없이). */
export const TERM_LABELS: Record<TermKey, string> = {
  delivery_schedule: '납품일정',
  payment_terms: '지불조건',
  delivery_terms: '인도조건',
  validity: '견적유효',
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
 *   · 네 값이 모두 기본값과 같으면 `terms: null` — **저장하지 않는다**(= 기본).
 */
export type NormalizeResult =
  | { ok: true; terms: Terms; stored: Terms | null }
  | { ok: false; message: string }

export function normalizeTerms(input: Partial<Record<TermKey, unknown>> | null | undefined): NormalizeResult {
  const out = { ...DEFAULT_TERMS }
  const over: string[] = []

  for (const key of TERM_KEYS) {
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
  return { ok: true, terms: out, stored: isAllDefault(out) ? null : out }
}

/** 네 값이 모두 기본값과 같은가. */
export const isAllDefault = (t: Terms): boolean =>
  TERM_KEYS.every(k => t[k] === DEFAULT_TERMS[k])

/**
 * 저장값을 **늘 네 값으로** 풀어 준다. 무엇이 와도 깨지지 않는다.
 *   null · undefined · 깨진 JSON 문자열 · 배열 · 숫자 · 일부 칸만 있는 객체 → 없는 칸은 기본값.
 *
 * jsonb 칸은 보통 객체로 오지만, 문자열로 오는 경로(옛 데이터·수동 입력)도 받아 둔다.
 */
export function termsOf(stored: unknown): Terms {
  const obj = readObject(stored)
  if (!obj) return { ...DEFAULT_TERMS }
  const out = { ...DEFAULT_TERMS }
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
export function changedTerms(stored: unknown): { key: TermKey; label: string; value: string }[] {
  const t = termsOf(stored)
  return TERM_KEYS
    .filter(k => t[k] !== DEFAULT_TERMS[k])
    .map(k => ({ key: k, label: TERM_LABELS[k], value: t[k] }))
}
