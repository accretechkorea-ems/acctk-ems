// 유형별 실행 함수 표 — 서버 전용.
//
// lib/approval/docTypes.ts 가 「어떤 유형인가」를 적고, 이 파일이 「그 유형이 무엇을 하는가」를 적는다.
// 나눠 둔 이유는 docTypes.ts 머리에 적혀 있다(그 파일은 화면도 읽으므로 서버 전용 코드를 둘 수 없다).
//
// 결재 라우트는 doc_type 으로 이 표를 찾아 부르기만 한다 — if (doc_type === …) 분기는 두지 않는다.
// 새 유형은 docTypes.ts 에 등록 정보를, 이 표에 실행 함수를 더하면 끝이다.

import { beforeCompleteShowroom, onCompleteShowroom } from './showroomUsage'
import type { OnCompleteContext } from './docTypes'

export type DocTypeHandlers = {
  /**
   * 완료 직전 점검. 사람이 읽을 메시지를 돌려주면 마지막 승인이 막힌다(409).
   * 결재가 도는 동안 바깥 사정이 바뀔 수 있는 유형이 쓴다(쇼룸은 사용 시간 겹침).
   */
  beforeComplete?: (ctx: OnCompleteContext) => Promise<string | null>
  /** 결재가 완료된 순간 실행할 일. */
  onComplete?: (ctx: OnCompleteContext) => Promise<void>
}

const HANDLERS: Record<string, DocTypeHandlers> = {
  // 견적서 — 4단계 범위 밖. 6단계에서 채운다.
  quote: {},
  // 쇼룸 사용 신청 — 사전이면 완료 시 사용 기록 생성, 두 경우 모두 승인서에 도장.
  showroom_usage: {
    beforeComplete: beforeCompleteShowroom,
    onComplete: onCompleteShowroom,
  },
  // 견적 삭제 요청 — 5단계에서 채운다.
  quote_delete: {},
}

/** 등록된 실행 함수. 없는 유형이면 빈 표를 돌려줘 라우트가 그냥 넘어간다. */
export function handlersOf(docType: string): DocTypeHandlers {
  return Object.prototype.hasOwnProperty.call(HANDLERS, docType) ? HANDLERS[docType] : {}
}
