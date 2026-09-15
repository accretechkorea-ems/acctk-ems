'use client'

// 쇼룸 장비 카드.
//
// 고객사 상세의 장비 카드(components/customer/DeviceSection.tsx:142-326)와 같은 치수·여백·글자를
// 쓰되, 쇼룸에 필요한 내용으로 바꿨다. 그쪽 DeviceCard 는 모듈 안에서만 쓰는 함수라
// export 되어 있지 않고 props 도 서비스 레포트 전용이라 재사용할 수 없다(수정 금지 파일이다).
//   같게 유지한 값 — 카드 300px / radius 8 / padding 14px 16px / border 1px #ebebeb,
//                    이미지 4:3, 장비명 15·700 가운데, S/N 줄 12, 주 버튼 8px 12px·13·600,
//                    하단 박스 #f8f9fb / radius 10 / border INPUT_BORDER
//   다른 점 — 사진 등록 없음(쇼룸에서는 올리지 않는다), 패킹리스트 없음,
//            하단 박스가 이번 달 가동률 도넛 + 합계·사용목적 범례로 바뀌고 클릭하면 사용 기록 화면으로 간다.

import { getInstallDisplay, getDefaultImageUrl } from '@/components/customer/utils'
import { getCategoryColor } from '@/lib/categoryColors'
import {
  deviceTitle, USAGE_PURPOSES, USAGE_PURPOSE_COLORS, UTIL_BAND_COLORS, utilBand,
  type PurposeStat, type ShowroomDevice,
} from '@/lib/showroom'
import { BLUE, BORDER, CARD_BG, TEXT, MUTED, SUB, FAINT, NEUTRAL_BG } from '@/components/common/ui'
import { fmtPct, fmtHours } from './utilParts'

// 하단 박스 — 고객사 상세의 서비스 기록 박스와 같은 값(components/customer/constants.ts).
const BOX_BORDER = '#e2e4e9'
const BOX_BG = '#f8f9fb'

/**
 * 하단 박스 높이(테두리 포함). 기록·가동률 유무, 범례 줄 수와 상관없이 모든 카드 높이가 같다
 * — 오른쪽 칸은 합계 한 줄 + 범례 최대 5줄이라 이 높이 안에 들어간다. 스켈레톤(DeviceGrid)도 이 값을 쓴다.
 */
export const BOX_H = 130

const DONUT = 96          // 바깥지름
const RING = 12           // 두께
const RADIUS = (DONUT - RING) / 2
const CIRC = 2 * Math.PI * RADIUS

const LEGEND_ROW_H = 14
const LEGEND_GAP = 3

/** 목적 색 — 사용 기록 목록·가동률 화면과 같이 dot 색(없으면 글자색)을 쓴다. */
const purposeColor = (purpose: string): string => {
  const c = getCategoryColor(USAGE_PURPOSE_COLORS, purpose)
  return c.dot ?? c.text
}

type Props = {
  device: ShowroomDevice
  /** 이번 달 실사용 합계(h)와 건수. */
  monthHours: number
  monthCount: number
  /** 이번 달 사용목적별 건수·시간. 순서는 상관없다(카드가 USAGE_PURPOSES 순으로 그린다). */
  monthByPurpose: PurposeStat[]
  /**
   * 이번 달 가동률(/api/showroom/stats 가 계산한 값). null = 계산할 수 없음(기록 없는 달 등).
   * undefined = 가동률 대상이 아니거나(사용여부 N) 아직 받지 못함. 둘 다 도넛은 트랙만, 가운데는 '—'.
   */
  utilization?: number | null
  /** 설정 연필 노출 여부(superadmin). */
  canConfigure: boolean
  onAddUsage: () => void
  onConfigure: () => void
  onOpenUsages: () => void
}

/**
 * 가동률 도넛 — 원 한 바퀴가 100%, 가동률만큼 구간 색으로 채운다(가동률 막대 UtilBar 와 같은 색 규칙).
 * 회색 트랙 원 위에 같은 원을 하나 더 그리고 strokeDasharray 로 가동률 길이만 남긴다.
 * 12시 방향에서 시작하도록 -90° 돌린다. 100% 를 넘으면 가득 채우고 숫자로 초과분을 보인다.
 */
function UtilDonut({ rate }: { rate: number | null }) {
  const c = DONUT / 2
  const band = utilBand(rate)
  const fill = rate == null ? 0 : Math.min(1, Math.max(0, rate))
  const dash = fill * CIRC

  return (
    <div style={{ position: 'relative', width: DONUT, height: DONUT, flexShrink: 0 }}>
      <svg width={DONUT} height={DONUT} viewBox={`0 0 ${DONUT} ${DONUT}`} style={{ display: 'block' }}>
        <g transform={`rotate(-90 ${c} ${c})`}>
          <circle cx={c} cy={c} r={RADIUS} fill="none" stroke={NEUTRAL_BG} strokeWidth={RING} />
          {band && dash > 0 && (
            <circle cx={c} cy={c} r={RADIUS} fill="none"
              stroke={UTIL_BAND_COLORS[band].dot} strokeWidth={RING}
              strokeDasharray={`${dash} ${CIRC - dash}`} />
          )}
        </g>
      </svg>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span className="num" style={{
          fontSize: 16, fontWeight: 800, lineHeight: 1,
          color: band ? UTIL_BAND_COLORS[band].text : MUTED,
        }}>
          {fmtPct(rate)}
        </span>
      </div>
    </div>
  )
}

