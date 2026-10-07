// 결재란(결재표)에 **어떤 칸이 나오고 어느 칸에 도장이 찍히는가** — 그 규칙을 여기 한 곳에 둔다.
//
// 왜 모았는가. 결재표(components/approval/ApprovalTable.tsx)는 「기안자 + 결재자 + 합의자」로 칸을
// 그리는데, 진행 표기(components/approval/boxes.ts 의 statusText)는 결재선 줄만 세고 있었다.
// 그래서 결재란이 기안자·수석·총괄 3칸에 도장 2개인 문서가 「진행(2/2)」로 적혔다 — 보는 사람에게는
// 「다 끝났는데 왜 진행인가」로 읽힌다. 규칙이 두 곳에 베껴져 있으면 이런 어긋남은 또 생긴다.
//
// 순수 모듈이다 — React·supabase·서버 전용 코드를 들이지 않는다. 화면과 서버가 함께 읽을 수 있어야 한다
// (lib/approval/lineRules.ts 를 화면과 상신 서버가 함께 쓰는 것과 같은 이유다).
//
// 결재란의 칸 규칙(결재표 주석과 같은 내용):
//   · 맨 앞 기안자 칸 — 결재선(approval_lines)이 아니라 문서 값(requester_id · submitted_at)으로 그린다.
//     결재선에 기안자 줄을 만들면 판정(다음 차례·완료 여부)이 기안자를 결재자로 세게 되므로 넣지 않는다.
//   · 결재 줄(kind='approve') — 기안자 칸 뒤로 step 순.
//   · 합의 줄(kind='agree') — 「합의」 줄에 같은 모양으로 한 줄 더. 기안자 칸은 없다.
//   · 수신참조(kind='cc') — **칸이 없다.** 문서 정보의 「수신및참조」에 적는다.

import type { ApprovalLine, LineState } from './types'

/** 도장을 찍는 상태인가 — 대기는 빈칸, 생략은 「생략」이라는 말만 남기고 도장은 찍지 않는다. */
export const isStamped = (state: LineState): boolean => state !== '대기' && state !== '생략'

/** 칸 순서 — step, 같으면 line_id. 결재표와 목록이 같은 순서를 봐야 한다. */
const bySeq = (a: ApprovalLine, b: ApprovalLine): number =>
  (a.step ?? 0) - (b.step ?? 0) || a.line_id - b.line_id

/**
 * 결재란에 칸으로 나오는 줄 — 결재 줄과 합의 줄을 각각 순서대로. 참조는 어느 쪽에도 들어가지 않는다.
 * 기안자 칸은 결재선 줄이 아니므로 여기 없다(세는 쪽에서 더한다 — requesterCells 참고).
 */
export function tableLines(lines: ApprovalLine[] | null | undefined): {
  approve: ApprovalLine[]
  agree: ApprovalLine[]
} {
  const all = lines ?? []
  return {
    approve: all.filter(l => l.kind === 'approve').sort(bySeq),
    agree: all.filter(l => l.kind === 'agree').sort(bySeq),
  }
}

/** 결재란 맨 앞 기안자 칸의 수 — 기안자를 아는 문서면 1, 모르면 0(옛 호출부는 기안자 칸 없이 그린다). */
export const requesterCells = (requesterId: number | null | undefined): number =>
  requesterId == null ? 0 : 1

/** 기안자 칸에 도장이 찍혔는가 — 상신했으면 찍힌다. 임시저장(상신일 없음)이면 빈칸이다. */
export const requesterStamped = (
  requesterId: number | null | undefined,
  submittedAt: string | null | undefined,
): boolean => requesterId != null && !!submittedAt

/** 진행 표기에 필요한 문서 값만. 목록·상세의 문서 객체를 그대로 넘기면 된다. */
export type ProgressSource = {
  approval_lines?: ApprovalLine[] | null
  requester_id?: number | null
  submitted_at?: string | null
}

/**
 * 결재란 기준 진행 수 — **「진행(N/M)」의 N 과 M 이다.**
 *   total(M) = 결재란에 나오는 칸 수   — 기안자 칸 + 결재 칸 + 합의 칸. 참조는 세지 않는다.
 *   done(N)  = 도장이 찍힌 칸 수       — 기안자 칸(상신했으면) + state 가 대기·생략이 아닌 칸.
 *
 * 생략된 칸(전결로 뒤 차례가 지워진 경우)은 **분모에는 남고 분자에는 들어가지 않는다** — 결재란에
 * 「생략」이라는 말이 붙은 빈칸으로 그대로 보이기 때문이다. 그 문서는 상태가 '완료'라서 진행 표기를
 * 쓰지 않으므로(statusText 는 '진행중' 에서만 이 숫자를 쓴다) N<M 인 채로 끝나도 화면에 나오지 않는다.
 *
 * 진행중인 문서는 결재자가 1명 이상이고(engine 의 validateLineInput) 그 중 적어도 하나가 '대기' 라서
 * 언제나 N < M 이다.
 */
export function progressCount(doc: ProgressSource): { done: number; total: number } {
  const { approve, agree } = tableLines(doc.approval_lines)
  const cells = [...approve, ...agree]
  return {
    done: (requesterStamped(doc.requester_id, doc.submitted_at) ? 1 : 0)
      + cells.filter(l => isStamped(l.state)).length,
    total: requesterCells(doc.requester_id) + cells.length,
  }
}
