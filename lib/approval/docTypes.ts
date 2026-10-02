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
   * 유형은 같은데 문서마다 갈리는 경우가 있다 — 쇼룸 사후 신청은 이미 끝난 사용을 「확인」만 하므로
   * 반려할 것이 없다. 그 판정을 approval_documents 에 컬럼을 늘리지 않고 summary 로 한다.
   */
  canRejectDoc?: (summary: Record<string, unknown>) => boolean
  /**
   * 결재선 규칙. 없으면 종류별 요구가 없다는 뜻이다(모양 검사만 받는다).
   * **결재가 필요 없어지거나 규칙이 바뀌면 이 칸만 바꾼다.**
   */
  lineRules?: LineRules
}

/**
 * 이 문서를 반려할 수 있는가 — 유형의 canReject 와 문서 단위 판정(canRejectDoc)을 함께 본다.
 * 라우트와 화면이 같은 답을 쓰도록 여기 하나만 둔다.
 */
export function canRejectDocument(def: DocTypeDef, summary: Record<string, unknown> | null | undefined): boolean {
  if (!def.canReject) return false
  return def.canRejectDoc ? def.canRejectDoc(summary ?? {}) : true
}

export const DOC_TYPES: Record<string, DocTypeDef> = {
  // 견적서 — 완료 시 견적 확정·PDF 생성 (4단계)
  quote: {
    key: 'quote',
    label: '견적서',
    canReject: true,
    canCancelAfterComplete: false,   // 완료 시 PDF 가 만들어져 되돌릴 수 없다
    lineRules: { requireSuperadminApprover: true },
  },
  // 쇼룸 사용 신청 — 실행 함수는 lib/approval/showroomUsage.ts (handlers.ts 가 묶는다).
  showroom_usage: {
    key: 'showroom_usage',
    label: '쇼룸 사용 신청',
    canReject: true,
    canCancelAfterComplete: true,    // 사용 기록은 취소할 수 있다
    lineRules: { requireSuperadminApprover: true },
    // 사후 신청은 이미 끝난 사용을 「확인」만 한다 — 반려할 것이 없다.
    canRejectDoc: summary => {
      const s = summary as { is_retroactive?: unknown; payload?: { is_retroactive?: unknown } } | null
      return !(s?.is_retroactive === true || s?.payload?.is_retroactive === true)
    },
  },
  // 견적 삭제 요청 — 완료 시 실제 삭제 (6단계)
  quote_delete: {
    key: 'quote_delete',
    label: '견적 삭제 요청',
    canReject: true,
    canCancelAfterComplete: false,   // 지워진 견적은 되돌릴 수 없다
    lineRules: { requireSuperadminApprover: true },
  },
}

export const DOC_TYPE_KEYS: string[] = Object.keys(DOC_TYPES)

/** 등록되지 않은 유형은 null. 라우트가 400 으로 막는다. */
export function docTypeOf(key: unknown): DocTypeDef | null {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(DOC_TYPES, key)
    ? DOC_TYPES[key]
    : null
}
