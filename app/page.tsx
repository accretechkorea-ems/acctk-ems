//app/page.tsx

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// 모바일 상단 바 높이 — 화면 높이를 계산하는 곳은 이 상수 하나를 본다(PC 는 상단 바가 없다).
import Sidebar from '@/components/home/Sidebar'
import MapView from '@/components/home/MapView'
import AddCustomerModal from '@/components/home/AddCustomerModal'
import { useHomeData } from '@/hooks/useHomeData'
import { CATEGORY_OPTIONS } from '@/lib/constants'
import { AGENCY_SEARCH_PLACEHOLDER, COMPANY_SEARCH_PLACEHOLDER, matchesCompany } from '@/lib/companySearch'
import { useAgencies } from '@/lib/customerAgency'
import { REGION_FILTER_OPTIONS } from '@/lib/region'
import ExportModal from '@/components/home/ExportModal'
import { UNIT_LABEL, type ExportUnit } from '@/lib/customerExportSheets'
import { DIRECT_SALE } from '@/lib/customerList'
import PanelHeader, { type HomeView } from '@/components/home/PanelHeader'
import SidePanel, { PANEL_SPACE } from '@/components/home/SidePanel'
import ListTabs from '@/components/home/list/ListTabs'
import CustomerFilterModal from '@/components/home/CustomerFilterModal'
import { customerFilterChips, defaultFilter, type FilterOptions } from '@/lib/customerFilterChips'
import { customerChange } from '@/lib/customerChange'
import { customerDelete } from '@/lib/customerDelete.client'
import { EMPTY_COUNTS, type DeleteCounts, type DeleteTarget } from '@/lib/customerDelete'
import DeleteCustomerModal from '@/components/home/list/DeleteCustomerModal'
import CustomerListPanel, { type ListTab } from '@/components/home/list/CustomerListPanel'
import CompanyPane from '@/components/home/list/CompanyPane'
import AgencyPane from '@/components/home/list/AgencyPane'
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
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { isSuperAdmin } from '@/lib/permissions'


import {
  HOME_STATE_KEY,
  PAGE_BG,
  TEXT_MUTED,
  type Customer,
  type Device,
} from '@/lib/home'
import { R } from '@/lib/radius'
import type { KakaoWindow } from '@/lib/loadKakaoMap'






