// 새로 만드는 화면(쇼룸·전자결재·의뢰서) 전용 공용 스타일 토큰.
//
// 값은 활동 현황(app/activity/page.tsx)과 components/activity/ActivityCard.tsx 에서
// 실제로 쓰고 있는 값을 그대로 옮긴 것이다. 새 색·새 치수를 만들지 않는다.
// 기존 화면은 각자 인라인 상수를 그대로 둔다 — 이 파일로 교체하지 마라.
// (.claude/rules/design-system.md 의 표에 있는 값만 들어 있다)
import type { CSSProperties } from 'react'
import { R } from '@/lib/radius'

// ── 색 ────────────────────────────────────────────────────────────
export const BLUE = '#234ea2'
export const BLUE_HOVER = '#1c3e87'
export const PAGE_BG = '#fafafa'
export const CARD_BG = '#ffffff'
export const BORDER = '#ebebeb'
export const TEXT = '#111827'
export const MUTED = '#9ca3af'
export const SUB = '#6b7280'
export const DANGER = '#dc2626'
/** 배지·칩·트랙의 중립 배경. */
export const NEUTRAL_BG = '#f3f4f6'
/** 구분점 ` · ` 처럼 가장 흐린 글자. */
export const FAINT = '#d1d5db'
/** 스켈레톤 플레이스홀더. */
export const SKELETON = '#e5e7eb'

// ── 고른 칸의 틴트 ────────────────────────────────────────────────
// 창에서 「지금 고른 것」을 표시하는 한 벌. 전에는 창마다 같은 값을 따로 적었다
// (엑셀 내보내기 창·일괄 적용 창). 값은 디자인 표의 브랜드 계열이다.
/** 고른 칸의 바탕(브랜드 틴트). */
export const BLUE_TINT = '#eff4ff'
/** 고른 칸의 테두리 — 표의 「카드 hover 테두리」와 같은 값이다. */
export const BLUE_BORDER = '#c7d7f8'
/** 안내 띠·푸터의 옅은 바탕. */
export const BAND_BG = '#f8fafc'
/** 위험 안내의 옅은 바탕 — globals.css 의 --color-danger-tint 와 같은 값이다. */
export const DANGER_TINT = '#fef2f2'

// ── 카드 ──────────────────────────────────────────────────────────
// 그림자 없음. 구분은 테두리로만 한다(모달·팝업에만 그림자 허용).
export const cardStyle: CSSProperties = {
  background: CARD_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: R.control,
  padding: '14px 16px',
}

export const cardHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingBottom: 12,
  marginBottom: 14,
  borderBottom: `1px solid ${BORDER}`,
}

export const cardTitle: CSSProperties = {
  fontSize: 17,
  fontWeight: 800,
  color: TEXT,
  letterSpacing: '-0.3px',
  lineHeight: 1.2,
}

export const countBadge: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  padding: '3px 9px',
  borderRadius: R.pill,
  background: NEUTRAL_BG,
  color: SUB,
  flexShrink: 0,
}

// ── 목록 행 ───────────────────────────────────────────────────────
/** 첫 행에는 윗선을 긋지 않는다 — 카드 헤더 아래 선과 겹친다. */
export const rowStyle = (first: boolean): CSSProperties => ({
  padding: '11px 12px',
  borderTop: first ? 'none' : `1px solid ${BORDER}`,
})

/** 클릭 가능한 행의 hover 배경. 카드 배경과 구분되는 최소한의 값. */
export const ROW_HOVER_BG = '#fafafa'

export const rowTitle: CSSProperties = { fontSize: 15, fontWeight: 600, color: TEXT, lineHeight: 1.4 }
export const rowSub: CSSProperties = { fontSize: 12, color: MUTED, lineHeight: 1.5 }

// ── 버튼 ──────────────────────────────────────────────────────────
// 세 종류 모두 치수가 같다. disabled 는 색만 바뀐다.
const btnBase: CSSProperties = {
  padding: '7px 16px',
  borderRadius: R.icon,
  fontSize: 13,
  fontWeight: 700,
  border: 'none',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  transition: 'background 0.15s ease',
}
const btnOff: CSSProperties = { background: NEUTRAL_BG, color: MUTED, cursor: 'not-allowed' }

export const btnPrimary = (disabled = false): CSSProperties =>
  disabled ? { ...btnBase, ...btnOff } : { ...btnBase, background: BLUE, color: '#ffffff' }

export const btnGhost = (disabled = false): CSSProperties =>
  disabled ? { ...btnBase, ...btnOff } : { ...btnBase, background: NEUTRAL_BG, color: SUB }

export const btnDanger = (disabled = false): CSSProperties =>
  disabled ? { ...btnBase, ...btnOff } : { ...btnBase, background: DANGER, color: '#ffffff' }

// ── 스켈레톤 ──────────────────────────────────────────────────────
// 활동 현황 SkeletonCard 와 같은 방식. 키프레임은 쓰는 쪽에서 한 번 선언한다.
export const PULSE_KEYFRAMES = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }
`

export const skeletonBlock = (width: number | string, height: number): CSSProperties => ({
  width,
  height,
  background: SKELETON,
  borderRadius: R.icon,
  animation: 'pulse 1.5s ease-in-out infinite',
})

// ── 입력 ──────────────────────────────────────────────────────────
export const inputStyle: CSSProperties = {
  padding: '8px 11px',
  border: `1px solid ${BORDER}`,
  borderRadius: R.icon,
  background: CARD_BG,
  color: TEXT,
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
  colorScheme: 'light',
}
