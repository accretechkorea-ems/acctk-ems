'use client'

// 고객사 **목록 보기**의 좌 패널 — 탭 · 필터 칩 · 건수 · 정렬 · 회사 트리.
//
// 화면은 그리기만 한다. 묶기·거르기·세우기는 lib/customerList.ts 가 한다
// (좌 패널의 건수와 우측 표의 줄이 같은 셈법이어야 하기 때문이다).
//
// ── 이번 회차의 범위 ──────────────────────────────────────────────────────
//   「회사」 탭만 돈다. 「대리점」·「미연결」은 **자리와 건수만** 둔다 — 누르면
//   「다음 회차」라고 알린다. 건수는 진짜 값이라 지금도 규모를 알 수 있다.

import { useCallback, useMemo, useRef, useState } from 'react'
import ScrollHints from '@/components/common/ScrollHints'
import { INDUSTRIES } from '@/lib/leadOptions'
import type { AgencyOption } from '@/lib/customerAgency'
import { matchesAgency } from '@/lib/companySearch'
import Tooltip from '@/components/common/Tooltip'
import {
  daysLabel, isStale, type CompanyGroup, 
} from '@/lib/customerList'
import { R } from '@/lib/radius'
import BulkBar from '@/components/home/list/BulkBar'
import BulkApplyModal from '@/components/home/list/BulkApplyModal'
import { currentValueCounts } from '@/lib/bulkActions'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#4b5563'
const MUTED = '#6b7280'
const BLUE = '#234ea2'
const DANGER = '#ef4444'

const STATUS_DOT: Record<string, string> = { '활성': '#16a34a', '잠재': '#f59e0b', '이탈': '#ef4444' }

/**
 * 목록 보기의 탭 — **둘**이다(2026-11-27, 묶음6 4-1).
 * 'cleanup'(정리 필요)은 걷었다. 그 목록은 「고치라고 재촉하는 목록」이었는데 고치는 길이
 * 그 안에 없어서, 결국 회사를 하나씩 열어야 했다. 다시 둘 때는 **그 자리에서 고치는 길**과
 * 함께 두어야 한다. 그 안에 있던 셋(회사 삭제·삭제 요청·복구)의 행방은 ListTabs 주석에.
 */
export type ListTab = 'company' | 'agency'

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
  /** 검색어 — 대리점·정리 필요 탭도 이 글자로 좁힌다(2026-11-27, 묶음4 D). */
  query?: string
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
  /**
   * 사업장 0곳 회사를 **지운다** — 슈퍼관리자에게만 넘어온다. 없으면 그 자리에 「삭제 요청」이 선다.
   */
  /** 지울 수 없는 사람이 **지워 달라고** 한다(lib/customerDelete.ts). */
  /** 이미 삭제 요청이 들어온 회사들 — 그 줄에 꼬리표를 붙인다. */
  /** 지워진 줄을 되돌린다(슈퍼관리자에게만 넘어온다 — 없으면 버튼도 없다). */
  /** 대리점 목록(7). 누르면 회사 탭이 그 대리점의 사업장만 거른다. */
  agencies: AgencyOption[]
  agencySiteCount: (agencyId: number) => number
  onPickAgency: (agencyId: number) => void
  /** 지금 고른 대리점 — 그 줄을 켜 둔다(우측에 그 대리점 화면이 서 있다). */
  selectedAgencyId: number | null
}

// 탭 — 글자는 **한 줄로** 선다. 좁은 패널에서 flex 가 눌러 「대 리 점」처럼 접히면
// 줄 높이가 무너지고 배지가 글자 위로 올라탄다(2026-11-19 실측).





