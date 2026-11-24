/**
 * 명함 사진에서 뽑아 온 값을 **칸에 담을 수 있게 다듬는다** (2026-11-23).
 *
 * ── 누가 읽나 ─────────────────────────────────────────────────────────────
 * 2026-11-23 까지는 브라우저에서 돌리는 공개 OCR 패키지가 읽었다. 실제 사진 4장에서 쓸 수 없는
 * 수준이라 **Claude 비전**(app/api/cards/ocr)으로 바꿨다. 글자를 줄로 끊어 칸을
 * 맞추던 규칙(직급 사전·부서 꼬리말·회사 표시…)은 모델이 하므로 전부 걷었다.
 *
 * 남은 것은 **모델이 돌려준 값을 믿지 않고 다듬는 쪽**이다 —
 *   · 전화·휴대폰·팩스 → 숫자와 하이픈만, +82 는 0 으로
 *   · 모델 응답 글자 → JSON (```json 울타리·앞뒤 말 제거)
 *   · 뒷면 합치기(빈 칸만)
 * 이 함수들은 **서버 라우트가 쓴다.** 브라우저는 사진만 보내고 값을 받는다.
 *
 * ── 사진은 남기지 않는다 ─────────────────────────────────────────────────
 * 라우트는 사진을 메모리에서만 쓰고 버린다. 저장하는 곳도, 로그에 남기는 곳도 없다.
 */

import type { CardField } from './businessCard'

/** 자동으로 채운 칸의 안내. */
export const OCR_NOTICE = '사진에서 읽음 · 확인 필요'

/** 화면에 보여 줄 진행 문구 — 한 군데서만 적는다. */
export const OCR_READING = '명함을 읽는 중…'

export type OcrFields = Partial<Record<CardField, string>>

/**
 * 모델이 돌려주는 칸 이름 — **열둘**. business_cards 의 칸 이름과 같다.
 * 영문 둘(`name_en`·`company_en`)은 db/business_cards_en_20261123.sql 로 더한다.
 * 그 SQL 을 아직 돌리지 않았어도 화면은 돈다 — 라우트가 **없는 칸을 빼고** 담는다.
 */
export const OCR_KEYS = [
  'name', 'name_en', 'position', 'department', 'company', 'company_en',
  'phone', 'mobile', 'fax', 'email', 'address', 'website',
] as const
export type OcrKey = typeof OCR_KEYS[number]

/** 번호 칸 — 다듬는 규칙이 다르다. */
const PHONE_KEYS: readonly OcrKey[] = ['phone', 'mobile', 'fax']

/** 한 줄로 다듬는다 — 앞뒤 공백·가운뎃점·콜론을 턴다. */
const clean = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/^[\s·:|/\-—]+|[\s·:|/\-—]+$/g, '').trim()

/**
 * 전화번호를 숫자와 하이픈만 남긴다.
 *   「+82-10-1234-5678」 → 「010-1234-5678」 · 「T. 031 123 4567」 → 「031-123-4567」
 * 숫자가 8개가 안 되면 번호가 아니라고 보고 버린다(빈 글자를 돌려준다).
 */
export function normalizePhone(raw: string): string {
  let s = String(raw ?? '').trim()
  if (!s) return ''
  // 국가번호 — +82 2 … / 0082-10-… 둘 다 0 으로 바꾼다.
  s = s.replace(/^\s*(?:\+|00)82[\s.-]*/, '0')
  // 「0(0)2」처럼 0 이 겹치면 하나로.
  s = s.replace(/^00+/, '0')
  // 괄호 안 지역번호 — (031) 123-4567
  s = s.replace(/[()]/g, '-')
  // 숫자·하이픈만 남기고(공백·점은 하이픈으로), 하이픈을 정리한다.
  s = s.replace(/[\s.]+/g, '-').replace(/[^\d-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return s.replace(/\D/g, '').length >= 8 ? s : ''
}

/**
 * 모델이 돌려준 글자에서 **JSON 만** 꺼낸다.
 * ```json 울타리, 앞뒤 인사말, 중괄호 밖의 군더더기를 걷어 낸다. 실패하면 null.
 */
export function parseOcrJson(text: string): Record<string, unknown> | null {
  let s = String(text ?? '').trim()
  if (!s) return null
  // ``` 또는 ```json 울타리
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  // 중괄호 바깥의 말
  const open = s.indexOf('{')
  const close = s.lastIndexOf('}')
  if (open < 0 || close <= open) return null
  s = s.slice(open, close + 1)
  try {
    const got: unknown = JSON.parse(s)
    return got && typeof got === 'object' && !Array.isArray(got) ? got as Record<string, unknown> : null
  } catch {
    return null
  }
}

/**
 * 파싱한 JSON → 칸. 모르는 칸은 버리고, 번호는 다듬고, 「없음」을 뜻하는 값은 비운다.
 * 모델이 null·'null'·'-'·'N/A' 로 돌려줄 수 있어 전부 빈 칸으로 본다.
 */
const EMPTYISH = new Set(['', '-', '–', 'null', 'none', 'n/a', 'na', '없음', '미상', 'unknown'])

/**
 * 모델이 「이 면은 뒷면·보조면이다」라고 했나 (2026-11-24).
 *
 * 글자 `'true'` 로 오는 일도 있어 둘 다 받는다. 모르면 **false** 로 본다 —
 * 뒷면이 아닌 것을 뒷면으로 보면 **멀쩡한 명함이 사라진다**. 반대쪽 실수가 덜 아프다.
 */
export function backSideFromJson(json: Record<string, unknown>): boolean {
  const v = json.is_back_side
  if (typeof v === 'boolean') return v
  return String(v ?? '').trim().toLowerCase() === 'true'
}

export function fieldsFromJson(json: Record<string, unknown>): Record<OcrKey, string> {
  const out = {} as Record<OcrKey, string>
  for (const key of OCR_KEYS) {
    const raw = json[key]
    if (raw == null) { out[key] = ''; continue }
    const v = clean(String(raw))
    if (EMPTYISH.has(v.toLowerCase())) { out[key] = ''; continue }
    out[key] = PHONE_KEYS.includes(key) ? normalizePhone(v) : v
  }
  return out
}

/**
 * 뒷면을 한 번 더 읽어 **빈 칸만** 채운다. 앞면 값은 덮지 않는다 —
 * 뒷면은 보통 영문이라 덮으면 한글 이름이 사라진다.
 */
export function mergeBack(front: OcrFields, back: OcrFields): OcrFields {
  const out: OcrFields = { ...front }
  for (const [k, v] of Object.entries(back) as [CardField, string][]) {
    if (!v) continue
    if (out[k] == null || String(out[k]).trim() === '') out[k] = v
  }
  return out
}

/** 자동으로 채운 칸 이름들 — 화면이 그 칸만 파랗게 칠한다. */
export function filledFields(f: OcrFields): CardField[] {
  return (Object.keys(f) as CardField[]).filter(k => String(f[k] ?? '').trim() !== '')
}

// ── 사진은 저장하지 않는다 ───────────────────────────────────────────────
/**
 * 명함 사진은 **읽는 동안만** 쓴다. 브라우저가 줄여서 보내고, 라우트가 모델에 넘기고,
 * 응답을 돌려준 뒤 버린다. 디스크·Storage·로그 어디에도 남기지 않는다 —
 * 남는 것은 사람이 확인한 **글자뿐**이다.
 * (scripts/card-ocr-check.js 가 「저장하는 자리 없음」을 계속 지킨다)
 */
export const PHOTO_IS_NEVER_STORED = true
