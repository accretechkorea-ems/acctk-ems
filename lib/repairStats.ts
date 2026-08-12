import type { Repair } from '@/hooks/useRepairs'

// ============================================================
// 20 수리 통계용 순수 함수 모음. 화면(React)에 의존하지 않는다.
//  - 모든 날짜는 'YYYY-MM-DD'(또는 그 접두) 문자열 기준.
//  - 파싱 불가/누락 날짜는 각 함수 주석에 명시한 규칙대로 처리한다.
//  - product_type 은 원본 그대로 사용(정규화·병합하지 않는다).
// ============================================================

/**
 * 특이사항 유형(special_type: 본사수리·수리불가·수리진행안함)이 지정된 건은 일반 수리 흐름이
 * 아니므로 수리 '성과' 통계에서 제외한다. special_type == null 이면 정상 수리 건.
 * (물리 보유·접수 사실 자체를 세는 지표 — 보유/도넛·고객·모델·재입고·최근 입고 — 에는 쓰지 않는다.)
 */
export function isNormalRepair(r: Repair): boolean {
  return r.special_type == null
}

/** special_type 이 있는 건을 제외한 목록(성과 통계 입력용). */
export function excludeSpecial(rows: Repair[]): Repair[] {
  return rows.filter(isNormalRepair)
}

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

/**
 * 이번 달을 포함한 최근 count 개월의 'YYYY-MM' 배열(오름차순, 고정 범위).
 * 데이터와 무관하게 '지금' 기준으로 만들어 달이 바뀌면 자동으로 이번 달이 포함된다.
 * (입출고·잔량 추이 등 '최근 N개월' 그래프가 0인 달도 축에 표시하도록 공용으로 쓴다.)
 */