export default function CustomerListPanel({
  tab,
  groups, siteCount, expanded, toggleExpand, selectedCompanyId, selectedSiteId,
  onSelectCompany, onSelectSite, loading,
  checkedCompanies, toggleCompanyCheck, clearCompanyChecks, onBulkIndustry,
  agencies, agencySiteCount, onPickAgency, selectedAgencyId, query = '',
}: Props) {
  /**
   * 대리점·정리 필요 탭의 **검색** (2026-11-27, 묶음4 D).
   *   대리점 — 대리점명 · 영문명만 본다(matchesAgency). 주소·사업장명은 보지 않는다.
   *   정리 필요 — 회사명으로 좁힌다(그 묶음에는 회사 이름 하나뿐이다).
   * 회사 탭은 트리를 만들 때 이미 좁혀져 들어온다(lib/customerList.ts).
   */
  const shownAgencies = useMemo(
    () => agencies.filter(a => matchesAgency({ company_name: a.company_name, name_en: a.name_en }, query)),
    [agencies, query],
  )


  /**
   * 회사 줄을 눌렀을 때 — **닫혀 있으면 펴고 고른다. 열려 있으면 고르기만 한다**
   * (2026-11-27, 묶음4 E). 접는 길은 ∨ 하나뿐이다.
   */
  const pickCompany = useCallback((companyId: number, open: boolean) => {
    if (!open) toggleExpand(companyId)
    onSelectCompany(companyId)
  }, [toggleExpand, onSelectCompany])

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
      <style>{`
        /* 트리 화살표 — **배경 없이** 색만 들고 1.2배(2026-11-27, 묶음5 2-3). */
        .tree-chev:hover, .tree-chev:focus-visible {
          color: #2563eb !important;
          transform: scale(1.2);
          outline: none;
        }
      `}</style>
      <nav ref={treeRef} aria-label="회사 목록" className="stable-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 12px', minHeight: 0 }}>
        {tab === 'agency' ? (
          /* ── 대리점 탭(7) — 누르면 그 대리점 화면이 선다.
             검색은 **대리점명 · 영문명**만 본다(2026-11-27, 묶음4 D). 회사명으로 찾으면
             0건이다 — 그 회사는 회사 탭에 있고, 대리점으로 좁히는 일은 필터가 맡는다. ── */
          shownAgencies.length === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>
              {query.trim() ? `「${query.trim()}」 에 맞는 대리점이 없습니다` : '등록된 대리점이 없습니다'}
            </div>
          ) : shownAgencies.map(a => {
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
                aria-expanded={open}
                /**
                 * 줄을 누르면 — **닫혀 있으면 펴고 고른다. 열려 있으면 고르기만 한다**
                 * (2026-11-27, 묶음4 E).
                 *
                 * 전에는 누를 때마다 토글이라, 펴 둔 회사를 다시 눌러 **고르려는 순간
                 * 접혔다**. 사업장을 보며 회사를 고르는 일이 한 번에 되지 않았다.
                 * 접는 길은 **∨ 하나**로 남긴다 — 접는 것은 드물고 분명한 뜻이다.
                 * 폰·키보드(Enter·Space)도 같은 규칙이다.
                 */
                onClick={() => pickCompany(g.companyId, open)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickCompany(g.companyId, open) } }}
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
                {/* ∨ — **접고 펴는 유일한 자리**다. 줄 클릭과 갈라 둔다(위 주석).
                    손을 올리면 **배경 없이** 색만 들고 살짝 커진다(2026-11-27, 묶음5 2-3).
                    회색 동그라미가 깔리면 줄 안에 또 하나의 단추가 생겨 줄이 시끄러워진다 —
                    여기서 알려야 하는 것은 「이것도 눌린다」 하나뿐이다. */}
                <Tooltip label={open ? '사업장 접기' : '사업장 펼치기'}>
                <button type="button"
                  className="tree-chev"
                  onClick={e => { e.stopPropagation(); toggleExpand(g.companyId) }}
                  onKeyDown={e => e.stopPropagation()}
                  aria-label={`${g.companyName} ${open ? '접기' : '펼치기'}`}
                  aria-expanded={open}
                  style={{
                    width: 22, height: 22, flexShrink: 0, padding: 0, border: 'none', background: 'transparent',
                    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    color: MUTED, transition: 'color 0.1s ease, transform 0.1s ease',
                  }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s ease' }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                </Tooltip>
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
                    // 고른 줄을 **패널 가운데**로 데려오는 표(2026-11-28, 야간4 7-2).
                    // 지도 핀·견적·알림에서 들어오면 그 사업장이 트리 어디에 있는지
                    // 사람이 찾아야 했다 — 871줄 가운데 하나다.
                    data-site-row={on ? 'on' : undefined}
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
      {(
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
