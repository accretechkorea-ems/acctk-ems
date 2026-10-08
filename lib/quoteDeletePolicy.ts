// 견적 삭제가 결재를 거쳐야 하는지 가르는 기준. 순수한 값과 판정만 둔다.
//
// 이 파일을 따로 둔 이유는 하나다 — 화면과 서버가 같은 답을 써야 하는데,
// 실행 로직이 있는 lib/approval/quoteDelete.ts 는 service role 을 쓰는 서버 전용 모듈이라
// 화면에서 import 할 수 없다(그 파일 머리말 참고). 기준만 여기로 빼서 양쪽이 함께 읽는다.
//
// 판정을 두 벌로 만들지 마라. 화면이 버튼을 고르는 기준과 라우트가 허용 여부를 막는 기준이
// 갈리면, 화면에는 「삭제」가 보이는데 눌러 보면 거부되는 상태가 된다.
//
// **최종 권한은 서버다.** 화면은 결재 문서 이력을 게이트 응답으로 받아 쓰지만(작성자 건에만
// 담겨 온다), 라우트는 그 값을 믿지 않고 자기가 다시 읽어 같은 함수에 넣는다.

import type { QuoteGate } from '@/lib/approval/quoteApprovalKeys'
import { REJECTED_STATUS } from '@/lib/quoteStatus'

/**
 * 결재 없이 본인이 바로 지울 수 있는 상태 — **결재 문서가 없는 견적**의 기준이다.
 *
 * 아직 수주로 이어지지 않아 실적에 금액이 잡히지 않은 건이다 — 잘못 쓴 견적, 중복 작성,
 * 고객이 품목을 바꿔 달라 해서 다시 쓴 견적처럼 자주 생긴다. 이런 것까지 결재를 올리면
 * 결재가 도는 동안 견적을 못 보낸다.
 *
 * 나머지는 전부 결재를 거친다.
 *   · 발주(주문 대기)·주문완료·세금계산서 요청·매출완료 — 실적에 잡혔고 회계와 얽혀 있다.
 *   · 수리중·보류·수주(옛 값) — 목록에 없으므로 결재로 간다. 실적·회계와 얽혔는지
 *     한눈에 판단하기 어려운 값이라 엄격한 쪽을 기본으로 둔다.
 *   · 취소요청 — 이미 결재가 도는 중이라 어느 쪽으로도 새로 시작할 수 없다.
 *   · 반려 — **어느 경로로도 지울 수 없다**(아래 requestDeleteVerdict).
 */
export const SELF_DELETABLE_STATUSES: readonly string[] = ['견적중', '실패']

/** 결재 없이 바로 지울 수 있는 상태인가 — **상태만** 보는 옛 판정. */
export const isSelfDeletable = (status: string | null | undefined): boolean =>
  !!status && SELF_DELETABLE_STATUSES.includes(status)

/**
 * 결재 문서를 함께 지우면서 견적을 지울 수 있는 상태.
 *
 * 회수·폐기된 문서만 있는 견적이 여기 해당한다. 상신 전과 사실상 같은 자리이므로
 * 상신할 수 있는 상태(견적중·수리중)를 넣고, 여기에 '실패'(미수주)를 더한다 —
 * 상신했다가 회수한 견적이 유효기간이 지나 자동 실주되면 '실패' 가 되는데, 그때까지
 * 실적에 금액이 잡힌 적이 없으므로 문서 없는 견적의 규칙(SELF_DELETABLE_STATUSES)과 같다.
 * 그 뒤 단계(발주 이후)로 넘어간 견적은 실적·회계와 얽혀 결재를 거쳐야 한다.
 */
export const CLOSED_DELETABLE_STATUSES: readonly string[] = ['견적중', '수리중', '실패']

// ── 결재 문서 이력 분류 ──────────────────────────────────────────────
//
// 견적 하나에 붙은 결재 문서(doc_type 'quote')들의 상태를 **한 값으로 접는다.**
// 견적서 문서는 견적당 하나다(상신 라우트가 어떤 상태로든 기존 문서가 있으면 409 —
// app/api/quote-approval/route.ts). 그래도 여러 건일 수 있다는 전제로 접는다:
// **가장 엄한 쪽이 이긴다.** 하나라도 진행중·반려·완료가 있으면 삭제할 수 없다.

export type DocHistory =
  /** 결재 문서가 없다 — 상신하지 않았거나 상신이 실패했다. */
  | 'none'
  /** 회수 또는 폐기된 문서만 있다. 효력이 없는 문서라 견적과 함께 지울 수 있다. */
  | 'withdrawn_or_discarded'
  /** 결재가 도는 중이다. 먼저 회수해야 한다. */
  | 'in_progress'
  /** 반려로 끝났다. 기록을 보존한다 — 삭제 요청만. */
  | 'rejected'
  /** 승인으로 끝났다. 기록을 보존한다 — 삭제 요청만. */
  | 'completed'

