'use client'

import { useState } from 'react'
import { getDeviceLines, type Customer, type Device } from '@/lib/home'

const STATUS_COLOR: Record<string, string> = {
  '활성': '#22c55e',
  '잠재': '#f59e0b',
  '이탈': '#f43f5e',
}

type Props = {
  customer: Customer
  devices: Device[]
  onMove: () => void
  onDetailClick: () => void
}

export default function CustomerCard({ customer, devices, onMove, onDetailClick }: Props) {
  const [hovered, setHovered] = useState(false)
  const deviceLines = getDeviceLines(devices)
  const statusColor = STATUS_COLOR[customer.status ?? ''] ?? '#9ca3af'
  const hasNoDevice = deviceLines.length === 1 && deviceLines[0] === '-'

  return (
    <div
      onClick={onMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        marginBottom: 8,
        borderRadius: 8,
        border: `1px solid ${hovered ? '#c7d7f8' : '#ebebeb'}`,
        background: '#ffffff',
        cursor: 'pointer',
        boxSizing: 'border-box',
        padding: '14px 16px',
        minWidth: 0,
        transform: hovered ? 'translateY(-2px)' : '',
        transition: 'transform 0.15s ease, border-color 0.15s ease',
      }}
    >
      {/* 헤더: 회사명 + 상태 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
        <div style={{
          fontWeight: 800, color: '#111827', fontSize: 17, letterSpacing: '-0.3px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}>
          {customer.company_name}
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11, fontWeight: 600, color: '#6b7280',
          flexShrink: 0, whiteSpace: 'nowrap',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
          {customer.status ?? '-'}
        </span>
      </div>

      {/* 주소 */}
      <div style={{
        fontSize: 12,
        color: customer.address ? '#6b7280' : '#ef4444',
        fontWeight: customer.address ? 400 : 600,
        lineHeight: 1.45, marginBottom: 4,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {customer.address ?? '주소 정보 없음 — 등록 필요'}
      </div>

      {/* 대리점 */}
      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
        대리점 {customer.agency ?? '-'}
      </div>

      {/* 장비 태그 — 최대 4개 표시, 5개 이상은 힌트로 대체 */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 2,
      }}>
        {hasNoDevice ? (
          <span style={{ fontSize: 11, color: '#d1d5db', fontStyle: 'italic' }}>장비 없음</span>
        ) : (
          <>
            {deviceLines.slice(0, 4).map((line, i) => (
              <span key={i} style={{
                fontSize: 11, color: '#234ea2', fontWeight: 600,
                whiteSpace: 'nowrap', maxWidth: '100%',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {line}
              </span>
            ))}
            {deviceLines.length > 4 && (
              <span style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af' }}>
                외 {deviceLines.length - 4}대 더
              </span>
            )}
          </>
        )}
      </div>

      {/* 상세보기 버튼 — 유일한 브랜드색 액센트 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <a
          href={`/customer/${customer.customer_id}`}
          onClick={(e) => { e.stopPropagation(); onDetailClick() }}
          onMouseEnter={(e) => { const el = e.currentTarget; el.style.color = '#234ea2'; el.style.transform = 'scale(1.06)' }}
          onMouseLeave={(e) => { const el = e.currentTarget; el.style.color = '#111827'; el.style.transform = 'scale(1)' }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 12, fontWeight: 600, color: '#111827',
            whiteSpace: 'nowrap',
            padding: '2px 4px',
            transformOrigin: 'right center',
            transition: 'color 0.15s ease, transform 0.15s ease',
            textDecoration: 'none',
          }}
        >
          상세보기
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </a>
      </div>
    </div>
  )
}
