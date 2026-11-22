// 업체의 **마지막 접점** — 목록 정렬과 상세 요약이 함께 쓰는 한 값.
//
// ── 왜 한곳에 두는가 ───────────────────────────────────────────────────────
//   지도 화면 목록은 「최근 활동이 있으면 위로」 올리는데, 예전에는 **서비스 리포트와
//   장비 설치일**만 봤다(app/page.tsx 의 정렬). 영업활동·견적·수리를 한 업체는 아무리
//   최근에 움직여도 목록 아래에 깔렸다. 상세 요약의 숫자 칸도 서비스 리포트만 봤다.
//   두 자리가 같은 값을 쓰도록 판정을 여기 하나로 모은다.
//
// ── 무엇을 보는가 — **활동 이력에 줄로 나오는 종류만** ────────────────────
//   영업활동 sales_activities.activity_date
//   서비스   service_history.visit_date
//   견적     quotes.quote_date
//   수리     repairs 의 출고일 → 입고일(출고가 없으면 입고일이 마지막 움직임이다)
//   의뢰     inquiries.issued_date
//   포캐스트 sales_opportunities 의 **등록일·종료일**(created_at·closed_at)
//   홀딩     holdings 의 **시작일·해결일**(started_at·resolved_at)
//
// ── 무엇을 보지 않는가 (2026-11-22) ───────────────────────────────────────
//   **고친 시각(updated_at)은 어디에서도 보지 않는다.** 업체·사업장·담당자·장비 정보
//   수정, 메모 수정, 병합·이동은 활동이 아니다 — 사람이 밖으로 나가 한 일만 활동이다.
//   그래서 포캐스트·홀딩도 **등록·시작·종료한 날**로 센다(제목만 고쳐도 올라오면 안 된다).
//   업체 표(customers)에는 updated_at 칸 자체가 없다(2026-11-22 확인).
//
//   날짜는 'YYYY-MM-DD' 로 맞춰 **문자열 비교**로 센다. 시각(timestamptz)으로 저장된
//   칸은 한국 날짜로 읽는다(kstYmd) — UTC 로 자르면 밤에 넣은 건이 하루 앞서 보인다.

import type { SupabaseClient } from '@supabase/supabase-js'
import { kstYmd } from './date'

export type TouchSource = '영업활동' | '서비스' | '견적' | '수리' | '의뢰' | '포캐스트' | '홀딩'

/**
 * 마지막 접점 한 건. `actorId` 는 **그 일을 한 우리 쪽 사람**이다(활동 등록자·견적
 * 작성자·서비스 엔지니어·수리 등록자). 이름이 아니라 id 를 들고 있는다 — 이름은
 * lib/appData/engineers 의 캐시가 이미 들고 있어, 여기서 또 읽으면 조회가 는다.
 */
export type LastTouch = { date: string; source: TouchSource; actorId: number | null }

/** 날짜 하나 + 그 일을 한 사람. 날짜만 넘겨도 된다(사람을 모르는 자리). */
export type TouchEntry = { date: string | null | undefined; actorId?: number | null }
export type TouchInput = string | TouchEntry | null | undefined

/** 문자열이든 {date, actorId} 든 같은 모양으로 편다. */
const entryOf = (raw: TouchInput): TouchEntry =>
  (raw == null || typeof raw === 'string') ? { date: raw ?? null, actorId: null } : raw

