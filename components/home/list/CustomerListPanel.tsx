'use client'

// 고객사 **목록 보기**의 좌 패널 — 탭 · 필터 칩 · 건수 · 정렬 · 회사 트리.
//
// 화면은 그리기만 한다. 묶기·거르기·세우기는 lib/customerList.ts 가 한다
// (좌 패널의 건수와 우측 표의 줄이 같은 셈법이어야 하기 때문이다).
//
// ── 이번 회차의 범위 ──────────────────────────────────────────────────────
//   「회사」 탭만 돈다. 「대리점」·「미연결」은 **자리와 건수만** 둔다 — 누르면
//   「다음 회차」라고 알린다. 건수는 진짜 값이라 지금도 규모를 알 수 있다.

import { useRef, type CSSProperties, useState } from 'react'
import ScrollHints from '@/components/common/ScrollHints'
import { INDUSTRIES } from '@/lib/leadOptions'
import type { AgencyOption } from '@/lib/customerAgency'
import {
  daysLabel, isStale, type CompanyGroup, 
} from '@/lib/customerList'
import { R } from '@/lib/radius'
import BulkBar from '@/components/home/list/BulkBar'
import BulkApplyModal from '@/components/home/list/BulkApplyModal'
import { currentValueCounts } from '@/lib/bulkActions'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#6b7280'
const MUTED = '#9ca3af'
const BLUE = '#234ea2'
const DANGER = '#ef4444'

const STATUS_DOT: Record<string, string> = { '활성': '#16a34a', '잠재': '#f59e0b', '이탈': '#ef4444' }

export type ListTab = 'company' | 'agency' | 'cleanup'

/** 「정리 필요」 탭의 묶음 — 넷 다 **손으로 고쳐야 하는 것**이다. */
export type CleanupBucket = 'industry' | 'dupName' | 'blankSites' | 'emptyCompany' | 'deleted'

export const CLEANUP_LABEL: Record<CleanupBucket, string> = {
  industry: '분류 없는 회사',
  dupName: '이름 중복 의심',
  blankSites: '사업장명 입력 필요',
  emptyCompany: '사업장 0곳 회사',
  // 2026-11-23 — 지우기가 **숨기기**가 되면서 되돌릴 자리가 필요해졌다.
  // 슈퍼관리자만 이 소탭에서 복구한다(목록은 라우트가 service role 로 읽어 준다).
  deleted: '삭제됨',
}

export type CleanupRow = { companyId: number; companyName: string; hint: string }

type Props = {
  tab: ListTab
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
  /** 지워진 줄을 되돌린다(슈퍼관리자에게만 넘어온다 — 없으면 버튼도 없다). */
  onRestore?: (customerId: number, name: string) => void
  /** 대리점 목록(7). 누르면 회사 탭이 그 대리점의 사업장만 거른다. */
  agencies: AgencyOption[]
  agencySiteCount: (agencyId: number) => number
  onPickAgency: (agencyId: number) => void
  /** 지금 고른 대리점 — 그 줄을 켜 둔다(우측에 그 대리점 화면이 서 있다). */
  selectedAgencyId: number | null
}

// 탭 — 글자는 **한 줄로** 선다. 좁은 패널에서 flex 가 눌러 「대 리 점」처럼 접히면
// 줄 높이가 무너지고 배지가 글자 위로 올라탄다(2026-11-19 실측).



const chipStyle = (on: boolean): CSSProperties => ({
  height: 28, padding: '0 10px', borderRadius: R.icon, cursor: 'pointer',
  border: `1px solid ${on ? BLUE : BORDER}`,
  background: on ? '#eff4ff' : '#ffffff',
  color: on ? BLUE : SUB,
  fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5,
  whiteSpace: 'nowrap',
})


