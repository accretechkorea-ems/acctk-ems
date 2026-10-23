// 영업이익 하한 미만일 때 적는 **사유**를 quotes.note 안에 넣고 꺼낸다.
//
// 왜 note 안인가 — 칸을 새로 만들지 않기로 했다(DB 변경 없음). note 는 이미 여러 줄을
// 담는 칸이고(E.U 줄 + 비고 본문), 줄 하나를 더 두는 것으로 끝난다.
//
// **고객 견적서(PDF)에는 나가지 않는다.** 사유는 내부 판단 기록이다. 그래서 PDF 비고는
// 사유를 뺀 글을 쓰고, 저장되는 note 에만 맨 끝에 한 줄로 붙는다.
//
//   note 에 저장되는 모양
//     * E.U  : 무브넥스 1공장        ← 있으면
//     (비고 본문 여러 줄)
//     [영업이익 사유] 일진공기부 공급가격 확정 — 올해 인상 어려움
//
// 순수 함수만 둔다 — 하네스(scripts/quote-profit-check.js)가 그대로 돌린다.

/** 줄 머리표. 이 글자로 찾는다 — 바꾸면 지난 견적의 사유를 못 읽는다. */
export const OPERATING_REASON_PREFIX = '[영업이익 사유]'

/** 그 줄인가. 앞뒤 공백은 봐준다. */
const isReasonLine = (line: string): boolean => line.trim().startsWith(OPERATING_REASON_PREFIX)

/**
 * note 에서 사유만 꺼낸다. 없으면 빈 글자.
 *
 * 줄이 여러 개면 **마지막 것**을 쓴다 — 덧붙이다 중복된 경우 가장 최근 것이 맞다.
 */
export function operatingReasonOf(note: string | null | undefined): string {
  const lines = (note ?? '').split('\n').filter(isReasonLine)
  if (lines.length === 0) return ''
  return lines[lines.length - 1].trim().slice(OPERATING_REASON_PREFIX.length).trim()
}

/** 사유 줄을 뺀 글. PDF 비고와 작성 화면의 비고 칸이 이것을 쓴다. */
export function stripOperatingReason(note: string | null | undefined): string {
  return (note ?? '').split('\n').filter(line => !isReasonLine(line)).join('\n').replace(/\n+$/, '')
}

/**
 * 저장할 note — 본문 끝에 사유 한 줄을 붙인다.
 *
 * 사유가 비어 있으면 **붙이지 않는다**(빈 머리표만 남는 줄을 만들지 않는다).
 * 본문에 이미 사유 줄이 있으면 걷어내고 새로 붙인다 — 두 번 저장해도 한 줄이다.
 */
export function withOperatingReason(note: string | null | undefined, reason: string | null | undefined): string {
  const body = stripOperatingReason(note)
  const r = (reason ?? '').trim()
  if (!r) return body
  // 사유에 줄바꿈을 넣으면 꺼낼 때 깨진다 — 한 줄로 눕힌다.
  const flat = r.replace(/\s*\n\s*/g, ' ')
  return body ? `${body}\n${OPERATING_REASON_PREFIX} ${flat}` : `${OPERATING_REASON_PREFIX} ${flat}`
}
