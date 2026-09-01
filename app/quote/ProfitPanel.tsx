'use client'

import { useState } from 'react'
import type { QuoteRow } from './types'
import { calcTotals } from './calc'
import { numKR } from './format'

export type ProfitPanelProps = { rows: QuoteRow[]; exchangeRate: number; rateUpdatedAt: string; rateLoading: boolean; onFetchRate: () => void; onRateChange: (rate: number) => void }

export default function ProfitPanel({ rows, exchangeRate, rateUpdatedAt, rateLoading, onFetchRate, onRateChange }: ProfitPanelProps) {
  const [editingRate, setEditingRate] = useState(false)
  const [editRateVal, setEditRateVal] = useState('')

  const startEdit = () => {
    setEditRateVal(exchangeRate ? exchangeRate.toFixed(4) : '')
    setEditingRate(true)
  }
  const commitEdit = () => {
    const n = parseFloat(editRateVal)
    if (!isNaN(n) && n > 0) onRateChange(n)
    setEditingRate(false)
  }
  // 통합 전 이 자리의 계산식은 calcTotals 와 문자 단위로 동일했다(변수명만 다름).
  const { totalSupply, totalCost: totalProduct, totalProfit, totalProfitRate: profitPct, domesticCost } = calcTotals(rows)
  // 할인 금액(음수). calcTotals 는 건드리지 않고 여기서만 모아 표시용으로 쓴다.
  const discountAmt = rows.filter(r => r.row_kind === 'discount').reduce((s, r) => s + r.supply_price, 0)
  const isGood = profitPct >= 40

  // 행 종류별 원가 상세. 새 종류(manual_jpy·domestic)는 case 만 추가하면 된다.
  // null 을 반환하면 원가 줄 없이 판매단가부터 표시된다(구분선도 생략).
  const costDetail = (r: QuoteRow) => {
    switch (r.row_kind) {
      case 'price_list':
      case 'manual_jpy':   // 구입가 출처만 다르고 원가 산출은 동일하다
        return (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>구입가</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>¥{r.cost_price_jpy.toLocaleString()}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>관세 × 환율</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>×{r.tariff_rate} × {r.exchange_rate.toFixed(2)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>원가</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>₩{numKR(r.product_price)}</span></div>
          </>
        )
      case 'service':
        return (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>부대비용</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>{r.expenses.length}건</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>원가</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>₩{numKR(r.product_price)}</span></div>
          </>
        )
      case 'domestic':
        return (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>원가</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>₩{numKR(r.product_price)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>이익</span><span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>이익 없음</span></div>
          </>
        )
    }
  }
  return (
    <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #ebebeb', marginBottom: 14, overflow: 'hidden' }}>
      <div style={{ background: '#fff', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #ebebeb' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 3, height: 14, background: '#234ea2', borderRadius: 6, flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: '#111827' }}>수익 분석</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {editingRate ? (
              <input
                type="number"
                value={editRateVal}
                onChange={e => setEditRateVal(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingRate(false) }}
                autoFocus
                style={{ width: 80, fontSize: 11, fontWeight: 700, color: '#234ea2', border: '1px solid #234ea2', borderRadius: 6, padding: '1px 5px', outline: 'none' }}
              />
            ) : (
              <span
                onDoubleClick={startEdit}
                title="더블클릭하여 수동 입력"
                style={{ fontSize: 11, color: '#6b7280', fontWeight: 500, cursor: 'text', borderBottom: '1px dashed #9ca3af' }}>
                {exchangeRate ? `${exchangeRate.toFixed(4)}원` : '환율 로딩중...'}
              </span>
            )}
            {rateUpdatedAt && !editingRate && <span style={{ fontSize: 10, color: '#9ca3af' }}>({rateUpdatedAt})</span>}
            <button
              onClick={onFetchRate}
              disabled={rateLoading}
              style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', border: '1px solid #ebebeb', cursor: rateLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s ease' }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={rateLoading ? '#9ca3af' : '#111827'} strokeWidth="2.5">
                <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
          </div>
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: isGood ? '#16a34a' : '#dc2626' }}>
          이익률 {profitPct.toFixed(1)}%
        </span>
      </div>
      <div style={{ padding: '12px 16px' }}>
        {rows.map((r, i) => {
          if (r.supply_price <= 0) return null
          const detail = costDetail(r)
          return (
          <div key={r.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#234ea2', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
              <span style={{ fontSize: 11, color: '#111827', fontWeight: 600 }}>{r.itemText && r.itemText}{r.selectedItem && ` (${r.selectedItem.model_jp})`}</span>
            </div>
            {detail}
            <div style={{ borderTop: detail ? '1px solid #ebebeb' : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>판매단가</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>₩{numKR(r.unit_price)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>공급가</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>₩{numKR(r.supply_price)}</span></div>
              {/* 국내조달품은 마진이 없는 자사 부담 항목이라 이익 색상 규칙에서 제외한다(중립색). */}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>매출이익 <span style={{ color: r.row_kind === 'domestic' ? '#6b7280' : (r.profit >= 0 ? '#16a34a' : '#dc2626') }}>({r.profit_rate}%)</span></span><span style={{ fontSize: 13, color: r.row_kind === 'domestic' ? '#6b7280' : (r.profit >= 0 ? '#16a34a' : '#dc2626'), fontWeight: 500 }}>₩{numKR(r.profit)}</span></div>
            </div>
          </div>
          )
        })}
        <div style={{ marginTop: 4, paddingTop: 6, borderTop: '2px solid #111827' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>공급가 합계</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 600 }}>₩{numKR(totalSupply)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>원가 합계</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 600 }}>₩{numKR(totalProduct)}</span></div>
          {/* 할인 — 총액에서 빠진 금액. 행 목록에는 공급가가 음수라 나오지 않으므로 여기서 알린다. */}
          {discountAmt < 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>할인</span><span style={{ fontSize: 13, color: '#dc2626', fontWeight: 500 }}>−₩{numKR(Math.abs(discountAmt))}</span></div>
          )}
          {/* 국내조달품이 원가에 얼마나 얹혔는지 — 마진 조절 판단용. 해당 행이 없으면 표시하지 않는다. */}
          {domesticCost > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>국내 조달품</span><span style={{ fontSize: 13, color: '#6b7280', fontWeight: 600 }}>₩{numKR(domesticCost)}</span></div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>매출이익 합계</span><span style={{ fontSize: 13, color: isGood ? '#16a34a' : '#dc2626', fontWeight: 600 }}>₩{numKR(totalProfit)} ({profitPct.toFixed(1)}%)</span></div>
        </div>
      </div>
    </div>
  )
}
