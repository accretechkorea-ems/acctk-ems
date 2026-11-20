//app/page.tsx

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
// 모바일 상단 바 높이 — 화면 높이를 계산하는 곳은 이 상수 하나를 본다(PC 는 상단 바가 없다).
import { TOPBAR_HEIGHT } from '@/components/layout/Sidebar'
import Sidebar from '@/components/home/Sidebar'
import MapView from '@/components/home/MapView'
import AddCustomerModal from '@/components/home/AddCustomerModal'
import { useHomeData } from '@/hooks/useHomeData'
import { CATEGORY_OPTIONS } from '@/lib/constants'
import {
  CUSTOMER_EXCEL_SELECT, exportCustomerXlsx, toExcelCustomer,
  type CustomerExcelRow, type ExcelCustomer,
} from '@/lib/customerExcel'
import { NOT_AGENCY_ONLY, useAgencies } from '@/lib/customerAgency'
import ListHeader, { type HomeView } from '@/components/home/ListHeader'
import CustomerListPanel, { type CleanupBucket, type CleanupRow, type ListTab } from '@/components/home/list/CustomerListPanel'
import CompanyPane from '@/components/home/list/CompanyPane'
import CustomerDetailBody from '@/components/customer/CustomerDetailBody'
import { loadEngineers } from '@/lib/appData/engineers'
import { invalidateParents, loadParents, type ParentOption } from '@/components/customer/ParentPicker'
import { useOpenQuotes } from '@/hooks/useOpenQuotes'
import {
  buildCompanyTree, EMPTY_FILTER,
  type ListFilter, type SortKey,
} from '@/lib/customerList'
import type { LastTouch } from '@/lib/customerLastTouch'
import { todayKST } from '@/lib/date'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { isSuperAdmin } from '@/lib/permissions'


import {
  HOME_STATE_KEY,
  PAGE_BG,
  TEXT_MUTED,
  getDeviceLine,
  type Customer,
  type Device,
  toTimeValue,
} from '@/lib/home'
import { R } from '@/lib/radius'






export default function HomePage() {
  const supabase = createClient()
  const { engineer: me, loading: guardLoading, authorized } = usePageGuard()
  // 엑셀 내보내기는 관리자만 — 팀 관리·목표 관리 버튼과 같은 판정(permission_level).
  const canExportExcel = isSuperAdmin(me)
  const toast = useToast()
  const confirmDialog = useConfirm()

  const listScrollRef = useRef<HTMLDivElement | null>(null)
  const restoredHomeStateRef = useRef(false)
  const pendingListScrollTopRef = useRef<number | null>(null)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deviceMap, setDeviceMap] = useState<Map<number, Device[]>>(new Map())
  const [focusedCustomerId, setFocusedCustomerId] = useState<number | null>(null)
  const [latestServiceDateMap, setLatestServiceDateMap] = useState<Map<number, number>>(new Map())
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null)
  const [mapLevel, setMapLevel] = useState<number | null>(null)
  const [openOverlayCustomerId, setOpenOverlayCustomerId] = useState<number | null>(null)
  const [mobileTab, setMobileTab] = useState<'list' | 'map'>('list')
  /**
   * 보기 — 지도 / 목록. 주소의 `?view=list` 와 세션 저장(HOME_STATE_KEY)에 함께 남긴다.
   *
   * 라우트를 가르지 않는 이유 — 조회(useHomeData)·필터·검색·스크롤 복원이 전부 이
   * 화면에 있다. 라우트를 나누면 그 네 가지가 두 벌이 되고, 메뉴 권한도 새 key 가
   * 필요하다(lib/menuPerms.ts 의 customers 는 path '/' 다). 주소로 공유하는 길만
   * 쿼리로 남긴다(CRM 보강 1차 보고의 결정 9).
   */
  const [view, setView] = useState<HomeView>('map')
  // 목록 보기 상태 — 탭·필터·정렬·펼침·선택.
  const [listTab, setListTab] = useState<ListTab>('company')
  const [listFilter, setListFilter] = useState<ListFilter>({
    ...EMPTY_FILTER,
    statuses: ['활성', '잠재'],
    categories: [...CATEGORY_OPTIONS],
  })
  const [listSort, setListSort] = useState<SortKey>('touch')
  /** 분류를 한 번에 지정할 회사들(3a). */
  const [checkedCompanies, setCheckedCompanies] = useState<Set<number>>(new Set())
  /** 정리 필요 탭에서 보고 있는 묶음(4). */
  const [cleanupBucket, setCleanupBucket] = useState<CleanupBucket>('industry')
  /** 대리점 탭에서 고른 대리점 — 회사 탭이 그 대리점의 사업장만 보여 준다(7). */
  const [agencyFilterId, setAgencyFilterId] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null)
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null)
  const [companies, setCompanies] = useState<ParentOption[]>([])
  const [lastTouchMap, setLastTouchMap] = useState<Map<number, LastTouch>>(new Map())
  /** 등록 폼의 회사를 고정한 채 열었는가(회사 카드의 「+ 사업장 추가」). */
  /** 등록 폼을 「기존 회사에 사업장 추가」로 열 회사(없으면 새 업체 등록). */
  const [addPresetCompanyId, setAddPresetCompanyId] = useState<number | null>(null)
  /** 회사 타임라인에서 처음에 켜 둘 사업장 — 사업장 화면에서 ← 로 돌아올 때 넘어온다. */
  const [timelineFocusSiteId, setTimelineFocusSiteId] = useState<number | null>(null)
  /** 활동 현황에서 넘어온 줄(?focus=). 한 번 찾아가고 나면 비운다. */
  const [timelineFocusKey, setTimelineFocusKey] = useState<string | null>(null)
  /** 아직 회사를 못 찾은 ?site= — 목록 자료가 들어온 뒤에 편다. */
  const [pendingFocusSiteId, setPendingFocusSiteId] = useState<number | null>(null)
  /** 등록 폼의 모드 — 사업장 / 대리점. 같은 폼을 쓰고 칸만 달라진다. */
  // 진행 견적 수는 **목록 보기를 열 때만** 읽는다(첫 화면 조회를 늘리지 않는다).
  const openQuotes = useOpenQuotes(view === 'list')
  // 대리점 목록 — 캐시를 공유하므로 조회는 앱당 한 번이다(탭의 건수·목록이 같은 값을 본다).
  const agencyList = useAgencies()
  const agencyCount = agencyList.length
  /** 작성자 id → 이름. 직원 목록은 공통 층에서 받는다(조회 0회).  */
  const [engineerNameMap, setEngineerNameMap] = useState<Map<number, string>>(new Map())

useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      setMobileTab('list')
    }
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
}, [])
  const [query, setQuery] = useState('')
  // 「업체 | 부품」 모드 토글은 걷었다(2026-11-19) — 부품 사용 이력 검색은 견적 작성
  // 화면으로 옮긴다. 조회·상태 코드는 그대로 남아 있다(lib/partSearch.ts).
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['활성', '잠재'])
const [selectedCategories, setSelectedCategories] = useState<string[]>([...CATEGORY_OPTIONS])

const toggleCategory = (category: string) => {
  setSelectedCategories((prev) =>
    prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
  )
}
  const [isAddCustomerModalOpen, setIsAddCustomerModalOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const { fetchData } = useHomeData({
  setCustomers,
  setDeviceMap,
  setLatestServiceDateMap,
  setLastTouchMap,
})

  /**
   * 주소의 `?view=list` — 들어올 때 읽고, 토글할 때 바꾼다.
   *
   * useSearchParams 를 쓰지 않는 이유: 이 화면은 Suspense 경계가 없어 그 훅을 들이면
   * 경계를 새로 둘러야 한다. 읽기는 한 번뿐이고 쓰기는 주소만 갈아 끼우면 되므로
   * history.replaceState 로 충분하다(뒤로 가기 기록을 늘리지 않는다).
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const q = new URLSearchParams(window.location.search)
    if (q.get('view') === 'list') setView('list')
    // 활동 현황에서 넘어온 길 — 그 사업장의 **회사**를 펴고 칩을 켠 뒤 그 줄로 내려간다.
    const site = Number(q.get('site'))
    if (Number.isInteger(site) && site > 0) {
      setView('list')
      setPendingFocusSiteId(site)
      setTimelineFocusSiteId(site)
      setTimelineFocusKey(q.get('focus'))
    }
  }, [])

  // 사업장 번호로 회사를 찾는 일은 목록 자료가 들어온 뒤에야 된다.
  useEffect(() => {
    if (pendingFocusSiteId == null || customers.length === 0) return
    const site = customers.find(c => c.customer_id === pendingFocusSiteId)
    const parent = site?.parent_customer_id ?? null
    if (parent != null) {
      setSelectedCompanyId(parent)
      setExpanded(prev => new Set(prev).add(parent))
    }
    setPendingFocusSiteId(null)
  }, [pendingFocusSiteId, customers])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (view === 'list') url.searchParams.set('view', 'list')
    else url.searchParams.delete('view')
    // 찾아가기 값은 한 번 쓰고 주소에서 턴다 — 새로고침·뒤로가기에 다시 뜨지 않게.
    if (timelineFocusKey == null) { url.searchParams.delete('site'); url.searchParams.delete('focus') }
    if (url.toString() !== window.location.href) window.history.replaceState(null, '', url.toString())
  }, [view, timelineFocusKey])

  // 작성자 이름 — 목록 보기의 표가 쓴다.
  useEffect(() => {
    if (view !== 'list') return
    let cancelled = false
    loadEngineers().then(list => {
      if (cancelled) return
      setEngineerNameMap(new Map((list as { engineer_id: number; name: string | null }[]).map(e => [e.engineer_id, e.name ?? ''])))
    })
    return () => { cancelled = true }
  }, [view])

  // 회사 줄(is_parent)은 목록 보기에서만 쓴다 — 캐시를 공유하므로 조회는 한 번이다.
  useEffect(() => {
    if (view !== 'list') return
    let cancelled = false
    loadParents().then(list => { if (!cancelled) setCompanies(list) })
    return () => { cancelled = true }
  }, [view])

  useEffect(() => {
    if (customers.length > 0) setIsLoading(false)
  }, [customers])

  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 6000)
    return () => clearTimeout(t)
  }, [])


  const saveHomeState = () => {
    if (typeof window === 'undefined') return

   const payload = {
  query,
  selectedStatuses,
  selectedCategories,
  view,
  listScrollTop: listScrollRef.current?.scrollTop ?? 0,
  mapCenter,
  mapLevel,
  openOverlayCustomerId,
}

    sessionStorage.setItem(HOME_STATE_KEY, JSON.stringify(payload))
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    const navType = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming

if (navType.type !== 'back_forward') {
  sessionStorage.removeItem(HOME_STATE_KEY)
  restoredHomeStateRef.current = true
  return
}

    const raw = sessionStorage.getItem(HOME_STATE_KEY)
    if (!raw) {
      restoredHomeStateRef.current = true
      return
    }

    try {
      const parsed = JSON.parse(raw)

      if (typeof parsed.query === 'string') {
        setQuery(parsed.query)
      }


      if (
        Array.isArray(parsed.selectedStatuses) &&
        parsed.selectedStatuses.every((item: unknown) => typeof item === 'string')
      ) {
        setSelectedStatuses(parsed.selectedStatuses)
      }

     if (
  Array.isArray(parsed.selectedCategories) &&
  parsed.selectedCategories.every((item: unknown) => typeof item === 'string')
) {
  setSelectedCategories(parsed.selectedCategories)
}

      if (parsed.view === 'list' || parsed.view === 'map') {
        setView(parsed.view)
      }

      if (typeof parsed.listScrollTop === 'number') {
        pendingListScrollTopRef.current = parsed.listScrollTop
      }
      if (
  parsed.mapCenter &&
  typeof parsed.mapCenter.lat === 'number' &&
  typeof parsed.mapCenter.lng === 'number'
) {
  setMapCenter({
    lat: parsed.mapCenter.lat,
    lng: parsed.mapCenter.lng,
  })
}

if (typeof parsed.mapLevel === 'number') {
  setMapLevel(parsed.mapLevel)
}

if (typeof parsed.openOverlayCustomerId === 'number') {
  setOpenOverlayCustomerId(parsed.openOverlayCustomerId)
}
      
    } catch (error) {
      console.warn('홈 상태 복원 실패:', error)
    } finally {
      restoredHomeStateRef.current = true
    }
  }, [])

  useEffect(() => {
  if (!restoredHomeStateRef.current) return
  saveHomeState()
}, [view, query, selectedStatuses, selectedCategories, mapCenter, mapLevel, openOverlayCustomerId])

  const toggleStatus = (status: string) => {
    setFocusedCustomerId(null)
    setSelectedStatuses((prev) => {
      if (prev.includes(status)) {
        return prev.filter((s) => s !== status)
      }
      return [...prev, status]
    })
  }






  const filteredCustomers = useMemo(() => {
    const q = query.trim().toLowerCase()

    const filtered = customers.filter((c) => {
      const statusMatched =
        selectedStatuses.length === 0 ? false : selectedStatuses.includes(c.status ?? '')

      if (!statusMatched) return false
      const devices = deviceMap.get(Number(c.customer_id)) || []
      const cats = devices.map((d) => d.category).filter((cat): cat is string => Boolean(cat))
      const hasFilterable = cats.some((cat) =>
        (CATEGORY_OPTIONS as readonly string[]).includes(cat)
      )

      const categoryMatched =
        selectedCategories.length === 0 ? false :
        !hasFilterable ? true :
        cats.some((cat) => selectedCategories.includes(cat))

      if (!categoryMatched) return false

      const deviceLine = getDeviceLine(devices).toLowerCase()

      if (!q) return true

      return (
        (c.company_name || '').toLowerCase().includes(q) ||
        (c.address || '').toLowerCase().includes(q) ||
        (c.status || '').toLowerCase().includes(q) ||
        (c.agency_name || '').toLowerCase().includes(q) ||
        deviceLine.includes(q)
      )
    })

    return [...filtered].sort((a, b) => {
      const aDevices = deviceMap.get(a.customer_id) || []
      const bDevices = deviceMap.get(b.customer_id) || []

      const aLatestDevice = Math.max(0, ...aDevices.map((d) => toTimeValue(d.install_date)))
      const bLatestDevice = Math.max(0, ...bDevices.map((d) => toTimeValue(d.install_date)))

      // 마지막 접점 — 영업활동·서비스·견적·수리 중 최신(lib/customerLastTouch.ts).
      // 예전에는 서비스 리포트만 봐서, 견적·수리만 있는 업체가 아래로 깔렸다.
      const aLatestTouch = latestServiceDateMap.get(a.customer_id) ?? 0
      const bLatestTouch = latestServiceDateMap.get(b.customer_id) ?? 0

      // customer_id 는 날짜가 하나도 없는 업체끼리의 차례를 정하는 꼬리표다(나중에 등록한 것이 위).
      const aLatest = Math.max(aLatestDevice, aLatestTouch, a.customer_id)
      const bLatest = Math.max(bLatestDevice, bLatestTouch, b.customer_id)

      return bLatest - aLatest
    })
  }, [customers, query, selectedStatuses, selectedCategories, deviceMap, latestServiceDateMap])

  // ── 목록 보기의 트리 ─────────────────────────────────────────────────────
  //   좌 패널의 건수와 우측 표의 줄은 **같은 셈법**을 써야 한다 — 그 셈법은
  //   lib/customerList.ts 에 있고, 여기서는 재료만 모아 넘긴다.
  const companyMap = useMemo(
    () => new Map(companies.map(c => [c.customer_id, { company_name: c.company_name, industry: c.industry, name_en: c.name_en, note: c.note }])),
    [companies],
  )
  const today = todayKST()
  /** 대리점으로 걸러 볼 때는 그 대리점을 쓰는 사업장만 넘긴다(7). */
  const treeCustomers = useMemo(
    () => (agencyFilterId == null ? customers : customers.filter(c => c.agency_customer_id === agencyFilterId)),
    [customers, agencyFilterId],
  )

  const listTree = useMemo(() => buildCompanyTree({
    customers: treeCustomers,
    companies: companyMap,
    deviceCount: id => (deviceMap.get(id) ?? []).length,
    deviceCategories: id => (deviceMap.get(id) ?? []).map(d => d.category).filter((x): x is string => !!x),
    openQuotes: id => openQuotes.get(id) ?? 0,
    touchOf: id => lastTouchMap.get(id) ?? null,
    today,
    filter: { ...listFilter, query },
    allCategories: CATEGORY_OPTIONS,
    sort: listSort,
  }), [treeCustomers, companyMap, deviceMap, openQuotes, lastTouchMap, today, listFilter, query, listSort])

  // ── 정리 필요 탭의 네 묶음(4) ────────────────────────────────────────────
  //   조건을 각 조각에 흩지 않고 여기서 한 번에 만든다 — 건수와 줄이 같은 셈법이어야 한다.
  const cleanup = useMemo<Record<CleanupBucket, CleanupRow[]>>(() => {
    const sitesByParent = new Map<number, Customer[]>()
    for (const c of customers) {
      const pid = c.parent_customer_id
      if (pid == null) continue
      const list = sitesByParent.get(pid)
      if (list) list.push(c); else sitesByParent.set(pid, [c])
    }
    // 이름 중복 의심 — 괄호·㈜·공백을 턴 뒤 같은 이름인 회사가 둘 이상.
    const norm = (v: string) => v
      .replace(/㈜|\(\s*주\s*\)|주식회사|\(유\)|㈲|유한회사/g, '')
      .replace(/[()\[\]{}·,.\-_/\s]/g, '').toLowerCase()
    const byNorm = new Map<string, ParentOption[]>()
    for (const p of companies) {
      const k = norm(p.company_name)
      const list = byNorm.get(k)
      if (list) list.push(p); else byNorm.set(k, [p])
    }

    const industry: CleanupRow[] = []
    const dupName: CleanupRow[] = []
    const blankSites: CleanupRow[] = []
    const emptyCompany: CleanupRow[] = []

    for (const p of companies) {
      const sites = sitesByParent.get(p.customer_id) ?? []
      if (!(p.industry ?? '').trim()) {
        industry.push({ companyId: p.customer_id, companyName: p.company_name, hint: `사업장 ${sites.length}곳 · 분류를 고르세요` })
      }
      if (sites.length === 0) {
        emptyCompany.push({ companyId: p.customer_id, companyName: p.company_name, hint: '묶인 사업장이 없습니다 — 지울 수 있습니다' })
      }
      const blanks = sites.filter(c => !(c.site_name ?? '').trim()).length
      // 한 곳만 비어도 든다 — 겹칠 때만 세던 전에는 「이름 없는 사업장 한 곳」이 끝내 안 보였다.
      if (blanks >= 1) {
        blankSites.push({
          companyId: p.customer_id, companyName: p.company_name,
          hint: `사업장 ${sites.length}곳 중 ${blanks}곳이 이름 없음 — 사업장명을 적으세요`,
        })
      }
    }
    for (const [, list] of byNorm) {
      if (list.length < 2) continue
      for (const p of list) {
        dupName.push({
          companyId: p.customer_id, companyName: p.company_name,
          hint: `같은 이름: ${list.filter(x => x.customer_id !== p.customer_id).map(x => x.company_name).join(' · ')}`,
        })
      }
    }
    const byName = (a: CleanupRow, b: CleanupRow) => a.companyName.localeCompare(b.companyName, 'ko')
    return {
      industry: industry.sort(byName), dupName: dupName.sort(byName),
      blankSites: blankSites.sort(byName), emptyCompany: emptyCompany.sort(byName),
    }
  }, [companies, customers])

  /** 대리점 하나가 몇 곳에 붙어 있나(대리점 탭의 오른쪽 수). */
  const agencySiteCount = useCallback(
    (agencyId: number) => customers.filter(c => c.agency_customer_id === agencyId).length,
    [customers],
  )

  /** 회사 여럿의 분류를 한 번에 지정한다(3a). */
  const bulkIndustry = async (value: string) => {
    const ids = [...checkedCompanies]
    if (ids.length === 0 || !value) return
    const { error } = await supabase.from('customers').update({ industry: value }).in('customer_id', ids)
    if (error) { toast.error(error.message || '분류를 저장하지 못했습니다'); return }
    invalidateParents()
    loadParents().then(setCompanies)
    setCheckedCompanies(new Set())
    toast.success(`회사 ${ids.length}곳의 분류를 「${value}」 로 바꿨습니다`)
  }

  /** 사업장 0곳 회사를 지운다(정리 필요 탭). 라우트가 지우기 직전에 다시 센다. */
  const deleteEmptyCompany = async (companyId: number, companyName: string) => {
    const ok = await confirmDialog({
      title: '회사 삭제',
      message: `'${companyName}' 회사 줄을 지웁니다. 묶인 사업장이 없을 때만 지워지며, 되돌릴 수 없습니다.`,
      confirmText: '삭제', variant: 'danger',
    })
    if (!ok) return
    const res = await fetch('/api/parent-company', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', parentId: companyId }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json?.error) { toast.error(json?.error ?? `서버 오류 (${res.status})`); return }
    invalidateParents()
    loadParents().then(setCompanies)
    if (selectedCompanyId === companyId) { setSelectedCompanyId(null); setSelectedSiteId(null) }
    toast.success(`${companyName} 회사를 지웠습니다`)
  }

  /** 지금 고른 회사 묶음. */
  const selectedGroup = useMemo(
    () => listTree.groups.find(g => g.companyId === selectedCompanyId) ?? null,
    [listTree, selectedCompanyId],
  )

  /**
   * 업체 등록 폼을 연다.
   *
   * 회사를 골라 둔 채 열면(목록 보기·회사 카드의 「+ 사업장 추가」) 그 회사로 고정된
   * 「기존 회사에 사업장 추가」 모드로 열린다 — 어느 회사에 붙일지는 이미 정해진 자리다.
   * 종류(고객사·대리점)는 폼 맨 위에서 고른다.
   */
  const openAddCustomer = (useSelectedCompany = false) => {
    setAddPresetCompanyId(useSelectedCompany && view === 'list' ? selectedCompanyId : null)
    setIsAddCustomerModalOpen(true)
  }
  const toggleExpand = (companyId: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(companyId)) next.delete(companyId)
      else next.add(companyId)
      return next
    })
  }

