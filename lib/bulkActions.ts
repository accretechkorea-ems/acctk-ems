// 사업장·회사 **일괄 작업**의 규칙 한 벌 (2026-11-23).
//
// ── 왜 모으는가 ───────────────────────────────────────────────────────────
//   전에는 검은 바 안에 native select 가 섞여 있었다. 두 가지가 나빴다.
//     (가) **흰 글자 흰 바탕** — 바가 흰 글자색을 주는데 select 가 자기 색을 정하지
//          않아 그 흰색을 물려받았다. select 의 바탕은 브라우저 기본(밝은 색)이라
//          고른 값도, 펼친 목록(option)도 보이지 않았다(2026-11-23 실측).
//     (나) **고르는 순간 바로 저장**됐다. 몇 곳이 무엇으로 바뀌는지 보여 주지 않고
//          드롭다운에서 손을 떼는 순간 끝났다 — 되돌리는 길도 없다.
//   이제 바에는 **버튼만** 둔다. 버튼은 적용 모달을 열고, 모달이 「N곳 → 값」을 보여 준 뒤
//   적용한다. 드롭다운은 바에 두지 않는다.
//
// ── 무엇이 언제 켜지는가 ──────────────────────────────────────────────────
//   고른 것이 **회사**냐 **사업장**이냐로 갈린다. 분류는 회사 줄의 칸이고, 상태·대리점·
//   이동·병합은 사업장 줄의 일이다. 켤 수 없으면 **왜 못 켜는지**를 버튼의 title 로 말한다.
//
// DB·화면에 의존하지 않는다(import 가 없다) — 하네스가 그대로 돌린다.

/** 무엇을 골랐는가. */
export type BulkScope = 'site' | 'company'

export type BulkActionKey = 'industry' | 'agency' | 'status' | 'move' | 'merge'

export type BulkAction = {
  key: BulkActionKey
  label: string
  /** 이 일이 걸리는 대상. */
  scope: BulkScope
}

/** 바에 서는 순서 그대로. */
export const BULK_ACTIONS: readonly BulkAction[] = [
  { key: 'industry', label: '분류 지정', scope: 'company' },
  { key: 'agency', label: '대리점 변경', scope: 'site' },
  { key: 'status', label: '상태 변경', scope: 'site' },
  { key: 'move', label: '다른 회사로 이동', scope: 'site' },
  { key: 'merge', label: '사업장 병합', scope: 'site' },
]

/** 판정에 필요한 지금 상태. */
export type BulkContext = {
  scope: BulkScope
  /** 고른 줄 수. */
  count: number
  /** 고른 사업장이 **모두 같은 회사**인가(병합 조건). 회사를 골랐을 때는 뜻이 없다. */
  sameCompany?: boolean
  /** 이 사람이 회사 수준 작업(병합)을 할 수 있는가. 모르면 할 수 있다고 본다. */
  canMergeSites?: boolean
}

/**
 * 그 버튼을 **못 누르는 이유**. 누를 수 있으면 null 이다.
 * 글자는 그대로 버튼의 title 이 된다 — 「왜 회색인가」를 눈이 아니라 말로 알려 준다.
 */
export function bulkDisabledReason(key: BulkActionKey, ctx: BulkContext): string | null {
  const action = BULK_ACTIONS.find(a => a.key === key)
  if (!action) return '없는 작업입니다'
  if (ctx.count === 0) return '먼저 줄을 고르세요'

  if (action.scope === 'company' && ctx.scope !== 'company') {
    return '분류는 회사 단위입니다 — 왼쪽 목록에서 회사를 고르세요'
  }
  if (action.scope === 'site' && ctx.scope !== 'site') {
    return '사업장을 고른 뒤에 할 수 있습니다'
  }
  if (key === 'merge') {
    if (ctx.canMergeSites === false) return '사업장 병합은 슈퍼관리자만 할 수 있습니다'
    if (ctx.count < 2) return '사업장을 2곳 이상 골라야 합칠 수 있습니다'
    if (ctx.sameCompany === false) return '같은 회사의 사업장끼리만 합칠 수 있습니다'
  }
  return null
}

/** 지금 바에서 쓸 수 있는 작업만. 쓸 수 없는 것도 **버튼은 남는다**(이유를 말해야 하므로). */
export function bulkActionsFor(ctx: BulkContext): { action: BulkAction; reason: string | null }[] {
  return BULK_ACTIONS.map(action => ({ action, reason: bulkDisabledReason(action.key, ctx) }))
}

/** 바 왼쪽 글자 — 「사업장 3곳 선택」·「회사 2곳 선택」. */
export function bulkBarTitle(scope: BulkScope, count: number): string {
  return `${scope === 'company' ? '회사' : '사업장'} ${count}곳 선택`
}

/** 푸터 요약 — 「3곳 → 활성」. 값을 아직 고르지 않았으면 값 자리를 비운다. */
export function bulkFooterText(count: number, valueLabel: string | null | undefined): string {
  return valueLabel ? `${count}곳 → ${valueLabel}` : `${count}곳 선택됨`
}

/** 끝난 뒤의 토스트 — 「3곳 변경됨」. */
export function bulkDoneText(count: number): string {
  return `${count}곳 변경됨`
}

/**
 * 대리점 고르기의 **직판 항목**. 값이 null 이라는 뜻을 글자로 풀어 둔다 —
 * 「ACCT-K」만 적어 두면 그것이 대리점 이름인 줄 안다.
 */
export const DIRECT_SALE_VALUE = 'none'
export const DIRECT_SALE_OPTION_LABEL = 'ACCT-K(직판 — 대리점 없음)'

/**
 * 「지금 값」 묶음 — 고른 줄들의 지금 값을 많은 순으로 센다.
 * 같은 수면 이름순이다(두 번 열어도 같은 차례로 보인다).
 */
export function currentValueCounts(values: (string | null | undefined)[], emptyLabel = '없음'): { label: string; n: number }[] {
  const map = new Map<string, number>()
  for (const v of values) {
    const key = (v ?? '').trim() || emptyLabel
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map]
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'ko'))
}

/** 「지금: 활성 2 · 잠재 1」 한 줄. 값이 하나뿐이면 수를 적지 않는다. */
export function currentValueText(counts: { label: string; n: number }[]): string {
  if (counts.length === 0) return '-'
  if (counts.length === 1) return counts[0].label
  return counts.map(c => `${c.label} ${c.n}`).join(' · ')
}
