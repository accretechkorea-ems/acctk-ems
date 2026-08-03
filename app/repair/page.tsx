'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRepairs, type Repair, type RepairStatus } from '@/hooks/useRepairs'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { canAccess20 } from '@/lib/permissions'
import RepairEditModal from '@/components/repair/RepairEditModal'
import SegmentedControl from '@/components/common/SegmentedControl'
import AutocompleteInput from '@/components/common/AutocompleteInput'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/common/Toast'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { REPAIR_STATUS_COLORS } from '@/lib/categoryColors'

// ── 색상 (기존 페이지 컨벤션과 동일) ──
const BLUE = '#234ea2'
const GREEN = '#15803d'
const ORANGE = '#d97706'
const RED = '#dc2626'
const PAGE_BG = '#f4f5f7'
const CARD_BG = '#ffffff'
const BORDER = '#ebebeb'
const TEXT = '#111827'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'
const ACTIVE_BG = '#f1f1f1' // 필터 활성 배경 (중립)

// 목록 컬럼 폭 (한 곳에만 정의 — 수리 진행 중 블록·전체 목록이 동일하게 참조)
// 순번·구분·입고일·회사명·제품구분·시리얼번호·출고일·상태·수정
const COL_WIDTHS = [52, 58, 104, 174, 148, 140, 104, 176, 44]

// 자동완성 후보: 빈 값·null 제외, 사용 빈도 높은 순 정렬
const freqSorted = (values: (string | null | undefined)[]): string[] => {
  const count = new Map<string, number>()
  for (const v of values) {
    const s = (v ?? '').trim()
    if (!s) continue
    count.set(s, (count.get(s) ?? 0) + 1)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s)
}

// 현재 상태에서 누를 수 있는 다음 단계 (버튼 라벨 → 전환될 상태)
const NEXT_ACTION: Partial<Record<RepairStatus, { label: string; next: RepairStatus }>> = {
  '입고': { label: '수리 시작', next: '수리중' },
  '수리중': { label: '수리 완료', next: '출고대기' },
  '출고대기': { label: '출고', next: '출고완료' },
}

// 구분 (게이지 / 앰프)
type Category = '게이지' | '앰프'
const CATEGORIES: Category[] = ['게이지', '앰프']

// ── 날짜 유틸 ──
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const monthKey = (dateStr: string | null) => (dateStr ? dateStr.slice(0, 7) : '') // YYYY-MM
const fmtMonthLabel = (ym: string) => `${Number(ym.slice(5, 7))}월`
const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
// 입고일 → "N월 M주차" (그 달의 몇 번째 주)
const fmtWeek = (dateStr: string | null) => {
  if (!dateStr) return '-'
  const [, m, d] = dateStr.split('-').map(Number)
  if (!m || !d) return '-'
  return `${m}월 ${Math.ceil(d / 7)}주차`
}

