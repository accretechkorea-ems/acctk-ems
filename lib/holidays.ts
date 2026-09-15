// 한국 법정공휴일 계산 — 「관공서의 공휴일에 관한 규정」(2026년 현행) 기준.
//
// ── 공휴일 ──
//   양력: 신정 1/1 · 삼일절 3/1 · 노동절 5/1(2026~) · 어린이날 5/5 · 현충일 6/6 ·
//         제헌절 7/17(2026~ 재지정) · 광복절 8/15 · 개천절 10/3 · 한글날 10/9(2013~) · 성탄절 12/25
//   음력: 설 연휴(1/1 전날·1/1·1/2) · 부처님오신날 4/8 · 추석 연휴(8/14·8/15·8/16)
//   노동절·제헌절은 2026년에 공휴일이 됐다(ko.wikipedia「대한민국의 공휴일」연혁:
//   2026-05-01 노동절 공휴일 지정, 2026-05-11 제헌절 재지정). 첫 지시 목록에는 없었으나
//   실제 달력과 대조해 추가했다.
//
// ── 음력 → 양력 ──
// lunar-javascript 로 바꾸되, 이 라이브러리는 중국 표준시(UTC+8) 달력을 쓴다. 한국 음력은
// 한국 표준시(UTC+9) 기준이라, 합삭(신월) 시각이 중국 시간 23시대에 걸리면 한국 쪽 달이
// 하루 늦게 시작한다. 2027년 설날이 그 경우다(합삭 2027-02-06 15:56 UTC → 중국 2/6, 한국 2/7).
// 그래서 그 달의 합삭 시각을 라이브러리와 같은 식(ShouXingUtil.shuoHigh)으로 다시 구해
// 한국 시간으로 옮긴다. KST 가 CST 보다 1시간 빠르므로 한국 쪽은 같거나 하루 늦다.
//
// ── 대체공휴일 (제3조) ──
//   · 설·추석 연휴 — 일요일 또는 다른 공휴일과 겹치면 연휴 다음의 첫 평일              (2014~)
//   · 어린이날 — 토·일요일 또는 다른 공휴일과 겹치면 다음 첫 평일                     (2014~)
//   · 삼일절·광복절·개천절·한글날 — 같은 규칙                                          (2021~)
//   · 부처님오신날·성탄절 — 같은 규칙                                                  (2023~)
//   · 제헌절 — 같은 규칙                                                               (2026~)
//   · 신정·현충일·노동절 — 대체 없음 (노동절: 고용노동부 행정해석, 제3조 대체 조항에 없음)
//   · 밀려난 날이 이미 공휴일(앞서 정한 대체공휴일 포함)이면 그다음 평일
// '다른 공휴일과 겹치면'이 없으면 2025-05-06(어린이날·부처님오신날이 월요일에 겹침)이 빠진다.
// 적용 시작 해를 나눠 둔 것은 지난 해를 조회해도 그해 기준으로 맞게 나오도록 하려는 것이다.
//
// 선거일·임시공휴일은 계산할 수 없으므로 화면(공휴일 관리)에서 수동으로 등록한다.
//
// 서버(라우트)에서만 쓴다 — 음력 계산 라이브러리를 클라이언트 번들에 싣지 않기 위해서다.

import { Lunar, ShouXingUtil, Solar } from 'lunar-javascript'
import { addDays } from './date'

export type Holiday = { date: string; name: string }

/** none = 대체 없음, national = 토·일·겹침 대체, lunar = 일·겹침 대체(연휴 단위) */
type Rule = 'none' | 'national' | 'lunar'
/** subName — 대체공휴일 이름에 쓸 원래 명절 이름(연휴 이틀도 '설날'·'추석'으로 부른다) */
type Base = { date: string; name: string; subName: string; rule: Rule }

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** 0=일 … 6=토. 'YYYY-MM-DD' 를 UTC 로 읽으므로 실행 환경의 시간대와 무관하다. */
function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
const isWeekend = (date: string) => {
  const w = weekdayOf(date)
  return w === 0 || w === 6
}

