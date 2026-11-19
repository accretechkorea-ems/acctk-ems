'use client'

// 고객사 **목록 보기**의 좌 패널 — 탭 · 필터 칩 · 건수 · 정렬 · 회사 트리.
//
// 화면은 그리기만 한다. 묶기·거르기·세우기는 lib/customerList.ts 가 한다
// (좌 패널의 건수와 우측 표의 줄이 같은 셈법이어야 하기 때문이다).
//
// ── 이번 회차의 범위 ──────────────────────────────────────────────────────
//   「회사」 탭만 돈다. 「대리점」·「미연결」은 **자리와 건수만** 둔다 — 누르면
//   「다음 회차」라고 알린다. 건수는 진짜 값이라 지금도 규모를 알 수 있다.

import { useMemo, useState, type CSSProperties } from 'react'
import Popover from '@/components/common/Popover'
import { useRef } from 'react'
import { CATEGORY_OPTIONS } from '@/lib/constants'
import {
  daysLabel, isStale, type CompanyGroup, type ListFilter, type SortKey,
} from '@/lib/customerList'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#6b7280'
const MUTED = '#9ca3af'
const FAINT = '#d1d5db'
const BLUE = '#234ea2'
const NEUTRAL = '#f3f4f6'
const DANGER = '#ef4444'

const STATUS_DOT: Record<string, string> = { '활성': '#16a34a', '잠재': '#f59e0b', '이탈': '#ef4444' }

export type ListTab = 'company' | 'agency' | 'unlinked'

type Props = {
  tab: ListTab
  setTab: (t: ListTab) => void
  counts: { company: number; agency: number; unlinked: number }
  filter: ListFilter
  setFilter: (next: ListFilter) => void
  /** 고를 수 있는 지역(데이터에 있는 것만). */
  regionOptions: string[]
  sort: SortKey
  setSort: (s: SortKey) => void
  groups: CompanyGroup[]
  siteCount: number
  /** 펼친 회사 id 집합. */
  expanded: Set<number>
  toggleExpand: (companyId: number) => void
  selectedCompanyId: number | null
  selectedSiteId: number | null
  onSelectCompany: (companyId: number) => void
  onSelectSite: (companyId: number, siteId: number) => void
  loading?: boolean
}

const tabStyle = (on: boolean): CSSProperties => ({
  height: 40, padding: '0 12px', border: 'none', background: 'transparent',
  fontSize: 13, fontWeight: 600, color: on ? TEXT : MUTED,
  borderBottom: `2px solid ${on ? BLUE : 'transparent'}`,
  display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
})

const countStyle = (tone?: 'danger'): CSSProperties => ({
  fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 99,
  background: tone === 'danger' ? '#fef2f2' : NEUTRAL,
  color: tone === 'danger' ? DANGER : SUB,
})

const chipStyle = (on: boolean): CSSProperties => ({
  height: 28, padding: '0 10px', borderRadius: 6, cursor: 'pointer',
  border: `1px solid ${on ? BLUE : BORDER}`,
  background: on ? '#eff4ff' : '#ffffff',
  color: on ? BLUE : SUB,
  fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5,
  whiteSpace: 'nowrap',
})

