'use client'

import { Fragment, Suspense, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { canViewAdmin, isSuperAdmin } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPerms'
import AccessGate from '@/components/common/AccessGate'
import { useOffices, selectableOffices, invalidateOffices, type Office } from '@/lib/offices'
import { geocodeAddress } from '@/lib/geocode'
import { SALES_STATUS_COLORS, ROLE_COLORS, getCategoryColor } from '@/lib/categoryColors'
import { useToast } from '@/components/common/Toast'
import { notifyDeleteCompleted } from '@/lib/quoteMutations'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import AutocompleteInput from '@/components/common/AutocompleteInput'

const BLUE = '#234ea2'
const PAGE_BG = '#f4f5f7'
const CARD_BG = '#ffffff'
const BORDER = '#e5e7eb'
const TEXT = '#111113'
const GRAY = '#6b7280'
const DANGER = '#dc2626'

type Quote = {
  quote_id: number
  quote_number: string
  quote_date: string
  total_supply: number
  status: string
  delete_reason?: string | null
  pdf_url?: string | null
  customer_id?: number | null
  engineers?: { name: string } | null
  customers?: { company_name: string } | null
}

type Engineer = {
  engineer_id: number
  name: string
  position: string | null
  teams: string | null
  email: string | null
  initials: string | null
  permission_level: string
  resigned_date: string | null
  office: string | null
}

type SalesTarget = {
  target_id: number
  engineer_id: number | null
  year: number
  quarter: number | null
  target_amount: number | null        // 매출 목표
  order_target_amount: number | null  // 수주 목표
}

type Team = {
  id: number
  name: string
  is_special: boolean
  display_order: number
} & Record<TeamPermField, boolean | null>

// teams 의 권한 플래그 7개. 라벨은 헤더 메뉴 이름과 같게 둔다.
// RLS 함수 has_team_perm() 과 lib/permissions.ts 가 보는 컬럼이 바로 이것들이다.
const TEAM_PERM_FIELDS = [
  { key: 'can_view_customers',  label: '고객사',   desc: '고객사 현황 · 20 수리등록' },
  { key: 'can_view_dashboard',  label: '대시보드', desc: '20·80 대시보드 · 활동 현황' },
  { key: 'can_view_quote',      label: '견적서',   desc: '견적서 작성·조회' },
  { key: 'can_view_pipeline',   label: '영업 현황', desc: '영업기회 파이프라인' },
  { key: 'can_view_leads',      label: '리드',     desc: '배정받은 대리점 리드 처리' },
  { key: 'can_view_sales_mgmt', label: '영업관리', desc: '발주관리 · 재고관리' },
  { key: 'can_view_admin',      label: '관리자',   desc: '실적 현황 · 유지보수' },
] as const
type TeamPermField = typeof TEAM_PERM_FIELDS[number]['key']
type TeamPermForm = Record<TeamPermField, boolean>

const EMPTY_TEAM_PERM: TeamPermForm = {
  can_view_customers: false, can_view_dashboard: false, can_view_quote: false,
  can_view_pipeline: false, can_view_leads: false, can_view_sales_mgmt: false, can_view_admin: false,
}
// 팀 관리 표의 열 폭 — 팀 이름(남는 폭) · 권한 7칸(고정) · 삭제(고정).
// 권한 칸이 고정이라 모든 행에서 같은 x 에 놓여 팀끼리 비교된다.
const TEAM_GRID = 'minmax(120px, 1fr) repeat(7, 84px) 76px'
// 사무실 표 — 코드·이름·주소(남는 폭)·좌표·순서·사용·버튼.
const OFFICE_GRID = '90px 80px minmax(160px, 1fr) 170px 48px 48px 150px'

const teamPermOf = (t: Team): TeamPermForm =>
  TEAM_PERM_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: t[f.key] === true }), {} as TeamPermForm)

// 견적서 서비스비의 부대비용 표준 항목·단가. 견적서는 저장 시점 단가를 복사해 쓰므로
// 여기서 값을 바꿔도 과거 견적의 금액은 변하지 않는다.
type ExpensePreset = {
  preset_id: number
  item_name: string
  unit_price: number
  display_order: number
  is_active: boolean
}

const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')

const POSITION_ORDER: Record<string, number> = {
  '총괄': 0, '관리자': 1, '수석': 2, '책임': 3, '선임': 4, '사원': 5,
}

const POSITIONS = ['사장', '총괄', '수석', '책임', '선임', '사원']

// 삭제 요청 상태값. 목록 정렬·건수 집계에서 함께 쓴다.
const DELETE_REQUEST_STATUS = '취소요청'