/**
   * 지금 목록을 엑셀로 내려받는다 — **화면이 거른 범위·순서 그대로** 쓴다.
   *
   * 목록 상태(customers·deviceMap)를 그대로 쓰지 않는 이유 — 양식에 들어가는 지역·
   * 소속회사·고객 담당자를 목록 조회가 읽지 않는다(목록이 가벼워야 해서 뺀 열들이다).
   * 그래서 누를 때 양식에 쓰는 열만 한 번 더 읽고, 장비·담당자는 임베딩으로 같이 받는다.
   * 1,354행 · 529KB · 1.7초(2026-10-23 실측)라 한 번에 받는다.
   */
  const handleExportExcel = async () => {
    if (isExporting) return
    if (filteredCustomers.length === 0) { toast.error('내보낼 고객사가 없습니다'); return }
    setIsExporting(true)
    try {
      const [listRes, parentRes] = await Promise.all([
        supabase.from('customers').select(CUSTOMER_EXCEL_SELECT)
          // 화면 목록과 같은 범위라야 한다 — 대리점 전용 줄은 양쪽에서 빠진다.
          .is('deleted_at', null).eq('is_parent', false).or(NOT_AGENCY_ONLY).range(0, 5000),
        // 소속회사 이름 — 부모 행은 목록·지도에 안 나오므로 따로 읽는다(273행).
        supabase.from('customers').select('customer_id, company_name')
          .eq('is_parent', true).is('deleted_at', null).range(0, 2000),
      ])
      if (listRes.error || parentRes.error) {
        console.warn('엑셀 조회 오류:', listRes.error ?? parentRes.error)
        toast.error('목록을 읽지 못했습니다')
        return
      }
      // select 문자열이 변수라 supabase 가 줄 모양을 추론하지 못한다 — 양식이 읽는
      // 열만 들어 있는 타입(CustomerExcelRow)으로 한 번 못 박고 쓴다.
      const rawRows = (listRes.data ?? []) as unknown as CustomerExcelRow[]
      const parentRows = (parentRes.data ?? []) as { customer_id: number; company_name: string | null }[]
      const byId = new Map<number, ExcelCustomer>(
        rawRows.map(r => [Number(r.customer_id), toExcelCustomer(r)]),
      )
      const parentNames = new Map<number, string>(
        parentRows.map(r => [Number(r.customer_id), r.company_name ?? '']),
      )
      // 화면 순서대로 꺼낸다. 그 사이에 지워진 업체는 조회에서 빠지므로 건너뛴다.
      const rows = filteredCustomers
        .map((c) => byId.get(Number(c.customer_id)))
        .filter((r): r is ExcelCustomer => !!r)
      const lines = await exportCustomerXlsx({
        customers: rows,
        parentName: (id) => (id == null ? '' : parentNames.get(id) ?? ''),
        today: todayKST(),
      })
      toast.success(`고객사 ${rows.length}개 · ${lines}줄을 내려받았습니다`)
    } catch (e) {
      console.warn('엑셀 내보내기 실패:', e)
      toast.error(e instanceof Error ? e.message : '엑셀을 만들지 못했습니다')
    } finally {
      setIsExporting(false)
    }
  }

