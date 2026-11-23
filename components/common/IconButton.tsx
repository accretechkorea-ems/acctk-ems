'use client'

/**
 * 아이콘만 있는 버튼 — **수정**과 **추가** 두 가지.
 *
 * ── 왜 한곳에 두는가 ──────────────────────────────────────────────────────
 *   같은 「고치기」가 화면마다 다른 모양이었다(2026-11-20 전수조사): 테두리 있는 정사각형,
 *   테두리 없는 연필, 글자 「수정」 버튼, 화면마다 따로 만든 iconBtn… 누르는 자리가
 *   매번 달라 보이면 그때그때 다시 찾아야 한다. 기준은 **사업장 카드 제목 옆 연필**이다.
 *
 * ── 모양 ──────────────────────────────────────────────────────────────────
 *   28×28, radius 6, 1px 테두리(#ebebeb), 흰 바탕. 호버에 테두리·글자색이 액센트로.
 *   수정은 회색 글자, 추가는 액센트 글자 — 더하기가 더 자주 눌리는 일이라 눈에 먼저 든다.
 *
 * 표의 행동 묶음(수정/삭제가 글자로 나란히 선 자리)은 바꾸지 않는다 — 거기서는
 * 아이콘만 두면 무엇을 지우는지가 흐려진다.
 */

import type { CSSProperties } from 'react'
import { R } from '@/lib/radius'

const BORDER = '#ebebeb'
const MUTED = '#4b5563'
const BLUE = '#234ea2'

export type IconButtonProps = {
  onClick: () => void
  /** 도움말·읽어 주는 글. 예: 「사업장 정보 수정」 */
  label: string
  disabled?: boolean
  /** 자리를 맞출 때만(여백·정렬). 색·테두리는 넘기지 않는다 — 모양은 한 벌이다. */
  style?: CSSProperties
  /** 버튼 크기. 좁은 표 줄에서는 24 를 쓴다. */
  size?: number
}

const base = (size: number, color: string, style?: CSSProperties): CSSProperties => ({
  width: size, height: size, padding: 0, boxSizing: 'border-box', flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: R.icon,
  cursor: 'pointer', color,
  transition: 'border-color 0.15s ease, color 0.15s ease, background 0.15s ease',
  ...style,
})

/**
 * 연필 글리프 — **이 파일에서만** 그린다. 버튼이 아닌 자리(링크 등)는 이것을 가져다 쓴다.
 * lucide 의 square-pen 을 인라인 SVG 로 둔다(lucide-react 는 설치하지 않는다).
 */
export function PencilGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

const hoverOn = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.borderColor = BLUE
  e.currentTarget.style.color = BLUE
  e.currentTarget.style.background = '#fafafa'
}

/** 수정 — 연필. 기준은 사업장 카드 제목 옆 버튼이다. */
export function EditIconButton({ onClick, label, disabled, style, size = 28 }: IconButtonProps) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      aria-label={label} title={label}
      onMouseEnter={e => { if (!disabled) hoverOn(e) }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = BORDER
        e.currentTarget.style.color = MUTED
        e.currentTarget.style.background = '#ffffff'
      }}
      style={{ ...base(size, MUTED, style), cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}
    >
      <PencilGlyph size={Math.round(size * 0.5)} />
    </button>
  )
}

/** 추가 — 더하기. 글자가 필요한 자리(「+ 사업장 추가」)는 이 버튼을 쓰지 않는다. */
export function AddIconButton({ onClick, label, disabled, style, size = 28 }: IconButtonProps) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      aria-label={label} title={label}
      onMouseEnter={e => { if (!disabled) hoverOn(e) }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = BORDER
        e.currentTarget.style.color = BLUE
        e.currentTarget.style.background = '#ffffff'
      }}
      style={{ ...base(size, BLUE, style), cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}
    >
      <svg width={Math.round(size * 0.57)} height={Math.round(size * 0.57)} viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  )
}
