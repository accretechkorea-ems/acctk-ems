// 「팀으로 참조 추가」의 판정 — 순수 함수만 둔다(DB·UI 의존 없음).
//
// 팀을 고르면 **그 시점의 재직 인원이 개별 참조(cc)로 펼쳐진다.** 팀 자체는 어디에도 저장하지 않는다
// — 결재선 저장 형식(approval_lines: step·kind·approver_id)은 그대로이고, 엔진도 팀을 모른다.
// 그래서 나중에 팀 구성이 바뀌어도 이미 올라간 문서의 참조자는 변하지 않는다(그게 맞는 동작이다.
// 상신 시점에 누구에게 알렸는지가 기록이어야 한다).
//
// 왜 파일을 따로 두는가 — 모달 안에 두면 검증을 돌릴 수 없다. 여기에는 값과 판정만 두고,
// 사람 목록을 읽는 일과 그리는 일은 components/approval/LinePickerModal.tsx 가 한다.

/** 한 번에 참조로 펼칠 수 있는 인원 상한. */
export const TEAM_CC_MAX = 30

/** 상한을 넘었을 때 보여 줄 문구. */
export const TEAM_CC_OVER_MESSAGE =
  '한 번에 30명까지 추가할 수 있습니다. 팀 인원이 많으면 나눠서 추가해 주세요'

/** 저장 UI 옆 보조 안내 — 저장되는 것은 지금 펼쳐진 개별 참조자다. */
export const TEAM_CC_PRESET_NOTICE = '팀 구성이 바뀌면 결재선을 다시 저장해 주세요'

/** 참조로 펼치지 못한 이유. */
export type SkipReason = 'self' | 'resigned' | 'already'

/** 이유별 표시 이름. 메시지를 만드는 쪽과 화면이 같은 말을 쓰도록 여기 둔다. */
export const SKIP_LABELS: Record<SkipReason, string> = {
  already: '이미 결재선에 있음',
  self: '본인',
  resigned: '퇴사',
}

/** 메시지에 세우는 순서 — 자주 생기는 이유를 앞에 둔다. */
const SKIP_ORDER: SkipReason[] = ['already', 'self', 'resigned']

/**
 * 팀 인원 한 명. 판정에 필요한 것만 받는다.
 * `resigned_date` 는 선택이다 — 부르는 쪽이 이미 재직자만 읽어 왔다면 넘기지 않아도 된다.
 */
export type TeamMember = {
  engineer_id: number
  resigned_date?: string | null
}

export type ExpandInput = {
  /** 그 팀의 인원. 같은 사람이 두 번 들어와도(여러 팀을 합쳐 넘긴 경우) 한 번만 센다. */
  members: TeamMember[]
  /** 상신자 본인 — 자기 결재선에 들어갈 수 없다(engine.ts 의 validateLineInput). */
  requesterId: number | null
  /** 이미 결재선에 올라간 사람(종류를 가리지 않는다 — 결재·합의·참조 어느 쪽이든 중복 금지다). */
  taken: Set<number>
  max: number
}

export type ExpandResult = {
  /**
   * 참조로 추가할 사람. **상한을 넘으면 빈 배열이다** — 부르는 쪽이 overLimit 을 놓쳐도
   * 아무도 추가되지 않게 한다(절반만 들어가는 것이 가장 나쁘다).
   */
  added: number[]
  /** 뺀 사람과 이유. 입력 순서를 지킨다. */
  skipped: { reason: SkipReason; id: number }[]
  /** 추가 대상이 max 를 넘었는가. true 면 added 는 비어 있다. */
  overLimit: boolean
}

/**
 * 팀 인원을 참조 후보로 펼친다.
 *
 * 빼는 순서가 곧 이유의 우선순위다.
 *   ① 본인        — 넣을 수 없는 사람이 먼저다(규칙 위반).
 *   ② 퇴사자      — 넣을 수 없는 사람.
 *   ③ 이미 있음   — 넣어도 되지만 중복이라 건너뛴다.
 * 중복 입력(같은 id 두 번)은 **이유로 세지 않는다** — 같은 사람을 한 번 넣는 것이 전부다.
 */
export function expandTeamCc(input: ExpandInput): ExpandResult {
  const { members, requesterId, taken, max } = input
  const added: number[] = []
  const skipped: { reason: SkipReason; id: number }[] = []
  const seen = new Set<number>()

  for (const m of members) {
    const id = m.engineer_id
    if (!Number.isInteger(id) || id <= 0) continue
    if (seen.has(id)) continue          // 같은 사람이 두 번 들어왔다 — 조용히 넘긴다
    seen.add(id)

    if (requesterId != null && id === requesterId) { skipped.push({ reason: 'self', id }); continue }
    if (m.resigned_date) { skipped.push({ reason: 'resigned', id }); continue }
    if (taken.has(id)) { skipped.push({ reason: 'already', id }); continue }
    added.push(id)
  }

  const overLimit = added.length > max
  return { added: overLimit ? [] : added, skipped, overLimit }
}

/**
 * 결과를 한 줄 문구로 — 「12명 추가, 3명 제외(이미 결재선에 있음 1, 본인 1, 퇴사 1)」.
 *
 * 상한을 넘은 경우는 이 함수가 다루지 않는다(부르는 쪽이 TEAM_CC_OVER_MESSAGE 를 쓴다).
 * 아무도 더하지 못했고 뺀 사람도 없으면 null — 할 말이 없다(빈 팀).
 */
export function summarizeTeamCc(res: ExpandResult): string | null {
  if (res.added.length === 0 && res.skipped.length === 0) return null
  const head = `${res.added.length}명 추가`
  if (res.skipped.length === 0) return head

  const byReason = new Map<SkipReason, number>()
  for (const s of res.skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1)
  const detail = SKIP_ORDER
    .filter(r => byReason.has(r))
    .map(r => `${SKIP_LABELS[r]} ${byReason.get(r)}`)
    .join(', ')
  return `${head}, ${res.skipped.length}명 제외(${detail})`
}
