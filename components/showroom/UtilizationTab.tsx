'use client'

// 가동률 탭 본문 — 기간 보기(월·분기·반기·지정) / 연간 보기(연) + (superadmin) 공휴일 관리.
// 사무실 선택·기간 이동은 화면 헤더(ShowroomHeader)에 있다. 여기서는 받은 사무실·기간으로 불러와 그리기만 한다.
// 숫자는 전부 /api/showroom/stats 가 계산해 준 것이다(사무실 필터도 서버가 한다).
//
// 다시 불러오는 동안에는 직전 화면을 흐리게 그대로 둔다(스켈레톤으로 바꾸면 화면이 튄다).
// 그래서 어느 보기를 그릴지는 지금 고른 기간이 아니라 '받아 둔 결과'로 정한다 — 월 → 연으로 바꾼 직후에도
// 연간 결과가 오기 전까지는 기간 보기가 흐리게 남는다. 스켈레톤은 처음 한 번만 보인다.

import { useEffect, useState } from 'react'
import {
  periodRange, PREVIOUS_PERIOD_LABEL,
  type DeviceUtilStat, type Period, type ShowroomStats,
} from '@/lib/showroom'
import { BORDER, CARD_BG, SUB, DANGER, cardStyle, skeletonBlock } from '@/components/common/ui'
import UtilMonthView from './UtilMonthView'
import UtilYearView from './UtilYearView'
import HolidayManager from './HolidayManager'

/** 가동률 탭의 선택. site: null 이면 아직 고르지 않은 것 — 첫 사무실로 본다. */
export type UtilNav = { period: Period; site: number | 'all' | null }

type Props = {
  period: Period
  /** 첫 사무실로 풀어 둔 값. null = 쇼룸 사무실이 없다(또는 아직 모른다) */
  site: number | 'all' | null
  sitesLoading: boolean
  isAdmin: boolean
  /** 사용 기록·장비 설정·공휴일이 바뀔 때마다 올라가는 값. 바뀌면 다시 계산한다. */
  refreshKey: number
  /** 장비 행 — 보고 있는 기간(from~to) 그대로 전체기록 탭에서 그 장비의 기록을 연다 */
  onOpenDevice: (device: DeviceUtilStat, from: string, to: string) => void
  /** 연간 보기에서 달을 누르면 그 달 기간 보기로 */
  onPickMonth: (year: number, month: number) => void
  onAddUsage: () => void
  onHolidaysChanged: () => void
}

// 지표 띠 — 칸 사이 1px 선은 칸 사이 틈으로 컨테이너 배경(테두리색)이 비치게 해서 긋는다.
// 열 수가 바뀌어도(6 → 3 → 2) 선이 칸을 따라간다. (.sr-two 는 연간 보기의 추이 두 칸이 쓴다)
const STRIP_CSS = `
  .sr-strip { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 1px; background: ${BORDER}; }
  @media (max-width: 1023px) { .sr-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (max-width: 599px) { .sr-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .sr-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
  @media (max-width: 899px) { .sr-two { grid-template-columns: minmax(0, 1fr); } }

  /* 기간 보기 — 지표 띠 2줄(3칸 / 5칸). 칸마다 오른쪽·아래 선을 긋고, 바깥 테두리에 닿는 선은
     한 칸 밖으로 밀어 잘라 낸다(overflow hidden + 음수 여백). 틈으로 배경을 비치게 하는 방식과 달리
     칸 수가 열 수로 나누어떨어지지 않아도(5칸 → 3열) 빈 자리가 회색으로 차지 않는다. */
  .sr-kpi { overflow: hidden; }
  .sr-kpi-row { display: grid; margin: 0 -1px -1px 0; }
  .sr-kpi-row > * { border-right: 1px solid ${BORDER}; border-bottom: 1px solid ${BORDER}; }
  .sr-kpi-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .sr-kpi-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .sr-kpi-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  @media (max-width: 1023px) { .sr-kpi-5 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (max-width: 599px) {
    .sr-kpi-3 { grid-template-columns: minmax(0, 1fr); }
    .sr-kpi-4, .sr-kpi-5 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  /* 기간 보기 — 지표 띠 아래 2열(좌 2 : 우 1). 1179px 이하는 한 열로(고객사 상세와 같은 값). */
  .sr-mgrid { display: flex; gap: 12px; align-items: flex-start; }
  .sr-mgrid > .sr-mleft { flex: 2; min-width: 0; }
  .sr-mgrid > .sr-mright { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
  @media (max-width: 1179px) {
    .sr-mgrid { flex-direction: column; align-items: stretch; }
    .sr-mgrid > .sr-mleft, .sr-mgrid > .sr-mright { flex: none; width: 100%; }
  }
`

