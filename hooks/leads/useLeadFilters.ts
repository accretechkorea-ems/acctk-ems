'use client'

// 리드 목록의 필터·검색·페이지네이션. 화면(app/leads/page.tsx)이 이미 1,000줄이라 여기로 뺐다.
// 수리 화면(app/repair/page.tsx)의 패턴을 그대로 옮긴 것이다 —
// 전체를 받아 메모리에서 거르고 잘라 쓴다(리드는 건수가 적어 서버 페이징이 과하다).
//
// 드롭다운 선택지는 코드에 박지 않고 실제 데이터에서 뽑는다. 지금은 상태 2종·담당자 1명뿐이라
// 하드코딩하면 곧 어긋난다.
import { useEffect, useMemo, useState } from 'react'

/** 이 훅이 보는 최소 모양. 화면의 Lead 타입이 이 조건을 만족하면 그대로 넘길 수 있다. */
type LeadLike = {
  lead_id: number
  lead_no: string | null
  partner_company: string
  customer_company: string
  interest_product: string
  assigned_to: number | null
  assigned_by: number | null
  status: string
  created_at: string
}

/** 전체를 뜻하는 값. 빈 문자열은 '미배정'과 헷갈리므로 쓰지 않는다. */
export const ALL = 'all'
/** 배정자·담당자가 비어 있는 건만 보는 값. */
export const NONE = 'none'

export const LEAD_PAGE_SIZE = 20

export type EngineerPick = { id: number; label: string }

export function useLeadFilters<T extends LeadLike>(
  leads: T[],
  /** id → '이름 직급'. 화면이 이미 engineers 를 들고 있으므로 그 함수를 그대로 받는다. */
  engName: (id: number | null) => string,
) {
  const [month, setMonth] = useState('')            // YYYY-MM (단일 월, 비면 전체)
  const [assignedBy, setAssignedBy] = useState<string>(ALL)
  const [assignedTo, setAssignedTo] = useState<string>(ALL)
  const [product, setProduct] = useState<string>(ALL)
  const [searchInput, setSearchInput] = useState('')  // 입력창 값
  const [search, setSearch] = useState('')            // 실제 적용된 검색어(300ms 뒤)
  const [page, setPage] = useState(0)

  // 검색은 타이핑 즉시 반영하되 300ms 쉬었을 때만 — 글자마다 전체를 다시 거르지 않는다.
  // 검색어가 바뀌면 보던 페이지도 첫 장으로 되돌린다.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // 필터가 바뀌면 첫 페이지로. 안 그러면 3페이지를 보다 필터를 좁혔을 때 빈 화면이 된다.
  // effect 가 아니라 setter 안에서 함께 되돌린다 — effect 로 하면 한 번 그린 뒤 다시 그리게 된다.
  // (검색어는 debounce 로 늦게 들어오므로 search 가 바뀌는 자리에서 따로 되돌린다)
  const resetPage = <V,>(set: (v: V) => void) => (v: V) => { set(v); setPage(0) }

  // ── 드롭다운 선택지 — 실제 데이터에 있는 값만 ──
  const byOptions = useMemo<EngineerPick[]>(() => pickEngineers(leads, l => l.assigned_by, engName), [leads, engName])
  const toOptions = useMemo<EngineerPick[]>(() => pickEngineers(leads, l => l.assigned_to, engName), [leads, engName])
  const productOptions = useMemo(
    () => [...new Set(leads.map(l => l.interest_product).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
    [leads],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leads.filter(l => {
      if (month && (l.created_at ?? '').slice(0, 7) !== month) return false
      if (!matchEngineer(assignedBy, l.assigned_by)) return false
      if (!matchEngineer(assignedTo, l.assigned_to)) return false
      if (product !== ALL && l.interest_product !== product) return false
      if (!q) return true
      // 배정자·담당자는 leads 에 id 로만 있어 이름으로 바꿔 비교한다.
      const hay = [
        l.lead_no, engName(l.assigned_by), engName(l.assigned_to),
        l.customer_company, l.interest_product, l.partner_company,
      ].map(v => (v ?? '').toLowerCase())
      return hay.some(v => v.includes(q))
    })
  }, [leads, month, assignedBy, assignedTo, product, search, engName])

  const active = month !== '' || assignedBy !== ALL || assignedTo !== ALL || product !== ALL || search.trim() !== ''

  const reset = () => {
    setMonth(''); setAssignedBy(ALL); setAssignedTo(ALL); setProduct(ALL)
    setSearchInput(''); setSearch(''); setPage(0)
  }

  // 필터가 좁아져 현재 페이지가 사라져도 빈 화면이 되지 않게 범위를 보정한다(수리 화면과 같은 방식).
  const totalPages = Math.max(1, Math.ceil(filtered.length / LEAD_PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages - 1)

  return {
    month, setMonth: resetPage(setMonth),
    assignedBy, setAssignedBy: resetPage(setAssignedBy),
    assignedTo, setAssignedTo: resetPage(setAssignedTo),
    product, setProduct: resetPage(setProduct),
    searchInput, setSearchInput,
    byOptions, toOptions, productOptions,
    filtered, active, reset,
    page: pageSafe, setPage, totalPages, pageSize: LEAD_PAGE_SIZE,
  }
}

/** 'all' / 'none' / 특정 id 를 한 규칙으로 본다. */
function matchEngineer(selected: string, value: number | null): boolean {
  if (selected === ALL) return true
  if (selected === NONE) return value === null
  return value === Number(selected)
}

/** 실제로 쓰인 engineer_id 만 모아 이름순으로 돌려준다. */
function pickEngineers<T>(
  rows: T[],
  get: (row: T) => number | null,
  engName: (id: number | null) => string,
): EngineerPick[] {
  const ids = [...new Set(rows.map(get).filter((v): v is number => v != null))]
  return ids
    .map(id => ({ id, label: engName(id) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'))
}