/** 'YYYY-MM-DD' 로 자른다. 빈 값·엉뚱한 값은 null. */
export function touchDate(value: string | null | undefined): string | null {
  const s = (value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  return s.slice(0, 10)
}

/**
 * 일곱 갈래 중 **가장 최근** 것. 같은 날이면 앞선 갈래가 이긴다
 * (영업활동 → 서비스 → 견적 → 수리 → 의뢰 → 포캐스트 → 홀딩 — 사람이 직접 적은 기록을 먼저 본다).
 */
export function pickLastTouch(input: {
  activity?: TouchInput[]
  service?: TouchInput[]
  quote?: TouchInput[]
  repair?: TouchInput[]
  /** 의뢰서 — 사업장이 걸린 건만 들어온다(db/inquiry_customer_device_20261120.sql). */
  inquiry?: TouchInput[]
  /** 포캐스트 — 등록일·종료일. 고친 시각은 넣지 않는다. */
  forecast?: TouchInput[]
  /** 홀딩 — 시작일·해결일. */
  holding?: TouchInput[]
}): LastTouch | null {
  const groups: [TouchSource, TouchInput[]][] = [
    ['영업활동', input.activity ?? []],
    ['서비스', input.service ?? []],
    ['견적', input.quote ?? []],
    ['수리', input.repair ?? []],
    ['의뢰', input.inquiry ?? []],
    ['포캐스트', input.forecast ?? []],
    ['홀딩', input.holding ?? []],
  ]
  let best: LastTouch | null = null
  for (const [source, list] of groups) {
    for (const raw of list) {
      const entry = entryOf(raw)
      const date = touchDate(entry.date)
      if (!date) continue
      if (best === null || date > best.date) best = { date, source, actorId: entry.actorId ?? null }
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

type Rows = { customer_id: number | null; date: string | null; actorId?: number | null }[]

/**
 * 날짜 하나로 맞춘다. 시각이면 **한국 날짜**로 읽고(kstYmd), 날짜면 그대로 둔다.
 * 빈 값은 빈 글자 — group 이 걸러 낸다.
 */
function dayOf(value: string | null | undefined): string {
  const s = (value ?? '').trim()
  if (!s) return ''
  return s.length > 10 ? kstYmd(s) : s
}

/** 한 표를 읽어 (업체 → 접점 목록) 으로 바꾼다. */
function group(rows: Rows): Map<number, TouchEntry[]> {
  const map = new Map<number, TouchEntry[]>()
  for (const r of rows) {
    const id = Number(r.customer_id)
    if (!Number.isFinite(id)) continue
    const date = touchDate(r.date)
    if (!date) continue
    const entry: TouchEntry = { date, actorId: r.actorId ?? null }
    const list = map.get(id)
    if (list) list.push(entry)
    else map.set(id, [entry])
  }
  return map
}

/**
 * 모든 업체의 마지막 접점. 갈래마다 표를 한 번씩 읽는다(각 5,000줄까지).
 * supabase 클라이언트는 화면용·service role 어느 쪽이든 된다.
 */
/**
 * 의뢰서에 customer_id 칸이 있는가. 한 번 실패하면 그 세션에서는 다시 묻지 않는다
 * (칸을 더하기 전에는 목록을 열 때마다 400 이 쌓인다).
 */
let inquiryLinked = true

export async function loadLastTouchMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any, any, any>,
): Promise<Map<number, LastTouch>> {
  // 작성자도 함께 읽는다 — 목록 보기의 「최근 활동 · 작성자」 칸이 쓴다.
  //   영업활동 engineer_id · 견적 engineer_id(실적 귀속자) · 수리 created_by
  //   서비스는 참여자가 다대다라 service_engineers 를 한 번 더 읽어 **첫 사람**을 쓴다.
  const [act, svc, quo, rep, se, inq, fc, hold] = await Promise.all([
    sb.from('sales_activities').select('customer_id, activity_date, engineer_id').range(0, 5000),
    sb.from('service_history').select('customer_id, visit_date, service_id').range(0, 5000),
    sb.from('quotes').select('customer_id, quote_date, engineer_id').range(0, 5000),
    sb.from('repairs').select('customer_id, received_date, shipped_date, created_by').range(0, 5000),
    sb.from('service_engineers').select('service_id, engineer_id').range(0, 5000),
    // 의뢰서 — customer_id 칸은 2026-11-20 에 더했다(db/inquiry_customer_device_20261120.sql).
    // **칸이 아직 없는 DB 에서도 나머지는 돌아야 한다** — 실패하면 빈 묶음으로 둔다
    // (name_en 때와 같은 방식이다. 칸이 없으면 42703, 캐시가 옛 것이면 PGRST204 가 온다).
    inquiryLinked
      ? sb.from('inquiries').select('customer_id, issued_date, created_by').range(0, 5000)
      : Promise.resolve({ data: [], error: null }),
    // 포캐스트·홀딩 — **활동 이력에 줄로 나오는 종류**라 함께 센다(2026-11-22).
    // 고친 시각(updated_at)은 읽지 않는다 — 제목만 고친 것은 활동이 아니다.
    sb.from('sales_opportunities').select('customer_id, created_at, closed_at, engineer_id').range(0, 5000),
    sb.from('holdings').select('customer_id, started_at, resolved_at, created_by').range(0, 5000),
  ])
  if (inq.error) {
    inquiryLinked = false
    console.warn('[lastTouch] 의뢰서는 건너뛴다 — 이 세션에서는 더 묻지 않는다', inq.error.code, inq.error.message)
  }
  // 서비스 한 건의 첫 참여자(id 가 작은 쪽 — 같은 건이면 늘 같은 사람이 나온다).
  const firstEngineer = new Map<number, number>()
  for (const r of (se.data ?? []) as { service_id: number | null; engineer_id: number | null }[]) {
    const sid = Number(r.service_id); const eid = Number(r.engineer_id)
    if (!Number.isFinite(sid) || !Number.isFinite(eid)) continue
    const cur = firstEngineer.get(sid)
    if (cur === undefined || eid < cur) firstEngineer.set(sid, eid)
  }

  const byId = new Map<number, LastTouch>()
  const activity = group((act.data ?? []).map(r => ({ customer_id: r.customer_id, date: r.activity_date, actorId: r.engineer_id })))
  const service = group((svc.data ?? []).map(r => ({ customer_id: r.customer_id, date: r.visit_date, actorId: firstEngineer.get(Number(r.service_id)) ?? null })))
  const quote = group((quo.data ?? []).map(r => ({ customer_id: r.customer_id, date: r.quote_date, actorId: r.engineer_id })))
  // 수리는 출고일이 있으면 그날, 없으면 입고일이 마지막 움직임이다.
  const repair = group((rep.data ?? []).map(r => ({ customer_id: r.customer_id, date: r.shipped_date ?? r.received_date, actorId: r.created_by })))
  const inquiry = group((inq.data ?? []).map(r => ({ customer_id: r.customer_id, date: r.issued_date, actorId: r.created_by })))
  // 포캐스트는 한 줄에서 **두 날**이 나온다(등록·종료). 홀딩도 둘이다(시작·해결).
  const fcRows = (fc.data ?? []) as { customer_id: number | null; created_at: string | null; closed_at: string | null; engineer_id: number | null }[]
  const forecast = group([
    ...fcRows.map(r => ({ customer_id: r.customer_id, date: dayOf(r.created_at), actorId: r.engineer_id })),
    ...fcRows.map(r => ({ customer_id: r.customer_id, date: dayOf(r.closed_at), actorId: r.engineer_id })),
  ])
  const holdRows = (hold.data ?? []) as { customer_id: number | null; started_at: string | null; resolved_at: string | null; created_by: number | null }[]
  const holding = group([
    ...holdRows.map(r => ({ customer_id: r.customer_id, date: dayOf(r.started_at), actorId: r.created_by })),
    ...holdRows.map(r => ({ customer_id: r.customer_id, date: dayOf(r.resolved_at), actorId: r.created_by })),
  ])

  const ids = new Set<number>([
    ...activity.keys(), ...service.keys(), ...quote.keys(), ...repair.keys(), ...inquiry.keys(),
    ...forecast.keys(), ...holding.keys(),
  ])
  for (const id of ids) {
    const touch = pickLastTouch({
      activity: activity.get(id), service: service.get(id), quote: quote.get(id), repair: repair.get(id),
      inquiry: inquiry.get(id), forecast: forecast.get(id), holding: holding.get(id),
    })
    if (touch) byId.set(id, touch)
  }
  return byId
}