/** KST − CST, 일 단위. */
const KST_MINUS_CST = 1 / 24
/** 자정 앞뒤 30분 안이면 정밀식으로 다시 잰다 — 라이브러리 shuoHigh 와 같은 기준. */
const MIDNIGHT_GUARD_SEC = 1800

/**
 * 음력 lunarYear 년 month 월의 한국 시작일이 중국 시작일보다 며칠 늦은지(0 또는 1).
 */
function krMonthShift(lunarYear: number, month: number): 0 | 1 {
  const cnStart = Lunar.fromYmd(lunarYear, month, 1).getSolar()
  // J2000(2000-01-01 12:00) 기준 날짜 번호. getJulianDay() 는 그날 0시(…x.5)를 준다.
  const dCN = Math.round(cnStart.getJulianDay() - Solar.J2000 + 0.5)
  // 라이브러리 calcShuo 와 같은 식으로 그 달의 합삭 번호를 잡고, 어긋나면 앞뒤를 본다.
  const k0 = Math.floor((dCN + 8) / 29.5306)
  for (const k of [k0, k0 - 1, k0 + 1]) {
    const w = k * ShouXingUtil.PI_2
    if (Math.floor(ShouXingUtil.shuoHigh(w) + 0.5) !== dCN) continue

    // shuoHigh 와 같은 계산을 한국 시간으로 한다.
    let t = ShouXingUtil.msaLonT2(w) * 36525
    t = t - ShouXingUtil.dtT(t) + ShouXingUtil.ONE_THIRD
    let tKR = t + KST_MINUS_CST
    const sec = ((tKR + 0.5) % 1) * ShouXingUtil.SECOND_PER_DAY
    if (sec < MIDNIGHT_GUARD_SEC || sec > ShouXingUtil.SECOND_PER_DAY - MIDNIGHT_GUARD_SEC) {
      tKR = ShouXingUtil.msaLonT(w) * 36525 - ShouXingUtil.dtT(t) + ShouXingUtil.ONE_THIRD + KST_MINUS_CST
    }
    const shift = Math.floor(tKR + 0.5) - dCN
    if (shift === 0 || shift === 1) return shift
    console.error('[holidays] unexpected KST shift', { lunarYear, month, shift })
    return 0
  }
  // 라이브러리 날짜와 맞는 합삭을 찾지 못했다 — 일어나서는 안 되지만, 멈추지 않고 중국 날짜를 쓴다.
  console.error('[holidays] new moon not found, using CST date', { lunarYear, month })
  return 0
}

/** 한국 음력 → 양력 'YYYY-MM-DD'. 평달만 다룬다(명절은 윤달에 오지 않는다). */
export function krLunarToSolar(lunarYear: number, month: number, day: number): string {
  const cn = Lunar.fromYmd(lunarYear, month, day).getSolar().toYmd()
  return addDays(cn, krMonthShift(lunarYear, month))
}

