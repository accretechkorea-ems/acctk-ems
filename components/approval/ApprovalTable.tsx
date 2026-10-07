'use client'

// 결재표 — 아마란스 결재란과 같은 모양. 가로로 직급 헤더, 그 아래 도장, 그 아래 처리일과 이름.
//
//        ┌──┬──────┬──────┬──────┬──────┐
//   결재 │  │ 선임 │ 책임 │ 수석 │ 사장 │   ← 직급(가로 헤더). 맨 앞은 기안자다.
//        │  ├──────┼──────┼──────┼──────┤
//        │  │(기안)│(도장)│(도장)│      │   ← 처리 전이면 빈칸
//        │  ├──────┼──────┼──────┼──────┤
//        │  │09.02 │09.21 │09.22 │      │   ← 처리일(기안자는 상신일)
//        │  │권재원│홍길동│김철수│이상철│   ← 이름
//   합의 │  │ …                          │   ← 합의가 있으면 같은 모양으로 한 줄 더(기안자 칸 없음)
//        └──┴──────┴──────┴──────┴──────┘
//
// 맨 앞 기안자 칸은 아마란스와 같다 — 상신하는 순간 자기 칸에 도장이 찍힌 상태로 시작한다.
// 그 칸은 결재선(approval_lines)이 아니라 문서 자체의 값(requester_id · submitted_at)으로 그린다.
// 결재선에 기안자 행을 만들면 판정(다음 차례·완료 여부)이 기안자를 결재자로 세게 되므로 넣지 않는다.
//
// 도장은 이미지가 아니라 코드로 그린다 — 빨간 원 테두리 + 이름(승인서 PDF 와 같은 방식).
// 색은 EMS 토큰만 쓴다. 도장 빨강은 DANGER 로, 승인서 PDF 의 도장색과 같은 값이다.
//
// 수신참조(cc)는 결재표에 넣지 않는다 — 문서 정보의 「수신및참조」 줄에 적는다.

import type { CSSProperties } from 'react'
import { BORDER, CARD_BG, DANGER, MUTED, NEUTRAL_BG, PAGE_BG, SUB, TEXT } from '@/components/common/ui'
import type { ApprovalLine } from '@/lib/approval/types'
// 칸 규칙(어느 줄이 칸이 되는가 · 어느 칸에 도장이 찍히는가)은 순수 모듈 하나에 모여 있다.
// 진행 표기(boxes.ts 의 statusText)가 같은 함수를 봐야 「결재란 3칸 · 도장 2개」와 「진행(2/3)」이 어긋나지 않는다.
import { isStamped, requesterStamped, tableLines } from '@/lib/approval/tableCells'

export type ProgressPerson = { name: string | null; position: string | null; teams?: string | null }

/** 표의 한 칸 — 결재선 한 줄에서 오기도 하고(결재자), 문서 자체에서 오기도 한다(기안자). */
type Cell = {
  key: string
  /** 가로 헤더 */
  position: string
  name: string
  /** 처리일. 빈 문자열이면 아직 찍히지 않은 칸이다. */
  date: string
  /** 도장을 찍은 칸인가 */
  stamped: boolean
  /** 칸 안에 작게 붙는 말 — 전결·대결·생략·반려 */
  note: string | null
  /** 지금 차례인 칸 */
  current: boolean
}

/** 칸 안에 작게 붙는 말 — 승인은 적지 않는다(도장이 곧 승인이다). */
const noteOf = (l: ApprovalLine, nameOf: (id: number) => string): string | null => {
  if (l.state === '생략') return '생략'
  if (l.state === '반려') return '반려'
  if (l.state === '전결' || l.is_delegated_authority) return '전결'
  if (l.state === '대결') return l.acted_by != null ? `대결 ${nameOf(l.acted_by)}` : '대결'
  return null
}

const dayText = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

const CELL_W = 74

const headCell: CSSProperties = {
  width: CELL_W, flexShrink: 0, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: NEUTRAL_BG, borderLeft: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}`,
  fontSize: 11, fontWeight: 700, color: SUB, whiteSpace: 'nowrap', overflow: 'hidden',
}

const stampCell = (current: boolean): CSSProperties => ({
  width: CELL_W, flexShrink: 0, height: 62, display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', gap: 2,
  borderLeft: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}`,
  background: current ? PAGE_BG : CARD_BG,
})

const footCell: CSSProperties = {
  width: CELL_W, flexShrink: 0, minHeight: 32, padding: '3px 2px', display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', gap: 1,
  borderLeft: `1px solid ${BORDER}`, background: CARD_BG,
}

/** 왼쪽 세로 라벨 — 「결재」「합의」 */
const rowLabel: CSSProperties = {
  width: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: NEUTRAL_BG, fontSize: 11, fontWeight: 700, color: SUB, writingMode: 'vertical-rl',
  letterSpacing: 2, padding: '6px 0',
}

