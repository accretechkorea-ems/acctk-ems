// 반도체 고객 접촉 보고 — Project 만들기·고치기에 쓰는 값(순수 모듈).
// 라우트(app/api/semi-contact/project)와 화면(app/contact/semi)이 같은 값을 쓰도록 여기 둔다.
// 칸 목록은 필드 등록표(fields.ts)에서 storage 가 'project' 인 것을 그대로 읽는다.
//
// Project 번호 — 사람이 직접 적는다(자유 형식). 예전의 자동 발급(claim_semi_project_seq, PRJ-연도-순번)은 쓰지 않는다.
//   앞뒤 공백만 지우고, 빈 값과 너무 긴 값만 막는다. 형식(PRJ- 등)은 보지 않는다.
//   대소문자를 가리지 않고 겹치면 안 된다 — 판정은 라우트가 DB 에서 하고(lower(project_no) 유니크 인덱스가 최종 방어),
//   화면은 그 오류 문구를 번호 칸 아래에 붙인다.

import { FIELDS, type FieldKey } from './fields'

/** Project 를 만들 때 받는 칸 — 고객사·사업장/부서·Project/구매안건(등록표 순서). */
export const PROJECT_KEYS: readonly FieldKey[] = FIELDS.filter(f => f.storage === 'project').map(f => f.key)

/** Project 칸 한 개의 길이 상한. 화면은 입력을 이 길이로 자르고, 라우트는 넘으면 거절한다. */
export const PROJECT_TEXT_MAX = 200

/** Project 번호 칸의 키·이름·길이 상한. 번호는 등록표의 칸이 아니라 semi_projects.project_no 다. */
export const PROJECT_NO_KEY = 'project_no'
export const PROJECT_NO_LABEL = 'Project 번호'
export const PROJECT_NO_MAX = 50

/** 겹칠 때의 문구 — 라우트와 화면이 같은 글자를 쓴다. */
export const PROJECT_NO_DUP_MESSAGE = '이미 사용 중인 Project 번호입니다'

/** 저장할 번호 — 앞뒤 공백만 지운다(안쪽 글자·대소문자는 그대로). */
export function cleanProjectNo(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** 번호 칸 검증. 문제가 없으면 null. 형식은 보지 않는다. */
export function validateProjectNo(v: unknown): string | null {
  const s = cleanProjectNo(v)
  if (!s) return `${PROJECT_NO_LABEL}를 입력해주세요`
  if (s.length > PROJECT_NO_MAX) return `${PROJECT_NO_LABEL}는 ${PROJECT_NO_MAX}자까지 입력할 수 있습니다`
  return null
}
