// 결재 위임의 검증·분류 — 순수 함수만. DB 를 읽지도 쓰지도 않는다(그것은 라우트가 한다).
//
// 판정 로직(누가 대신 결재할 수 있는가)은 lib/approval/engine.ts 에 이미 있고 여기서 건드리지 않는다.
// 이 파일이 답하는 것은 「이 위임을 **등록해도 되는가**」와 「이 위임은 지금 어떤 상태인가」뿐이다.
//
// 날짜는 전부 'YYYY-MM-DD' 문자열이다. 같은 형식끼리는 사전순 비교가 곧 날짜 비교라서
// Date 로 바꾸지 않는다 — engine.ts 의 delegationActive 와 같은 방식이고, 시간대가 끼어들 틈이 없다.
//
// 기간 경계는 **양 끝을 포함한다.** engine.ts 가 `start_date <= 오늘 <= end_date` 를 유효로 보므로
// 겹침 판정도 같은 기준이어야 한다 — 한쪽의 종료일과 다른 쪽의 시작일이 같은 날이면 그 날 하루는
// 두 위임이 모두 유효해져, 어느 것으로 대결했는지가 입력 순서에 좌우된다.

import { DOC_TYPES } from './docTypes'

/** 사유 길이 상한. 결재함 목록에 한 줄로 들어가는 글이라 짧게 묶는다. */
export const REASON_MAX = 200

/** approval_delegations 한 행. 검증에 쓰는 칸만 둔다(created_at 은 판정에 쓰지 않는다). */
export type DelegationRow = {
  delegation_id: number
  owner_id: number
  delegate_id: number
  start_date: string
  end_date: string
  /** null 이면 모든 문서 종류. */
  doc_type: string | null
  reason: string | null
}

/** 등록하려는 위임. 아직 id 가 없다. */
export type DelegationInput = {
  ownerId: number
  delegateId: number
  startDate: string
  endDate: string
  docType: string | null
  reason: string | null
}

/** 화면에 보이는 상태. 기간과 오늘만 보고 정한다. */
export type DelegationStatus = '예정' | '진행 중' | '종료'

const YMD = /^\d{4}-\d{2}-\d{2}$/

export const isYmd = (v: unknown): v is string => typeof v === 'string' && YMD.test(v)

/**
 * 두 기간이 겹치는가 — **양 끝 포함**. 끝나는 날과 시작하는 날이 같아도 겹친 것으로 본다.
 * (그 하루는 두 위임이 모두 유효해 대결 상대가 둘이 된다)
 */
export const rangesOverlap = (aFrom: string, aTo: string, bFrom: string, bTo: string): boolean =>
  aFrom <= bTo && bFrom <= aTo

/**
 * 적용 범위가 겹치는가 — 같은 종류이거나 한쪽이 「전체」(null)면 겹친다.
 * 서로 다른 종류를 지정한 두 위임은 같은 기간에 함께 있어도 부딪히지 않는다.
 */
export const scopesOverlap = (a: string | null, b: string | null): boolean =>
  a === null || b === null || a === b

/** 적용 범위를 사람이 읽는 말로. */
export const scopeLabel = (docType: string | null): string =>
  docType === null ? '전체 문서' : (DOC_TYPES[docType]?.label ?? docType)

/** 기간을 사람이 읽는 말로. */
export const periodLabel = (from: string, to: string): string => `${from} ~ ${to}`

/** 지금 상태. engine.ts 의 delegationActive 와 같은 경계(양 끝 포함)를 쓴다. */
export function delegationStatus(row: { start_date: string; end_date: string }, today: string): DelegationStatus {
  if (row.end_date < today) return '종료'
  if (row.start_date > today) return '예정'
  return '진행 중'
}

/**
 * 같은 위임자의 기존 위임과 부딪히는가. 기간과 적용 범위가 **모두** 겹칠 때만 부딪힌다.
 *
 * 왜 막는가 — 대결은 1단만 본다(engine.ts 의 delegatesOf 는 재귀가 없다). 같은 기간·같은 범위에
 * 대리인이 둘이면 한 줄을 두 사람이 대신 처리할 수 있게 되고, 먼저 누른 쪽이 이긴다.
 * 그 승패는 결재 순서가 아니라 우연이라 기록으로 설명할 수 없다.
 *
 * existing 은 어느 위임자의 행이든 섞여 들어와도 된다 — 여기서 ownerId 로 다시 거른다.
 */
export function findPeriodConflict(input: DelegationInput, existing: DelegationRow[]): DelegationRow | null {
  return existing.find(r =>
    r.owner_id === input.ownerId
    && rangesOverlap(input.startDate, input.endDate, r.start_date, r.end_date)
    && scopesOverlap(input.docType, r.doc_type),
  ) ?? null
}

