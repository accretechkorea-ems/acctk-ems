'use client'

// 「무엇이 몇 건인가」 목록 — 활동 기록 카드의 그 목록·합계를 부품으로 뽑은 것이다.
//
// 홈 격자의 다섯 카드(활동 기록·내 견적·결재 대기·알림·포캐스트)가 같은 틀을 쓴다.
// 카드마다 비슷하지만 조금씩 다른 목록을 손으로 다시 그리면, 점 크기 하나·줄 간격 하나가
// 어긋나 격자가 지저분해진다. 그래서 **모양은 여기 하나**에만 두고 카드는 줄 자료만 넘긴다.
//
// 값(줄 높이 20·간격 7·점 9px·글자 12·뱃지 radius 6)은 활동 기록 카드에서 **그대로** 옮겼다 —
// 그 카드가 이 부품을 쓰도록 바꿨으므로 모양이 바뀌면 활동 현황 화면에서 바로 보인다.
//
// 카드의 **머리·본문 치수**(CARD_HEAD_STYLE·CARD_BODY_STYLE)도 여기 둔다. 머리 높이를
// 카드마다 내용으로 정하면(이름 두 줄이냐, 월 이동 단추가 있느냐) 구분선 y 가 칸마다 달라져
// 격자가 어긋난다. 그래서 **높이를 못 박고** 내용은 그 안에서 가운데 정렬한다.

import { type CSSProperties } from 'react'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const MUTED = '#9ca3af'
const BLUE = '#234ea2'
const FADE = '#d1d5db'

// 목록은 6줄 높이로 고정한다(fitHeight 를 주지 않을 때) — 줄 수가 달라도 카드 높이가
// 들쭉날쭉하지 않게. 6줄을 넘으면 이 영역 안에서만 세로로 스크롤된다.
const ROW_H = 20
const ROW_GAP = 7
const LIST_H = ROW_H * 6 + ROW_GAP * 5

/**
 * 카드 머리 — 제목 줄 + 아래 구분선. 높이를 못 박았다(24px 월 이동 단추도 들어간다).
 * DashCard 와 활동 기록 카드(홈)가 **같은 값**을 쓰므로 구분선이 한 줄로 맞는다.
 */
export const CARD_HEAD_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, height: 42, padding: '0 16px',
  borderBottom: `1px solid ${BORDER}`, flexShrink: 0, boxSizing: 'border-box',
}

/**
 * 카드 본문 — 목록이 남는 높이를 갖고 합계가 바닥에 남는다(세로 flex).
 * **가로는 자른다.** 세로만 auto 로 두면 CSS 규칙에 따라 가로가 visible → auto 로 승격되어,
 * 줄이 한 픽셀만 넘쳐도 가로 스크롤바가 생긴다.
 */
export const CARD_BODY_STYLE: CSSProperties = {
  flex: 1, minHeight: 0, overflow: 'hidden', padding: '12px 16px 10px',
  display: 'flex', flexDirection: 'column',
}

/** 목록 한 줄. onClick 을 주면 누를 수 있는 줄이 된다(바탕이 살짝 들어온다). */
export type CountRow = {
  key: string
  label: string
  count: number
  /** 왼쪽 점 색. 의미색은 부르는 쪽이 고른다(lib/categoryColors.ts 의 표에서). */
  color: string
  onClick?: () => void
}

/** 줄 안쪽 — 점 · 이름 · 건수 뱃지. 누를 수 있는 줄과 아닌 줄이 똑같이 보이게 따로 뽑았다. */
function RowInner({ row }: { row: CountRow }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <div style={{ width: 9, height: 9, borderRadius: '50%', background: row.color, flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: TEXT, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.label}</span>
      </div>
      <span style={{
        fontSize: 12, fontWeight: 600, flexShrink: 0,
        color: row.color,
        background: '#f3f4f6', borderRadius: 6, padding: '2px 8px',
      }}>
        {row.count}<span style={{ color: MUTED }}>건</span>
      </span>
    </>
  )
}

export function CountList({ rows, emptyText, fitHeight = false }: {
  rows: CountRow[]
  emptyText: string
  /**
   * 주어진 칸 높이에 맞춘다(홈 격자) — 목록이 남는 높이를 갖고 **합계는 바닥에 남는다.**
   * 주지 않으면 6줄 고정이다(활동 현황 화면이 쓰던 모습).
   */
  fitHeight?: boolean
}) {
  const rowStyle: CSSProperties = {
    height: ROW_H, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    gap: 6, minWidth: 0, boxSizing: 'border-box',
  }
  return (
    <>
      <style>{`
        .count-list { scrollbar-width: thin; scrollbar-color: #d1d5db transparent; }
        .count-list::-webkit-scrollbar { width: 5px; }
        .count-list::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
        .count-list::-webkit-scrollbar-track { background: transparent; }
      `}</style>
      <div className="count-list" style={{
        ...(fitHeight ? { flex: 1, minHeight: 0 } : { height: LIST_H }),
        // 세로만 auto 로 두면 가로가 auto 로 승격된다 — 가로는 못 박아 자른다.
        overflowY: 'auto', overflowX: 'hidden', marginBottom: 12,
      }}>
        {rows.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: FADE }}>
            {emptyText}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: ROW_GAP }}>
            {rows.map(row => row.onClick
              ? (
                // 누를 수 있는 줄 — **줄 폭은 그대로**다. 예전에는 바탕을 글자에서 떼려고
                // padding 0 6px + margin 0 -6px 을 줬는데, 그러면 줄이 상자보다 12px 넓어져
                // 목록에 가로 스크롤바가 생겼다(세로 auto 가 가로를 auto 로 승격시킨다).
                // 바탕은 줄 전체에 깔고 점·뱃지 자리는 안 누르는 줄과 똑같이 둔다.
                <button
                  key={row.key} type="button"
                  onClick={e => { e.stopPropagation(); row.onClick?.() }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                  style={{
                    ...rowStyle,
                    padding: 0, borderRadius: 6, width: '100%',
                    background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <RowInner row={row} />
                </button>
              )
              : <div key={row.key} style={rowStyle}><RowInner row={row} /></div>,
            )}
          </div>
        )}
      </div>
    </>
  )
}

/** 바닥의 합계 — 구분선 위에 「합계」, 오른쪽에 큰 숫자 + 「건」. */
export function CountTotal({ total, label = '합계' }: { total: number; label?: string }) {
  return (
    <div style={{
      padding: '5px 0', borderTop: `1px solid ${BORDER}`,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
    }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
        {/* .num 을 붙이지 않는다 — 활동 기록 카드의 합계가 쓰던 모습 그대로다. */}
        <span style={{ fontSize: 20, fontWeight: 600, color: BLUE, letterSpacing: '-0.5px' }}>
          {total}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>건</span>
      </div>
    </div>
  )
}
