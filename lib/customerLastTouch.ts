// 업체의 **마지막 접점** — 목록 정렬과 상세 요약이 함께 쓰는 한 값.
//
// ── 왜 한곳에 두는가 ───────────────────────────────────────────────────────
//   지도 화면 목록은 「최근 활동이 있으면 위로」 올리는데, 예전에는 **서비스 리포트와
//   장비 설치일**만 봤다(app/page.tsx 의 정렬). 영업활동·견적·수리를 한 업체는 아무리
//   최근에 움직여도 목록 아래에 깔렸다. 상세 요약의 숫자 칸도 서비스 리포트만 봤다.
//   두 자리가 같은 값을 쓰도록 판정을 여기 하나로 모은다.
//
// ── 무엇을 보는가 ─────────────────────────────────────────────────────────
//   영업활동 sales_activities.activity_date
//   서비스   service_history.visit_date
//   견적     quotes.quote_date
//   수리     repairs 의 출고일 → 입고일(출고가 없으면 입고일이 마지막 움직임이다)
//
//   날짜는 전부 'YYYY-MM-DD' 라 **문자열 비교**로 충분하다(시각·표준시 문제가 없다).

import type { SupabaseClient } from '@supabase/supabase-js'

export type TouchSource = '영업활동' | '서비스' | '견적' | '수리'

export type LastTouch = { date: string; source: TouchSource }

/** 'YYYY-MM-DD' 로 자른다. 빈 값·엉뚱한 값은 null. */
export function touchDate(value: string | null | undefined): string | null {
  const s = (value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  return s.slice(0, 10)
}

/**
 * 네 갈래 중 **가장 최근** 것. 같은 날이면 앞선 갈래가 이긴다
 * (영업활동 → 서비스 → 견적 → 수리 — 사람이 직접 적은 기록을 먼저 본다).
 */
export function pickLastTouch(input: {
  activity?: (string | null | undefined)[]
  service?: (string | null | undefined)[]
  quote?: (string | null | undefined)[]
  repair?: (string | null | undefined)[]
}): LastTouch | null {
  const groups: [TouchSource, (string | null | undefined)[]][] = [
    ['영업활동', input.activity ?? []],
    ['서비스', input.service ?? []],
    ['견적', input.quote ?? []],
    ['수리', input.repair ?? []],
  ]
  let best: LastTouch | null = null
  for (const [source, list] of groups) {
    for (const raw of list) {
      const date = touchDate(raw)
      if (!date) continue
      if (best === null || date > best.date) best = { date, source }
    }
  }
  return best
}

/** 정렬에 쓰는 숫자 — 날짜가 없으면 0. */
export function touchValue(touch: LastTouch | null | undefined): number {
  if (!touch) return 0
  const t = Date.parse(`${touch.date}T00:00:00+09:00`)
  return Number.isNaN(t) ? 0 : t
}

// ── 목록 화면이 쓰는 로더 ──────────────────────────────────────────────────
//   업체마다 질의를 날리지 않는다 — 네 표를 한 번씩 통째로 읽어 화면에서 묶는다
//   (업체 1,200곳 × 4질의 = 4,800번이 될 자리다).

type Rows = { customer_id: number | null; date: string | null }[]

/** 한 표를 읽어 (업체 → 날짜 목록) 으로 바꾼다. */
function group(rows: Rows): Map<number, string[]> {
  const map = new Map<number, string[]>()
  for (const r of rows) {
    const id = Number(r.customer_id)
    if (!Number.isFinite(id)) continue
    const date = touchDate(r.date)
    if (!date) continue
    const list = map.get(id)
    if (list) list.push(date)
    else map.set(id, [date])
  }
  return map
}

/**
 * 모든 업체의 마지막 접점. 네 표를 한 번씩 읽는다(각 5,000줄까지).
 * supabase 클라이언트는 화면용·service role 어느 쪽이든 된다.
 */
export async function loadLastTouchMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any, any, any>,
): Promise<Map<number, LastTouch>> {
  const [act, svc, quo, rep] = await Promise.all([
    sb.from('sales_activities').select('customer_id, activity_date').range(0, 5000),
    sb.from('service_history').select('customer_id, visit_date').range(0, 5000),
    sb.from('quotes').select('customer_id, quote_date').range(0, 5000),
    sb.from('repairs').select('customer_id, received_date, shipped_date').range(0, 5000),
  ])
  const byId = new Map<number, LastTouch>()
  const activity = group((act.data ?? []).map(r => ({ customer_id: r.customer_id, date: r.activity_date })))
  const service = group((svc.data ?? []).map(r => ({ customer_id: r.customer_id, date: r.visit_date })))
  const quote = group((quo.data ?? []).map(r => ({ customer_id: r.customer_id, date: r.quote_date })))
  // 수리는 출고일이 있으면 그날, 없으면 입고일이 마지막 움직임이다.
  const repair = group((rep.data ?? []).map(r => ({ customer_id: r.customer_id, date: r.shipped_date ?? r.received_date })))

  const ids = new Set<number>([...activity.keys(), ...service.keys(), ...quote.keys(), ...repair.keys()])
  for (const id of ids) {
    const touch = pickLastTouch({
      activity: activity.get(id), service: service.get(id), quote: quote.get(id), repair: repair.get(id),
    })
    if (touch) byId.set(id, touch)
  }
  return byId
}
