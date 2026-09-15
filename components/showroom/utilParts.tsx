'use client'

// 가동률 화면 공용 부품 — 막대·증감·숫자 표기.
// 색은 전부 기존 값이다: 막대 트랙 #f3f4f6(NEUTRAL_BG), 채움은 구간 색(lib/showroom.ts
// UTIL_BAND_COLORS = categoryColors 의 A/S·교육·B/S), 증가는 교육 초록, 감소는 흐림 회색.

import { SERVICE_TYPE_COLORS } from '@/lib/categoryColors'
import { UTIL_BAND_COLORS, utilBand, round1 } from '@/lib/showroom'
import { NEUTRAL_BG, MUTED } from '@/components/common/ui'

/** 증가 색 — 교육 초록의 글자색(배경 위에서 읽히는 쪽). */
const UP_COLOR = SERVICE_TYPE_COLORS['교육'].text

export const fmtPct = (rate: number | null, digits = 1): string =>
  rate == null ? '—' : `${(rate * 100).toFixed(digits)}%`

export const fmtNum = (n: number, digits = 0): string =>
  n.toLocaleString('ko-KR', { maximumFractionDigits: digits })

export const fmtHours = (h: number): string => `${fmtNum(round1(h), 1)}h`

export const fmtWon = (n: number): string => `₩${fmtNum(Math.round(n))}`

/** 받침이 있으면 「과」, 없으면 「와」 — 「전월과 같음」「전 분기와 같음」. */
const withGwa = (word: string): string => {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  return code >= 0 && code < 11172 && code % 28 !== 0 ? `${word}과` : `${word}와`
}

/**
 * 직전 기간 대비 증감. 증가 = ▲ 초록, 감소 = ▼ 회색, 같으면 회색 '—'.
 * 증가가 늘 좋은 지표(건수·시간·연결)에만 쓴다. basis 는 비교 기준 이름(전월·전 분기·직전 기간 …).
 */
export function Delta({ diff, unit = '', digits = 0, basis = '전월' }: {
  diff: number | null
  unit?: string
  digits?: number
  basis?: string
}) {
  if (diff == null) return <span style={{ fontSize: 12, color: MUTED }}>{basis} 비교 없음</span>
  const v = Number(diff.toFixed(digits))
  if (v === 0) return <span style={{ fontSize: 12, color: MUTED }}>— {withGwa(basis)} 같음</span>
  const up = v > 0
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: up ? UP_COLOR : MUTED }}>
      {up ? '▲' : '▼'} {fmtNum(Math.abs(v), digits)}{unit}
      <span style={{ fontWeight: 400, color: MUTED }}> {basis} 대비</span>
    </span>
  )
}

/**
 * 가동률 막대. 트랙은 전체 폭, 채움은 구간 색.
 * 100% 를 넘는 달(평일 사용이 기준시간을 넘은 경우)은 막대를 가득 채우고 숫자로 초과분을 보인다.
 */
export function UtilBar({ rate, height = 8, radius = 4 }: { rate: number | null; height?: number; radius?: number }) {
  const band = utilBand(rate)
  const fill = rate == null ? 0 : Math.min(1, Math.max(0, rate))
  return (
    <div style={{ height, background: NEUTRAL_BG, borderRadius: radius, overflow: 'hidden' }}>
      {band && fill > 0 && (
        <div style={{
          width: `${fill * 100}%`, height: '100%',
          background: UTIL_BAND_COLORS[band].dot, borderRadius: radius,
        }} />
      )}
    </div>
  )
}

/**
 * 한 계열 가로 막대(0~max 비율). 계열이 하나라 범례 없이 카드 제목이 무엇을 그렸는지 말한다.
 */
export function HBar({ value, max, color, height = 8 }: { value: number; max: number; color: string; height?: number }) {
  const fill = max > 0 ? Math.min(1, value / max) : 0
  return (
    <div style={{ height, background: NEUTRAL_BG, borderRadius: 4, overflow: 'hidden' }}>
      {fill > 0 && <div style={{ width: `${fill * 100}%`, height: '100%', background: color, borderRadius: 4 }} />}
    </div>
  )
}
