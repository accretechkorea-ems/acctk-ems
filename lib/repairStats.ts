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
