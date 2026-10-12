// 반도체 고객 접촉 보고 — 「이어받은 항목」 그룹 안의 **화면 배치**(순수 모듈).
//
// 등록표(fields.ts)의 순서는 엑셀(보고서 시트의 나머지 칸·이력 시트의 열)이 그대로 쓰므로 바꾸지 않는다.
// 작성·상세 화면만 이 표로 그룹 안 순서와 「전체 폭」 칸을 정한다. 표가 없는 그룹은 등록표 순서 그대로다.
// 표의 키가 그룹의 칸과 정확히 같지 않으면(등록표가 바뀌어 어긋나면) 등록표 순서로 돌아간다 — 칸이 빠지지 않게.

import type { FieldDef, FieldKey, SectionNo } from './fields'

export type LayoutCell = { key: FieldKey; /** 2열 그리드에서 두 열을 합친 가로 한 줄 전체. */ full?: boolean }

export const INHERITED_LAYOUT: Partial<Record<SectionNo, LayoutCell[]>> = {
  // 고객 투자·요구
  3: [
    { key: 'invest_timing' }, { key: 'expected_units' },
    { key: 'our_status' }, { key: 'our_strength_weakness' },
    { key: 'customer_requirements', full: true },
  ],
  // 당사 판단·영업전략
  5: [
    { key: 'strategy', full: true },
    { key: 'why_win' }, { key: 'why_lose' },
    { key: 'assessment' }, { key: 'hq_support' },
  ],
  // 미확인 사항·Next Action
  6: [
    { key: 'next_check' }, { key: 'memo' },
    { key: 'attachment_note', full: true },
  ],
}

/** 그룹의 칸을 화면 순서로. fields 는 그 그룹에 놓일 칸(등록표 순서). */
export function layoutOf(section: SectionNo, fields: readonly FieldDef[]): { def: FieldDef; full: boolean }[] {
  const plan = INHERITED_LAYOUT[section]
  const byKey = new Map(fields.map(f => [f.key, f]))
  const fits = !!plan && plan.length === fields.length && plan.every(c => byKey.has(c.key))
  if (!fits) return fields.map(def => ({ def, full: false }))
  return plan.map(c => ({ def: byKey.get(c.key) as FieldDef, full: !!c.full }))
}