export function recentMonths(count: number): string[] {
  const now = new Date()
  const ey = now.getFullYear(), em = now.getMonth() + 1
  const startDate = new Date(Date.UTC(ey, em - 1 - (count - 1), 1))
  const startYM = `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}`
  const endYM = `${ey}-${String(em).padStart(2, '0')}`
  return fillMonthRange(startYM, endYM)
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
 * 이번 달 포함 최근 count 개월(고정 범위)의 접수/출고 건수. 0인 달도 포함.
 * monthlyCounts 와 달리 데이터가 없는 최근 달(예: 이번 달 0건)도 축에 남는다.
 */
export function monthlyCountsRecent(rows: Repair[], count = 6): { month: string; received: number; shipped: number }[] {
  const rec = new Map<string, number>()
  const shp = new Map<string, number>()
  for (const r of rows) {
    const rm = monthOf(r.received_date)
    if (rm) rec.set(rm, (rec.get(rm) ?? 0) + 1)
    const sm = monthOf(r.shipped_date)
    if (sm) shp.set(sm, (shp.get(sm) ?? 0) + 1)
  }
  return recentMonths(count).map(m => ({ month: m, received: rec.get(m) ?? 0, shipped: shp.get(m) ?? 0 }))
}

/**
 * 리드타임 구간 분포: 0-3일 / 4-7일 / 8-14일 / 15일+.
 * getLeadTime === null 인 행은 제외. 음수 이상치는 0으로 보정하여 '0-3일'에 포함.
 * (항상 4개 구간을 count 0 이상으로 반환)
 */
export function leadTimeBuckets(rows: Repair[]): { label: string; count: number }[] {
  const buckets = [
    { label: '3일 이내', lo: 0, hi: 3 },
    { label: '4-7일', lo: 4, hi: 7 },
    { label: '8-14일', lo: 8, hi: 14 },
    { label: '15일 이상', lo: 15, hi: Infinity },
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
 * 이번 달을 제외한 직전 count 개월(고정 범위)의 월말 미출고 잔량 + 전월 대비 증감(delta).
 * 미출고 잔량은 '그 달이 끝난 시점의 잔량' 지표라 아직 진행 중인 이번 달은 값이 확정되지 않아 제외한다.
 * (예: 오늘 2026-08 → 2026-02 ~ 2026-07. 현재 잔량은 별도 KPI '현재 보유' 가 보여준다.)
 * delta = 그 달 월말 잔량 − 전월 월말 잔량. 가장 오래된 달의 delta 를 위해 한 달 앞을 추가로 계산한다.
 * 데이터가 0이어도 고정 범위라 항상 count 개월을 반환한다(0인 달도 축에 표시).
 *
 * ── 기준: '미출고'(고객에게 아직 출고되지 않음) = received_date <= endM 이고 shipped 되지 않음.
 *    본사에 나가 있어도(본사수리 발송 중) 고객 출고가 아니므로 잔량에 포함한다. 본사 발송/복귀는 입고·출고
 *    이벤트가 없어, 제외하면 '전월말 잔량 + 입고 − 출고 = 당월말 잔량' 검산이 어긋난다.
 *    성과 통계가 아니므로 excludeSpecial 을 적용하지 않은 전체 repairs 를 넣어야 '현재 보유' KPI·입출고 추이와 수가 맞는다. ──
 * 각 월 M(그 달 마지막 날 endM) 기준, received_date <= endM 인 건에 대해 출고 판정은 '현재 status' 가 아니라 shipped_date 로 한다(과거 시점 재현):
 *   - shipped_date 있음: endM 이하면 그 시점 이미 출고됨 → 제외, endM 초과면 아직 미출고 → 포함.
 *   - shipped_date 없음: 날짜 없는 레거시 '출고완료' 만 출고된 것으로 보고 제외(그 외는 미출고 → 포함).
 *   ※ 과거 버그: status==='출고완료' 를 먼저 걸러, 다음 달에 출고된 건까지 이전 달 잔량에서 빠져 과소집계됐다.
 */
export function monthlyBacklogRecent(rows: Repair[], count = 6): { month: string; backlog: number; delta: number }[] {
  const backlogAt = (m: string): number => {
    const [y, mo] = m.split('-').map(Number)
    const endM = new Date(Date.UTC(y, mo, 0)) // 그 달 마지막 날
    let backlog = 0
    for (const r of rows) {
      const rec = parseDate(r.received_date)
      if (!rec || rec > endM) continue         // 그 달 말까지 아직 입고 전
      // 월말 시점 출고 여부는 shipped_date 로 판단(현재 status 로 판단하면 이후 달 출고분까지 과거 잔량에서 빠진다).
      const shp = parseDate(r.shipped_date)
      if (shp) { if (shp <= endM) continue }    // 월말 이전 출고 → 제외
      else if (r.status === '출고완료') continue // 날짜 없는 레거시 출고완료만 출고로 간주(전 기간 제외)
      // 본사 발송 중이어도 고객 출고 전이므로 미출고 잔량에 포함(입출고 이벤트와 검산 일치).
      backlog++
    }
    return backlog
  }
  // recentMonths(count+2) = 이번 달 포함 count+2 개월 → 마지막(이번 달) 하나를 떼어 '이번 달 제외 + delta 계산용 앞 1개월' 포함(count+1개).
  const months = recentMonths(count + 2).slice(0, -1)
  const series = months.map(m => ({ month: m, backlog: backlogAt(m) }))
  return series.slice(1).map((cur, i) => ({ month: cur.month, backlog: cur.backlog, delta: cur.backlog - series[i].backlog }))
}

// ============================================================
// 본사수리 전용 통계. special_type='본사수리' 건의 발송(hq_requested_at)·복귀(hq_returned_at) 기준.
// (hq_* 컬럼은 본사수리 건에만 채워지므로 special_type 가드는 방어적.)
// ============================================================

/** 본사에 나가 있는(발송 후 미복귀) 건 여부. special_type='본사수리' AND hq_returned_at 없음. */
export function isAtHq(r: Repair): boolean {
  return r.special_type === '본사수리' && !r.hq_returned_at
}

/** 현재 본사 발송 중(미복귀) 건수. */
export function hqOutstandingCount(rows: Repair[]): number {
  return rows.filter(isAtHq).length
}

/**
 * 본사 평균 소요일 = (hq_returned_at - hq_requested_at) 평균(소수 1자리). 복귀 완료된 건만.
 * 두 날짜 중 하나라도 없거나 파싱 불가면 제외. 음수(복귀<발송) 제외. 유효 0개면 null.
 */
export function hqAvgTurnaround(rows: Repair[]): number | null {
  const vals: number[] = []
  for (const r of rows) {
    if (r.special_type !== '본사수리') continue
    const req = parseDate(r.hq_requested_at)
    const ret = parseDate(r.hq_returned_at)
    if (!req || !ret) continue
    const d = Math.round((ret.getTime() - req.getTime()) / DAY)
    if (d < 0) continue
    vals.push(d)
  }
  if (vals.length === 0) return null
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10
}

/** 특정 'YYYY-MM' 의 본사 발송(hq_requested_at)·복귀(hq_returned_at) 건수. */
export function hqMonthCounts(rows: Repair[], month: string): { requested: number; returned: number } {
  let requested = 0, returned = 0
  for (const r of rows) {
    if (r.special_type !== '본사수리') continue
    if (monthOf(r.hq_requested_at) === month) requested++
    if (monthOf(r.hq_returned_at) === month) returned++
  }
  return { requested, returned }
}

/**
 * 최근 N개월(기본 6, 이번 달 포함) 본사 발송/복귀 건수. month='YYYY-MM' 오름차순.
 * weeklyByType 과 동일하게 '지금' 기준으로 고정 범위를 만들어 데이터가 0인 달도 포함한다.
 */
export function hqMonthlyFlow(rows: Repair[], months = 6): { month: string; requested: number; returned: number }[] {
  const req = new Map<string, number>()
  const ret = new Map<string, number>()
  for (const r of rows) {
    if (r.special_type !== '본사수리') continue
    const rm = monthOf(r.hq_requested_at)
    if (rm) req.set(rm, (req.get(rm) ?? 0) + 1)
    const tm = monthOf(r.hq_returned_at)
    if (tm) ret.set(tm, (ret.get(tm) ?? 0) + 1)
  }
  return recentMonths(months).map(m => ({ month: m, requested: req.get(m) ?? 0, returned: ret.get(m) ?? 0 }))
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
