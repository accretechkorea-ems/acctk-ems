// 작업시간(시각) 계산 유틸 — 점심시간(12:00~13:00) 공제 포함.
// ServiceAddModal / ServiceEditModal 공용.

export const TIME_MIN = 0
export const TIME_MAX = 23 * 60 + 30 // 23:30
const LUNCH_START = 12 * 60          // 12:00
const LUNCH_END = 13 * 60            // 13:00
const DAY_START = 8 * 60 + 30        // 08:30 (역산 기준 시작시각)

// "HH:MM" ↔ 분
export const toMin = (t: string) => {
  const [h, m] = (t || '0:0').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
export const toHHMM = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

// 30분 단위 증감, 00:00~23:30 에서 멈춤(순환 없음)
export const stepTime = (t: string, delta: number) =>
  toHHMM(Math.min(TIME_MAX, Math.max(TIME_MIN, toMin(t) + delta)))

// DB time("08:30:00") → "08:30"
export const normTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : '')

// 점심 겹침(시간, 소수) = max(0, min(종료,13:00) - max(시작,12:00)) / 60
export function lunchOverlapHours(start: string, end: string): number {
  const s = toMin(start), e = toMin(end)
  return Math.max(0, Math.min(e, LUNCH_END) - Math.max(s, LUNCH_START)) / 60
}

/**
 * 작업시간(시간, 소수) = 총시간 - 점심 겹침.
 * 검증:
 *   08:30 ~ 12:30 → 3.5
 *   12:30 ~ 17:30 → 4.5
 *   08:30 ~ 17:30 → 8
 *   09:00 ~ 11:00 → 2
 *   13:00 ~ 17:30 → 4.5
 */
export function computeWorkHours(start: string, end: string): number {
  const total = (toMin(end) - toMin(start)) / 60
  return total - lunchOverlapHours(start, end)
}

/**
 * 순수 work_hours 로부터 종료시각 역산(08:30 기준, 점심시간을 더해 보정).
 *   후보종료 = 08:30 + work_hours
 *   겹침     = [08:30, 후보종료] ∩ [12:00, 13:00]
 *   종료     = 후보종료 + 겹침
 * 예: work_hours 8 → 17:30 (역산 후 computeWorkHours 하면 다시 8)
 */
export function reverseEndTime(workHours: number): string {
  const candidate = DAY_START + Math.round(workHours * 60)
  const overlap = Math.max(0, Math.min(candidate, LUNCH_END) - Math.max(DAY_START, LUNCH_START))
  return toHHMM(Math.min(TIME_MAX, candidate + overlap))
}
