// 문서 유형 등록표.
//
// 엔진(lib/approval/engine.ts)과 라우트(app/api/approval/route.ts)에는 doc_type 분기가 없다.
// 유형마다 다른 것은 전부 이 파일의 등록 정보(칸)와 실행 함수(onComplete)로만 나타낸다.
// 새 유형을 추가할 때 고치는 파일도 여기 하나다 — 엔진은 그대로 둔다.
//
// 실행 함수(완료 시 할 일·완료 직전 점검)는 lib/approval/handlers.ts 에 있다.
// 왜 나눠 두는가 — 그 함수들은 service role 과 PDF 생성을 쓰는 서버 전용 코드인데, 이 등록표는
// 화면(결재함)도 유형 이름을 읽으려고 import 한다. 한 파일에 두면 지연 import 를 써도
// 서버 전용 모듈이 클라이언트 번들 그래프로 끌려와 빌드가 깨진다(Turbopack 이 dynamic import 도 따라간다).
// 이 파일에는 순수한 값과 판정만 둔다.

import type { ApprovalLine } from './types'

/** 실행 함수가 받는 것. 엔진은 원 테이블을 모르고, 이 값만 넘긴다. */
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
  /** 결재선의 지금 상태. 승인서 도장처럼 누가 어떤 순서로 처리했는지 필요한 유형이 쓴다. */
  lines: ApprovalLine[]
  /**
   * 결재가 **어떻게 끝났는가** — onRevert 에만 들어온다(onComplete·beforeComplete 는 없다).
   *
   * 왜 필요한가: onRevert 는 반려·회수·폐기 세 경우에 모두 불리는데, 유형에 따라 셋이 같은 일이
   * 아니다(견적서는 반려만 '반려' 상태로 남기고 회수·폐기는 상신 직전 상태로 돌린다).
   * 훅이 문서를 다시 읽어 상태를 보게 하지 않는 이유 — runRevert 가 넘기는 문서 값은 **상태를
   * 바꾸기 전에** 읽은 것이라 reject·withdraw 에서는 아직 '진행중' 이다. 라우트가 그 자리에서
   * 아는 사실을 그대로 적어 내려보내는 것이 가장 짧다(왕복도 늘지 않는다).
   *
   * 값이 없으면(옛 호출·알 수 없음) 유형은 **지금까지의 동작**(상태 복원)으로 떨어뜨려야 한다.
   */
  outcome?: '반려' | '회수' | '폐기'
}

/**
 * 그 종류가 요구하는 결재선. 검사는 lib/approval/lineRules.ts 의 checkLineRules 가 한다
 * (엔진은 종류를 모르는 상태로 둔다 — 이 파일 머리 설명과 같은 이유다).
 *
 * **결재가 필요 없어지거나 규칙이 바뀌면 이 칸만 바꾼다.** 칸을 빼면 그 종류는 모양 검사
 * (engine.ts 의 validateLineInput)만 받는다 — 상신 경로·화면은 고치지 않는다.
 */
export type LineRules = {
  /**
   * 결재자(kind='approve')에 'superadmin' 등급이 한 명 이상 있어야 한다.
   * 합의·참조의 관리자는 세지 않고, 상신자 본인이 관리자면 면제된다(checkLineRules 설명 참고).
   */
  requireSuperadminApprover?: boolean
}

/**
 * **종결된 문서(회수·폐기)를 지울 때 어디로 무엇을 보낼지.**
 *
 * 모든 문서 종류에 같은 원칙을 쓴다 — 회수·폐기 문서는 효력이 없고 아무 판단도 담고 있지
 * 않으므로 상신자가 치운다. 반려·완료 문서는 **어느 종류에서도 지우지 않는다**(판단이 남아야 한다).
 *
 * 갈리는 것은 「무엇까지 지우는가」 하나다.
 *   · 견적서 — 원 문서(견적)와 결재 문서를 **함께** 지운다. 업무별 라우트가 견적의 참조·
 *     스토리지·감사까지 치운다.
 *   · 그 밖   — **결재 문서만** 지운다. 대상 데이터는 회수 시점에 훅(onRevert)이 이미 치웠다
 *     (쇼룸의 사용 기록·승인서 PDF, 견적 삭제 요청의 견적 상태 복원).
 *
 * 호출 경로를 여기 적어 두는 이유 — 처리 버튼(components/approval/DocActions.tsx)에 유형 이름을
 * 적지 않으려면 어디로 무엇을 보낼지는 **등록표가** 말해야 한다.
 */
