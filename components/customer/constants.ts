import type { CSSProperties } from 'react'
import { Z } from '@/lib/zIndex'
import { R } from '@/lib/radius'

export const PAGE_BG = '#f4f5f7'
export const PANEL_BG = '#ffffff'
export const CARD_BG = '#f9fafb'
export const INNER_CARD_BG = '#f1f3f5'
export const INPUT_BG = '#ffffff'
export const INPUT_BORDER = '#e2e4e9'
export const TEXT_PRIMARY = '#111113'
export const TEXT_SECONDARY = '#4b5563'
export const TEXT_MUTED = '#6b7280'
export const WHITE_BUTTON_BG = '#234ea2'
export const WHITE_BUTTON_TEXT = '#ffffff'
export const DANGER_BG = '#dc2626'

export const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')

export const inputStyle: CSSProperties = {
  width: '100%', padding: 12, border: `1px solid ${INPUT_BORDER}`, borderRadius: R.tile,
  boxSizing: 'border-box', color: TEXT_PRIMARY, background: INPUT_BG, outline: 'none',
}

export const dateInputStyle: CSSProperties = {
  width: '100%', padding: 12, border: `1px solid ${INPUT_BORDER}`, borderRadius: R.tile,
  boxSizing: 'border-box', color: '#111113', background: '#ffffff', outline: 'none', colorScheme: 'light',
}

export const textareaStyle: CSSProperties = {
  width: '100%', padding: 12, border: `1px solid ${INPUT_BORDER}`, borderRadius: R.tile,
  resize: 'vertical', color: TEXT_PRIMARY, boxSizing: 'border-box', lineHeight: 1.5,
  background: INPUT_BG, outline: 'none',
}

export const iconButtonStyle: CSSProperties = {
  width: 34, height: 34, borderRadius: '50%', background: WHITE_BUTTON_BG,
  color: WHITE_BUTTON_TEXT, border: 'none', cursor: 'pointer', fontSize: 16,
  fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
}

/**
 * 모달 바탕. **윗변을 화면 위 6vh 에 못 박는다** — 세로 가운데 정렬이던 때는
 * 칸을 하나 펼칠 때마다 모달 전체가 위로 밀려 제목 줄이 움직였다.
 * 늘어나는 쪽은 아래로만 간다(최대 높이 88vh 와 폰의 전체 화면 시트는
 * app/globals.css 의 `.ems-modal-overlay` 가 맡는다).
 */
export const modalOverlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: Z.modal,
  // 6dvh — 안쪽 카드의 94dvh 와 **같은 단위**여야 둘을 더해 화면에 들어간다(2026-11-26).
  // vh(=lvh, 툴바를 접은 높이)로 두면 툴바가 보일 때 합이 보이는 높이를 넘는다.
  // 아래는 홈 바(safe-area)만큼 띄운다 — 폰 규칙(globals.css)과 같은 모양이다.
  padding: '6dvh 20px calc(6dvh + env(safe-area-inset-bottom))', overflowY: 'auto',
}
