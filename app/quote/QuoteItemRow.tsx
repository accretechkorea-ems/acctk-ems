'use client'

import React, { useCallback, useRef } from 'react'
import { useOutsideClick } from '@/hooks/useOutsideClick'
import SegmentedControl from '@/components/common/SegmentedControl'
import type { ExpensePreset, ExpenseRow, PriceItem, QuoteRow, RowKind } from './types'
import { numKR } from './format'
import { inp } from './styles'
import ExpenseSection from './ExpenseSection'

// 행 카드 헤더에 붙는 종류 이름. 색 구분 없이 전부 같은 회색 배지로 쓴다.
const KIND_LABEL: Record<RowKind, string> = {
  price_list: '가격표 검색',
  manual_jpy: '수동 입력',
  domestic: '국내 조달품',
  service: '서비스 비용',
}

// 품목 행 카드 1개(일반 품목 / 서비스비 공용). page.tsx 의 rows.map 본문을 그대로 옮긴 것.
export type QuoteItemRowProps = {
  row: QuoteRow
  rowIdx: number
  rows: QuoteRow[]
  setRows: React.Dispatch<React.SetStateAction<QuoteRow[]>>
  updateRow: (rowId: string, field: keyof QuoteRow, value: unknown) => void
  addSubLine: (rowId: string) => void
  updateSubLine: (rowId: string, idx: number, val: string) => void
  removeSubLine: (rowId: string, idx: number) => void
  handleSearch: (rowId: string, q: string) => void
  handleSelect: (rowId: string, item: PriceItem) => void
  clearItem: (rowId: string) => void
  searchQuery: Record<string, string>
  searchResults: Record<string, PriceItem[]>
  searchOpen: Record<string, boolean>
  setSearchOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  editingProfitRate: Record<string, boolean>
  setEditingProfitRate: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  profitRateInput: Record<string, string>
  setProfitRateInput: React.Dispatch<React.SetStateAction<Record<string, string>>>
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

export default function QuoteItemRow({
  row, rowIdx, rows, setRows, updateRow, addSubLine, updateSubLine, removeSubLine,
  handleSearch, handleSelect, clearItem, searchQuery, searchResults, searchOpen, setSearchOpen,
  editingProfitRate, setEditingProfitRate,
  profitRateInput, setProfitRateInput,
  expensePresets, presetError, errors, invalidExpenseIds, totalExpense,
  addExpense, removeExpense, updateExpense, selectExpensePreset,
}: QuoteItemRowProps) {
  // 가격표 검색 드롭다운 — 바깥 클릭(및 ESC)으로 닫는다. 항목을 반드시 골라야 빠져나올 수 있던 문제 해결.
  // 드롭다운은 searchRef 안에 있으므로 항목 클릭은 '바깥'으로 판정되지 않아 선택 동작에 영향이 없다.
  const searchRef = useRef<HTMLDivElement>(null)
  const closeSearch = useCallback(
    () => setSearchOpen(prev => (prev[row.id] ? { ...prev, [row.id]: false } : prev)),
    [setSearchOpen, row.id],
  )
  useOutsideClick(searchRef, closeSearch, !!searchOpen[row.id])

  // 수동입력 품목의 '판매가' 모드 — 스테퍼 가운데 칸이 이익률 대신 판매단가 입력이 된다.
  const priceInputMode = row.row_kind === 'manual_jpy' && row.price_mode === 'price'
  // 국내조달품 — 마진이 없어 이익률·관세율 스테퍼가 필요 없다(수량만 사용).
  const isDomestic = row.row_kind === 'domestic'

  // 품목을 고르면 품명 칸으로 커서를 옮긴다. 위치는 맨 앞(자동으로 들어간 모델명 앞에 이어 적도록).
  // 품명 값이 갱신된 뒤에 커서를 잡아야 해서 다음 프레임에서 실행한다.
  const itemNameRef = useRef<HTMLInputElement>(null)
  const focusItemName = () => requestAnimationFrame(() => {
    const el = itemNameRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(0, 0)
  })

  // 행 하단 요약 — 한 줄에 몰아넣으면 억 단위에서 넘치므로 항목별로 줄을 나눈다.
  const summaryLines: React.ReactNode[] = []
  if (row.row_kind === 'manual_jpy' && row.product_price > 0) {
    summaryLines.push(<>구입가 ¥{numKR(row.cost_price_jpy)} × 환율 {row.exchange_rate.toFixed(2)} × 관세 ×{row.tariff_rate.toFixed(2)} = 원가 <b>₩{numKR(row.product_price)}</b></>)
  }
  if (row.supply_price > 0) {
    if (isDomestic) {
      summaryLines.push(<>원가 ₩{numKR(row.unit_price)} × {row.quantity} = <b>₩{numKR(row.product_price)}</b> (이익 없음)</>)
      summaryLines.push(<>부가세 없음</>)
    } else if (row.row_kind === 'service') {
      summaryLines.push(<>공급가 <b>₩{numKR(row.supply_price)}</b></>)
      summaryLines.push(<>부가세 ₩{numKR(row.tax)}</>)
    } else {
      summaryLines.push(<>단가 ₩{numKR(row.unit_price)} × {row.quantity} = 공급가 <b>₩{numKR(row.supply_price)}</b></>)
      summaryLines.push(<>부가세 ₩{numKR(row.tax)}</>)
      // 판매가 모드에서는 이익률이 계산 결과라 스테퍼에 나오지 않는다.
      if (priceInputMode) summaryLines.push(<>이익률 {row.profit_rate.toFixed(1)}%</>)
    }
  }

  return (
    <div style={{ background: '#ffffff', borderRadius: 8, padding: '14px', marginBottom: 10, border: '1px solid #ebebeb' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {rows.length > 1 && (
              <span style={{ width: 20, height: 20, borderRadius: 999, background: '#234ea2', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0 }}>{rowIdx + 1}</span>
            )}
            <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px', whiteSpace: 'nowrap' }}>{KIND_LABEL[row.row_kind]}</span>
          </div>
          {rows.length > 1 && (
          <button onClick={() => setRows(prev => prev.filter(r => r.id !== row.id))}
            title="삭제"
            style={{ width: 24, height: 24, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'color 0.15s ease' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
            onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          )}
      </div>

      {/* 가격표 검색(품번) — 선택한 품목의 item_code 가 그대로 표시된다. */}
      {row.row_kind === 'price_list' && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', width: 44, flexShrink: 0 }}>검색</label>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div ref={searchRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <input className="q-input" value={searchQuery[row.id] || ''} onChange={e => handleSearch(row.id, e.target.value)}
            onFocus={() => setSearchOpen(prev => ({ ...prev, [row.id]: true }))}
            placeholder="코드 또는 모델명 검색" style={{ ...inp, width: '100%', paddingRight: row.selectedItem ? 28 : 11 }} />
          {row.selectedItem && (
            <button onClick={() => clearItem(row.id)}
              title="품목 해제"
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 20, height: 20, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s ease' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
              onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
          {searchOpen[row.id] && (searchResults[row.id] || []).length > 0 && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 999, background: '#fff', border: '1px solid #234ea2', borderRadius: 8, maxHeight: 200, overflowY: 'auto', boxShadow: '0 8px 24px rgba(35,78,162,0.12)' }}>
              {searchResults[row.id].map(item => (
                <div key={item.id} onClick={() => { handleSelect(row.id, item); focusItemName() }}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #ebebeb', fontSize: 11, transition: 'background 0.15s ease' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                  <div><span style={{ fontWeight: 700, color: '#234ea2' }}>{item.item_code}</span><span style={{ marginLeft: 6, color: '#111827' }}>{item.item_name_jp}</span><span style={{ marginLeft: 6, color: '#6b7280' }}>({item.model_jp})</span></div>
                  <div style={{ color: '#9ca3af', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>정가: ¥{item.price_jpy?.toLocaleString()} / 구입가: ¥{item.cost_jpy?.toLocaleString()}</span>
                    {(() => {
                      const hasStock = item.stock_quantity != null && item.stock_quantity > 0
                      const hasDelivery = item.delivery_time != null
                      if (hasStock) return (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#dcfce7', color: '#15803d' }}>
                          재고 {item.stock_quantity}개
                        </span>
                      )
                      if (hasDelivery) return (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#fef9c3', color: '#854d0e' }}>
                          발주 후 {item.delivery_time}주
                        </span>
                      )
                      return (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#fee2e2', color: '#b91c1c' }}>
                          담당자 납기 문의
                        </span>
                      )
                    })()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
      )}

      {/* 품번 직접 입력 — 수동입력 품목 · 국내조달품 공용 */}
      {(row.row_kind === 'manual_jpy' || isDomestic) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', width: 44, flexShrink: 0 }}>품번</label>
          <input className="q-input" value={row.partCode}
            onChange={e => updateRow(row.id, 'partCode', e.target.value)}
            placeholder="예: KT35000" style={{ ...inp, flex: 1, minWidth: 0 }} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', width: 44, flexShrink: 0 }}>품명</label>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <input ref={itemNameRef} className="q-input" value={row.itemText} onChange={e => updateRow(row.id, 'itemText', e.target.value)} placeholder="예: 스타일러스" style={{ ...inp, width: '100%', paddingRight: isDomestic ? 11 : 56 }} />
          {/* 국내조달품은 상세 줄이 필요 없어 숨긴다(서비스비는 유지). */}
          {!isDomestic && (
          <button onClick={() => addSubLine(row.id)}
            title="상세 내용 줄 추가"
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', padding: '2px 6px', background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', transition: 'color 0.15s ease' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#234ea2')}
            onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}>
            줄 추가
          </button>
          )}
        </div>
      </div>

      {row.subLines.length > 0 && (
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ width: 44, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          {row.subLines.map((line, li) => (
            <div key={li} style={{ position: 'relative', marginBottom: 4 }}>
              <input className="q-input" value={line} onChange={e => updateSubLine(row.id, li, e.target.value)} placeholder="예: - Leaf Spring 교체" style={{ ...inp, width: '100%', fontSize: 11, paddingRight: 28 }} />
              <button onClick={() => removeSubLine(row.id, li)}
                title="삭제"
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 20, height: 20, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s ease' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* 국내조달품 — 원화 원가 직접 입력(마진 없음) */}
      {isDomestic && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', width: 44, flexShrink: 0 }}>원가</label>
          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
            <input className="q-input" type="number" value={row.manual_unit_price || ''}
              onChange={e => updateRow(row.id, 'manual_unit_price', parseInt(e.target.value) || 0)}
              placeholder="원가 직접 입력"
              style={{ ...inp, width: '100%', textAlign: 'right', fontSize: 12, paddingRight: 28 }} />
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#9ca3af', pointerEvents: 'none' }}>원</span>
          </div>
        </div>
      )}

      {/* 수동입력 품목 — 구입가 JPY / 판매가 모드 */}
      {row.row_kind === 'manual_jpy' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', width: 44, flexShrink: 0 }}>구입가</label>
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <input className="q-input" type="number" value={row.manual_cost_jpy || ''}
                onChange={e => updateRow(row.id, 'manual_cost_jpy', parseInt(e.target.value) || 0)}
                placeholder="구입가 직접 입력"
                style={{ ...inp, width: '100%', textAlign: 'right', fontSize: 12, paddingRight: 28 }} />
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#9ca3af', pointerEvents: 'none' }}>¥</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', width: 44, flexShrink: 0 }}>판매가</label>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SegmentedControl
                options={[{ label: '이익률', value: 'rate' }, { label: '판매가', value: 'price' }]}
                value={row.price_mode}
                onChange={v => updateRow(row.id, 'price_mode', v)}
                equal
                height={34}
              />
            </div>
          </div>
        </>
      )}

      {/* 스테퍼 — 수량 · (이익률 또는 판매단가) · 관세율. 서비스비만 제외한다. */}
      {row.row_kind !== 'service' && (
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <div style={{ width: 44, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>수량</div>
            {!isDomestic && <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>{priceInputMode ? '판매단가' : '이익률'}</div>}
            {!isDomestic && <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>관세율</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
            <div title="수량" style={{ height: 34, border: '1px solid #ebebeb', borderRadius: 6, display: 'flex', alignItems: 'center', padding: '0 6px', gap: 4, minWidth: 0, boxSizing: 'border-box' }}>
              <button onClick={() => updateRow(row.id, 'quantity', Math.max(1, row.quantity - 1))} style={{ width: 18, height: 18, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>−</button>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'visible', color: '#111827' }}>{row.quantity}</span>
              <button onClick={() => updateRow(row.id, 'quantity', row.quantity + 1)} style={{ width: 18, height: 18, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>+</button>
            </div>
            {isDomestic ? null : priceInputMode ? (
            <div title="판매단가" style={{ height: 34, border: '1px solid #ebebeb', borderRadius: 6, display: 'flex', alignItems: 'center', padding: '0 6px', gap: 4, minWidth: 0, boxSizing: 'border-box' }}>
              <input
                type="number"
                value={row.manual_unit_price || ''}
                onChange={e => updateRow(row.id, 'manual_unit_price', parseInt(e.target.value) || 0)}
                placeholder="0"
                style={{ flex: 1, minWidth: 0, width: '100%', textAlign: 'center', fontWeight: 500, fontSize: 12, border: 'none', outline: 'none', background: 'transparent', color: '#111827', boxSizing: 'border-box' }}
              />
              <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>원</span>
            </div>
            ) : (
            <div title="이익률" style={{ height: 34, border: '1px solid #ebebeb', borderRadius: 6, display: 'flex', alignItems: 'center', padding: '0 6px', gap: 4, minWidth: 0, boxSizing: 'border-box' }}>
              <button onClick={() => updateRow(row.id, 'profit_rate', Math.max(0, row.profit_rate - 5))} style={{ width: 18, height: 18, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>−</button>
              {editingProfitRate[row.id] ? (
                <input
                  autoFocus
                  type="number"
                  value={profitRateInput[row.id] ?? ''}
                  onChange={e => setProfitRateInput(p => ({ ...p, [row.id]: e.target.value }))}
                  onBlur={() => {
                    const v = Math.min(95, Math.max(0, parseInt(profitRateInput[row.id] || '0') || 0))
                    updateRow(row.id, 'profit_rate', v)
                    setEditingProfitRate(p => ({ ...p, [row.id]: false }))
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
                  }}
                  style={{ flex: 1, minWidth: 0, width: '100%', textAlign: 'center', fontWeight: 500, fontSize: 12, border: '1px solid #234ea2', borderRadius: 6, padding: '1px 2px', outline: 'none', color: '#111827', boxSizing: 'border-box' }}
                />
              ) : (
                <span
                  onClick={() => { setEditingProfitRate(p => ({ ...p, [row.id]: true })); setProfitRateInput(p => ({ ...p, [row.id]: String(row.profit_rate) })) }}
                  title="클릭하여 직접 입력"
                  style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'visible', color: row.profit_rate >= 40 ? '#16a34a' : '#dc2626', cursor: 'text' }}
                >{row.profit_rate}%</span>
              )}
              <button onClick={() => updateRow(row.id, 'profit_rate', Math.min(95, row.profit_rate + 5))} style={{ width: 18, height: 18, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>+</button>
            </div>
            )}
            {!isDomestic && (
            <div title="관세율" style={{ height: 34, border: '1px solid #ebebeb', borderRadius: 6, display: 'flex', alignItems: 'center', padding: '0 6px', gap: 4, minWidth: 0, boxSizing: 'border-box' }}>
              <button onClick={() => updateRow(row.id, 'tariff_rate', parseFloat((row.tariff_rate - 0.01).toFixed(2)))} style={{ width: 18, height: 18, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>−</button>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'visible', color: '#111827' }}>×{row.tariff_rate.toFixed(2)}</span>
              <button onClick={() => updateRow(row.id, 'tariff_rate', parseFloat((row.tariff_rate + 0.01).toFixed(2)))} style={{ width: 18, height: 18, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>+</button>
            </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* 서비스비 — 금액 직접 입력 + 부대비용 내역(원가) */}
      {row.row_kind === 'service' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', width: 44, flexShrink: 0 }}>금액</label>
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <input className="q-input" type="number" value={row.manual_unit_price || ''}
                onChange={e => updateRow(row.id, 'manual_unit_price', parseInt(e.target.value) || 0)}
                placeholder="0" style={{ ...inp, width: '100%', textAlign: 'right', fontSize: 12, paddingRight: 28 }} />
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#9ca3af', pointerEvents: 'none' }}>원</span>
            </div>
          </div>

          <ExpenseSection
            row={row}
            expensePresets={expensePresets}
            presetError={presetError}
            errors={errors}
            invalidExpenseIds={invalidExpenseIds}
            totalExpense={totalExpense}
            addExpense={addExpense}
            removeExpense={removeExpense}
            updateExpense={updateExpense}
            selectExpensePreset={selectExpensePreset}
          />
        </>
      )}

      {summaryLines.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11, color: '#6b7280' }}>
          {summaryLines.map((line, i) => (
            <div key={i} style={{ marginTop: i === 0 ? 0 : 2 }}>{line}</div>
          ))}
        </div>
      )}
    </div>
  )
}
