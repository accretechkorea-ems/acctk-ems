// 전자결재 공용 타입과 상태값.
//
// DB 의 approval_documents · approval_lines · approval_history 컬럼과 1:1 로 맞춘다.
// 상태값은 설계서의 한글 값을 그대로 쓴다 — DB 에 들어가는 문자열이 곧 화면에 보이는 말이라
// 중간에 번역표를 두지 않는다.

/** 문서 상태. approval_documents.status */
export type DocStatus = '임시저장' | '진행중' | '완료' | '반려' | '회수'

/** 결재선 한 줄의 종류. approval_lines.kind */
export type LineKind = 'approve' | 'agree' | 'cc'

/** 결재선 한 줄의 상태. approval_lines.state */
export type LineState = '대기' | '승인' | '반려' | '전결' | '생략' | '대결'

/** 이력에 남는 행위. approval_history.action */
export type HistoryAction = '상신' | '승인' | '반려' | '전결' | '회수' | '재상신' | '대결'

/** 순서를 갖는 줄의 종류 — 수신참조(cc)는 순서에서 빠진다. */
export const SEQUENTIAL_KINDS: LineKind[] = ['approve', 'agree']

/** 결재 화면 경로. 알림 링크가 여기를 가리킨다(화면은 3단계). */
export const APPROVAL_PATH = '/approval'

/** approval_lines 한 행. */
export type ApprovalLine = {
  line_id: number
  document_id: number
  step: number | null
  kind: LineKind
  approver_id: number
  is_delegated_authority: boolean
  state: LineState
  acted_by: number | null
  acted_at: string | null
  comment: string | null
}

/** approval_documents 한 행. */
export type ApprovalDocument = {
  document_id: number
  doc_type: string
  doc_no: string
  title: string
  summary: Record<string, unknown>
  target_table: string
  target_id: number | null
  status: DocStatus
  requester_id: number
  division: string
  current_step: number
  submitted_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

/** approval_delegations 한 행 중 판정에 쓰는 부분. */
export type Delegation = {
  owner_id: number
  delegate_id: number
  start_date: string   // YYYY-MM-DD
  end_date: string     // YYYY-MM-DD
  doc_type: string | null   // null 이면 모든 유형
}

/** 상신·재상신 때 화면이 보내는 결재선 한 줄. */
export type LineInput = {
  step: number
  kind: LineKind
  approverId: number
  isDelegatedAuthority?: boolean
}