useEffect(() => {
  if (pendingListScrollTopRef.current == null) return
  if (!listScrollRef.current) return
  if (filteredCustomers.length === 0) return  // 데이터 아직 없으면 대기

  const targetScrollTop = pendingListScrollTopRef.current
  pendingListScrollTopRef.current = null  // 중복 실행 방지를 위해 즉시 초기화

  let retry = 0

  const interval = setInterval(() => {
    if (!listScrollRef.current) {
      clearInterval(interval)
      return
    }

    listScrollRef.current.scrollTop = targetScrollTop

    // 실제로 적용됐는지 확인
    if (
      Math.abs(listScrollRef.current.scrollTop - targetScrollTop) < 5 ||
      retry > 15
    ) {
      clearInterval(interval)
    }

    retry++
  }, 50)

  return () => clearInterval(interval)
}, [filteredCustomers])

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <>

      <style jsx global>{`
        /* filter: invert(1) 은 지웠다 — lib/home.ts 의 colorScheme: 'dark' 와 짝이던
           다크 테마 잔재다. 그쪽이 아이콘을 흰색으로 그리면 여기서 검정으로 되뒤집는 식이라,
           한쪽만 지우면 아이콘이 흰 배경에 묻혀 사라진다. 둘을 함께 지웠다(2026-09-29).
           cursor 는 다크 테마와 무관해 남긴다(다른 화면도 같은 규칙을 둔다). */
        input[type="date"].white-date::-webkit-calendar-picker-indicator {
          cursor: pointer;
        }

        input::placeholder,
        textarea::placeholder {
          color: ${TEXT_MUTED};
          opacity: 1;
        }

        /* 여기에 있던 두 규칙은 지웠다. 둘 다 이 화면이 다크 테마였을 때(PANEL_BG #17181d)
           쓰던 것이고, 라이트 테마로 바뀐 뒤로는 맞지 않는다(2026-09-29).

           1) scrollbar-color: #5b606b ... — 흰 패널 위 짙은 막대가 되어 어울리지 않았다.
              게다가 선택자가 * 였던 동안에는 이 style 태그가 global 이라 문서 전체에 퍼졌고,
              크로미움이 「표준 속성이 초기값이 아니다」로 보고 다른 화면의 ::-webkit-scrollbar
              규칙까지 통째로 버렸다 — 사이드바 메뉴 목록 스크롤바가 짙은 막대와 위·아래
              화살표로 되돌아가던 원인이다. 이제 홈의 스크롤 영역은 브라우저 기본을 쓴다.

           2) select { appearance: none } — 다크 테마에서 밝은 기본 선택 상자를 가리려던 것인데,
              대신 그릴 화살표를 두지 않아 드롭다운이라는 표시가 아예 없었다. 기본으로 되돌린다. */
      `}</style>

      <div
        style={{
          padding: 20,
          // 높이는 .home-wrapper 규칙이 정한다 — PC 는 상단 바가 없고 모바일만 그만큼 뺀다.
          height: '100vh',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          background: PAGE_BG,
          overflow: 'hidden',
        }}
        className="home-wrapper"
      >

       <style>{`
        /* 왼쪽 열의 검색칸은 **좁은 화면 전용**이다 — 넓은 화면은 맨 위 헤더가 맡는다. */
        .sidebar-search { display: none; }
        @media (max-width: 768px) {
  .sidebar-search { display: block !important; }
  .home-grid { grid-template-columns: 1fr !important; grid-template-rows: 1fr !important; }
  .mobile-tab-bar { display: flex !important; }
  .mobile-hide { display: none !important; }
  .home-wrapper { height: calc(100dvh - ${TOPBAR_HEIGHT}px) !important; padding: 12px !important; overflow: hidden !important; }
  .home-grid { height: 100% !important; overflow: hidden !important; }
  .home-grid > div { height: 100% !important; min-height: 0 !important; min-width: 0 !important; overflow: hidden !important; }
  .home-grid > div > div { height: 100% !important; }
  body { overflow-x: hidden !important; }
  /* 좁은 화면은 예전 「업체 목록 | 지도」 탭이 맡는다 — 토글이 둘이면 뜻이 겹친다. */
  .home-header { display: none !important; }
}
      `}</style>

      {/* 맨 위 한 줄 — 보기 토글·검색·엑셀·등록. 두 보기가 함께 쓴다. */}
      <ListHeader
        view={view}
        setView={setView}
        query={query}
        setQuery={setQuery}
        count={view === 'list' ? listTree.siteCount : filteredCustomers.length}
        loading={isLoading}
        onExport={handleExportExcel}
        exporting={isExporting}
        canExport={canExportExcel}
        onAdd={() => openAddCustomer()}
      />

      {/* 모바일 탭 */}
      <div
        className="mobile-tab-bar"
        style={{
          display: 'none',
          marginBottom: 12,
          border: `1px solid #e5e7eb`,
          borderRadius: R.card,
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => {
            setMobileTab('list')
          }}
          style={{
            flex: 1,
            padding: '10px 0',
            fontWeight: 700,
            fontSize: 14,
            border: 'none',
            cursor: 'pointer',
            background: mobileTab === 'list' ? '#234ea2' : '#ffffff',
            color: mobileTab === 'list' ? '#ffffff' : '#111111',
          }}
        >
          업체 목록
        </button>
        <button
          onClick={() => {
            setMobileTab('map')
            setTimeout(() => {
              const kakao = (window as any).kakao
              if (kakao?.maps) {
                const container = document.querySelector('.kakao-map-container')
                if (container) {
                  kakao.maps.event.trigger(container, 'resize')
                }
              }
              // relayout 직접 호출
              const mapInstance = (window as any).__kakaoMapInstance
              if (mapInstance) mapInstance.relayout()
            }, 200)
          }}
          style={{
            flex: 1,
            padding: '10px 0',
            fontWeight: 700,
            fontSize: 14,
            border: 'none',
            cursor: 'pointer',
            background: mobileTab === 'map' ? '#234ea2' : '#ffffff',
            color: mobileTab === 'map' ? '#ffffff' : '#111111',
          }}
        >
          지도
        </button>
      </div>

      {view === 'list' ? (
        /* ── 목록 보기 — 좌 360px 트리 + 우 상세 ──────────────────────────
           조회·필터·검색은 지도 보기와 **같은 상태**를 쓴다(화면만 다르다). */
        <div
          className="home-grid"
          style={{ display: 'grid', gridTemplateColumns: '360px minmax(0, 1fr)', gap: 12, alignItems: 'stretch', flex: 1, minHeight: 0 }}
        >
          <div className={mobileTab === 'map' ? 'mobile-hide' : ''} style={{ minHeight: 0, minWidth: 0, height: '100%' }}>
            <CustomerListPanel
              tab={listTab}
              setTab={setListTab}
              counts={{ company: listTree.groups.length, agency: agencyCount, unlinked: listTree.unlinkedCount }}
              filter={listFilter}
              setFilter={setListFilter}
              sort={listSort}
              setSort={setListSort}
              groups={listTree.groups}
              siteCount={listTree.siteCount}
              expanded={expanded}
              toggleExpand={toggleExpand}
              selectedCompanyId={selectedCompanyId}
              selectedSiteId={selectedSiteId}
              onSelectCompany={id => { setSelectedCompanyId(id); setSelectedSiteId(null); setTimelineFocusSiteId(null) }}
              onSelectSite={(cid, sid) => { setSelectedCompanyId(cid); setSelectedSiteId(sid) }}

              checkedCompanies={checkedCompanies}
              toggleCompanyCheck={id => setCheckedCompanies(prev => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id); else next.add(id)
                return next
              })}
              clearCompanyChecks={() => setCheckedCompanies(new Set())}
              onBulkIndustry={v => void bulkIndustry(v)}
              cleanup={cleanup}
              cleanupBucket={cleanupBucket}
              setCleanupBucket={setCleanupBucket}
              onDeleteCompany={(id, name) => void deleteEmptyCompany(id, name)}
              agencies={agencyList}
              agencySiteCount={agencySiteCount}
              onPickAgency={id => { setAgencyFilterId(id); setListTab('company'); setSelectedCompanyId(null); setSelectedSiteId(null) }}
              agencyFilterId={agencyFilterId}
              clearAgencyFilter={() => setAgencyFilterId(null)}
              loading={isLoading}
            />
          </div>
          <div style={{ minHeight: 0, minWidth: 0, height: '100%', overflowY: 'auto' }}>
            {selectedSiteId != null ? (
              /* 사업장을 골랐을 때 — **상세 페이지와 같은 본문**이다(컴포넌트 하나를 나눠 쓴다). */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
                {/* 경로 줄·「새 창」은 걷었다(2026-11-20) — 회사로 가는 길은 카드 제목 앞의
                    화살표가 맡고, 같은 주소를 새 창으로 여는 길은 쓰이지 않았다. */}
                <CustomerDetailBody
                  key={selectedSiteId}
                  customerId={selectedSiteId}
                  embedded
                  // ← 는 회사 보기로 — **그 사업장 칩이 켜진 채** 열린다(보던 자리를 잃지 않게).
                  onBack={() => { setTimelineFocusSiteId(selectedSiteId); setSelectedSiteId(null) }}
                />
              </div>
            ) : selectedGroup ? (
              <CompanyPane
                key={selectedGroup.companyId}
                group={selectedGroup}
                engineerName={id => (id == null ? '' : engineerNameMap.get(id) ?? '')}
                onSaved={() => { invalidateParents(); loadParents().then(setCompanies); void fetchData() }}
                onError={msg => toast.error(msg)}
                onToast={msg => toast.success(msg)}
                onOpenSite={id => setSelectedSiteId(id)}
                onAddSite={() => openAddCustomer(true)}
                canEditCompany={isSuperAdmin(me)}
                me={{ engineer_id: me?.engineer_id ?? null, permission_level: me?.permission_level ?? null }}
                focusSiteId={timelineFocusSiteId}
                focusKey={timelineFocusKey}
                onFocused={() => setTimelineFocusKey(null)}
              />
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_MUTED, fontSize: 13, background: '#fff', border: '1px solid #ebebeb', borderRadius: R.control }}>
                왼쪽에서 회사나 사업장을 고르세요
              </div>
            )}
          </div>
        </div>
      ) : (
      <div
        className="home-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '360px 1fr',
          gap: 12,
          alignItems: 'stretch',
          flex: 1,
          minHeight: 0,
        }}
      >