/** 첫 로딩 스켈레톤 — 기간 보기와 같은 모양(지표 띠 3칸+5칸, 좌우 2열). */
function Skeleton() {
  const cell = (key: number, valueH: number) => (
    <div key={key} style={{ background: CARD_BG, padding: '10px 12px' }}>
      <div style={skeletonBlock(56, 11)} />
      <div style={{ ...skeletonBlock(72, valueH), marginTop: 6 }} />
    </div>
  )
  return (
    <>
      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <div style={{ ...skeletonBlock(180, 13), marginBottom: 10 }} />
        <div className="sr-kpi"><div className="sr-kpi-row sr-kpi-3">{[0, 1, 2].map(i => cell(i, 22))}</div></div>
        <div style={{ height: 1, background: BORDER }} />
        <div className="sr-kpi"><div className="sr-kpi-row sr-kpi-5">{[0, 1, 2, 3, 4].map(i => cell(i, 18))}</div></div>
      </div>
      <div className="sr-mgrid">
        <div className="sr-mleft" style={cardStyle}>
          <div style={{ ...skeletonBlock(140, 17), marginBottom: 14 }} />
          {[0, 1, 2, 3, 4].map(r => (
            <div key={r} style={{ padding: '8px 4px', borderTop: r === 0 ? 'none' : `1px solid ${BORDER}` }}>
              <div style={skeletonBlock(200, 14)} />
              <div style={{ ...skeletonBlock('100%', 6), marginTop: 6 }} />
            </div>
          ))}
        </div>
        <div className="sr-mright">
          {[0, 1].map(c => (
            <div key={c} style={cardStyle}>
              <div style={{ ...skeletonBlock(110, 15), marginBottom: 10 }} />
              {[0, 1, 2].map(r => <div key={r} style={{ ...skeletonBlock('100%', 12), marginTop: r ? 8 : 0 }} />)}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export default function UtilizationTab({
  period, site, sitesLoading, isAdmin, refreshKey, onOpenDevice, onPickMonth, onAddUsage, onHolidaysChanged,
}: Props) {
  const { from, to } = periodRange(period)

  // 받아 둔 결과와 그 결과의 기간. 무엇을 그릴지는 이것으로 정한다(파일 머리 설명).
  const [loaded, setLoaded] = useState<{ period: Period; stats: ShowroomStats } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 어느 요청의 결과를 들고 있는지. '불러오는 중'은 이것과 지금 키를 비교해 파생시킨다.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)

  const key = `${from}~${to}-${site}-${refreshKey}`
  const loading = site != null && loadedKey !== key

  useEffect(() => {
    if (site == null || loadedKey === key) return
    let cancelled = false
    fetch(`/api/showroom/stats?from=${from}&to=${to}&site=${site}`)
      .then(async res => {
        const body = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !body) setError(body?.error || '가동률을 불러오지 못했습니다.')
        else { setLoaded({ period, stats: body as ShowroomStats }); setError(null) }
        setLoadedKey(key)
      })
      .catch(e => {
        if (cancelled) return
        console.error('[showroom] stats load failed', e)
        setError('가동률을 불러오지 못했습니다.')
        setLoadedKey(key)
      })
    return () => { cancelled = true }
  }, [key, loadedKey, from, to, site, period])

  // 공휴일 관리는 해 단위 — 기간이 끝나는 해를 연다.
  const holidayYear = Number(to.slice(0, 4))

  const renderLoaded = (l: { period: Period; stats: ShowroomStats }) => {
    const { stats } = l
    const yearly = stats.yearly
    if (yearly) {
      // 올해를 보고 있으면 이번 달을 강조한다.
      const todayYear = Number(stats.today.slice(0, 4))
      return (
        <UtilYearView
          yearly={yearly}
          selectedMonth={todayYear === yearly.year ? Number(stats.today.slice(5, 7)) : null}
          onPickMonth={m => onPickMonth(yearly.year, m)}
        />
      )
    }
    return (
      <UtilMonthView
        stats={stats}
        basis={PREVIOUS_PERIOD_LABEL[l.period.mode]}
        onOpenDevice={d => onOpenDevice(d, stats.from, stats.to)}
        onAddUsage={onAddUsage}
      />
    )
  }

  return (
    <>
      <style>{STRIP_CSS}</style>

      {error && (
        <div style={{ ...cardStyle, marginBottom: 12, fontSize: 13, fontWeight: 600, color: DANGER }}>{error}</div>
      )}

      {site == null ? (
        sitesLoading ? <Skeleton /> : (
          <div style={cardStyle}>
            <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 14, fontWeight: 600, color: SUB }}>
              쇼룸 사무실이 지정되어 있지 않습니다
            </div>
          </div>
        )
      ) : !loaded ? (
        loading ? <Skeleton /> : null
      ) : (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }} aria-busy={loading}>
          {renderLoaded(loaded)}
        </div>
      )}

      {isAdmin && <HolidayManager year={holidayYear} onChanged={onHolidaysChanged} />}
    </>
  )
}
