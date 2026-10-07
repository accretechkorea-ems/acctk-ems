// 문서 양식 화면(app/approval/doc/[id])이 다루는 문서 한 건의 모양 — 순수 타입·판정만 둔다.
//
// /api/approval/doc 의 응답과 1:1 로 맞춘다. 양식 본문(panels.ts 의 FormBody)이 이 타입을
// 그대로 받으므로, 유형별 본문이 「무엇을 받는지」가 한 곳에 적혀 있다.

import type { ApprovalLine } from './types'

/** 사람 한 명 — 번호를 이름·직급·부서로 바꾼다. 목록 화면의 people 맵과 같은 모양이다. */
export type FormPerson = { name: string | null; position: string | null; teams: string | null }

/** 양식 화면이 그리는 문서 한 건. */
export type FormDoc = {
  document_id: number
  doc_type: string
  doc_no: string
  title: string
  status: string
  requester_id: number
  division: string
  summary: Record<string, unknown>
  target_table: string
  target_id: number | null
  submitted_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  approval_lines: ApprovalLine[]
}

/** 이 사용자가 이 문서로 할 수 있는 일 — 라우트가 lib/approval/docActions.ts 로 판정해 내려 준다. */
export type FormCan = {
  approve: boolean
  delegated: boolean
  currentApproverId: number | null
  isOwner: boolean
  withdraw: boolean
  resubmit: boolean
  discard: boolean
}

export type FormResponse = {
  doc: FormDoc
  people: Record<number, FormPerson>
  can: FormCan
}

/**
 * 끝난 문서인가 — 양식 위에 상태를 한 줄로 알린다.
 * 진행중이면 상태 줄 대신 진행 표기(progressCount)가 나간다.
 */
export const isSettled = (status: string): boolean => status !== '진행중'

/** 참조자 이름을 줄여 적는다 — 앞 몇 명만 보이고 나머지는 「외 N명」. 전체는 부르는 쪽이 title 로 붙인다. */
export function ccSummary(names: string[], max = 3): string {
  if (names.length === 0) return '-'
  if (names.length <= max) return names.join(' · ')
  return `${names.slice(0, max).join(' · ')} 외 ${names.length - max}명`
}
