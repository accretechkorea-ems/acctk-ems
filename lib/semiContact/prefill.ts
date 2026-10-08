// 반도체 고객 접촉 보고 — **이어쓰기**(순수 모듈).
//
// 같은 Project 의 새 보고서는 직전 보고의 현황을 가져와 바뀐 것만 고친다.
//   · 가져오는 필드 = 등록표의 carry: true. 나머지(접촉일·목적·FACT·회의 내용 …)는 비운다.
//   · 「직전 보고」 = 같은 Project 에서 (contact_date desc, report_id desc) 로 첫 번째 한 건이다.
//     같은 날 두 번 만났으면 나중에 쓴 보고(report_id 가 큰 쪽)가 직전이다.
//     이 규칙으로 찾는 일은 호출하는 쪽(라우트·화면)이 한다 — DB 인덱스
//     idx_semi_contact_reports_project_date 가 그 순서다(semi_contact_schema.sql 문장 12).
//   · 접촉일은 여기서 채우지 않는다. 호출하는 쪽이 오늘(todayKST())을 넣는다 — 이 모듈은 시계를 보지 않는다.
//
// DB·화면에 의존하지 않는다 — 스크립트로 그대로 돌려 볼 수 있다.

import { FIELDS, emptyInput, type FieldKey, type ReportInput } from './fields'

/** 이전 값의 모양 — 저장값에서 풀어낸 입력 객체(fromStorage)든 일부 칸만 있든 받는다. */
export type PartialInput = Partial<Record<FieldKey, string | null | undefined>>

/**
 * 직전 보고에서 가져오기(carry) 필드만 복사하고, 나머지는 빈 값인 새 입력 객체를 돌려준다.
 *
 * @param prev    직전 보고(없으면 null — 그 Project 의 첫 보고서).
 * @param project Project 의 현재 값(customer_name·site_dept·title). 주면 Project 칸은 이것이 이긴다 —
 *                직전 보고 뒤에 Project 정보가 고쳐졌을 수 있고, 그 칸의 정본은 semi_projects 다.
 */
export function prefillFromPrevious(prev: PartialInput | null | undefined, project?: PartialInput | null): ReportInput {
  const out = emptyInput()
  for (const f of FIELDS) {
    if (!f.carry) continue
    const fromProject = f.storage === 'project' ? project?.[f.key] : undefined
    out[f.key] = text(fromProject ?? prev?.[f.key])
  }
  return out
}

/**
 * 가져오기(carry) 필드 중 직전 보고와 값이 달라진 필드 key 목록(등록표 순서).
 *   · 앞뒤 공백·연속 공백(줄바꿈·탭·전각 공백 포함)만 다르면 같은 값으로 본다.
 *   · 빈 값('')과 null·undefined 는 같은 값이다.
 *   · 직전 보고가 없으면(그 Project 의 첫 보고서) 빈 목록 — 비교할 대상이 없다.
 * 화면이 「바뀐 칸」을 표시하고, 엑셀이 변경점을 강조하는 데 쓴다.
 */
export function changedFields(prev: PartialInput | null | undefined, next: PartialInput): FieldKey[] {
  if (!prev) return []
  const out: FieldKey[] = []
  for (const f of FIELDS) {
    if (!f.carry) continue
    if (fold(prev[f.key]) !== fold(next[f.key])) out.push(f.key)
  }
  return out
}

/** 비교용 정규화: 공백 접기 + 앞뒤 공백 제거. null·undefined 는 ''. */
export function fold(v: unknown): string {
  return text(v).replace(/[\s　]+/g, ' ').trim()
}

function text(v: unknown): string {
  if (v == null) return ''
  return typeof v === 'string' ? v : String(v)
}
