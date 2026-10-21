'use client'

// 견적 목록의 **「지난 날짜로 넣은 건」 표시** — 번호 옆의 작은 아이콘 하나.
//
// 견적 날짜(quote_date)와 실제로 넣은 날(created_at 을 한국 날짜로 읽은 값)이 다를 때만 나온다.
// 판정과 문구는 lib/quoteDate.ts 에 있다 — 목록이 여럿이라 규칙을 한곳에 둔다.
//
// 색은 받아서 쓴다(각 목록의 흐린 글자 색). 기본값은 디자인 토큰의 「텍스트 - 흐림」이다.

import { backdatedTitle, isBackdatedQuote } from '@/lib/quoteDate'

export type BackdatedMarkProps = {
  /** quotes.quote_date ('YYYY-MM-DD') */
  quoteDate: string | null | undefined
  /** quotes.created_at (timestamptz). 없으면 표시하지 않는다 — 모르는 것을 단정하지 않는다. */
  createdAt: string | null | undefined
  color?: string
}

export default function BackdatedMark({ quoteDate, createdAt, color = '#9ca3af' }: BackdatedMarkProps) {
  if (!isBackdatedQuote(quoteDate, createdAt)) return null
  return (
    <span
      title={backdatedTitle(createdAt)}
      style={{ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', marginLeft: 4, color }}
    >
      {/* 되감는 시계(lucide 의 history) — 지난 날짜로 적었다는 뜻이다. */}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l4 2" />
      </svg>
    </span>
  )
}