// ── 엑셀 파싱 유틸 ──
type ExcelRow = Record<string, string | number | null>
type RepairInsert = {
  received_date: string; customer_name: string; product_type: string | null
  serial_number: string | null; item_type: Category; status: RepairStatus; shipped_date: string | null
  repair_content: string | null; created_by: number
}
const pad2 = (n: number) => String(n).padStart(2, '0')
// 엑셀 셀 → 'YYYY-MM-DD'. 엑셀 날짜 시리얼 / "1월 5일" / "2026-01-05" / "1/5" 지원. 실패 시 null.
const parseFlexDate = (val: string | number | null | undefined, year: number): string | null => {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number') {
    const ms = Math.round((val - 25569) * 86400 * 1000)
    return new Date(ms).toISOString().split('T')[0]
  }
  const s = String(val).trim()
  if (!s) return null
  let m = s.match(/(\d{4})[-.\/]\s*(\d{1,2})[-.\/]\s*(\d{1,2})/)
  if (m) return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`
  m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/)
  if (m) return `${year}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}`
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})$/)
  if (m) return `${year}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}`
  return null
}
const impTh: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontWeight: 700, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#f8f9fb' }
const impTd: React.CSSProperties = { padding: '7px 10px', color: '#111113', whiteSpace: 'nowrap' }

export default function RepairPage() {
  const supabase = createClient()
  const router = useRouter()
  const confirmDialog = useConfirm()
  const toast = useToast()
  const { errors, clearError, validate } = useFieldErrors<'customerName'>()

  const { engineer: currentEngineer, loading: guardLoading, authorized } = usePageGuard(canAccess20)
  const { repairs, loading, refetch } = useRepairs()

  // ── 접수 등록 폼 ──
  const [receivedDate, setReceivedDate] = useState(todayStr())
  const [customerName, setCustomerName] = useState('')
  const [productType, setProductType] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [formCategory, setFormCategory] = useState<Category>('게이지')
  const [isSaving, setIsSaving] = useState(false)

  // ── 목록 필터 / 페이지 ──
  const [statusFilter, setStatusFilter] = useState<'전체' | RepairStatus>('전체')
  const [categoryFilter, setCategoryFilter] = useState<'전체' | Category>('전체')
  const [searchInput, setSearchInput] = useState('') // 입력창 로컬 값 (버튼/Enter 로만 반영)
  const [search, setSearch] = useState('')            // 실제 필터에 적용된 검색어
  const [dateBasis, setDateBasis] = useState<'received' | 'shipped'>('received')
  const [dateMonth, setDateMonth] = useState('')      // YYYY-MM (단일 월, 비면 필터 없음)
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Repair | null>(null)
  const [isEditSaving, setIsEditSaving] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false) // 검색 줄 열림/닫힘 (초기 닫힘)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // ── KPI '출고완료' 카드 + 그래프 기준 월 ──
  const [viewMonth, setViewMonth] = useState(monthKey(todayStr()))

  // ── 엑셀 일괄 등록 ──
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState<ExcelRow[]>([])
  const [importFileName, setImportFileName] = useState('')
  const [importYear, setImportYear] = useState(new Date().getFullYear())
  const [importCategory, setImportCategory] = useState<Category>('게이지')
  const [isImporting, setIsImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ ok: number; fail: number } | null>(null)

  // 필터 변경 시 첫 페이지로
  useEffect(() => { setPage(0) }, [statusFilter, categoryFilter, search, dateBasis, dateMonth])

  // ── 접수 등록 ──
  const handleSubmit = async () => {
    if (!currentEngineer) return
    const ok = validate({ customerName: customerName.trim() ? null : '회사명을 입력해주세요' })
    if (!ok) return
    setIsSaving(true)
    const { error } = await supabase.from('repairs').insert({
      received_date: receivedDate,
      customer_name: customerName.trim(),
      product_type: productType.trim() || null,
      serial_number: serialNumber.trim() || null,
      item_type: formCategory,
      status: '입고',
      created_by: currentEngineer.engineer_id,
    })
    setIsSaving(false)
    if (error) { toast.error('등록 중 오류가 발생했습니다: ' + error.message); return }
    // 폼 초기화
    setCustomerName('')
    setProductType('')
    setSerialNumber('')
    setReceivedDate(todayStr())
    await refetch()
  }

  // ── 상태 전진 + 단계별 시각 기록 ──
  const advanceStatus = async (r: Repair, next: RepairStatus) => {
    const nowIso = new Date().toISOString()
    const patch: Partial<Repair> = { status: next }
    if (next === '수리중') patch.repair_started_at = nowIso
    else if (next === '출고대기') patch.repair_done_at = nowIso
    else if (next === '출고완료') { patch.shipped_date = todayStr() }
    const { error } = await supabase.from('repairs').update(patch).eq('repair_id', r.repair_id)
    if (error) { toast.error('상태 변경 실패: ' + error.message); return }
    await refetch()
  }

  const handleDelete = async (r: Repair) => {
    const ok = await confirmDialog({ title: '접수 건 삭제', message: `'${r.customer_name ?? ''} / ${r.serial_number ?? '-'}' 접수 건을 삭제하시겠습니까?`, confirmText: '삭제', variant: 'danger' })
    if (!ok) return
    const { error } = await supabase.from('repairs').delete().eq('repair_id', r.repair_id)
    if (error) { toast.error('삭제 실패: ' + error.message); return }
    setEditing(null)
    await refetch()
  }

  // ── 수정 저장 (타임스탬프 정리는 RepairEditModal 의 buildPatch 에서 처리한 patch 를 그대로 적용) ──
  const handleEditSave = async (repairId: number, patch: Record<string, unknown>) => {
    setIsEditSaving(true)
    const { error } = await supabase.from('repairs').update(patch).eq('repair_id', repairId)
    setIsEditSaving(false)
    if (error) { toast.error('수정 실패: ' + error.message); return }
    setEditing(null)
    await refetch()
  }

  // ── 엑셀 일괄 등록 ──
  const openImport = () => { setShowImport(true); setImportRows([]); setImportFileName(''); setImportResult(null) }
  const handleImportFile = (file: File) => {
    import('xlsx').then((XLSX) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const wb = XLSX.read(e.target?.result, { type: 'binary' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        // 배열 형태로 읽어 실제 헤더 행을 이름으로 탐색 (제목/빈 행/빈 열 대응)
        const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, blankrows: false, defval: null })
        const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, '')
        let headerIdx = -1
        for (let i = 0; i < aoa.length; i++) {
          const cells = (aoa[i] || []).map(norm)
          if (cells.some(c => c.includes('입고일')) && cells.some(c => /회사명|업체|고객/.test(c))) { headerIdx = i; break }
        }
        if (headerIdx === -1) {
          toast.error('헤더(입고일·회사명 …)를 찾지 못했습니다. 시트 형식을 확인해주세요')
          setImportRows([]); setImportFileName(file.name); setImportResult(null)
          return
        }
        const header = (aoa[headerIdx] || []).map(norm)
        const findCol = (...keys: RegExp[]) => header.findIndex(h => keys.some(k => k.test(h)))
        const col = {
          입고일: findCol(/입고일/, /^입고$/),
          회사명: findCol(/회사명/, /업체/, /고객/),
          제품: findCol(/제품/),
          시리얼: findCol(/시리얼/),
          출고일: findCol(/출고일/, /^출고$/),
        }
        const get = (r: (string | number | null)[], idx: number) => (idx >= 0 ? (r[idx] ?? null) : null)
        const rows: ExcelRow[] = []
        for (let i = headerIdx + 1; i < aoa.length; i++) {
          const r = aoa[i] || []
          const obj: ExcelRow = {
            '입고일': get(r, col.입고일),
            '회사명': get(r, col.회사명),
            '제품 구분': get(r, col.제품),
            '시리얼번호': get(r, col.시리얼),
            '출고일': get(r, col.출고일),
          }
          if (Object.values(obj).every(v => v === null || String(v).trim() === '')) continue
          rows.push(obj)
        }
        setImportRows(rows)
        setImportFileName(file.name)
        setImportResult(null)
      }
      reader.readAsBinaryString(file)
    })
  }
  const handleImport = async () => {
    if (!currentEngineer || importRows.length === 0) return
    setIsImporting(true)
    const payload: RepairInsert[] = []
    let fail = 0
    for (const row of importRows) {
      const received = parseFlexDate(row['입고일'], importYear)
      const customer = String(row['회사명'] ?? row['고객사'] ?? '').trim()
      if (!received || !customer) { fail++; continue }
      const shipRaw = row['출고일']
      const shipped = parseFlexDate(shipRaw, importYear)
      const shipHasValue = shipRaw !== undefined && shipRaw !== null && String(shipRaw).trim() !== ''
      payload.push({
        received_date: received,
        customer_name: customer,
        product_type: String(row['제품 구분'] ?? row['제품구분'] ?? '').trim() || null,
        serial_number: String(row['시리얼번호'] ?? row['시리얼'] ?? '').trim() || null,
        item_type: importCategory,
        status: shipHasValue ? '출고완료' : '입고',
        shipped_date: shipped,
        repair_content: (shipHasValue && !shipped) ? String(shipRaw).trim() : null,
        created_by: currentEngineer.engineer_id,
      })
    }
    let ok = 0
    if (payload.length > 0) {
      const { data, error } = await supabase.from('repairs').insert(payload).select('repair_id')
      if (error) { setIsImporting(false); toast.error('가져오기 오류: ' + error.message); return }
      ok = data?.length ?? payload.length
    }
    setIsImporting(false)
    setImportResult({ ok, fail })
    await refetch()
  }

  // ── KPI (건수 기준) ──
  const countBy = (pred: (r: Repair) => boolean) => repairs.filter(pred).length

  const kpiHeld = countBy(r => r.status !== '출고완료') // 보유 수리품 (입고+수리중+출고대기)
  const kpiRepairing = countBy(r => r.status === '수리중')
  const kpiWaiting = countBy(r => r.status === '출고대기')
  const kpiShippedThisMonth = countBy(r => r.status === '출고완료' && monthKey(r.shipped_date) === viewMonth)

  // ── 목록 필터 (구분·상태·검색·날짜 AND 조합, 클라이언트 처리) ──
  const searchTerms = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search]
  )
  const hasFilter =
    statusFilter !== '전체' || categoryFilter !== '전체' ||
    searchTerms.length > 0 || dateMonth !== ''

  // 입력창에 값이 있고 아직 적용 전이면 검색 버튼 강조
  const searchPending = searchInput.trim() !== '' && searchInput !== search
  const applySearch = () => setSearch(searchInput)
  const resetSearchAndDate = () => { setSearchInput(''); setSearch(''); setDateBasis('received'); setDateMonth('') }

  // 검색어 또는 월 필터가 실제로 적용돼 있으면 아이콘에 활성 점 표시
  const searchActive = search.trim() !== '' || dateMonth !== ''
  // 아이콘 토글: 열릴 때 입력창 포커스
  const toggleSearch = () => {
    setSearchOpen(open => {
      if (!open) setTimeout(() => searchInputRef.current?.focus(), 220)
      return !open
    })
  }

  const filteredRepairs = useMemo(
    () => repairs.filter(r => {
      if (statusFilter !== '전체' && r.status !== statusFilter) return false
      if (categoryFilter !== '전체' && r.item_type !== categoryFilter) return false

      // 검색: customer_name · product_type · serial_number 부분 일치, 여러 단어는 AND
      if (searchTerms.length > 0) {
        const haystack = [r.customer_name, r.product_type, r.serial_number]
          .filter(Boolean).join(' ').toLowerCase()
        if (!searchTerms.every(t => haystack.includes(t))) return false
      }

      // 날짜: 기준(입고일/출고일) 필드가 선택한 그 달(1일 ~ 말일)에 속하는지
      if (dateMonth) {
        const field = dateBasis === 'received' ? r.received_date : r.shipped_date
        if (!field) return false // 출고일 기준일 때 미출고(null) 제외
        if (field.slice(0, 7) !== dateMonth) return false
      }
      return true
    }),
    [repairs, statusFilter, categoryFilter, searchTerms, dateBasis, dateMonth]
  )

  // 페이지네이션 (50개씩)
  const PAGE_SIZE = 50
  const totalPages = Math.max(1, Math.ceil(filteredRepairs.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages - 1)
  const pagedRepairs = filteredRepairs.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE)

  // 수리 진행 중(수리중) — 항상 상단 고정 표시 (구분 필터는 반영)
  const repairingList = repairs.filter(r => r.status === '수리중' && (categoryFilter === '전체' || r.item_type === categoryFilter))
  // 출고 대기 — 항상 상단 고정 표시 (구분 필터는 반영, 수리 진행 중과 동일 방식)
  const waitingList = repairs.filter(r => r.status === '출고대기' && (categoryFilter === '전체' || r.item_type === categoryFilter))

  // ── 순번 (자동): 입고일 내림차순 목록에서 최신이 큰 번호 ──
  const seqMap = useMemo(() => {
    const m = new Map<number, number>()
    repairs.forEach((r, i) => m.set(r.repair_id, repairs.length - i))
    return m
  }, [repairs])

  // ── 자동완성 후보 (이미 로드된 repairs 에서 고유값 추출, 별도 쿼리 없음) ──
  const customerNameOptions = useMemo(() => freqSorted(repairs.map(r => r.customer_name)), [repairs])
  const productTypeOptions = useMemo(() => freqSorted(repairs.map(r => r.product_type)), [repairs])

  // ── 엑셀 미리보기 ──
  const importPreview = useMemo(() => importRows.map(row => {
    const received = parseFlexDate(row['입고일'], importYear)
    const customer = String(row['회사명'] ?? row['고객사'] ?? '').trim()
    const shipRaw = row['출고일']
    const shipped = parseFlexDate(shipRaw, importYear)
    const shipHasValue = shipRaw !== undefined && shipRaw !== null && String(shipRaw).trim() !== ''
    return {
      received, customer,
      product: String(row['제품 구분'] ?? row['제품구분'] ?? '').trim(),
      serial: String(row['시리얼번호'] ?? row['시리얼'] ?? '').trim(),
      shipped, shipRaw: shipHasValue ? String(shipRaw).trim() : '',
      status: (shipHasValue ? '출고완료' : '입고') as RepairStatus,
      valid: !!received && !!customer,
    }
  }), [importRows, importYear])
  const importValidCount = importPreview.filter(p => p.valid).length

  // ── 렌더 게이트 ──
  if (!authorized) return <AccessGate loading={guardLoading} />

  const card: React.CSSProperties = { background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }
  const inp: React.CSSProperties = { width: '100%', height: 36, padding: '0 11px', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 14, outline: 'none', background: '#fff', color: TEXT, boxSizing: 'border-box' }
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: MUTED }
  const fieldGroup: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }

  // 목록 행 (고정 블록·페이지 목록 공용)
  const repairRow = (r: Repair) => {
    return (
    <tr key={r.repair_id} style={{ borderBottom: `1px solid ${BORDER}` }}>
      <td style={{ ...td, textAlign: 'center', color: GRAY }}>{seqMap.get(r.repair_id)}</td>
      <td style={{ ...td, textAlign: 'center' }}>
        <span style={{ fontSize: 13, color: GRAY }}>{r.item_type || '-'}</span>
      </td>
      <td style={td}>{r.received_date}</td>
      <td style={{ ...td, fontWeight: 600, color: TEXT }}>{r.customer_name}</td>
      <td style={td}>{r.product_type || '-'}</td>
      <td style={td}>{r.serial_number || '-'}</td>
      <td style={{ ...td, textAlign: 'center', color: GRAY }}>{r.shipped_date || '-'}</td>
      <td style={{ ...td, overflow: 'visible' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', width: 76, flexShrink: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: REPAIR_STATUS_COLORS[r.status], flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: TEXT }}>{r.status}</span>
          </span>
          {r.repair_content ? (
            <span style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              <span style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>{r.repair_content}</span>
            </span>
          ) : NEXT_ACTION[r.status] ? (
            <span style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              <button onClick={() => advanceStatus(r, NEXT_ACTION[r.status]!.next)}
                style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', color: GRAY, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {NEXT_ACTION[r.status]!.label}
              </button>
            </span>
          ) : null}
        </div>
      </td>
      <td style={{ ...td, textAlign: 'center' }}>
        <button onClick={() => setEditing(r)} title="수정"
          onMouseEnter={(e) => (e.currentTarget.style.color = '#234ea2')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#9ca3af')}
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9ca3af', display: 'inline-flex', alignItems: 'center', padding: 0, transition: 'color 0.15s ease' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </td>
    </tr>
    )
  }

  const renderTable = (list: Repair[]) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1000, tableLayout: 'fixed' }}>
        <colgroup>{COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr style={{ borderBottom: '1px solid #d1d5db', color: TEXT, fontSize: 13 }}>
            <th style={{ ...th, textAlign: 'center' }}>순번</th>
            <th style={{ ...th, textAlign: 'center' }}>구분</th>
            <th style={th}>입고일</th>
            <th style={th}>회사명</th>
            <th style={th}>제품 구분</th>
            <th style={th}>시리얼번호</th>
            <th style={{ ...th, textAlign: 'center' }}>출고일</th>
            <th style={th}>상태</th>
            <th style={{ ...th, textAlign: 'center' }}></th>
          </tr>
        </thead>
        <tbody>{list.map(repairRow)}</tbody>
      </table>
    </div>
  )

  return (
    <div style={{ background: PAGE_BG, minHeight: 'calc(100vh - 44px)', padding: 20, boxSizing: 'border-box' }}>
      <style jsx global>{`
        select { appearance: none; -webkit-appearance: none; -moz-appearance: none; }
      `}</style>

      <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ── KPI 카드 (+ 대시보드 이동) ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }} className="repair-kpi">
          <div style={card}>
            <div style={{ fontSize: 12, color: MUTED, fontWeight: 600, marginBottom: 6 }}>보유 수리품</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: TEXT, lineHeight: 1 }}>
              {kpiHeld}<span style={{ fontSize: 13, fontWeight: 700, color: MUTED, marginLeft: 3 }}>건</span>
            </div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 6, fontWeight: 600 }}>입고 + 수리중 + 출고대기</div>
          </div>
          <KpiCard title="수리중" value={kpiRepairing} unit="건" />
          <KpiCard title="출고 대기" value={kpiWaiting} unit="건" sub="수리 완료" />
          <div style={{ ...card, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>{fmtMonthLabel(viewMonth)} 출고완료</span>
              <span style={{ display: 'flex', gap: 4 }}>
                <MonthBtn onClick={() => setViewMonth(m => shiftMonth(m, -1))}>◀</MonthBtn>
                <MonthBtn onClick={() => setViewMonth(m => shiftMonth(m, 1))}>▶</MonthBtn>
              </span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: TEXT, lineHeight: 1 }}>
              {kpiShippedThisMonth}<span style={{ fontSize: 13, fontWeight: 700, color: MUTED, marginLeft: 3 }}>건</span>
            </div>
          </div>
          {/* 대시보드 이동 (KPI 그리드 5번째 칸) */}
          <button onClick={() => router.push('/repair/dashboard')} tabIndex={-1}
            onMouseEnter={e => { e.currentTarget.style.borderColor = MUTED; e.currentTarget.style.background = '#fafafa' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.background = '#fff' }}
            style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', color: GRAY, fontSize: 13, fontWeight: 700, transition: 'border-color 0.15s ease, background 0.15s ease' }}>
            대시보드
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>

        {/* ── 새 수리품 접수 등록 ── */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>입고 등록</div>
            <button onClick={openImport} tabIndex={-1}
              style={{ padding: '6px 12px', border: `1px solid ${BORDER}`, borderRadius: 6, background: '#fff', color: GRAY, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              엑셀 일괄 등록
            </button>
          </div>

          {/* 구분 · 입고일 · 회사명 · 제품 구분 · 시리얼번호 · 등록 (하단 정렬) */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }} className="repair-form-row">
            <div style={fieldGroup}>
              <label style={label}>구분</label>
              <SegmentedControl
                options={[...CATEGORIES]}
                value={formCategory}
                onChange={v => setFormCategory(v as Category)}
                equal
                height={36}
                minItemWidth={64}
                itemTabIndex={-1}
              />
            </div>
            <div style={{ ...fieldGroup, width: 150, flexShrink: 0 }}>
              <label style={label}>입고일</label>
              <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} style={inp} tabIndex={-1} />
            </div>
            <div style={{ ...fieldGroup, flex: 1, minWidth: 0, position: 'relative' }}>
              <label style={label}>회사명</label>
              <AutocompleteInput value={customerName} onChange={(v) => { setCustomerName(v); clearError('customerName') }} suggestions={customerNameOptions} placeholder="회사명 입력" style={errors.customerName ? { ...inp, border: errBorder } : inp} tabIndex={1} />
              {/* 가로 한 줄 폼이라 에러는 절대배치로 띄워 옆 칸이 밀리지 않게 함 */}
              <FieldError message={errors.customerName} style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, whiteSpace: 'nowrap' }} />
            </div>
            <div style={{ ...fieldGroup, flex: 1, minWidth: 0 }}>
              <label style={label}>제품 구분</label>
              <AutocompleteInput value={productType} onChange={setProductType} suggestions={productTypeOptions} placeholder="예: E-TS-4182-P6" style={inp} tabIndex={2} />
            </div>
            <div style={{ ...fieldGroup, flex: 1, minWidth: 0 }}>
              <label style={label}>시리얼번호</label>
              <input value={serialNumber} onChange={e => setSerialNumber(e.target.value)} placeholder="시리얼번호" style={inp} tabIndex={3} />
            </div>
            <button onClick={handleSubmit} disabled={isSaving} tabIndex={4}
              style={{ height: 36, padding: '0 18px', flexShrink: 0, border: 'none', borderRadius: 6, background: isSaving ? MUTED : BLUE, color: '#fff', fontSize: 14, fontWeight: 700, cursor: isSaving ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
              {isSaving ? '등록 중...' : '접수 등록'}
            </button>
          </div>
        </div>

        {/* ── 수리품 목록 ── */}
        <div style={card}>
          <div className="repair-list-header" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>수리품 목록 <span style={{ color: MUTED, fontWeight: 700 }}>({hasFilter ? `${filteredRepairs.length} / ${repairs.length}` : repairs.length})</span></div>
            {/* 정중앙(absolute): 구분 필터 — 좌우 요소 폭과 무관하게 카드 중앙. 좁은 화면은 CSS 로 아래 줄 처리 */}
            <div className="repair-cat-center" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
              {/* 표시 순서만 게이지·전체·앰프, 값·로직 동일 */}
              <SegmentedControl
                options={['게이지', '전체', '앰프']}
                value={categoryFilter}
                onChange={v => setCategoryFilter(v as '전체' | Category)}
                equal
                minItemWidth={64}
              />
            </div>
            {/* 우: 상태 필터 + 검색 아이콘 토글 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* 수리중·출고대기는 고정 블록으로 항상 노출되므로 필터에서 제외 */}
              <SegmentedControl
                options={['전체', '입고', '출고완료']}
                value={statusFilter}
                onChange={v => setStatusFilter(v as '전체' | RepairStatus)}
                equal
                minItemWidth={64}
              />
              <button
                onClick={toggleSearch}
                title="검색"
                onMouseEnter={e => (e.currentTarget.style.color = BLUE)}
                onMouseLeave={e => (e.currentTarget.style.color = searchOpen ? BLUE : MUTED)}
                style={{
                  position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: 4, border: 'none', cursor: 'pointer',
                  background: searchOpen ? ACTIVE_BG : 'transparent', borderRadius: 6,
                  color: searchOpen ? BLUE : MUTED, transition: 'color 0.15s ease, background 0.15s ease',
                }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                {searchActive && (
                  <span style={{ position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: '50%', background: BLUE }} />
                )}
              </button>
            </div>
          </div>

          {/* ── 검색 + 날짜 필터 (슬라이드) ── */}
          <div style={{
            overflow: 'hidden',
            maxHeight: searchOpen ? 80 : 0,
            opacity: searchOpen ? 1 : 0,
            transition: 'max-height 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 160ms ease',
          }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 24, marginBottom: 14, flexWrap: 'wrap' }}>
            {/* 검색 그룹 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                ref={searchInputRef}
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applySearch() }}
                placeholder="회사명 · 제품 구분 · 시리얼번호 검색"
                style={{ width: 260, height: 32, boxSizing: 'border-box', padding: '0 10px', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 13, color: TEXT, outline: 'none' }}
              />
              <button
                onClick={applySearch}
                style={{ height: 32, boxSizing: 'border-box', padding: '0 12px', borderRadius: 6, border: `1px solid ${searchPending ? BLUE : BORDER}`, background: searchPending ? BLUE : '#fff', color: searchPending ? '#fff' : GRAY, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                검색
              </button>
            </div>

            {/* 날짜 그룹 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex', height: 32, border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
                {([['received', '입고'], ['shipped', '출고']] as const).map(([val, txt]) => {
                  const active = dateBasis === val
                  return (
                    <button key={val} onClick={() => setDateBasis(val)}
                      style={{ padding: '0 12px', border: 'none', background: active ? ACTIVE_BG : 'transparent', color: active ? TEXT : GRAY, fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer' }}>
                      {txt}
                    </button>
                  )
                })}
              </div>
              <input type="month" value={dateMonth} onChange={e => setDateMonth(e.target.value)}
                style={{ height: 32, boxSizing: 'border-box', padding: '0 8px', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 13, color: TEXT, colorScheme: 'light' }} />
              <button
                onClick={resetSearchAndDate}
                style={{ height: 32, boxSizing: 'border-box', padding: '0 13px', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', color: GRAY, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                초기화
              </button>
            </div>
          </div>
          </div>

          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: MUTED, fontSize: 14 }}>불러오는 중...</div>
          ) : repairs.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: MUTED, fontSize: 14 }}>접수된 수리품이 없습니다.</div>
          ) : (
            <>
              {/* 수리 진행 중 — 항상 상단 고정 */}
              {repairingList.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: ORANGE, marginBottom: 8 }}>
                    수리 진행 중 <span style={{ color: MUTED }}>({repairingList.length})</span>
                  </div>
                  <div style={{ border: `1px solid #fde68a`, borderRadius: 10, overflow: 'hidden', background: '#fffdf7' }}>
                    {renderTable(repairingList)}
                  </div>
                </div>
              )}

              {/* 출고 대기 — 항상 상단 고정 (수리 진행 중과 동일 구조, 초록 테마) */}
              {waitingList.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#15803d', marginBottom: 8 }}>
                    출고 대기 <span style={{ color: MUTED }}>({waitingList.length})</span>
                  </div>
                  <div style={{ border: `1px solid #bbf7d0`, borderRadius: 10, overflow: 'hidden', background: '#f8fffe' }}>
                    {renderTable(waitingList)}
                  </div>
                </div>
              )}

              {/* 전체 목록 (50개씩) */}
              {filteredRepairs.length === 0 ? (
                <div style={{ padding: '30px 0', textAlign: 'center', color: MUTED, fontSize: 14 }}>해당 상태의 수리품이 없습니다.</div>
              ) : (
                <>
                  {renderTable(pagedRepairs)}
                  {totalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 16 }}>
                      <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={pageSafe === 0}
                        style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${BORDER}`, background: pageSafe === 0 ? '#f8f9fb' : '#fff', color: pageSafe === 0 ? MUTED : GRAY, fontSize: 13, fontWeight: 700, cursor: pageSafe === 0 ? 'default' : 'pointer' }}>이전</button>
                      <span style={{ fontSize: 13, fontWeight: 700, color: GRAY }}>{pageSafe + 1} / {totalPages}</span>
                      <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={pageSafe >= totalPages - 1}
                        style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${BORDER}`, background: pageSafe >= totalPages - 1 ? '#f8f9fb' : '#fff', color: pageSafe >= totalPages - 1 ? MUTED : GRAY, fontSize: 13, fontWeight: 700, cursor: pageSafe >= totalPages - 1 ? 'default' : 'pointer' }}>다음</button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

      </div>

      {/* ── 수리품 수정 모달 ── */}
      <RepairEditModal repair={editing} isSaving={isEditSaving} onClose={() => setEditing(null)} onSave={handleEditSave} onDelete={handleDelete} />

      {/* ── 엑셀 일괄 등록 모달 ── */}
      {showImport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 14, width: '100%', maxWidth: 920, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', border: `1px solid ${BORDER}` }}>
            {/* 헤더 */}
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: TEXT }}>엑셀 일괄 등록</div>
              <button onClick={() => setShowImport(false)} style={{ width: 30, height: 30, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 15, color: GRAY }}>✕</button>
            </div>
            {/* 본문 */}
            <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, color: GRAY, lineHeight: 1.7 }}>
                엑셀 첫 시트의 컬럼: <b style={{ color: TEXT }}>입고일 · 회사명 · 제품 구분 · 시리얼번호 · 출고일</b> (순번·월-주차는 자동 계산). 날짜가 &quot;1월 5일&quot;처럼 연도가 없으면 아래 <b style={{ color: TEXT }}>연도</b>로 채웁니다. <b style={{ color: TEXT }}>출고일이 있으면 출고완료</b>, 없으면 <b style={{ color: TEXT }}>입고</b> 상태로, 아래에서 고른 <b style={{ color: TEXT }}>구분</b>으로 일괄 등록됩니다.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: GRAY }}>구분</label>
                <div style={{ display: 'flex', border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
                  {CATEGORIES.map(c => (
                    <button key={c} type="button" onClick={() => setImportCategory(c)}
                      style={{ padding: '8px 16px', border: 'none', background: importCategory === c ? BLUE : '#fff', color: importCategory === c ? '#fff' : GRAY, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      {c}
                    </button>
                  ))}
                </div>
                <label style={{ fontSize: 13, fontWeight: 700, color: GRAY }}>연도</label>
                <input type="number" value={importYear} onChange={e => setImportYear(Number(e.target.value) || importYear)}
                  style={{ width: 100, padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 14, color: TEXT, outline: 'none', boxSizing: 'border-box' }} />
                <label style={{ padding: '8px 14px', border: `1px solid ${BLUE}`, borderRadius: 8, background: '#fff', color: BLUE, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  엑셀 파일 선택
                  <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = '' }} />
                </label>
                {importFileName && <span style={{ fontSize: 13, color: TEXT }}>{importFileName} · {importRows.length}행</span>}
              </div>

              {importPreview.length > 0 && (
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ color: GRAY, fontSize: 12 }}>
                          <th style={impTh}>월-주차</th><th style={impTh}>입고일</th><th style={impTh}>회사명</th>
                          <th style={impTh}>제품 구분</th><th style={impTh}>시리얼번호</th><th style={impTh}>출고일</th><th style={impTh}>상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.map((p, i) => (
                          <tr key={i} style={{ borderTop: `1px solid #f0f1f4`, background: p.valid ? '#fff' : '#fef2f2' }}>
                            <td style={impTd}>{p.received ? fmtWeek(p.received) : '-'}</td>
                            <td style={impTd}>{p.received ?? <span style={{ color: RED }}>날짜 인식 실패</span>}</td>
                            <td style={impTd}>{p.customer || <span style={{ color: RED }}>회사명 없음</span>}</td>
                            <td style={impTd}>{p.product || '-'}</td>
                            <td style={impTd}>{p.serial || '-'}</td>
                            <td style={impTd}>{p.shipped ?? (p.shipRaw || '-')}</td>
                            <td style={impTd}>{p.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {importResult && (
                <div style={{ fontSize: 14, fontWeight: 700, color: importResult.fail ? ORANGE : GREEN }}>
                  완료: {importResult.ok}건 등록{importResult.fail ? ` · ${importResult.fail}건 건너뜀 (입고일/회사명 누락)` : ''}
                </div>
              )}
            </div>
            {/* 푸터 */}
            <div style={{ padding: '14px 20px', borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: GRAY }}>{importPreview.length > 0 ? `${importValidCount}건 등록 가능 / 총 ${importPreview.length}행` : ''}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowImport(false)}
                  style={{ padding: '9px 16px', background: '#fff', color: GRAY, borderRadius: 8, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>닫기</button>
                <button onClick={handleImport} disabled={isImporting || importValidCount === 0}
                  style={{ padding: '9px 18px', background: (isImporting || importValidCount === 0) ? MUTED : BLUE, color: '#fff', borderRadius: 8, border: 'none', cursor: (isImporting || importValidCount === 0) ? 'default' : 'pointer', fontWeight: 800, fontSize: 13 }}>
                  {isImporting ? '등록 중...' : `${importValidCount}건 가져오기`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .repair-kpi { grid-template-columns: 1fr 1fr !important; }
          .repair-form-row { flex-direction: column !important; align-items: stretch !important; }
        }
        /* 카드 폭이 부족하면 정중앙 구분 필터를 아래 줄로 내려 좌우 요소와 겹치지 않게 한다 */
        @media (max-width: 880px) {
          .repair-list-header { flex-wrap: wrap; }
          .repair-cat-center {
            position: static !important; transform: none !important;
            order: 2; width: 100%; margin-top: 10px;
            display: flex; justify-content: center;
          }
        }
      `}</style>
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontWeight: 600, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '7px 10px', color: TEXT, verticalAlign: 'middle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

// ── 서브 컴포넌트 ──
function KpiCard({ title, value, unit, sub }: { title: string; value: number; unit: string; sub?: string }) {
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: MUTED, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: TEXT, lineHeight: 1 }}>
        {value}<span style={{ fontSize: 13, fontWeight: 700, color: MUTED, marginLeft: 3 }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize: 11, color: MUTED, marginTop: 6, fontWeight: 600 }}>{sub}</div>}
    </div>
  )
}

function MonthBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} tabIndex={-1}
      style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', color: GRAY, cursor: 'pointer', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
      {children}
    </button>
  )
}

