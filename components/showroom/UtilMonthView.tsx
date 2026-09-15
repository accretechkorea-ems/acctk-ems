'use client'

// 가동률 기간 보기(월·분기·반기·지정) — 한 화면에 핵심이 다 보이게 조밀하게 짰다.
//   (1) 지표 띠 — 1줄: 총량·평균 가동률(직전 기간 대비 증감) / 2줄: 목적 5종 건수·시간
//       집계 기준(기간·평일·가용시간·휴일 사용)은 평균 가동률 칸 라벨 줄의 느낌표를 누르면 팝오버로 본다
//       (기간은 헤더에 있어 띠에 제목을 두지 않는다).
//   (2) 좌(넓게): 장비별 가동률 — 행을 누르면 전체기록 탭에서 그 장비·이 기간의 사용 기록을 연다.
//       사무실을 「전체」로 보면 사무실별로 묶고 소제목에 그 사무실 평균 가동률을 붙인다.
//   (3) 우(좁게): 영업 연결(고객 데모 → 견적·수주) → 고객사별 활동(상위 5)
//   1179px 이하에서는 좌우를 한 열로 쌓는다(고객사 상세 app/customer/[id] 의 브레이크포인트와 같은 값).
// 값은 전부 서버가 계산한 것이다(사무실 필터도 서버가 반영한다). 레이아웃 클래스(.sr-kpi*, .sr-mgrid)는
// UtilizationTab 의 STRIP_CSS 에 있다 — 첫 로딩 스켈레톤이 같은 모양을 써야 로딩이 끝날 때 화면이 튀지 않는다.
// 글자는 글자색 토큰을 쓰고 계열 색은 막대·점에만 칠한다(가동률 % 만 지시에 따라 구간 글자색을 쓰고,
// 옆에 구간 이름을 함께 적어 색만으로 읽지 않게 한다).

import { Fragment, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useOutsideClick } from '@/hooks/useOutsideClick'
import { Z } from '@/lib/zIndex'
import { getCategoryColor } from '@/lib/categoryColors'
import { addDays } from '@/lib/date'
import {
  USAGE_PURPOSES, USAGE_PURPOSE_COLORS, UTIL_BAND_COLORS, UTIL_BAND_LABEL, utilBand, round1, weekdayOfDate,
  type DeviceUtilStat, type MonthMetrics, type ShowroomStats,
} from '@/lib/showroom'
import {
  BLUE, BORDER, CARD_BG, TEXT, MUTED, SUB, FAINT, NEUTRAL_BG, ROW_HOVER_BG,
  cardStyle, cardHeader, cardTitle, countBadge, btnPrimary,
} from '@/components/common/ui'
import { Delta, UtilBar, HBar, fmtPct, fmtNum, fmtHours, fmtWon } from './utilParts'

type Props = {
  stats: ShowroomStats
  /** 증감 비교 기준 이름 — 「전월」「전 분기」「직전 기간」… */
  basis: string
  onOpenDevice: (device: DeviceUtilStat) => void
  onAddUsage: () => void
}

/** 우측 고객사 카드에 보이는 행 수. */
const SHOW_TOP = 5

/** 1줄 지표 칸 안쪽 여백. 집계 기준 아이콘을 평균 가동률 칸 라벨 줄에 맞출 때도 쓴다. */
const METRIC_PAD_Y = 10
const METRIC_PAD_X = 12
/** cardStyle 의 padding(14px 16px) — 아이콘 위치 계산용. */
const CARD_PAD_Y = 14
const CARD_PAD_X = 16

const noteStyle: CSSProperties = { fontSize: 11, color: MUTED, lineHeight: 1.6 }
const hintStyle: CSSProperties = { fontSize: 11, color: MUTED, fontWeight: 500 }
/** 우측 카드 — 제목을 한 단계 작게(17 → 15), 머리 여백도 줄인다. */
const sideHeader: CSSProperties = { ...cardHeader, paddingBottom: 8, marginBottom: 8 }
const sideTitle: CSSProperties = { fontSize: 15, fontWeight: 700, color: TEXT }
const chip = (active: boolean): CSSProperties => ({
  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
  background: NEUTRAL_BG, color: active ? BLUE : FAINT, whiteSpace: 'nowrap',
})

