'use client'

import { useState } from 'react'
import CustomerList from './CustomerList'
import PartResults from './PartResults'
import { usePartSearch } from '@/hooks/usePartSearch'
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
  // 부품 사용 이력 검색 — 견적 권한이 있는 팀에만 열어준다
  canSearchParts: boolean
  onOpenQuotePdf: (pdfUrl: string | null, quoteNumber: string) => void
  searchMode: '업체' | '부품'
  setSearchMode: (v: '업체' | '부품') => void
  partQuery: string
  setPartQuery: (v: string) => void
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
  canSearchParts,
  onOpenQuotePdf,
  searchMode,
  setSearchMode,
  partQuery,
  setPartQuery,
}: Props) {
  const [searchFocused, setSearchFocused] = useState(false)
  // 기본값 꺼짐 = 전체(견적만 낸 건 포함). 아직 발주 이상이 거의 없어 조이면 늘 0건이 된다.
  const [deliveredOnly, setDeliveredOnly] = useState(false)

  // 권한이 없으면 토글을 아예 숨기고 업체 모드로 고정한다.
  const mode = canSearchParts ? searchMode : '업체'
  const partMode = mode === '부품'
  // 부품 조회는 부품 모드에서만 나간다(업체 검색 중에는 요청이 아예 없다).
  const part = usePartSearch(partQuery, partMode, deliveredOnly)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', gap: 12 }}>

      {/* 검색창 — 모드 토글을 입력칸 안에 넣어 세로 공간을 더 쓰지 않는다 */}
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
          value={partMode ? partQuery : query}
          onChange={(e) => (partMode ? setPartQuery(e.target.value) : setQuery(e.target.value))}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder={partMode ? "품번, 품명 검색" : "회사명, 주소, 대리점 검색"}
          style={{
            width: '100%',
            // 오른쪽 여백은 [지우기/건수] + [토글] 이 차지하는 만큼 확보한다.
            padding: canSearchParts ? '11px 96px 11px 34px' : '11px 36px 11px 34px',
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
        {/* 입력칸 오른쪽 묶음 — 지우기(또는 건수) + 모드 토글. 절대 배치라 줄 높이를 늘리지 않는다. */}
        <div style={{
          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {(partMode ? partQuery : query) ? (
            <button
              onClick={() => (partMode ? setPartQuery('') : setQuery(''))}
              aria-label="검색어 지우기"
              style={{
                width: 20, height: 20, borderRadius: '50%', border: 'none',
                background: '#f3f4f6', color: '#6b7280',
                fontSize: 10, fontWeight: 800, cursor: 'pointer', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ✕
            </button>
          ) : partMode ? null : (
            <span style={{
              fontSize: 12, color: '#9ca3af', fontWeight: 600, pointerEvents: 'none',
              whiteSpace: 'nowrap', paddingRight: canSearchParts ? 0 : 6,
            }}>
              {isLoading ? '-' : `${customers.length}개`}
            </span>
          )}

          {/* 모드 토글 — 활성 쪽만 흰 배경으로 띄운다(다중 선택 pill 과 같은 톤) */}
          {canSearchParts && (
            <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 6, padding: 2, flexShrink: 0 }}>
              {(['업체', '부품'] as const).map(m => {
                const on = mode === m
                return (
                  <button
                    key={m}
                    onClick={() => setSearchMode(m)}
                    title={`${m} 검색`}
                    style={{
                      padding: '3px 7px', borderRadius: 4, border: 'none', cursor: 'pointer',
                      fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                      background: on ? '#ffffff' : 'transparent',
                      color: on ? '#111827' : '#9ca3af',
                      boxShadow: on ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                      transition: 'color 0.15s ease, background 0.15s ease',
                    }}
                  >
                    {m}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 부품 사용 이력 — 부품 모드에서 검색어를 2자 이상 쳤을 때만 나타난다 */}
      {partMode && (
        <PartResults
          rows={part.rows}
          loading={part.loading}
          error={part.error}
          searched={part.searched}
          deliveredOnly={deliveredOnly}
          onToggleDelivered={setDeliveredOnly}
          onOpenPdf={onOpenQuotePdf}
        />
      )}

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
