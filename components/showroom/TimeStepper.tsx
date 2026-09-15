'use client'

// [▼] HH:MM [▲] 시간 스테퍼. 30분 단위, 00:00~23:30 에서 멈춘다(순환 없음).
// 동작·치수는 ServiceAddModal.tsx:198-236 의 시작/종료시간 스테퍼와 같다.
// 계산은 lib/workHours.ts 의 stepTime 을 그대로 쓴다(경계 처리가 그 안에 있다).
//
// 기존 모달은 그대로 둔다 — 이 컴포넌트는 쇼룸 화면 전용이다.

import type { CSSProperties } from 'react'
import { stepTime } from '@/lib/workHours'
import { BORDER, NEUTRAL_BG, CARD_BG, TEXT } from '@/components/common/ui'

const STEP_MIN = 30

const boxStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4,
  background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6,
  padding: '0 6px', height: 44, boxSizing: 'border-box',
}
const btnStyle: CSSProperties = {
  border: `1px solid ${BORDER}`, borderRadius: 6, background: NEUTRAL_BG,
  cursor: 'pointer', fontSize: 13, fontWeight: 700, flexShrink: 0, color: TEXT,
}

export default function TimeStepper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={boxStyle}>
      {/* 화살표 폭은 클래스로 뺀다 — 좁은 화면에서만 키워야 해서 미디어 쿼리가 필요하고,
          인라인 스타일이 남아 있으면 그 쿼리를 이기지 못한다(기존 모달과 같은 이유). */}
      <style>{`
        .sr-step { width: 30px; height: 30px; }
        @media (max-width: 767px) { .sr-step { width: 44px; height: 100%; } }
      `}</style>
      <button type="button" className="sr-step" style={btnStyle}
        onClick={() => onChange(stepTime(value, -STEP_MIN))}>▼</button>
      <span style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 16, color: TEXT }}>{value}</span>
      <button type="button" className="sr-step" style={btnStyle}
        onClick={() => onChange(stepTime(value, STEP_MIN))}>▲</button>
    </div>
  )
}
