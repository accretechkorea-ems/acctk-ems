'use client'

// 결재선 진행도 — 순번대로 가로로 그린다.
//
// 상태 색은 상태 dot 규칙을 그대로 쓴다(디자인 규칙: 색은 dot 에만, 글자는 중립).
//   대기 회색 · 승인/전결/대결 파랑 · 반려 빨강 · 생략 흐리게
// 지금 차례인 칸만 테두리를 액센트로 바꿔 강조하고, 처리된 칸은 아래에 시각과 의견을 작게 단다.
// 수신참조는 순서를 갖지 않으므로 오른쪽 끝에 따로 묶는다.

import type { CSSProperties } from 'react'
import { BLUE, BORDER, CARD_BG, DANGER, FAINT, MUTED, NEUTRAL_BG, SUB, TEXT } from '@/components/common/ui'
import type { ApprovalLine, LineState } from '@/lib/approval/types'

export type ProgressPerson = { name: string | null; position: string | null }

const KIND_LABEL: Record<string, string> = { approve: '결재', agree: '합의', cc: '참조' }

/** 상태 dot 색. 글자는 건드리지 않는다. */
function dotColor(state: LineState): string {
  if (state === '반려') return DANGER
  if (state === '승인' || state === '전결' || state === '대결') return BLUE
  if (state === '생략') return FAINT
  return '#d1d5db'   // 대기 — 가장 흐린 회색
}

/** 칸 아래에 붙는 상태 글자. 대기는 적지 않는다(빈 칸이 곧 대기다). */
function stateLabel(state: LineState): string | null {
  return state === '대기' ? null : state
}

const timeText = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const boxStyle = (current: boolean, skipped: boolean): CSSProperties => ({
  minWidth: 104,
  flexShrink: 0,
  border: `1px solid ${current ? '#c7d7f8' : BORDER}`,
  borderRadius: 6,
  padding: '8px 10px',
  background: current ? '#fafafa' : CARD_BG,
  opacity: skipped ? 0.5 : 1,
})

export default function LineProgress({
  lines,
  people,
  currentLineId,
}: {
  lines: ApprovalLine[]
  /** engineer_id → 이름·직급. 없으면 「#12」처럼 번호로 보여준다. */
  people: Record<number, ProgressPerson>
  /** 지금 차례인 줄. 없으면 강조하지 않는다(완료·반려·회수). */
  currentLineId: number | null
}) {
  const ordered = lines
    .filter(l => l.kind !== 'cc')
    .sort((a, b) => (a.step ?? 0) - (b.step ?? 0) || a.line_id - b.line_id)
  const cc = lines.filter(l => l.kind === 'cc')

  const nameOf = (id: number) => people[id]?.name ?? `#${id}`
  const posOf = (id: number) => people[id]?.position ?? ''

  const cell = (l: ApprovalLine, current: boolean) => {
    const label = stateLabel(l.state)
    return (
      <div key={l.line_id} style={boxStyle(current, l.state === '생략')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor(l.state), flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap' }}>{nameOf(l.approver_id)}</span>
          {posOf(l.approver_id) && (
            <span style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>{posOf(l.approver_id)}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: SUB, background: NEUTRAL_BG, borderRadius: 99, padding: '1px 7px' }}>
            {KIND_LABEL[l.kind] ?? l.kind}
          </span>
          {l.is_delegated_authority && (
            <span style={{ fontSize: 11, fontWeight: 700, color: SUB, background: NEUTRAL_BG, borderRadius: 99, padding: '1px 7px' }}>
              전결
            </span>
          )}
          {label && <span style={{ fontSize: 11, fontWeight: 600, color: l.state === '반려' ? DANGER : SUB }}>{label}</span>}
        </div>
        {l.acted_at && (
          <div style={{ fontSize: 11, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
            {timeText(l.acted_at)}
            {l.state === '대결' && l.acted_by != null && (
              <>
                <span style={{ color: FAINT }}> · </span>
                {nameOf(l.acted_by)} 대결
              </>
            )}
            {l.comment && <div style={{ color: SUB, wordBreak: 'break-word' }}>{l.comment}</div>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
      {ordered.map((l, i) => (
        <div key={l.line_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {i > 0 && <span style={{ color: FAINT, fontSize: 12, flexShrink: 0 }}>›</span>}
          {cell(l, l.line_id === currentLineId)}
        </div>
      ))}
      {cc.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', paddingLeft: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap' }}>참조</span>
          {cc.map(l => (
            <div key={l.line_id} style={{ ...boxStyle(false, false), minWidth: 88 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap' }}>{nameOf(l.approver_id)}</div>
              {posOf(l.approver_id) && <div style={{ fontSize: 11, color: MUTED }}>{posOf(l.approver_id)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
