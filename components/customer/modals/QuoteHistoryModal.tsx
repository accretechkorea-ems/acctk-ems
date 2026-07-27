'use client'

import type { Customer, Quote } from '../types'
import { CARD_BG, INPUT_BORDER, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WHITE_BUTTON_BG, numKR, modalOverlayStyle } from '../constants'
import { SALES_STATUS_COLORS, getCategoryColor } from '@/lib/categoryColors'

type Props = {
  isOpen: boolean
  customer: Customer | null
  quotes: Quote[]
  onClose: () => void
}

export default function QuoteHistoryModal({ isOpen, customer, quotes, onClose }: Props) {
  if (!isOpen) return null

  const totalQuoteAmt = quotes.reduce((s, q) => s + (q.total_supply || 0), 0)
  const totalOrderAmt = quotes.filter(q => ['수주', '매출완료'].includes(q.status)).reduce((s, q) => s + (q.total_supply || 0), 0)
  const totalRevenueAmt = quotes.filter(q => q.status === '매출완료').reduce((s, q) => s + (q.total_supply || 0), 0)
  const revenueQuotes = quotes.filter(q => q.status === '매출완료')
  const totalProfitAmt = revenueQuotes.reduce((s, q) => s + (q.total_profit || 0), 0)
  const totalProfitRate = totalRevenueAmt > 0 ? (totalProfitAmt / totalRevenueAmt * 100) : null

  const summaryCards = [
    { label: '총 견적 발행액', value: `₩${numKR(totalQuoteAmt)}`, sub: `${quotes.length}건`, color: TEXT_PRIMARY },
    { label: '총 수주액', value: `₩${numKR(totalOrderAmt)}`, sub: `${quotes.filter(q => ['수주', '매출완료'].includes(q.status)).length}건`, color: '#3b82f6' },
    { label: '누적 매출액', value: `₩${numKR(totalRevenueAmt)}`, sub: `${revenueQuotes.length}건`, color: WHITE_BUTTON_BG },
    { label: '누적 순이익', value: totalProfitAmt > 0 ? `₩${numKR(totalProfitAmt)}` : '-', sub: '매출완료 기준', color: '#16a34a' },
    { label: '평균 이익률', value: totalProfitRate !== null && totalProfitAmt > 0 ? `${totalProfitRate.toFixed(1)}%` : '-', sub: '매출완료 기준', color: totalProfitRate !== null && totalProfitRate >= 40 ? '#16a34a' : '#f59e0b' },
  ]

  return (
    <div onClick={onClose} style={modalOverlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 1100, maxHeight: '90vh', background: CARD_BG, borderRadius: 18, padding: 24, boxShadow: '0 12px 40px rgba(0,0,0,0.35)', border: `1px solid ${INPUT_BORDER}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: TEXT_PRIMARY, marginBottom: 4 }}>📋 거래 이력</div>
            <div style={{ fontSize: 13, color: TEXT_SECONDARY }}>{customer?.company_name}</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
          {summaryCards.map(({ label, value, sub, color }) => (
            <div key={label} style={{ background: '#fff', borderRadius: 10, padding: '12px 14px', border: `1px solid ${INPUT_BORDER}`, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color }}>{value}</div>
              <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>

        <div style={{ overflowY: 'auto', overflowX: 'auto', flex: 1 }}>
          {quotes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: TEXT_MUTED, fontSize: 14 }}>견적 이력이 없습니다</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
              <thead style={{ position: 'sticky', top: 0, background: CARD_BG }}>
                <tr style={{ borderBottom: `2px solid ${INPUT_BORDER}` }}>
                  {['견적번호', '날짜', '담당자', '내용', '품목', '금액', '순이익', '이익률', '상태'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: TEXT_SECONDARY, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quotes.map(q => {
                  const itemNames = q.quote_items && q.quote_items.length > 0
                    ? q.quote_items.map(i => i.price_list?.model_jp || i.product_name).filter(Boolean).join(', ')
                    : '-'
                  return (
                    <tr key={q.quote_id} style={{ borderBottom: `1px solid ${INPUT_BORDER}` }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: WHITE_BUTTON_BG, whiteSpace: 'nowrap' }}>{q.quote_number}</td>
                      <td style={{ padding: '10px 12px', color: TEXT_SECONDARY, whiteSpace: 'nowrap' }}>{q.quote_date}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{q.engineers?.name ?? '-'}</td>
                      <td style={{ padding: '10px 12px', color: TEXT_SECONDARY, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.subject ?? '-'}</td>
                      <td style={{ padding: '10px 12px', color: TEXT_SECONDARY, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemNames}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>₩{numKR(q.total_supply)}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {q.status === '매출완료' && q.total_profit
                          ? <span style={{ fontWeight: 700, color: '#16a34a' }}>₩{numKR(q.total_profit)}</span>
                          : <span style={{ color: '#d1d5db' }}>-</span>}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {q.status === '매출완료' && q.profit_rate
                          ? <span style={{ fontWeight: 700, color: q.profit_rate >= 40 ? '#16a34a' : '#f59e0b' }}>{q.profit_rate.toFixed(1)}%</span>
                          : <span style={{ color: '#d1d5db' }}>-</span>}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: getCategoryColor(SALES_STATUS_COLORS, q.status).bg, color: getCategoryColor(SALES_STATUS_COLORS, q.status).text }}>
                          {q.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