export default function CustomerListPanel({
  tab,
  groups, siteCount, expanded, toggleExpand, selectedCompanyId, selectedSiteId,
  onSelectCompany, onSelectSite, loading,
  checkedCompanies, toggleCompanyCheck, clearCompanyChecks, onBulkIndustry,
  cleanup, cleanupBucket, setCleanupBucket, onDeleteCompany, onRestore,
  agencies, agencySiteCount, onPickAgency, selectedAgencyId,
}: Props) {
  /** 트리가 구르는 요소 — 위·아래 힌트가 이것을 본다. */
  const treeRef = useRef<HTMLElement | null>(null)
  /** 「분류 지정」 적용 모달이 떠 있는가. */
  const [industryOpen, setIndustryOpen] = useState(false)

  return (
    /* 탭 줄은 **상단 카드**로 올라갔다(components/home/list/ListTabs.tsx) —
       이 카드는 건수 한 줄과 트리만 들고 있다. */
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: R.card, boxShadow: '0 4px 16px rgba(0,0,0,0.10)', overflow: 'hidden' }}>

      {/* 건수 — 정렬은 패널 머리줄(PanelHeader)로 옮겼다. */}
      <div style={{ padding: '8px 14px 4px', fontSize: 12, color: SUB, flexShrink: 0 }}>
        조건 일치 <b style={{ color: TEXT }}>{siteCount}</b>곳 · 회사 <b style={{ color: TEXT }}>{groups.length}</b>
      </div>

      {/* 트리 — 위·아래 스크롤 힌트를 함께 둔다(스크롤바를 숨겨 두었다). */}
      <ScrollHints scrollRef={treeRef} top={34} bottom={10} />
      <nav ref={treeRef} aria-label="회사 목록" className="stable-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 12px', minHeight: 0 }}>
        {tab === 'agency' ? (
          /* ── 대리점 탭(7) — 누르면 회사 탭이 그 대리점의 사업장만 거른다 ── */
          agencies.length === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>등록된 대리점이 없습니다</div>
          ) : agencies.map(a => {
            /* 고른 줄은 켜 둔다 — 우측에 그 대리점 화면이 서 있다(회사 트리와 같은 규칙). */
            const on = a.customer_id === selectedAgencyId
            return (
            <div key={a.customer_id} role="button" tabIndex={0} aria-current={on ? 'true' : undefined}
              onClick={() => onPickAgency(a.customer_id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickAgency(a.customer_id) } }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 10px', borderRadius: R.icon, cursor: 'pointer', fontSize: 13, background: on ? '#eff4ff' : 'transparent' }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.background = '#fafafa' }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}>
              <b style={{ fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company_name}</b>
              <span style={{ fontSize: 11, color: MUTED }}>{a.address ? a.address.split(/\s+/).slice(0, 2).join(' ') : ''}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: SUB }}>{agencySiteCount(a.customer_id)}</span>
            </div>
          )})
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
                style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '0 8px', borderRadius: R.icon }}
                onMouseEnter={e => { e.currentTarget.style.background = '#fafafa' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                <button type="button" onClick={() => { if (cleanupBucket !== 'deleted') onSelectCompany(r.companyId) }}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'none', cursor: cleanupBucket === 'deleted' ? 'default' : 'pointer', padding: '7px 0', fontFamily: 'inherit' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.companyName}</div>
                  <div style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.hint}</div>
                </button>
                {cleanupBucket === 'emptyCompany' && (
                  <button type="button" onClick={() => onDeleteCompany(r.companyId, r.companyName)}
                    style={{ height: 24, padding: '0 8px', borderRadius: R.icon, border: `1px solid ${DANGER}`, background: '#fff', color: DANGER, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                    삭제
                  </button>
                )}
                {cleanupBucket === 'deleted' && onRestore && (
                  <button type="button" onClick={() => onRestore(r.companyId, r.companyName)}
                    style={{ height: 24, padding: '0 8px', borderRadius: R.icon, border: `1px solid ${BLUE}`, background: '#fff', color: BLUE, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                    복구
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
                  borderRadius: R.icon, cursor: 'pointer', background: sel ? '#eff4ff' : 'transparent',
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
                {/* 분류(생산품) 뱃지는 걷었다(2026-11-20) — 트리에서 읽어야 하는 것은
                    **회사 이름과 사업장 수**다. 분류는 회사 카드와 필터가 맡는다. */}
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
                      borderRadius: R.icon, cursor: 'pointer', fontSize: 13,
                      background: on ? BLUE : 'transparent', color: on ? '#fff' : '#374151',
                    }}
                    onMouseEnter={e => { if (!on) e.currentTarget.style.background = '#fafafa' }}
                    onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[s.customer.status ?? ''] ?? MUTED, flexShrink: 0 }} />
                    {/* 이름이 비면 빨간 「입력 필요」 — 「본사」로 채워 두면 적은 것과 구별되지 않는다. */}
                    {s.needsName ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: DANGER, background: '#fef2f2', borderRadius: R.icon, padding: '1px 6px', flexShrink: 0 }}>입력 필요</span>
                    ) : (
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.siteName}</span>
                    )}
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

      {/* 일괄 작업 바 — 회사를 체크했을 때. 우측 사업장 표의 바와 **같은 부품**이다. */}
      {tab === 'company' && (
        <BulkBar
          scope="company"
          count={checkedCompanies.size}
          onClear={clearCompanyChecks}
          onAction={key => { if (key === 'industry') setIndustryOpen(true) }}
        />
      )}
      {industryOpen && (
        <BulkApplyModal
          actionKey="industry"
          title="분류 지정"
          count={checkedCompanies.size}
          current={currentValueCounts(
            groups.filter(g => checkedCompanies.has(g.companyId)).map(g => g.industry),
            '분류 없음',
          )}
          options={INDUSTRIES.map(i => ({ value: i, label: i }))}
          mode="search"
          onClose={() => setIndustryOpen(false)}
          onApply={value => { setIndustryOpen(false); onBulkIndustry(value) }}
        />
      )}
    </div>
  )
}
