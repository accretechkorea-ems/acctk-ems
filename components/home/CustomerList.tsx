'use client'

import { useEffect, useState } from 'react'
import { type Customer, type Device } from '@/lib/home'
import CustomerCard from './CustomerCard'

type Props = {
  customers: Customer[]
  deviceMap: Map<number, Device[]>
  onMove: (customer: Customer) => void
  onDetailClick: () => void
  listScrollRef: React.RefObject<HTMLDivElement | null>
  onScrollSave?: () => void
  isLoading?: boolean
}

function SkeletonCard() {
  return (
    <div style={{
      marginBottom: 8, borderRadius: 8,
      border: '1px solid #ebebeb', background: '#ffffff',
      padding: '14px 16px',
      animation: 'sk-pulse 1.6s ease-in-out infinite',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <div style={{ width: '50%', height: 16, borderRadius: 6, background: '#e5e7eb' }} />
        <div style={{ width: 34, height: 16, borderRadius: 99, background: '#e5e7eb' }} />
      </div>
      <div style={{ width: '76%', height: 12, borderRadius: 6, background: '#e5e7eb', marginBottom: 5 }} />
      <div style={{ width: '36%', height: 11, borderRadius: 6, background: '#e5e7eb', marginBottom: 9 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ width: 130, height: 11, borderRadius: 6, background: '#e5e7eb' }} />
        <div style={{ width: 104, height: 11, borderRadius: 6, background: '#e5e7eb' }} />
      </div>
    </div>
  )
}

export default function CustomerList({
  customers,
  deviceMap,
  onMove,
  onDetailClick,
  listScrollRef,
  onScrollSave,
  isLoading = false,
}: Props) {
  const [moreBelow, setMoreBelow] = useState(false)

  // 스크롤 위치에 따라 "아래로 더 있음" 힌트 표시 여부 갱신
  useEffect(() => {
    const el = listScrollRef.current
    const next = !!el && el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setMoreBelow(prev => (prev === next ? prev : next))
  }, [customers, isLoading, listScrollRef])

  return (
    <div style={{
      position: 'relative',
      borderRadius: 8,
      background: '#fafafa',
      border: '1px solid #ebebeb',
      flex: 1, minHeight: 0, boxSizing: 'border-box', overflow: 'hidden',
    }}>
      <style>{`
        @keyframes sk-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes hint-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(2px); }
        }
        .customer-list-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .customer-list-scroll::-webkit-scrollbar { display: none; }
      `}</style>
      <div
        ref={listScrollRef}
        onScroll={(e) => {
          onScrollSave?.()
          const el = e.currentTarget
          const next = el.scrollTop + el.clientHeight < el.scrollHeight - 1
          setMoreBelow(prev => (prev === next ? prev : next))
        }}
        className="customer-list-scroll"
        style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', padding: '8px', boxSizing: 'border-box' }}
      >
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
        ) : customers.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            height: '100%', minHeight: 220, gap: 10,
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#9ca3af' }}>검색 결과가 없습니다</div>
            <div style={{ fontSize: 12, color: '#c4c9d1' }}>다른 검색어나 필터를 시도해보세요</div>
          </div>
        ) : (
          customers.map((c) => {
            const devices = deviceMap.get(Number(c.customer_id)) || []
            return (
              <CustomerCard
                key={c.customer_id}
                customer={c}
                devices={devices}
                onMove={() => onMove(c)}
                onDetailClick={onDetailClick}
              />
            )
          })
        )}
      </div>

      {/* 스크롤 힌트 — 아래로 더 있을 때만 표시 */}
      <div
        aria-hidden
        style={{
          position: 'absolute', left: '50%', bottom: 12,
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          opacity: moreBelow ? 1 : 0,
          transition: 'opacity 0.2s ease',
          width: 24, height: 24, borderRadius: 9999,
          background: '#ffffff', border: '1px solid #ebebeb',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"
          style={{ animation: 'hint-bob 1.4s ease-in-out infinite' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
    </div>
  )
}
