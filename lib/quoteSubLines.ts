// 견적 품목의 **품명 아래 설명 줄**(화면의 「줄 추가」, 코드 이름 subLines) — 순수 모듈.
//
// 쓰는 자리: 시리얼 번호, 옵션 설명, 「- Leaf Spring 교체」 같은 부속 내역.
// PDF 에서 품명 바로 아래 작은 글씨로 줄마다 한 행씩 나간다(app/quote/QuotePDFDoc.tsx).
//
// 왜 저장해야 하는가 — 이 줄은 **지금까지 DB 에 들어가지 않았다.** 확정 때 만드는 PDF 는 화면 값으로
// 그려 줄이 보이지만, 결재 대상 견적은 저장값으로 PDF 를 다시 만들기 때문에(lib/quotePdfData.ts)
// 결재 화면·승인 뒤 PDF 에서 줄이 통째로 사라졌다. 고객에게 나가는 문서가 확정 때와 달라진다.
//
// 저장 모양(quote_items.sub_lines jsonb): 문자열 배열 `["S/N: 123", "옵션 A"]`.
// **null = 줄 없음**이다. 빈 배열을 적어 두지 않는다 — 「줄이 없다」는 뜻이 둘이 되면 읽는 쪽이 갈린다.
// 기존 견적은 backfill 하지 않는다(null → 줄 없음으로 읽힌다).
//
// DB·화면에 의존하지 않는다(import 가 없다) — 스크립트로 그대로 돌려 볼 수 있다.

/**
 * 한 품목에 둘 수 있는 줄 수 상한.
 * **화면에는 상한이 없었다**(app/quote/QuoteItemRow.tsx 의 「줄 추가」 버튼에 조건이 없다).
 * PDF 의 품명 칸은 한 행 높이가 정해져 있어 줄이 많으면 표가 넘친다 — 열 개면 실무에 넉넉하다.
 */
export const SUBLINES_MAX = 10

/**
 * 한 줄의 길이 상한.
 * **화면에는 maxLength 가 없었다.** PDF 의 품명 칸 폭에서 8.5pt 로 한 행에 담기는 한계가 그 정도다.
 * 넘으면 **자르지 않고 오류로 알린다** — 조용히 자르면 반 토막 설명이 고객에게 나간다.
 */
export const SUBLINE_MAX_LEN = 80

export type NormalizeResult =
  | { ok: true; lines: string[]; stored: string[] | null }
  | { ok: false; message: string }

/**
 * 사람이 적은 줄들을 저장할 모양으로 다듬는다.
 *   · 줄마다 앞뒤 공백을 지우고, 줄바꿈·탭·연속 공백을 **한 칸으로 접는다**(PDF 의 그 줄은 한 행이다).
 *   · **빈 줄은 버린다** — 화면의 「줄 추가」는 빈 입력칸을 먼저 만들므로 안 채운 칸이 남을 수 있다.
 *   · 줄 수가 10 을 넘거나 한 줄이 80 자를 넘으면 `{ ok: false }`.
 *   · 남은 줄이 없으면 `stored: null` — 저장하지 않는다(= 줄 없음).
 */
export function normalizeSubLines(input: unknown): NormalizeResult {
  if (!Array.isArray(input)) return { ok: true, lines: [], stored: null }

  const lines: string[] = []
  for (const raw of input) {
    const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
    // 전각 공백(U+3000)도 눈에는 공백이라 함께 접는다.
    const folded = text.replace(/[\s　]+/g, ' ').trim()
    if (folded === '') continue
    lines.push(folded)
  }

  if (lines.length > SUBLINES_MAX) {
    return { ok: false, message: `품목 설명 줄은 ${SUBLINES_MAX}줄까지 넣을 수 있습니다` }
  }
  const tooLong = lines.find(l => l.length > SUBLINE_MAX_LEN)
  if (tooLong) {
    return { ok: false, message: `품목 설명 줄은 한 줄에 ${SUBLINE_MAX_LEN}자까지 적을 수 있습니다` }
  }

  return { ok: true, lines, stored: lines.length > 0 ? lines : null }
}

/**
 * 저장값을 **늘 문자열 배열로** 풀어 준다. 무엇이 와도 깨지지 않는다.
 *   null · undefined · 깨진 JSON 문자열 · 객체 · 숫자 → 빈 배열.
 *   배열이면 문자열 칸만 남기고(숫자·객체는 버린다) 접어서 돌려준다.
 *
 * jsonb 칸은 보통 배열로 오지만, 문자열로 오는 경로(옛 데이터·수동 입력)도 받아 둔다.
 */
export function subLinesOf(stored: unknown): string[] {
  const arr = readArray(stored)
  if (!arr) return []
  const out: string[] = []
  for (const v of arr) {
    if (typeof v !== 'string') continue
    const folded = v.replace(/[\s　]+/g, ' ').trim()
    if (folded !== '') out.push(folded)
  }
  return out
}

function readArray(v: unknown): unknown[] | null {
  if (v == null) return null
  if (Array.isArray(v)) return v
  if (typeof v !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(v)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}
