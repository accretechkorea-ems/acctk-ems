'use client'

// 요약 타일 한 칸 — **회색 타일 한 줄**의 한 칸이다.
//
// 2026-11-27(야간3 1-3) 에 실적 현황(app/sales/page.tsx) 안에 만들었고,
// 2026-11-28(야간4 2-1) 에 내 견적 모달도 같은 줄을 쓰게 되어 여기로 옮겼다.
// 두 화면이 같은 자리에서 같은 생김새여야 하는 칸이라, 정의가 두 벌이면 금방 갈린다.
//
// ── 규칙 ──────────────────────────────────────────────────────────────────
//   · 금액은 **억·만 축약**이고 전체 자릿수는 호버(title)로 본다 — 여섯 칸이 한 줄에
//     서려면 「₩836,845,600」 같은 글자가 들어갈 자리가 없다.
//   · 높이는 여섯 칸이 **같다**(세로 flex + 바닥에 붙는 보조 줄).
//   · 달성률 칸만 막대를 하나 더 얹는다.
//   · 색은 새로 만들지 않는다 — 넘겨 주는 색만 쓴다(디자인 토큰).

import { AnimatedGauge } from '@/components/sales/EngineerStatCard'
import { R } from '@/lib/radius'

const TEXT = '#111827'
const MUTED = '#9ca3af'
const BLUE = '#234ea2'
/** 타일 바탕 — 중립 회색. 카드(흰 바탕) 위에서 한 줄로 묶어 보이게 하는 몫이다. */
export const TILE_BG = '#f8fafc'

export type StatTileProps = {
  label: string
  value: string
  /** 호버에 적을 전체 자릿수. 금액이 아닌 칸(달성률 %)은 주지 않는다. */
  full?: string
  sub?: string | null
  subFull?: string
  color?: string
  /** 달성률 칸만 — 0~100+ 막대. null 이면 그리지 않는다. */
  gauge?: number | null
  gaugeColor?: string
}

export default function StatTile({ label, value, full, sub, subFull, color, gauge, gaugeColor }: StatTileProps) {
  return (
    <div style={{
      background: TILE_BG, borderRadius: R.control, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', minWidth: 0,
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, marginBottom: 4, letterSpacing: '0.2px', whiteSpace: 'nowrap' }}>{label}</div>
      <div className="num" title={full}
        style={{ fontSize: 15, fontWeight: 800, color: color || TEXT, letterSpacing: '-0.3px', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </div>
      {gauge !== null && gauge !== undefined && (
        <div style={{ marginTop: 6 }}>
          <AnimatedGauge pct={gauge} color={gaugeColor || BLUE} height={5} delay={100} />
        </div>
      )}
      <span style={{ flex: 1 }} />
      {sub && (
        <div className="num" title={subFull}
          style={{ fontSize: 10, color: MUTED, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </div>
      )}
    </div>
  )
}
