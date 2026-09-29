'use client'

// 문서 정보 표 — 아마란스 문서 머리와 같은 칸 구성.
//   문서번호 · 작성일자 · 기안부서 · 기안자 · 수신및참조 · 제목
//
// 라벨 칸은 중립 배경, 값 칸은 흰 배경. 색·글꼴은 EMS 토큰만 쓴다.

import type { ApprovalLine } from '@/lib/approval/types'
import { BORDER, CARD_BG, NEUTRAL_BG, SUB, TEXT } from '@/components/common/ui'
import type { ProgressPerson } from './ApprovalTable'

const dayText = (iso: string | null): string => {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

export default function DocInfo({
  docNo, submittedAt, requesterId, title, lines, people,
}: {
  docNo: string
  /** 작성일자 — 상신일(없으면 만든 날) */
  submittedAt: string | null
  requesterId: number
  title: string
  lines: ApprovalLine[]
  people: Record<number, ProgressPerson>
}) {
  const me = people[requesterId]
  const nameOf = (id: number) => people[id]?.name ?? `#${id}`
  const withPos = (id: number) => [nameOf(id), people[id]?.position ?? ''].filter(Boolean).join(' ')
  const cc = lines.filter(l => l.kind === 'cc')

  const rows: { label: string; value: string }[] = [
    { label: '문서번호', value: docNo },
    { label: '작성일자', value: dayText(submittedAt) },
    { label: '기안부서', value: me?.teams?.trim() || '-' },
    { label: '기안자', value: withPos(requesterId) },
    { label: '수신및참조', value: cc.length ? cc.map(l => withPos(l.approver_id)).join(' · ') : '-' },
    { label: '제목', value: title },
  ]

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden', background: CARD_BG, minWidth: 260 }}>
      {rows.map((r, i) => (
        <div key={r.label} style={{ display: 'flex', borderTop: i === 0 ? 'none' : `1px solid ${BORDER}` }}>
          <div style={{
            width: 78, flexShrink: 0, padding: '6px 8px', background: NEUTRAL_BG,
            fontSize: 11, fontWeight: 700, color: SUB, borderRight: `1px solid ${BORDER}`,
          }}>
            {r.label}
          </div>
          <div style={{ flex: 1, minWidth: 0, padding: '6px 10px', fontSize: 12, color: TEXT, wordBreak: 'break-word' }}>
            {r.value}
          </div>
        </div>
      ))}
    </div>
  )
}