export type ClosedDelete = {
  /** 삭제를 처리할 라우트. */
  endpoint: string
  /** 그 라우트에 보낼 action 값. */
  action: string
  /**
   * 본문에 담을 열쇠 이름과 값의 출처.
   *   'target'   — 문서의 target_id(원 문서 id). 원 문서까지 지우는 종류가 쓴다.
   *   'document' — 문서의 document_id. 결재 문서만 지우는 종류가 쓴다.
   */
  idKey: string
  idFrom: 'target' | 'document'
  /** 본문에 함께 보낼 사유. 적지 않으면 보내지 않는다(범용 삭제는 사유를 받지 않는다). */
  reason?: string
  /** 2단 확인에서 보여 줄 문구. */
  confirmText: string
  /** 반려 문서에 버튼이 없는 이유. 적지 않으면 안내를 띄우지 않는다(재작성이 남아 있는 종류). */
  rejectedNotice?: string
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
  /**
   * 문서 하나만 놓고 반려 가능 여부를 다시 본다. canReject 가 true 인 유형에서만 불린다.
   * 유형은 같은데 문서마다 갈려야 하는 경우를 위한 칸이다 — approval_documents 에 컬럼을 늘리지
   * 않고 summary 로 판정한다. 지금 이 칸을 쓰는 유형은 없다.
   */
  canRejectDoc?: (summary: Record<string, unknown>) => boolean
  /**
   * 승인 버튼에 쓸 말. 적지 않으면 「승인」이다.
   * 쇼룸 사후 신청은 **이미 끝난 사용**을 승인하는 것이 아니라 맞는지 「확인」하는 자리다.
   * 반려는 할 수 있다(내용이 틀렸으면 상신자가 고쳐 다시 올려야 한다) — 그래서 반려 가능 여부와
   * 버튼 이름은 **따로** 둔다. 예전에는 둘을 canRejectDoc 하나로 묶어, 이름을 「확인」으로 두려면
   * 반려까지 막혔다.
   */
  approveLabel?: (summary: Record<string, unknown>) => string
  /**
   * 결재선 규칙. 없으면 종류별 요구가 없다는 뜻이다(모양 검사만 받는다).
   * **결재가 필요 없어지거나 규칙이 바뀌면 이 칸만 바꾼다.**
   */
  lineRules?: LineRules
  /**
   * 반려·회수된 문서를 같은 문서로 다시 올릴 수 있는가. 적지 않으면 true(지금까지의 동작).
   *
   * 견적서만 false 다 — 반려된 견적은 내용을 고쳐야 다시 올릴 수 있는데, 견적에는 같은 행을
   * 고치는 경로가 없고(「다시쓰기」가 새 번호로 새 견적을 만든다) 문서번호는 견적번호를 따른다.
   * 같은 문서를 다시 돌리면 고쳐지지 않은 내용이 그대로 올라가고 번호도 어긋난다.
   */
  canResubmit?: boolean
/**
   * 종결된 문서(회수·폐기)를 어떻게 지우는가. 적지 않으면 못 지운다.
   * **반려·완료 문서는 어느 유형에서도 지우지 않는다** — 그 판단은 기결함에 남아야 한다.
   */
  deleteWhenClosed?: ClosedDelete
}

/** 같은 문서로 다시 올릴 수 있는 유형인가. 칸이 없으면 지금까지처럼 허용이다. */
export const canResubmitDocument = (def: DocTypeDef): boolean => def.canResubmit !== false

/**
 * 이 문서를 반려할 수 있는가 — 유형의 canReject 와 문서 단위 판정(canRejectDoc)을 함께 본다.
 * 라우트와 화면이 같은 답을 쓰도록 여기 하나만 둔다.
 */
export function canRejectDocument(def: DocTypeDef, summary: Record<string, unknown> | null | undefined): boolean {
  if (!def.canReject) return false
  return def.canRejectDoc ? def.canRejectDoc(summary ?? {}) : true
}

/** 기본 승인 버튼 이름. */
export const APPROVE_LABEL = '승인'

/** 이 문서의 승인 버튼에 쓸 말. 유형이 적어 두지 않으면 「승인」이다. */
export function approveLabelOf(def: DocTypeDef, summary: Record<string, unknown> | null | undefined): string {
  return def.approveLabel ? def.approveLabel(summary ?? {}) : APPROVE_LABEL
}

/** 쇼룸 요약에서 사후 신청인지 읽는다. 위 칸과 payload 둘 다 본다(옛 문서는 한쪽만 있다). */
const showroomRetroactive = (summary: Record<string, unknown>): boolean => {
  const s = summary as { is_retroactive?: unknown; payload?: { is_retroactive?: unknown } } | null
  return s?.is_retroactive === true || s?.payload?.is_retroactive === true
}

