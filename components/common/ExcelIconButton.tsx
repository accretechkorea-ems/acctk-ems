'use client'

/**
 * **엑셀 내보내기 ⬇ 아이콘 버튼** — 화면마다 같은 모양이다 (2026-11-26 묶음2 E).
 *
 * ── 왜 한곳에 두는가 ──────────────────────────────────────────────────────
 *   같은 「엑셀로 받기」가 화면마다 달랐다(2026-11-26 전수조사): 고객사 목록·명함은
 *   ⬇ 아이콘, 포캐스트·접촉보고서는 「엑셀 내보내기」·「전체 엑셀」 글자 버튼, 발주·
 *   실적 현황·내 견적은 「엑셀 내보내기 (3)」처럼 건수까지 붙은 글자 버튼이었다.
 *   누르는 자리가 매번 달라 보이면 그때그때 다시 찾는다. 기준은 **고객사 목록 탭 줄의
 *   ⬇ 아이콘**이다(components/home/list/ListTabs.tsx — 그 생김새를 여기로 옮겨 왔다).
 *
 * ── 모양 ──────────────────────────────────────────────────────────────────
 *   28×28(기본) · radius R.icon · 1px 테두리(BORDER 토큰) · 흰 바탕 · 글리프 15px.
 *   ⚠ 색값을 **주석에도 적지 않는다** — scripts/color-token-check.js 는 주석 안의 값도
 *     세기 때문에, 설명 한 줄 때문에 「토큰 값을 손으로 적은 파일」이 하나 늘어난다.
 *   무엇을 하는 단추인지는 **title 툴팁**이 말한다 — 글자를 지우는 대신 툴팁이 받는다.
 *   건수가 있으면 툴팁에 함께 적는다(「엑셀 내보내기 (3건)」).
 *
 * ── 동작·권한은 부르는 쪽 그대로 ──────────────────────────────────────────
 *   이 부품은 **누르면 onClick** 뿐이다. 무엇을 내보내는지·누가 누를 수 있는지는
 *   종전과 같이 부르는 화면이 정한다(한 줄도 옮기지 않았다).
 */

import type { CSSProperties } from 'react'
import { BORDER, CARD_BG, MUTED, SUB } from '@/components/common/ui'
import { R } from '@/lib/radius'

export type ExcelIconButtonProps = {
  onClick: () => void
  disabled?: boolean
  /** 내보내는 중 — 눌리지 않고 툴팁이 「내보내는 중…」이 된다. */
  busy?: boolean
  /** 툴팁에 덧붙일 건수. 0 이나 없으면 적지 않는다. */
  count?: number
  /** 기본 툴팁은 「엑셀 내보내기」다. 다른 말이 필요한 자리만 넘긴다. */
  label?: string
  /** 자리를 맞출 때만(여백·정렬). 색·테두리는 넘기지 않는다 — 모양은 한 벌이다. */
  style?: CSSProperties
  /** 단추 크기. 큰 머리줄에서는 34 를 쓴다. */
  size?: number
}

/** 아래로 받는 화살표 — lucide 의 download 를 인라인 SVG 로 둔다(lucide-react 미설치). */
export function DownloadGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3" />
    </svg>
  )
}

export default function ExcelIconButton({
  onClick, disabled = false, busy = false, count, label = '엑셀 내보내기', style, size = 28,
}: ExcelIconButtonProps) {
  const off = disabled || busy
  const tip = busy ? '내보내는 중…' : count ? `${label} (${count}건)` : label
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={off}
      title={tip}
      aria-label={tip}
      style={{
        width: size, height: size, padding: 0, boxSizing: 'border-box', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: R.icon, border: `1px solid ${BORDER}`, background: CARD_BG,
        color: off ? MUTED : SUB, cursor: off ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      <DownloadGlyph size={Math.round(size * 0.54)} />
    </button>
  )
}
