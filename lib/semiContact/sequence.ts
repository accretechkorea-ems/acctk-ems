// 반도체 고객 접촉 보고 — **접촉 차수(#n)**(순수 모듈). 화면과 엑셀이 같은 계산을 쓴다.
//
// 같은 Project 의 보고서를 접촉일 오름차순(같은 날이면 report_id 오름차순)으로 세어 #1, #2, … 를 매긴다.
// DB 에 저장하지 않는 **표시 전용** 값이다 — 중간 보고서를 지우면 뒤 번호가 당겨지는 것이 정상이다.
// 순서 기준은 「직전 보고」 규칙(prefill.ts: contact_date desc, report_id desc 의 첫 건)과 같은 축이다.

export type SequenceSource = { report_id: number; contact_date: string }

/** report_id → 차수(1부터). */
export function contactSequence(reports: readonly SequenceSource[]): Map<number, number> {
  const asc = [...reports].sort((a, b) =>
    a.contact_date.localeCompare(b.contact_date) || a.report_id - b.report_id)
  return new Map(asc.map((r, i) => [r.report_id, i + 1]))
}

/** 차수 표시 「#3」. 차수를 모르면 빈 문자열. */
export function seqLabel(n: number | null | undefined): string {
  return n && n > 0 ? `#${n}` : ''
}
