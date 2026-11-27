// 포캐스트 **끝난 건을 보는 규칙** (2026-11-28, 야간4 4-3).
//
// ── 무엇이 바뀌었나 ────────────────────────────────────────────────────────
//   전에는 판 아래에 「끝난 건 N건 [펼치기]」 묶음이 접혀 있었다. 펼치면 끝난 카드가
//   격자로 깔리는데, 카드는 **옮기려고** 만든 모양이라 끝난 건에는 쓸 데가 없었다
//   (끌 수도 없고 단계 select 도 안 열린다). 그리고 「실주 사유가 무엇이었나」,
//   「어디까지 갔다가 깨졌나」는 카드에 적을 자리가 없었다.
//
//   이제 **보는 것을 세그먼트로 고른다**: 진행 중(칸반) · 수주 · 실주 · 전체(표).
//   끝난 건은 표가 맞다 — 줄마다 단계 이력·사유·경쟁사를 한 줄로 늘어놓을 수 있다.
//
// ── 수주 건은 판에 얼마나 서 있나 ──────────────────────────────────────────
//   수주는 closed_at 이 찍혀도 **진행 중**으로 본다(납품 전까지 취소·연기가 있다 —
//   components/customer/opportunity.ts 의 isClosed). 그래서 수주 열에 쌓이기만 했다.
//   **30일**이 지나면 판에서 뺀다. 표(수주·전체)에는 그대로 남는다 — 지우는 것이
//   아니라 **판에서 내리는 것**이다.
//
// 순수 함수만 둔다 — 하네스가 그대로 돌린다(scripts/forecast-closed-check.js).

import { isClosed } from '@/components/customer/opportunity'
import type { SalesOpportunity } from '@/components/customer/types'

/** 세그먼트 넷. 기본은 진행 중이다. */
export const FORECAST_VIEWS = [
  { key: 'open', label: '진행 중' },
  { key: 'won', label: '수주' },
  { key: 'lost', label: '실주' },
  { key: 'all', label: '전체' },
] as const
export type ForecastView = typeof FORECAST_VIEWS[number]['key']

/** 수주 건이 판에 서 있는 날수. */
export const WON_BOARD_DAYS = 30

/** 두 날짜 사이의 날수. 둘 다 `YYYY-MM-DD` 로 자른 값을 본다. */
export function daysSince(iso: string | null | undefined, today: string): number | null {
  const s = String(iso ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null
  const a = Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  const b = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)))
  return Math.round((b - a) / 86400000)
}

/**
 * 이 건이 **판(칸반)** 에 설 수 있나.
 *
 *   실주·종료    서지 않는다(표로 간다).
 *   수주         closed_at 에서 30일까지만 선다. 종료 시각이 없으면 계속 선다.
 *   그 밖        선다.
 */
export function onBoard(o: SalesOpportunity, today: string): boolean {
  // 수주를 **먼저** 가른다 — 수주는 closed_at 이 찍혀도 isClosed 가 true 라
  // (납품 전까지 취소·연기가 있다), 그 판정을 먼저 보면 30일을 세어 볼 틈이 없다.
  if (o.stage === '수주') {
    const d = daysSince(o.closed_at, today)
    return d === null || d <= WON_BOARD_DAYS
  }
  return !isClosed(o)
}

/** 이 건이 **끝난 표**의 어느 칸에 드나. 진행 중이면 null. */
export function closedKind(o: SalesOpportunity): 'won' | 'lost' | null {
  if (o.stage === '실주') return 'lost'
  if (o.stage === '수주') return 'won'
  // 단계는 진행 중인데 closed_at 만 찍힌 건(수동 종료) — 수주가 아니므로 실주 쪽에 둔다.
  return o.closed_at ? 'lost' : null
}

/**
 * 고른 세그먼트가 **표에 세울 줄**. 진행 중(open)이면 표를 그리지 않으므로 빈 배열이다.
 *
 *   수주   stage === '수주'
 *   실주   실주 + 수동 종료
 *   전체   끝난 건 **전부**(수주 + 실주 + 수동 종료) — 진행 중은 칸반이 보여 준다.
 */
export function tableRows(rows: readonly SalesOpportunity[], view: ForecastView): SalesOpportunity[] {
  if (view === 'open') return []
  const out = rows.filter(o => {
    const k = closedKind(o)
    if (k === null) return false
    return view === 'all' ? true : k === view
  })
  // 끝난 날이 **최근인 것부터**. 날이 없으면 만든 날로 견준다.
  return out.sort((a, b) => {
    const ka = String(a.closed_at ?? a.created_at ?? '')
    const kb = String(b.closed_at ?? b.created_at ?? '')
    return kb.localeCompare(ka)
  })
}

/** 세그먼트 옆에 적는 건수 — 고르기 전에 몇 건인지 보인다. */
export function viewCounts(rows: readonly SalesOpportunity[], today: string): Record<ForecastView, number> {
  return {
    open: rows.filter(o => onBoard(o, today)).length,
    won: rows.filter(o => closedKind(o) === 'won').length,
    lost: rows.filter(o => closedKind(o) === 'lost').length,
    all: rows.filter(o => closedKind(o) !== null).length,
  }
}
