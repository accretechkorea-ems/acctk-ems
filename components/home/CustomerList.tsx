'use client'


import { type Customer, type Device } from '@/lib/home'
import CustomerCard from './CustomerCard'
import { R } from '@/lib/radius'
import ScrollHints from '@/components/common/ScrollHints'

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
      marginBottom: 8, borderRadius: R.control,
      border: '1px solid #ebebeb', background: '#ffffff',
      padding: '14px 16px',
      animation: 'sk-pulse 1.6s ease-in-out infinite',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <div style={{ width: '50%', height: 16, borderRadius: R.icon, background: '#e5e7eb' }} />
        <div style={{ width: 34, height: 16, borderRadius: R.pill, background: '#e5e7eb' }} />
      </div>
      <div style={{ width: '76%', height: 12, borderRadius: R.icon, background: '#e5e7eb', marginBottom: 5 }} />
      <div style={{ width: '36%', height: 11, borderRadius: R.icon, background: '#e5e7eb', marginBottom: 9 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ width: 130, height: 11, borderRadius: R.icon, background: '#e5e7eb' }} />
        <div style={{ width: 104, height: 11, borderRadius: R.icon, background: '#e5e7eb' }} />
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
  // 위·아래 스크롤 힌트는 공용 부품이 맡는다(components/common/ScrollHints.tsx).

  return (
    <div style={{
      position: 'relative',
      // 바탕·테두리를 두지 않는다 — 카드는 지도 위에 떠 있고 카드 사이로 지도가 보인다(2026-11-20).
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
        onScroll={() => onScrollSave?.()}
        className="customer-list-scroll"
        style={{
          height: '100%', overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box',
          // 카드 사이 간격 10 — 그림자가 서로 먹지 않는 최소 간격이다.
          // 위로 4px 띄운다 — 호버 그림자가 맨 위 카드에서 잘리지 않게.
          display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 4px 8px', margin: '-4px -4px 0',
        }}
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
            <div style={{ fontSize: 14, fontWeight: 600, color: '#6b7280' }}>검색 결과가 없습니다</div>
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

      {/* 위·아래 스크롤 힌트 — 공용 부품이 맡는다(components/common/ScrollHints.tsx). */}
      <ScrollHints scrollRef={listScrollRef} top={4} bottom={6} />
    </div>
  )
}
