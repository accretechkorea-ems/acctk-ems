'use client'

// 포캐스트 줄 목록 — 한 줄이 곧 안건 하나다(견적 또는 영업기회).
//
// 견적 줄은 **읽기 전용**이다(금액·월이 견적서에서 나온다). 번호를 누르면 저장된 PDF 를 연다.
// 영업기회 줄은 예상월·금액을 **줄에서 바로** 고친다 — 견적 전 안건을 넣는 유일한 입구라
// 모달까지 열지 않고 숫자만 고칠 수 있어야 한다. 고칠 수 있는 사람은 담당자 본인뿐이다
// (판정은 useOpportunityCrud 의 canEditOpp 를 그대로 쓴다).

import { useState } from 'react'
import type { ForecastRow, ForecastStatus } from '@/lib/forecast'
import type { SalesOpportunity } from '@/components/customer/types'

const BLUE = '#234ea2'
const TEXT = '#111827'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'
const FADE = '#d1d5db'
const BORDER = '#ebebeb'
const RED = '#ef4444'

/** 상태 dot 색 — 디자인 규칙대로 **색은 dot 에만** 둔다(글자는 중립색). */
const DOT: Record<ForecastStatus, string> = {
  포캐스트: '#234ea2',
  '포캐스트(80)': '#234ea2',
  '포캐스트(40)': '#234ea2',
  지연: '#f59e0b',
  수주확정: '#16a34a',
  실주: '#ef4444',
  구매취소: '#9ca3af',
}

export type ForecastRowListProps = {
  rows: ForecastRow[]
  engineerName: (id: number | null) => string
  customerName: (id: number | null) => string
  categoryLabel: (code: string | null) => string
  formLabel: (code: string | null) => string
  /** 영업기회 원본 — 줄에서 고치거나 모달을 열 때 필요하다. */
  oppById: Map<number, SalesOpportunity>
  canEditOpp: (o: SalesOpportunity) => boolean
  /** 예상월·금액 저장. 성공하면 true. */
  onSaveOpp: (o: SalesOpportunity, patch: { expected_close?: string; expected_amount?: number }) => Promise<boolean>
  onOpenOpp: (o: SalesOpportunity) => void
  onOpenQuote: (row: ForecastRow) => void
  onWriteQuote: (o: SalesOpportunity) => void
}

const won = (n: number) => n.toLocaleString('ko-KR')
const td: React.CSSProperties = { padding: '10px 12px', fontSize: 12, color: TEXT, whiteSpace: 'nowrap' }
const th: React.CSSProperties = {
  padding: '9px 12px', fontSize: 11, fontWeight: 700, color: MUTED,
  textAlign: 'left', whiteSpace: 'nowrap', borderBottom: `1px solid ${BORDER}`,
}

/** 그 달의 말일 'YYYY-MM-DD' — expected_close 는 월 입력을 말일로 저장한다(opportunity.ts 와 같은 규칙). */
const monthToLastDay = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ''
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

