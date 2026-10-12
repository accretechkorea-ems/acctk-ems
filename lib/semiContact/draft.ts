// 반도체 고객 접촉 보고 — 작성 화면의 **임시저장**(이 브라우저에만, DB 에는 저장하지 않는다).
//
// lib/quoteDraft.ts(견적 임시저장)와 같은 규칙이다.
//   · 키는 계정 × Project 하나: `semi-draft:<engineerId>:<projectId>` — 같은 컴퓨터를 여러 사람이 쓰고,
//     한 사람이 여러 Project 의 보고서를 번갈아 쓸 수 있다.
//   · 읽기·쓰기 모두 try/catch(비공개 모드·저장소 차단·용량 초과). 실패해도 화면은 그대로 동작한다.
//   · 저장 모양에 버전을 붙여, 모양이 바뀌면 옛 임시저장본은 조용히 버린다(깨진 값으로 화면이 망가지지 않게).
//   · 저장에 성공하면(보고서가 DB 에 들어가면) 화면이 지운다.

import type { ActionInput, FieldKey } from './fields'

const DRAFT_VERSION = 1

export type SemiDraft = {
  /** 등록표 36칸의 입력값(빈 값 = ''). */
  values: Partial<Record<FieldKey, string>>
  actions: ActionInput[]
  noAction: boolean
  /** 저장한 시각(ISO). 「이어서 작성할까요?」 안내와 상태 표시에 쓴다. */
  savedAt: string
}

type Stored = SemiDraft & { v: number }

export const semiDraftKey = (engineerId: number, projectId: number): string =>
  `semi-draft:${engineerId}:${projectId}`

export function saveSemiDraft(engineerId: number, projectId: number, draft: SemiDraft): boolean {
  try {
    const stored: Stored = { ...draft, v: DRAFT_VERSION }
    localStorage.setItem(semiDraftKey(engineerId, projectId), JSON.stringify(stored))
    return true
  } catch {
    return false
  }
}

/** 임시저장본. 없거나 버전이 다르거나 깨졌으면 null. */
export function loadSemiDraft(engineerId: number, projectId: number): SemiDraft | null {
  try {
    const raw = localStorage.getItem(semiDraftKey(engineerId, projectId))
    if (!raw) return null
    const o = JSON.parse(raw) as Partial<Stored> | null
    if (!o || o.v !== DRAFT_VERSION || typeof o.values !== 'object' || !Array.isArray(o.actions)) return null
    return {
      values: o.values ?? {},
      actions: o.actions as ActionInput[],
      noAction: o.noAction === true,
      savedAt: typeof o.savedAt === 'string' ? o.savedAt : '',
    }
  } catch {
    return null
  }
}

export function clearSemiDraft(engineerId: number, projectId: number): void {
  try {
    localStorage.removeItem(semiDraftKey(engineerId, projectId))
  } catch {
    /* 지우지 못해도 다음 진입 때 「이어서 작성」을 물을 뿐이다 */
  }
}
