'use client'

import { useEffect, useState, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/common/Toast'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { canAccessSales, isSuperAdmin } from '@/lib/permissions'

const BLUE = '#234ea2'
const ORANGE = '#d97706'
const RED = '#dc2626'
const PAGE_BG = '#f4f5f7'
const CARD_BG = '#ffffff'
const BORDER = '#e2e4e9'
const TEXT = '#111113'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'

type InventoryItem = {
  item_id: number
  item_no: string | null
  part_code: string | null
  item_name: string | null
  po_no: string | null
  lot_no: string | null
  quantity: number
  location: string | null
  received_date: string | null
}

type InventoryLog = {
  log_id: number
  item_id: number
  engineer_id: number | null
  requester_id: number | null
  quantity_out: number
  log_type: 'out' | 'in'
  is_restocked: boolean
  outlet_company: string | null
  reason: string | null
  note: string | null
  logged_at: string
  inventory_items?: { item_name: string | null; part_code: string | null } | null
}

type InventoryRequest = {
  request_id: number
  item_id: number
  requester_id: number
  quantity: number
  outlet_company: string | null
  reason: string | null
  note: string | null
  status: '대기중' | '승인' | '반려'
  reject_reason: string | null
  requested_at: string
  processed_at: string | null
  processed_by: number | null
  inventory_items?: { item_name: string | null; part_code: string | null; location: string | null } | null
}

type ExcelRow = Record<string, string | number | null>

// 엑셀 날짜 시리얼 → YYYY-MM-DD 변환
const parseExcelDate = (val: string | number | null | undefined): string | null => {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number') {
    const ms = Math.round((val - 25569) * 86400 * 1000)
    return new Date(ms).toISOString().split('T')[0]
  }
  return String(val).trim() || null
}

type ExcelResult = {
  partCode: string
  itemName: string | null
  qty: number
  success: boolean
  error?: string
}

