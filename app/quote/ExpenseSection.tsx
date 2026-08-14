'use client'

import { FieldError } from '@/components/common/fieldErrors'
import type { ExpensePreset, ExpenseRow, QuoteRow } from './types'
import { numKR } from './format'
import { inp } from './styles'

// 서비스비 행의 원가 내역. 화면 전용이며 PDF 로는 나가지 않는다.
export type ExpenseSectionProps = {
  row: QuoteRow
  expensePresets: ExpensePreset[]
  presetError: boolean
  errors: { expenses?: string }
  invalidExpenseIds: Set<string>
  totalExpense: number
  addExpense: () => void
  removeExpense: (expenseId: string) => void
  updateExpense: (expenseId: string, patch: Partial<ExpenseRow>) => void
  selectExpensePreset: (expenseId: string, itemName: string) => void
}

export default function ExpenseSection({
  row, expensePresets, presetError, errors, invalidExpenseIds, totalExpense,
  addExpense, removeExpense, updateExpense, selectExpensePreset,
}: ExpenseSectionProps) {
  // 부대비용 내역 — 서비스비 행의 원가. 한 단계 들여써서 소속을 드러낸다.
  return (
    <div style={{ marginTop: 12, marginLeft: 44, padding: '12px 14px', background: '#fafafa', border: '1px solid #ebebeb', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>부대비용 내역</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#dc2626' }}>내부 관리용 · PDF에는 표시되지 않습니다</span>
      </div>

      {presetError && (
        <FieldError message="단가 정보를 불러오지 못했습니다" style={{ marginTop: 0, marginBottom: 10 }} />
      )}

      {row.expenses.map(exp => (
        <div key={exp.id} style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', marginBottom: 8, border: '1px solid #ebebeb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <select
              className="q-input"
              value={exp.item_name}
              onChange={e => selectExpensePreset(exp.id, e.target.value)}
              style={{ ...inp, flex: 1, minWidth: 0, cursor: 'pointer' }}
            >
              <option value="">항목 선택</option>
              {expensePresets.map(p => (
                <option key={p.item_name} value={p.item_name}>{p.item_name}</option>
              ))}
            </select>
            <button onClick={() => removeExpense(exp.id)}
              title="삭제"
              style={{ width: 24, height: 24, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'color 0.15s ease' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
              onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>단가</div>
            <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>인원</div>
            <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>일수</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
            <input className="q-input" type="number" value={exp.unit_price || ''}
              onChange={e => updateExpense(exp.id, { unit_price: parseInt(e.target.value) || 0 })}
              placeholder="0" style={{ ...inp, width: '100%', minWidth: 0, textAlign: 'center' }} />
            <input className="q-input" type="number" value={exp.headcount || ''}
              onChange={e => updateExpense(exp.id, { headcount: parseInt(e.target.value) || 0 })}
              placeholder="0" style={{ ...inp, width: '100%', minWidth: 0, textAlign: 'center' }} />
            <input className="q-input" type="number" value={exp.days || ''}
              onChange={e => updateExpense(exp.id, { days: parseInt(e.target.value) || 0 })}
              placeholder="0" style={{ ...inp, width: '100%', minWidth: 0, textAlign: 'center' }} />
          </div>

          <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
            금액 <b>₩{numKR(exp.amount)}</b>
          </div>
          {errors.expenses && invalidExpenseIds.has(exp.id) && (
            <FieldError message={errors.expenses} />
          )}
        </div>
      ))}

      <button
        onClick={addExpense}
        disabled={presetError}
        style={{ width: '100%', padding: '9px', background: '#fff', color: presetError ? '#9ca3af' : '#234ea2', border: '1px solid #ebebeb', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: presetError ? 'not-allowed' : 'pointer', transition: 'background 0.15s ease' }}
        onMouseEnter={e => { if (!presetError) (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}
        onMouseLeave={e => { if (!presetError) (e.currentTarget as HTMLButtonElement).style.background = '#fff' }}
      >
        + 부대비용 추가
      </button>

      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #ebebeb' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>원가 합계</span>
          <span className="num" style={{ fontSize: 12, color: '#111827', fontWeight: 600 }}>₩{numKR(totalExpense)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>이익</span>
          <span className="num" style={{ fontSize: 12, color: row.profit >= 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>₩{numKR(row.profit)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>이익률</span>
          <span className="num" style={{ fontSize: 12, color: row.profit_rate >= 40 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>{row.profit_rate.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  )
}
