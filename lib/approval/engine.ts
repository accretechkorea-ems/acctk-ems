// 결재 엔진 — 순수 로직만. DB 를 읽지도 쓰지도 않는다(그것은 라우트가 한다).
//
// 여기에는 doc_type 분기가 없다. 유형별 차이는 lib/approval/docTypes.ts 의 등록 정보로만
// 나타나고, 엔진은 「결재선이라는 줄의 목록」과 「오늘 날짜」만 보고 답을 낸다.
// 그래서 새 문서 유형이 생겨도 이 파일은 고치지 않는다.

import {
  SEQUENTIAL_KINDS,
  type ApprovalLine,
  type Delegation,
  type LineInput,
  type LineKind,
  type LineState,
} from './types'

/** 순서를 갖는 줄(결재·합의)만 step 오름차순으로. 수신참조는 순서에서 빠진다. */
export function sequentialLines(lines: ApprovalLine[]): ApprovalLine[] {
  return lines
    .filter(l => SEQUENTIAL_KINDS.includes(l.kind))
    .sort((a, b) => (a.step ?? 0) - (b.step ?? 0) || a.line_id - b.line_id)
}

/** 다음 차례 — step 순서로 보아 state 가 '대기' 인 첫 결재·합의 줄. 없으면 null. */
export function nextPendingLine(lines: ApprovalLine[]): ApprovalLine | null {
  return sequentialLines(lines).find(l => l.state === '대기') ?? null
}

/** 남은 '대기' 가 없으면 완료다. */
export function isComplete(lines: ApprovalLine[]): boolean {
  return nextPendingLine(lines) === null
}

/** 아무도 손대지 않았는가 — 회수는 이때만 된다. */
export function untouched(lines: ApprovalLine[]): boolean {
  return sequentialLines(lines).every(l => l.state === '대기')
}

/**
 * 전결 처리로 건너뛸 줄들. 전결한 사람(afterStep) 뒤의 '대기' 인 결재·합의가 대상이다.
 * 앞 순번은 이미 처리된 줄이므로 손대지 않는다.
 */
export function skippedLineIds(lines: ApprovalLine[], afterStep: number): number[] {
  return sequentialLines(lines)
    .filter(l => l.state === '대기' && (l.step ?? 0) > afterStep)
    .map(l => l.line_id)
}

/** 수신참조 대상. 완료 알림을 받는 사람들이다. */
export function ccApproverIds(lines: ApprovalLine[]): number[] {
  return [...new Set(lines.filter(l => l.kind === 'cc').map(l => l.approver_id))]
}

/**
 * 이 위임이 오늘, 이 문서 유형에 유효한가.
 * 날짜는 YYYY-MM-DD 문자열끼리 비교한다(같은 형식이라 사전순 비교가 곧 날짜 비교다).
 */
export function delegationActive(d: Delegation, today: string, docType: string): boolean {
  if (d.start_date > today || d.end_date < today) return false
  return d.doc_type === null || d.doc_type === docType
}

/** 그 줄을 지금 대신 처리할 수 있는 대리인들. */
export function delegatesOf(
  approverId: number,
  delegations: Delegation[],
  today: string,
  docType: string,
): number[] {
  return [...new Set(
    delegations
      .filter(d => d.owner_id === approverId && delegationActive(d, today, docType))
      .map(d => d.delegate_id),
  )]
}

/**
 * 이 사람이 그 줄을 처리할 수 있는가.
 *   본인이면      { ok: true, asDelegate: false }
 *   위임받았으면  { ok: true, asDelegate: true }  — 기록은 「대결」이 된다
 */
export function actorFor(
  line: ApprovalLine,
  actorId: number,
  delegations: Delegation[],
  today: string,
  docType: string,
): { ok: boolean; asDelegate: boolean } {
  if (line.approver_id === actorId) return { ok: true, asDelegate: false }
  const ok = delegatesOf(line.approver_id, delegations, today, docType).includes(actorId)
  return { ok, asDelegate: ok }
}

/**
 * 승인했을 때 그 줄에 남길 state.
 * 전결 지정이 대결보다 앞선다 — 문서를 끝내는 것이 전결이고, 누가 눌렀는지는 acted_by 가 남긴다.
 * (대리인이 전결 줄을 처리하면 state 는 '전결', 이력에는 '대결' 이 함께 남는다)
 */
export function approvedState(line: ApprovalLine, asDelegate: boolean): LineState {
  if (line.is_delegated_authority) return '전결'
  return asDelegate ? '대결' : '승인'
}

/** 승인 결과를 메모리 위에서 반영한 결재선 — 완료 판정·다음 차례 계산에 쓴다. */
export function applyApproval(
  lines: ApprovalLine[],
  lineId: number,
  state: LineState,
  skipped: number[],
): ApprovalLine[] {
  const skipSet = new Set(skipped)
  return lines.map(l => {
    if (l.line_id === lineId) return { ...l, state }
    if (skipSet.has(l.line_id)) return { ...l, state: '생략' as LineState }
    return l
  })
}

const KINDS: LineKind[] = ['approve', 'agree', 'cc']

/**
 * 상신·재상신 결재선 검증. 문제가 있으면 사람이 읽을 메시지를, 없으면 null 을 돌려준다.
 *   · 결재(approve) 가 한 명 이상
 *   · 결재·합의의 step 이 1부터 빠짐없이 이어짐(중복 없음)
 *   · 같은 사람이 두 번 들어가지 않음(결재와 참조에 동시에 넣는 것도 막는다)
 *   · 퇴사자·없는 계정 불가
 *   · 상신자 본인이 결재선에 들어가지 않음
 */
export function validateLineInput(
  lines: LineInput[],
  requesterId: number,
  activeApproverIds: Set<number>,
): string | null {
  if (!Array.isArray(lines) || lines.length === 0) return '결재선을 지정해주세요.'

  for (const l of lines) {
    if (!KINDS.includes(l.kind)) return `결재선 종류가 올바르지 않습니다: ${String(l.kind)}`
    if (!Number.isInteger(l.approverId) || l.approverId <= 0) return '결재자가 올바르지 않습니다.'
    if (l.approverId === requesterId) return '상신자는 자기 결재선에 들어갈 수 없습니다.'
    if (!activeApproverIds.has(l.approverId)) return '퇴사했거나 없는 직원이 결재선에 있습니다.'
  }

  const ids = lines.map(l => l.approverId)
  if (new Set(ids).size !== ids.length) return '같은 사람을 결재선에 두 번 넣을 수 없습니다.'

  const ordered = lines.filter(l => SEQUENTIAL_KINDS.includes(l.kind))
  if (!ordered.some(l => l.kind === 'approve')) return '결재자를 한 명 이상 지정해주세요.'

  const steps = ordered.map(l => l.step).sort((a, b) => a - b)
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] !== i + 1) return '결재 순서는 1부터 빠짐없이 이어져야 합니다.'
  }
  return null
}

/** 결재선 입력을 DB 행 모양으로. 수신참조는 step 을 갖지 않는다. */
export function toLineRows(documentId: number, lines: LineInput[]) {
  return lines.map(l => ({
    document_id: documentId,
    step: l.kind === 'cc' ? null : l.step,
    kind: l.kind,
    approver_id: l.approverId,
    is_delegated_authority: l.kind === 'approve' && l.isDelegatedAuthority === true,
    state: '대기' as LineState,
  }))
}