<div className={mobileTab === 'map' ? 'mobile-hide' : ''} style={{ minHeight: 0, minWidth: 0, height: '100%', overflow: 'hidden' }}>
          <Sidebar
            query={query}
            setQuery={setQuery}
            customers={filteredCustomers}
            deviceMap={deviceMap}
            onMove={(customer) => setFocusedCustomerId(Number(customer.customer_id))}
            onDetailClick={saveHomeState}
            listScrollRef={listScrollRef}
            onScrollSave={saveHomeState}
            isLoading={isLoading}
          />
          </div>

         <div style={{
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
}}>
         <MapView
  customers={filteredCustomers}
  deviceMap={deviceMap}
  focusedCustomerId={focusedCustomerId}
  selectedStatuses={selectedStatuses}
toggleStatus={toggleStatus}
selectedCategories={selectedCategories}
toggleCategory={toggleCategory}
  restoredMapCenter={mapCenter}
  restoredMapLevel={mapLevel}
  restoredOpenOverlayCustomerId={openOverlayCustomerId}
  onMapStateChange={(center, level) => {
    setMapCenter(center)
    setMapLevel(level)
  }}
  onOpenOverlayChange={setOpenOverlayCustomerId}
/>
</div>
        </div>
      )}

        {isAddCustomerModalOpen && (
        <AddCustomerModal
          key={addPresetCompanyId ?? 'new'}
          presetCompanyId={addPresetCompanyId}
          onClose={() => setIsAddCustomerModalOpen(false)}
          onError={msg => toast.error(msg)}
          onSaved={async message => {
            setIsAddCustomerModalOpen(false)
            setQuery('')
            invalidateParents()
            const list = await loadParents()
            setCompanies(list)
            await fetchData()
            toast.success(message)
          }}
        />
        )}
      </div>
    </>
  )
}