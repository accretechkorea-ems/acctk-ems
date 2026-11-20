'use client'

/**
 * 고객사 화면의 **좌 패널** — 지도 보기와 목록 보기가 **같은 부품**을 쓴다.
 *
 * 왜 하나로 모았나(2026-11-20)
 *   지도 보기는 지도 위에 띄운 띠였고 목록 보기는 격자의 첫 칸이었다. 둘이 서로 다른
 *   자리 계산을 쓰다 보니, 세그먼트로 보기를 바꿀 때마다 패널이 몇 px 씩 움직였다.
 *   이제 **자리 계산이 한 곳**이다 — 좌 16, 폭 340, 위·아래 16. 어느 보기든 같다.
 *
 * 위는 **상단 카드**(세그먼트+검색 / 필터+칩+정렬 / 목록 보기만 탭 줄),
 * 아래는 보기마다 다른 내용(지도: 업체 카드 목록 · 목록: 회사 트리)이다.
 */

import type { ReactNode } from 'react'
import { R } from '@/lib/radius'
import { Z } from '@/lib/zIndex'

/** 패널 자리 — 두 보기가 **같은 숫자**를 쓴다(여기가 정본이다). */
export const PANEL_LEFT = 16
export const PANEL_WIDTH = 340
export const PANEL_GUTTER = 16
/** 우측 본문이 패널을 피해 시작하는 x. */
export const PANEL_SPACE = PANEL_LEFT + PANEL_WIDTH + PANEL_GUTTER

type Props = {
  /** 상단 카드에 들어갈 것 — PanelHeader(+탭 줄). */
  header: ReactNode
  /** 그 아래 — 보기마다 다른 내용. 남는 높이를 전부 쓴다. */
  children: ReactNode
  /** 좁은 화면에서 숨길 때. */
  hidden?: boolean
}

export default function SidePanel({ header, children, hidden }: Props) {
  return (
    <div
      className={hidden ? 'mobile-hide side-panel' : 'side-panel'}
      style={{
        position: 'absolute', left: PANEL_LEFT, top: PANEL_GUTTER, bottom: PANEL_GUTTER,
        width: PANEL_WIDTH, display: 'flex', flexDirection: 'column', gap: 10,
        zIndex: Z.inPage, minHeight: 0,
      }}
    >
      <div style={{
        background: '#ffffff', border: '1px solid #ebebeb', borderRadius: R.card,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden', flexShrink: 0,
      }}>
        {header}
      </div>
      {children}
    </div>
  )
}
