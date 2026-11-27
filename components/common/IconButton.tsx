'use client'

/**
 * 아이콘 버튼 — **한 벌**이다 (2026-11-20 시작 → 2026-11-27 묶음5 1-2 에서 통일).
 *
 * ── 왜 한곳에 두는가 ──────────────────────────────────────────────────────
 *   같은 「고치기」가 화면마다 다른 모양이었다(2026-11-20 전수조사): 테두리 있는
 *   정사각형, 테두리 없는 연필, 글자 「수정」 버튼, 화면마다 따로 만든 iconBtn…
 *   누르는 자리가 매번 달라 보이면 그때그때 다시 찾아야 한다.
 *
 * ── 모양(묶음5 확정) ─────────────────────────────────────────────────────
 *   **30×30** · radius R.icon · 테두리 **#d1d5db** · 흰 바탕 · 아이콘 **16px #374151**.
 *   호버·포커스에는 **공용 링**(lib/focusRing.ts — 호버·키보드·선택됨이 같은 신호다).
 *   전에는 테두리가 #ebebeb 라 흰 바탕 위에서 거의 보이지 않았다 — 「눌러도 되는 것」이
 *   보여야 누른다. 아이콘 색도 #4b5563 에서 라벨색(#374151)으로 올렸다.
 *
 * ── 늘 보인다 ─────────────────────────────────────────────────────────────
 *   **호버해야 나타나는 버튼을 두지 않는다**(묶음5). 폰에는 호버가 없어 아예 못 찾고,
 *   PC 에서도 「여기에 무언가 있다」를 알 길이 없다. 자리를 늘 차지하므로 나타날 때
 *   글자가 밀리지도 않는다.
 *
 * ── 툴팁이 들어 있다 ──────────────────────────────────────────────────────
 *   `label` 은 **필수**다. aria-label 이자 툴팁 글이다(components/common/Tooltip.tsx).
 *   `shortcut` 을 주면 알약 칩으로 붙는다(「Ctrl+B」).
 *
 * 표의 행동 묶음(수정/삭제가 글자로 나란히 선 자리)은 바꾸지 않는다 — 거기서는
 * 아이콘만 두면 무엇을 지우는지가 흐려진다.
 */

import type { CSSProperties, ReactNode } from 'react'
import Tooltip from '@/components/common/Tooltip'
import { R } from '@/lib/radius'
import { PICK_CLASS } from '@/lib/focusRing'

/** 테두리 — 흰 바탕에서 보이는 회색. 카드 테두리(#ebebeb)보다 한 단 진하다. */
const BORDER = '#d1d5db'
/** 아이콘 색 — 라벨색. */
const FG = '#374151'
/** 위험한 일(삭제)만 다른 색을 쓴다. */
const DANGER = '#ef4444'
const CARD_BG = '#ffffff'

/** 기본 크기. 좁은 표 줄에서는 24~26 을 준다. */
export const ICON_BUTTON_SIZE = 30
/** 아이콘 크기 — 버튼 크기와 따로 둔다(작은 버튼에서도 글리프는 또렷해야 한다). */
const GLYPH = 16

export type IconButtonProps = {
  onClick: () => void
  /** 툴팁이자 읽어 주는 글. 예: 「사업장 정보 수정」. **필수**다. */
  label: string
  /** 툴팁에 붙는 단축키 칩. 예: 「Ctrl+B」. */
  shortcut?: string
  disabled?: boolean
  /** 자리를 맞출 때만(여백·정렬). 색·테두리는 넘기지 않는다 — 모양은 한 벌이다. */
  style?: CSSProperties
  /** 버튼 크기. 좁은 표 줄에서만 줄인다. */
  size?: number
  /** 위험한 일인가 — 글자가 빨개진다(삭제·폐기). */
  danger?: boolean
}

const shellStyle = (size: number, danger: boolean, disabled: boolean, style?: CSSProperties): CSSProperties => ({
  width: size, height: size, padding: 0, boxSizing: 'border-box', flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.icon,
  color: danger ? DANGER : FG,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.45 : 1,
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  ...style,
})

/**
 * 모든 아이콘 버튼의 **속**. 글리프만 갈아 끼운다.
 * 호버·포커스 링은 공용 클래스가 건다(app/globals.css 의 「고르는 자리의 링」).
 */