/**
 * 사슬이 생기는가.
 *
 *   delegate_is_owner — 대리인이 그 기간에 이미 **자기 결재를 남에게 맡기고 있다**(B→C 가 있는데 A→B).
 *                       A 의 문서가 B 에게 가고 B 는 자리에 없으니 아무도 처리하지 못한다.
 *   owner_is_delegate — 위임자가 그 기간에 **남의 대리 결재자다**(C→A 가 있는데 A→B).
 *                       A 가 맡은 C 의 결재까지 B 에게 넘어가는 것처럼 보이지만, 1단만 보는 엔진은
 *                       그렇게 동작하지 않는다. 화면과 실제가 어긋나므로 등록 자체를 막는다.
 *
 * 두 경우 모두 기간과 적용 범위가 함께 겹칠 때만 문제가 된다.
 */
export type ChainProblem = {
  kind: 'delegate_is_owner' | 'owner_is_delegate'
  row: DelegationRow
}

export function findChainProblem(input: DelegationInput, existing: DelegationRow[]): ChainProblem | null {
  const hits = (pick: (r: DelegationRow) => boolean) => existing.find(r =>
    pick(r)
    && rangesOverlap(input.startDate, input.endDate, r.start_date, r.end_date)
    && scopesOverlap(input.docType, r.doc_type),
  ) ?? null

  const asOwner = hits(r => r.owner_id === input.delegateId)
  if (asOwner) return { kind: 'delegate_is_owner', row: asOwner }

  const asDelegate = hits(r => r.delegate_id === input.ownerId)
  if (asDelegate) return { kind: 'owner_is_delegate', row: asDelegate }

  return null
}

/** 검증에 필요한 바깥 사정. 라우트가 DB 에서 읽어 넘긴다. */
export type DelegationContext = {
  /** KST 오늘. */
  today: string
  /** 재직 중인 직원 번호. 대리인이 여기 없으면 거절한다. */
  activeIds: Set<number>
  /** 같은 위임자·사슬 판정에 쓸 기존 위임 전부. */
  existing: DelegationRow[]
  /** 번호 → 「이름 직급」. 거절 메시지에 사람 이름을 넣는 데만 쓴다. */
  nameOf: (engineerId: number) => string
}

/**
 * 등록 전 검증 — 문제가 있으면 사람이 읽을 메시지를, 없으면 null 을 돌려준다.
 * 화면과 서버가 같은 함수를 쓰므로, 화면에서 통과한 것이 등록에서 다시 막히지 않는다
 * (결재선 검증이 validateLineInput 하나를 함께 쓰는 것과 같은 이유다).
 */
export function validateDelegationInput(input: DelegationInput, ctx: DelegationContext): string | null {
  if (!Number.isInteger(input.ownerId) || input.ownerId <= 0) return '위임자가 올바르지 않습니다.'
  if (!Number.isInteger(input.delegateId) || input.delegateId <= 0) return '대리 결재자를 선택해주세요.'
  if (input.delegateId === input.ownerId) return '자기 자신에게 위임할 수 없습니다.'
  if (!ctx.activeIds.has(input.delegateId)) return '퇴사했거나 없는 직원에게는 위임할 수 없습니다.'

  if (!isYmd(input.startDate) || !isYmd(input.endDate)) return '기간을 올바르게 입력해주세요.'
  if (input.startDate > input.endDate) return '시작일이 종료일보다 늦습니다.'
  if (input.endDate < ctx.today) return '종료일이 이미 지났습니다. 오늘 이후로 지정해주세요.'

  if (input.docType !== null && !Object.prototype.hasOwnProperty.call(DOC_TYPES, input.docType)) {
    return '등록되지 않은 문서 종류입니다.'
  }

  if (input.reason !== null && input.reason.length > REASON_MAX) {
    return `사유는 ${REASON_MAX}자까지 쓸 수 있습니다.`
  }

  const clash = findPeriodConflict(input, ctx.existing)
  if (clash) {
    return `이미 ${periodLabel(clash.start_date, clash.end_date)} 기간에 `
      + `${ctx.nameOf(clash.delegate_id)}님께 위임(${scopeLabel(clash.doc_type)})이 있습니다. `
      + '기간이 겹치지 않게 지정하거나 기존 위임을 해제해주세요.'
  }

  const chain = findChainProblem(input, ctx.existing)
  if (chain?.kind === 'delegate_is_owner') {
    return `${ctx.nameOf(input.delegateId)}님이 이 기간에 이미 다른 분께 위임 중이라 대리 결재를 맡길 수 없습니다.`
  }
  if (chain?.kind === 'owner_is_delegate') {
    return `이 기간에 ${ctx.nameOf(chain.row.owner_id)}님의 대리 결재자이므로 위임할 수 없습니다.`
  }

  return null
}
