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
import { INDUSTRIES } from '@/lib/leadOptions'
import type { AgencyOption } from '@/lib/customerAgency'
import { REGION_FILTER_OPTIONS } from '@/lib/region'
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

export type ListTab = 'company' | 'agency' | 'cleanup'

/** 「정리 필요」 탭의 묶음 — 넷 다 **손으로 고쳐야 하는 것**이다. */
export type CleanupBucket = 'industry' | 'dupName' | 'blankSites' | 'emptyCompany'

export const CLEANUP_LABEL: Record<CleanupBucket, string> = {
  industry: '분류 없는 회사',
  dupName: '이름 중복 의심',
  blankSites: '사업장명이 비어 겹치는 회사',
  emptyCompany: '사업장 0곳 회사',
}

export type CleanupRow = { companyId: number; companyName: string; hint: string }

type Props = {
  tab: ListTab
  setTab: (t: ListTab) => void
  counts: { company: number; agency: number; unlinked: number }
  filter: ListFilter
  setFilter: (next: ListFilter) => void
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
  /** 「+ 업체」 — 기존 등록 폼(회사명 검색 → 없으면 새 회사로). */
  onAddSite: () => void
  /** 「+ 대리점」 — 같은 폼의 대리점 모드(이름·주소·상태만). */
  onAddAgency: () => void
  /** 체크한 회사들 — 분류 일괄 지정이 쓴다(3a). */
  checkedCompanies: Set<number>
  toggleCompanyCheck: (companyId: number) => void
  clearCompanyChecks: () => void
  onBulkIndustry: (industry: string) => void
  /** 정리 필요 탭의 묶음별 줄. */
  cleanup: Record<CleanupBucket, CleanupRow[]>
  cleanupBucket: CleanupBucket
  setCleanupBucket: (b: CleanupBucket) => void
  /** 사업장 0곳 회사를 지운다(그 묶음에서만 나온다). */
  onDeleteCompany: (companyId: number, companyName: string) => void
  /** 대리점 목록(7). 누르면 회사 탭이 그 대리점의 사업장만 거른다. */
  agencies: AgencyOption[]
  agencySiteCount: (agencyId: number) => number
  onPickAgency: (agencyId: number) => void
  /** 지금 걸린 대리점 — 회사 탭 위에 「대리점: ○○」 줄로 알린다. */
  agencyFilterId: number | null
  clearAgencyFilter: () => void
}

// 탭 — 글자는 **한 줄로** 선다. 좁은 패널에서 flex 가 눌러 「대 리 점」처럼 접히면
// 줄 높이가 무너지고 배지가 글자 위로 올라탄다(2026-11-19 실측).
const tabStyle = (on: boolean): CSSProperties => ({
  height: 40, padding: '0 8px', border: 'none', background: 'transparent',
  fontSize: 13, fontWeight: 600, color: on ? TEXT : MUTED,
  borderBottom: `2px solid ${on ? BLUE : 'transparent'}`,
  display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
  whiteSpace: 'nowrap', flexShrink: 0,
})

const countStyle = (tone?: 'danger'): CSSProperties => ({
  fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 99,
  background: tone === 'danger' ? '#fef2f2' : NEUTRAL,
  color: tone === 'danger' ? DANGER : SUB,
})

