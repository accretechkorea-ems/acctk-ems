'use client'

import { useState } from 'react'
import { getDeviceLines, type Customer, type Device } from '@/lib/home'
import { DIRECT_SALE_LABEL } from '@/lib/customerAgency'
import { R } from '@/lib/radius'

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
        // 카드 사이 간격은 **목록의 gap** 이 정한다 — 여기서 margin 을 주면 그림자가 겹친다.
        borderRadius: R.card,
        border: `1px solid ${hovered ? '#c7d7f8' : '#ebebeb'}`,
        background: '#ffffff',
        // 지도 위에 떠 있는 카드라 그림자로 띄운다(2026-11-20).
        // 호버에 **움직임을 주지 않는다** — 구르는 칸이 위를 잘라 맨 위 카드만 잘려 보였다.
        // 떠오르는 느낌은 그림자를 키워 낸다.
        boxShadow: hovered ? '0 8px 24px rgba(0,0,0,0.16)' : '0 4px 16px rgba(0,0,0,0.10)',
        cursor: 'pointer',
        boxSizing: 'border-box',
        padding: '14px 16px',
        minWidth: 0,
        transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
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
          fontSize: 11, fontWeight: 600, color: '#4b5563',
          flexShrink: 0, whiteSpace: 'nowrap',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
          {customer.status ?? '-'}
        </span>
      </div>

      {/* 주소 */}
      <div style={{
        fontSize: 12,
        color: customer.address ? '#4b5563' : '#ef4444',
        fontWeight: customer.address ? 400 : 600,
        lineHeight: 1.45, marginBottom: 4,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {customer.address ?? '주소 정보 없음 — 등록 필요'}
      </div>

      {/* 대리점 — 없으면 「직판」(lib/customerAgency.ts). 전에는 '-' 였는데, 빈칸과
          「대리점을 안 거친 건」이 구별되지 않아 '-' 가 두 뜻으로 읽혔다. */}
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
        대리점 {customer.agency_name ?? DIRECT_SALE_LABEL}
      </div>

      {/* 장비 태그 — 최대 4개, 5개 이상은 「외 N대 더」. **마지막 줄 오른쪽 끝**에
          「상세보기 ›」를 같은 높이로 붙여 한 줄을 아낀다(2026-11-20). */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, minWidth: 0 }}>
      <div style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3,
      }}>
        {hasNoDevice ? (
          <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>장비 없음</span>
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
              <span style={{ fontSize: 11, fontWeight: 500, color: '#6b7280' }}>
                외 {deviceLines.length - 4}대 더
              </span>
            )}
          </>
        )}
      </div>
        <a
          href={`/customer/${customer.customer_id}`}
          onClick={(e) => { e.stopPropagation(); onDetailClick() }}
          onMouseEnter={(e) => { const el = e.currentTarget; el.style.color = '#1c3e87'; el.style.transform = 'scale(1.06)' }}
          onMouseLeave={(e) => { const el = e.currentTarget; el.style.color = '#234ea2'; el.style.transform = 'scale(1)' }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 12, fontWeight: 600, color: '#234ea2',
            whiteSpace: 'nowrap', flexShrink: 0,
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