function AdminPageInner() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const confirmDialog = useConfirm() // native confirm 과 이름 충돌 피하려 confirmDialog
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [currentEngineer, setCurrentEngineer] = useState<Engineer | null>(null)

  // 견적서 삭제
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [deleting, setDeleting] = useState<number | null>(null)
  // 첫 화면 배지용 — 처리 대기 중인 삭제 요청 건수.
  const [pendingDeleteCount, setPendingDeleteCount] = useState(0)

  // 목표 금액 관리
  const [showTargetModal, setShowTargetModal] = useState(false)
  const [targets, setTargets] = useState<SalesTarget[]>([])
  const [targetLoading, setTargetLoading] = useState(false)
  const thisYear = new Date().getFullYear()
  const [targetYear, setTargetYear] = useState(thisYear)
  const [editingTarget, setEditingTarget] = useState<{ engineerId: number | null; amount: string; orderAmount: string } | null>(null)
  const [savingTarget, setSavingTarget] = useState(false)

  // 직원 관리
  const [showEngineerModal, setShowEngineerModal] = useState(false)
  const [engineers, setEngineers] = useState<Engineer[]>([])
  const [engineerLoading, setEngineerLoading] = useState(false)
  const [showAddEngineer, setShowAddEngineer] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', position: '사원', teams: '', email: '', initials: '', password: '', office: '' })
  const [addLoading, setAddLoading] = useState(false)
  const [editEngineer, setEditEngineer] = useState<Engineer | null>(null)
  const [editForm, setEditForm] = useState({ name: '', position: '', teams: '', email: '', initials: '', permission_level: 'member', office: '' })
  const [editLoading, setEditLoading] = useState(false)
  const [deleteEngineer, setDeleteEngineer] = useState<Engineer | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [resignDate, setResignDate] = useState<string>('')
  const [showLogModal, setShowLogModal] = useState(false)

  // 팀 관리
  const [showTeamModal, setShowTeamModal] = useState(false)

  // ── 사무실 관리 ──
  // 값은 offices 테이블이 정본이다. 직원 등록·수정의 사무실 드롭다운도 같은 목록을 쓴다.
  const { offices, loading: officesLoading } = useOffices()
  const [officeList, setOfficeList] = useState<Office[]>([])
  const [showOfficeModal, setShowOfficeModal] = useState(false)
  const [officeSaving, setOfficeSaving] = useState(false)
  const [officeEditing, setOfficeEditing] = useState<Office | null>(null)   // null 이면 추가
  const [officeAddOpen, setOfficeAddOpen] = useState(false)
  const emptyOfficeForm = { code: '', label: '', address: '', latitude: '', longitude: '', sort_order: '0' }
  const [officeForm, setOfficeForm] = useState(emptyOfficeForm)
  const [geoState, setGeoState] = useState<{ busy: boolean; message: string }>({ busy: false, message: '' })
  const [teamsList, setTeamsList] = useState<Team[]>([])
  const [teamLoading, setTeamLoading] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamPerm, setNewTeamPerm] = useState<TeamPermForm>(EMPTY_TEAM_PERM)
  const [addTeamLoading, setAddTeamLoading] = useState(false)
  const [deletingTeam, setDeletingTeam] = useState<number | null>(null)
  // 새 팀 추가는 어쩌다 한 번 쓰므로 접어 두고, 목록이 모달의 본체가 되게 한다.
  const [addTeamOpen, setAddTeamOpen] = useState(false)
  // 저장 중인 팀 — 그 행의 체크박스만 잠근다(권한은 누르는 즉시 저장된다).
  const [savingTeamId, setSavingTeamId] = useState<number | null>(null)
  const [logs, setLogs] = useState<any[]>([])
  const [logLoading, setLogLoading] = useState(false)

  const [showPresetModal, setShowPresetModal] = useState(false)
  const [presets, setPresets] = useState<ExpensePreset[]>([])
  const [presetLoading, setPresetLoading] = useState(false)
  const [editingPreset, setEditingPreset] = useState<{ presetId: number; itemName: string; unitPrice: string } | null>(null)
  const [savingPreset, setSavingPreset] = useState(false)
  const [newPreset, setNewPreset] = useState({ itemName: '', unitPrice: '' })
  const [addPresetLoading, setAddPresetLoading] = useState(false)
  const [deletingPreset, setDeletingPreset] = useState<number | null>(null)

  // ── 폼별 검증 에러 (폼마다 독립 인스턴스 → 서로 새지 않음). 각 gate state 로 초기화 ──
  const targetErr = useFieldErrors<'amount'>()
  const addEngErr = useFieldErrors<'name' | 'email' | 'password' | 'initials' | 'teams'>()
  const editEngErr = useFieldErrors<'name' | 'teams'>()
  const resignErr = useFieldErrors<'resignDate'>()
  const teamErr = useFieldErrors<'teamName'>()
  const presetErr = useFieldErrors<'itemName'>()          // 항목 추가 폼
  const presetEditErr = useFieldErrors<'itemName'>()      // 인라인 수정
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => { targetErr.setErrors({}) }, [editingTarget])
  useEffect(() => { addEngErr.setErrors({}) }, [showAddEngineer])
  useEffect(() => { editEngErr.setErrors({}) }, [editEngineer])
  useEffect(() => { resignErr.setErrors({}) }, [deleteEngineer])
  useEffect(() => { teamErr.setErrors({}) }, [showTeamModal])
  useEffect(() => { presetErr.setErrors({}) }, [showPresetModal])
  useEffect(() => { presetEditErr.setErrors({}) }, [editingPreset])
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getUser()
      // 미로그인은 미들웨어가 /login 으로 보낸다. 리다이렉트 대신 미허가 처리(AccessGate).
      if (!data.user?.email) { setLoading(false); return }

      const { data: engData } = await supabase
        .from('engineers')
        .select('*')
        .eq('email', data.user.email)
        .single()

      // 진입 판정은 팀 플래그(can_view_admin) 기준. currentEngineer 는 기존대로 유지.
      const eng = await withTeamPerm(engData)
      if (eng && canViewAdmin(eng)) {
        setCurrentEngineer(eng)
        setAuthorized(true)
      }
      setLoading(false)
    }
    check()
  }, [])

  // 첫 화면 배지 — 권한이 확인되면 대기 건수를 한 번 읽는다.
  useEffect(() => {
    if (authorized) fetchPendingDeleteCount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized])

  // 알림(link: '/admin?tab=quotes')으로 들어오면 견적서 삭제 목록을 바로 연다.
  // 이미 이 화면에 있을 때 눌러도 열리도록 useState 초기값이 아니라 주소 변화를 본다.
  useEffect(() => {
    if (!authorized) return
    if (searchParams.get('tab') !== 'quotes') return
    setShowQuoteModal(true)
    setSearchQuery('')
    fetchQuotes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, searchParams])

  // 모달을 닫으면 주소의 tab 도 지운다(뒤로 가기 기록을 늘리지 않도록 replace).
  const closeQuoteModal = () => {
    setShowQuoteModal(false)
    if (searchParams.get('tab')) router.replace('/admin')
  }

  const fetchLogs = async () => {
    setLogLoading(true)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const { data } = await supabase
      .from('download_logs')
      .select('*, engineers(name)')
      .gte('downloaded_at', sevenDaysAgo.toISOString())
      .order('downloaded_at', { ascending: false })
      .limit(1000)
    setLogs(data || [])
    setLogLoading(false)
  }
  // ── 견적서 ──────────────────────────────────────────────────────────────────
  // 대기 중인 삭제 요청 건수(배지용). 목록을 새로 읽을 때마다 함께 갱신한다.
  const fetchPendingDeleteCount = async () => {
    const { count } = await supabase
      .from('quotes')
      .select('quote_id', { count: 'exact', head: true })
      .eq('status', DELETE_REQUEST_STATUS)
    setPendingDeleteCount(count ?? 0)
  }

  // 삭제 요청 건은 오래돼도 놓치면 안 되므로 limit 과 무관하게 따로 전부 읽어
  // 최신 50건 앞에 붙인다(둘 다 견적일 내림차순, 중복은 제거).
  const fetchQuotes = async (q?: string) => {
    setQuoteLoading(true)
    const term = q?.trim()
    let pendingQuery = supabase.from('quotes').select('*, engineers(name)')
      .eq('status', DELETE_REQUEST_STATUS).order('quote_date', { ascending: false })
    if (term) pendingQuery = pendingQuery.ilike('quote_number', `%${term}%`)
    let query = supabase.from('quotes').select('*, engineers(name)').order('quote_date', { ascending: false }).limit(50)
    if (term) query = query.ilike('quote_number', `%${term}%`)
    const [{ data: pendingData }, { data: qData }] = await Promise.all([pendingQuery, query])
    const pendingRows = (pendingData || []) as Quote[]
    const pendingIds = new Set(pendingRows.map(r => r.quote_id))
    const rows = [...pendingRows, ...((qData || []) as Quote[]).filter(r => !pendingIds.has(r.quote_id))]
    const customerIds = [...new Set(rows.map(r => r.customer_id).filter((id): id is number => id != null))]
    const { data: custData } = customerIds.length > 0
      ? await supabase.from('customers').select('customer_id, company_name').in('customer_id', customerIds)
      : { data: [] }
    const custMap: Record<number, string> = {}
    for (const c of custData || []) custMap[c.customer_id] = c.company_name
    const merged = rows.map(r => ({
      ...r,
      customers: r.customer_id ? { company_name: custMap[r.customer_id] ?? null } : null,
    }))
    setQuotes(merged)
    setQuoteLoading(false)
    fetchPendingDeleteCount()
  }

  const handleDeleteQuote = async (quote: Quote) => {
    const ok = await confirmDialog({ title: '견적서 삭제', message: `견적서 ${quote.quote_number}을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`, confirmText: '삭제', variant: 'danger' })
    if (!ok) return
    setDeleting(quote.quote_id)

    // 스토리지 PDF 를 먼저 지운다. 삭제 라우트가 quotes.pdf_url 로 대조해 파일을 찾으므로
    // 견적 행이 남아 있는 동안에만 지울 수 있다(행을 먼저 지우면 늘 404 로 끝난다).
    // 대조되는 행이 없으면(404) 지울 파일이 없다는 뜻이므로 견적 삭제는 그대로 이어간다.
    if (quote.pdf_url) {
      const filePath = quote.pdf_url.replace('quote-pdfs/', '')
      try {
        const res = await fetch('/api/delete-quote-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          console.error('[admin] delete quote pdf failed', { filePath, status: res.status, body })
          if (res.status !== 404) {
            toast.error('PDF 파일 삭제에 실패했습니다. 견적은 삭제되지 않았습니다.')
            setDeleting(null)
            return
          }
        }
      } catch (e) {
        console.error('[admin] delete quote pdf request failed', { filePath, error: e })
        toast.error('PDF 파일 삭제에 실패했습니다. 견적은 삭제되지 않았습니다.')
        setDeleting(null)
        return
      }
    }

    // quote_expenses·quote_items 가 quotes 를 참조한다(FK 는 NO ACTION). 자식부터 지우고
    // 매 단계 error 를 확인한다 — 중간에 실패하면 멈춰야 품목만 지워진 상태로 남지 않는다.
    const { error: expErr } = await supabase.from('quote_expenses').delete().eq('quote_id', quote.quote_id)
    if (expErr) {
      console.error('[admin] delete quote_expenses failed', expErr)
      toast.error(`부대비용 삭제에 실패했습니다 (${expErr.code || expErr.message})`)
      setDeleting(null)
      return
    }
    const { error: itemErr } = await supabase.from('quote_items').delete().eq('quote_id', quote.quote_id)
    if (itemErr) {
      console.error('[admin] delete quote_items failed', itemErr)
      toast.error(`견적 품목 삭제에 실패했습니다 (${itemErr.code || itemErr.message})`)
      setDeleting(null)
      return
    }
    const { error: quoteErr } = await supabase.from('quotes').delete().eq('quote_id', quote.quote_id)
    if (quoteErr) {
      console.error('[admin] delete quote failed', quoteErr)
      toast.error(`견적서 삭제에 실패했습니다. 품목·부대비용은 이미 지워졌을 수 있습니다 (${quoteErr.code || quoteErr.message})`)
      setDeleting(null)
      fetchQuotes(searchQuery)
      return
    }
    // 삭제가 끝났음을 견적 작성자에게 알린다(견적 행이 사라진 뒤라 감사 기록을 근거로 만든다).
    // 알림이 실패해도 삭제는 이미 끝났으므로 화면 흐름은 그대로 진행한다.
    await notifyDeleteCompleted(quote.quote_id)
    setDeleting(null)
    fetchQuotes(searchQuery)
  }

  // ── 목표 금액 ───────────────────────────────────────────────────────────────
  const fetchTargetData = async () => {
    setTargetLoading(true)
    const [{ data: eData }, { data: tData }] = await Promise.all([
      supabase.from('engineers').select('*').order('engineer_id'),
      supabase.from('sales_targets').select('*').eq('year', targetYear).is('quarter', null),
    ])
    const sorted = (eData || []).sort((a: Engineer, b: Engineer) =>
      (POSITION_ORDER[a.position ?? ''] ?? 99) - (POSITION_ORDER[b.position ?? ''] ?? 99)
    )
    setEngineers(sorted)
    setTargets(tData || [])
    setTargetLoading(false)
  }

  useEffect(() => { if (showTargetModal) fetchTargetData() }, [targetYear])

  const getTarget = (engineerId: number | null) => targets.find(t => t.engineer_id === engineerId) ?? null

  const handleSaveTarget = async () => {
    if (!editingTarget) return
    const salesRaw = editingTarget.amount.trim()
    const orderRaw = editingTarget.orderAmount.trim()
    // 수주·매출 둘 다 비면 기존 목표 삭제
    if (!salesRaw && !orderRaw) {
      const existing = getTarget(editingTarget.engineerId)
      if (existing) await supabase.from('sales_targets').delete().eq('target_id', existing.target_id)
      setEditingTarget(null)
      fetchTargetData()
      return
    }
    // 비어 있으면 null, 값이 있으면 숫자. 하나만 입력해도 저장.
    const sales = salesRaw ? Number(salesRaw.replace(/,/g, '')) : null
    const order = orderRaw ? Number(orderRaw.replace(/,/g, '')) : null
    const bad = (v: number | null) => v != null && (isNaN(v) || v < 0)
    if (!targetErr.validate({ amount: (bad(sales) || bad(order)) ? '올바른 금액을 입력해주세요' : null })) return
    setSavingTarget(true)
    const existing = getTarget(editingTarget.engineerId)
    if (existing) {
      await supabase.from('sales_targets').update({ target_amount: sales, order_target_amount: order }).eq('target_id', existing.target_id)
    } else {
      await supabase.from('sales_targets').insert({ engineer_id: editingTarget.engineerId, year: targetYear, quarter: null, target_amount: sales, order_target_amount: order })
    }
    setSavingTarget(false)
    setEditingTarget(null)
    fetchTargetData()
  }

  // ── 직원 관리 ───────────────────────────────────────────────────────────────
  const fetchEngineers = async () => {
    setEngineerLoading(true)
    const { data } = await supabase.from('engineers').select('*').order('engineer_id')
    const sorted = (data || []).sort((a: Engineer, b: Engineer) =>
      (POSITION_ORDER[a.position ?? ''] ?? 99) - (POSITION_ORDER[b.position ?? ''] ?? 99)
    )
    setEngineers(sorted)
    setEngineerLoading(false)
  }

  const handleAddEngineer = async () => {
    const ok = addEngErr.validate({
      name: addForm.name.trim() ? null : '이름을 입력해주세요',
      email: addForm.email.trim() ? null : '이메일을 입력해주세요',
      password: addForm.password.trim() ? null : '초기 비밀번호를 입력해주세요',
      initials: addForm.initials.trim() ? null : '이니셜을 입력해주세요',
      teams: addForm.teams ? null : '팀을 선택해주세요',
    })
    if (!ok) return
    setAddLoading(true)
    try {
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: addForm.email.trim(),
          password: addForm.password.trim(),
          name: addForm.name.trim(),
          position: addForm.position,
          teams: addForm.teams,
          initials: addForm.initials.trim().toUpperCase(),
          office: addForm.office,
        }),
      })
      if (!res.ok) {
        const result = await res.json().catch(() => ({ error: `서버 오류 (${res.status})` }))
        toast.error(`오류: ${result.error ?? '알 수 없는 오류'}`)
        setAddLoading(false)
        return
      }
      const result = await res.json()
      if (result.error) { toast.error(`오류: ${result.error}`); setAddLoading(false); return }
      toast.success(`${addForm.name} 직원이 등록되었습니다`)
      setShowAddEngineer(false)
      setAddForm({ name: '', position: '사원', teams: '', email: '', initials: '', password: '', office: '' })
      fetchEngineers()
    } catch (e) {
      toast.error('오류가 발생했습니다')
    }
    setAddLoading(false)
  }

  const handleUpdateEngineer = async () => {
    if (!editEngineer) return
    if (!editEngErr.validate({
      name: editForm.name.trim() ? null : '이름을 입력해주세요',
      teams: editForm.teams ? null : '팀을 선택해주세요',
    })) return
    setEditLoading(true)
    try {
      const res = await fetch('/api/update-engineer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engineer_id: editEngineer.engineer_id,
          name: editForm.name.trim(),
          position: editForm.position,
          teams: editForm.teams,
          email: editForm.email.trim(),
          initials: editForm.initials.trim().toUpperCase(),
          permission_level: editForm.permission_level,
          office: editForm.office,
        }),
      })
      const result = await res.json().catch(() => ({ error: `서버 오류 (${res.status})` }))
      if (!res.ok || result.error) { toast.error(`오류: ${result.error ?? '알 수 없는 오류'}`); setEditLoading(false); return }
      toast.success('직원 정보가 수정되었습니다')
      setEditEngineer(null)
      fetchEngineers()
    } catch {
      toast.error('오류가 발생했습니다')
    }
    setEditLoading(false)
  }

  const handleDeleteEngineer = async () => {
    if (!deleteEngineer) return
    if (!resignErr.validate({ resignDate: resignDate ? null : '삭제일을 선택해주세요' })) return
    setDeleteLoading(true)
    try {
      const res = await fetch('/api/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engineer_id: deleteEngineer.engineer_id, email: deleteEngineer.email, resigned_date: resignDate }),
      })
      if (!res.ok) {
        const result = await res.json().catch(() => ({ error: `서버 오류 (${res.status})` }))
        toast.error(`오류: ${result.error ?? '알 수 없는 오류'}`)
        setDeleteLoading(false)
        return
      }
      const result = await res.json()
      if (result.error) { toast.error(`오류: ${result.error}`); setDeleteLoading(false); return }
      const name = deleteEngineer.name
      setDeleteEngineer(null)
      fetchEngineers()
      // 퇴사 처리는 됐는데 로그인 계정만 안 지워진 경우 — 목록은 갱신하되 성공으로 넘기지 않는다.
      if (result.warning) toast.error(result.warning)
      else toast.success(`${name} 직원이 삭제되었습니다`)
    } catch (e) {
      toast.error('오류가 발생했습니다')
    }
    setDeleteLoading(false)
  }


  // ── 팀 관리 ────────────────────────────────────────────────────────────────
  const fetchTeams = async () => {
    setTeamLoading(true)
    const { data } = await supabase.from('teams').select('*').order('display_order')
    setTeamsList((data as Team[]) ?? [])
    setTeamLoading(false)
  }

  const handleAddTeam = async () => {
    if (!teamErr.validate({ teamName: newTeamName.trim() ? null : '팀 이름을 입력해주세요' })) return
    setAddTeamLoading(true)
    const maxOrder = teamsList.length > 0 ? Math.max(...teamsList.map(t => t.display_order)) : 0
    const { error } = await supabase.from('teams').insert({
      name: newTeamName.trim(),
      display_order: maxOrder + 1,
      ...newTeamPerm,       // 체크한 권한. 기본값은 전부 꺼짐.
    })
    setAddTeamLoading(false)
    if (error) { toast.error(error.message); return }
    setNewTeamName('')
    setNewTeamPerm(EMPTY_TEAM_PERM)
    setAddTeamOpen(false)
    fetchTeams()
  }

  const closeTeamModal = () => {
    setShowTeamModal(false)
    setAddTeamOpen(false)
    setNewTeamName('')
    setNewTeamPerm(EMPTY_TEAM_PERM)
  }

  // ── 팀 권한 편집 ──
  // 추가 폼과 행 편집이 같은 체크박스 묶음을 쓴다(두 벌 만들지 않는다).
  const permCheckboxes = (value: TeamPermForm, onChange: Dispatch<SetStateAction<TeamPermForm>>) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      {TEAM_PERM_FIELDS.map(f => {
        const checked = value[f.key]
        return (
          <label key={f.key}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer',
              padding: '8px 10px', borderRadius: 6, border: `1px solid ${BORDER}`,
              background: checked ? '#f3f4f6' : CARD_BG,
            }}>
            <input type="checkbox" checked={checked}
              onChange={e => onChange(p => ({ ...p, [f.key]: e.target.checked }))}
              style={{ width: 14, height: 14, accentColor: BLUE, cursor: 'pointer', marginTop: 2, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: checked ? BLUE : TEXT }}>{f.label}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{f.desc}</div>
            </div>
          </label>
        )
      })}
    </div>
  )

  // 훅이 읽어 온 목록을 화면 상태로 옮겨 둔다. 저장 뒤에는 fetchOffices 로 다시 읽는다.
  useEffect(() => { setOfficeList(offices) }, [offices])

  /** 저장 뒤 캐시를 버리고 다시 읽는다 — 다른 화면(동선·업체 카드)도 새로고침하면 새 값을 본다. */
  const fetchOffices = async () => {
    invalidateOffices()
    const { data } = await supabase
      .from('offices')
      .select('office_id, code, label, address, latitude, longitude, sort_order, is_active')
      .order('sort_order').order('code')
    setOfficeList((data ?? []) as Office[])
  }

  const openOfficeAdd = () => {
    setOfficeEditing(null)
    setOfficeForm(emptyOfficeForm)
    setGeoState({ busy: false, message: '' })
    setOfficeAddOpen(true)
  }
  const openOfficeEdit = (o: Office) => {
    setOfficeEditing(o)
    setOfficeForm({
      code: o.code, label: o.label, address: o.address,
      latitude: o.latitude == null ? '' : String(o.latitude),
      longitude: o.longitude == null ? '' : String(o.longitude),
      sort_order: String(o.sort_order),
    })
    setGeoState({ busy: false, message: '' })
    setOfficeAddOpen(true)
  }
  const closeOfficeForm = () => {
    setOfficeAddOpen(false)
    setOfficeEditing(null)
    setOfficeForm(emptyOfficeForm)
    setGeoState({ busy: false, message: '' })
  }

  /** 주소를 좌표로 바꿔 입력칸에 채운다. 실패하면 직접 입력하도록 안내만 남긴다. */
  const runGeocode = async () => {
    const address = officeForm.address.trim()
    if (!address) { setGeoState({ busy: false, message: '주소를 먼저 입력해주세요.' }); return }
    setGeoState({ busy: true, message: '' })
    try {
      const { latitude, longitude } = await geocodeAddress(address)
      setOfficeForm(f => ({ ...f, latitude: String(latitude), longitude: String(longitude) }))
      setGeoState({ busy: false, message: `좌표를 찾았습니다 — ${latitude}, ${longitude}. 저장 전에 확인해주세요.` })
    } catch (e) {
      setGeoState({ busy: false, message: (e as Error).message + ' 좌표를 직접 입력해주세요.' })
    }
  }

  const callOffice = async (payload: Record<string, unknown>, okMsg: string) => {
    setOfficeSaving(true)
    try {
      const res = await fetch('/api/office', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json?.error || '저장하지 못했습니다.'); return false }
      await fetchOffices()
      toast.success(okMsg)
      return true
    } finally {
      setOfficeSaving(false)
    }
  }

  const saveOffice = async () => {
    const payload = {
      action: officeEditing ? 'update' : 'create',
      officeId: officeEditing?.office_id,
      code: officeForm.code,
      label: officeForm.label,
      address: officeForm.address,
      latitude: officeForm.latitude,
      longitude: officeForm.longitude,
      sort_order: Number(officeForm.sort_order),
    }
    const ok = await callOffice(payload, officeEditing ? '사무실을 수정했습니다.' : '사무실을 추가했습니다.')
    if (ok) closeOfficeForm()
  }

  const toggleOfficeActive = async (o: Office) => {
    if (o.is_active) {
      const ok = await confirmDialog({
        title: '사무실 비활성화',
        message: `${o.label} 사무실을 비활성화합니다. 선택 목록에서 사라지지만 기존 데이터의 표시는 그대로 남습니다.`,
        confirmText: '비활성화',
        variant: 'danger',
      })
      if (!ok) return
      await callOffice({ action: 'deactivate', officeId: o.office_id }, '비활성화했습니다.')
    } else {
      await callOffice({ action: 'activate', officeId: o.office_id }, '다시 사용하도록 바꿨습니다.')
    }
  }

  // 체크박스 하나를 누르면 그 팀의 권한 7개를 통째로 다시 저장한다(저장 버튼 없음).
  // 쿼리·에러 처리는 종전과 같고, 어떤 값을 보낼지만 호출부가 정한다.
  const handleSaveTeamPerm = async (team: Team, perm: TeamPermForm) => {
    setSavingTeamId(team.id)
    const { error } = await supabase.from('teams').update(perm).eq('id', team.id)
    setSavingTeamId(null)
    if (error) {
      console.error('[admin] update team perm failed', error)
      toast.error(`권한 저장에 실패했습니다 (${error.code || error.message})`)
      return
    }
    await fetchTeams()
    toast.success(`'${team.name}' 팀 권한을 저장했습니다`)
  }

  const handleTogglePerm = (team: Team, key: TeamPermField, checked: boolean) =>
    handleSaveTeamPerm(team, { ...teamPermOf(team), [key]: checked })

  const handleDeleteTeam = async (team: Team) => {
    // 퇴사자는 팀 소속이 남아 있어도(과거 실적 집계용) 인원으로 세지 않는다.
    const { count } = await supabase
      .from('engineers')
      .select('engineer_id', { count: 'exact', head: true })
      .eq('teams', team.name)
      .is('resigned_date', null)
    if (count && count > 0) {
      toast.error(`이 팀에 재직 중인 직원이 ${count}명 있습니다. 먼저 직원 팀을 변경해주세요`)
      return
    }
    const ok = await confirmDialog({ title: '팀 삭제', message: `'${team.name}' 팀을 삭제하시겠습니까?`, confirmText: '삭제', variant: 'danger' })
    if (!ok) return
    setDeletingTeam(team.id)
    const { error } = await supabase.from('teams').delete().eq('id', team.id)
    setDeletingTeam(null)
    if (error) {
      console.error('[admin] delete team failed', error)
      toast.error(`팀 삭제에 실패했습니다 (${error.code || error.message})`)
      return
    }
    fetchTeams()
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchTeams() }, [])

  // ── 부대비용 단가 ───────────────────────────────────────────────────────────
  const fetchPresets = async () => {
    setPresetLoading(true)
    const { data } = await supabase.from('expense_presets').select('*').order('display_order')
    setPresets((data as ExpensePreset[]) ?? [])
    setPresetLoading(false)
  }

  const handleAddPreset = async () => {
    if (!presetErr.validate({ itemName: newPreset.itemName.trim() ? null : '항목명을 입력해주세요' })) return
    setAddPresetLoading(true)
    const maxOrder = presets.length > 0 ? Math.max(...presets.map(p => p.display_order)) : 0
    const { error } = await supabase.from('expense_presets').insert({
      item_name: newPreset.itemName.trim(),
      unit_price: parseInt(newPreset.unitPrice) || 0,
      display_order: maxOrder + 1,
      is_active: true,
    })
    setAddPresetLoading(false)
    if (error) { toast.error(error.message); return }
    setNewPreset({ itemName: '', unitPrice: '' })
    fetchPresets()
  }

  const handleSavePreset = async () => {
    if (!editingPreset) return
    if (!presetEditErr.validate({ itemName: editingPreset.itemName.trim() ? null : '항목명을 입력해주세요' })) return
    setSavingPreset(true)
    const { error } = await supabase.from('expense_presets').update({
      item_name: editingPreset.itemName.trim(),
      unit_price: parseInt(editingPreset.unitPrice) || 0,
    }).eq('preset_id', editingPreset.presetId)
    setSavingPreset(false)
    if (error) { toast.error(error.message); return }
    setEditingPreset(null)
    fetchPresets()
  }

  // 견적서는 저장 시점 단가를 quote_expenses 에 복사해 두므로 과거 견적은 영향받지 않는다.
  const handleDeletePreset = async (preset: ExpensePreset) => {
    const ok = await confirmDialog({
      title: '항목 삭제',
      message: `'${preset.item_name}' 항목을 삭제하시겠습니까?\n이미 저장된 견적의 부대비용에는 영향이 없습니다.`,
      confirmText: '삭제', variant: 'danger',
    })
    if (!ok) return
    setDeletingPreset(preset.preset_id)
    const { error } = await supabase.from('expense_presets').delete().eq('preset_id', preset.preset_id)
    setDeletingPreset(null)
    if (error) { toast.error(error.message); return }
    fetchPresets()
  }

  const teamsOptions = teamsList.map(t => t.name)

  const inp: React.CSSProperties = {
    padding: '8px 12px', border: `1px solid ${BORDER}`, borderRadius: 8,
    fontSize: 13, outline: 'none', background: '#fff', boxSizing: 'border-box', width: '100%',
  }

  if (loading || !authorized) return <AccessGate loading={loading} />

  // 목표 금액 관리도 '지금 관리하는 대상' 목록 → 직원 관리 테이블과 동일하게 삭제(resigned_date 있음) 즉시 제외.
  // (과거 기간 집계는 실적 현황이 isActiveInPeriod 로 별도 처리. 여기선 현재 재직자만.)
  const activeEngineers = engineers.filter(e => !e.resigned_date)

  // 팀별 그룹핑 (목표 금액용) — 현재 재직자만
  const teamGroups = activeEngineers.reduce((acc, eng) => {
    const team = eng.teams ?? '미배정'
    if (!acc[team]) acc[team] = []
    acc[team].push(eng)
    return acc
  }, {} as Record<string, Engineer[]>)

  const teamOrder = Object.keys(teamGroups).sort((a, b) => {
    if (a === '미배정') return 1
    if (b === '미배정') return -1
    return a.localeCompare(b)
  })

  const getTeamTotal = (teamEngineers: Engineer[]) =>
    teamEngineers.reduce((s, e) => s + (getTarget(e.engineer_id)?.target_amount || 0), 0)
  const getTeamTotalOrder = (teamEngineers: Engineer[]) =>
    teamEngineers.reduce((s, e) => s + (getTarget(e.engineer_id)?.order_target_amount || 0), 0)
  const totalAllTarget = activeEngineers.reduce((s, e) => s + (getTarget(e.engineer_id)?.target_amount || 0), 0)
  const totalAllOrder = activeEngineers.reduce((s, e) => s + (getTarget(e.engineer_id)?.order_target_amount || 0), 0)

  return (
    <div style={{ background: PAGE_BG, minHeight: '100vh', padding: '32px 24px 24px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>

          <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🎯</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 8 }}>목표 금액 관리</div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>연간 목표 금액을 개인별 / 팀별로 설정하고 수정합니다.</div>
            <button style={{ width: '100%', padding: '10px', background: BLUE, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              onClick={() => { setShowTargetModal(true); setEditingTarget(null); fetchTargetData() }}>관리하기</button>
          </div>

          <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🗑️</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: TEXT }}>견적서 삭제</div>
              {/* 처리할 삭제 요청이 있을 때만 배지를 띄운다 */}
              {pendingDeleteCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 800, color: DANGER, background: '#fef2f2', border: `1px solid ${DANGER}`, borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                  삭제 요청 {pendingDeleteCount}건
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>실수로 저장된 견적서를 조회하고 삭제합니다.</div>
            <button style={{ width: '100%', padding: '10px', background: BLUE, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              onClick={() => { setShowQuoteModal(true); setSearchQuery(''); fetchQuotes() }}>관리하기</button>
          </div>

          <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>👥</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 8 }}>직원 관리</div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>직원 등록, 정보 수정, 관리자 권한, 계정 삭제를 관리합니다.</div>
            <button
              onClick={() => { setShowEngineerModal(true); fetchEngineers(); fetchTeams() }}
              disabled={!isSuperAdmin(currentEngineer)}
              style={{ width: '100%', padding: '10px', background: isSuperAdmin(currentEngineer) ? BLUE : '#9ca3af', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: isSuperAdmin(currentEngineer) ? 'pointer' : 'not-allowed' }}>
              관리하기
            </button>
          </div>

          <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🏢</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 8 }}>사무실 관리</div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>사무실 주소와 좌표를 관리합니다. 길찾기 출발지·동선 지도·직원 소속이 이 값을 함께 씁니다.</div>
            <button
              onClick={() => { setShowOfficeModal(true); fetchOffices() }}
              disabled={!isSuperAdmin(currentEngineer)}
              style={{ width: '100%', padding: '10px', background: isSuperAdmin(currentEngineer) ? BLUE : '#9ca3af', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: isSuperAdmin(currentEngineer) ? 'pointer' : 'not-allowed' }}>
              관리하기
            </button>
          </div>

          <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🏷️</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 8 }}>팀 관리</div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>팀을 추가하거나 삭제합니다. 직원 등록·수정 시 팀 목록에 즉시 반영됩니다.</div>
            <button
              onClick={() => { setShowTeamModal(true); fetchTeams() }}
              disabled={!isSuperAdmin(currentEngineer)}
              style={{ width: '100%', padding: '10px', background: isSuperAdmin(currentEngineer) ? BLUE : '#9ca3af', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: isSuperAdmin(currentEngineer) ? 'pointer' : 'not-allowed' }}>
              관리하기
            </button>
          </div>

          <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🧾</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 8 }}>부대비용 단가</div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>견적서 서비스비의 부대비용 표준 항목과 단가를 관리합니다.</div>
            <button
              onClick={() => { setShowPresetModal(true); setEditingPreset(null); setNewPreset({ itemName: '', unitPrice: '' }); fetchPresets() }}
              disabled={!isSuperAdmin(currentEngineer)}
              style={{ width: '100%', padding: '10px', background: isSuperAdmin(currentEngineer) ? BLUE : '#9ca3af', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: isSuperAdmin(currentEngineer) ? 'pointer' : 'not-allowed' }}>
              관리하기
            </button>
          </div>

          <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 8 }}>가격표 업로드</div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>엑셀 파일을 업로드해서 견적서 가격표를 최신 버전으로 업데이트합니다.</div>
            <button disabled style={{ width: '100%', padding: '10px', background: '#9ca3af', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'not-allowed' }}>업로드하기</button>
            <div style={{ fontSize: 11, color: GRAY, marginTop: 6, textAlign: 'center' }}>준비 중</div>
          </div>

 <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 8 }}>다운로드 로그</div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>견적서 PDF 다운로드 이력을 조회합니다.</div>
            <div style={{ flex: 1 }} />
            <button style={{ width: '100%', padding: '10px', background: BLUE, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              onClick={() => { setShowLogModal(true); fetchLogs() }}>조회하기</button>
          </div>

        </div>
      </div>

      {/* ── 목표 금액 모달 ── */}
      {showTargetModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 680, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>🎯 목표 금액 관리</div>
              <button onClick={() => setShowTargetModal(false)} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 13, color: GRAY, fontWeight: 600 }}>연도</span>
              <select value={targetYear} onChange={e => setTargetYear(Number(e.target.value))} style={{ ...inp, width: 100 }}>
                {[thisYear - 1, thisYear, thisYear + 1].map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
              <span style={{ fontSize: 12, color: GRAY }}>연간 목표 기준 (월/분기는 자동 계산)</span>
            </div>
            <div style={{ background: '#eff6ff', borderRadius: 10, padding: '12px 16px', marginBottom: 16, border: '1px solid #bfdbfe', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: BLUE }}>계측부 전체 목표</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: BLUE }}>수주 ₩{numKR(totalAllOrder)} · 매출 ₩{numKR(totalAllTarget)}</span>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {targetLoading ? <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>불러오는 중...</div> : (
                teamOrder.map(team => (
                  <div key={team} style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '6px 0', borderBottom: `2px solid ${BORDER}` }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{team === '미배정' ? '미배정' : team}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: GRAY }}>소계 수주 ₩{numKR(getTeamTotalOrder(teamGroups[team]))} · 매출 ₩{numKR(getTeamTotal(teamGroups[team]))}</span>
                    </div>
                    {teamGroups[team].map(eng => {
                      const target = getTarget(eng.engineer_id)
                      const isEditing = editingTarget?.engineerId === eng.engineer_id
                      return (
                        <div key={eng.engineer_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: `1px solid #f3f4f6` }}>
                          <div style={{ width: 120, flexShrink: 0 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{eng.name}</span>
                            <span style={{ fontSize: 11, color: GRAY, marginLeft: 6 }}>{eng.position}</span>
                          </div>
                          {isEditing ? (
                            <div style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'flex-end', position: 'relative' }}>
                              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <label style={{ fontSize: 11, fontWeight: 600, color: GRAY }}>수주 목표</label>
                                <input type="number" value={editingTarget.orderAmount}
                                  onChange={e => { setEditingTarget(prev => prev ? { ...prev, orderAmount: e.target.value } : null); targetErr.clearError('amount') }}
                                  onKeyDown={e => e.key === 'Enter' && handleSaveTarget()}
                                  placeholder="선택 입력" style={targetErr.errors.amount ? { ...inp, width: '100%', border: errBorder } : { ...inp, width: '100%' }} />
                              </div>
                              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <label style={{ fontSize: 11, fontWeight: 600, color: GRAY }}>매출 목표</label>
                                <input type="number" value={editingTarget.amount}
                                  onChange={e => { setEditingTarget(prev => prev ? { ...prev, amount: e.target.value } : null); targetErr.clearError('amount') }}
                                  onKeyDown={e => e.key === 'Enter' && handleSaveTarget()}
                                  placeholder="선택 입력" style={targetErr.errors.amount ? { ...inp, width: '100%', border: errBorder } : { ...inp, width: '100%' }} autoFocus />
                              </div>
                              <button onClick={handleSaveTarget} disabled={savingTarget}
                                style={{ padding: '6px 14px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', opacity: savingTarget ? 0.7 : 1, whiteSpace: 'nowrap' }}>
                                {savingTarget ? '...' : '저장'}
                              </button>
                              <button onClick={() => setEditingTarget(null)}
                                style={{ padding: '6px 10px', background: '#f3f4f6', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>취소</button>
                              <FieldError message={targetErr.errors.amount} style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, whiteSpace: 'nowrap' }} />
                            </div>
                          ) : (
                            <>
                              <div style={{ flex: 1 }}>
                                {target ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <div>
                                      <span style={{ fontSize: 11, color: GRAY, marginRight: 6 }}>수주</span>
                                      {target.order_target_amount != null
                                        ? <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>₩{numKR(target.order_target_amount)}</span>
                                        : <span style={{ fontSize: 12, color: '#d1d5db' }}>미설정</span>}
                                    </div>
                                    <div>
                                      <span style={{ fontSize: 11, color: GRAY, marginRight: 6 }}>매출</span>
                                      {target.target_amount != null
                                        ? <><span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>₩{numKR(target.target_amount)}</span><span style={{ fontSize: 11, color: GRAY, marginLeft: 8 }}>월 ₩{numKR(Math.round(target.target_amount / 12))}</span></>
                                        : <span style={{ fontSize: 12, color: '#d1d5db' }}>미설정</span>}
                                    </div>
                                  </div>
                                ) : <span style={{ fontSize: 13, color: '#d1d5db' }}>미설정</span>}
                              </div>
                              <button onClick={() => setEditingTarget({ engineerId: eng.engineer_id, amount: target?.target_amount != null ? String(target.target_amount) : '', orderAmount: target?.order_target_amount != null ? String(target.order_target_amount) : '' })}
                                style={{ padding: '5px 12px', background: '#f3f4f6', border: `1px solid ${BORDER}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap' }}>
                                {target ? '수정' : '설정'}
                              </button>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: GRAY }}>* 수주·매출 목표는 각각 선택 입력이며, 둘 다 비운 채 저장하면 해당 목표가 삭제됩니다</div>
          </div>
        </div>
      )}

      {/* ── 견적서 삭제 모달 ── */}
      {showQuoteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 1000, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>🗑️ 견적서 삭제</div>
                {pendingDeleteCount > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 800, color: DANGER, background: '#fef2f2', border: `1px solid ${DANGER}`, borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap' }}>
                    삭제 요청 {pendingDeleteCount}건
                  </span>
                )}
              </div>
              <button onClick={closeQuoteModal} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchQuotes(searchQuery)}
                placeholder="견적번호로 검색" style={inp} />
              <button onClick={() => fetchQuotes(searchQuery)}
                style={{ padding: '8px 16px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>검색</button>
            </div>
            <div style={{ overflowY: 'auto', overflowX: 'auto', flex: 1 }}>
              {quoteLoading ? <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>불러오는 중...</div> : quotes.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>견적서가 없습니다</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 800 }}>
                  <thead style={{ position: 'sticky', top: 0, background: CARD_BG }}>
                    <tr style={{ borderBottom: `2px solid ${BORDER}` }}>
                      {['견적번호', '날짜', '담당자', '고객사', '금액', '상태', '삭제'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: GRAY, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map(q => {
                      const pending = q.status === DELETE_REQUEST_STATUS
                      return (
                      <Fragment key={q.quote_id}>
                      <tr style={{ borderBottom: pending && q.delete_reason ? 'none' : `1px solid ${BORDER}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}>
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: BLUE, whiteSpace: 'nowrap' }}>{q.quote_number}</td>
                        <td style={{ padding: '10px 12px', color: GRAY, whiteSpace: 'nowrap' }}>{q.quote_date}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{q.engineers?.name || '-'}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{q.customers?.company_name || '-'}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>₩{numKR(q.total_supply)}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: getCategoryColor(SALES_STATUS_COLORS, q.status).bg, color: getCategoryColor(SALES_STATUS_COLORS, q.status).text }}>{q.status}</span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <button onClick={() => handleDeleteQuote(q)} disabled={deleting === q.quote_id}
                            style={{ padding: '4px 12px', background: DANGER, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, opacity: deleting === q.quote_id ? 0.6 : 1 }}>
                            {deleting === q.quote_id ? '삭제 중...' : '삭제'}
                          </button>
                        </td>
                      </tr>
                      {/* 삭제 요청 건은 사유를 아래 줄에 그대로 펼친다 — 표가 좁아 열을 늘리면 사유가 잘린다 */}
                      {pending && q.delete_reason && (
                        <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                          <td colSpan={7} style={{ padding: '0 12px 10px' }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', background: '#fef2f2', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px' }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: DANGER, whiteSpace: 'nowrap' }}>삭제 사유</span>
                              <span style={{ fontSize: 12, color: TEXT, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>{q.delete_reason}</span>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: GRAY }}>* 최근 50건 표시 / 검색으로 더 찾을 수 있습니다</div>
          </div>
        </div>
      )}

      {/* ── 다운로드 로그 모달 ── */}
      {showLogModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 1100, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>📋 다운로드 로그</div>
              <button onClick={() => setShowLogModal(false)} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {logLoading ? <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>불러오는 중...</div> : logs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>로그가 없습니다</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: CARD_BG }}>
                    <tr style={{ borderBottom: `2px solid ${BORDER}` }}>
                      {['일시', '담당자', '견적번호', '고객사', '구분'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: GRAY, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.log_id} style={{ borderBottom: `1px solid ${BORDER}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}>
                        <td style={{ padding: '10px 12px', color: GRAY, whiteSpace: 'nowrap' }}>
                          {new Date(log.downloaded_at).toLocaleString('ko-KR')}
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>
  {log.engineers?.name || (log.action === 'view' ? '(열람자 미확인)' : '-')}
</td>
                        <td style={{ padding: '10px 12px', color: BLUE, fontWeight: 700, whiteSpace: 'nowrap' }}>{log.quote_number}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{log.company_name || '-'}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
  <span style={{
    padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
    background: log.action === 'view' ? '#eff6ff' : '#f0fdf4',
    color: log.action === 'view' ? '#234ea2' : '#16a34a',
  }}>
    {log.action === 'view' ? '열람' : '다운로드'}
  </span>
</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: GRAY }}>* 최근 7일 이내 · 최대 1000건 표시 / 전체 기록은 Supabase에 보관됩니다</div>
          </div>
        </div>
      )}

      {/* ── 직원 관리 모달 ── */}
      {showEngineerModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 1000, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
             <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>👥 직원 관리</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowAddEngineer(true)}
                  style={{ padding: '7px 16px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ 직원 등록</button>
                <button onClick={() => setShowEngineerModal(false)}
                  style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', overflowX: 'auto', flex: 1 }}>
              {engineerLoading ? <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>불러오는 중...</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 800 }}>
                  <thead style={{ position: 'sticky', top: 0, background: CARD_BG }}>
                    <tr style={{ borderBottom: `2px solid ${BORDER}` }}>
                      {['이름', '직책', '팀', '이메일', '이니셜', '권한', '수정', '관리'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: GRAY, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* 삭제된 직원(resigned_date 있음)은 목록에서 완전히 제외. DB 행은 보존. */}
                    {engineers.filter(eng => !eng.resigned_date).map(eng => (
                      <tr key={eng.engineer_id} style={{ borderBottom: `1px solid ${BORDER}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}>
                        <td style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{eng.name}</td>
                        <td style={{ padding: '10px 12px', color: GRAY, whiteSpace: 'nowrap' }}>{eng.position || '-'}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          {eng.teams || '-'}
                        </td>
                        <td style={{ padding: '10px 12px', color: GRAY, whiteSpace: 'nowrap' }}>{eng.email || '-'}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{eng.initials || '-'}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {(() => {
                              const level = eng.permission_level || 'member'
                              const rc = getCategoryColor(ROLE_COLORS, level)
                              const roleLabel = level === 'superadmin' ? '관리자' : '팀원'
                              const badges: { label: string; bg: string; color: string }[] = [{ label: roleLabel, bg: rc.bg, color: rc.text }]
                              return badges.map(b => (
                                <span key={b.label} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: b.bg, color: b.color, whiteSpace: 'nowrap' }}>
                                  {b.label}
                                </span>
                              ))
                            })()}
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <button onClick={() => { setEditEngineer(eng); setEditForm({ name: eng.name, position: eng.position || '사원', teams: eng.teams || '', email: eng.email || '', initials: eng.initials || '', permission_level: eng.permission_level || 'member', office: eng.office || '' }) }}
                            style={{ padding: '4px 12px', background: '#f3f4f6', border: `1px solid ${BORDER}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>수정</button>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <button onClick={() => { const t = new Date().toISOString().slice(0, 10); setResignDate(t); setDeleteEngineer(eng) }}
                            style={{ padding: '4px 12px', background: DANGER, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>삭제</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 직원 등록 모달 ── */}
      {showAddEngineer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, marginBottom: 20 }}>직원 등록</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>이름 *</div>
                <input value={addForm.name} onChange={e => { setAddForm(p => ({ ...p, name: e.target.value })); addEngErr.clearError('name') }} placeholder="예: 홍길동" style={addEngErr.errors.name ? { ...inp, border: errBorder } : inp} />
                <FieldError message={addEngErr.errors.name} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>직책 *</div>
                  {/* 목록 검색 + 직접 입력(목록 외 값도 그대로 저장) */}
                  <AutocompleteInput value={addForm.position} onChange={v => setAddForm(p => ({ ...p, position: v }))} suggestions={POSITIONS} placeholder="직책 선택 또는 직접 입력" style={inp} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>팀 *</div>
                  <select value={addForm.teams} onChange={e => { setAddForm(p => ({ ...p, teams: e.target.value })); addEngErr.clearError('teams') }} style={addEngErr.errors.teams ? { ...inp, border: errBorder } : inp}>
                    <option value="" disabled>팀 선택</option>
                    {teamsOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <FieldError message={addEngErr.errors.teams} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>사무실</div>
                <select value={addForm.office} onChange={e => setAddForm(p => ({ ...p, office: e.target.value }))} style={inp}>
                  <option value="">사무실 미지정</option>
                  {selectableOffices(officeList, addForm.office).map(o => <option key={o.code} value={o.code}>{o.label}{o.is_active ? '' : ' (비활성)'}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>이메일 * (로그인 ID)</div>
                <input value={addForm.email} onChange={e => { setAddForm(p => ({ ...p, email: e.target.value })); addEngErr.clearError('email') }} placeholder="예: hong@accretechkorea.com" style={addEngErr.errors.email ? { ...inp, border: errBorder } : inp} />
                <FieldError message={addEngErr.errors.email} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>초기 비밀번호 *</div>
                <input type="password" value={addForm.password} onChange={e => { setAddForm(p => ({ ...p, password: e.target.value })); addEngErr.clearError('password') }} placeholder="8자 이상" style={addEngErr.errors.password ? { ...inp, border: errBorder } : inp} />
                <FieldError message={addEngErr.errors.password} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>이니셜 * (견적번호용)</div>
                <input value={addForm.initials} onChange={e => { setAddForm(p => ({ ...p, initials: e.target.value })); addEngErr.clearError('initials') }} placeholder="예: HGD" style={addEngErr.errors.initials ? { ...inp, border: errBorder } : inp} maxLength={5} />
                <FieldError message={addEngErr.errors.initials} />
                <div style={{ fontSize: 11, color: GRAY, marginTop: 3 }}>견적번호에 사용됩니다 (예: No.HGD20260511-A)</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => { setShowAddEngineer(false); setAddForm({ name: '', position: '사원', teams: '', email: '', initials: '', password: '', office: '' }) }}
                style={{ flex: 1, padding: '11px', background: '#f3f4f6', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>취소</button>
              <button onClick={handleAddEngineer} disabled={addLoading}
                style={{ flex: 1, padding: '11px', background: BLUE, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', opacity: addLoading ? 0.7 : 1 }}>
                {addLoading ? '등록 중...' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 직원 수정 모달 ── */}
      {editEngineer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 28, width: '100%', maxWidth: 640, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, marginBottom: 20 }}>직원 정보 수정</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>이름 *</div>
                  <input value={editForm.name} onChange={e => { setEditForm(p => ({ ...p, name: e.target.value })); editEngErr.clearError('name') }} style={editEngErr.errors.name ? { ...inp, border: errBorder } : inp} />
                  <FieldError message={editEngErr.errors.name} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>직책</div>
                  {/* 목록 검색 + 직접 입력(목록 외 값도 그대로 저장) */}
                  <AutocompleteInput value={editForm.position} onChange={v => setEditForm(p => ({ ...p, position: v }))} suggestions={POSITIONS} placeholder="직책 선택 또는 직접 입력" style={inp} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>팀 *</div>
                  <select value={editForm.teams} onChange={e => { setEditForm(p => ({ ...p, teams: e.target.value })); editEngErr.clearError('teams') }} style={editEngErr.errors.teams ? { ...inp, border: errBorder } : inp}>
                    <option value="" disabled>팀 선택</option>
                    {teamsOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <FieldError message={editEngErr.errors.teams} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>사무실</div>
                <select value={editForm.office} onChange={e => setEditForm(p => ({ ...p, office: e.target.value }))} style={inp}>
                  <option value="">사무실 미지정</option>
                  {selectableOffices(officeList, editForm.office).map(o => <option key={o.code} value={o.code}>{o.label}{o.is_active ? '' : ' (비활성)'}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>이메일</div>
                <input value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} style={inp} />
              </div>
              {isSuperAdmin(currentEngineer) && (
                <div>
                  <div style={{ fontSize: 12, color: GRAY, marginBottom: 8, fontWeight: 700 }}>권한</div>
                  {/* '팀장'은 폐지. 화면 접근 권한은 팀별 플래그(유지보수 > 팀)에서 정한다. */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                    {([
                      { key: 'superadmin', label: '관리자',   desc: '전체 조회 및 관리자 접근' },
                    ] as const).map(({ key, label, desc }) => {
                      const checked = editForm.permission_level === key
                      const rc = getCategoryColor(ROLE_COLORS, key)
                      return (
                        <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '11px 12px', background: checked ? rc.bg : '#f8fafc', borderRadius: 8, transition: 'all 0.15s' }}>
                          <input type="checkbox" checked={checked}
                            onChange={e => setEditForm(p => ({ ...p, permission_level: e.target.checked ? key : 'member' }))}
                            style={{ width: 15, height: 15, accentColor: rc.text, cursor: 'pointer', marginTop: 2, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: checked ? rc.text : TEXT }}>{label}</div>
                            <div style={{ fontSize: 11, color: GRAY, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => setEditEngineer(null)}
                style={{ flex: 1, padding: '11px', background: '#f3f4f6', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>취소</button>
              <button onClick={handleUpdateEngineer} disabled={editLoading}
                style={{ flex: 1, padding: '11px', background: BLUE, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', opacity: editLoading ? 0.7 : 1 }}>
                {editLoading ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 부대비용 단가 모달 ── */}
      {showPresetModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>🧾 부대비용 단가</div>
              <button onClick={() => { setShowPresetModal(false); setEditingPreset(null) }} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>

            {/* 항목 추가 폼 */}
            <div style={{ background: '#f8fafc', borderRadius: 12, padding: '14px 16px', marginBottom: 16, border: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 10 }}>새 항목 추가</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input value={newPreset.itemName}
                  onChange={e => { setNewPreset(p => ({ ...p, itemName: e.target.value })); presetErr.clearError('itemName') }}
                  onKeyDown={e => e.key === 'Enter' && handleAddPreset()}
                  placeholder="항목명 (예: 숙박비)" style={presetErr.errors.itemName ? { ...inp, flex: 1, border: errBorder } : { ...inp, flex: 1 }} />
                <input type="number" value={newPreset.unitPrice}
                  onChange={e => setNewPreset(p => ({ ...p, unitPrice: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleAddPreset()}
                  placeholder="단가(선택)" style={{ ...inp, width: 130, textAlign: 'right' }} />
                <button onClick={handleAddPreset} disabled={addPresetLoading || !newPreset.itemName.trim()}
                  style={{ padding: '8px 18px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', opacity: (addPresetLoading || !newPreset.itemName.trim()) ? 0.6 : 1 }}>
                  {addPresetLoading ? '...' : '추가'}
                </button>
              </div>
              <FieldError message={presetErr.errors.itemName} />
            </div>

            {/* 항목 목록 */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {presetLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>불러오는 중...</div>
              ) : presets.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>등록된 항목이 없습니다</div>
              ) : presets.map(preset => {
                const isEditing = editingPreset?.presetId === preset.preset_id
                return (
                  <div key={preset.preset_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 4px', borderBottom: `1px solid ${BORDER}` }}>
                    {isEditing ? (
                      <div style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'center', position: 'relative' }}>
                        <input value={editingPreset.itemName} autoFocus
                          onChange={e => { setEditingPreset(prev => prev ? { ...prev, itemName: e.target.value } : null); presetEditErr.clearError('itemName') }}
                          onKeyDown={e => e.key === 'Enter' && handleSavePreset()}
                          style={presetEditErr.errors.itemName ? { ...inp, flex: 1, border: errBorder } : { ...inp, flex: 1 }} />
                        <input type="number" value={editingPreset.unitPrice}
                          onChange={e => setEditingPreset(prev => prev ? { ...prev, unitPrice: e.target.value } : null)}
                          onKeyDown={e => e.key === 'Enter' && handleSavePreset()}
                          placeholder="0" style={{ ...inp, width: 120, textAlign: 'right' }} />
                        <button onClick={handleSavePreset} disabled={savingPreset}
                          style={{ padding: '6px 14px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', opacity: savingPreset ? 0.7 : 1, whiteSpace: 'nowrap' }}>
                          {savingPreset ? '...' : '저장'}
                        </button>
                        <button onClick={() => setEditingPreset(null)}
                          style={{ padding: '6px 10px', background: '#f3f4f6', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>취소</button>
                        <FieldError message={presetEditErr.errors.itemName} style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, whiteSpace: 'nowrap' }} />
                      </div>
                    ) : (
                      <>
                        {/* 항목명·단가 어느 쪽을 눌러도 인라인 수정으로 들어간다 */}
                        <div onClick={() => setEditingPreset({ presetId: preset.preset_id, itemName: preset.item_name, unitPrice: String(preset.unit_price || '') })}
                          style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}>
                          <span style={{ fontWeight: 700, fontSize: 15, color: TEXT }}>{preset.item_name}</span>
                        </div>
                        <div onClick={() => setEditingPreset({ presetId: preset.preset_id, itemName: preset.item_name, unitPrice: String(preset.unit_price || '') })}
                          title="클릭하여 수정"
                          style={{ width: 120, textAlign: 'right', cursor: 'pointer', flexShrink: 0 }}>
                          {preset.unit_price > 0
                            ? <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>₩{numKR(preset.unit_price)}</span>
                            : <span style={{ fontSize: 13, color: GRAY }}>미정</span>}
                        </div>
                        <button onClick={() => handleDeletePreset(preset)} disabled={deletingPreset === preset.preset_id}
                          style={{ padding: '4px 14px', background: DANGER, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, flexShrink: 0, opacity: deletingPreset === preset.preset_id ? 0.6 : 1 }}>
                          {deletingPreset === preset.preset_id ? '삭제 중...' : '삭제'}
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: GRAY }}>* 항목명이나 단가를 클릭하면 바로 수정할 수 있습니다. 단가를 바꿔도 이미 저장된 견적서 금액은 변하지 않습니다</div>
          </div>
        </div>
      )}

      {/* ── 팀 관리 모달 ── */}
      {showOfficeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 1000, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>🏢 사무실 관리</div>
              <button onClick={() => { setShowOfficeModal(false); closeOfficeForm() }} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>

            {/* 추가·수정 폼 — 어쩌다 한 번 쓰므로 접어 둔다. */}
            {!officeAddOpen ? (
              <button onClick={openOfficeAdd} disabled={!isSuperAdmin(currentEngineer)}
                style={{ padding: '9px 16px', background: '#f3f4f6', color: TEXT, border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', marginBottom: 16, alignSelf: 'flex-start' }}>
                + 새 사무실 추가
              </button>
            ) : (
              <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 12 }}>
                  {officeEditing ? `${officeEditing.label} 수정` : '새 사무실'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>코드 *</div>
                    <input value={officeForm.code} disabled={!!officeEditing}
                      onChange={e => setOfficeForm(f => ({ ...f, code: e.target.value }))}
                      placeholder="예: busan"
                      style={{ ...inp, background: officeEditing ? '#f3f4f6' : '#fff', color: officeEditing ? GRAY : TEXT }} />
                    <div style={{ fontSize: 11, color: GRAY, marginTop: 4, lineHeight: 1.6 }}>
                      {officeEditing
                        ? '코드는 직원 소속(engineers.office)이 참조하는 값이라 수정할 수 없습니다.'
                        : '영문 소문자·숫자·하이픈. 만든 뒤에는 바꿀 수 없습니다.'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>이름 *</div>
                    <input value={officeForm.label} onChange={e => setOfficeForm(f => ({ ...f, label: e.target.value }))} placeholder="예: 부산" style={inp} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>표시 순서</div>
                    <input type="number" value={officeForm.sort_order} onChange={e => setOfficeForm(f => ({ ...f, sort_order: e.target.value }))} style={inp} />
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>주소 *</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={officeForm.address} onChange={e => setOfficeForm(f => ({ ...f, address: e.target.value }))}
                      placeholder="도로명 또는 지번 주소" style={{ ...inp, flex: 1 }} />
                    <button onClick={runGeocode} disabled={geoState.busy}
                      style={{ padding: '9px 14px', background: geoState.busy ? '#9ca3af' : '#f3f4f6', color: geoState.busy ? '#fff' : TEXT, border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: geoState.busy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                      {geoState.busy ? '변환 중...' : '좌표 찾기'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>위도</div>
                    <input value={officeForm.latitude} onChange={e => setOfficeForm(f => ({ ...f, latitude: e.target.value }))} placeholder="-90 ~ 90" style={inp} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>경도</div>
                    <input value={officeForm.longitude} onChange={e => setOfficeForm(f => ({ ...f, longitude: e.target.value }))} placeholder="-180 ~ 180" style={inp} />
                  </div>
                </div>
                {geoState.message && (
                  <div style={{ fontSize: 12, color: GRAY, marginTop: 8, lineHeight: 1.6 }}>{geoState.message}</div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                  <button onClick={closeOfficeForm} disabled={officeSaving}
                    style={{ padding: '9px 16px', background: '#fff', color: GRAY, borderRadius: 8, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>취소</button>
                  <button onClick={saveOffice} disabled={officeSaving}
                    style={{ padding: '9px 18px', background: officeSaving ? '#9ca3af' : BLUE, color: '#fff', borderRadius: 8, border: 'none', cursor: officeSaving ? 'default' : 'pointer', fontWeight: 700, fontSize: 13 }}>
                    {officeSaving ? '저장 중...' : '저장'}</button>
                </div>
              </div>
            )}

            {/* 목록 */}
            <div style={{ overflowY: 'auto', border: `1px solid ${BORDER}`, borderRadius: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: OFFICE_GRID, alignItems: 'center', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: `1px solid ${BORDER}`, fontSize: 11, fontWeight: 700, color: GRAY }}>
                <div>코드</div><div>이름</div><div>주소</div><div>좌표</div><div>순서</div><div>사용</div><div />
              </div>
              {officesLoading && officeList.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: GRAY, fontSize: 13 }}>불러오는 중...</div>
              ) : officeList.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: GRAY, fontSize: 13 }}>등록된 사무실이 없습니다</div>
              ) : officeList.map(o => (
                <div key={o.office_id} style={{ display: 'grid', gridTemplateColumns: OFFICE_GRID, alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 12, color: o.is_active ? TEXT : GRAY }}>
                  <div style={{ fontWeight: 700 }}>{o.code}</div>
                  <div>{o.label}</div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.address}>{o.address}</div>
                  <div style={{ color: o.latitude == null ? '#9ca3af' : undefined }}>
                    {o.latitude == null || o.longitude == null ? '좌표 없음' : `${o.latitude}, ${o.longitude}`}
                  </div>
                  <div>{o.sort_order}</div>
                  <div>{o.is_active ? '사용' : '중지'}</div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => openOfficeEdit(o)} disabled={officeSaving}
                      style={{ padding: '5px 10px', background: '#f3f4f6', color: TEXT, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>수정</button>
                    <button onClick={() => toggleOfficeActive(o)} disabled={officeSaving}
                      style={{ padding: '5px 10px', background: o.is_active ? DANGER : '#f3f4f6', color: o.is_active ? '#fff' : TEXT, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {o.is_active ? '비활성화' : '다시 사용'}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showTeamModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          {/* 팀 목록이 본체라 다른 모달보다 넓게 쓴다(이 모달에만 적용) */}
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 1000, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>🏷️ 팀 관리</div>
              <button onClick={closeTeamModal} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>

            {/* 팀 추가 — 어쩌다 한 번 쓰므로 접어 둔다. 펼친 내용은 종전과 같다. */}
            {!addTeamOpen ? (
              <button onClick={() => setAddTeamOpen(true)} disabled={!isSuperAdmin(currentEngineer)}
                style={{
                  alignSelf: 'flex-start', marginBottom: 14, padding: '7px 14px',
                  background: '#f3f4f6', color: GRAY, border: 'none', borderRadius: 6,
                  cursor: isSuperAdmin(currentEngineer) ? 'pointer' : 'not-allowed',
                  fontSize: 12, fontWeight: 700, opacity: isSuperAdmin(currentEngineer) ? 1 : 0.6,
                }}>
                + 새 팀 추가
              </button>
            ) : (
            <div style={{ background: '#f8fafc', borderRadius: 12, padding: '14px 16px', marginBottom: 16, border: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 10 }}>새 팀 추가</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input value={newTeamName} onChange={e => { setNewTeamName(e.target.value); teamErr.clearError('teamName') }}
                  onKeyDown={e => e.key === 'Enter' && handleAddTeam()}
                  placeholder="팀 이름 (예: Apps., 5)" style={teamErr.errors.teamName ? { ...inp, flex: 1, border: errBorder } : { ...inp, flex: 1 }} />
                <button onClick={handleAddTeam} disabled={addTeamLoading || !newTeamName.trim() || !isSuperAdmin(currentEngineer)}
                  style={{ padding: '8px 18px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', opacity: (addTeamLoading || !newTeamName.trim() || !isSuperAdmin(currentEngineer)) ? 0.6 : 1 }}>
                  {addTeamLoading ? '...' : '추가'}
                </button>
              </div>
              <FieldError message={teamErr.errors.teamName} />
              {permCheckboxes(newTeamPerm, setNewTeamPerm)}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button onClick={() => { setAddTeamOpen(false); setNewTeamName(''); setNewTeamPerm(EMPTY_TEAM_PERM); teamErr.clearError('teamName') }}
                  style={{ padding: '6px 14px', background: '#f3f4f6', color: GRAY, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                  취소
                </button>
              </div>
            </div>
            )}

            {/* 팀 목록 — 한 행에 한 팀. 권한 6개가 모든 행에서 같은 열에 오도록 격자로 그린다.
                체크박스는 누르는 즉시 저장된다(저장 버튼 없음).
                각 권한이 어떤 화면을 여는지는 열 제목의 툴팁으로 뺐다 — 표를 좁게 유지하기 위해서다. */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {teamLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>불러오는 중...</div>
              ) : teamsList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>등록된 팀이 없습니다</div>
              ) : (
                <>
                  {/* 열 제목 — 스크롤이 생겨도 남아 있도록 붙여 둔다 */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: TEAM_GRID, alignItems: 'center',
                    padding: '0 4px 8px', borderBottom: `1px solid ${BORDER}`,
                    position: 'sticky', top: 0, background: CARD_BG, zIndex: 1,
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af' }}>팀</span>
                    {TEAM_PERM_FIELDS.map(f => (
                      <span key={f.key} title={f.desc}
                        style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textAlign: 'center', cursor: 'help' }}>
                        {f.label}
                      </span>
                    ))}
                    <span />
                  </div>

                  {teamsList.map(team => (
                    <div key={team.id} style={{
                      display: 'grid', gridTemplateColumns: TEAM_GRID, alignItems: 'center',
                      padding: '9px 4px', borderBottom: `1px solid ${BORDER}`,
                    }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {team.name}
                      </span>
                      {TEAM_PERM_FIELDS.map(f => (
                        <span key={f.key} style={{ display: 'flex', justifyContent: 'center' }}>
                          <input type="checkbox"
                            checked={team[f.key] === true}
                            disabled={!isSuperAdmin(currentEngineer) || savingTeamId === team.id}
                            onChange={e => handleTogglePerm(team, f.key, e.target.checked)}
                            style={{ width: 15, height: 15, accentColor: BLUE, cursor: isSuperAdmin(currentEngineer) ? 'pointer' : 'not-allowed' }} />
                        </span>
                      ))}
                      <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button onClick={() => handleDeleteTeam(team)} disabled={deletingTeam === team.id}
                          style={{ padding: '4px 12px', background: DANGER, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, opacity: deletingTeam === team.id ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                          {deletingTeam === team.id ? '삭제 중...' : '삭제'}
                        </button>
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: GRAY, lineHeight: 1.7 }}>
              * 재직 중인 직원이 배정된 팀은 삭제할 수 없습니다<br />
              * 권한 변경은 서버(API·RLS)에 즉시 반영됩니다. 다만 화면 메뉴는 브라우저가 팀 권한을 세션당 한 번만 읽어 두므로, 해당 사용자가 새로고침해야 보입니다
            </div>
          </div>
        </div>
      )}

      {/* ── 직원 삭제 모달 ── */}
      {deleteEngineer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 16, padding: 28, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, marginBottom: 12 }}>직원 삭제</div>
            <div style={{ fontSize: 14, color: GRAY, lineHeight: 1.8, marginBottom: 16 }}>
              <b style={{ color: TEXT }}>{deleteEngineer.name}</b> ({deleteEngineer.position}) 직원을 삭제하시겠습니까?<br />
              <span style={{ fontSize: 13, color: GRAY }}>
                로그인이 차단되고 직원 목록에서 사라집니다.<br />
                과거 견적·활동 기록의 작성자 이름은 그대로 남습니다.<br />
                되돌릴 수 없으며, 다시 근무하게 되면 직원 등록으로 새로 만들어야 합니다.
              </span>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: TEXT, display: 'block', marginBottom: 6 }}>삭제일</label>
              <input type="date" value={resignDate} onChange={e => { setResignDate(e.target.value); resignErr.clearError('resignDate') }}
                style={resignErr.errors.resignDate ? { ...inp, width: '100%', colorScheme: 'light', border: errBorder } : { ...inp, width: '100%', colorScheme: 'light' }} />
              <FieldError message={resignErr.errors.resignDate} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setDeleteEngineer(null)}
                style={{ flex: 1, padding: '11px', background: '#f3f4f6', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>취소</button>
              <button onClick={handleDeleteEngineer} disabled={deleteLoading}
                style={{ flex: 1, padding: '11px', background: DANGER, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', opacity: deleteLoading ? 0.7 : 1 }}>
                {deleteLoading ? '처리 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// useSearchParams 는 Suspense 경계가 필요하다(재고·견적 화면과 같은 패턴).
export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminPageInner />
    </Suspense>
  )
}