/** 탭 줄 오른쪽의 작은 등록 버튼. 탭 글자와 같은 줄에 서야 해서 높이를 26 으로 조인다. */
const addBtn = (ghost: boolean): CSSProperties => ({
  height: 26, padding: '0 9px', borderRadius: 6, cursor: 'pointer',
  border: `1px solid ${ghost ? BORDER : BLUE}`,
  background: ghost ? '#ffffff' : BLUE,
  color: ghost ? SUB : '#ffffff',
  fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', alignSelf: 'center', marginLeft: 4,
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
  tab, setTab, counts, filter, setFilter, sort, setSort,
  groups, siteCount, expanded, toggleExpand, selectedCompanyId, selectedSiteId,
  onSelectCompany, onSelectSite, loading, onAddSite, onAddAgency,
  checkedCompanies, toggleCompanyCheck, clearCompanyChecks, onBulkIndustry,
  cleanup, cleanupBucket, setCleanupBucket, onDeleteCompany,
  agencies, agencySiteCount, onPickAgency, agencyFilterId, clearAgencyFilter,
}: Props) {
  const sortRef = useRef<HTMLDivElement>(null)
  const [sortOpen, setSortOpen] = useState(false)
  const sortLabel = sort === 'touch' ? '최근 활동순' : '이름순'

  const statusOptions = useMemo(() => ['활성', '잠재', '이탈'], [])
  /** 정리 필요 배지 — 네 묶음에 든 회사 수(겹치면 한 번만). */
  const cleanupCount = useMemo(
    () => new Set(Object.values(cleanup).flat().map(r => r.companyId)).size,
    [cleanup],
  )

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
        {/* 「미연결」은 지난 회차의 제약 덕에 0 이 됐다 — 이제 **정리 필요**가 그 자리를 쓴다.
            배지는 네 묶음에 든 **회사 수**다(겹치는 회사는 한 번만 센다). */}
        <button type="button" onClick={() => setTab('cleanup')} style={tabStyle(tab === 'cleanup')}>
          정리 필요 <span style={countStyle(cleanupCount > 0 ? 'danger' : undefined)}>{cleanupCount}</span>
        </button>
        <span style={{ flex: 1, minWidth: 8 }} />
        {/* 등록 — 탭 줄 오른쪽. **보고 있는 탭의 것** 하나만 세운다.
            둘을 함께 두면 탭 셋과 합쳐 383px 이 필요한데 패널은 342px 이라 글자가 접혔다.
            대리점을 더하는 일은 대리점 탭에서 하는 것이 자리에도 맞다. */}
        {tab === 'agency'
          ? <button type="button" onClick={onAddAgency} style={addBtn(false)} title="대리점을 등록합니다">+ 대리점</button>
          : <button type="button" onClick={onAddSite} style={addBtn(false)} title="업체(사업장)를 등록합니다">+ 업체</button>}
      </div>

      {/* 필터 칩 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 12px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        {/* 지역 — 데이터에 무엇이 들어 있든 **정본 17개 + 없음** 고정이다(lib/region.ts).
            전에는 데이터에서 긁어 와 「경기도」·「갈산리」까지 칩이 됐다. */}
        <MultiChip label="지역" options={REGION_FILTER_OPTIONS} value={filter.regions.length ? filter.regions : [...REGION_FILTER_OPTIONS]}
          onChange={next => setFilter({ ...filter, regions: next.length === REGION_FILTER_OPTIONS.length ? [] : next })} />
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

      {/* 대리점으로 걸러 보고 있을 때 — 어디서 온 목록인지 알린다(7). */}
      {tab === 'company' && agencyFilterId != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: '#eff4ff', fontSize: 12, color: BLUE }}>
          <b style={{ fontWeight: 700 }}>대리점: {agencies.find(a => a.customer_id === agencyFilterId)?.company_name ?? agencyFilterId}</b>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={clearAgencyFilter}
            style={{ border: 'none', background: 'none', color: SUB, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>해제</button>
        </div>
      )}

      {/* 트리 */}
      <nav aria-label="회사 목록" style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 12px', minHeight: 0 }}>
        {tab === 'agency' ? (
          /* ── 대리점 탭(7) — 누르면 회사 탭이 그 대리점의 사업장만 거른다 ── */
          agencies.length === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>등록된 대리점이 없습니다</div>
          ) : agencies.map(a => (
            <div key={a.customer_id} role="button" tabIndex={0}
              onClick={() => onPickAgency(a.customer_id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickAgency(a.customer_id) } }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              onMouseEnter={e => { e.currentTarget.style.background = '#fafafa' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              <b style={{ fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company_name}</b>
              <span style={{ fontSize: 11, color: MUTED }}>{a.address ? a.address.split(/\s+/).slice(0, 2).join(' ') : ''}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: SUB }}>{agencySiteCount(a.customer_id)}</span>
            </div>
          ))
        ) : tab === 'cleanup' ? (
          /* ── 정리 필요 탭(4) — 묶음 넷 ── */
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '2px 4px 10px' }}>
              {(Object.keys(CLEANUP_LABEL) as CleanupBucket[]).map(b => (
                <button key={b} type="button" onClick={() => setCleanupBucket(b)} style={chipStyle(cleanupBucket === b)}>
                  {CLEANUP_LABEL[b]} <b style={{ fontWeight: 700 }}>{cleanup[b].length}</b>
                </button>
              ))}
            </div>
            {cleanup[cleanupBucket].length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>정리할 것이 없습니다</div>
            ) : cleanup[cleanupBucket].map(r => (
              <div key={r.companyId}
                style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '0 8px', borderRadius: 6 }}
                onMouseEnter={e => { e.currentTarget.style.background = '#fafafa' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                <button type="button" onClick={() => onSelectCompany(r.companyId)}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', padding: '7px 0', fontFamily: 'inherit' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.companyName}</div>
                  <div style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.hint}</div>
                </button>
                {cleanupBucket === 'emptyCompany' && (
                  <button type="button" onClick={() => onDeleteCompany(r.companyId, r.companyName)}
                    style={{ height: 24, padding: '0 8px', borderRadius: 6, border: `1px solid ${DANGER}`, background: '#fff', color: DANGER, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                    삭제
                  </button>
                )}
              </div>
            ))}
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
                {/* 체크 — 분류를 여러 회사에 한 번에 지정할 때 쓴다(3a). */}
                <input type="checkbox" checked={checkedCompanies.has(g.companyId)}
                  onClick={e => e.stopPropagation()}
                  onChange={() => toggleCompanyCheck(g.companyId)}
                  aria-label={`${g.companyName} 선택`}
                  style={{ flexShrink: 0, cursor: 'pointer' }} />
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

      {/* 분류 일괄 지정(3a) — 회사를 체크했을 때만 뜬다. */}
      {tab === 'company' && checkedCompanies.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 12px', background: '#111827', color: '#fff', fontSize: 12, flexShrink: 0 }}>
          <b style={{ fontWeight: 700 }}>{checkedCompanies.size}곳</b>
          <select defaultValue=""
            onChange={e => { if (e.target.value) { onBulkIndustry(e.target.value); e.target.value = '' } }}
            style={{ height: 26, borderRadius: 6, border: 'none', fontSize: 12, padding: '0 6px', maxWidth: 170 }}>
            <option value="">분류 일괄 지정</option>
            {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={clearCompanyChecks}
            style={{ border: 'none', background: 'none', color: MUTED, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>선택 해제</button>
        </div>
      )}
    </div>
  )
}
