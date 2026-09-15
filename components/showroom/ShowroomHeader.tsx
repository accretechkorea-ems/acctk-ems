'use client'

// 쇼룸 화면 헤더 — 한 줄에
//   [좌] 장비 탭: 첫 사무실 제목 + 대수 / 가동률 탭: 사무실 선택(동탄 | 구미 | 전체) / 전체기록 탭: 비움
//   [중앙] 가동률 탭: ◀ 기간 ▶ — 기간을 누르면 기간 선택 모달
//   [우] 탭(장비 | 가동률 | 전체기록) — 세 칸 같은 폭
//
// 탭은 모든 탭에서 같은 자리(우측 끝)에 한 번만 그린다 — 탭을 바꿔도 컨트롤이 다시 만들어지지 않아
// 인디케이터가 미끄러지고, 옆 요소가 자리를 밀지 않는다.
// 탭마다 다른 요소는 모두 늘 그려 두고 보이기만 바꾼다. 사라질 때도 transition 이 돌아야 해서다
// (조건부로 그리면 빠지는 순간 DOM 에서 없어져 사라지는 모션을 줄 수 없다).
//   나타남 — translateX(-8px)·opacity 0 → 제자리·opacity 1, 0.2s ease
//   사라짐 — 그 반대. visibility 는 모션이 끝난 뒤(0.2s) 꺼서, 숨은 요소가 눌리거나 초점을 받지 않게 한다.
//   다 나타난 상태의 transform 은 none 이다 — translateX(0) 이라도 transform 이 남아 있으면 그 안에서 여는
//   기간 모달(position: fixed)이 화면이 아니라 이 요소 기준으로 떠 버린다.
// 좌측 칸은 사무실 제목과 사무실 선택을 같은 격자 칸에 겹쳐 둔다(서로 자리를 밀지 않게).

import { useMemo, type CSSProperties } from 'react'
import SegmentedControl from '@/components/common/SegmentedControl'
import { type Period, type ShowroomSite } from '@/lib/showroom'
import { skeletonBlock } from '@/components/common/ui'
import { siteTitleStyle, siteCountStyle, siteBasisStyle, monthBasisLabel } from './DeviceGrid'
import PeriodNav from './PeriodNav'
import type { ShowroomTab } from './usageQuery'

const ALL_SITES = 'all'
const MOTION = 'opacity 0.2s ease, transform 0.2s ease'
/**
 * 탭 한 칸의 폭 — 가장 긴 라벨 「전체기록」(13px, 약 52px)에 SegmentedControl 기본 좌우 여백 12px 씩을 더한 값.
 * 세 칸을 이 폭으로 똑같이 둔다.
 */
const TAB_W = 76

/** 탭에 따라 나타나고 사라지는 요소. */
const reveal = (shown: boolean): CSSProperties => ({
  opacity: shown ? 1 : 0,
  transform: shown ? 'none' : 'translateX(-8px)',
  visibility: shown ? 'visible' : 'hidden',
  pointerEvents: shown ? 'auto' : 'none',
  // 나타날 때는 visibility 를 바로 켜고, 사라질 때는 모션이 끝난 뒤 끈다.
  transition: shown ? `${MOTION}, visibility 0s` : `${MOTION}, visibility 0s linear 0.2s`,
})

// 3칸 격자 — 좌우 칸이 같은 폭(1fr)이라 가운데 기간이 화면 가운데에 온다.
// 899px 이하에서는 기간을 둘째 줄 가운데로 내린다(가동률 탭이 아니면 그 줄을 접는다).
const HEAD_CSS = `
  .sr-head { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 8px; margin-bottom: 12px; }
  .sr-head-left { display: grid; align-items: center; min-width: 0; }
  .sr-head-left > * { grid-area: 1 / 1; min-width: 0; }
  .sr-head-right { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
  @media (max-width: 899px) {
    .sr-head { grid-template-columns: minmax(0, 1fr) auto; }
    .sr-head-center { grid-column: 1 / -1; grid-row: 2; justify-self: center; }
    .sr-head[data-util="0"] .sr-head-center { display: none; }
  }
`

type Props = {
  /** 탭 정의 — value 는 ShowroomTab */
  tabs: { label: string; value: ShowroomTab }[]
  active: ShowroomTab
  onTabChange: (tab: ShowroomTab) => void
  /** 장비 탭 좌측 — 첫 사무실 이름과 대수. null 이면 비운다(장비 없음). */
  siteTitle: { name: string; count: number } | null
  siteTitleLoading: boolean
  sites: ShowroomSite[]
  /** 가동률 사무실 — 첫 사무실로 풀어 둔 값 */
  site: number | 'all' | null
  /** 가동률 기간 */
  period: Period
  onSiteChange: (site: number | 'all') => void
  onPeriodChange: (period: Period) => void
}

export default function ShowroomHeader({
  tabs, active, onTabChange, siteTitle, siteTitleLoading,
  sites, site, period, onSiteChange, onPeriodChange,
}: Props) {
  const onDevices = active === 'devices'
  const onUtil = active === 'util'

  // 사무실 선택지 — showroom_sites 순서대로, 마지막이 전체.
  const siteOptions = useMemo(() => [
    ...sites.map(s => ({ label: s.short, value: String(s.customer_id) })),
    ...(sites.length > 1 ? [{ label: '전체', value: ALL_SITES }] : []),
  ], [sites])

  return (
    <>
      <style>{HEAD_CSS}</style>

      <div className="sr-head" data-util={onUtil ? '1' : '0'}>
        {/* 좌 — 사무실 제목(장비) / 사무실 선택(가동률) */}
        <div className="sr-head-left">
          <div aria-hidden={!onDevices} style={{ ...reveal(onDevices), display: 'flex', alignItems: 'baseline', gap: 8 }}>
            {siteTitleLoading ? (
              <div style={skeletonBlock(220, 20)} />
            ) : siteTitle && (
              <>
                <span style={siteTitleStyle}>{siteTitle.name}</span>
                <span style={siteCountStyle}>{siteTitle.count}대</span>
                <span style={siteBasisStyle}>{monthBasisLabel()}</span>
              </>
            )}
          </div>
          <div aria-hidden={!onUtil} style={reveal(onUtil)}>
            {siteOptions.length > 1 && site != null && (
              <SegmentedControl
                value={String(site)}
                options={siteOptions}
                onChange={v => onSiteChange(v === ALL_SITES ? 'all' : Number(v))}
              />
            )}
          </div>
        </div>

        {/* 중앙 — ◀ 기간 ▶ (가동률) */}
        <div className="sr-head-center" aria-hidden={!onUtil} style={reveal(onUtil)}>
          <PeriodNav period={period} onChange={onPeriodChange} />
        </div>

        {/* 우 — 탭(세 칸 같은 폭) */}
        <div className="sr-head-right">
          <SegmentedControl
            equal
            minItemWidth={TAB_W}
            value={active}
            options={tabs}
            onChange={v => onTabChange(v as ShowroomTab)}
          />
        </div>
      </div>
    </>
  )
}
