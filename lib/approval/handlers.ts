// 유형별 실행 함수 표 — 서버 전용.
//
// lib/approval/docTypes.ts 가 「어떤 유형인가」를 적고, 이 파일이 「그 유형이 무엇을 하는가」를 적는다.
// 나눠 둔 이유는 docTypes.ts 머리에 적혀 있다(그 파일은 화면도 읽으므로 서버 전용 코드를 둘 수 없다).
//
// 결재 라우트는 doc_type 으로 이 표를 찾아 부르기만 한다 — if (doc_type === …) 분기는 두지 않는다.
// 새 유형은 docTypes.ts 에 등록 정보를, 이 표에 실행 함수를 더하면 끝이다.

import { beforeCompleteShowroom, onCompleteShowroom, onRevertShowroom } from './showroomUsage'
import { onCompleteQuoteDelete, onRevertQuoteDelete } from './quoteDelete'
import type { OnCompleteContext } from './docTypes'

export type DocTypeHandlers = {
  /**
   * 완료 직전 점검. 사람이 읽을 메시지를 돌려주면 마지막 승인이 막힌다(409).
   * 결재가 도는 동안 바깥 사정이 바뀔 수 있는 유형이 쓴다(쇼룸은 사용 시간 겹침).
   */
  beforeComplete?: (ctx: OnCompleteContext) => Promise<string | null>
  /** 결재가 완료된 순간 실행할 일. */
  onComplete?: (ctx: OnCompleteContext) => Promise<void>
  /**
   * 결재가 완료되지 않고 끝난 순간 할 일 — 반려·회수·폐기 세 경우에 모두 불린다.
   *
   * 셋을 나누지 않는 이유: 원 문서 쪽에서 보면 「결재를 기다리던 상태를 원래대로 돌려놓는다」는
   * 한 가지 일이고, 어떻게 끝났는지는 결재 문서에 이미 남아 있다. 나눠 두면 유형마다 같은 코드를
   * 세 번 쓰게 된다.
   *
   * 폐기는 반려·회수된 문서에만 할 수 있어 이 훅이 두 번 불린다. 여러 번 불려도 탈이 없게
   * (조건부 UPDATE 로) 짜야 한다.
   */
  onRevert?: (ctx: OnCompleteContext) => Promise<void>
}

const HANDLERS: Record<string, DocTypeHandlers> = {
  // 견적서 — 4단계 범위 밖. 6단계에서 채운다.
  quote: {},
  // 쇼룸 사용 신청 — 사전이면 완료 시 사용 기록 생성, 두 경우 모두 승인서에 도장.
  // 회수·폐기로 끝나면 사후 신청이 상신 때 만들어 둔 사용 기록과 승인서 PDF 를 치운다.
  showroom_usage: {
    beforeComplete: beforeCompleteShowroom,
    onComplete: onCompleteShowroom,
    onRevert: onRevertShowroom,
  },
  // 견적 삭제 요청 — 완료 시 실제 삭제, 끝나지 않고 돌아가면 견적 상태를 되돌린다.
  quote_delete: {
    onComplete: onCompleteQuoteDelete,
    onRevert: onRevertQuoteDelete,
  },
}

/** 등록된 실행 함수. 없는 유형이면 빈 표를 돌려줘 라우트가 그냥 넘어간다. */
export function handlersOf(docType: string): DocTypeHandlers {
  return Object.prototype.hasOwnProperty.call(HANDLERS, docType) ? HANDLERS[docType] : {}
}