/** 엄한 순서(앞이 더 엄하다). 여러 문서가 섞여 있으면 이 순서로 고른다. */
const STRICT_ORDER: DocHistory[] = ['completed', 'rejected', 'in_progress', 'withdrawn_or_discarded', 'none']

/**
 * 결재 문서 상태 목록 → 한 분류.
 *
 * 모르는 문자열('임시저장' 이나 깨진 값)은 **'in_progress' 로 본다** — 끝나지 않은 문서로
 * 취급하는 쪽이 안전하다. 지워 놓고 「문서가 남아 있었다」를 되돌릴 방법이 없다.
 */
export function docHistoryOf(statuses: readonly (string | null | undefined)[]): DocHistory {
  const found = new Set<DocHistory>()
  for (const raw of statuses) {
    const s = (raw ?? '').trim()
    if (s === '') continue
    if (s === '완료') found.add('completed')
    else if (s === '반려') found.add('rejected')
    else if (s === '회수' || s === '폐기') found.add('withdrawn_or_discarded')
    else found.add('in_progress')   // '진행중' 과 모르는 값
  }
  if (found.size === 0) return 'none'
  return STRICT_ORDER.find(v => found.has(v)) ?? 'in_progress'
}

// ── 삭제 요청(결재) 판정 ─────────────────────────────────────────────
//
// **반려된 견적은 어떤 경로로도 지울 수 없다.** 본인 삭제도, 삭제 요청도, 관리자도 같다.
//
// 왜 — 견적서 품의서의 반려 사유는 「무엇을 왜 돌려보냈는가」인데, 그 사유를 이해할 근거
// (품목·이익률·대리점·금액)는 견적 쪽에만 있다. 견적을 지우면 반려 기록이 남아 있어도
// 읽을 수 없는 기록이 된다. 반려 견적에서 할 수 있는 일은 「다시쓰기」와 PDF 열람뿐이다.
//
// 승인(완료)된 견적은 지금처럼 삭제 요청(관리자 승인)으로 지운다 — 그쪽은 승인 기록이
// 결재 문서만으로 뜻이 통한다(무엇을 승인했는지는 결재 문서의 요약·검토표에 복사돼 있다).

/** 반려 견적을 지우려 할 때의 안내 — 서버 응답과 화면이 같은 문구를 쓴다. */
export const REJECTED_DELETE_MESSAGE =
  '반려된 견적은 반려 기록 보존을 위해 삭제할 수 없습니다. 다시쓰기로 새로 작성해 주세요'

export type RequestDeleteVerdict =
  | { ok: true }
  | { ok: false; block: 'rejected'; message: string }

/**
 * 삭제 요청(결재)을 올릴 수 있는가 — 화면과 서버가 함께 쓴다.
 *
 * 막는 것은 **반려 하나**다. 그 밖의 제약(결재 중·권한·사유)은 지금까지처럼 다른 곳이 본다
 * (화면의 isPendingRow·updateQuoteStatus 의 조건부 UPDATE·라우트의 소유자 판정).
 *
 * docs 가 null 이면 **막지 않는다** — 남의 견적이라 이력이 담겨 오지 않은 경우이고,
 * 관리자는 그 견적의 삭제 요청을 올릴 수 있어야 한다. 서버가 자기가 읽은 값으로 다시 본다.
 *
 * 상태와 문서 이력을 **둘 다** 보는 이유: 새 코드는 반려를 quotes.status 에 남기지만,
 * 그 전에 반려된 견적은 상태가 '견적중' 으로 돌아가 있고 문서만 '반려' 다. 또 화면이 상태를
 * '취소요청' 으로 바꾼 뒤 라우트를 부르므로(견적 삭제 요청 흐름) 서버에는 상태가 이미 '취소요청' 이다
 * — 그때 반려를 알아볼 수 있는 것은 문서 이력뿐이다.
 */
export function requestDeleteVerdict(input: {
  status: string | null | undefined
  docs: DocHistory | null | undefined
}): RequestDeleteVerdict {
  if (input.status === REJECTED_STATUS || input.docs === 'rejected') {
    return { ok: false, block: 'rejected', message: REJECTED_DELETE_MESSAGE }
  }
  return { ok: true }
}

// ── 본인 삭제 판정 ───────────────────────────────────────────────────

export type SelfDeleteInput = {
  /** quotes.status */
  status: string | null | undefined
  /**
   * 승인 게이트. 'exempt' 면 결재 도입 전 견적이라 문서가 있을 수 없다.
   * **null 은 「아직 모른다」**다 — 화면이 게이트를 못 읽은 경우이고, 그때는 삭제를 감춘다.
   */
  gate: QuoteGate | null | undefined
  /** 이 견적의 결재 문서 이력. 화면은 게이트 응답으로 받고, 서버는 스스로 읽는다. */
  docs: DocHistory | null | undefined
}

