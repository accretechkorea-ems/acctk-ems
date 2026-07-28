'use client'

import { useState } from 'react'
import CustomerList from './CustomerList'
import { TEXT_MUTED, TEXT_PRIMARY, type Customer, type Device } from '@/lib/home'

const STATUS_CONFIG = {
  '활성': { color: '#16a34a', activeBg: '#16a34a' },
  '잠재': { color: '#f59e0b', activeBg: '#f59e0b' },
  '이탈': { color: '#ef4444', activeBg: '#ef4444' },
} as const

type Props = {
  query: string
  setQuery: (v: string) => void
  selectedStatuses: string[]
  toggleStatus: (status: string) => void
  onAddClick: () => void
  customers: Customer[]
  deviceMap: Map<number, Device[]>
  onMove: (customer: Customer) => void
  onDetailClick: () => void
  listScrollRef: React.RefObject<HTMLDivElement | null>
  onScrollSave: () => void
  isLoading?: boolean
}

export default function Sidebar({
  query,
  setQuery,
  selectedStatuses,
  toggleStatus,
  onAddClick,
  customers,
  deviceMap,
  onMove,
  onDetailClick,
  listScrollRef,
  onScrollSave,
  isLoading = false,
}: Props) {
  const [searchFocused, setSearchFocused] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', gap: 12 }}>

      {/* 검색창 */}
      <div style={{ position: 'relative' }}>
        <div style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'none', display: 'flex', alignItems: 'center',
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke={searchFocused ? '#234ea2' : '#9ca3af'}
            strokeWidth="2.2"
            style={{ transition: 'stroke 0.15s ease' }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder="회사명, 주소, 대리점 검색"
          style={{
            width: '100%',
            padding: '11px 36px 11px 34px',
            border: `1px solid ${searchFocused ? '#234ea2' : '#ebebeb'}`,
            borderRadius: 6,
            background: '#ffffff',
            color: TEXT_PRIMARY,
            fontSize: 13,
            boxSizing: 'border-box',
            outline: 'none',
            transition: 'border-color 0.15s ease',
          }}
        />
        {query ? (
          <button
            onClick={() => setQuery('')}
            style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              width: 20, height: 20, borderRadius: '50%', border: 'none',
              background: '#f3f4f6', color: '#6b7280',
              fontSize: 10, fontWeight: 800, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
        ) : (
          <span style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            fontSize: 12, color: '#9ca3af', fontWeight: 600, pointerEvents: 'none',
          }}>
            {isLoading ? '-' : `${customers.length}개`}
          </span>
        )}
      </div>

      {/* 고객 리스트 */}
      <CustomerList
        customers={customers}
        deviceMap={deviceMap}
        onMove={onMove}
        onDetailClick={onDetailClick}
        listScrollRef={listScrollRef}
        onScrollSave={onScrollSave}
        isLoading={isLoading}
      />
    </div>
  )
}
