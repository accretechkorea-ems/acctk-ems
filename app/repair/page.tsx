'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRepairs, type Repair, type RepairStatus } from '@/hooks/useRepairs'
import { useRepairAuth } from '@/hooks/useRepairAuth'

// ── 색상 (기존 페이지 컨벤션과 동일) ──
const BLUE = '#234ea2'
const GREEN = '#15803d'
const ORANGE = '#d97706'
const RED = '#dc2626'
const PAGE_BG = '#f4f5f7'
const CARD_BG = '#ffffff'
const BORDER = '#e2e4e9'
const TEXT = '#111113'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'

const STATUSES: RepairStatus[] = ['입고', '수리중', '출고대기', '출고완료']

const STATUS_STYLE: Record<RepairStatus, { bg: string; color: string; border: string }> = {
  '입고': { bg: '#f3f4f6', color: GRAY, border: BORDER },
  '수리중': { bg: '#fffbeb', color: ORANGE, border: '#fde68a' },
  '출고대기': { bg: '#eff4ff', color: BLUE, border: '#bfd3f2' },
  '출고완료': { bg: '#f0fdf4', color: GREEN, border: '#bbf7d0' },
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
const CATEGORY_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  '게이지': { bg: '#eff4ff', color: BLUE, border: '#bfd3f2' },
  '앰프': { bg: '#f0fdf4', color: GREEN, border: '#bbf7d0' },
}

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

  const { authorized, currentEngineer } = useRepairAuth()
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
  const [page, setPage] = useState(0)

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
  useEffect(() => { setPage(0) }, [statusFilter, categoryFilter])

  // ── 접수 등록 ──
  const handleSubmit = async () => {
    if (!currentEngineer) return
    if (!customerName.trim()) { alert('회사명을 입력해주세요.'); return }
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
    if (error) { alert('등록 중 오류가 발생했습니다: ' + error.message); return }
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
    else if (next === '출고완료') { patch.shipped_at = nowIso; patch.shipped_date = todayStr() }
    const { error } = await supabase.from('repairs').update(patch).eq('repair_id', r.repair_id)
    if (error) { alert('상태 변경 실패: ' + error.message); return }
    await refetch()
  }

  const handleDelete = async (r: Repair) => {
    if (!confirm(`'${r.customer_name ?? ''} / ${r.serial_number ?? '-'}' 접수 건을 삭제하시겠습니까?`)) return
    const { error } = await supabase.from('repairs').delete().eq('repair_id', r.repair_id)
    if (error) { alert('삭제 실패: ' + error.message); return }
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
          alert('헤더(입고일·회사명 …)를 찾지 못했습니다. 시트 형식을 확인해주세요.')
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
      if (error) { setIsImporting(false); alert('가져오기 오류: ' + error.message); return }
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

  // ── 목록 필터 ──
  const filteredRepairs = useMemo(
    () => repairs.filter(r =>
      (statusFilter === '전체' || r.status === statusFilter) &&
      (categoryFilter === '전체' || r.item_type === categoryFilter)
    ),
    [repairs, statusFilter, categoryFilter]
  )

  // 페이지네이션 (50개씩)
  const PAGE_SIZE = 50
  const totalPages = Math.max(1, Math.ceil(filteredRepairs.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages - 1)
  const pagedRepairs = filteredRepairs.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE)

  // 수리 진행 중(수리중) — 항상 상단 고정 표시 (구분 필터는 반영)
  const repairingList = repairs.filter(r => r.status === '수리중' && (categoryFilter === '전체' || r.item_type === categoryFilter))

  // ── 순번 (자동): 입고일 내림차순 목록에서 최신이 큰 번호 ──
  const seqMap = useMemo(() => {
    const m = new Map<number, number>()
    repairs.forEach((r, i) => m.set(r.repair_id, repairs.length - i))
    return m
  }, [repairs])

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

  // ── 월별 집계 (건수 기준, 최근 6개월) ──
  const monthlyStats = useMemo(() => {
    const months: string[] = []
    for (let i = 5; i >= 0; i--) months.push(shiftMonth(viewMonth, -i))
    return months.map(ym => ({
      ym,
      label: fmtMonthLabel(ym),
      received: repairs.filter(r => monthKey(r.received_date) === ym).length,
      shipped: repairs.filter(r => r.status === '출고완료' && monthKey(r.shipped_date) === ym).length,
    }))
  }, [repairs, viewMonth])

  const maxMonthly = Math.max(1, ...monthlyStats.map(m => Math.max(m.received, m.shipped)))

  // ── 렌더 게이트 ──
  if (authorized === null) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', fontSize: 16, color: GRAY }}>확인 중...</div>
  }
  if (authorized === false) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center', alignItems: 'center', height: '60vh', color: GRAY }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>접근 권한이 없습니다</div>
        <div style={{ fontSize: 14 }}>이 페이지는 20팀 담당자와 관리자만 열람할 수 있습니다.</div>
        <button onClick={() => router.push('/')} style={{ marginTop: 8, padding: '8px 18px', border: 'none', borderRadius: 8, background: BLUE, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>홈으로</button>
      </div>
    )
  }

  const card: React.CSSProperties = { background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18 }
  const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', border: `1px solid ${BORDER}`, borderRadius: 9, fontSize: 14, outline: 'none', background: '#fff', color: TEXT, boxSizing: 'border-box' }
  const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: GRAY, marginBottom: 6, display: 'block' }

  // 목록 행 (고정 블록·페이지 목록 공용)
  const repairRow = (r: Repair) => {
    const cs = CATEGORY_STYLE[r.item_type ?? ''] ?? { bg: '#f3f4f6', color: GRAY, border: BORDER }
    return (
    <tr key={r.repair_id} style={{ borderBottom: `1px solid #f0f1f4` }}>
      <td style={{ ...td, textAlign: 'center', color: GRAY, fontWeight: 700 }}>{seqMap.get(r.repair_id)}</td>
      <td style={{ ...td, textAlign: 'center' }}>
        <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', background: cs.bg, color: cs.color, border: `1px solid ${cs.border}` }}>{r.item_type || '-'}</span>
      </td>
      <td style={{ ...td, textAlign: 'center', color: GRAY }}>{fmtWeek(r.received_date)}</td>
      <td style={td}>{r.received_date}</td>
      <td style={{ ...td, fontWeight: 700, color: TEXT }}>{r.customer_name}</td>
      <td style={td}>{r.product_type || '-'}</td>
      <td style={td}>{r.serial_number || '-'}</td>
      <td style={{ ...td, textAlign: 'center', color: GRAY }}>{r.shipped_date || '-'}</td>
      <td style={{ ...td, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            padding: '4px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
            background: STATUS_STYLE[r.status].bg, color: STATUS_STYLE[r.status].color,
            border: `1px solid ${STATUS_STYLE[r.status].border}`,
          }}>
            {r.status}
          </span>
          {NEXT_ACTION[r.status] && (
            <button onClick={() => advanceStatus(r, NEXT_ACTION[r.status]!.next)}
              style={{ padding: '4px 12px', borderRadius: 999, border: `1px solid ${BLUE}`, background: BLUE, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {NEXT_ACTION[r.status]!.label}
            </button>
          )}
        </div>
      </td>
      <td style={{ ...td, textAlign: 'center' }}>
        <button onClick={() => handleDelete(r)} title="삭제"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: MUTED, fontSize: 15, lineHeight: 1 }}>🗑</button>
      </td>
    </tr>
    )
  }

  const renderTable = (list: Repair[]) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 1000 }}>
        <thead>
          <tr style={{ borderBottom: `1.5px solid ${BORDER}`, color: GRAY, fontSize: 12.5 }}>
            <th style={{ ...th, textAlign: 'center' }}>순번</th>
            <th style={{ ...th, textAlign: 'center' }}>구분</th>
            <th style={{ ...th, textAlign: 'center' }}>월-주차</th>
            <th style={th}>입고일</th>
            <th style={th}>회사명</th>
            <th style={th}>제품 구분</th>
            <th style={th}>시리얼번호</th>
            <th style={{ ...th, textAlign: 'center' }}>출고일</th>
            <th style={{ ...th, textAlign: 'center' }}>상태</th>
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

      <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── KPI 카드 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }} className="repair-kpi">
          <div style={{ ...card, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: GRAY }}>보유 수리품</span>
              <button onClick={() => router.push('/repair/dashboard')}
                style={{ padding: '4px 10px', borderRadius: 999, border: `1px solid ${BLUE}`, background: '#fff', color: BLUE, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                대시보드 →
              </button>
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, color: BLUE, lineHeight: 1 }}>
              {kpiHeld}<span style={{ fontSize: 14, fontWeight: 700, color: MUTED, marginLeft: 3 }}>건</span>
            </div>
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6, fontWeight: 600 }}>입고 + 수리중 + 출고대기</div>
          </div>
          <KpiCard title="수리중" value={kpiRepairing} unit="건" color={BLUE} />
          <KpiCard title="출고 대기" value={kpiWaiting} unit="건" color={BLUE} sub="수리 완료" />
          <div style={{ ...card, padding: 16, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: GRAY }}>{fmtMonthLabel(viewMonth)} 출고완료</span>
              <span style={{ display: 'flex', gap: 4 }}>
                <MonthBtn onClick={() => setViewMonth(m => shiftMonth(m, -1))}>◀</MonthBtn>
                <MonthBtn onClick={() => setViewMonth(m => shiftMonth(m, 1))}>▶</MonthBtn>
              </span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, color: BLUE, lineHeight: 1 }}>
              {kpiShippedThisMonth}<span style={{ fontSize: 14, fontWeight: 700, color: MUTED, marginLeft: 3 }}>건</span>
            </div>
          </div>
        </div>

        {/* ── 새 수리품 접수 등록 ── */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>새 수리품 접수 등록</div>
            <button onClick={openImport}
              style={{ padding: '7px 14px', border: `1px solid ${BLUE}`, borderRadius: 8, background: '#fff', color: BLUE, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              엑셀 일괄 등록
            </button>
          </div>

          {/* 구분 · 입고일 · 회사명 · 제품 구분 · 시리얼번호 · 등록 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr 1.1fr 1.1fr 150px', gap: 12, alignItems: 'flex-end' }} className="repair-form-row">
            <div>
              <label style={label}>구분</label>
              <div style={{ display: 'flex', border: `1px solid ${BORDER}`, borderRadius: 9, overflow: 'hidden' }}>
                {CATEGORIES.map(c => (
                  <button key={c} type="button" onClick={() => setFormCategory(c)}
                    style={{ flex: 1, padding: '9px 0', border: 'none', background: formCategory === c ? BLUE : '#fff', color: formCategory === c ? '#fff' : GRAY, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={label}>입고일</label>
              <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} style={inp} />
            </div>
            <div>
              <label style={label}>회사명</label>
              <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="회사명 입력" style={inp} />
            </div>
            <div>
              <label style={label}>제품 구분</label>
              <input value={productType} onChange={e => setProductType(e.target.value)} placeholder="예: E-TS-4182-P6" style={inp} />
            </div>
            <div>
              <label style={label}>시리얼번호</label>
              <input value={serialNumber} onChange={e => setSerialNumber(e.target.value)} placeholder="시리얼번호" style={inp} />
            </div>
            <div>
              <button onClick={handleSubmit} disabled={isSaving}
                style={{ width: '100%', padding: '9px 0', border: 'none', borderRadius: 9, background: isSaving ? MUTED : BLUE, color: '#fff', fontSize: 14.5, fontWeight: 800, cursor: isSaving ? 'default' : 'pointer' }}>
                {isSaving ? '등록 중...' : '접수 등록'}
              </button>
            </div>
          </div>
        </div>

        {/* ── 수리품 목록 ── */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>수리품 목록 <span style={{ color: MUTED, fontWeight: 700 }}>({filteredRepairs.length})</span></div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['전체', ...CATEGORIES] as const).map(c => {
                  const active = categoryFilter === c
                  return (
                    <button key={c} onClick={() => setCategoryFilter(c)}
                      style={{
                        padding: '6px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        border: `1px solid ${active ? BLUE : BORDER}`, background: active ? BLUE : '#fff', color: active ? '#fff' : GRAY,
                      }}>
                      {c}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['전체', ...STATUSES] as const).map(s => {
                  const active = statusFilter === s
                  return (
                    <button key={s} onClick={() => setStatusFilter(s)}
                      style={{
                        padding: '6px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        border: `1px solid ${active ? BLUE : BORDER}`, background: active ? BLUE : '#fff', color: active ? '#fff' : GRAY,
                      }}>
                      {s}
                    </button>
                  )
                })}
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

        {/* ── 월별 접수/출고 그래프 (건수) ── */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>월별 접수 / 출고 현황 <span style={{ color: MUTED, fontWeight: 700, fontSize: 13 }}>(건수, 최근 6개월)</span></div>
            <div style={{ display: 'flex', gap: 16 }}>
              <Legend color={BLUE} label="접수" />
              <Legend color={GREEN} label="출고" />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0, height: 200, paddingTop: 10 }}>
            {monthlyStats.map(m => (
              <div key={m.ym} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, height: '100%' }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 6, width: '100%' }}>
                  <Bar value={m.received} max={maxMonthly} color={BLUE} />
                  <Bar value={m.shipped} max={maxMonthly} color={GREEN} />
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: GRAY }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>

      </div>

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
          .repair-form-row { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '9px 10px', fontWeight: 700, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '10px', color: TEXT, verticalAlign: 'middle' }

// ── 서브 컴포넌트 ──
function KpiCard({ title, value, unit, color, sub }: { title: string; value: number; unit: string; color: string; sub?: string }) {
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: GRAY, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color, lineHeight: 1 }}>
        {value}<span style={{ fontSize: 14, fontWeight: 700, color: MUTED, marginLeft: 3 }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6, fontWeight: 600 }}>{sub}</div>}
    </div>
  )
}

function MonthBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', color: GRAY, cursor: 'pointer', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
      {children}
    </button>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: GRAY }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const h = value === 0 ? 0 : Math.max(4, Math.round((value / max) * 100))
  return (
    <div style={{ flex: 1, maxWidth: 34, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: value === 0 ? MUTED : TEXT, marginBottom: 4 }}>{value}</div>
      <div style={{ width: '100%', height: `${h}%`, background: color, borderRadius: '5px 5px 0 0', minHeight: value === 0 ? 0 : 4, transition: 'height 0.2s' }} />
    </div>
  )
}
