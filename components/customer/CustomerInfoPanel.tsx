'use client'

import { useState } from 'react'
import type { Customer } from './types'

const STATUS_CFG: Record<string, string> = {
  '활성': '#22c55e',
  '잠재': '#f59e0b',
  '이탈': '#ef4444',
}

type Props = {
  customer: Customer | null

  onEdit: () => void
}

export default function CustomerInfoPanel({ customer, onEdit }: Props) {
  const [copied, setCopied] = useState(false)
  const sc = STATUS_CFG[customer?.status ?? ''] ?? '#9ca3af'
  // 대리점 경유 견적이 섞여 있을 때만 내역을 덧붙인다 (직판만 있으면 군더더기라 감춘다)

  const handleCopy = () => {
    if (!customer?.address) return
    navigator.clipboard.writeText(customer.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{
      background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8,
      padding: '14px 16px', marginBottom: 16, position: 'relative',
    }}>
      {/* 수정 — 아이콘만. 라벨 없이도 뜻이 통하고 좁은 열에서 회사명 자리를 덜 뺏는다 */}
      <button
        onClick={onEdit}
        title="업체 정보 수정"
        aria-label="업체 정보 수정"
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#234ea2'; e.currentTarget.style.color = '#234ea2' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#ebebeb'; e.currentTarget.style.color = '#6b7280' }}
        style={{
          position: 'absolute', top: 14, right: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6,
          background: '#fff', border: '1px solid #ebebeb', borderRadius: 6,
          cursor: 'pointer', color: '#6b7280',
          transition: 'border-color 0.15s ease, color 0.15s ease',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>

      {/* 회사명 + 상태 배지 — 좁은 열에서 수정 버튼과 겹치지 않도록 오른쪽을 비워둔다 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap', paddingRight: 34 }}>
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111827', lineHeight: 1.3, letterSpacing: '-0.3px', wordBreak: 'break-all' }}>
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
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#9ca3af', width: 44, flexShrink: 0, lineHeight: '20px' }}>주소</span>
          <span style={{
            fontSize: 13, flex: 1, minWidth: 0, lineHeight: '20px', wordBreak: 'break-all',
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
                transition: 'color 0.15s ease', flexShrink: 0, marginTop: 3,
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

      {/* 거래 이력은 여기 두지 않는다 — 요약 패널의 [견적] 줄이 그 진입점이다. */}
    </div>
  )
}
