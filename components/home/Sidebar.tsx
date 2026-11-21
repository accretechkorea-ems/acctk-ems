'use client'

// 지도 보기의 **왼쪽 열** — 검색칸(좁은 화면 전용) + 업체 카드 목록.
//
// ── 검색칸이 둘이 아닌 이유 ───────────────────────────────────────────────
//   검색은 화면 맨 위 한 줄(components/home/ListHeader.tsx)로 올라갔다 — 목록 보기에는
//   왼쪽이 트리라 검색칸을 둘 자리가 없고, 두 보기가 같은 검색어를 쓴다.
//   다만 **좁은 화면에서는 그 헤더를 감추므로**(모바일은 예전 「업체 목록 | 지도」 탭을
//   쓴다) 여기 칸이 남아 있어야 검색을 할 수 있다. 그래서 이 칸은 `.sidebar-search`
//   클래스로 **넓은 화면에서만 숨긴다**(app/page.tsx 의 미디어 쿼리). 상태(query)는
//   한 벌이라 어느 칸에 쳐도 같은 값이다.
//
// ── 「업체 | 부품」 토글은 걷었다 ─────────────────────────────────────────
//   부품 사용 이력 검색은 **견적 작성 화면**으로 옮긴다(다음 회차). 남은 조각은
//   lib/partSearch.ts 하나다 — 조회와 상태 코드가 거기 있다.
//   화면 쪽 조각(hooks/usePartSearch.ts · components/home/PartResults.tsx)은
//   2026-11-21 에 지웠다. 부르는 곳이 없어 죽은 코드였고, 되살릴 때는 git 에서
//   꺼내 쓰면 된다(커밋 「죽은 코드 지우기」).

import { useState } from 'react'
import CustomerList from './CustomerList'
import { TEXT_PRIMARY, type Customer, type Device } from '@/lib/home'
import { R } from '@/lib/radius'

type Props = {
  query: string
  setQuery: (v: string) => void
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
    /* 바탕은 **완전 투명**이다 — 카드 사이로 지도가 그대로 보여야 한다. */
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, gap: 12, background: 'transparent' }}>

      {/* 검색창 — 좁은 화면에서만 보인다(넓은 화면은 맨 위 헤더가 맡는다). */}
      <div className="sidebar-search" style={{ position: 'relative' }}>
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
            padding: '11px 56px 11px 34px',
            border: `1px solid ${searchFocused ? '#234ea2' : '#ebebeb'}`,
            borderRadius: R.icon,
            background: '#ffffff',
            color: TEXT_PRIMARY,
            fontSize: 13,
            boxSizing: 'border-box',
            outline: 'none',
            transition: 'border-color 0.15s ease',
          }}
        />
        <div style={{
          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {query ? (
            <button
              onClick={() => setQuery('')}
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
          ) : (
            <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600, pointerEvents: 'none', whiteSpace: 'nowrap', paddingRight: 6 }}>
              {isLoading ? '-' : `${customers.length}개`}
            </span>
          )}
        </div>
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
