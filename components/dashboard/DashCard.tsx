'use client'

// 개인 대시보드의 **카드 껍데기** — 제목 한 줄 + 본문.
//
// 격자가 카드 높이를 정하므로 본문은 그 안에서만 흐른다. 넘치면 카드가 늘어나는 대신
// 본문이 잘린다 — 카드마다 높이가 달라지면 격자가 어긋나 읽기 어려워진다.
// 숫자와 짧은 목록만 둔다. 긴 표는 카드를 눌러 가는 곳의 몫이다.
//
// **「전체 보기 →」 글자는 없다.** 카드마다 작은 글자 단추가 하나씩 달려 있으면, 정작
// 누르고 싶은 곳(카드 전체)은 아무 반응이 없고 과녁만 작아진다. 그래서 그 일을
// 카드 전체 클릭으로 옮기고, 눌릴 수 있다는 신호는 hover(살짝 떠오름 + 파란 테두리)로
// 준다 — 활동 기록 카드가 쓰던 그 동작 그대로다.

import type { ReactNode } from 'react'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const MUTED = '#9ca3af'

export type DashCardProps = {
  title: string
  /** 카드를 누르면 할 일(모달·화면 이동). 주지 않으면 누를 수 없는 카드다. */
  onClick?: () => void
  /** 조회가 실패했는가 — 카드 하나가 못 읽어도 다른 카드는 그대로 뜬다. */
  error?: boolean
  /** 실패한 이유 한 마디. 콘솔만 보고 원인을 찾게 두지 않는다. */
  errorMessage?: string
  loading?: boolean
  children: ReactNode
}

export default function DashCard({ title, onClick, error, errorMessage, loading, children }: DashCardProps) {
  return (
    <section
      onClick={onClick}
      style={{
        background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8,
        display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.15s ease, border-color 0.15s ease',
      }}
      onMouseEnter={e => {
        if (!onClick) return
        e.currentTarget.style.borderColor = '#c7d7f8'
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={e => {
        if (!onClick) return
        e.currentTarget.style.borderColor = BORDER
        e.currentTarget.style.transform = ''
      }}
    >
      {/* 제목 줄 — 아래 구분선. 활동 기록 카드와 같은 틀이다. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 10px',
        borderBottom: `1px solid ${BORDER}`, flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{title}</span>
        <span style={{ flex: 1 }} />
      </div>
      {/* 본문 — 세로 flex 다. 목록이 남는 높이를 갖고 합계가 바닥에 남는다(CountList fitHeight). */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'hidden', padding: '12px 16px 10px',
        display: 'flex', flexDirection: 'column',
      }}>
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
