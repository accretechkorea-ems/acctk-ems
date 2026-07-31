import type { Repair } from '@/hooks/useRepairs'

// ============================================================
// 20 수리 통계용 순수 함수 모음. 화면(React)에 의존하지 않는다.
//  - 모든 날짜는 'YYYY-MM-DD'(또는 그 접두) 문자열 기준.
//  - 파싱 불가/누락 날짜는 각 함수 주석에 명시한 규칙대로 처리한다.
//  - product_type 은 원본 그대로 사용(정규화·병합하지 않는다).
// ============================================================

/** 'YYYY-MM-DD...' → UTC Date. 형식이 아니거나 유효하지 않으면 null. */
function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s).trim())
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return isNaN(d.getTime()) ? null : d
}

/** 오늘 00:00(UTC 기준, 로컬 달력 날짜). */
function startOfToday(): Date {
  const n = new Date()
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))
}

/** 'YYYY-MM' 추출. 파싱 불가면 null. */
function monthOf(s: string | null | undefined): string | null {
  const d = parseDate(s)
  if (!d) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** startYM~endYM(포함)의 모든 'YYYY-MM'을 순서대로. 중간 빈 달도 포함. */
function fillMonthRange(startYM: string, endYM: string): string[] {
  const [sy, sm] = startYM.split('-').map(Number)
  const [ey, em] = endYM.split('-').map(Number)
  const out: string[] = []
  let y = sy, mo = sm
  // 방어: 잘못된 범위면 빈 배열
  if (!sy || !sm || !ey || !em) return []
  while (y < ey || (y === ey && mo <= em)) {
    out.push(`${y}-${String(mo).padStart(2, '0')}`)
    mo++; if (mo > 12) { mo = 1; y++ }
    if (out.length > 600) break // 안전장치(50년)
  }
  return out
}

const DAY = 86400000

/**
 * 리드타임(일) = 출고일 - 입고일.
 * shipped_date 가 없거나(출고 전) 파싱 불가면 null.
 * received_date 파싱 불가여도 null.
 * ※ 출고일 < 입고일 인 이상치는 음수 그대로 반환(정합성 판단은 호출측).
 */
export function getLeadTime(r: Repair): number | null {
  const rec = parseDate(r.received_date)
  const shp = parseDate(r.shipped_date)
  if (!rec || !shp) return null
  return Math.round((shp.getTime() - rec.getTime()) / DAY)
}

/**
 * 유효 리드타임의 평균(소수 1자리). getLeadTime === null 인 행은 제외.
 * 유효 행 0개면 null.
 */
export function avgLeadTime(rows: Repair[]): number | null {
  const vals = rows.map(getLeadTime).filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10
}

/**
 * 유효 리드타임의 중앙값. getLeadTime === null 인 행은 제외.
 * 유효 행 0개면 null. 짝수 개면 가운데 두 값 평균.
 */
export function medianLeadTime(rows: Repair[]): number | null {
  const vals = rows.map(getLeadTime).filter((v): v is number => v !== null).sort((a, b) => a - b)
  if (vals.length === 0) return null
  const mid = Math.floor(vals.length / 2)
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2
}

/**
 * 실제 수리 기간(일, 소수 1자리) = repair_done_at - repair_started_at.
 * 타임스탬프(시각 포함)라 소수 일수로 계산한다.
 * 둘 중 하나라도 null/파싱불가면 null. 음수(완료<시작)면 null.
 */
export function getRepairDuration(r: Repair): number | null {
  if (!r.repair_started_at || !r.repair_done_at) return null
  const start = new Date(r.repair_started_at).getTime()
  const done = new Date(r.repair_done_at).getTime()
  if (isNaN(start) || isNaN(done)) return null
  const days = (done - start) / DAY
  if (days < 0) return null
  return Math.round(days * 10) / 10
}

/** 유효 수리 기간의 평균(소수 1자리). 유효 행 0개면 null. */
export function avgRepairDuration(rows: Repair[]): number | null {
  const vals = rows.map(getRepairDuration).filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10
}

/** 유효 수리 기간의 중앙값(짝수 개면 가운데 두 값 평균, 소수 1자리). 유효 행 0개면 null. */
export function medianRepairDuration(rows: Repair[]): number | null {
  const vals = rows.map(getRepairDuration).filter((v): v is number => v !== null).sort((a, b) => a - b)
  if (vals.length === 0) return null
  const mid = Math.floor(vals.length / 2)
  return vals.length % 2 ? vals[mid] : Math.round(((vals[mid - 1] + vals[mid]) / 2) * 10) / 10
}

/** getRepairDuration 이 null 이 아닌(유효 수리 기간) 행 수. */
export function countRepairDurationSamples(rows: Repair[]): number {
  return rows.filter(r => getRepairDuration(r) !== null).length
}

/**
 * 경과일 = 오늘 - 입고일 (미출고 건의 대기 일수 산출용).
 * 입고일 파싱 불가면 0. 음수(미래 입고일)는 0으로 보정.
 * ※ 출고 여부는 이 함수가 판단하지 않음 — '미출고' 필터는 호출측에서.
 */
export function getAgingDays(r: Repair): number {
  const rec = parseDate(r.received_date)
  if (!rec) return 0
  return Math.max(0, Math.round((startOfToday().getTime() - rec.getTime()) / DAY))
}

/**
 * 시리얼번호가 있고 2회 이상 등장한 것만 Map<serial, Repair[]>.
 * serial_number 가 null/공백인 행은 제외. 1회만 등장한 시리얼은 결과에서 제거.
 * (해당 시리얼이 하나도 없으면 빈 Map)
 */
export function getRepeatSerials(rows: Repair[]): Map<string, Repair[]> {
  const map = new Map<string, Repair[]>()
  for (const r of rows) {
    const s = (r.serial_number ?? '').trim()
    if (!s) continue
    const arr = map.get(s) ?? []
    arr.push(r)
    map.set(s, arr)
  }
  for (const [k, v] of map) if (v.length < 2) map.delete(k)
  return map
}

/**
 * 월별 접수/출고 건수. month='YYYY-MM'.
 *  - received: received_date 의 월로 집계
 *  - shipped: shipped_date 의 월로 집계(출고된 행만)
 * 데이터가 있는 최소~최대 월 사이의 중간 빈 달도 0으로 채운다.
 * 날짜 파싱 불가 행은 해당 항목 집계에서 제외. 전체 데이터 없으면 빈 배열.
 */
export function monthlyCounts(rows: Repair[]): { month: string; received: number; shipped: number }[] {
  const rec = new Map<string, number>()
  const shp = new Map<string, number>()
  const months = new Set<string>()
  for (const r of rows) {
    const rm = monthOf(r.received_date)
    if (rm) { rec.set(rm, (rec.get(rm) ?? 0) + 1); months.add(rm) }
    const sm = monthOf(r.shipped_date)
    if (sm) { shp.set(sm, (shp.get(sm) ?? 0) + 1); months.add(sm) }
  }
  if (months.size === 0) return []
  const sorted = [...months].sort()
  return fillMonthRange(sorted[0], sorted[sorted.length - 1])
    .map(m => ({ month: m, received: rec.get(m) ?? 0, shipped: shp.get(m) ?? 0 }))
}

/**
 * 리드타임 구간 분포: 0-3일 / 4-7일 / 8-14일 / 15일+.
 * getLeadTime === null 인 행은 제외. 음수 이상치는 0으로 보정하여 '0-3일'에 포함.
 * (항상 4개 구간을 count 0 이상으로 반환)
 */
export function leadTimeBuckets(rows: Repair[]): { label: string; count: number }[] {
  const buckets = [
    { label: '0-3일', lo: 0, hi: 3 },
    { label: '4-7일', lo: 4, hi: 7 },
    { label: '8-14일', lo: 8, hi: 14 },
    { label: '15일+', lo: 15, hi: Infinity },
  ]
  const counts = buckets.map(() => 0)
  for (const r of rows) {
    const d = getLeadTime(r)
    if (d === null) continue
    const v = Math.max(0, d)
    const idx = buckets.findIndex(b => v >= b.lo && v <= b.hi)
    if (idx >= 0) counts[idx]++
  }
  return buckets.map((b, i) => ({ label: b.label, count: counts[i] }))
}

/**
 * 회사명별 접수 건수 랭킹(상위 n). avgLeadTime 은 해당 회사 행들의 평균(없으면 null).
 * customer_name 이 null/공백인 행은 제외. 동률은 정렬 안정성에 따름.
 */
export function customerRanking(rows: Repair[], n: number): { name: string; count: number; avgLeadTime: number | null }[] {
  const groups = new Map<string, Repair[]>()
  for (const r of rows) {
    const name = (r.customer_name ?? '').trim()
    if (!name) continue
    const arr = groups.get(name) ?? []
    arr.push(r)
    groups.set(name, arr)
  }
  return [...groups.entries()]
    .map(([name, rs]) => ({ name, count: rs.length, avgLeadTime: avgLeadTime(rs) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(0, n))
}

/**
 * 제품 구분(product_type)별 건수 랭킹(상위 n). 원본 문자열 그대로 사용(정규화·병합 금지).
 * product_type 이 null/공백인 행은 제외.
 */
export function productRanking(rows: Repair[], n: number): { type: string; count: number }[] {
  const map = new Map<string, number>()
  for (const r of rows) {
    const t = (r.product_type ?? '').trim()
    if (!t) continue
    map.set(t, (map.get(t) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(0, n))
}

/**
 * 월별 누적 접수/출고. monthlyCounts(빈 달 채움·정렬됨)를 누적한 값.
 * 데이터 없으면 빈 배열.
 */
export function cumulativeFlow(rows: Repair[]): { month: string; cumReceived: number; cumShipped: number }[] {
  let cr = 0, cs = 0
  return monthlyCounts(rows).map(({ month, received, shipped }) => {
    cr += received; cs += shipped
    return { month, cumReceived: cr, cumShipped: cs }
  })
}

/**
 * 월별 미출고 잔량(월말 사내 보유 건수) + 그 달 접수/출고/순증감.
 * 축은 전체(접수·출고) 월 범위를 빈 달 포함해 채운다. 데이터 없으면 빈 배열.
 *
 * 각 월 M(그 달 마지막 날 endM) 기준 '사내 보유(잔량)' 판정 — received_date <= endM 이고 아직 미출고:
 *   1) status === '출고완료' → 출고된 것으로 본다 → 잔량 제외 (shipped_date 없어도 마찬가지. 46건이 이 경우)
 *   2) status !== '출고완료' → shipped_date 유무로 판정
 *      - shipped_date 있으면 그 날짜가 endM 이후(월말 이후)일 때만 잔량에 포함
 *      - shipped_date 없으면 잔량에 포함
 * received = 그 달 접수 건수, shipped = 그 달 출고(shipped_date 기준) 건수, net = received - shipped.
 */
export function monthlyBacklog(rows: Repair[]): { month: string; backlog: number; received: number; shipped: number; net: number }[] {
  const months = new Set<string>()
  const recByMonth = new Map<string, number>()
  const shpByMonth = new Map<string, number>()
  for (const r of rows) {
    const rm = monthOf(r.received_date)
    if (rm) { months.add(rm); recByMonth.set(rm, (recByMonth.get(rm) ?? 0) + 1) }
    const sm = monthOf(r.shipped_date)
    if (sm) { months.add(sm); shpByMonth.set(sm, (shpByMonth.get(sm) ?? 0) + 1) }
  }
  if (months.size === 0) return []
  const sorted = [...months].sort()
  return fillMonthRange(sorted[0], sorted[sorted.length - 1]).map(m => {
    const [y, mo] = m.split('-').map(Number)
    const endM = new Date(Date.UTC(y, mo, 0)) // 그 달 마지막 날
    let backlog = 0
    for (const r of rows) {
      const rec = parseDate(r.received_date)
      if (!rec || rec > endM) continue        // 아직 입고 전
      if (r.status === '출고완료') continue    // 출고된 것으로 봄 (dateless 포함)
      const shp = parseDate(r.shipped_date)
      if (shp && shp <= endM) continue         // 월말까지 출고됨
      backlog++
    }
    const received = recByMonth.get(m) ?? 0
    const shipped = shpByMonth.get(m) ?? 0
    return { month: m, backlog, received, shipped, net: received - shipped }
  })
}

/**
 * 월별 평균 소요일 추이. 각 달의 값 = '그 달에 출고된' 건들의 avgLeadTime.
 * 축은 전체 데이터(접수·출고)의 최소~최대 월 범위를 빈 달 포함해 채워 연속성 유지.
 * 해당 월에 출고된 건이 없으면 avg = null (라인이 끊기도록). 전체 데이터 없으면 빈 배열.
 */
export function monthlyLeadTime(rows: Repair[]): { month: string; avg: number | null }[] {
  const shippedByMonth = new Map<string, Repair[]>()
  const months = new Set<string>()
  for (const r of rows) {
    const rm = monthOf(r.received_date)
    if (rm) months.add(rm)
    const sm = monthOf(r.shipped_date)
    if (sm) {
      months.add(sm)
      const a = shippedByMonth.get(sm) ?? []
      a.push(r)
      shippedByMonth.set(sm, a)
    }
  }
  if (months.size === 0) return []
  const sorted = [...months].sort()
  return fillMonthRange(sorted[0], sorted[sorted.length - 1]).map(m => {
    const rs = shippedByMonth.get(m)
    return { month: m, avg: rs ? avgLeadTime(rs) : null }
  })
}

/** d 의 ISO-8601 주차 키 'YYYY-Www' (월요일 시작, 목요일 기준). */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7 // Mon=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3) // 그 주 목요일
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const firstDayNum = (firstThu.getUTCDay() + 6) % 7
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3)
  const week = 1 + Math.round((date.getTime() - firstThu.getTime()) / (7 * DAY))
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * 입고일(received_date) 기준 ISO 주차별 접수 건수. week='YYYY-Www', 시간순 정렬.
 * received_date 파싱 불가 행은 제외. (월별과 달리 빈 주는 채우지 않음)
 * 데이터 없으면 빈 배열.
 */
export function weeklyPattern(rows: Repair[]): { week: string; count: number }[] {
  const map = new Map<string, number>()
  for (const r of rows) {
    const d = parseDate(r.received_date)
    if (!d) continue
    const k = isoWeekKey(d)
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week))
}

/** 해당 UTC 날짜가 속한 주의 월요일(00:00 UTC). */
function mondayOf(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  m.setUTCDate(m.getUTCDate() - day)
  return m
}

/**
 * 최근 N주(기본 8주, 오늘이 속한 주 포함) 구분별 접수 건수.
 *  - received_date 기준 집계. 주 시작 = 월요일(ISO). 라벨 = 주 시작일 'M/D'.
 *  - 접수 0건인 주도 0으로 채운다(구간 비지 않게).
 *  - item_type 이 '게이지'/'앰프' 가 아니거나 null 이면 제외(반환값에 포함하지 않음).
 */
export function weeklyByType(rows: Repair[], weeks = 8): { week: string; gauge: number; amp: number }[] {
  const now = new Date()
  const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const thisMonday = mondayOf(todayUTC)

  const buckets = new Map<number, { gauge: number; amp: number }>()
  const order: number[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const w = new Date(thisMonday.getTime())
    w.setUTCDate(w.getUTCDate() - i * 7)
    buckets.set(w.getTime(), { gauge: 0, amp: 0 })
    order.push(w.getTime())
  }
  const first = order[0]
  const last = order[order.length - 1]

  for (const r of rows) {
    if (r.item_type !== '게이지' && r.item_type !== '앰프') continue
    const rec = parseDate(r.received_date)
    if (!rec) continue
    const mt = mondayOf(rec).getTime()
    if (mt < first || mt > last) continue
    const b = buckets.get(mt)
    if (!b) continue
    if (r.item_type === '게이지') b.gauge++
    else b.amp++
  }

  return order.map(t => {
    const d = new Date(t)
    const b = buckets.get(t)!
    return { week: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, gauge: b.gauge, amp: b.amp }
  })
}
