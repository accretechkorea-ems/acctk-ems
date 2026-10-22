'use client'

// 개인 대시보드의 **카드 껍데기** — 제목 한 줄 + 오른쪽 「전체 보기 →」 + 본문.
//
// 격자가 카드 높이를 정하므로(약 260px) 본문은 그 안에서만 흐른다. 넘치면 카드가 늘어나는
// 대신 본문이 잘린다 — 카드마다 높이가 달라지면 격자가 어긋나 읽기 어려워진다.
// 숫자와 짧은 목록만 둔다. 긴 표는 「전체 보기」가 데려가는 곳의 몫이다.

import type { ReactNode } from 'react'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const BLUE = '#234ea2'
const MUTED = '#9ca3af'

export type DashCardProps = {
  title: string
  /** 「전체 보기 →」를 누르면 할 일. 주지 않으면 그 자리를 비운다. */
  onMore?: () => void
  moreLabel?: string
  /** 카드 전체가 누를 수 있는가(포캐스트 카드처럼 화면 하나로 가는 경우). */
  onClick?: () => void
  /** 조회가 실패했는가 — 카드 하나가 못 읽어도 다른 카드는 그대로 뜬다. */
  error?: boolean
  /** 실패한 이유 한 마디. 콘솔만 보고 원인을 찾게 두지 않는다. */
  errorMessage?: string
  loading?: boolean
  children: ReactNode
}

export default function DashCard({ title, onMore, moreLabel = '전체 보기', onClick, error, errorMessage, loading, children }: DashCardProps) {
  return (
    <section
      onClick={onClick}
      style={{
        background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8,
        display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s ease',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = '#c7d7f8' }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.borderColor = BORDER }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 8px', flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{title}</span>
        <span style={{ flex: 1 }} />
        {onMore && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onMore() }}
            style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: BLUE, fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >
            {moreLabel} →
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: '0 16px 14px' }}>
        {loading
          ? <div style={{ fontSize: 12, color: MUTED }}>불러오는 중...</div>
          : error
            // 못 읽은 것과 0 건은 전혀 다르다 — 숫자를 0 으로 보여 주지 않는다.
            ? (
              <div>
                <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 700 }}>불러오지 못했습니다</div>
                {errorMessage && <div style={{ fontSize: 11, color: MUTED, marginTop: 4, wordBreak: 'break-all' }}>{errorMessage}</div>}
              </div>
            )
            : children}
      </div>
    </section>
  )
}
