'use client'

/**
 * 방식 고르기의 **큰 버튼 한 쌍** — 명함 탭의 방식 모달과 같은 틀 (2026-11-25).
 *
 * 값은 components/cards/CardFormModal.tsx 의 것을 그대로 쓴다(두 창이 같아 보여야 한다).
 * 아이콘은 **lucide 모양 인라인 SVG** 다 — 디자인 규칙이 이모지를 아이콘으로 쓰지 못하게
 * 하고, lucide-react 는 미설치라 path 를 직접 적는다(stroke-width 2 · 18px).
 */

import type { CSSProperties, ReactNode } from 'react'
import { BLUE, BORDER, CARD_BG, TEXT } from '@/components/common/ui'
import { R } from '@/lib/radius'

export const bigPickButton: CSSProperties = {
  minHeight: 88, width: '100%', padding: '12px 14px', boxSizing: 'border-box',
  border: `1px solid ${BORDER}`, borderRadius: R.card, background: CARD_BG,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
  fontSize: 14, fontWeight: 700, color: TEXT, cursor: 'pointer', fontFamily: 'inherit',
}

/** 큰 버튼의 첫 줄 — 아이콘 + 이름. */
export const bigPickHead: CSSProperties = { display: 'flex', alignItems: 'center', gap: 7 }

const svg = (children: ReactNode) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={BLUE}
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

export const PICK_ICON = {
  camera: svg(<><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" /><circle cx="12" cy="13" r="3" /></>),
  pen: svg(<><path d="M12 20h9" /><path d="M16.4 3.6a1 1 0 0 1 3 3L7.4 18.6a2 2 0 0 1-.9.5l-2.8.8a.5.5 0 0 1-.6-.6l.8-2.8a2 2 0 0 1 .5-.9Z" /></>),
  mail: svg(<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" /></>),
}