function baseHolidays(year: number): Base[] {
  /** 그해부터 대체공휴일 대상. 그 전 해에는 대체 없음. */
  const since = (from: number, rule: Rule): Rule => (year >= from ? rule : 'none')
  const fixed = (m: number, d: number, name: string, rule: Rule): Base =>
    ({ date: ymd(year, m, d), name, subName: name, rule })

  const seol = krLunarToSolar(year, 1, 1)
  const chuseok = krLunarToSolar(year, 8, 15)
  const lunarRule = since(2014, 'lunar')

  const list: Base[] = [
    fixed(1, 1, '신정', 'none'),
    // 설 연휴 = 음 12/30(작은달이면 12/29) · 1/1 · 1/2 — '1/1 전날'로 잡으면 두 경우가 한 번에 된다.
    { date: addDays(seol, -1), name: '설날 연휴', subName: '설날', rule: lunarRule },
    { date: seol, name: '설날', subName: '설날', rule: lunarRule },
    { date: addDays(seol, 1), name: '설날 연휴', subName: '설날', rule: lunarRule },
    fixed(3, 1, '삼일절', since(2021, 'national')),
    fixed(5, 5, '어린이날', since(2014, 'national')),
    { date: krLunarToSolar(year, 4, 8), name: '부처님오신날', subName: '부처님오신날', rule: since(2023, 'national') },
    fixed(6, 6, '현충일', 'none'),
    fixed(8, 15, '광복절', since(2021, 'national')),
    { date: addDays(chuseok, -1), name: '추석 연휴', subName: '추석', rule: lunarRule },
    { date: chuseok, name: '추석', subName: '추석', rule: lunarRule },
    { date: addDays(chuseok, 1), name: '추석 연휴', subName: '추석', rule: lunarRule },
    fixed(10, 3, '개천절', since(2021, 'national')),
    fixed(12, 25, '성탄절', since(2023, 'national')),
  ]
  if (year >= 2013) list.push(fixed(10, 9, '한글날', since(2021, 'national')))
  if (year >= 2026) {
    // 노동절은 대체공휴일 대상이 아니다(고용노동부 행정해석 — 규정 제3조 대체공휴일 조항에 없다).
    list.push(fixed(5, 1, '노동절', 'none'))
    list.push(fixed(7, 17, '제헌절', 'national'))
  }
  return list
}

/**
 * 한 날짜에 모인 공휴일 때문에 생기는 대체공휴일 수.
 *   일요일 — 대체 대상 공휴일 전부
 *   토요일 — 국경일류(national) 전부 + 설·추석은 다른 공휴일과 겹쳤을 때만
 *   평일   — 그날 하나는 쉬므로 겹친 수만큼(대체 대상인 것까지만)
 */
function substituteCount(date: string, hs: Base[]): number {
  const eligible = hs.filter(h => h.rule !== 'none')
  if (eligible.length === 0) return 0
  const w = weekdayOf(date)
  if (w === 0) return eligible.length
  if (w === 6) {
    const national = eligible.filter(h => h.rule === 'national').length
    const lunar = eligible.length - national
    return national + (hs.length >= 2 ? lunar : 0)
  }
  return Math.min(eligible.length, hs.length - 1)
}

/**
 * 그해 한국 법정공휴일(대체공휴일 포함). 날짜 오름차순.
 * 같은 날 두 공휴일이 겹치면 한 줄로 합치고 이름을 '·' 로 잇는다(company_holidays 는 날짜가 PK).
 */
export function computeKoreanHolidays(year: number): Holiday[] {
  const byDate = new Map<string, Base[]>()
  for (const h of baseHolidays(year)) {
    const list = byDate.get(h.date)
    if (list) list.push(h)
    else byDate.set(h.date, [h])
  }

  const names = new Map<string, string>()
  for (const [date, hs] of byDate) names.set(date, [...new Set(hs.map(h => h.name))].join('·'))

  // 날짜 순으로 처리해야 앞선 대체공휴일이 뒤의 대체공휴일 자리를 먼저 차지한다.
  // 모든 원래 공휴일을 먼저 '차 있음'으로 두므로, 연휴 중간 날은 자연히 건너뛴다
  // (= '연휴 다음의 첫 평일' 규칙과 같은 결과).
  const taken = new Set(byDate.keys())
  const ordered = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [date, hs] of ordered) {
    const n = substituteCount(date, hs)
    if (n === 0) continue
    const label = [...new Set(hs.filter(h => h.rule !== 'none').map(h => h.subName))].join('·')
    let cursor = date
    for (let i = 0; i < n; i++) {
      do { cursor = addDays(cursor, 1) } while (isWeekend(cursor) || taken.has(cursor))
      taken.add(cursor)
      names.set(cursor, `대체공휴일(${label})`)
    }
  }

  return [...names.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, name]) => ({ date, name }))
}
