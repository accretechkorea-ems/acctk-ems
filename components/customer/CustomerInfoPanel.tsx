'use client'

import { useState } from 'react'
import type { Customer, Quote } from './types'
import { numKR } from './constants'

const STATUS_CFG: Record<string, string> = {
  '활성': '#22c55e',
  '잠재': '#f59e0b',
  '이탈': '#ef4444',
}

type Props = {
  customer: Customer | null
  quotes: Quote[]
  totalRevenueAmt: number
  onEdit: () => void
  onQuoteHistoryOpen: () => void
}

export default function CustomerInfoPanel({ customer, quotes, totalRevenueAmt, onEdit, onQuoteHistoryOpen }: Props) {
  const [copied, setCopied] = useState(false)
  const sc = STATUS_CFG[customer?.status ?? ''] ?? '#9ca3af'

  const handleCopy = () => {
    if (!customer?.address) return
    navigator.clipboard.writeText(customer.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{
      background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8,
      padding: '16px 20px', marginBottom: 18, position: 'relative',
    }}>
      {/* 수정 버튼 */}
      <button
        onClick={onEdit}
        style={{
          position: 'absolute', top: 20, right: 20,
          display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px',
          background: '#fff', border: '1px solid #ebebeb', borderRadius: 6,
          cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#6b7280',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        수정
      </button>

      {/* 회사명 + 상태 배지 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827', lineHeight: 1.2 }}>
          {customer?.company_name ?? '업체 정보 없음'}
        </h1>
        {customer?.status && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, color: '#6b7280', flexShrink: 0,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc, flexShrink: 0 }} />
            {customer.status}
          </span>
        )}
      </div>

      {/* 정보 행 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#9ca3af', width: 44, flexShrink: 0 }}>주소</span>
          <span style={{
            fontSize: 13,
            color: customer?.address ? '#111827' : '#ef4444',
            fontWeight: customer?.address ? 400 : 600,
          }}>
            {customer?.address ?? '주소 정보 없음 — 수정 필요'}
          </span>
          {customer?.address && (
            <button onClick={handleCopy}
              title="주소 복사"
              onMouseEnter={e => { if (!copied) e.currentTarget.style.color = '#234ea2' }}
              onMouseLeave={e => { if (!copied) e.currentTarget.style.color = '#9ca3af' }}
              style={{
                display: 'inline-flex', alignItems: 'center', padding: 0,
                background: 'none', border: 'none', cursor: 'pointer',
                color: copied ? '#22c55e' : '#9ca3af',
                transition: 'color 0.15s ease', flexShrink: 0,
              }}>
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#9ca3af', width: 44, flexShrink: 0 }}>대리점</span>
          <span style={{ fontSize: 13, color: '#111827' }}>{customer?.agency ?? '-'}</span>
        </div>
      </div>

      {/* 거래 이력 버튼 */}
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #ebebeb' }}>
        <button
          onClick={onQuoteHistoryOpen}
          style={{
            padding: '6px 12px',
            background: '#fff',
            color: '#6b7280',
            border: '1px solid #ebebeb',
            borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          거래 이력
          {quotes.length > 0
            ? <span>{quotes.length}건 · 누적 ₩{numKR(totalRevenueAmt)}</span>
            : <span>(없음)</span>}
        </button>
      </div>
    </div>
  )
}