function IconButton({
  onClick, label, shortcut, disabled, style, size = ICON_BUTTON_SIZE, danger, children,
}: IconButtonProps & { children: ReactNode }) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={PICK_CLASS}
        style={shellStyle(size, !!danger, !!disabled, style)}
      >
        {children}
      </button>
    </Tooltip>
  )
}

// ── 글리프 ──────────────────────────────────────────────────────────────────
//   lucide 모양을 인라인 SVG 로 둔다(lucide-react 는 설치하지 않는다).
//   stroke-width 2 · 선 아이콘 — 디자인 규칙 그대로다.

const svg = (size: number, body: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {body}
  </svg>
)

/**
 * 연필 글리프 — **이 파일에서만** 그린다. 버튼이 아닌 자리(링크 등)는 이것을 가져다 쓴다.
 */
export function PencilGlyph({ size = GLYPH }: { size?: number }) {
  return svg(size, <>
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </>)
}
export function PlusGlyph({ size = GLYPH }: { size?: number }) {
  return svg(size, <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>)
}
export function TrashGlyph({ size = GLYPH }: { size?: number }) {
  return svg(size, <>
    <path d="M3 6h18" /><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" />
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
  </>)
}
export function CloseGlyph({ size = GLYPH }: { size?: number }) {
  return svg(size, <><path d="M18 6L6 18" /><path d="M6 6l12 12" /></>)
}
export function CopyGlyph({ size = GLYPH }: { size?: number }) {
  return svg(size, <>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </>)
}
export function RefreshGlyph({ size = GLYPH }: { size?: number }) {
  return svg(size, <>
    <path d="M21 12a9 9 0 11-3-6.7" /><polyline points="21 3 21 9 15 9" />
  </>)
}
export function DownloadGlyph({ size = GLYPH }: { size?: number }) {
  return svg(size, <>
    <path d="M12 3v12" /><polyline points="7 10 12 15 17 10" /><path d="M5 21h14" />
  </>)
}
export function CheckGlyph({ size = GLYPH }: { size?: number }) {
  return svg(size, <polyline points="20 6 9 17 4 12" />)
}

// ── 버튼들 ──────────────────────────────────────────────────────────────────

/** 수정 — 연필. */
export function EditIconButton(p: IconButtonProps) {
  return <IconButton {...p}><PencilGlyph size={Math.round((p.size ?? ICON_BUTTON_SIZE) * 0.53)} /></IconButton>
}
/** 추가 — 더하기. 글자가 필요한 자리(「+ 사업장 추가」)는 이 버튼을 쓰지 않는다. */
export function AddIconButton(p: IconButtonProps) {
  return <IconButton {...p}><PlusGlyph size={Math.round((p.size ?? ICON_BUTTON_SIZE) * 0.57)} /></IconButton>
}
/** 삭제 — 휴지통. 글자가 빨갛다(되돌릴 수 없는 느낌을 색이 먼저 말한다). */
export function DeleteIconButton(p: IconButtonProps) {
  return <IconButton {...p} danger><TrashGlyph size={Math.round((p.size ?? ICON_BUTTON_SIZE) * 0.53)} /></IconButton>
}
/** 닫기 — ✕. */
export function CloseIconButton(p: IconButtonProps) {
  return <IconButton {...p}><CloseGlyph size={Math.round((p.size ?? ICON_BUTTON_SIZE) * 0.53)} /></IconButton>
}
/** 복사 — 겹친 네모. 복사한 뒤 체크로 바뀌는 자리는 done 을 준다. */
export function CopyIconButton({ done, ...p }: IconButtonProps & { done?: boolean }) {
  const s = Math.round((p.size ?? ICON_BUTTON_SIZE) * 0.5)
  return <IconButton {...p}>{done ? <CheckGlyph size={s} /> : <CopyGlyph size={s} />}</IconButton>
}
/** 새로 읽기 — 둥근 화살표. */
export function RefreshIconButton(p: IconButtonProps) {
  return <IconButton {...p}><RefreshGlyph size={Math.round((p.size ?? ICON_BUTTON_SIZE) * 0.53)} /></IconButton>
}

export default IconButton
