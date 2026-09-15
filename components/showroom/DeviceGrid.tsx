'use client'

// 장비 탭 — 쇼룸 장비를 카드 그리드로 그린다.
// 고객사 상세는 가로 스크롤이지만 여기는 장비가 한눈에 들어와야 하므로 줄바꿈 그리드다
// (카드 폭 300px 은 그대로 둔다).
// 사무실별로 묶어 그린다. 첫 사무실의 제목은 화면 헤더(ShowroomHeader)가 탭과 같은 줄에 그리고,
// 여기서는 둘째 사무실부터 제목을 단다.

import { type CSSProperties } from 'react'
import { nowKSTParts } from '@/lib/date'
import { compareDevices, type PurposeStat, type ShowroomDevice } from '@/lib/showroom'
import { BORDER, TEXT, MUTED, SUB, skeletonBlock, cardStyle } from '@/components/common/ui'
import ShowroomDeviceCard, { BOX_H } from './ShowroomDeviceCard'

const CARD_W = 300

/** 장비 한 대의 이번 달 요약. 실사용 합계(h)는 소수 첫째 자리까지. */
export type DeviceMonthSummary = { hours: number; count: number }

/** 장비 카드용 이번 달 요약 — 합계에 사용목적별 건수·시간(도넛·범례)을 더한 것. */
export type DeviceMonthBreakdown = DeviceMonthSummary & { byPurpose: PurposeStat[] }

/** 사무실 한 곳의 카드 묶음. */
export type DeviceGroup = { site: string; devices: ShowroomDevice[] }

/** 사무실 제목 — 헤더(첫 사무실)와 그리드(둘째 사무실부터)가 같은 값을 쓴다. */
export const siteTitleStyle: CSSProperties = {
  fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px', lineHeight: 1.2,
  minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}
export const siteCountStyle: CSSProperties = { fontSize: 12, color: MUTED, flexShrink: 0 }
/** 대수 옆 기준 기간 — 카드 도넛(가동률·목적)이 이번 달 기준이라 사무실 제목마다 한 번 적는다(카드마다 반복하지 않는다). */
export const siteBasisStyle: CSSProperties = { fontSize: 12, fontWeight: 500, color: MUTED, flexShrink: 0 }

/** 「2026년 9월 기준」 — 카드 요약·가동률을 계산하는 이번 달(KST)과 같은 달이다. */
export function monthBasisLabel(): string {
  const { y, m } = nowKSTParts()
  return `${y}년 ${m}월 기준`
}

/**
 * 카드로 보일 장비를 사무실별로 묶는다. 사용여부가 꺼진 장비는 일반 사용자에게 감추고,
 * superadmin 에게만 맨 뒤에 흐리게 보인다.
 */
export function groupDevices(devices: ShowroomDevice[], isAdmin: boolean): DeviceGroup[] {
  const visible = (isAdmin ? devices : devices.filter(d => d.is_active)).slice().sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
    return compareDevices(a, b)
  })
  const map = new Map<string, ShowroomDevice[]>()
  for (const d of visible) {
    const list = map.get(d.site_name)
    if (list) list.push(d)
    else map.set(d.site_name, [d])
  }
  return [...map.entries()].map(([site, list]) => ({ site, devices: list }))
}

type Props = {
  /** groupDevices 결과. 첫 묶음의 제목은 헤더가 그린다. */
  groups: DeviceGroup[]
  /** device_id → 이번 달 요약. 없는 장비는 기록 0건이다. */
  summary: Record<number, DeviceMonthBreakdown>
  /**
   * device_id → 이번 달 가동률. 장비 탭에 들어올 때 stats 를 한 번 불러 모든 카드가 함께 쓴다.
   * 아직 받지 못했으면 undefined, 목록에 없는 장비(사용여부 N)는 가동률 줄을 그리지 않는다.
   */
  utilization?: Record<number, number | null>
  loading: boolean
  isAdmin: boolean
  onAddUsage: (device: ShowroomDevice) => void
  onConfigure: (device: ShowroomDevice) => void
  onOpenUsages: (device: ShowroomDevice) => void
}

export default function DeviceGrid({
  groups, summary, utilization, loading, isAdmin, onAddUsage, onConfigure, onOpenUsages,
}: Props) {
  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${CARD_W}px)`, gap: 14 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ ...skeletonBlock('100%', 0), aspectRatio: '4 / 3', height: 'auto' }} />
            <div style={{ ...skeletonBlock(140, 15), margin: '0 auto' }} />
            <div style={{ ...skeletonBlock(180, 12), margin: '0 auto' }} />
            <div style={skeletonBlock('100%', 34)} />
            <div style={skeletonBlock('100%', BOX_H)} />
          </div>
        ))}
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div style={cardStyle}>
        <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 14, fontWeight: 600, color: SUB }}>
          쇼룸 장비가 없습니다
        </div>
        <div style={{ textAlign: 'center', fontSize: 12, color: MUTED }}>
          showroom_sites 에 지정된 사무실의 장비가 여기에 나옵니다.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {groups.map((g, gi) => (
        <div key={g.site}>
          {gi > 0 && (
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10,
              paddingBottom: 8, borderBottom: `1px solid ${BORDER}`,
            }}>
              <span style={siteTitleStyle}>{g.site}</span>
              <span style={siteCountStyle}>{g.devices.length}대</span>
              <span style={siteBasisStyle}>{monthBasisLabel()}</span>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${CARD_W}px)`, gap: 14 }}>
            {g.devices.map(d => {
              const s = summary[d.device_id]
              return (
                <ShowroomDeviceCard
                  key={d.device_id}
                  device={d}
                  monthHours={s?.hours ?? 0}
                  monthCount={s?.count ?? 0}
                  monthByPurpose={s?.byPurpose ?? []}
                  utilization={utilization && d.device_id in utilization ? utilization[d.device_id] : undefined}
                  canConfigure={isAdmin}
                  onAddUsage={() => onAddUsage(d)}
                  onConfigure={() => onConfigure(d)}
                  onOpenUsages={() => onOpenUsages(d)}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