/** 목적별 범례 — 활동현황 카드처럼 0건 목적은 그리지 않는다. */
function PurposeLegend({ slices }: { slices: PurposeStat[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: LEGEND_GAP }}>
      {slices.map(p => (
        <div key={p.purpose} style={{ height: LEGEND_ROW_H, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: purposeColor(p.purpose), flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 500, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {p.purpose}
            </span>
          </div>
          <span className="num" style={{ fontSize: 11, fontWeight: 700, color: TEXT, flexShrink: 0 }}>
            {p.count}<span style={{ color: MUTED }}>건</span>
          </span>
        </div>
      ))}
    </div>
  )
}

export default function ShowroomDeviceCard({
  device, monthHours, monthCount, monthByPurpose, utilization, canConfigure, onAddUsage, onConfigure, onOpenUsages,
}: Props) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const title = deviceTitle(device)
  const defaultImg = getDefaultImageUrl(device, supabaseUrl)
  const inactive = !device.is_active
  // 목적 5종 순서로, 0건 목적은 뺀다.
  const slices = USAGE_PURPOSES
    .map(p => monthByPurpose.find(s => s.purpose === p))
    .filter((s): s is PurposeStat => !!s && s.count > 0)

  return (
    <div style={{
      background: CARD_BG, borderRadius: 8, padding: '14px 16px',
      border: `1px solid ${BORDER}`, position: 'relative', alignSelf: 'flex-start',
      opacity: inactive ? 0.55 : 1,
    }}>
      {/* 설정 — superadmin 에게만 */}
      {canConfigure && (
        <button onClick={onConfigure} title="장비 설정"
          onMouseEnter={e => (e.currentTarget.style.color = BLUE)}
          onMouseLeave={e => (e.currentTarget.style.color = MUTED)}
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 2,
            padding: 0, background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: MUTED, transition: 'color 0.15s ease',
          }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      )}

      {/* 이미지 — 쇼룸에서는 사진을 올리지 않는다(빈 자리는 고객사 상세와 같은 모양) */}
      <div style={{
        aspectRatio: '4 / 3', borderRadius: 6, background: 'transparent',
        border: (device.image_url || defaultImg) ? 'none' : `1px dashed ${BORDER}`,
        overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {/* next/image 를 쓰려면 remotePatterns 설정(next.config)이 필요한데 이번 범위에서
            건드릴 수 없는 파일이다. 고객사 상세의 장비 카드도 같은 이유로 <img> 를 쓴다. */}
        {device.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={device.image_url} alt={title} style={{ width: '100%', height: '100%', objectFit: 'fill' }} />
        ) : defaultImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={defaultImg} alt={title} style={{ width: '100%', height: '100%', objectFit: 'fill' }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={FAINT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>사진 없음</span>
          </div>
        )}
      </div>

      {/* 장비명 + 상태 배지 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        marginTop: 10, padding: '0 4px',
      }}>
        <span style={{
          fontSize: 15, fontWeight: 700, color: TEXT,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }} title={title}>
          {title}
        </span>
        {device.device_status !== '가동' && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
            background: NEUTRAL_BG, color: SUB, flexShrink: 0,
          }}>
            {device.device_status}
          </span>
        )}
        {inactive && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
            background: NEUTRAL_BG, color: SUB, flexShrink: 0,
          }}>
            미사용
          </span>
        )}
      </div>

      {/* 스펙 */}
      <div style={{ fontSize: 12, color: TEXT, textAlign: 'center', marginTop: 4 }}>
        S/N: {device.serial_number ?? '-'}<span style={{ color: FAINT }}> · </span>{device.program ?? '-'}
      </div>
      <div style={{ fontSize: 12, color: TEXT, textAlign: 'center', marginTop: 2, marginBottom: 14 }}>
        납입: {getInstallDisplay(device)}
      </div>

      {/* 주 버튼 */}
      <button onClick={onAddUsage}
        style={{
          width: '100%', padding: '8px 12px', background: BLUE, color: '#fff',
          borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, marginBottom: 12,
        }}>
        사용 신청 ● 기록
      </button>

      {/* 이번 달 가동률 도넛 + 합계·사용목적 범례 — 누르면 사용 기록 화면으로 가서 이 장비만 남긴다.
          높이를 고정해 기록·가동률 유무와 상관없이 카드 높이가 같다. */}
      <div onClick={onOpenUsages} title="사용 기록 보기"
        style={{
          height: BOX_H, boxSizing: 'border-box',
          background: BOX_BG, borderRadius: 10, padding: '0 13px',
          border: `1px solid ${BOX_BORDER}`, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
        <UtilDonut rate={utilization ?? null} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {monthCount === 0 ? (
            <span style={{ fontSize: 11, color: MUTED }}>기록 없음</span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="num" style={{ fontSize: 16, fontWeight: 800, color: TEXT }}>{fmtHours(monthHours)}</span>
              <span className="num" style={{ fontSize: 11, color: MUTED }}>{monthCount}건</span>
            </div>
          )}
          <PurposeLegend slices={slices} />
        </div>
      </div>
    </div>
  )
}