// 행 hover — 행마다 상태를 두지 않고 CSS 로 칠한다. 키보드 초점에도 같은 표시.
const ROW_CSS = `
  .sr-rowlink { transition: background 0.15s ease; }
  .sr-rowlink:hover, .sr-rowlink:focus-visible { background: ${ROW_HOVER_BG}; outline: none; }
`

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`
/** 전환율 표기 — 소수 첫째 자리까지, 끝의 .0 은 뗀다(40% · 33.3%). */
const pctShort = (rate: number) => `${Number((rate * 100).toFixed(1))}%`

/** from~to(양 끝 포함)의 월~금 날짜 수 — 공휴일 여부와 무관하게 센다. 달·해를 넘어가도 된다. */
function monToFriCount(from: string, to: string): number {
  let n = 0
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = weekdayOfDate(d)
    if (w !== 0 && w !== 6) n++
  }
  return n
}

/**
 * 집계 기준 팝오버 — 느낌표 아이콘을 누르면 열린다. 바깥 클릭·ESC 는 공용 useOutsideClick 이 닫는다.
 * 아이콘과 패널을 같은 감싸개(ref) 안에 두므로 아이콘 클릭은 '바깥'이 아니다 — 토글과 부딪히지 않는다.
 * 모양은 예전 사용 기록 모달의 안내 팝오버와 같다.
 */
function RangeInfo({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useOutsideClick(ref, () => setOpen(false), open)
  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex' }}>
      <button type="button" aria-label="집계 기준" aria-expanded={open} onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: open ? BLUE : MUTED, display: 'inline-flex', alignItems: 'center' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </button>
      {open && (
        <div role="note" style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: Z.popover, width: 260,
          background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)', padding: '8px 10px',
          fontSize: 12, fontWeight: 500, color: TEXT, lineHeight: 1.6,
        }}>
          {lines.map(l => <div key={l}>{l}</div>)}
        </div>
      )}
    </div>
  )
}

/** 1줄 지표 — 값 22/800 + 직전 기간 대비 증감. */
function Metric({ label, value, unit, valueColor, sub, delta }: {
  label: string
  value: string
  unit?: string
  valueColor?: string
  sub?: ReactNode
  delta: ReactNode
}) {
  return (
    <div style={{ background: CARD_BG, padding: `${METRIC_PAD_Y}px ${METRIC_PAD_X}px`, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>{label}</div>
      <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: valueColor ?? TEXT, letterSpacing: '-0.5px', lineHeight: 1.2 }}>{value}</span>
        {unit && <span style={{ fontSize: 13, fontWeight: 600, color: MUTED }}>{unit}</span>}
        {sub && (
          <span style={{ marginLeft: 4, fontSize: 11, color: SUB, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
        )}
      </div>
      <div style={{ marginTop: 3 }}>{delta}</div>
    </div>
  )
}

/** 2줄 지표 — 목적 dot + 「27건 · 191h」(건수 18/800, 시간 13/600 MUTED). 0건은 흐리게. */
function PurposeMetric({ label, dot, count, hours }: { label: string; dot: string; count: number; hours: number }) {
  const empty = count === 0
  return (
    <div style={{ background: CARD_BG, padding: '8px 12px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: empty ? FAINT : MUTED }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: empty ? FAINT : dot, flexShrink: 0 }} />
        {label}
      </div>
      <div style={{ marginTop: 3, display: 'flex', alignItems: 'baseline', gap: 3, minWidth: 0, whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: empty ? FAINT : TEXT, letterSpacing: '-0.3px', lineHeight: 1.2 }}>{fmtNum(count)}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: empty ? FAINT : MUTED }}>건</span>
        <span style={{ fontSize: 13, color: FAINT }}>·</span>
        <span className="num" style={{ fontSize: 13, fontWeight: 600, color: empty ? FAINT : MUTED }}>{fmtHours(hours)}</span>
      </div>
    </div>
  )
}

/**
 * 영업 연결 — 고객 데모 건수를 분모로 견적·수주 연결을 보인다(측정대행은 견적으로 이어지는 일이 아니다).
 * 막대는 데모 건수 대비 비율이다.
 */
function SalesCard({ m }: { m: MonthMetrics }) {
  const lines = [
    { label: '견적 연결', count: m.quoteLinked, amount: m.quoteAmount, rate: m.quoteRate },
    { label: '수주 연결', count: m.orderLinked, amount: m.orderAmount, rate: m.orderRate },
  ]
  return (
    <div style={cardStyle}>
      <div style={sideHeader}>
        <span style={sideTitle}>영업 연결</span>
      </div>
      {m.demoCount === 0 ? (
        <div style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, color: SUB }}>데모 기록이 없습니다</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 0 8px' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: TEXT }}>고객 데모</span>
            <span style={{ fontSize: 11, color: MUTED }}>기준 건수</span>
            <div style={{ flex: 1 }} />
            <span className="num" style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{fmtNum(m.demoCount)}건</span>
          </div>
          {lines.map(l => (
            <div key={l.label} style={{ padding: '7px 0', borderTop: `1px solid ${BORDER}` }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: TEXT, whiteSpace: 'nowrap' }}>{l.label}</span>
                <div style={{ flex: 1 }} />
                <span className="num" style={{ fontSize: 12, color: SUB, whiteSpace: 'nowrap' }}>
                  {fmtNum(l.count)}건 · {fmtWon(l.amount)} · 전환율 {pctShort(l.rate ?? 0)}
                </span>
              </div>
              <div style={{ marginTop: 5 }}>
                <HBar value={l.count} max={m.demoCount} color={BLUE} height={4} />
              </div>
            </div>
          ))}
        </>
      )}
      <div style={{ ...noteStyle, marginTop: 6 }}>수주 전환율은 연결된 견적의 현재 상태 기준입니다</div>
    </div>
  )
}

/** 장비 한 행 — 1단: 이름·설치위치 … 구간·가동률 / 2단: 막대 + 보조 문구. */
function DeviceRow({ d, first, onOpen }: { d: DeviceUtilStat; first: boolean; onOpen: () => void }) {
  // 0%(또는 계산 불가)는 막대를 회색 트랙만 두고 이름·숫자도 흐리게 — 쓰인 장비가 먼저 눈에 들어오게.
  const dim = d.utilization == null || d.utilization === 0
  const rateColor = dim || !d.band ? MUTED : UTIL_BAND_COLORS[d.band].text
  return (
    <div role="button" tabIndex={0} className="sr-rowlink"
      aria-label={`${d.name} ${fmtPct(d.utilization)} — 사용 기록 보기`}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      style={{ padding: '8px 4px', borderTop: first ? 'none' : `1px solid ${BORDER}`, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: dim ? MUTED : TEXT, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
        <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{d.site_name}</span>
        {d.device_status !== '가동' && (
          <span style={{ ...chip(false), color: SUB, flexShrink: 0 }}>{d.device_status}</span>
        )}
        <div style={{ flex: 1 }} />
        {d.band && <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{UTIL_BAND_LABEL[d.band]}</span>}
        <span style={{ fontSize: 16, fontWeight: 800, color: rateColor, flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
          {fmtPct(d.utilization)}
        </span>
      </div>
      <div style={{ marginTop: 5 }}>
        <UtilBar rate={d.utilization} height={6} radius={3} />
        <div style={{ marginTop: 3, fontSize: 11, color: MUTED }}>
          실사용 {fmtHours(d.used_hours)} / 기준 {fmtHours(d.base_hours)} · {d.count}건
          {d.holiday_hours > 0 && <> (휴일 {fmtHours(d.holiday_hours)} 포함)</>}
        </div>
      </div>
    </div>
  )
}

export default function UtilMonthView({ stats, basis, onOpenDevice, onAddUsage }: Props) {
  const { current: cur, previous: prev, window: win } = stats

  if (win.future) {
    return (
      <div style={cardStyle}>
        <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 14, fontWeight: 600, color: SUB }}>
          아직 오지 않은 기간이라 가동률을 계산하지 않습니다
        </div>
      </div>
    )
  }

  const avgBand = utilBand(cur.avgUtilization)
  const utilDiffPp = cur.avgUtilization != null && prev.avgUtilization != null
    ? (cur.avgUtilization - prev.avgUtilization) * 100
    : null

  // ── 집계 기준 팝오버 문구 ──
  // 평일에 걸린 공휴일 수 = 집계 기간의 월~금 − 서버가 센 평일(공휴일 제외). 주말 공휴일은 원래 평일이 아니다.
  const holidaysOff = win.to ? Math.max(0, monToFriCount(win.from, win.to) - win.weekdays) : 0
  // 해를 넘는 지정 기간은 날짜에 연도까지 적는다(「12/20 ~ 1/10」만으로는 어느 해인지 모른다).
  const crossYear = win.to != null && win.from.slice(0, 4) !== win.to.slice(0, 4)
  const day = (ymd: string) => (crossYear ? ymd : md(ymd))
  // 일 가용시간이 장비마다 같으면 식을 그대로, 다르면 「장비별 가용시간」.
  const dailyHours = [...new Set(stats.devices.map(d => d.daily_hours))]
  const baseLine = dailyHours.length === 1
    ? `평일 ${win.weekdays}일 × ${fmtHours(dailyHours[0])} = ${fmtHours(win.weekdays * dailyHours[0])}`
    : dailyHours.length > 1 ? `평일 ${win.weekdays}일 × 장비별 가용시간` : `평일 ${win.weekdays}일`
  const holidayUse = round1(stats.devices.reduce((s, d) => s + d.holiday_hours, 0))
  const rangeLines = [
    `집계 기간: ${day(win.from)} ~ ${win.to ? day(win.to) : '-'}${win.ongoing ? ' (오늘까지)' : ''}`,
    baseLine,
    holidaysOff > 0 ? `주말·공휴일 제외 (공휴일 ${holidaysOff}일)` : '주말·공휴일 제외',
    ...(holidayUse > 0 ? [`휴일 사용 ${fmtHours(holidayUse)} 포함`] : []),
  ]

  const purposeStat = (p: string) => cur.byPurpose.find(x => x.purpose === p)
  const purposeDot = (p: string) => {
    const c = getCategoryColor(USAGE_PURPOSE_COLORS, p)
    return c.dot ?? c.text
  }
  const customers = stats.customers.slice(0, SHOW_TOP)

  // 「전체」면 장비를 사무실별로 묶는다(서버가 준 가동률 순서는 사무실 안에서 그대로 둔다).
  const grouped = stats.site === 'all' && stats.sites.length > 1
  const groups = grouped
    ? stats.siteUtil
      .map(s => ({ site: s, devices: stats.devices.filter(d => d.site_id === s.customer_id) }))
      .filter(g => g.devices.length > 0)
    : []

  return (
    <>
      <style>{ROW_CSS}</style>

      {/* (1) 지표 띠 — 기간은 헤더에 있으므로 제목을 두지 않는다 */}
      <div style={{ ...cardStyle, marginBottom: 12, position: 'relative' }}>
        {/* 집계 기준 — 평균 가동률 칸(1줄 맨 오른쪽) 라벨 줄 오른쪽 끝.
            지표 띠(.sr-kpi)는 칸 테두리를 자르려고 overflow: hidden 이라 그 안에 두면 팝오버가 잘린다.
            그래서 카드 기준으로 띄우고, 카드·칸 안쪽 여백만큼 들여 라벨 줄에 맞춘다. */}
        <div style={{ position: 'absolute', top: CARD_PAD_Y + METRIC_PAD_Y, right: CARD_PAD_X + METRIC_PAD_X }}>
          <RangeInfo lines={rangeLines} />
        </div>

        <div className="sr-kpi">
          <div className="sr-kpi-row sr-kpi-3">
            <Metric label="총 사용건수" value={fmtNum(cur.count)} unit="건"
              delta={<Delta diff={cur.count - prev.count} unit="건" basis={basis} />} />
            <Metric label="총 실사용시간" value={fmtNum(cur.hours, 1)} unit="h"
              delta={<Delta diff={round1(cur.hours - prev.hours)} unit="h" digits={1} basis={basis} />} />
            <Metric label="평균 가동률" value={fmtPct(cur.avgUtilization)}
              valueColor={avgBand ? UTIL_BAND_COLORS[avgBand].text : MUTED}
              sub={avgBand ? UTIL_BAND_LABEL[avgBand] : '기록 없음'}
              delta={<Delta diff={utilDiffPp} unit="%p" digits={1} basis={basis} />} />
          </div>
        </div>
        <div style={{ height: 1, background: BORDER }} />
        <div className="sr-kpi">
          <div className="sr-kpi-row sr-kpi-5">
            {USAGE_PURPOSES.map(p => {
              const s = purposeStat(p)
              return <PurposeMetric key={p} label={p} dot={purposeDot(p)} count={s?.count ?? 0} hours={s?.hours ?? 0} />
            })}
          </div>
        </div>
      </div>

      {!stats.hasData ? (
        <div style={cardStyle}>
          <div style={{ padding: '32px 0 6px', textAlign: 'center', fontSize: 14, fontWeight: 600, color: SUB }}>
            해당 기간의 사용 기록이 없습니다
          </div>
          <div style={{ textAlign: 'center', fontSize: 12, color: MUTED, marginBottom: 14 }}>
            장비를 쓴 날은 사용 기록을 남겨 주세요. 기록이 쌓이면 가동률이 계산됩니다.
          </div>
          <div style={{ textAlign: 'center', paddingBottom: 22 }}>
            <button onClick={onAddUsage} style={btnPrimary()}>사용 기록 추가</button>
          </div>
        </div>
      ) : (
        <div className="sr-mgrid">
          {/* (2) 좌: 장비별 가동률 */}
          <div className="sr-mleft" style={cardStyle}>
            <div style={cardHeader}>
              <span style={cardTitle}>장비별 가동률</span>
              <span style={countBadge}>{stats.devices.length}대</span>
              <div style={{ flex: 1 }} />
              <span style={hintStyle}>행을 누르면 이 기간 사용 기록</span>
            </div>
            {stats.devices.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: SUB }}>가동률을 계산할 장비가 없습니다</div>
            ) : grouped ? (
              groups.map((g, gi) => {
                const band = utilBand(g.site.avgUtilization)
                return (
                  <Fragment key={g.site.customer_id}>
                    {/* 사무실 소제목 + 그 사무실 평균 가동률 */}
                    <div style={{
                      display: 'flex', alignItems: 'baseline', gap: 8, padding: '8px 4px 6px',
                      borderTop: gi === 0 ? 'none' : `1px solid ${BORDER}`, marginTop: gi === 0 ? 0 : 6,
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{g.site.short}</span>
                      <span style={{ fontSize: 11, color: MUTED }}>{g.devices.length}대</span>
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 11, color: MUTED }}>평균{band ? ` · ${UTIL_BAND_LABEL[band]}` : ''}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: band ? UTIL_BAND_COLORS[band].text : MUTED }}>
                        {fmtPct(g.site.avgUtilization)}
                      </span>
                    </div>
                    {g.devices.map((d, i) => (
                      <DeviceRow key={d.device_id} d={d} first={i === 0} onOpen={() => onOpenDevice(d)} />
                    ))}
                  </Fragment>
                )
              })
            ) : (
              stats.devices.map((d, i) => (
                <DeviceRow key={d.device_id} d={d} first={i === 0} onOpen={() => onOpenDevice(d)} />
              ))
            )}
            <div style={{ ...noteStyle, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${BORDER}` }}>
              가동률 = 실사용시간 ÷ (일 가용시간 × 평일 수 + 휴일 사용시간)<br />
              저가동 30% 미만 · 과부하 80% 초과 · 공휴일 자동 반영 · 평균은 장비 전체 가중 평균
            </div>
          </div>

          {/* (3) 우: 영업 연결 → 고객사 */}
          <div className="sr-mright">
            <SalesCard m={cur} />

            <div style={cardStyle}>
              <div style={sideHeader}>
                <span style={sideTitle}>고객사별 활동</span>
                <div style={{ flex: 1 }} />
                <span style={hintStyle}>상위 {SHOW_TOP}</span>
              </div>
              {customers.length === 0 ? (
                <div style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, color: SUB }}>이 기간에 고객사가 적힌 기록이 없습니다</div>
              ) : customers.map((c, i) => (
                <div key={c.customer_id} style={{ display: 'grid', gridTemplateColumns: '14px minmax(0, 1fr) auto auto', alignItems: 'center', gap: 6, padding: '5px 0', borderTop: i === 0 ? 'none' : `1px solid ${BORDER}` }}>
                  <span className="num" style={{ fontSize: 11, color: MUTED }}>{i + 1}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <span className="num" style={{ fontSize: 12, color: SUB, whiteSpace: 'nowrap' }}>{c.count}건 · {fmtHours(c.hours)}</span>
                  <span style={{ display: 'inline-flex', gap: 3 }}>
                    <span style={chip(c.quoteLinked > 0)}>견적 {c.quoteLinked}</span>
                    <span style={chip(c.orderLinked > 0)}>수주 {c.orderLinked}</span>
                  </span>
                </div>
              ))}
              <div style={{ ...noteStyle, marginTop: 6 }}>전체 {fmtNum(stats.customerTotal)}곳</div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
