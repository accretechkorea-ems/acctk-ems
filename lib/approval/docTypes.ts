// 문서 유형 등록표.
//
// 엔진(lib/approval/engine.ts)과 라우트(app/api/approval/route.ts)에는 doc_type 분기가 없다.
// 유형마다 다른 것은 전부 이 파일의 등록 정보(칸)와 실행 함수(onComplete)로만 나타낸다.
// 새 유형을 추가할 때 고치는 파일도 여기 하나다 — 엔진은 그대로 둔다.
//
// 2단계에서는 자리만 만든다. onComplete 는 빈 함수이고, 유형별 실행은
//   견적 4단계 · 쇼룸 5단계 · 견적 삭제 6단계
// 에서 이 파일의 해당 함수만 채운다.

/** 결재가 끝났을 때 실행 함수가 받는 것. 엔진은 원 테이블을 모르고, 이 값만 넘긴다. */
export type OnCompleteContext = {
  documentId: number
  docNo: string
  targetTable: string
  targetId: number | null
  /** 상신 때 받아 둔 요약. 엔진이 원 테이블을 읽지 않기 위한 값이다. */
  summary: Record<string, unknown>
  requesterId: number
  /** 마지막으로 승인한 사람(전결이면 전결한 사람). */
  actorId: number
}

export type DocTypeDef = {
  /** approval_documents.doc_type 에 저장되는 값. */
  key: string
  /** 화면·알림에 쓰는 이름. */
  label: string
  /** 반려할 수 있는 유형인가. false 면 reject 를 400 으로 막는다. */
  canReject: boolean
  /** 완료 뒤 취소할 수 있는 유형인가(취소는 superadmin 만, 화면은 뒤 단계). */
  canCancelAfterComplete: boolean
  /** 결재가 완료된 순간 실행할 일. 2단계에서는 전부 빈 함수다. */
  onComplete: (ctx: OnCompleteContext) => Promise<void>
}

/** 아무 일도 하지 않는 실행 함수. 뒤 단계에서 유형별로 갈아 끼운다. */
const noop = async (): Promise<void> => {}

export const DOC_TYPES: Record<string, DocTypeDef> = {
  // 견적서 — 완료 시 견적 확정·PDF 생성 (4단계)
  quote: {
    key: 'quote',
    label: '견적서',
    canReject: true,
    canCancelAfterComplete: false,   // 완료 시 PDF 가 만들어져 되돌릴 수 없다
    onComplete: noop,
  },
  // 쇼룸 사용 신청 — 완료 시 사용 기록 생성·승인서 PDF 갱신 (5단계)
  showroom_usage: {
    key: 'showroom_usage',
    label: '쇼룸 사용 신청',
    canReject: true,
    canCancelAfterComplete: true,    // 사용 기록은 취소할 수 있다
    onComplete: noop,
  },
  // 견적 삭제 요청 — 완료 시 실제 삭제 (6단계)
  quote_delete: {
    key: 'quote_delete',
    label: '견적 삭제 요청',
    canReject: true,
    canCancelAfterComplete: false,   // 지워진 견적은 되돌릴 수 없다
    onComplete: noop,
  },
}

export const DOC_TYPE_KEYS: string[] = Object.keys(DOC_TYPES)

/** 등록되지 않은 유형은 null. 라우트가 400 으로 막는다. */
export function docTypeOf(key: unknown): DocTypeDef | null {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(DOC_TYPES, key)
    ? DOC_TYPES[key]
    : null
}