export const DOC_TYPES: Record<string, DocTypeDef> = {
  // 견적서 — 완료 시 견적 확정·PDF 생성 (4단계)
  quote: {
    key: 'quote',
    label: '견적서',
    canReject: true,
    canCancelAfterComplete: false,   // 완료 시 PDF 가 만들어져 되돌릴 수 없다
    lineRules: { requireSuperadminApprover: true },
    // 반려된 견적은 「다시쓰기」로 새 번호의 새 견적을 써서 새로 상신한다(위 canResubmit 설명).
    canResubmit: false,
    // 회수·폐기된 견적서 문서는 **견적과 함께** 지운다. 그 문서만 남으면 가리킬 견적이 없는
    // 문서가 결재함에 쌓이고, 견적 쪽에서는 「결재 문서가 있다」는 이유로 다시 올릴 수도 없다.
    // 반려·완료 문서는 지우지 않는다 — 라우트의 selfDeleteVerdict 가 409 로 막는다.
    deleteWhenClosed: {
      endpoint: '/api/quote-delete',
      action: 'self',
      idKey: 'quoteId',
      idFrom: 'target',
      reason: '결재 회수 후 작성자 삭제',
      confirmText: '견적과 결재 문서가 모두 삭제되며 되돌릴 수 없습니다',
      // 견적서는 재작성도 없어 반려 문서에 버튼이 하나도 남지 않는다 — 왜 없는지 적어 준다.
      rejectedNotice: '반려된 문서는 기록으로 남습니다. 반려된 견적은 지울 수 없고 「다시쓰기」로 새로 작성합니다',
    },
  },
  // 쇼룸 사용 신청 — 실행 함수는 lib/approval/showroomUsage.ts (handlers.ts 가 묶는다).
  showroom_usage: {
    key: 'showroom_usage',
    label: '쇼룸 사용 신청',
    canReject: true,
    canCancelAfterComplete: true,    // 사용 기록은 취소할 수 있다
    lineRules: { requireSuperadminApprover: true },
    // 사후 신청도 **반려할 수 있다**(canRejectDoc 을 두지 않는다). 이미 끝난 사용이라 「없던 일」로
    // 만들 수는 없지만, 적힌 내용이 틀렸으면 결재자가 돌려보내야 한다. 반려되면 상신 때 만들어 둔
    // 사용 기록을 치우고(lib/approval/showroomUsage.ts 의 onRevertShowroom — 회수·폐기와 같은 길),
    // 상신자가 「재작성」으로 고쳐 다시 올린다(기록은 그때 다시 만들어진다).
    // 버튼 이름만 「확인」으로 둔다 — 승인이 아니라 사실 확인이기 때문이다.
    approveLabel: summary => (showroomRetroactive(summary) ? '확인' : APPROVE_LABEL),
    // 회수·폐기된 문서는 **문서만** 지운다. 사용 기록·승인서 PDF 는 회수 시점에
    // onRevertShowroom 이 이미 치웠으므로 여기서 더 할 일이 없다.
    deleteWhenClosed: {
      endpoint: '/api/approval',
      action: 'delete',
      idKey: 'documentId',
      idFrom: 'document',
      confirmText: '결재 문서가 삭제되며 되돌릴 수 없습니다',
    },
  },
  // 견적 삭제 요청 — 완료 시 실제 삭제 (6단계)
  quote_delete: {
    key: 'quote_delete',
    label: '견적 삭제 요청',
    canReject: true,
    canCancelAfterComplete: false,   // 지워진 견적은 되돌릴 수 없다
    lineRules: { requireSuperadminApprover: true },
    // 회수·폐기된 문서는 **문서만** 지운다. 견적 상태는 회수 시점에 onRevertQuoteDelete 가
    // 이미 '취소요청' 에서 풀어 놓았다.
    deleteWhenClosed: {
      endpoint: '/api/approval',
      action: 'delete',
      idKey: 'documentId',
      idFrom: 'document',
      confirmText: '결재 문서가 삭제되며 되돌릴 수 없습니다',
    },
  },
}

export const DOC_TYPE_KEYS: string[] = Object.keys(DOC_TYPES)

/** 등록되지 않은 유형은 null. 라우트가 400 으로 막는다. */
export function docTypeOf(key: unknown): DocTypeDef | null {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(DOC_TYPES, key)
    ? DOC_TYPES[key]
    : null
}
