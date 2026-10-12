// 반도체 고객 접촉 보고 — Project 만들기에 쓰는 값(순수 모듈).
// 라우트(app/api/semi-contact/project)와 화면(app/contact/semi)이 같은 값을 쓰도록 여기 둔다.
// 칸 목록은 필드 등록표(fields.ts)에서 storage 가 'project' 인 것을 그대로 읽는다.

import { FIELDS, type FieldKey } from './fields'

/** Project 를 만들 때 받는 칸 — 고객사·사업장/부서·Project/구매안건(등록표 순서). */
export const PROJECT_KEYS: readonly FieldKey[] = FIELDS.filter(f => f.storage === 'project').map(f => f.key)

/** Project 칸 한 개의 길이 상한. 화면은 입력을 이 길이로 자르고, 라우트는 넘으면 거절한다. */
export const PROJECT_TEXT_MAX = 200

/** 'PRJ-2026-001'. 순번은 3자리 0 채움이고, 1000 부터는 자르지 않고 그대로 네 자리가 된다. */
export function buildProjectNo(year: number, seq: number): string {
  return `PRJ-${year}-${String(seq).padStart(3, '0')}`
}
