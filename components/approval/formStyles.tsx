'use client'

// 문서 양식 화면의 표 스타일 — **기존 문서 상세의 표를 그대로 따른다.**
//
// 라벨 칸은 중립 배경(NEUTRAL_BG), 값 칸은 흰 배경, 칸 사이는 1px 테두리다.
// 그 규칙은 components/approval/DocInfo.tsx 가 이미 쓰고 있고, 양식 머리 표·본문 표·유형별 본문이
// 같은 모양이어야 한 장의 문서로 읽힌다. 그래서 값을 여기 한 곳에 모아 셋이 함께 쓴다.
//
// 새 색·크기를 만들지 않는다 — EMS 토큰만 쓴다(디자인 규칙).

import type { CSSProperties, ReactNode } from 'react'
import { BORDER, CARD_BG, NEUTRAL_BG, SUB, TEXT } from '@/components/common/ui'

/** 라벨 칸 폭 — DocInfo 와 같은 값(78)보다 넓다. 양식 본문의 라벨이 「예상매출이익(율)」처럼 길다. */
const LABEL_W = 104

/** 표가 좁은 화면에서 **자기 상자 안에서만** 가로로 스크롤되게 한다(페이지가 옆으로 밀리지 않게). */
export const scrollBox: CSSProperties = {
  border: `1px solid ${BORDER}`, borderRadius: 6, overflowX: 'auto', maxWidth: '100%', background: CARD_BG,
}

export const formTable: CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 520,
}

export const formTh: CSSProperties = {
  padding: '6px 9px', textAlign: 'left', color: SUB, fontWeight: 700, whiteSpace: 'nowrap',
  background: NEUTRAL_BG, borderBottom: `1px solid ${BORDER}`,
}

export const formTd: CSSProperties = {
  padding: '6px 9px', color: TEXT, borderTop: `1px solid ${BORDER}`, verticalAlign: 'top',
}

/**
 * 「라벨 | 값」 한 줄 — 양식 머리 표와 본문 표가 함께 쓴다.
 * first 면 위 테두리를 두지 않는다(상자의 테두리가 이미 있다).
 */
export function FormRow({
  label, children, first, title,
}: {
  label: string
  children: ReactNode
  first?: boolean
  /** 값이 줄여 적힌 경우의 전체 내용(참조자 목록 등). */
  title?: string
}) {
  return (
    <div style={{ display: 'flex', borderTop: first ? 'none' : `1px solid ${BORDER}` }}>
      <div style={{
        width: LABEL_W, flexShrink: 0, padding: '6px 8px', background: NEUTRAL_BG,
        fontSize: 11, fontWeight: 700, color: SUB, borderRight: `1px solid ${BORDER}`,
      }}>
        {label}
      </div>
      <div
        title={title}
        style={{ flex: 1, minWidth: 0, padding: '6px 10px', fontSize: 12, color: TEXT, wordBreak: 'break-word' }}
      >
        {children}
      </div>
    </div>
  )
}
