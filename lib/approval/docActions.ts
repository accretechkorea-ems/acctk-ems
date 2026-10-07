// 「이 문서로 지금 무엇을 할 수 있는가」 — 순수 판정만 둔다(DB·React 없음).
//
// 왜 모았는가. 이 규칙은 세 곳에 흩어져 있었다.
//   ① 결재함 목록 — 어느 함에 들어왔는지로 갈랐다. 미결함(inbox)에 들어온 문서면 내 차례이고
//      (라우트가 actorFor 로 걸러 준다), 상신함(outbox)이면 내가 올린 문서다.
//      components/approval/DocDetail.tsx 가 그 `box` 값으로 버튼을 그렸다.
//   ② 결재 라우트의 가드 — withdraw·discard·resubmit 이 각자 requester_id·상태·유형을 다시 본다
//      (app/api/approval/route.ts). 그쪽이 최종 권한이고, 이 파일은 그 판정을 **복제하지 않는다** —
//      같은 조각(untouched·DISCARDABLE_STATUSES·canResubmitDocument)을 불러 쓴다.
//   ③ 새 문서 화면 — 함이 없다. 주소로 바로 들어오므로 「내 차례인가」를 스스로 알아야 한다.
//
// 그래서 ③ 을 위해 조각을 묶은 함수를 여기 두고, 처리 버튼을 그리는 컴포넌트
// (components/approval/DocActions.tsx)가 목록·새 화면에서 **같은 함수**를 쓴다.
// 목록 라우트(/api/approval)의 동작은 손대지 않았다 — 그쪽은 이미 같은 결론을 낸다.

import { actorFor, nextPendingLine, untouched } from './engine'
import { canResubmitDocument, docTypeOf } from './docTypes'
import { DISCARDABLE_STATUSES, type ApprovalLine, type Delegation } from './types'

/** 판정에 필요한 문서 값만. 목록·라우트의 문서 객체를 그대로 넘기면 된다. */
export type ActionDoc = {
  doc_type: string
  status: string
  requester_id: number
  approval_lines: ApprovalLine[]
}

/** 상신자가 할 수 있는 일. */
export type OwnerActions = {
  /** 회수 — 아직 아무도 손대지 않은 진행중 문서만. */
  withdraw: boolean
  /** 재작성 — 반려·회수된 문서, 그리고 같은 문서로 다시 올릴 수 있는 유형만. */
  resubmit: boolean
  /** 폐기 — 반려·회수된 문서. */
  discard: boolean
}

/**
 * 상신자 자격으로 할 수 있는 일.
 *
 * **내가 상신자인지는 보지 않는다** — 부르는 쪽이 그것을 먼저 가른다. 목록의 상신함은 애초에
 * 내 문서만 담고 있고(라우트가 requester_id 로 거른다), 새 화면은 isOwner 를 따로 받는다.
 * 그래서 이 함수는 상태·결재선·유형만 본다 — 종전 DocDetail 의 `box === 'outbox'` 블록 안에서
 * 보던 것과 **같은 조건**이다.
 */
export function ownerActions(doc: ActionDoc): OwnerActions {
  const discardable = (DISCARDABLE_STATUSES as string[]).includes(doc.status)
  const def = docTypeOf(doc.doc_type)
  return {
    withdraw: doc.status === '진행중' && untouched(doc.approval_lines),
    // 유형이 재상신을 허용하지 않으면(견적서) 버튼을 그리지 않는다 — 그려 두면 눌러서 400 을 받는다.
    resubmit: discardable && (def ? canResubmitDocument(def) : true),
    discard: discardable,
  }
}

/** 결재자 자격 — 지금 내 차례인가. */
export type TurnResult = {
  /** 승인·반려를 누를 수 있는가. */
  canAct: boolean
  /** 위임받아 남의 차례를 처리하는가(기록에 「대결」로 남는다). */
  asDelegate: boolean
  /** 지금 차례인 줄. 없으면 처리할 차례가 남지 않았다. */
  line: ApprovalLine | null
}

/**
 * 지금 내 차례인가 — **결재함 미결함(inbox)이 쓰는 그 판정이다.**
 * 라우트(app/api/approval/route.ts 의 box='inbox')가 `actorFor(nextPendingLine(lines), …)` 로
 * 거르는 것과 같은 식이고, 여기서는 그 두 함수를 그대로 불러 쓴다(식을 베끼지 않는다).
 *
 * 위임 목록은 부르는 쪽이 읽어 넘긴다 — 이 파일은 DB 를 모른다.
 */
export function turnOf(
  doc: ActionDoc,
  myId: number,
  delegations: Delegation[],
  today: string,
): TurnResult {
  if (doc.status !== '진행중') return { canAct: false, asDelegate: false, line: null }
  const line = nextPendingLine(doc.approval_lines)
  if (!line) return { canAct: false, asDelegate: false, line: null }
  const act = actorFor(line, myId, delegations, today, doc.doc_type)
  return { canAct: act.ok, asDelegate: act.ok && act.asDelegate, line }
}