/** 빨간 원 테두리 + 이름. 이름이 길면 글자를 줄여 원 안에 넣는다. */
function Stamp({ name }: { name: string }) {
  const size = name.length >= 4 ? 10 : name.length === 3 ? 12 : 13
  return (
    <span style={{
      width: 42, height: 42, borderRadius: '50%', border: `2px solid ${DANGER}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: DANGER, fontSize: size, fontWeight: 700, lineHeight: 1,
      overflow: 'hidden', padding: 2, textAlign: 'center',
    }}>
      {name}
    </span>
  )
}

/** 한 종류(결재 또는 합의)의 줄 묶음 — 헤더·도장·처리일/이름 세 줄. */
function CellRow({ label, cells }: { label: string; cells: Cell[] }) {
  return (
    <div style={{ display: 'flex', borderTop: `1px solid ${BORDER}` }}>
      <div style={rowLabel}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* 직급 — 가로 헤더 */}
        <div style={{ display: 'flex' }}>
          {cells.map(c => <div key={`h${c.key}`} style={headCell}>{c.position}</div>)}
        </div>
        {/* 도장 — 처리 전이면 빈칸 */}
        <div style={{ display: 'flex' }}>
          {cells.map(c => (
            <div key={`s${c.key}`} style={stampCell(c.current)}>
              {c.stamped && <Stamp name={c.name} />}
              {c.note && <span style={{ fontSize: 10, color: SUB, whiteSpace: 'nowrap' }}>{c.note}</span>}
            </div>
          ))}
        </div>
        {/* 처리일 · 이름 */}
        <div style={{ display: 'flex' }}>
          {cells.map(c => (
            <div key={`f${c.key}`} style={footCell}>
              <span style={{ fontSize: 10, color: MUTED, whiteSpace: 'nowrap' }}>{c.date}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: CELL_W - 6 }}>
                {c.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ApprovalTable({
  lines, people, currentLineId, requesterId, submittedAt,
}: {
  lines: ApprovalLine[]
  /** engineer_id → 이름·직급·부서. 없으면 「#12」처럼 번호로 보여준다. */
  people: Record<number, ProgressPerson>
  /** 지금 차례인 줄. 없으면 강조하지 않는다(완료·반려·회수). */
  currentLineId: number | null
  /**
   * 기안자 — approval_documents.requester_id. 맨 앞 칸을 그린다.
   * 넘기지 않으면 기안자 칸 없이 결재선만 그린다(옛 호출부와 그대로 맞물린다).
   */
  requesterId?: number | null
  /** 상신일 — approval_documents.submitted_at. 없으면(임시저장) 기안자 칸의 도장을 비운다. */
  submittedAt?: string | null
}) {
  const nameOf = (id: number) => people[id]?.name ?? `#${id}`
  const posOf = (id: number) => people[id]?.position ?? '-'

  const toCell = (l: ApprovalLine): Cell => ({
    key: `l${l.line_id}`,
    position: posOf(l.approver_id),
    name: nameOf(l.approver_id),
    date: dayText(l.acted_at),
    stamped: isStamped(l.state),
    note: noteOf(l, nameOf),
    current: l.line_id === currentLineId,
  })

  // 기안자 칸 — 결재선이 아니라 문서 값으로 만든다. 상신 전(임시저장)이면 도장을 찍지 않는다.
  const requester: Cell[] = requesterId == null ? [] : [{
    key: 'requester',
    position: posOf(requesterId),
    name: nameOf(requesterId),
    date: dayText(submittedAt ?? null),
    stamped: requesterStamped(requesterId, submittedAt),
    note: null,
    current: false,
  }]

  // 어느 줄이 칸이 되고 어떤 순서인가 — tableCells.ts 가 정한다(여기서 다시 거르지 않는다).
  const cells = tableLines(lines)
  const approve = [...requester, ...cells.approve.map(toCell)]
  const agree = cells.agree.map(toCell)
  if (approve.length === 0 && agree.length === 0) return null

  return (
    // 칸이 많으면(기안자 + 결재자 여섯 이상) 표가 상세 폭을 넘을 수 있다 — 그때만 가로로 민다.
    <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
      <div style={{
        display: 'inline-flex', flexDirection: 'column',
        border: `1px solid ${BORDER}`, borderTop: 'none', borderRadius: 6, overflow: 'hidden', background: CARD_BG,
      }}>
        {approve.length > 0 && <CellRow label="결재" cells={approve} />}
        {/* 합의에는 기안자 칸을 두지 않는다 — 기안은 결재 줄에서 한 번만 나온다. */}
        {agree.length > 0 && <CellRow label="합의" cells={agree} />}
      </div>
    </div>
  )
}
