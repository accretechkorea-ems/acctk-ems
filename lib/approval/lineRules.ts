// 문서 종류별 결재선 규칙 — 순수 함수만. DB 를 읽지도 쓰지도 않는다.
//
// 왜 엔진(lib/approval/engine.ts)에 넣지 않는가 — 엔진은 문서 종류를 모른다. 그 상태를 지켜야
// 새 유형이 생겨도 엔진을 고치지 않는다. 그래서 「어떤 줄이 결재선으로 성립하는가」(engine.ts 의
// validateLineInput)와 「이 종류는 어떤 결재선을 요구하는가」(이 파일)를 나눠 두었다.
//   · validateLineInput — 종류와 무관한 모양 검사(결재자 1명 이상·순서·중복·퇴사자·본인 제외)
//   · checkLineRules    — 종류별 요구(지금은 「결재자에 관리자 1명 이상」)
//
// 규칙을 바꾸거나 없애려면 lib/approval/docTypes.ts 의 lineRules 칸만 고친다. 이 파일은
// 「칸이 켜져 있을 때 무엇을 보는가」만 적어 두고, 어느 유형에 켜는지는 알지 않는다.
//
// 서버(lib/approval/submit.ts 의 checkLines)와 화면(components/approval/LinePickerModal.tsx)이
// **같은 함수**를 쓴다 — 화면에서 통과한 결재선이 상신에서만 막히는 일이 없게 하기 위해서다
// (validateLineInput 을 양쪽이 함께 쓰는 것과 같은 이유다).

import type { LineRules } from './docTypes'
import type { LineInput } from './types'

/**
 * 'superadmin' 등급을 사용자에게 부르는 이름. 유지보수 화면이 쓰는 말과 같아야 한다
 * (app/admin/page.tsx — 'superadmin' → 「관리자」, 'member' → 「팀원」).
 *
 * 직급(position)에도 「관리자」가 있어 글자가 겹친다. 그래서 결재선 모달은 등급을 가진 사람에게
 * 뱃지를 붙여, 직급이 「관리자」인 사람과 눈으로 구분되게 한다.
 */
export const SUPERADMIN_LABEL = '관리자'

export type LineRuleFailure = {
  ok: false
  /** 어떤 규칙에 걸렸는가. 화면이 문구를 갈아 끼울 때 쓴다(지금은 message 를 그대로 쓴다). */
  code: 'superadmin_approver_required'
  message: string
}

export type LineRuleResult = { ok: true } | LineRuleFailure

export type LineRuleInput = {
  /** 검사할 결재선. step 은 보지 않는다(순서 검사는 validateLineInput 이 한다). */
  lines: LineInput[]
  /** 그 문서 종류의 규칙. 없으면(undefined) 아무 규칙도 없다. */
  rules: LineRules | undefined
  /**
   * 상신자가 'superadmin' 등급인가 — **면제 조건이다.**
   * 상신자 본인은 자기 결재선에 들어갈 수 없다(validateLineInput). 그래서 관리자가 직접 올리는
   * 문서에 「결재자에 관리자 1명」을 그대로 요구하면, 관리자가 혼자인 조직에서는 아무것도 올릴 수 없다.
   * 관리자가 올린 문서는 이미 관리자의 뜻이 담긴 것이라 면제한다.
   */
  requesterIsSuperadmin: boolean
  /** 그 직원이 'superadmin' 등급인가. 부르는 쪽이 조회해 넘긴다(이 파일은 DB 를 모른다). */
  isSuperadmin: (engineerId: number) => boolean
}

/**
 * 종류별 결재선 규칙 검사. 통과면 `{ ok: true }`, 아니면 사람이 읽을 사유를 담아 돌려준다.
 *
 * 지금 있는 규칙 하나 — requireSuperadminApprover:
 *   결재자(kind='approve') 중 'superadmin' 등급이 한 명 이상이어야 한다.
 *   **합의(agree)·참조(cc)의 관리자는 인정하지 않는다** — 합의는 순서에 끼어 있어도 반려 권한이
 *   결재와 같지 않고, 참조는 아무 판단도 하지 않는다. 「관리자가 승인했다」가 되려면 결재 줄이어야 한다.
 */
export function checkLineRules(input: LineRuleInput): LineRuleResult {
  const { lines, rules, requesterIsSuperadmin, isSuperadmin } = input
  if (!rules) return { ok: true }

  if (rules.requireSuperadminApprover && !requesterIsSuperadmin) {
    const hasSuper = (lines ?? []).some(l => l.kind === 'approve' && isSuperadmin(l.approverId))
    if (!hasSuper) {
      return {
        ok: false,
        code: 'superadmin_approver_required',
        message: `결재자 중 ${SUPERADMIN_LABEL} 1명 이상이 포함되어야 합니다.`,
      }
    }
  }

  return { ok: true }
}

/**
 * 규칙을 사람이 읽는 안내 문장으로. 결재선을 짜기 **전에** 보여 주는 말이라 실패 사유와 다르다
 * (실패 사유는 checkLineRules 의 message 다). 규칙이 없거나 면제 대상이면 null.
 */
export function lineRuleNotice(rules: LineRules | undefined, requesterIsSuperadmin: boolean): string | null {
  if (!rules || requesterIsSuperadmin) return null
  if (rules.requireSuperadminApprover) {
    return `결재자 중 ${SUPERADMIN_LABEL} 1명 이상이 필요합니다.`
  }
  return null
}