type Engineer = {
  engineer_id: number
  name: string
  position: string | null
  teams: string | null
  email: string | null
  permission_level: string | null
  resigned_date: string | null
}

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  '대기중': { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  '승인':   { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  '반려':   { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
}

const LOC_STYLE: Record<string, { bg: string; color: string }> = {
  '1층': { bg: '#eff4ff', color: BLUE },
  '2층': { bg: '#f0fdf4', color: '#15803d' },
}


function InventoryPage() {
  const supabase = createClient()
  const { loading: guardLoading, authorized } = usePageGuard(canAccessSales)
  const confirmDialog = useConfirm()
  const toast = useToast()
  const searchParams = useSearchParams()

  // ── 데이터 ──
  const [items, setItems] = useState<InventoryItem[]>([])
  const [logs, setLogs] = useState<InventoryLog[]>([])
  const [requests, setRequests] = useState<InventoryRequest[]>([])
  const [allEngineers, setAllEngineers] = useState<Engineer[]>([])
  const [currentEngineer, setCurrentEngineer] = useState<Engineer | null>(null)
  const [loading, setLoading] = useState(true)

  // ── UI ──
  const validTabs = ['items', 'logs', 'requests', 'approval'] as const
  const tabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<'items' | 'logs' | 'requests' | 'approval'>(
    validTabs.includes(tabParam as typeof validTabs[number]) ? tabParam as typeof validTabs[number] : 'items'
  )
  const [search, setSearch] = useState('')
  const [locationFilter, setLocationFilter] = useState('전체')

  // 출고 요청 모달
  const [requestItem, setRequestItem] = useState<InventoryItem | null>(null)
  const [requestQty, setRequestQty] = useState(1)
  const [requestOutletCompany, setRequestOutletCompany] = useState('')
  const [requestReason, setRequestReason] = useState('')
  const [requestNote, setRequestNote] = useState('')
  const [isSavingRequest, setIsSavingRequest] = useState(false)

  // 엑셀 일괄 처리
  const [showExcelModal, setShowExcelModal] = useState(false)
  const [excelType, setExcelType] = useState<'out' | 'in'>('out')
  const [excelRows, setExcelRows] = useState<ExcelRow[]>([])
  const [excelFileName, setExcelFileName] = useState('')
  const [excelResults, setExcelResults] = useState<ExcelResult[] | null>(null)
  const [isProcessingExcel, setIsProcessingExcel] = useState(false)

  // 재입고 모달
  const [selectedLog, setSelectedLog] = useState<InventoryLog | null>(null)
  const [restockQty, setRestockQty] = useState(1)
  const [restockReason, setRestockReason] = useState('')
  const [isRestocking, setIsRestocking] = useState(false)

  // 반려 모달
  const [rejectingRequest, setRejectingRequest] = useState<InventoryRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // 출고 요청 폼 / 반려 폼은 서로 다른 폼 → 훅 인스턴스를 각각 분리 (에러가 서로 새지 않음)
  const reqErr = useFieldErrors<'outlet' | 'reason'>()
  const rejErr = useFieldErrors<'reason'>()
  // 각 폼(모달)이 열리거나 닫힐 때(gate state 토글) 에러 초기화
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reqErr.setErrors({}) }, [requestItem])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { rejErr.setErrors({}) }, [rejectingRequest])
  const [isProcessing, setIsProcessing] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const [
      { data: itemsData },
      { data: logsData },
      { data: requestsData },
      { data: engData },
    ] = await Promise.all([
      supabase.from('inventory_items').select('*').order('item_id', { ascending: true }),
      supabase.from('inventory_logs')
        .select('*, inventory_items(item_name, part_code)')
        .order('logged_at', { ascending: false }),
      supabase.from('inventory_requests')
        .select('*, inventory_items(item_name, part_code, location)')
        .order('requested_at', { ascending: false }),
      supabase.from('engineers')
        .select('engineer_id, name, position, teams, email, permission_level, resigned_date')
        .order('engineer_id'),
    ])
    setItems((itemsData as InventoryItem[]) ?? [])
    setLogs((logsData as InventoryLog[]) ?? [])
    setRequests((requestsData as InventoryRequest[]) ?? [])
    setAllEngineers((engData as Engineer[]) ?? [])
    if (user?.email && engData) {
      const me = (engData as Engineer[]).find(e => e.email === user.email)
      if (me) setCurrentEngineer(me)
    }
    setLoading(false)
  }

  // ── 파생 상태 ──
  const isManager = canAccessSales(currentEngineer)
  const isSuper = isSuperAdmin(currentEngineer)

  const filteredItems = useMemo(() => items.filter(item => {
    const q = search.trim().toLowerCase()
    return (!q || (item.part_code ?? '').toLowerCase().includes(q) || (item.item_name ?? '').toLowerCase().includes(q))
      && (locationFilter === '전체' || item.location === locationFilter)
  }), [items, search, locationFilter])

  const myRequests = useMemo(() => {
    if (!currentEngineer) return []
    if (isSuper) return requests
    return requests.filter(r => r.requester_id === currentEngineer.engineer_id)
  }, [requests, currentEngineer, isSuper])

  const pendingRequests = requests.filter(r => r.status === '대기중')

  const getEngName = (id: number) => {
    const e = allEngineers.find(e => e.engineer_id === id)
    return e ? `${e.name}${e.position ? ' ' + e.position : ''}` : '-'
  }

  // ── 출고 요청 ──
  const handleRequest = async () => {
    if (!requestItem || !currentEngineer || requestQty < 1) return
    const ok = reqErr.validate({
      outlet: requestOutletCompany.trim() ? null : '출고 업체를 입력해주세요',
      reason: requestReason.trim() ? null : '출고 사유를 입력해주세요',
    })
    if (!ok) return
    setIsSavingRequest(true)
    try {
      const { error } = await supabase.from('inventory_requests').insert([{
        item_id: requestItem.item_id,
        requester_id: currentEngineer.engineer_id,
        quantity: requestQty,
        outlet_company: requestOutletCompany.trim(),
        reason: requestReason.trim(),
        note: requestNote.trim() || null,
        status: '대기중',
        requested_at: new Date().toISOString(),
      }])
      if (error) throw error

      // 알림 수신자(현재 시점 대상) — 삭제(퇴사)된 직원은 제외. (발주서 알림 로직과 동일 기준)
      const managers = allEngineers.filter(e => canAccessSales(e) && !e.resigned_date)
      if (managers.length > 0) {
        const { error: notiErr } = await supabase.from('notifications').insert(
          managers.map(m => ({
            engineer_id: m.engineer_id,
            title: '출고 요청 승인 필요',
            message: `${requestItem.item_name ?? '알 수 없음'} ${requestQty}개 출고 요청이 들어왔습니다`,
            type: 'stock_request',
            link: '/inventory?tab=approval',
            is_read: false,
            created_at: new Date().toISOString(),
          }))
        )
        if (notiErr) console.error('[inventory] notification insert failed', { action: 'stock_request', itemId: requestItem.item_id, targets: managers.length, error: notiErr })
      }
      toast.success('출고 요청이 등록되었습니다')
      setRequestItem(null); setRequestQty(1); setRequestOutletCompany(''); setRequestReason(''); setRequestNote('')
      await fetchAll()
    } catch (err) {
      toast.error((err as { message?: string })?.message || '요청 중 오류가 발생했습니다')
    } finally {
      setIsSavingRequest(false)
    }
  }

  // ── 승인 ── (서버 API 경유 — 권한 강제)
  const handleApprove = async (req: InventoryRequest) => {
    const ok = await confirmDialog({ title: '출고 승인', message: `${req.inventory_items?.item_name ?? '품목'} ${req.quantity}개 출고 요청을 승인하시겠습니까?`, confirmText: '승인', variant: 'default' })
    if (!ok) return
    setIsProcessing(true)
    try {
      const res = await fetch('/api/inventory-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', request_id: req.request_id }),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(result.error || '승인 처리 중 오류가 발생했습니다'); return }
      toast.success('승인이 완료되었습니다')
      await fetchAll()
    } catch (err) {
      toast.error((err as { message?: string })?.message || '승인 처리 중 오류가 발생했습니다')
    } finally {
      setIsProcessing(false)
    }
  }

  // ── 반려 ── (서버 API 경유 — 권한 강제)
  const handleReject = async () => {
    if (!rejectingRequest) return
    const ok = rejErr.validate({ reason: rejectReason.trim() ? null : '반려 사유를 입력해주세요' })
    if (!ok) return
    setIsProcessing(true)
    try {
      const res = await fetch('/api/inventory-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', request_id: rejectingRequest.request_id, reject_reason: rejectReason }),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(result.error || '반려 처리 중 오류가 발생했습니다'); return }
      toast.success('반려 처리되었습니다')
      setRejectingRequest(null); setRejectReason('')
      await fetchAll()
    } catch (err) {
      toast.error((err as { message?: string })?.message || '반려 처리 중 오류가 발생했습니다')
    } finally {
      setIsProcessing(false)
    }
  }

  // ── 재입고 ──
  const handleRestock = async () => {
    if (!selectedLog || restockQty < 1 || !currentEngineer) return
    setIsRestocking(true)
    try {
      const item = items.find(i => i.item_id === selectedLog.item_id)
      if (!item) throw new Error('품목 정보를 찾을 수 없습니다.')
      const newQty = item.quantity + restockQty

      const { error: e1 } = await supabase.from('inventory_items').update({ quantity: newQty }).eq('item_id', selectedLog.item_id)
      if (e1) throw e1

      const { data: newLogData, error: e2 } = await supabase.from('inventory_logs').insert([{
        item_id: selectedLog.item_id,
        engineer_id: currentEngineer.engineer_id,
        quantity_out: restockQty,
        log_type: 'in',
        reason: restockReason.trim() || null,
        logged_at: new Date().toISOString(),
      }]).select('*, inventory_items(item_name, part_code)').single()
      if (e2) throw e2

      // 스키마 캐시 우회: rpc 사용
      const { error: e3 } = await supabase.rpc('mark_log_restocked', { p_log_id: selectedLog.log_id })
      if (e3) throw e3

      // fetchAll() 대신 로컬 state 직접 갱신 — fetchAll이 스키마 캐시 지연으로 is_restocked 값을 덮어쓰는 것을 방지
      setItems(prev => prev.map(i => i.item_id === selectedLog.item_id ? { ...i, quantity: newQty } : i))
      setLogs(prev => [
        newLogData as InventoryLog,
        ...prev.map(l => l.log_id === selectedLog.log_id ? { ...l, is_restocked: true } : l),
      ])

      toast.success('재입고가 완료되었습니다')
      setSelectedLog(null); setRestockQty(1); setRestockReason('')
    } catch (err) {
      toast.error((err as { message?: string })?.message || '재입고 처리 중 오류가 발생했습니다')
    } finally {
      setIsRestocking(false)
    }
  }

  // ── 엑셀 일괄 처리 ──
  const handleExcelFile = (file: File) => {
    import('xlsx').then((XLSX) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const workbook = XLSX.read(e.target?.result, { type: 'binary' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<ExcelRow>(sheet)
        setExcelRows(rows)
        setExcelFileName(file.name)
        setExcelResults(null)
      }
      reader.readAsBinaryString(file)
    })
  }

  const handleProcessExcel = async () => {
    if (!currentEngineer || excelRows.length === 0) return
    setIsProcessingExcel(true)

    const { data: bulkData } = await supabase.from('bulk_uploads').insert({
      engineer_id: currentEngineer.engineer_id,
      upload_type: excelType,
      file_name: excelFileName,
      row_count: excelRows.length,
      success_count: 0,
      fail_count: 0,
    }).select().single()
    const bulkId = bulkData?.upload_id ?? null

    const { data: latestItems } = await supabase.from('inventory_items').select('*')
    const liveItems: InventoryItem[] = (latestItems as InventoryItem[]) ?? []

    const results: ExcelResult[] = []
    let successCount = 0

    for (const row of excelRows) {
      const partCode = String(row['부품코드'] ?? '').trim()
      const qty = Number(row['출고수량'] ?? row['입고수량'] ?? row['수량'] ?? 0)
      const outletCompany = String(row['출고업체'] ?? '').trim() || null
      const reason = String(row['사유'] ?? '').trim() || null
      const dept = String(row['부서명'] ?? '').trim() || null
      const poNo = excelType === 'in' ? (String(row['PO No.'] ?? row['PO번호'] ?? '').trim() || null) : null
      const lotNo = excelType === 'in' ? (String(row['제번'] ?? '').trim() || null) : null
      const location = excelType === 'in' ? (String(row['보관장소'] ?? '').trim() || null) : null
      const receivedDate = excelType === 'in' ? parseExcelDate(row['매입일자']) : null

      if (!partCode) { results.push({ partCode: '-', itemName: null, qty, success: false, error: '부품코드 없음' }); continue }
      const item = liveItems.find(i => i.part_code === partCode)
      if (!item) { results.push({ partCode, itemName: null, qty, success: false, error: '미등록 부품코드' }); continue }
      if (qty <= 0) { results.push({ partCode, itemName: item.item_name, qty, success: false, error: '수량 오류' }); continue }
      if (excelType === 'out' && item.quantity < qty) {
        results.push({ partCode, itemName: item.item_name, qty, success: false, error: `재고 부족 (현재 ${item.quantity}개)` }); continue
      }

      const newQty = excelType === 'out' ? item.quantity - qty : item.quantity + qty
      const updateFields: Record<string, unknown> = { quantity: newQty }
      if (excelType === 'in') {
        if (poNo) updateFields.po_no = poNo
        if (lotNo) updateFields.lot_no = lotNo
        if (location) updateFields.location = location
        if (receivedDate) updateFields.received_date = receivedDate
      }
      const { error: e1 } = await supabase.from('inventory_items').update(updateFields).eq('item_id', item.item_id)
      if (e1) { results.push({ partCode, itemName: item.item_name, qty, success: false, error: e1.message }); continue }

      const noteStr = excelType === 'in'
        ? [poNo ? `PO: ${poNo}` : '', lotNo ? `제번: ${lotNo}` : '', dept ? `부서: ${dept}` : ''].filter(Boolean).join(' / ') || null
        : dept ? `부서: ${dept}` : null

      const { error: e2 } = await supabase.from('inventory_logs').insert({
        item_id: item.item_id,
        engineer_id: currentEngineer.engineer_id,
        quantity_out: qty,
        log_type: excelType,
        outlet_company: outletCompany,
        reason: reason,
        note: noteStr,
        bulk_upload_id: bulkId,
        logged_at: new Date().toISOString(),
      })
      if (e2) {
        await supabase.from('inventory_items').update({ quantity: item.quantity }).eq('item_id', item.item_id)
        results.push({ partCode, itemName: item.item_name, qty, success: false, error: e2.message }); continue
      }

      const idx = liveItems.findIndex(i => i.item_id === item.item_id)
      if (idx !== -1) liveItems[idx] = { ...liveItems[idx], quantity: newQty }
      successCount++
      results.push({ partCode, itemName: item.item_name, qty, success: true })
    }

    if (bulkId) {
      await supabase.from('bulk_uploads').update({ success_count: successCount, fail_count: results.length - successCount }).eq('upload_id', bulkId)
    }

    setExcelResults(results)
    setIsProcessingExcel(false)
    await fetchAll()
  }

  // ── 파생 계산 ──
  const totalQty = items.reduce((s, i) => s + i.quantity, 0)
  const floor1Count = items.filter(i => i.location === '1층').length
  const floor2Count = items.filter(i => i.location === '2층').length

  const inp: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: `1.5px solid ${BORDER}`, borderRadius: 9,
    fontSize: 13, outline: 'none', background: '#fff', boxSizing: 'border-box', color: TEXT,
    fontFamily: 'inherit', transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  }

  const tabs = [
    { key: 'items', label: '재고 목록' },
    { key: 'logs', label: '출고·재입고 이력' },
    { key: 'requests', label: '요청 이력', count: myRequests.length },
    ...(isManager ? [{ key: 'approval', label: '승인 관리', count: pendingRequests.length, urgent: true }] : []),
  ]

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <svg style={{ animation: 'spin 0.75s linear infinite' }} width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={BLUE} strokeWidth="2.5" strokeLinecap="round">
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
        <span style={{ fontSize: 13, color: MUTED, fontWeight: 500 }}>재고 데이터를 불러오는 중...</span>
      </div>
    </div>
  )

  // ── 공용 닫기 버튼 ──
  const CloseBtn = ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f4f5f7', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: GRAY, flexShrink: 0, transition: 'background 0.15s ease' }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f4f5f7' }}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/>
      </svg>
    </button>
  )

  // ── 모달 헤더 ──
  const ModalHeader = ({ title, accentColor, onClose }: { title: string; accentColor: string; onClose: () => void }) => (
    <div style={{ padding: '20px 24px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 3, height: 18, background: accentColor, borderRadius: 2 }} />
        <span style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>{title}</span>
      </div>
      <CloseBtn onClick={onClose} />
    </div>
  )

  // ── 부품코드 태그 ──
  const PartTag = ({ code }: { code: string | null }) =>
    code
      ? <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: '#eff4ff', color: BLUE, letterSpacing: '0.2px', whiteSpace: 'nowrap' }}>{code}</span>
      : <span style={{ color: MUTED }}>-</span>

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <div style={{ background: PAGE_BG, minHeight: '100vh', padding: '24px 28px' }}>
      <style>{`
        .inv-input:focus { border-color: ${BLUE} !important; box-shadow: 0 0 0 3px rgba(35,78,162,0.10) !important; }
        .inv-tr { transition: background 0.12s ease; }
        .inv-tr:hover td { background: #f8fafc !important; }
        .inv-tr-in { background: #f8fffe; }
        .inv-tr-in:hover td { background: #f0fdf4 !important; }
        @keyframes modal-in { from { opacity: 0; transform: scale(0.97) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .modal-box { animation: modal-in 0.18s ease both; }
        .qty-btn:hover { border-color: ${BLUE} !important; background: #eff4ff !important; color: ${BLUE} !important; }
        .qty-btn:active { transform: scale(0.93); }
        .cancel-btn:hover { background: #e5e7eb !important; }
        .tab-btn { transition: color 0.12s ease; }
        .tab-btn:hover { color: ${BLUE} !important; }
        .excel-drop:hover { border-color: ${BLUE} !important; background: #eff4ff !important; }
        .req-btn:hover { background: ${BLUE} !important; color: #fff !important; border-color: ${BLUE} !important; }
        .restock-btn:hover { background: #14532d !important; }
        .reject-btn:hover { background: ${RED} !important; color: #fff !important; }
        .sum-card { cursor: default; }
        .sum-card:hover { box-shadow: 0 8px 28px rgba(0,0,0,0.11) !important; transform: translateY(-2px); }
      `}</style>

      <div style={{ maxWidth: 1440, margin: '0 auto' }}>

        {/* ── 요약 카드 5개 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 12, marginBottom: 20 }}>

          {/* 총 품목 수 */}
          <div className="sum-card" style={{ background: CARD_BG, borderRadius: 16, padding: '18px 20px', border: `1px solid ${BORDER}`, boxShadow: '0 2px 8px rgba(0,0,0,0.05)', transition: 'box-shadow 0.15s ease, transform 0.15s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: '0.3px' }}>총 품목 수</span>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={GRAY} strokeWidth="2" strokeLinecap="round">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                </svg>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: TEXT, letterSpacing: '-1px', lineHeight: 1 }}>{items.length}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: GRAY }}>종</span>
            </div>
          </div>

          {/* 총 재고 수량 */}
          <div className="sum-card" style={{ background: '#eff4ff', borderRadius: 16, padding: '18px 20px', border: `1px solid #c7d7f8`, boxShadow: '0 2px 8px rgba(35,78,162,0.07)', transition: 'box-shadow 0.15s ease, transform 0.15s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6b8fce', letterSpacing: '0.3px' }}>총 재고 수량</span>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: '#dce9ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={BLUE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5M2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: BLUE, letterSpacing: '-1px', lineHeight: 1 }}>{totalQty}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: BLUE }}>개</span>
            </div>
          </div>

          {/* 대기 중 요청 */}
          <div className="sum-card" style={{
            background: pendingRequests.length > 0 ? '#fffbeb' : CARD_BG,
            borderRadius: 16, padding: '18px 20px',
            border: `1px solid ${pendingRequests.length > 0 ? '#fde68a' : BORDER}`,
            boxShadow: pendingRequests.length > 0 ? '0 2px 8px rgba(217,119,6,0.08)' : '0 2px 8px rgba(0,0,0,0.05)',
            transition: 'box-shadow 0.15s ease, transform 0.15s ease',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: pendingRequests.length > 0 ? ORANGE : MUTED, letterSpacing: '0.3px' }}>대기 중 요청</span>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: pendingRequests.length > 0 ? '#fef3c7' : '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={pendingRequests.length > 0 ? ORANGE : GRAY} strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: pendingRequests.length > 0 ? ORANGE : TEXT, letterSpacing: '-1px', lineHeight: 1 }}>{pendingRequests.length}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: pendingRequests.length > 0 ? ORANGE : GRAY }}>건</span>
            </div>
            {pendingRequests.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: ORANGE, display: 'inline-block', animation: 'pulse-dot 1.4s ease infinite' }} />
                <span style={{ fontSize: 11, color: ORANGE, fontWeight: 700 }}>승인 필요</span>
              </div>
            )}
          </div>

          {/* 1층 보관 */}
          <div className="sum-card" style={{ background: CARD_BG, borderRadius: 16, padding: '18px 20px', border: `1px solid ${BORDER}`, boxShadow: '0 2px 8px rgba(0,0,0,0.05)', transition: 'box-shadow 0.15s ease, transform 0.15s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: '0.3px' }}>1층 보관</span>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: '#eff4ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={BLUE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: TEXT, letterSpacing: '-1px', lineHeight: 1 }}>{floor1Count}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: GRAY }}>종</span>
            </div>
          </div>

          {/* 2층 보관 */}
          <div className="sum-card" style={{ background: CARD_BG, borderRadius: 16, padding: '18px 20px', border: `1px solid ${BORDER}`, boxShadow: '0 2px 8px rgba(0,0,0,0.05)', transition: 'box-shadow 0.15s ease, transform 0.15s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: '0.3px' }}>2층 보관</span>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="14" rx="2"/>
                  <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
                </svg>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: TEXT, letterSpacing: '-1px', lineHeight: 1 }}>{floor2Count}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: GRAY }}>종</span>
            </div>
          </div>
        </div>

        {/* ── 탭 바 ── */}
        <div style={{ background: CARD_BG, borderRadius: '14px 14px 0 0', border: `1px solid ${BORDER}`, borderBottom: 'none', display: 'flex', alignItems: 'flex-end', padding: '0 8px', gap: 2 }}>
          {tabs.map(({ key, label, count, urgent }) => {
            const isActive = activeTab === key
            return (
              <button key={key} className="tab-btn"
                onClick={() => setActiveTab(key as 'items' | 'logs' | 'requests' | 'approval')}
                style={{
                  padding: '13px 18px 12px', border: 'none', cursor: 'pointer', background: 'transparent',
                  fontWeight: isActive ? 800 : 500, fontSize: 13,
                  color: isActive ? BLUE : GRAY,
                  borderBottom: `2.5px solid ${isActive ? BLUE : 'transparent'}`,
                  marginBottom: -1,
                  display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap',
                  transition: 'color 0.12s ease',
                }}>
                {label}
                {count !== undefined && count > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 800, minWidth: 18, height: 18, borderRadius: 99,
                    background: urgent ? RED : BLUE, color: '#fff',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
                  }}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
          {currentEngineer && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, padding: '0 6px 12px' }}>
              <span style={{ fontSize: 13, color: GRAY, fontWeight: 600 }}>{currentEngineer.name}</span>
              {isManager && (
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: '#eff4ff', color: BLUE, fontWeight: 700, border: `1px solid #c7d7f8` }}>
                  관리자
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── 탭 콘텐츠 ── */}
        <div style={{ background: CARD_BG, borderRadius: '0 0 14px 14px', border: `1px solid ${BORDER}`, overflow: 'hidden' }}>

          {/* ─ 재고 목록 ─ */}
          {activeTab === 'items' && (
            <>
              {/* 툴바 */}
              <div style={{ padding: '14px 18px', borderBottom: `1px solid ${BORDER}`, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2"
                    style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input className="inv-input" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="부품코드 또는 품명으로 검색"
                    style={{ ...inp, paddingLeft: 34 }} />
                </div>

                {/* 보관장소 필터 */}
                <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 1 }}>
                  {['전체', '1층', '2층'].map(loc => (
                    <button key={loc} onClick={() => setLocationFilter(loc)}
                      style={{
                        padding: '5px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
                        fontWeight: 700, fontSize: 12,
                        background: locationFilter === loc ? '#fff' : 'transparent',
                        color: locationFilter === loc ? TEXT : GRAY,
                        boxShadow: locationFilter === loc ? '0 1px 3px rgba(0,0,0,0.10)' : 'none',
                        transition: 'all 0.15s ease',
                      }}>
                      {loc}
                    </button>
                  ))}
                </div>

                <span style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap', fontWeight: 500 }}>
                  {filteredItems.length}개 품목
                </span>

                {isManager && (
                  <button onClick={() => { setShowExcelModal(true); setExcelRows([]); setExcelResults(null); setExcelFileName('') }}
                    style={{
                      padding: '7px 14px', borderRadius: 8, border: `1px solid #c7d7f8`, cursor: 'pointer',
                      fontWeight: 700, fontSize: 12, background: '#eff4ff', color: BLUE, whiteSpace: 'nowrap',
                      display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = '#dce9ff'; b.style.borderColor = BLUE }}
                    onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = '#eff4ff'; b.style.borderColor = '#c7d7f8' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
                    </svg>
                    엑셀 일괄 처리
                  </button>
                )}
              </div>

              {/* 테이블 */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1.5px solid ${BORDER}`, background: '#f8fafc' }}>
                      {['재고번호', '부품코드', '품명', 'PO번호', '제번', '수량', '보관장소', '매입일자', ''].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: MUTED, fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11, letterSpacing: '0.4px', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.length === 0 ? (
                      <tr><td colSpan={9}>
                        <div style={{ padding: '56px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.8">
                              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                            </svg>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: GRAY }}>
                            {search || locationFilter !== '전체' ? '검색 결과가 없습니다' : '등록된 재고가 없습니다'}
                          </div>
                          {(search || locationFilter !== '전체') && (
                            <div style={{ fontSize: 12, color: MUTED }}>검색어 또는 필터를 변경해 보세요</div>
                          )}
                        </div>
                      </td></tr>
                    ) : filteredItems.map(item => {
                      const loc = LOC_STYLE[item.location ?? ''] ?? null
                      return (
                        <tr key={item.item_id} className="inv-tr" style={{ borderBottom: `1px solid ${BORDER}` }}>
                          <td style={{ padding: '11px 14px', color: MUTED, fontSize: 11, whiteSpace: 'nowrap' }}>{item.item_no ?? '-'}</td>
                          <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                            <PartTag code={item.part_code} />
                          </td>
                          <td style={{ padding: '11px 14px', fontWeight: 600, color: TEXT, minWidth: 120 }}>{item.item_name ?? '-'}</td>
                          <td style={{ padding: '11px 14px', color: GRAY, fontSize: 12, whiteSpace: 'nowrap' }}>{item.po_no ?? '-'}</td>
                          <td style={{ padding: '11px 14px', color: GRAY, fontSize: 12, whiteSpace: 'nowrap' }}>{item.lot_no ?? '-'}</td>
                          <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                            <span style={{ fontWeight: 700, fontSize: 14, color: TEXT, letterSpacing: '-0.3px' }}>{item.quantity}</span>
                            <span style={{ fontSize: 11, color: GRAY, fontWeight: 600, marginLeft: 3 }}>개</span>
                          </td>
                          <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                            {loc
                              ? <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: loc.bg, color: loc.color }}>{item.location}</span>
                              : <span style={{ color: MUTED }}>-</span>}
                          </td>
                          <td style={{ padding: '11px 14px', color: GRAY, fontSize: 12, whiteSpace: 'nowrap' }}>{item.received_date ?? '-'}</td>
                          <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                            <button className="req-btn"
                              onClick={() => { setRequestItem(item); setRequestQty(1); setRequestReason(''); setRequestOutletCompany(''); setRequestNote('') }}
                              style={{
                                padding: '5px 13px', border: `1px solid #c7d7f8`, borderRadius: 7,
                                fontWeight: 700, fontSize: 12, cursor: 'pointer',
                                background: '#eff4ff', color: BLUE, transition: 'all 0.15s ease',
                              }}>
                              출고 요청
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ─ 출고·재입고 이력 ─ */}
          {activeTab === 'logs' && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1.5px solid ${BORDER}`, background: '#f8fafc' }}>
                    {['일시', '구분', '품명', '부품코드', '신청자', '승인자', '수량', '출고 업체', '사유', ''].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: MUTED, fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11, letterSpacing: '0.4px', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr><td colSpan={10}>
                      <div style={{ padding: '56px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.8">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                          </svg>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: GRAY }}>이력이 없습니다</div>
                        <div style={{ fontSize: 12, color: MUTED }}>출고 또는 재입고 처리 시 이력이 기록됩니다</div>
                      </div>
                    </td></tr>
                  ) : logs.map(log => {
                    const isIn = log.log_type === 'in'
                    return (
                      <tr key={log.log_id}
                        className={isIn ? 'inv-tr-in' : 'inv-tr'}
                        style={{ borderBottom: `1px solid ${BORDER}` }}>
                        <td style={{ padding: '11px 14px', color: MUTED, fontSize: 12, whiteSpace: 'nowrap' }}>
                          {new Date(log.logged_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          <span style={{
                            padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                            background: isIn ? '#f0fdf4' : '#fef2f2',
                            color: isIn ? '#15803d' : RED,
                            border: `1px solid ${isIn ? '#bbf7d0' : '#fecaca'}`,
                          }}>
                            {isIn ? '재입고' : '출고'}
                          </span>
                        </td>
                        <td style={{ padding: '11px 14px', fontWeight: 600, color: TEXT, minWidth: 120 }}>{log.inventory_items?.item_name ?? '-'}</td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          <PartTag code={log.inventory_items?.part_code ?? null} />
                        </td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', color: TEXT, fontSize: 12 }}>
                          {log.requester_id ? getEngName(log.requester_id) : '-'}
                        </td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', color: TEXT, fontSize: 12 }}>
                          {log.engineer_id ? getEngName(log.engineer_id) : '-'}
                        </td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 800, fontSize: 15, color: isIn ? '#15803d' : RED, letterSpacing: '-0.3px' }}>
                            {isIn ? '+' : '−'}{log.quantity_out}
                          </span>
                          <span style={{ fontSize: 11, color: isIn ? '#15803d' : RED, fontWeight: 600, marginLeft: 2 }}>개</span>
                        </td>
                        <td style={{ padding: '11px 14px', color: GRAY, fontSize: 12, whiteSpace: 'nowrap' }}>{log.outlet_company ?? '-'}</td>
                        <td style={{ padding: '11px 14px', color: GRAY, fontSize: 12, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.reason ?? '-'}</td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          {!isIn && (
                            log.is_restocked
                              ? <span style={{ fontSize: 11, color: MUTED, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#f3f4f6' }}>재입고 완료</span>
                              : <button className="restock-btn"
                                  onClick={() => { setSelectedLog(log); setRestockQty(log.quantity_out); setRestockReason('') }}
                                  style={{
                                    padding: '5px 12px', border: `1px solid #bbf7d0`, borderRadius: 7,
                                    fontWeight: 700, fontSize: 12, cursor: 'pointer',
                                    background: '#f0fdf4', color: '#15803d', transition: 'all 0.15s ease',
                                  }}
                                  onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = '#15803d'; b.style.color = '#fff'; b.style.borderColor = '#15803d' }}
                                  onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = '#f0fdf4'; b.style.color = '#15803d'; b.style.borderColor = '#bbf7d0' }}>
                                  재입고
                                </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ─ 요청 이력 ─ */}
          {activeTab === 'requests' && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1.5px solid ${BORDER}`, background: '#f8fafc' }}>
                    {['요청일시', '품명', '부품코드', ...(isSuper ? ['요청자'] : []), '요청 수량', '사유', '상태', '반려 사유'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: MUTED, fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11, letterSpacing: '0.4px', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {myRequests.length === 0 ? (
                    <tr><td colSpan={8}>
                      <div style={{ padding: '56px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.8">
                            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                          </svg>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: GRAY }}>요청 이력이 없습니다</div>
                        <div style={{ fontSize: 12, color: MUTED }}>재고 목록에서 출고 요청을 할 수 있습니다</div>
                      </div>
                    </td></tr>
                  ) : myRequests.map(req => {
                    const st = STATUS_STYLE[req.status] ?? { bg: '#f3f4f6', color: GRAY, border: BORDER }
                    return (
                      <tr key={req.request_id} className="inv-tr" style={{ borderBottom: `1px solid ${BORDER}` }}>
                        <td style={{ padding: '11px 14px', color: MUTED, fontSize: 12, whiteSpace: 'nowrap' }}>
                          {new Date(req.requested_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '11px 14px', fontWeight: 600, color: TEXT, minWidth: 120 }}>{req.inventory_items?.item_name ?? '-'}</td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          <PartTag code={req.inventory_items?.part_code ?? null} />
                        </td>
                        {isSuper && <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', color: TEXT, fontSize: 12 }}>{getEngName(req.requester_id)}</td>}
                        <td style={{ padding: '11px 14px', fontWeight: 700, color: TEXT, whiteSpace: 'nowrap' }}>{req.quantity}개</td>
                        <td style={{ padding: '11px 14px', color: GRAY, fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.reason ?? '-'}</td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                            {req.status}
                          </span>
                        </td>
                        <td style={{ padding: '11px 14px', color: RED, fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {req.reject_reason ?? <span style={{ color: MUTED }}>-</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ─ 승인 관리 ─ */}
          {activeTab === 'approval' && isManager && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1.5px solid ${BORDER}`, background: '#f8fafc' }}>
                    {['요청일시', '품명', '부품코드', '보관장소', '현재 재고', '요청자', '요청 수량', '사유', ''].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: MUTED, fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11, letterSpacing: '0.4px', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pendingRequests.length === 0 ? (
                    <tr><td colSpan={9}>
                      <div style={{ padding: '56px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="1.8">
                            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                          </svg>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: GRAY }}>대기 중인 요청이 없습니다</div>
                        <div style={{ fontSize: 12, color: MUTED }}>모든 출고 요청이 처리되었습니다</div>
                      </div>
                    </td></tr>
                  ) : pendingRequests.map(req => {
                    const item = items.find(i => i.item_id === req.item_id)
                    const stockShort = item !== undefined && item.quantity < req.quantity
                    const loc = LOC_STYLE[req.inventory_items?.location ?? ''] ?? null
                    return (
                      <tr key={req.request_id} className="inv-tr" style={{ borderBottom: `1px solid ${BORDER}` }}>
                        <td style={{ padding: '11px 14px', color: MUTED, fontSize: 12, whiteSpace: 'nowrap' }}>
                          {new Date(req.requested_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '11px 14px', fontWeight: 600, color: TEXT, minWidth: 120 }}>{req.inventory_items?.item_name ?? '-'}</td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          <PartTag code={req.inventory_items?.part_code ?? null} />
                        </td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          {loc
                            ? <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: loc.bg, color: loc.color }}>{req.inventory_items?.location}</span>
                            : <span style={{ color: MUTED }}>-</span>}
                        </td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          {stockShort ? (
                            <span style={{ fontWeight: 800, color: RED, fontSize: 13, background: '#fef2f2', padding: '3px 9px', borderRadius: 6, border: '1px solid #fecaca' }}>
                              {item?.quantity ?? 0}개 ⚠
                            </span>
                          ) : (
                            <span style={{ fontWeight: 700, color: TEXT }}>{item?.quantity ?? '-'}개</span>
                          )}
                        </td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', color: TEXT, fontSize: 12 }}>{getEngName(req.requester_id)}</td>
                        <td style={{ padding: '11px 14px', fontWeight: 800, color: TEXT, whiteSpace: 'nowrap', fontSize: 14 }}>{req.quantity}개</td>
                        <td style={{ padding: '11px 14px', color: GRAY, fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.reason ?? '-'}</td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => handleApprove(req)} disabled={isProcessing}
                              style={{
                                padding: '6px 16px', border: 'none', borderRadius: 7,
                                fontWeight: 700, fontSize: 12, cursor: isProcessing ? 'wait' : 'pointer',
                                background: '#15803d', color: '#fff', opacity: isProcessing ? 0.6 : 1,
                                transition: 'background 0.15s ease, opacity 0.15s ease',
                              }}
                              onMouseEnter={e => { if (!isProcessing) (e.currentTarget as HTMLButtonElement).style.background = '#14532d' }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#15803d' }}>
                              승인
                            </button>
                            <button onClick={() => { setRejectingRequest(req); setRejectReason('') }} disabled={isProcessing}
                              style={{
                                padding: '6px 16px', border: `1px solid #fecaca`, borderRadius: 7,
                                fontWeight: 700, fontSize: 12, cursor: isProcessing ? 'wait' : 'pointer',
                                background: '#fef2f2', color: RED, opacity: isProcessing ? 0.6 : 1,
                                transition: 'all 0.15s ease',
                              }}
                              onMouseEnter={e => { if (!isProcessing) { const b = e.currentTarget as HTMLButtonElement; b.style.background = RED; b.style.color = '#fff'; b.style.borderColor = RED } }}
                              onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = '#fef2f2'; b.style.color = RED; b.style.borderColor = '#fecaca' }}>
                              반려
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ══ 출고 요청 모달 ══ */}
      {requestItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="modal-box" style={{ background: CARD_BG, borderRadius: 20, width: '100%', maxWidth: 460, boxShadow: '0 24px 80px rgba(0,0,0,0.22)', maxHeight: '92vh', overflowY: 'auto', border: `1px solid ${BORDER}` }}>
            <ModalHeader title="출고 요청" accentColor={BLUE} onClose={() => { setRequestItem(null); setRequestOutletCompany(''); setRequestReason(''); setRequestNote('') }} />

            <div style={{ padding: '22px 24px 0' }}>
              {/* 품목 정보 카드 */}
              <div style={{ background: '#f8fafc', borderRadius: 14, padding: '16px 18px', marginBottom: 22, border: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 8 }}>품목 정보</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, marginBottom: 14, letterSpacing: '-0.3px' }}>{requestItem.item_name ?? '-'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', marginBottom: 4, textTransform: 'uppercase' }}>부품코드</div>
                    <PartTag code={requestItem.part_code} />
                  </div>
                  <div>
                    <div style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', marginBottom: 4, textTransform: 'uppercase' }}>보관장소</div>
                    {(() => {
                      const loc = LOC_STYLE[requestItem.location ?? ''] ?? null
                      return loc
                        ? <span style={{ fontSize: 12, padding: '2px 9px', borderRadius: 20, background: loc.bg, color: loc.color, fontWeight: 700 }}>{requestItem.location}</span>
                        : <span style={{ fontSize: 12, color: GRAY, fontWeight: 600 }}>{requestItem.location ?? '-'}</span>
                    })()}
                  </div>
                  <div>
                    <div style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', marginBottom: 4, textTransform: 'uppercase' }}>현재 재고</div>
                    <span style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>
                      {requestItem.quantity}개
                    </span>
                  </div>
                  {requestItem.lot_no && (
                    <div>
                      <div style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', marginBottom: 4, textTransform: 'uppercase' }}>제번</div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: GRAY }}>{requestItem.lot_no}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 수량 스테퍼 */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, marginBottom: 12 }}>요청 수량</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
                  <button className="qty-btn" onClick={() => setRequestQty(q => Math.max(1, q - 1))}
                    style={{ width: 40, height: 40, borderRadius: '50%', border: `1.5px solid ${BORDER}`, background: '#f8fafc', cursor: 'pointer', fontSize: 20, fontWeight: 700, color: TEXT, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s ease' }}>
                    −
                  </button>
                  <div style={{ textAlign: 'center', minWidth: 72 }}>
                    <span style={{ fontSize: 36, fontWeight: 800, color: TEXT, lineHeight: 1, letterSpacing: '-1px' }}>{requestQty}</span>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 3, fontWeight: 600 }}>개</div>
                  </div>
                  <button className="qty-btn" onClick={() => setRequestQty(q => q + 1)}
                    style={{ width: 40, height: 40, borderRadius: '50%', border: `1.5px solid ${BORDER}`, background: '#f8fafc', cursor: 'pointer', fontSize: 20, fontWeight: 700, color: TEXT, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s ease' }}>
                    +
                  </button>
                </div>
              </div>

              {/* 입력 필드 */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: TEXT, display: 'block', marginBottom: 6 }}>
                  출고 업체 <span style={{ color: RED }}>*</span>
                </label>
                <input className="inv-input" value={requestOutletCompany} onChange={e => { setRequestOutletCompany(e.target.value); reqErr.clearError('outlet') }}
                  placeholder="출고 업체명을 입력하세요" style={reqErr.errors.outlet ? { ...inp, border: errBorder } : { ...inp }} />
                <FieldError message={reqErr.errors.outlet} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: TEXT, display: 'block', marginBottom: 6 }}>
                  출고 사유 <span style={{ color: RED }}>*</span>
                </label>
                <textarea className="inv-input" value={requestReason} onChange={e => { setRequestReason(e.target.value); reqErr.clearError('reason') }}
                  placeholder="출고 사유 또는 사용처를 입력하세요" rows={3}
                  style={reqErr.errors.reason ? { ...inp, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit', border: errBorder } : { ...inp, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }} />
                <FieldError message={reqErr.errors.reason} />
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: TEXT, display: 'block', marginBottom: 6 }}>
                  비고 <span style={{ fontWeight: 400, color: MUTED }}>(선택)</span>
                </label>
                <textarea className="inv-input" value={requestNote} onChange={e => setRequestNote(e.target.value)}
                  placeholder="추가로 전달할 내용이 있으면 입력하세요" rows={2}
                  style={{ ...inp, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }} />
              </div>
            </div>

            <div style={{ padding: '0 24px 24px', display: 'flex', gap: 8 }}>
              <button className="cancel-btn" onClick={() => { setRequestItem(null); setRequestOutletCompany(''); setRequestReason(''); setRequestNote('') }}
                style={{ flex: 1, padding: '12px', background: '#f4f5f7', border: 'none', borderRadius: 11, cursor: 'pointer', fontWeight: 700, fontSize: 13, color: TEXT, transition: 'background 0.15s ease' }}>취소</button>
              <button onClick={handleRequest} disabled={isSavingRequest || requestQty < 1}
                style={{ flex: 2, padding: '12px', background: BLUE, color: '#fff', border: 'none', borderRadius: 11, cursor: isSavingRequest ? 'wait' : 'pointer', fontWeight: 700, fontSize: 13, opacity: isSavingRequest ? 0.7 : 1, transition: 'opacity 0.15s ease' }}>
                {isSavingRequest ? '요청 중...' : `${requestQty}개 출고 요청`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ 재입고 모달 ══ */}
      {selectedLog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="modal-box" style={{ background: CARD_BG, borderRadius: 20, width: '100%', maxWidth: 460, boxShadow: '0 24px 80px rgba(0,0,0,0.22)', border: `1px solid ${BORDER}` }}>
            <ModalHeader title="재입고 처리" accentColor="#15803d" onClose={() => setSelectedLog(null)} />

            <div style={{ padding: '22px 24px 0' }}>
              {/* 원래 출고 이력 카드 */}
              <div style={{ background: '#f0fdf4', borderRadius: 14, padding: '16px 18px', marginBottom: 22, border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#15803d', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 8 }}>원래 출고 이력</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 12, letterSpacing: '-0.3px' }}>{selectedLog.inventory_items?.item_name ?? '-'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', marginBottom: 4, textTransform: 'uppercase' }}>부품코드</div>
                    <PartTag code={selectedLog.inventory_items?.part_code ?? null} />
                  </div>
                  <div>
                    <div style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', marginBottom: 4, textTransform: 'uppercase' }}>출고량</div>
                    <span style={{ fontSize: 15, fontWeight: 800, color: RED }}>{selectedLog.quantity_out}개</span>
                  </div>
                  {selectedLog.reason && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', marginBottom: 4, textTransform: 'uppercase' }}>사유</div>
                      <span style={{ fontSize: 12, color: GRAY }}>{selectedLog.reason}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 재입고 수량 스테퍼 */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, marginBottom: 12 }}>재입고 수량</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
                  <button className="qty-btn" onClick={() => setRestockQty(q => Math.max(1, q - 1))}
                    style={{ width: 40, height: 40, borderRadius: '50%', border: `1.5px solid ${BORDER}`, background: '#f8fafc', cursor: 'pointer', fontSize: 20, fontWeight: 700, color: TEXT, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s ease' }}>
                    −
                  </button>
                  <div style={{ textAlign: 'center', minWidth: 72 }}>
                    <span style={{ fontSize: 36, fontWeight: 800, color: '#15803d', lineHeight: 1, letterSpacing: '-1px' }}>{restockQty}</span>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 3, fontWeight: 600 }}>개</div>
                  </div>
                  <button className="qty-btn" onClick={() => setRestockQty(q => q + 1)}
                    style={{ width: 40, height: 40, borderRadius: '50%', border: `1.5px solid ${BORDER}`, background: '#f8fafc', cursor: 'pointer', fontSize: 20, fontWeight: 700, color: TEXT, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s ease' }}>
                    +
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: TEXT, display: 'block', marginBottom: 6 }}>
                  사유 <span style={{ fontWeight: 400, color: MUTED }}>(선택)</span>
                </label>
                <textarea className="inv-input" value={restockReason} onChange={e => setRestockReason(e.target.value)}
                  placeholder="재입고 사유를 입력하세요" rows={2}
                  style={{ ...inp, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }} />
              </div>
            </div>

            <div style={{ padding: '0 24px 24px', display: 'flex', gap: 8 }}>
              <button className="cancel-btn" onClick={() => setSelectedLog(null)}
                style={{ flex: 1, padding: '12px', background: '#f4f5f7', border: 'none', borderRadius: 11, cursor: 'pointer', fontWeight: 700, fontSize: 13, color: TEXT, transition: 'background 0.15s ease' }}>취소</button>
              <button onClick={handleRestock} disabled={isRestocking}
                style={{ flex: 2, padding: '12px', background: '#15803d', color: '#fff', border: 'none', borderRadius: 11, cursor: isRestocking ? 'wait' : 'pointer', fontWeight: 700, fontSize: 13, opacity: isRestocking ? 0.7 : 1, transition: 'background 0.15s ease, opacity 0.15s ease' }}
                onMouseEnter={e => { if (!isRestocking) (e.currentTarget as HTMLButtonElement).style.background = '#14532d' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#15803d' }}>
                {isRestocking ? '처리 중...' : `${restockQty}개 재입고 확인`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ 반려 모달 ══ */}
      {rejectingRequest && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="modal-box" style={{ background: CARD_BG, borderRadius: 20, width: '100%', maxWidth: 440, boxShadow: '0 24px 80px rgba(0,0,0,0.22)', border: `1px solid ${BORDER}` }}>
            <ModalHeader title="출고 요청 반려" accentColor={RED} onClose={() => setRejectingRequest(null)} />

            <div style={{ padding: '22px 24px 0' }}>
              {/* 요청 정보 카드 */}
              <div style={{ background: '#fef2f2', borderRadius: 14, padding: '16px 18px', marginBottom: 22, border: '1px solid #fecaca' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: RED, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 8 }}>요청 정보</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 10, letterSpacing: '-0.3px' }}>{rejectingRequest.inventory_items?.item_name ?? '-'}</div>
                <div style={{ display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap' }}>
                  <div>
                    <span style={{ color: MUTED, fontWeight: 600 }}>요청자 </span>
                    <span style={{ color: TEXT, fontWeight: 700 }}>{getEngName(rejectingRequest.requester_id)}</span>
                  </div>
                  <div>
                    <span style={{ color: MUTED, fontWeight: 600 }}>수량 </span>
                    <span style={{ color: RED, fontWeight: 800 }}>{rejectingRequest.quantity}개</span>
                  </div>
                  {rejectingRequest.reason && (
                    <div style={{ width: '100%' }}>
                      <span style={{ color: MUTED, fontWeight: 600 }}>사유 </span>
                      <span style={{ color: GRAY }}>{rejectingRequest.reason}</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: TEXT, display: 'block', marginBottom: 6 }}>
                  반려 사유 <span style={{ color: RED }}>*</span>
                </label>
                <textarea className="inv-input" value={rejectReason} onChange={e => { setRejectReason(e.target.value); rejErr.clearError('reason') }}
                  placeholder="반려 사유를 입력해주세요" rows={3}
                  style={rejErr.errors.reason ? { ...inp, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit', border: errBorder } : { ...inp, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }} />
                <FieldError message={rejErr.errors.reason} />
              </div>
            </div>

            <div style={{ padding: '0 24px 24px', display: 'flex', gap: 8 }}>
              <button className="cancel-btn" onClick={() => setRejectingRequest(null)}
                style={{ flex: 1, padding: '12px', background: '#f4f5f7', border: 'none', borderRadius: 11, cursor: 'pointer', fontWeight: 700, fontSize: 13, color: TEXT, transition: 'background 0.15s ease' }}>취소</button>
              <button onClick={handleReject} disabled={isProcessing || !rejectReason.trim()}
                style={{ flex: 2, padding: '12px', background: RED, color: '#fff', border: 'none', borderRadius: 11, cursor: isProcessing ? 'wait' : 'pointer', fontWeight: 700, fontSize: 13, opacity: (isProcessing || !rejectReason.trim()) ? 0.45 : 1, transition: 'opacity 0.15s ease, background 0.15s ease' }}
                onMouseEnter={e => { if (!isProcessing && rejectReason.trim()) (e.currentTarget as HTMLButtonElement).style.background = '#b91c1c' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = RED }}>
                {isProcessing ? '처리 중...' : '반려 확인'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ 엑셀 일괄 처리 모달 ══ */}
      {showExcelModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="modal-box" style={{ background: CARD_BG, borderRadius: 20, width: '100%', maxWidth: 840, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.22)', border: `1px solid ${BORDER}` }}>

            <ModalHeader title="엑셀 일괄 처리" accentColor={BLUE} onClose={() => setShowExcelModal(false)} />

            <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>

              {/* 처리 유형 */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, marginBottom: 10 }}>처리 유형</div>
                <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 11, padding: 4, gap: 2, width: 'fit-content' }}>
                  {(['out', 'in'] as const).map(t => (
                    <button key={t} onClick={() => { setExcelType(t); setExcelRows([]); setExcelResults(null); setExcelFileName('') }}
                      style={{
                        padding: '8px 28px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 13,
                        background: excelType === t ? '#fff' : 'transparent',
                        color: excelType === t ? (t === 'out' ? RED : '#15803d') : GRAY,
                        boxShadow: excelType === t ? '0 2px 6px rgba(0,0,0,0.10)' : 'none',
                        transition: 'all 0.15s ease',
                      }}>
                      {t === 'out' ? '출고' : '입고'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 파일 업로드 */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, marginBottom: 10 }}>엑셀 파일 업로드</div>
                <label className="excel-drop"
                  onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                  onDragEnter={e => { e.preventDefault(); e.stopPropagation() }}
                  onDrop={e => {
                    e.preventDefault(); e.stopPropagation()
                    const file = e.dataTransfer.files[0]
                    if (file) handleExcelFile(file)
                  }}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    padding: '36px 20px',
                    border: `2px dashed ${excelFileName ? BLUE : '#d1d5db'}`,
                    borderRadius: 14,
                    background: excelFileName ? '#eff4ff' : '#fafafa',
                    cursor: 'pointer', gap: 12,
                    transition: 'border-color 0.15s ease, background 0.15s ease',
                  }}>
                  <div style={{ width: 52, height: 52, borderRadius: 14, background: excelFileName ? '#dce9ff' : '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s ease' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={excelFileName ? BLUE : MUTED} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                    </svg>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: excelFileName ? BLUE : GRAY }}>
                      {excelFileName || '파일을 클릭하거나 드래그해서 업로드'}
                    </div>
                    {!excelFileName && <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>.xlsx / .xls 형식 지원</div>}
                    {excelFileName && excelRows.length > 0 && (
                      <div style={{ fontSize: 12, color: '#6b8fce', marginTop: 4, fontWeight: 600 }}>{excelRows.length}행 인식됨</div>
                    )}
                  </div>
                  <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                    onChange={e => { if (e.target.files?.[0]) handleExcelFile(e.target.files[0]) }} />
                </label>
              </div>

              {/* 필드 안내 */}
              <div style={{ marginBottom: 18, padding: '12px 16px', background: '#f8fafc', borderRadius: 10, border: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: TEXT, marginBottom: 6 }}>
                  {excelType === 'out' ? '출고 엑셀 컬럼' : '입고 엑셀 컬럼'}
                </div>
                <div style={{ fontSize: 12, color: GRAY, lineHeight: 1.8 }}>
                  {excelType === 'out' ? (
                    <>재고번호 · <b style={{ color: BLUE }}>부품코드 *</b> · 품명 · <b style={{ color: BLUE }}>출고수량 *</b> · 출고업체 · 사유 · 부서명</>
                  ) : (
                    <>재고번호 · <b style={{ color: BLUE }}>부품코드 *</b> · 품명 · PO No. · 제번 · <b style={{ color: BLUE }}>수량 *</b> · 보관장소 · 매입일자 · 부서명</>
                  )}
                  <span style={{ marginLeft: 10, color: RED, fontWeight: 700 }}>* 필수</span>
                </div>
              </div>

              {/* 미리보기 */}
              {excelRows.length > 0 && !excelResults && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, marginBottom: 8 }}>
                    미리보기
                    <span style={{ fontWeight: 400, color: MUTED, marginLeft: 6 }}>— {excelRows.length}행 중 최대 10행</span>
                  </div>
                  <div style={{ overflowX: 'auto', borderRadius: 10, border: `1px solid ${BORDER}` }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: `1px solid ${BORDER}` }}>
                          {(excelType === 'out'
                            ? ['부품코드', '출고수량', '출고업체', '사유', '부서명']
                            : ['부품코드', '수량', '보관장소', 'PO No.', '제번', '매입일자', '부서명']
                          ).map(h => (
                            <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: MUTED, fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11, letterSpacing: '0.3px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {excelRows.slice(0, 10).map((row, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid #f3f4f6` }}>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{ fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: '#eff4ff', color: BLUE, fontSize: 11 }}>{String(row['부품코드'] ?? '-')}</span>
                            </td>
                            {excelType === 'out' ? (
                              <>
                                <td style={{ padding: '8px 12px', fontWeight: 700, color: TEXT }}>{String(row['출고수량'] ?? '-')}</td>
                                <td style={{ padding: '8px 12px', color: GRAY }}>{String(row['출고업체'] ?? '-')}</td>
                                <td style={{ padding: '8px 12px', color: GRAY }}>{String(row['사유'] ?? '-')}</td>
                                <td style={{ padding: '8px 12px', color: GRAY }}>{String(row['부서명'] ?? '-')}</td>
                              </>
                            ) : (
                              <>
                                <td style={{ padding: '8px 12px', fontWeight: 700, color: TEXT }}>{String(row['수량'] ?? '-')}</td>
                                <td style={{ padding: '8px 12px', color: GRAY }}>{String(row['보관장소'] ?? '-')}</td>
                                <td style={{ padding: '8px 12px', color: GRAY }}>{String(row['PO No.'] ?? row['PO번호'] ?? '-')}</td>
                                <td style={{ padding: '8px 12px', color: GRAY }}>{String(row['제번'] ?? '-')}</td>
                                <td style={{ padding: '8px 12px', color: GRAY }}>{parseExcelDate(row['매입일자']) ?? '-'}</td>
                                <td style={{ padding: '8px 12px', color: GRAY }}>{String(row['부서명'] ?? '-')}</td>
                              </>
                            )}
                          </tr>
                        ))}
                        {excelRows.length > 10 && (
                          <tr><td colSpan={excelType === 'out' ? 5 : 7} style={{ padding: '8px 12px', color: MUTED, textAlign: 'center', fontSize: 11 }}>... 외 {excelRows.length - 10}행</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 처리 결과 */}
              {excelResults && (
                <div>
                  {/* 성공/실패 요약 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
                    <div style={{ padding: '20px 24px', background: '#f0fdf4', borderRadius: 14, border: '1px solid #bbf7d0', textAlign: 'center' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 8 }}>성공</div>
                      <div style={{ fontSize: 36, fontWeight: 800, color: '#15803d', lineHeight: 1, letterSpacing: '-1px' }}>{excelResults.filter(r => r.success).length}</div>
                      <div style={{ fontSize: 12, color: '#15803d', marginTop: 4, fontWeight: 600 }}>건 처리 완료</div>
                    </div>
                    <div style={{ padding: '20px 24px', background: '#fef2f2', borderRadius: 14, border: '1px solid #fecaca', textAlign: 'center' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: RED, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 8 }}>실패</div>
                      <div style={{ fontSize: 36, fontWeight: 800, color: RED, lineHeight: 1, letterSpacing: '-1px' }}>{excelResults.filter(r => !r.success).length}</div>
                      <div style={{ fontSize: 12, color: RED, marginTop: 4, fontWeight: 600 }}>건 처리 실패</div>
                    </div>
                  </div>

                  {/* 결과 상세 테이블 */}
                  <div style={{ overflowX: 'auto', borderRadius: 10, border: `1px solid ${BORDER}` }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: `1px solid ${BORDER}` }}>
                          {['부품코드', '품명', '수량', '결과'].map(h => (
                            <th key={h} style={{ padding: '9px 12px', textAlign: 'left', color: MUTED, fontWeight: 700, fontSize: 11, letterSpacing: '0.3px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {excelResults.map((r, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid #f3f4f6`, background: r.success ? '#f8fffe' : '#fff' }}>
                            <td style={{ padding: '9px 12px' }}>
                              <span style={{ fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: '#eff4ff', color: BLUE, fontSize: 11 }}>{r.partCode}</span>
                            </td>
                            <td style={{ padding: '9px 12px', color: TEXT, fontWeight: 500 }}>{r.itemName ?? '-'}</td>
                            <td style={{ padding: '9px 12px', fontWeight: 700, color: TEXT }}>{r.qty}</td>
                            <td style={{ padding: '9px 12px' }}>
                              {r.success
                                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#15803d', fontWeight: 700 }}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                                    완료
                                  </span>
                                : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: RED, fontWeight: 700 }}>
                                    <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/></svg>
                                    {r.error}
                                  </span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* 하단 버튼 */}
            <div style={{ padding: '16px 24px', borderTop: `1px solid ${BORDER}`, display: 'flex', gap: 8, flexShrink: 0 }}>
              <button className="cancel-btn" onClick={() => setShowExcelModal(false)}
                style={{ flex: 1, padding: '12px', background: '#f4f5f7', border: 'none', borderRadius: 11, cursor: 'pointer', fontWeight: 700, fontSize: 13, color: TEXT, transition: 'background 0.15s ease' }}>
                {excelResults ? '닫기' : '취소'}
              </button>
              {!excelResults && (
                <button onClick={handleProcessExcel}
                  disabled={isProcessingExcel || excelRows.length === 0}
                  style={{
                    flex: 2, padding: '12px',
                    background: excelType === 'out' ? RED : '#15803d',
                    color: '#fff', border: 'none', borderRadius: 11,
                    cursor: (isProcessingExcel || excelRows.length === 0) ? 'not-allowed' : 'pointer',
                    fontWeight: 700, fontSize: 13,
                    opacity: (isProcessingExcel || excelRows.length === 0) ? 0.5 : 1,
                    transition: 'opacity 0.15s ease',
                  }}>
                  {isProcessingExcel ? '처리 중...' : `${excelRows.length}행 ${excelType === 'out' ? '출고' : '입고'} 처리`}
                </button>
              )}
              {excelResults && excelResults.some(r => !r.success) && (
                <button onClick={() => { setExcelRows([]); setExcelResults(null); setExcelFileName('') }}
                  style={{ flex: 2, padding: '12px', background: BLUE, color: '#fff', border: 'none', borderRadius: 11, cursor: 'pointer', fontWeight: 700, fontSize: 13, transition: 'opacity 0.15s ease' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}>
                  다시 업로드
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Page() {
  return (
    <Suspense>
      <InventoryPage />
    </Suspense>
  )
}