/** 여러 값을 고르는 칩 — 눌러서 목록을 펼친다(지역·분류·상태가 같은 모양이다). */
function MultiChip({ label, options, value, onChange, allLabel = '전체' }: {
  label: string
  options: readonly string[]
  value: string[]
  onChange: (next: string[]) => void
  allLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const all = value.length === options.length
  const text = all ? allLabel : value.length === 0 ? '없음' : value.length <= 2 ? value.join('·') : `${value.length}개`
  return (
    <div ref={ref} style={{ display: 'inline-flex' }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={chipStyle(!all)}>
        {label} <b style={{ fontWeight: 700, color: all ? TEXT : BLUE }}>{text}</b>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} maxHeight={280}
        style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', padding: 6, minWidth: 150 }}>
        <button type="button"
          onMouseDown={e => { e.preventDefault(); onChange(all ? [] : [...options]) }}
          style={{ width: '100%', textAlign: 'left', padding: '7px 9px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: BLUE, borderBottom: `1px solid ${BORDER}` }}>
          {all ? '모두 끄기' : '모두 켜기'}
        </button>
        {options.map(o => {
          const on = value.includes(o)
          return (
            <button key={o} type="button"
              onMouseDown={e => { e.preventDefault(); onChange(on ? value.filter(v => v !== o) : [...value, o]) }}
              style={{ width: '100%', textAlign: 'left', padding: '7px 9px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: on ? TEXT : MUTED, display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 13, height: 13, borderRadius: 3, border: `1px solid ${on ? BLUE : FAINT}`, background: on ? BLUE : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {on && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}
              </span>
              {o || '(없음)'}
            </button>
          )
        })}
      </Popover>
    </div>
  )
}

export default function CustomerListPanel({
  tab, setTab, counts, filter, setFilter, regionOptions, sort, setSort,
  groups, siteCount, expanded, toggleExpand, selectedCompanyId, selectedSiteId,
  onSelectCompany, onSelectSite, loading,
}: Props) {
  const sortRef = useRef<HTMLDivElement>(null)
  const [sortOpen, setSortOpen] = useState(false)
  const sortLabel = sort === 'touch' ? '최근 활동순' : '이름순'

  const statusOptions = useMemo(() => ['활성', '잠재', '이탈'], [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>

      {/* 탭 — 이번 회차는 회사 탭만 돈다 */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, padding: '0 8px', flexShrink: 0 }}>
        <button type="button" onClick={() => setTab('company')} style={tabStyle(tab === 'company')}>
          회사 <span style={countStyle()}>{counts.company}</span>
        </button>
        <button type="button" onClick={() => setTab('agency')} style={tabStyle(tab === 'agency')}>
          대리점 <span style={countStyle()}>{counts.agency}</span>
        </button>
        <button type="button" onClick={() => setTab('unlinked')} style={tabStyle(tab === 'unlinked')}>
          미연결 <span style={countStyle(counts.unlinked > 0 ? 'danger' : undefined)}>{counts.unlinked}</span>
        </button>
      </div>

      {/* 필터 칩 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 12px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <MultiChip label="지역" options={regionOptions} value={filter.regions.length ? filter.regions : regionOptions}
          onChange={next => setFilter({ ...filter, regions: next.length === regionOptions.length ? [] : next })} />
        <MultiChip label="분류" options={CATEGORY_OPTIONS} value={filter.categories}
          onChange={next => setFilter({ ...filter, categories: next })} />
        <MultiChip label="상태" options={statusOptions} value={filter.statuses}
          onChange={next => setFilter({ ...filter, statuses: next })} />
        <button type="button" style={chipStyle(filter.staleOnly)}
          onClick={() => setFilter({ ...filter, staleOnly: !filter.staleOnly })}>90일 활동 없음</button>
        <button type="button" style={chipStyle(filter.openQuotesOnly)}
          onClick={() => setFilter({ ...filter, openQuotesOnly: !filter.openQuotesOnly })}>진행 견적</button>
        {/* 분류가 비어 있는 회사만 — 정리 SQL 이 만든 회사 대부분이 그렇다. 채우러 가는 길이다. */}
        <button type="button" style={chipStyle(filter.noIndustryOnly)}
          onClick={() => setFilter({ ...filter, noIndustryOnly: !filter.noIndustryOnly })}>분류 없음</button>
      </div>

      {/* 건수 · 정렬 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px 4px', fontSize: 12, color: SUB, flexShrink: 0 }}>
        <span>조건 일치 <b style={{ color: TEXT }}>{siteCount}</b>곳 · 회사 <b style={{ color: TEXT }}>{groups.length}</b></span>
        <div ref={sortRef} style={{ display: 'inline-flex' }}>
          <button type="button" onClick={() => setSortOpen(o => !o)}
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: SUB, display: 'inline-flex', alignItems: 'center', gap: 3, padding: 0 }}>
            {sortLabel}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          <Popover anchorRef={sortRef} open={sortOpen} onClose={() => setSortOpen(false)} align="end"
            style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', padding: 4, minWidth: 120 }}>
            {([['touch', '최근 활동순'], ['name', '이름순']] as const).map(([k, label]) => (
              <button key={k} type="button"
                onMouseDown={e => { e.preventDefault(); setSort(k); setSortOpen(false) }}
                style={{ width: '100%', textAlign: 'left', padding: '7px 9px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: sort === k ? BLUE : TEXT, fontWeight: sort === k ? 700 : 500 }}>
                {label}
              </button>
            ))}
          </Popover>
        </div>
      </div>

      {/* 트리 */}
      <nav aria-label="회사 목록" style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 12px', minHeight: 0 }}>
        {tab !== 'company' ? (
          <div style={{ padding: '36px 16px', textAlign: 'center', color: MUTED, fontSize: 13, lineHeight: 1.8 }}>
            {tab === 'agency' ? '대리점 탭' : '미연결 탭'}은 다음 회차에 엽니다
            <br />
            <span style={{ fontSize: 12, color: FAINT }}>
              {tab === 'agency' ? `대리점 ${counts.agency}곳` : `회사가 없는 사업장 ${counts.unlinked}곳`}
            </span>
          </div>
        ) : loading && groups.length === 0 ? (
          <div style={{ padding: '36px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>불러오는 중…</div>
        ) : groups.length === 0 ? (
          <div style={{ padding: '36px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>조건에 맞는 회사가 없습니다</div>
        ) : groups.map(g => {
          const open = expanded.has(g.companyId)
          const sel = selectedCompanyId === g.companyId && selectedSiteId === null
          return (
            <div key={g.companyId}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => { toggleExpand(g.companyId); onSelectCompany(g.companyId) }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(g.companyId); onSelectCompany(g.companyId) } }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 10px 0 6px',
                  borderRadius: 6, cursor: 'pointer', background: sel ? '#eff4ff' : 'transparent',
                }}
                onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#fafafa' }}
                onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ flexShrink: 0, transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s ease' }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <b style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.companyName}</b>
                <span style={{
                  fontSize: 11, padding: '1px 6px', borderRadius: 6, whiteSpace: 'nowrap', flexShrink: 0,
                  background: g.industry ? NEUTRAL : '#fffbeb', color: g.industry ? SUB : '#b45309',
                }}>{g.industry ?? '분류 없음'}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: SUB, flexShrink: 0 }}>{g.sites.length}</span>
              </div>
              {open && g.sites.map(s => {
                const on = selectedSiteId === s.customer.customer_id
                const late = isStale(s.days)
                return (
                  <div key={s.customer.customer_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectSite(g.companyId, s.customer.customer_id)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectSite(g.companyId, s.customer.customer_id) } }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px 0 30px',
                      borderRadius: 6, cursor: 'pointer', fontSize: 13,
                      background: on ? BLUE : 'transparent', color: on ? '#fff' : '#374151',
                    }}
                    onMouseEnter={e => { if (!on) e.currentTarget.style.background = '#fafafa' }}
                    onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[s.customer.status ?? ''] ?? MUTED, flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.siteName}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, flexShrink: 0, color: on ? '#dbe4f7' : late ? DANGER : MUTED }}>
                      {daysLabel(s.days)}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </nav>
    </div>
  )
}