export default function HomePage() {
  const { engineer: me, loading: guardLoading, authorized } = usePageGuard()
  // 엑셀 내보내기는 관리자만 — 팀 관리·목표 관리 버튼과 같은 판정(permission_level).
  const canExportExcel = isSuperAdmin(me)
  /** 숨긴 줄을 되살리는 사람 — 관리 메뉴(+슈퍼관리자). 라우트와 같은 판정이다. */
  const toast = useToast()

  const listScrollRef = useRef<HTMLDivElement | null>(null)
  const restoredHomeStateRef = useRef(false)
  const pendingListScrollTopRef = useRef<number | null>(null)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deviceMap, setDeviceMap] = useState<Map<number, Device[]>>(new Map())
  const [focusedCustomerId, setFocusedCustomerId] = useState<number | null>(null)
  const [latestServiceDateMap, setLatestServiceDateMap] = useState<Map<number, number>>(new Map())
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null)
  /**
   * 지도로 **돌아올 때마다** 1씩 는다. 지도는 이 값이 바뀌면 보던 자리를 다시 맞춘다
   * (목록에서 보던 사업장·회사가 있으면 그쪽으로, 없으면 전국 보기).
   */
  const [mapReturnNonce, setMapReturnNonce] = useState(0)
  const [mapLevel, setMapLevel] = useState<number | null>(null)
  const [openOverlayCustomerId, setOpenOverlayCustomerId] = useState<number | null>(null)
  const [mobileTab, setMobileTab] = useState<'list' | 'map'>('list')
  /**
   * 좁은 화면인가(≤768). 폰에서 「업체 목록」 탭일 때 **지도를 그리지 않으려고** 쓴다 —
   * 전에는 목록 뒤에 지도가 깔린 채였다(보이지 않는 지도가 타일을 받고 손짓도 먹었다).
   * 서버에서는 false 로 시작한다(첫 그림이 PC 와 같아야 수화가 어긋나지 않는다).
   */
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const sync = () => setNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
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
  /** 「삭제 요청」 창이 열린 회사. 지울 수 없는 사람이 지워 달라고 할 때 뜬다. */
  /** 이미 요청이 들어온 회사들 — 정리 필요 탭이 「삭제 요청됨」을 붙인다. */
  /** 지우기 창 — 무엇을 지우려는가(없으면 닫혀 있다). */
  const [deleteTarget, setDeleteTarget] = useState<{ target: DeleteTarget; id: number; name: string } | null>(null)
  const [deleteCounts, setDeleteCounts] = useState<DeleteCounts | null>(null)
  const [deleting, setDeleting] = useState(false)
  /** 「삭제됨」 소탭의 줄 — 숨긴 사업장·회사다. */
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null)
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null)
  /**
   * 고른 대리점 — 우측 pane 에 **대리점 화면**이 선다(2026-11-21).
   * 회사·사업장과 같은 자리를 쓰므로 서로 비운다(한 번에 한 화면이다).
   */
  const [selectedAgencyId, setSelectedAgencyId] = useState<number | null>(null)
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
  /**
   * **들어온 곳**(?origin=) — ← 가 어디로 돌아갈지(2026-11-28, 야간4 7-2).
   *   'map'      지도 보기로. 보던 자리는 화면이 기억하고 있다.
   *   '/…'       그 주소로 나간다(견적·칸반 등 다른 메뉴).
   *   null       왔던 화면(회사 pane)으로 — 종전 그대로다.
   * 한 번 쓰면 비운다 — 두 번째 ← 는 평소처럼 회사 pane 으로 올라간다.
   */
  const [origin, setOrigin] = useState<string | null>(null)
  /**
   * ?contact=<id> — 열자마자 **그 담당자 수정 창**을 연다(2026-11-25).
   * 견적 저장 창의 「수신인에 이메일이 없습니다 — 담당자 정보에서 추가」가 보낸 길이다.
   * 단독 상세 페이지가 받던 일을 2026-11-28(야간4 7-1)부터 이 화면이 받는다.
   * 한 번 열고 비운다 — 창을 닫았다가 다른 사업장을 열 때 또 뜨면 안 된다.
   */
  const [openContactId, setOpenContactId] = useState<number | null>(null)
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
  // 지도와 목록은 **같은 필터 상태**를 쓴다(listFilter). 전에는 지도가 selectedStatuses·
  // selectedCategories 를 따로 들고 있어, 지도에서 켠 조건이 목록으로 넘어가지 않았다.

  const [isAddCustomerModalOpen, setIsAddCustomerModalOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  /** 엑셀 단위 고르는 창. */
  const [exportOpen, setExportOpen] = useState(false)
  /** 단위별 예상 줄 수 — 창이 열릴 때 서버에서 한 번 받는다. */
  const [exportCounts, setExportCounts] = useState<Record<ExportUnit, number> | null>(null)

  const { fetchData } = useHomeData({
  setCustomers,
  setDeviceMap,
  setLatestServiceDateMap,
  setLastTouchMap,
})

  /**
   * **고객사 데이터 다시 읽기 — 이 화면의 한 길**(2026-11-23).
   *
   * 전에는 저장 경로마다 제각각이었다. 어디는 fetchData 만, 어디는 회사 목록만, 사업장
   * 상세(가운데 pane)는 **자기 자리만** 다시 읽었다. 그래서 사업장명·대리점·상태·담당자·
   * 장비를 고쳐도 좌측 트리·지도 카드·건수 배지는 새로고침 전까지 옛 값이었다.
   *
   * 이제 저장한 쪽은 이 함수 하나만 부른다. 읽는 것은 셋이다.
   *   ① 회사 목록 캐시(ParentPicker) — 회사 이름·분류가 여기 산다
   *   ② 업체·장비·최근 활동(useHomeData) — 좌측 트리·지도·건수 배지가 이것을 본다
   *   ③ 고른 사업장/회사 pane 은 자기 자료를 따로 들고 있다(fetchDetail) — 그쪽은 그대로 둔다
   */
  const refreshCustomers = useCallback(async () => {
    invalidateParents()
    const [list] = await Promise.all([loadParents(), fetchData()])
    setCompanies(list)
  }, [fetchData])

  /**
   * **낙관적 반영** — 다시 읽기를 기다리지 않고 화면의 줄을 먼저 고친다.
   *
   * 다시 읽기는 네 표를 읽어 300ms 안팎이 걸린다. 그동안 방금 바꾼 값이 옛 값으로 남아
   * 있으면 「저장이 안 됐나」가 된다. 그래서 **아는 칸만** 먼저 고쳐 두고 곧 재조회가 덮는다.
   * 모르는 칸(이름 재생성·좌표 등)은 손대지 않는다 — 틀린 값을 잠깐 보여 주는 것이 더 나쁘다.
   */
  const patchCustomersLocally = useCallback((ids: number[], patch: Partial<Customer>) => {
    const want = new Set(ids.map(Number))
    setCustomers(prev => prev.map(c => (want.has(Number(c.customer_id)) ? { ...c, ...patch } : c)))
  }, [])

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
    /**
     * 사업장 화면의 회사명을 눌러 들어온 길(`?company=`) — 목록 보기로 서면서 **그 회사가
     * 골라진 채** 열린다(components/customer/CompanyLink.tsx).
     *
     * `site` 와 달리 주소에서 털지 않는다 — 새로고침해도 그 회사가 그대로 열려야 한다.
     * 아래 replaceState 효과가 고른 회사와 이 값을 맞춰 둔다.
     */
    const company = Number(q.get('company'))
    /** 대리점 화면 — 회사와 같은 방식이다(?view=list&agency=ID). */
    const ag = Number(q.get('agency'))
    // 둘은 배타다. 주소에 둘이 함께 들어 있으면(옛 주소·손으로 적은 주소) **대리점을** 받는다.
    if (Number.isInteger(ag) && ag > 0) {
      setView('list')
      setListTab('agency')
      setSelectedAgencyId(ag)
      setSelectedCompanyId(null)
      setSelectedSiteId(null)
    } else if (Number.isInteger(company) && company > 0) {
      setView('list')
      setListTab('company')
      setSelectedCompanyId(company)
      setSelectedSiteId(null)
      setExpanded(prev => new Set(prev).add(company))
    }
    // 활동 현황에서 넘어온 길 — 그 사업장의 **회사**를 펴고 칩을 켠 뒤 그 줄로 내려간다.
    const site = Number(q.get('site'))
    if (Number.isInteger(site) && site > 0) {
      setView('list')
      setPendingFocusSiteId(site)
      setTimelineFocusSiteId(site)
      setTimelineFocusKey(q.get('focus'))
    }
    const o = (q.get('origin') ?? '').trim()
    if (o === 'map' || o.startsWith('/')) setOrigin(o)
    const contact = Number(q.get('contact'))
    if (Number.isInteger(contact) && contact > 0) setOpenContactId(contact)
  }, [])

  /**
   * 사업장 번호로 회사를 찾는 일은 목록 자료가 들어온 뒤에야 된다.
   *
   * 2026-11-28(야간4 7-2)부터 **그 사업장까지 연다**. 전에는 회사만 펴고 골라, 지도
   * 핀이나 견적에서 들어오면 회사 화면이 떴다 — 보려던 사업장은 트리 어딘가에 있고
   * 사람이 다시 찾아 눌러야 했다(871줄 가운데 하나다).
   *
   * 회사를 못 찾는 줄(미연결)도 **사업장은 연다** — 트리에서는 「미연결」 묶음에 선다.
   */
  useEffect(() => {
    if (pendingFocusSiteId == null || customers.length === 0) return
    const site = customers.find(c => c.customer_id === pendingFocusSiteId)
    if (site) {
      const parent = site.parent_customer_id ?? null
      if (parent != null) {
        setSelectedCompanyId(parent)
        setExpanded(prev => new Set(prev).add(parent))
      }
      setSelectedSiteId(pendingFocusSiteId)
    }
    setPendingFocusSiteId(null)
  }, [pendingFocusSiteId, customers])

  /**
   * **고른 줄을 패널 가운데로** (2026-11-28, 야간4 7-2).
   *
   * 트리가 길어(871줄) 고른 줄이 화면 밖에 있는 일이 잦다. 파랗게 칠해 두어도 보이지
   * 않으면 칠한 뜻이 없다. 줄이 바뀔 때마다 **한 번** 데려온다 — 사람이 그 뒤에 손으로
   * 굴린 자리는 건드리지 않는다.
   */
  useEffect(() => {
    if (selectedSiteId == null) return
    const t = window.setTimeout(() => {
      const row = document.querySelector('[data-site-row="on"]')
      row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 180)
    return () => window.clearTimeout(t)
  }, [selectedSiteId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (view === 'list') url.searchParams.set('view', 'list')
    else url.searchParams.delete('view')
    /**
     * 고른 것은 주소에 남긴다 — 새로고침해도 그 화면이 열린 채다(목록 보기의 주소다).
     * 회사와 대리점은 배타이므로 **둘 중 하나만** 쓴다. 상태가 어쩌다 둘 다 들어 있어도
     * 주소에는 하나만 남게 해 둔다(새로고침이 다시 한쪽으로 모아 준다).
     */
    url.searchParams.delete('company')
    url.searchParams.delete('agency')
    if (view === 'list' && selectedAgencyId != null) url.searchParams.set('agency', String(selectedAgencyId))
    else if (view === 'list' && selectedCompanyId != null) url.searchParams.set('company', String(selectedCompanyId))
    // 찾아가기 값은 한 번 쓰고 주소에서 턴다 — 새로고침·뒤로가기에 다시 뜨지 않게.
    if (timelineFocusKey == null) { url.searchParams.delete('site'); url.searchParams.delete('focus') }
    if (url.toString() !== window.location.href) window.history.replaceState(null, '', url.toString())
  }, [view, timelineFocusKey, selectedCompanyId, selectedAgencyId])

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

  /**
   * 회사 줄(is_parent) — 목록 보기의 트리가 쓰고, **검색이 영문명을 보려면** 카드·지도에서도 필요하다
   * (영문명은 회사 줄에만 있다, 2026-11-23). 그렇다고 홈에 들어오기만 해도 읽으면 조회가 한 벌 는다.
   * 그래서 **글자를 적기 시작할 때** 읽는다 — 캐시를 공유하므로 조회는 그래도 한 번이다.
   */
  const needParents = view === 'list' || query.trim() !== ''
  useEffect(() => {
    if (!needParents) return
    let cancelled = false
    loadParents().then(list => { if (!cancelled) setCompanies(list) })
    return () => { cancelled = true }
  }, [needParents])

  useEffect(() => {
    if (customers.length > 0) setIsLoading(false)
  }, [customers])

  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 6000)
    return () => clearTimeout(t)
  }, [])


  /**
   * **구르는 통이 어디인가** (2026-11-28, 야간4 5-3).
   *
   * 넓은 화면 — 목록 통(.customer-list-scroll)이 스스로 구른다.
   * 폰        — 그 통을 풀어 **페이지(body)가 구른다**(5-2). 그래서 통의 scrollTop 은
   *             늘 0 이고, 돌아왔을 때 되살릴 값이 없었다 — 목록 꼭대기로 떨어졌다.
   *
   * 둘 중 **실제로 구르고 있는 쪽**을 읽고 쓴다.
   */
  const listScrolls = () => {
    const el = listScrollRef.current
    return !!el && el.scrollHeight > el.clientHeight + 2
  }
  const readListScroll = (): number => {
    if (listScrolls()) return listScrollRef.current?.scrollTop ?? 0
    return typeof window === 'undefined' ? 0 : Math.round(window.scrollY)
  }
  /** 세션에 적혀 있는 목록 자리. 없으면 0 이다. */
  const readSavedListScroll = (): number => {
    if (typeof window === 'undefined') return 0
    try {
      const raw = sessionStorage.getItem(HOME_STATE_KEY)
      const v = raw ? Number(JSON.parse(raw)?.listScrollTop) : 0
      return Number.isFinite(v) && v > 0 ? v : 0
    } catch { return 0 }
  }
  const writeListScroll = (top: number) => {
    if (listScrolls()) { if (listScrollRef.current) listScrollRef.current.scrollTop = top; return }
    if (typeof window !== 'undefined') window.scrollTo(0, top)
  }

  const saveHomeState = () => {
    if (typeof window === 'undefined') return

   const payload = {
  query,
  listFilter,
  listSort,
  view,
  /**
   * 목록 자리 — **상세를 보고 있는 동안에는 덮어쓰지 않는다**(2026-11-28, 야간4 5-3).
   * 폰에서 상세를 열면 좌 패널이 숨어 페이지가 접히고 스크롤이 0 으로 떨어진다. 그 0 을
   * 적어 버리면 돌아왔을 때 꼭대기로 간다 — 적혀 있던 자리를 그대로 둔다.
   */
  listScrollTop: selectedSiteId != null ? readSavedListScroll() : readListScroll(),
  mapCenter,
  mapLevel,
  openOverlayCustomerId,
}

    sessionStorage.setItem(HOME_STATE_KEY, JSON.stringify(payload))
  }

  /**
   * **떠나기 직전에 한 번 더 적는다** (2026-11-28, 야간4 5-3).
   *
   * 평소 저장은 상태가 바뀔 때 일어난다. 그런데 **구르는 일은 상태를 바꾸지 않는다** —
   * 폰에서 목록을 한참 내린 뒤 「사업장 상세 ›」를 누르면, 적혀 있는 자리는 **마지막으로
   * 무언가를 고쳤을 때**의 것이다(대개 0). 돌아오면 꼭대기로 떨어졌다.
   *
   * pagehide 는 뒤로 가기 캐시(bfcache)로 들어갈 때도 불린다 — beforeunload 보다 믿을 만하다.
   */
  const saveRef = useRef(saveHomeState)
  saveRef.current = saveHomeState
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onLeave = () => { saveRef.current() }
    window.addEventListener('pagehide', onLeave)
    return () => window.removeEventListener('pagehide', onLeave)
  }, [])

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


      // 필터는 통째로 저장한다 — 칸이 늘 때마다 복원 코드를 더하지 않게.
      // 모양이 어긋난 저장본은 **버리고 기본값을 쓴다**(옛 저장본이 들어 있어도 화면이 선다).
      if (parsed.listFilter && typeof parsed.listFilter === 'object'
        && Array.isArray(parsed.listFilter.statuses) && Array.isArray(parsed.listFilter.categories)) {
        setListFilter({ ...EMPTY_FILTER, ...parsed.listFilter, query: '' })
      }
      if (parsed.listSort === 'touch' || parsed.listSort === 'name') setListSort(parsed.listSort)

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
}, [view, query, listFilter, listSort, mapCenter, mapLevel, openOverlayCustomerId])








  /**
   * 회사 줄(껍데기)의 이름·영문명. 카드 보기의 검색이 **영문명으로도** 걸리려면 여기가 필요하다 —
   * 사업장 줄에는 영문명이 없다(회사 줄에만 있다). 목록 보기의 트리도 같은 맵을 받는다.
   */
  const companyMap = useMemo(
    () => new Map(companies.map(c => [c.customer_id, { company_name: c.company_name, industry: c.industry, name_en: c.name_en, note: c.note }])),
    [companies],
  )

  /**
   * 회사별 **사업장 수** — 거르기 **전** 전체에서 센다(2026-11-28, 야간4 6-1).
   * 지도 팝업이 「회사 보기」를 낼지 가리는 데 쓴다. 거른 목록으로 세면 화면 필터로
   * 한 곳만 남은 회사에서 단추가 사라진다 — 그 회사에는 여전히 사업장이 여럿이다.
   */
  const siteCountByCompany = useMemo(() => {
    const m = new Map<number, number>()
    for (const c of customers) {
      const pid = Number(c.parent_customer_id ?? 0)
      if (!Number.isInteger(pid) || pid <= 0) continue
      m.set(pid, (m.get(pid) ?? 0) + 1)
    }
    return m
  }, [customers])

  const filteredCustomers = useMemo(() => {
    const q = query.trim().toLowerCase()

    const filtered = customers.filter((c) => {
      const statusMatched =
        listFilter.statuses.length === 0 ? false : listFilter.statuses.includes(c.status ?? '')

      if (!statusMatched) return false
      const devices = deviceMap.get(Number(c.customer_id)) || []
      const cats = devices.map((d) => d.category).filter((cat): cat is string => Boolean(cat))
      const hasFilterable = cats.some((cat) =>
        (CATEGORY_OPTIONS as readonly string[]).includes(cat)
      )

      const categoryMatched =
        listFilter.categories.length === 0 ? false :
        !hasFilterable ? true :
        cats.some((cat) => listFilter.categories.includes(cat))

      if (!categoryMatched) return false

      if (!q) return true

      // 찾는 칸은 **공용 함수 하나**가 본다(lib/companySearch.ts) — 회사명 · 영문명 · 사업장명.
      // 2026-11-27(묶음4 D) — 주소·대리점명·상태·장비 줄을 **뺐다**. 지도 보기의 검색칸은
      // 목록 보기의 회사 탭과 **같은 것**을 본다(둘이 다르면 같은 글자에 다른 수가 나온다).
      // 지역·분류·상태는 칩이 가르는 자리라, 검색까지 그것을 보면 이름으로 찾을 수 없다.
      const parent = c.parent_customer_id != null ? companyMap.get(c.parent_customer_id) : undefined
      return matchesCompany(
        { company_name: c.company_name, name_en: parent?.name_en ?? null, site_name: c.site_name },
        query,
      )
    })

    /**
     * 「최근 활동순」 — **활동만** 본다(lib/customerLastTouch.ts 가 정본이다, 2026-11-22).
     *
     * 전에는 **장비 납입일**과 customer_id 를 접점과 섞어 가장 큰 값으로 세웠다. 그래서
     * 장비를 새로 넣거나 납입일을 고치면 활동이 없는 업체가 위로 올라왔고, 날짜가 하나도
     * 없는 업체끼리는 나중에 등록한 순(customer_id)으로 섰다 — 둘 다 활동이 아니다.
     * 이제 활동이 없는 업체는 **맨 아래**, 그 안에서는 이름순이다(목록 보기와 같은 규칙).
     */
    return [...filtered].sort((a, b) => {
      const at = latestServiceDateMap.get(a.customer_id) ?? 0
      const bt = latestServiceDateMap.get(b.customer_id) ?? 0
      if (at !== bt) return bt - at
      return (a.company_name || '').localeCompare(b.company_name || '', 'ko')
    })
  }, [customers, query, listFilter, deviceMap, latestServiceDateMap, companyMap])

  // ── 목록 보기의 트리 ─────────────────────────────────────────────────────
  //   좌 패널의 건수와 우측 표의 줄은 **같은 셈법**을 써야 한다 — 그 셈법은
  //   lib/customerList.ts 에 있고, 여기서는 재료만 모아 넘긴다.
  const today = todayKST()
  /**
   * ── 우측 pane 에 무엇을 띄울지 **한 자리에서** 정한다 ───────────────────
   *
   * 회사와 대리점은 **서로 배타**다. 전에는 대리점을 고른 뒤 회사를 고르면
   * selectedAgencyId 가 그대로 남아, pane 판정이 대리점을 먼저 보기 때문에 화면이
   * 바뀌지 않았다(2026-11-21 버그). 주소에도 company 와 agency 가 함께 남았다.
   *
   * 사업장은 그 **위에 얹히는 층**이다 — 어디서 들어왔는지(회사·대리점)를 그대로 둬야
   * ← 가 그 자리로 돌아간다(5차에서 정한 동작). 그래서 사업장을 열 때는 뒤에 있는
   * 선택을 건드리지 않는다. 트리에서 사업장을 고를 때만 그 사업장의 회사로 갈아 끼운다.
   */
  const openCompany = (id: number | null) => {
    setSelectedAgencyId(null)
    setSelectedSiteId(null)
    setSelectedCompanyId(id)
    setTimelineFocusSiteId(null)
  }
  const openAgency = (id: number | null) => {
    setSelectedCompanyId(null)
    setSelectedSiteId(null)
    setSelectedAgencyId(id)
  }
  /** 트리에서 사업장을 고를 때 — 그 사업장의 회사가 뒤에 선다. */
  const openSiteUnderCompany = (companyId: number, siteId: number) => {
    setSelectedAgencyId(null)
    setSelectedCompanyId(companyId)
    setSelectedSiteId(siteId)
  }
  /** 이미 선 화면(회사·대리점) 안에서 사업장을 열 때 — 뒤는 그대로 둔다. */
  const openSite = (siteId: number) => setSelectedSiteId(siteId)

  /** 고른 대리점 줄 — 우측 pane 의 대리점 화면이 쓴다. */
  const selectedAgency = useMemo(
    () => agencyList.find(a => a.customer_id === selectedAgencyId) ?? null,
    [agencyList, selectedAgencyId],
  )
  /**
   * 폰에서 pane 이 폭을 다 쓰는 때 — 회사·사업장·대리점 중 하나를 고른 상태다.
   * 회사는 **고른 번호**로 본다(트리 묶음 selectedGroup 은 필터·검색에 따라 없어질 수
   * 있는데, 그때 pane 은 「왼쪽에서 고르세요」를 띄우므로 폭을 다 쓸 이유가 없다).
   */
  const detailOpen = selectedSiteId != null || selectedAgencyId != null || selectedCompanyId != null
  /**
    * 트리에 넘기는 사업장 — 목록 조회가 준 것 그대로다.
    *
    * 전에는 대리점 탭에서 고른 대리점의 사업장만 걸러 넘겼다(옛 agencyFilterId).
    * 그 길은 2026-11-21에 걷었다 — 대리점을 누르면 **대리점 화면**이 열리고,
    * 대리점으로 거르는 일은 필터 모달의 「대리점」 조건이 맡는다(listFilter.agencies).
    */
  const treeCustomers = customers

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

  // ── 필터 ─────────────────────────────────────────────────────────────────
  //   지도·목록이 **한 상태**를 본다. 고르는 자리는 모달 하나다
  //   (components/home/CustomerFilterModal.tsx).
  const [filterOpen, setFilterOpen] = useState(false)
  const filterOptions = useMemo<FilterOptions>(() => ({
    statuses: ['활성', '잠재', '이탈'],
    categories: CATEGORY_OPTIONS,
    regions: REGION_FILTER_OPTIONS,
    agencies: [
      { id: DIRECT_SALE, name: 'ACCT-K' },
      ...agencyList.map(a => ({ id: a.customer_id, name: a.company_name })),
    ],
  }), [agencyList])
  const filterChips = useMemo(
    () => customerFilterChips(listFilter, filterOptions),
    [listFilter, filterOptions],
  )

  /**
   * 모달 안의 「조건 일치 N곳」. 보고 있는 화면의 셈법을 그대로 쓴다 —
   * 목록이면 사업장 수, 지도면 지도에 설 업체 수다.
   */
  const countFor = (next: ListFilter): number => {
    if (view === 'list') {
      return buildCompanyTree({
        customers: treeCustomers,
        companies: companyMap,
        deviceCount: id => (deviceMap.get(id) ?? []).length,
        deviceCategories: id => (deviceMap.get(id) ?? []).map(d => d.category).filter((x): x is string => !!x),
        openQuotes: id => openQuotes.get(id) ?? 0,
        touchOf: id => lastTouchMap.get(id) ?? null,
        today,
        filter: { ...next, query },
        allCategories: CATEGORY_OPTIONS,
        sort: listSort,
      }).siteCount
    }
    return customers.filter(c => {
      if (next.statuses.length === 0 || !next.statuses.includes(c.status ?? '')) return false
      const devices = deviceMap.get(Number(c.customer_id)) || []
      const cats = devices.map(d => d.category).filter((x): x is string => Boolean(x))
      const known = cats.filter(x => (CATEGORY_OPTIONS as readonly string[]).includes(x))
      if (next.categories.length === 0) return false
      if (known.length > 0 && !known.some(x => next.categories.includes(x))) return false
      return true
    }).length
  }

  // 「정리 필요」 네 묶음을 만들던 셈 — **탭과 함께 걷었다**(2026-11-27, 묶음6 4-1).
  // 그 목록이 보여 주던 넷(분류 없는 회사·이름 중복 의심·사업장명 입력 필요·사업장 0곳)은
  // 「고치라고 재촉하는 목록」이었는데 고치는 길이 그 안에 없어, 결국 회사를 하나씩 열어야
  // 했다. 다시 둘 때는 **그 자리에서 고치는 길**과 함께 두어야 한다.

  /** 대리점 하나가 몇 곳에 붙어 있나(대리점 탭의 오른쪽 수). */
  const agencySiteCount = useCallback(
    (agencyId: number) => customers.filter(c => c.agency_customer_id === agencyId).length,
    [customers],
  )

  /** 회사 여럿의 분류를 한 번에 지정한다(3a). */
  const bulkIndustry = async (value: string) => {
    const ids = [...checkedCompanies]
    if (ids.length === 0 || !value) return
    // 라우트가 저장하고 사건도 함께 적는다(2026-11-23).
    const r = await customerChange({ action: 'company-industry', ids, industry: value })
    if (!r.ok) { toast.error(r.error); return }
    // 먼저 화면을 고치고(낙관적), 곧 다시 읽어 덮는다.
    patchCustomersLocally(ids, { industry: value } as Partial<Customer>)
    setCheckedCompanies(new Set())
    void refreshCustomers()
    toast.success(`회사 ${ids.length}곳의 분류를 「${value}」 로 바꿨습니다`)
  }


  // 「삭제 요청」은 **걷었다**(2026-11-27, 묶음6 4-3) — 미처리 요청 0건을 확인하고 걷었다.
  // 지우기 문턱이 「고객사를 보는 사람 전부」로 내려간 뒤(2026-11-25) 요청할 까닭이 없다.
  // 라우트(/api/customer-delete 의 request·list-requests)와 지난 사건은 **그대로** 남는다.



  /**
   * 사업장 0곳 회사를 지운다(정리 필요 탭) — **숨기기다**(deleted_at).
   * 창이 연결 기록 수와 까닭을 받는다. 라우트가 지우기 직전에 사업장 수를 다시 센다.
   */
  const deleteEmptyCompany = (companyId: number, companyName: string) => {
    setDeleteTarget({ target: 'company', id: companyId, name: companyName })
  }

  /** 창이 뜨면 연결 기록을 센다 — 무엇이 함께 숨는지 보여 주려고. */
  useEffect(() => {
    if (!deleteTarget) { setDeleteCounts(null); return }
    let cancelled = false
    void (async () => {
      const r = await customerDelete({ action: 'counts', target: deleteTarget.target, id: deleteTarget.id })
      if (cancelled) return
      setDeleteCounts(r.ok ? (r.data.counts as DeleteCounts) : EMPTY_COUNTS)
    })()
    return () => { cancelled = true }
  }, [deleteTarget])

  /** 창의 「삭제」 — 한 문장으로 숨기고 사건을 남긴다. */
  const runDelete = async (reason: string) => {
    if (!deleteTarget) return
    setDeleting(true)
    const r = await customerDelete({
      action: 'delete', target: deleteTarget.target, id: deleteTarget.id, reason,
      counts: deleteCounts ?? undefined,
    })
    setDeleting(false)
    if (!r.ok) { toast.error(r.error); return }
    const { id, name } = deleteTarget
    setDeleteTarget(null)
    if (selectedCompanyId === id) { setSelectedCompanyId(null); setSelectedSiteId(null) }
    void refreshCustomers()
    toast.success(`${name} 을(를) 숨겼습니다`)
  }



  // 지워진 회사 목록은 **관리 메뉴의 임시 카드**가 읽는다(묶음6 4-4) — 여기서는 안 읽는다.

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
   * 엑셀 내보내기 — **창을 먼저 연다**(components/home/ExportModal.tsx).
   *
   * 전에는 단추를 누르면 바로 네 시트짜리 파일이 내려왔다. 받는 사람은 그 중 한 장만
   * 쓰는데 나머지가 늘 따라왔다. 이제 창에서 **단위**(회사·사업장·사업장×장비·대리점)와
   * 담당자 열 포함 여부를 고르고, 그 시트 하나만 받는다.
   *
   * 범위는 **화면이 거른 목록 그대로**다 — 사업장 id 를 순서까지 그대로 보낸다.
   * 서버에서 필터를 다시 구현하면 화면과 다른 줄이 나오는 날이 온다.
   */
  /** 내보낼 사업장 id — 목록 보기 트리의 사업장(화면의 「조건 일치 N곳」과 같은 수). */
  const exportSiteIds = useMemo(
    () => listTree.groups.flatMap(g => g.sites.map(s => Number(s.customer.customer_id))),
    [listTree],
  )

  const openExport = () => {
    if (exportSiteIds.length === 0) { toast.error('내보낼 고객사가 없습니다'); return }
    setExportCounts(null)
    setExportOpen(true)
    // 「예상 N줄」 — **파일과 같은 함수**로 센 값을 서버에서 받는다(창이 따로 세지 않는다).
    void (async () => {
      try {
        const res = await fetch('/api/customer-export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteIds: exportSiteIds, estimate: true }),
        })
        if (!res.ok) return
        const json = await res.json()
        if (json?.counts) setExportCounts(json.counts as Record<ExportUnit, number>)
      } catch (e) {
        console.warn('예상 줄 수를 세지 못했습니다:', e)
      }
    })()
  }

  const runExport = async (unit: ExportUnit, withContacts: boolean) => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const res = await fetch('/api/customer-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteIds: exportSiteIds, unit, contacts: withContacts }),
      })
      if (!res.ok) {
        const msg = await res.json().catch(() => null)
        toast.error(msg?.error ?? '엑셀을 만들지 못했습니다')
        return
      }
      const counts = (() => {
        try { return JSON.parse(res.headers.get('X-Export-Counts') ?? '{}') } catch { return {} }
      })() as { unit?: string; lines?: number; cols?: number }
      const blob = await res.blob()
      // 파일 이름은 서버가 Content-Disposition 에 담아 보낸다(한글이라 filename* 쪽을 읽는다).
      const cd = res.headers.get('Content-Disposition') ?? ''
      const star = /filename\*=UTF-8''([^;]+)/.exec(cd)
      const name = star ? decodeURIComponent(star[1]) : '고객사.xlsx'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      setExportOpen(false)
      toast.success(`${UNIT_LABEL[unit]} ${(counts.lines ?? 0).toLocaleString('ko-KR')}줄을 내려받았습니다`)
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
    // 폰에서는 통이 구르지 않고 **페이지**가 구른다 — 통이 없어도 멈추지 않는다.
    writeListScroll(targetScrollTop)

    // 실제로 적용됐는지 확인
    if (Math.abs(readListScroll() - targetScrollTop) < 5 || retry > 15) {
      clearInterval(interval)
    }

    retry++
  }, 50)

  return () => clearInterval(interval)
  // readListScroll·writeListScroll 은 렌더마다 새로 만들어지지만 **ref 만 본다** —
  // 목록에 더해 두면 이 효과가 렌더마다 다시 걸려 되살리는 중에 스스로를 끊는다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [filteredCustomers])

  const panelHeader = (
    <PanelHeader
      view={view}
      setView={next => { if (next === 'map') setMapReturnNonce(n => n + 1); setView(next) }}
      query={query}
      setQuery={setQuery}
      count={view === 'list' ? listTree.siteCount : filteredCustomers.length}
      loading={isLoading}
      filterCount={filterChips.length}
      chips={filterChips}
      onOpenFilter={() => setFilterOpen(true)}
      onDropChip={c => setListFilter(prev => c.drop(prev))}
      onClearChips={() => setListFilter(prev => defaultFilter(filterOptions, prev))}
      sort={view === 'list' ? listSort : undefined}
      setSort={view === 'list' ? setListSort : undefined}
      bordered={false}
      /* 탭마다 보는 칸이 다르다 — 안내 글도 따라간다(2026-11-27, 묶음4 D).
         지도 보기는 회사 탭과 **같은 것**을 본다. */
      searchPlaceholder={view === 'list' && listTab === 'agency' ? AGENCY_SEARCH_PLACEHOLDER : COMPANY_SEARCH_PLACEHOLDER}
      tabs={view === 'list' ? (
        <ListTabs
          tab={listTab}
          setTab={setListTab}
          counts={{
            company: listTree.groups.length,
            agency: agencyCount,
          }}
          onExport={openExport}
          canExport={canExportExcel}
          exporting={isExporting}
          onAdd={() => openAddCustomer()}
        />
      ) : undefined}
    />
  )

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
          // **두 보기가 같은 여백**이다 — 0. 좌 패널의 자리는 SidePanel 혼자 정하고
          // (좌 16 · 위아래 16), 목록 보기의 우측 본문은 제 여백을 따로 갖는다.
          // 보기마다 다른 padding 을 주던 때는 세그먼트를 누를 때 패널이 20px 씩 움직였다.
          padding: 0,
          // 높이는 .home-wrapper 규칙이 정한다 — PC 는 상단 바가 없고 모바일만 그만큼 뺀다.
          // 100vh 가 아니라 **100dvh** 다(2026-11-26) — iOS 의 vh 는 툴바를 **접은** 높이라
          // 툴바가 보일 때 판이 화면보다 그만큼 길어지고, 그 길이만큼 아래에 빈 자리가 남는다.
          height: '100dvh',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          background: PAGE_BG,
          overflow: 'hidden',
        }}
        // 폰에서 **목록 보기는 페이지가 구르고**, 지도 보기는 지도가 화면을 꽉 채운다.
        // 그 둘을 CSS 가 가를 수 있게 보기를 클래스로 적는다(app/globals.css).
        className={`home-wrapper ${mobileTab === 'map' ? 'mobile-map' : 'mobile-list'}`}
      >

      {/* 폰(≤768)의 규칙은 **app/globals.css 한 곳**에 있다(2026-11-28, 야간4 5-2).
          여기 본문 <style> 에 두면 첫 페인트보다 늦을 수 있고, iOS Safari 는 그 순간
          내용이 화면보다 넓으면 레이아웃 뷰포트를 넓힌 채 두고 다시 줄이지 않는다.
          게다가 묶음4 의 두 고침이 여기, 세로 규칙이 저기로 갈려 서로를 덮고 있었다. */}

      {/* 맨 위 한 줄(ListHeader)은 걷었다(2026-11-20) — 토글·검색·필터는 좌 패널 머리줄로
          내려갔고(components/home/PanelHeader.tsx), 지도는 그만큼 위로 올라와 칸을 가득 쓴다. */}

      {/* 모바일 탭 */}
      <div
        className="mobile-tab-bar"
        style={{
          display: 'none',
          // 40px — 상단 고정 영역(앱바 48 + 여백 8 + 이 줄 40 = 96)을 100 안에 둔다(2026-11-25).
          height: 40,
          marginBottom: 8,
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
            padding: 0,
            fontFamily: 'inherit',
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
              const kakao = (window as KakaoWindow).kakao
              if (kakao?.maps) {
                const container = document.querySelector('.kakao-map-container')
                if (container) {
                  kakao.maps.event.trigger(container, 'resize')
                }
              }
              // relayout 직접 호출
              const mapInstance = (window as KakaoWindow).__kakaoMapInstance
              if (mapInstance) mapInstance.relayout()
            }, 200)
          }}
          style={{
            flex: 1,
            padding: 0,
            fontFamily: 'inherit',
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
        /* ── 목록 보기 — **지도 보기와 같은 좌 패널** + 우 상세 ────────────
           패널의 자리 계산은 components/home/SidePanel.tsx 한 곳이다(좌 16 · 폭 340).
           보기를 바꿔도 패널이 움직이지 않는다. */
        <div className={detailOpen ? 'home-grid detail-open' : 'home-grid'} style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0 }}>
          <SidePanel hidden={mobileTab === 'map'} header={panelHeader}>
            <CustomerListPanel
              tab={listTab}
              groups={listTree.groups}
              siteCount={listTree.siteCount}
              expanded={expanded}
              toggleExpand={toggleExpand}
              selectedCompanyId={selectedCompanyId}
              selectedSiteId={selectedSiteId}
              onSelectCompany={id => openCompany(id)}
              onSelectSite={(cid, sid) => openSiteUnderCompany(cid, sid)}

              checkedCompanies={checkedCompanies}
              toggleCompanyCheck={id => setCheckedCompanies(prev => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id); else next.add(id)
                return next
              })}
              clearCompanyChecks={() => setCheckedCompanies(new Set())}
              onBulkIndustry={v => void bulkIndustry(v)}
              /* 「정리 필요」 탭이 쓰던 것들은 그 탭과 함께 걷었다(묶음6 4-1).
                 회사 삭제는 **회사 화면의 수정 창**으로(4-2), 복구는 **관리 메뉴**로(4-4) 갔다. */
              agencies={agencyList}
              /* 대리점·정리 필요 탭도 같은 검색칸으로 좁힌다(2026-11-27, 묶음4 D). */
              query={query}
              agencySiteCount={agencySiteCount}
              /* 대리점을 누르면 **우측에 대리점 화면**이 선다(2026-11-21).
                 전에는 회사 탭으로 옮겨 가며 그 대리점의 사업장만 걸렀다 — 거르기는
                 필터 모달의 「대리점」 조건이 하는 일이라 두 길이 겹쳤다. */
              onPickAgency={id => openAgency(id)}
              selectedAgencyId={selectedAgencyId}
              loading={isLoading}
            />
          </SidePanel>
          {/* 우측 본문 — 패널을 피해 시작한다(PANEL_SPACE). 엑셀·업체 등록은 탭 줄로 갔다. */}
          <div className="stable-scroll pane" style={{ marginLeft: PANEL_SPACE, height: '100%', minWidth: 0, overflowY: 'auto', padding: '16px 16px 16px 0', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {selectedSiteId != null ? (
              /* 사업장을 골랐을 때 — **상세 페이지와 같은 본문**이다(컴포넌트 하나를 나눠 쓴다). */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
                {/* 경로 줄·「새 창」은 걷었다(2026-11-20) — 회사로 가는 길은 카드 제목 앞의
                    화살표가 맡고, 같은 주소를 새 창으로 여는 길은 쓰이지 않았다. */}
                <CustomerDetailBody
                  key={selectedSiteId}
                  customerId={selectedSiteId}
                  embedded
                  /* 주소로 받은 담당자 — 한 번 열고 비운다(7-1). */
                  openContactId={openContactId}
                  /* ← 는 **왔던 화면**으로 돌아간다(회사 또는 대리점).
                     전에는 돌아갈 때 그 사업장 칩을 활동 이력에 자동으로 걸었다. 보던
                     자리를 지켜 주려던 것인데, 돌아오면 늘 한 사업장으로 좁혀진 이력이
                     떠서 「회사 전체」를 다시 보려면 매번 필터를 풀어야 했다(2026-11-21에
                     걷었다). 떠날 때의 필터는 그대로 되살아난다 —
                     lib/timelineFilter.ts 의 기억이 맡는다. */
                  /**
                   * ← 는 **들어온 곳**으로 간다(2026-11-28, 야간4 7-2) — 지도 핀에서
                   * 왔으면 지도로, 견적에서 왔으면 견적으로. 그 값을 쓰고 나면 비우므로
                   * 두 번째 ← 는 평소처럼 회사 pane 으로 올라간다.
                   */
                  onBack={() => {
                    if (origin === 'map') { setOrigin(null); setSelectedSiteId(null); setView('map'); return }
                    if (origin && origin.startsWith('/')) { setOrigin(null); window.location.href = origin; return }
                    setSelectedSiteId(null)
                    /**
                     * 폰에서는 상세를 열 때 좌 패널이 숨어 페이지가 접히고, 그때 스크롤이
                     * 0 으로 떨어진다. 목록으로 돌아오면 **보던 자리**로 되돌린다
                     * (2026-11-28, 야간4 5-3). 넓은 화면은 접히지 않아 그대로다.
                     */
                    const saved = readSavedListScroll()
                    if (saved > 0) window.setTimeout(() => writeListScroll(saved), 120)
                  }}
                  /* 가운데 pane 에서 고친 것(담당자·장비·사업장 정보)도 좌측 트리·지도에 바로 든다. */
                  onChanged={() => { void refreshCustomers() }}
                />
              </div>
            ) : selectedAgency ? (
              /* 대리점을 골랐을 때 — 회사 화면과 같은 급이다(components/home/list/AgencyPane.tsx). */
              <AgencyPane
                key={selectedAgency.customer_id}
                agency={selectedAgency}
                customers={customers}
                companyName={id => companyMap.get(id)?.company_name ?? null}
                deviceCount={id => deviceMap.get(id)?.length ?? 0}
                openQuotes={id => openQuotes.get(id) ?? 0}
                touchOf={id => lastTouchMap.get(id) ?? null}
                today={today}
                me={{ engineer_id: me?.engineer_id ?? null }}
                /* 담당자 삭제도 누구나 — 사유를 받고 사건으로 남긴다(2026-11-25 지시). */
                canDeleteContact
                onOpenSite={id => openSite(id)}
                onBackToList={() => setSelectedAgencyId(null)}
                onSaved={() => { void refreshCustomers() }}
                onError={msg => toast.error(msg)}
                onToast={msg => toast.success(msg)}
              />
            ) : selectedGroup ? (
              <CompanyPane
                key={selectedGroup.companyId}
                group={selectedGroup}
                engineerName={id => (id == null ? '' : engineerNameMap.get(id) ?? '')}
                onSaved={() => { void refreshCustomers() }}
                onPatchLocal={patchCustomersLocally}
                /* 회사 삭제 — 수정 창 바닥줄 왼쪽(2026-11-27, 묶음6 4-2).
                   확인 창·사유·사건은 사업장 삭제와 **같은 길**을 쓴다(deleteTarget). */
                onDeleteCompany={(id, name) => deleteEmptyCompany(id, name)}
                onError={msg => toast.error(msg)}
                onToast={msg => toast.success(msg)}
                onOpenSite={id => openSite(id)}
                onAddSite={() => openAddCustomer(true)}
                canEditCompany={isSuperAdmin(me)}
                me={{ engineer_id: me?.engineer_id ?? null, permission_level: me?.permission_level ?? null }}
                focusSiteId={timelineFocusSiteId}
                focusKey={timelineFocusKey}
                onFocused={() => setTimelineFocusKey(null)}
                onBackToList={() => setSelectedCompanyId(null)}
                /* 대리점으로 전환한 뒤 — 대리점 탭의 그 줄로 옮겨 간다. 회사 줄은 닫혀
                   목록에서 사라지므로, 여기 머물면 빈 화면만 남는다. */
                onConverted={agencyId => { setListTab('agency'); openAgency(agencyId) }}
              />
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_MUTED, fontSize: 13, background: '#fff', border: '1px solid #ebebeb', borderRadius: R.control }}>
                왼쪽에서 회사나 사업장을 고르세요
              </div>
            )}
          </div>
        </div>
      ) : (
      /* ── 지도 보기 — 지도가 화면 전부를 쓰고, 그 위에 **띠 하나**가 뜬다 ──────
         흰 좌 패널을 두던 때는 지도가 패널만큼 좁았고, 패널과 지도 사이에 선이 하나
         더 있었다. 띠를 띄우면 지도는 끝까지 이어지고 카드 사이로도 지도가 보인다.

         띠 **바깥**은 지도 그대로다(드래그·휠). 띠 **안의 카드 틈**은 지도 이벤트를
         막는다 — 카드를 스크롤하려다 지도가 끌려가면 목록을 못 읽는다. 틈이 좁아
         거기를 노려 지도를 잡는 사람은 없다고 보고 하나로 정했다. */
      <div style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0 }}>
        {/* 폰에서 「업체 목록」 탭이면 **지도를 그리지 않는다**(2026-11-25) — 뒤에 깔아 두면
            보이지도 않는 지도가 타일을 받고, 카드 틈으로 손짓이 새어 들어갔다. */}
        {(!narrow || mobileTab === 'map') && (
        <div className="home-map" style={{ position: 'absolute', inset: 0 }}>
          <MapView
            customers={filteredCustomers}
            deviceMap={deviceMap}
            siteCountByCompany={siteCountByCompany}
            focusedCustomerId={focusedCustomerId}
            restoredMapCenter={mapCenter}
            restoredMapLevel={mapLevel}
            restoredOpenOverlayCustomerId={openOverlayCustomerId}
            focusSiteIds={
              selectedSiteId != null ? [selectedSiteId]
                : selectedGroup ? selectedGroup.sites.map(x => x.customer.customer_id)
                  : []
            }
            focusNonce={mapReturnNonce}
            onMapStateChange={(center, level) => {
              setMapCenter(center)
              setMapLevel(level)
            }}
            onOpenOverlayChange={setOpenOverlayCustomerId}
          />
        </div>
        )}

        <SidePanel hidden={mobileTab === 'map'} header={panelHeader}>
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
        </SidePanel>
      </div>
      )}

        {/* ── 지우기 창 — 무엇이 함께 숨는지 보여 주고 까닭을 받는다 ── */}
        {deleteTarget && (
          <DeleteCustomerModal
            /* 대상이 바뀌면 창을 새로 만든다 — 앞서 적던 까닭이 남지 않게. */
            key={`${deleteTarget.target}-${deleteTarget.id}`}
            target={deleteTarget.target}
            name={deleteTarget.name}
            counts={deleteCounts}
            busy={deleting}
            onClose={() => setDeleteTarget(null)}
            onDelete={reason => void runDelete(reason)}
          />
        )}

        {/* 삭제 요청 창은 **걷었다**(2026-11-27, 묶음6 4-3) — 미처리 요청 0건을 확인했다.
           지우기 문턱이 「고객사를 보는 사람 전부」로 내려간 뒤(2026-11-25) 요청할 까닭이 없다.
           라우트와 지난 사건은 그대로 남는다. */}

        {exportOpen && (
          <ExportModal
            tab={listTab}
            /* 지금 걸린 조건 — 필터 칩과 **같은 글자**다(화면 위의 칩 줄과 창이 어긋나지 않게). */
            filterText={filterChips.length === 0 ? '조건 없음' : filterChips.map(c => c.label).join(' · ')}
            siteCount={exportSiteIds.length}
            counts={exportCounts}
            busy={isExporting}
            onClose={() => setExportOpen(false)}
            onDownload={(unit, withContacts) => { void runExport(unit, withContacts) }}
          />
        )}

        {filterOpen && (
          <CustomerFilterModal
            value={listFilter}
            options={filterOptions}
            matchCount={countFor}
            onApply={next => { setListFilter(next); setFilterOpen(false) }}
            onClose={() => setFilterOpen(false)}
          />
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
            await refreshCustomers()
            toast.success(message)
          }}
        />
        )}
      </div>
    </>
  )
}