export default function ForecastRowList(props: ForecastRowListProps) {
  const {
    rows, engineerName, customerName, categoryLabel, formLabel,
    oppById, canEditOpp, onSaveOpp, onOpenOpp, onOpenQuote, onWriteQuote,
  } = props

  // 지금 고치고 있는 칸 하나. 두 칸을 동시에 열지 않는다(저장이 겹치면 어느 값이 남는지 알 수 없다).
  const [editing, setEditing] = useState<{ id: number; field: 'month' | 'amount' } | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const startEdit = (row: ForecastRow, field: 'month' | 'amount') => {
    const o = oppById.get(row.id)
    if (!o || !canEditOpp(o)) return
    setEditing({ id: row.id, field })
    setDraft(field === 'month' ? row.month : String(row.amount))
  }

  const commit = async (row: ForecastRow, field: 'month' | 'amount') => {
    const o = oppById.get(row.id)
    setEditing(null)
    if (!o) return
    if (field === 'month') {
      const next = monthToLastDay(draft)
      if (!next || next === o.expected_close) return
      setSaving(true); await onSaveOpp(o, { expected_close: next }); setSaving(false)
      return
    }
    const n = Number(draft.replace(/[^\d-]/g, ''))
    if (!Number.isFinite(n) || n === (o.expected_amount ?? 0)) return
    setSaving(true); await onSaveOpp(o, { expected_amount: n }); setSaving(false)
  }

  if (rows.length === 0) {
    return (
      <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 40, textAlign: 'center', color: MUTED, fontSize: 13 }}>
        조건에 맞는 안건이 없습니다
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={th}>예상월</th>
              <th style={th}>상태</th>
              <th style={th}>담당자</th>
              <th style={th}>고객사</th>
              <th style={th}>대리점</th>
              <th style={th}>분류</th>
              <th style={th}>양식</th>
              <th style={th}>번호 / 제목</th>
              <th style={{ ...th, textAlign: 'right' }}>금액</th>
              <th style={th}>등록일</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isOpp = row.source === 'opportunity'
              const o = isOpp ? oppById.get(row.id) ?? null : null
              const editable = !!o && canEditOpp(o)
              const late = row.status === '지연'
              const editingThis = (f: 'month' | 'amount') => editing?.id === row.id && editing.field === f && isOpp
              return (
                <tr key={`${row.source}-${row.id}`} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  {/* 예상월 — 지연이면 붉게. 영업기회는 누르면 그 자리에서 고친다. */}
                  <td style={{ ...td, color: late ? RED : TEXT, fontWeight: late ? 700 : 500 }}>
                    {editingThis('month') ? (
                      <input
                        type="month" value={draft} autoFocus disabled={saving}
                        onChange={e => setDraft(e.target.value)}
                        onBlur={() => void commit(row, 'month')}
                        onKeyDown={e => { if (e.key === 'Enter') void commit(row, 'month'); if (e.key === 'Escape') setEditing(null) }}
                        style={{ width: 130, padding: '3px 6px', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 12, fontFamily: 'inherit' }}
                      />
                    ) : (
                      <span
                        onClick={() => editable && startEdit(row, 'month')}
                        title={editable ? '눌러서 예상월 변경' : undefined}
                        style={{ cursor: editable ? 'pointer' : 'default', borderBottom: editable ? `1px dashed ${FADE}` : 'none' }}
                      >
                        {row.month || '-'}
                      </span>
                    )}
                  </td>

                  {/* 상태 — dot + 글자. 견적 줄은 원래 상태를 작은 배지로 함께 보여 준다. */}
                  <td style={td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: DOT[row.status], flexShrink: 0 }} />
                      <span style={{ fontWeight: 600 }}>{row.status}</span>
                      {row.source === 'quote' && row.rawStatus && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: GRAY, background: '#f3f4f6', borderRadius: 99, padding: '1px 7px' }}>
                          {row.rawStatus}
                        </span>
                      )}
                    </span>
                  </td>

                  <td style={{ ...td, color: GRAY }}>{engineerName(row.engineerId) || '-'}</td>
                  <td style={{ ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{customerName(row.customerId) || '-'}</td>
                  <td style={{ ...td, color: row.dealerId ? GRAY : FADE }}>{row.dealerId ? customerName(row.dealerId) : '직판'}</td>
                  <td style={{ ...td, color: row.category ? GRAY : FADE }}>{categoryLabel(row.category)}</td>
                  <td style={{ ...td, color: row.formKind ? GRAY : FADE }}>{formLabel(row.formKind)}</td>

                  {/* 번호 / 제목 — 견적은 번호(누르면 PDF), 영업기회는 제목(누르면 모달). */}
                  <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.source === 'quote' ? (
                      <span onClick={() => onOpenQuote(row)}
                        style={{ color: BLUE, cursor: 'pointer', fontWeight: 600 }}>
                        {row.no ?? `#${row.id}`}
                      </span>
                    ) : (
                      <span onClick={() => o && onOpenOpp(o)}
                        style={{ color: BLUE, cursor: o ? 'pointer' : 'default', fontWeight: 600 }}>
                        {o?.title ?? `#${row.id}`}
                      </span>
                    )}
                  </td>

                  {/* 금액 — 영업기회는 그 자리에서 고친다. */}
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }} className="num">
                    {editingThis('amount') ? (
                      <input
                        type="number" value={draft} autoFocus disabled={saving}
                        onChange={e => setDraft(e.target.value)}
                        onBlur={() => void commit(row, 'amount')}
                        onKeyDown={e => { if (e.key === 'Enter') void commit(row, 'amount'); if (e.key === 'Escape') setEditing(null) }}
                        style={{ width: 120, padding: '3px 6px', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 12, textAlign: 'right', fontFamily: 'inherit' }}
                      />
                    ) : (
                      <span
                        onClick={() => editable && startEdit(row, 'amount')}
                        title={editable ? '눌러서 금액 변경' : undefined}
                        style={{ cursor: editable ? 'pointer' : 'default', borderBottom: editable ? `1px dashed ${FADE}` : 'none' }}
                      >
                        {won(row.amount)}
                      </span>
                    )}
                  </td>

                  <td style={{ ...td, color: MUTED, fontSize: 11 }}>{(row.createdAt ?? '').slice(0, 10) || '-'}</td>

                  {/* 영업기회만 — 여기서 견적으로 이어진다(안건과 견적을 잇는 유일한 길). */}
                  <td style={{ ...td, textAlign: 'right' }}>
                    {o && (
                      <button type="button" onClick={() => onWriteQuote(o)}
                        style={{ padding: '4px 10px', background: '#fff', color: BLUE, border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 0.15s ease' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                        견적 쓰기
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
