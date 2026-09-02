import type { CSSProperties } from 'react'
import { Z } from '@/lib/zIndex'

export const PAGE_BG = '#f4f5f7'
export const PANEL_BG = '#ffffff'
export const CARD_BG = '#f9fafb'
export const INNER_CARD_BG = '#f1f3f5'
export const INPUT_BG = '#ffffff'
export const INPUT_BORDER = '#e2e4e9'
export const TEXT_PRIMARY = '#111113'
export const TEXT_SECONDARY = '#4b5563'
export const TEXT_MUTED = '#9ca3af'
export const WHITE_BUTTON_BG = '#234ea2'
export const WHITE_BUTTON_TEXT = '#ffffff'
export const DANGER_BG = '#dc2626'

export const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')

export const inputStyle: CSSProperties = {
  width: '100%', padding: 12, border: `1px solid ${INPUT_BORDER}`, borderRadius: 10,
  boxSizing: 'border-box', color: TEXT_PRIMARY, background: INPUT_BG, outline: 'none',
}

export const dateInputStyle: CSSProperties = {
  width: '100%', padding: 12, border: `1px solid ${INPUT_BORDER}`, borderRadius: 10,
  boxSizing: 'border-box', color: '#111113', background: '#ffffff', outline: 'none', colorScheme: 'light',
}

export const textareaStyle: CSSProperties = {
  width: '100%', padding: 12, border: `1px solid ${INPUT_BORDER}`, borderRadius: 10,
  resize: 'vertical', color: TEXT_PRIMARY, boxSizing: 'border-box', lineHeight: 1.5,
  background: INPUT_BG, outline: 'none',
}

export const iconButtonStyle: CSSProperties = {
  width: 34, height: 34, borderRadius: '50%', background: WHITE_BUTTON_BG,
  color: WHITE_BUTTON_TEXT, border: 'none', cursor: 'pointer', fontSize: 16,
  fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
}

export const modalOverlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: Z.modal, padding: 20,
}
