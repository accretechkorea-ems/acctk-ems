// 견적서 결재의 식별자와 순수 판정.
//
// 이 파일을 따로 둔 이유는 lib/quoteDeletePolicy.ts 와 같다 — 화면과 서버가 같은 값을 써야 하는데,
// 실행 로직이 있는 lib/approval/quoteApproval.ts 는 service role 을 쓰는 서버 전용 모듈이라
// 화면에서 import 할 수 없다(그 파일 머리말 참고). 값과 판정만 여기로 빼서 양쪽이 함께 읽는다.
//
// **여기에는 import 를 늘리지 마라.** lib/quoteStatus.ts(순수 모듈) 하나만 읽는다 —
// 화면 번들과 서버 라우트가 똑같이 들고 갈 수 있어야 한다.
// (그 파일이 lib/date.ts 를 읽지만 그쪽도 순수 모듈이라 같은 조건을 지킨다.)

import { APPROVAL_STATUS, isApprovalTarget } from '@/lib/quoteStatus'

/** approval_documents.doc_type. 등록표(docTypes.ts)의 열쇠와 같은 값이다. */
export const QUOTE_TYPE = 'quote'

/** approval_documents.target_table. */
export const QUOTE_TARGET_TABLE = 'quotes'

/** 결재가 도는 동안의 견적 상태. 값 자체는 lib/quoteStatus.ts 가 들고 있다. */
export const SUBMITTED_STATUS = APPROVAL_STATUS

/** 되돌릴 값을 읽지 못했을 때의 기본 상태. */
export const DEFAULT_RESTORE_STATUS = '견적중'

/** 국내수리 견적이 시작하는 상태 — 되돌릴 때 이 값도 살린다. */
export const REPAIR_STATUS = '수리중'

/**
 * 결재가 끝난 뒤 돌아갈 상태를 고른다.
 *
 * '수리중' 만 그대로 쓰고 나머지는 전부 '견적중' 으로 접는다. 상신은 그 두 상태에서만 할 수 있으므로
 * 다른 값(결재중 자신·발주 이후 상태·빈 값·모르는 문자열)이 들어왔다면 summary 가 망가진 것이고,
 * 그때 견적을 발주 단계로 되돌리면 실적·회계가 어긋난다. 모르면 가장 앞 단계로 두는 쪽이 안전하다.
 */
export function restoreStatusOf(raw: unknown): string {
  return raw === REPAIR_STATUS ? REPAIR_STATUS : DEFAULT_RESTORE_STATUS
}

// ── 승인 게이트 ─────────────────────────────────────────────────────
//
// 「수주 전환·PDF 열기를 해도 되는 견적인가」를 한 값으로 줄인 것이다.
//
// **상태만 보고 막을 수 없다.** 반려·회수·폐기로 끝난 견적은 상태가 '견적중'(국내수리면 '수리중')
// 으로 돌아오는데(lib/approval/quoteApproval.ts 의 onRevertQuote), 그 견적은 **승인된 적이 없다.**
// 상태로만 가르면 그런 견적이 발주서 등록·PDF 열기로 그대로 빠져나간다.
// 그래서 「완료된 결재 문서가 있는가」를 함께 본다.
//
// 네 값의 뜻
//   exempt     — 결재 도입 전에 만든 견적. 지금까지와 똑같이 모든 동작이 된다.
//   approved   — 결재 대상이고 완료된 문서가 있다. 허용.
//   pending    — 결재가 도는 중('결재중'). 막힘. 고치려면 전자결재에서 회수한다.
//   unapproved — 결재 대상인데 완료 문서가 없고 결재중도 아니다. 막힘.
//                반려·회수·폐기된 뒤이거나, 상신에 실패해 아직 올리지 않은 견적이다.

export type QuoteGate = 'exempt' | 'approved' | 'pending' | 'unapproved'

export type GateInput = {
  /** quotes.created_at (timestamptz 문자열). 도입 경계를 가르는 값이다. */
  createdAt: string | null | undefined
  /** quotes.status */
  status: string | null | undefined
  /** 이 견적에 doc_type 'quote' · 상태 '완료' 인 결재 문서가 있는가. */
  hasCompletedDoc: boolean
}

/**
 * 게이트를 고른다 — 순수 함수다. 서버(잠금)와 화면(버튼 표시)이 같은 답을 쓰도록 여기 하나만 둔다.
 *
 * 순서가 중요하다.
 *   ① 도입 전이면 다른 것을 보지 않는다 — 옛 견적에는 결재 문서가 있을 수 없고, 있어도 뜻이 없다.
 *   ② '결재중' 이 완료 문서보다 앞이다 — 완료된 문서가 있는 견적을 **다시** 올린 경우
 *      (지금 경로로는 막혀 있지만) 지금 도는 결재가 끝나기 전에는 손대지 못하게 해야 한다.
 */
export function gateOf(q: GateInput): QuoteGate {
  if (!isApprovalTarget(q.createdAt)) return 'exempt'
  if (q.status === SUBMITTED_STATUS) return 'pending'
  if (q.hasCompletedDoc) return 'approved'
  return 'unapproved'
}

/** 수주 전환·계산서 요청·PDF 열기를 해도 되는 게이트인가. */
export const gateAllows = (gate: QuoteGate | null | undefined): boolean =>
  gate === 'exempt' || gate === 'approved'

/** 막힌 이유를 사람 말로 — 서버 응답과 화면 안내가 같은 문구를 쓴다. */
export const GATE_BLOCK_MESSAGE =
  '결재가 완료되지 않은 견적입니다. (결재중이면 결재 완료 후, 반려·회수된 견적은 고쳐 쓰기로 새로 작성해 주세요)'

/** PDF 열기가 막혔을 때. */
export const GATE_PDF_MESSAGE = '결재가 완료되면 열 수 있습니다'

/** 화면 보조 안내 — 게이트별로 무엇을 해야 하는지. 허용·미확인은 안내할 것이 없다. */
export function gateNotice(gate: QuoteGate | null | undefined): string | null {
  if (gate === 'pending') return '결재 중입니다. 수정하려면 전자결재에서 회수하세요(아무도 결재하기 전에만 가능)'
  if (gate === 'unapproved') return '결재가 완료되지 않았습니다. 「결재 올리기」 또는 고쳐 쓰기를 사용하세요'
  return null
}
