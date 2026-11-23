'use client'

/**
 * 좌 패널 **맨 위** — 보기 토글 · 검색 · 필터 줄. 지도 보기와 목록 보기가 함께 쓴다.
 *
 * 왜 여기로 내렸나(2026-11-20)
 *   화면 맨 위에 가로로 긴 상단 바가 있었다(토글·검색·엑셀·등록). 그 한 줄 때문에
 *   지도가 60px 아래에서 시작했고, 조건을 고르는 자리는 지도 위 오버레이 칩·좌 패널
 *   드롭다운·그 아래 토글 칩으로 세 군데로 갈려 있었다. 고르는 일은 전부 좌 패널
 *   한 자리로 모으고, 지도는 최상단부터 끝까지 쓴다.
 *
 * 필터 자체는 모달이 받는다(components/home/CustomerFilterModal.tsx) —
 * 여기서는 **몇 개 걸렸는지**와 **무엇이 걸렸는지**만 보여 준다.
 */

import { useState } from 'react'
import { R } from '@/lib/radius'
import { COMPANY_SEARCH_PLACEHOLDER } from '@/lib/companySearch'
import type { CustomerChip } from '@/lib/customerFilterChips'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#4b5563'
const MUTED = '#6b7280'
const BLUE = '#234ea2'

export type HomeView = 'map' | 'list'

type Props = {
  view: HomeView
  setView: (v: HomeView) => void
  query: string
  setQuery: (v: string) => void
  /** 지금 조건에 맞는 수 — 검색칸 오른쪽에 작게. */
  count: number
  loading?: boolean
  filterCount: number
  chips: CustomerChip[]
  onOpenFilter: () => void
  onDropChip: (c: CustomerChip) => void
  onClearChips: () => void
  /** 정렬 — 목록 보기에서만 준다(지도는 늘 최근 활동순이다). */
  sort?: 'touch' | 'name'
  setSort?: (v: 'touch' | 'name') => void
  /**
   * 아래 테두리를 그릴까. 목록 보기에서는 탭과 가르는 선이 필요하지만,
   * 지도 보기의 **떠 있는 카드** 안에서는 카드 테두리와 겹쳐 두 줄로 보인다.
   */
  bordered?: boolean
  /** 목록 보기의 탭 줄 — 상단 카드의 셋째 줄로 들어간다(지도 보기에는 없다). */
  tabs?: React.ReactNode
}

const MapGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 20l-6 2V6l6-2 6 2 6-2v16l-6 2-6-2z" /><path d="M9 4v16M15 6v16" />
  </svg>
)
const ListGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
)

export default function PanelHeader({
  view, setView, query, setQuery, count, loading, filterCount, chips,
  onOpenFilter, onDropChip, onClearChips, sort, setSort, bordered = true, tabs,
}: Props) {
  const [focused, setFocused] = useState(false)

  return (
    <div style={{ flexShrink: 0 }}>
      {/* ① 토글 + 검색 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 10px' }}>
        <div style={{ display: 'inline-flex', background: '#f3f4f6', borderRadius: R.control, padding: 3, gap: 2, flexShrink: 0 }}>
          {([['map', '지도', <MapGlyph key="m" />], ['list', '목록', <ListGlyph key="l" />]] as const).map(([v, label, glyph]) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-label={label} title={label}
              aria-pressed={view === v}
              style={{
                height: 28, width: 34, border: 'none', borderRadius: R.icon, cursor: 'pointer',
                background: view === v ? '#ffffff' : 'transparent',
                color: view === v ? TEXT : MUTED,
                boxShadow: view === v ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
              {glyph}
            </button>
          ))}
        </div>

        <label style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, height: 34,
          border: `1px solid ${focused ? BLUE : BORDER}`, borderRadius: R.control, padding: '0 10px',
          background: '#ffffff', transition: 'border-color 0.15s ease',
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={focused ? BLUE : MUTED} strokeWidth="2.2" style={{ flexShrink: 0 }} aria-hidden>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input value={query} onChange={e => setQuery(e.target.value)}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            placeholder={COMPANY_SEARCH_PLACEHOLDER}
            style={{ border: 'none', outline: 'none', flex: 1, minWidth: 0, fontSize: 13, color: TEXT, background: 'transparent', fontFamily: 'inherit' }} />
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label="검색어 지우기"
              style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: MUTED, display: 'inline-flex', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          ) : (
            <span className="num" style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>
              {loading ? '…' : count.toLocaleString('ko-KR')}
            </span>
          )}
        </label>
      </div>

      {/* ② 필터 줄 — [필터 N] + 걸린 조건 칩 + 정렬 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px 10px', borderBottom: bordered ? `1px solid ${BORDER}` : 'none', flexWrap: 'wrap' }}>
        {/* 필터 — 글자 없이 아이콘과 숫자만. 칩이 그 옆에 서므로 「필터」 글자는 군더더기다. */}
        <button type="button" onClick={onOpenFilter} title="필터" aria-label="필터"
          onMouseEnter={e => { e.currentTarget.style.borderColor = BLUE }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 8px',
            border: `1px solid ${BORDER}`, borderRadius: R.control, background: '#ffffff',
            color: '#374151', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            transition: 'border-color 0.15s ease', flexShrink: 0,
          }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 5h18l-7 8v6l-4-2v-4z" />
          </svg>
          {filterCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: BLUE, background: '#eff4ff', borderRadius: R.pill, padding: '1px 7px' }}>{filterCount}</span>
          )}
        </button>

        {chips.map(c => (
          <button key={c.key} type="button" onClick={() => onDropChip(c)} title={`${c.label} 해제`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 9px',
              borderRadius: R.pill, border: '1px solid #c7d7f8', background: '#eff4ff', color: BLUE,
              fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}>
            {c.label}
            <span aria-hidden style={{ color: MUTED }}>✕</span>
          </button>
        ))}
        {chips.length > 1 && (
          <button type="button" onClick={onClearChips}
            style={{ border: 'none', background: 'none', padding: 0, color: SUB, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            전체 해제
          </button>
        )}

        <span style={{ flex: 1 }} />
        {setSort && (
          <select value={sort} onChange={e => setSort(e.target.value as 'touch' | 'name')}
            aria-label="정렬"
            style={{ height: 26, border: 'none', background: 'transparent', color: SUB, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            <option value="touch">최근 활동순</option>
            <option value="name">이름순</option>
          </select>
        )}
      </div>

      {/* ③ 탭 줄 — 목록 보기에만. 지도 보기에서는 이 줄이 통째로 없다. */}
      {tabs}
    </div>
  )
}