/** 왜 막혔는지 — 화면 문구와 서버 응답이 같은 말을 쓰도록 사유를 값으로 돌려준다. */
export type SelfDeleteBlock =
  /** 결재가 도는 중이다. 먼저 회수한다. */
  | 'pending'
  /** 승인(완료)된 견적이다. 삭제 요청으로만 지운다. */
  | 'approval'
  /** 반려된 견적이다. **어떤 경로로도 지울 수 없다**(requestDeleteVerdict 와 같은 뜻). */
  | 'rejected'
  /** 그 상태에서는 본인이 지울 수 없다(수주 이후 등). 삭제 요청으로 간다. */
  | 'status'
  /**
   * 결재 문서 이력을 모른다 — 판정할 수 없다(화면 전용).
   * 표를 아직 못 읽었거나, 남의 견적이라 이력이 담겨 오지 않은 경우다.
   * 어느 쪽이든 **직접 삭제는 열지 않는다** — 화면은 삭제 요청 경로로 흘린다.
   */
  | 'unknown'

export type SelfDeleteVerdict =
  | { ok: true; /** 함께 지울 결재 문서가 있는가(회수·폐기 문서). */ withDocuments: boolean }
  | { ok: false; block: SelfDeleteBlock; message: string }

/** 막힌 이유별 안내 — 화면과 서버가 같은 문구를 쓴다. */
export const SELF_DELETE_MESSAGES: Record<SelfDeleteBlock, string> = {
  pending: '결재가 진행 중입니다. 전자결재에서 회수한 뒤 삭제할 수 있습니다',
  approval: '승인된 견적은 삭제 요청으로 지울 수 있습니다',
  rejected: REJECTED_DELETE_MESSAGE,
  status: '지금 상태에서는 직접 삭제할 수 없습니다. 삭제 요청으로 지워 주세요',
  unknown: '결재 상태를 확인할 수 없습니다.',
}

/**
 * 본인이 결재 없이 이 견적을 지울 수 있는가 — **화면 두 곳과 서버가 함께 쓰는 단 하나의 판정.**
 *
 * 순서가 규칙이다.
 *   ① 결재 중      — 상태가 '결재중' 이거나 진행중 문서가 있으면 막는다. 먼저 회수한다.
 *   ②-1 반려      — **어떤 경로로도 지울 수 없다**(block 'rejected'). 기록을 읽을 수 있게 남긴다.
 *   ②-2 완료      — 삭제 요청(관리자 승인)으로만 지운다.
 *                    승인 뒤 상태가 '견적중' 으로 돌아와도 여기서 막힌다(옛 구멍).
 *   ③ 회수·폐기    — 지울 수 있다. 견적과 결재 문서를 함께 지운다(withDocuments).
 *                    단 상신할 수 있던 자리(견적중·수리중)에 있을 때만 — 그 뒤로 넘어갔으면
 *                    실적·회계와 얽혀 결재를 거친다.
 *   ④ 문서 없음    — 지금까지의 규칙 그대로(견적중·실패). 결재 도입 전 견적도 여기로 온다
 *                    (문서가 있을 수 없다).
 *
 * docs 가 null 이면 'unknown' 으로 막는다 — 모르는 상태에서 삭제를 열면 반려·승인된 견적이
 * 빠져나간다. 서버는 늘 자기가 읽은 값을 넣으므로 null 이 오지 않는다.
 */
export function selfDeleteVerdict(input: SelfDeleteInput): SelfDeleteVerdict {
  const block = (b: SelfDeleteBlock): SelfDeleteVerdict =>
    ({ ok: false, block: b, message: SELF_DELETE_MESSAGES[b] })

  // 결재 도입 전 견적 — 결재 문서가 있을 수 없다. 이력을 못 읽었더라도 옛 규칙으로 판정한다.
  if (input.gate === 'exempt') {
    return isSelfDeletable(input.status) ? { ok: true, withDocuments: false } : block('status')
  }

  if (input.docs == null) return block('unknown')

  if (input.gate === 'pending' || input.docs === 'in_progress') return block('pending')
  // 반려는 완료보다 **먼저** 본다 — 둘은 막는 이유와 안내가 다르다(반려는 삭제 요청도 못 한다).
  // 견적 상태가 '반려' 면 문서가 뒤에 폐기됐더라도 막는다.
  if (input.docs === 'rejected' || input.status === REJECTED_STATUS) return block('rejected')
  if (input.docs === 'completed') return block('approval')

  if (input.docs === 'withdrawn_or_discarded') {
    return input.status != null && CLOSED_DELETABLE_STATUSES.includes(input.status)
      ? { ok: true, withDocuments: true }
      : block('status')
  }

  // docs === 'none' — 상신하지 않았거나 상신이 실패했다.
  return isSelfDeletable(input.status) ? { ok: true, withDocuments: false } : block('status')
}
