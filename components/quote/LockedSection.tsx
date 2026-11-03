'use client'

// **아직 쓸 수 없는 영역**을 통째로 잠근다 — 견적 작성에서 분류·양식을 고르기 전까지.
//
// ── 왜 잠그는가 ────────────────────────────────────────────────────────────
//   견적 분류와 양식은 **그 아래 모든 것의 기준**이다. 분류는 줄의 이익률 기본값과
//   판관비율을, 양식은 어느 가격표를 검색할지와 PDF 의 열 구성(모델 열 유무)을 정한다.
//   둘을 고르기 전에 품목부터 넣으면, 나중에 고른 순간 그 줄들의 이익률·분류·검색 범위가
//   한꺼번에 바뀐다 — 사람이 적어 둔 값이 조용히 덮이는 자리였다.
//   확정 단추는 전부터 막고 있었지만(QuotePreviewPane), 막힌 이유가 저 위에 있다는 것은
//   끝까지 가 본 뒤에야 알 수 있었다. 그래서 **들어가기 전에** 막는다.
//
// ── 세 가지를 함께 건다 ────────────────────────────────────────────────────
//   opacity        — 눈으로 「지금은 아니다」를 알린다.
//   pointer-events — 마우스로 못 들어간다.
//   inert          — **키보드(Tab)와 보조기술로도 못 들어간다.** 앞의 둘만으로는 Tab 으로
//                    들어가 글자를 칠 수 있다(화면은 흐린 채로). React 19 가 그대로 넘긴다.

import type { ReactNode } from 'react'

export type LockedSectionProps = {
  locked: boolean
  children: ReactNode
}

export default function LockedSection({ locked, children }: LockedSectionProps) {
  return (
    <div
      inert={locked}
      style={{
        opacity: locked ? 0.45 : 1,
        pointerEvents: locked ? 'none' : undefined,
        transition: 'opacity 0.15s ease',
      }}
    >
      {children}
    </div>
  )
}
