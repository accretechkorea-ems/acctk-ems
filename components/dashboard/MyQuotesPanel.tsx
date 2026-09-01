'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SALES_STATUS_COLORS, getCategoryColor, salesStatusLabel } from '@/lib/categoryColors'
import { useToast } from '@/components/common/Toast'
import QuoteExcelButton from '@/components/quote/QuoteExcelButton'
import { useQuoteSelection } from '@/hooks/useQuoteSelection'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { updateQuoteStatus, uploadPurchaseOrder, requestTaxInvoice, notifyDeleteRequest } from '@/lib/quoteMutations'
import { isAutoFailed, isOrdered, REVENUE_STATUS, REVERT_NOTICE, AUTO_FAIL_NOTICE } from '@/lib/quoteStatus'
import { achieveColorOf } from '@/lib/fiscal'

// 대시보드 '내 견적' 패널. 실적 현황 EngineerQuoteModal 의 표시 + 관리 기능을 동일하게 구현한다.
// mutation 은 lib/quoteMutations.ts 공용 함수 사용(직접 supabase.update/fetch 안 씀).
// 본인 견적만 조회하므로(.eq engineer_id) 소유자 검사는 불필요(§5).

const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')
// 한 페이지에 싣는 기본 줄 수. fitToHeight 를 켜면 카드에 주어진 높이만큼 이 값에서 늘어난다.
const PAGE_SIZE = 10
const MAX_PAGE_SIZE = 40
// 목록 높이를 건수와 무관하게 고정하기 위한 한 줄 높이(패딩 8+8 + 글자 줄높이).
// 한 페이지가 다 안 차면 이 높이의 빈 줄로 채워, 페이지를 넘길 때 아래 요소가 튀지 않게 한다.
const ROW_H = 33
const TABLE_COLS = 10
const STATUS_TABS = ['전체', '견적중', '수리중', '발주(주문 대기)', '주문완료', '세금계산서 요청', '매출완료', '취소요청', '실패']

const BLUE = '#234ea2', TEXT = '#111827', GRAY = '#6b7280', MUTED = '#9ca3af', BORDER = '#ebebeb'
const ORANGE = '#d97706'
// 서브모달 z-index: 기존 모달 체계(10001)와 Toast(10100) 사이.
const SUBMODAL_Z = 10060

function fiscalYear(d: Date) { const m = d.getMonth() + 1; const y = d.getFullYear(); return m >= 4 ? y : y - 1 }
const pad = (n: number) => String(n).padStart(2, '0')

const MONTHS_FISCAL = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]
const UNIT_DIVISOR = { month: 12, quarter: 4, half: 2, year: 1 } as const
type PeriodUnit = keyof typeof UNIT_DIVISOR
// 'valid' = 유효 견적(작성일+1개월 이내). 회계연도 기반 4단위와 별개로 오늘 기준 롤링 범위를 쓴다.
type Unit = 'valid' | PeriodUnit
const lastDay = (y: number, mm: number) => new Date(y, mm, 0).getDate()
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function periodRange(fy: number, unit: PeriodUnit, sel: number): { start: string; end: string } {
  if (unit === 'year') return { start: `${fy}-04-01`, end: `${fy + 1}-03-31` }
  if (unit === 'half') return sel === 1
    ? { start: `${fy}-04-01`, end: `${fy}-09-30` }
    : { start: `${fy}-10-01`, end: `${fy + 1}-03-31` }
  if (unit === 'quarter') {
    const startMonth = [4, 7, 10, 1][sel - 1]
    const yr = sel === 4 ? fy + 1 : fy
    const endMonth = sel === 4 ? 3 : startMonth + 2
    return { start: `${yr}-${pad(startMonth)}-01`, end: `${yr}-${pad(endMonth)}-${pad(lastDay(yr, endMonth))}` }
  }
  const yr = sel >= 4 ? fy : fy + 1
  return { start: `${yr}-${pad(sel)}-01`, end: `${yr}-${pad(sel)}-${pad(lastDay(yr, sel))}` }
}

type QuoteItem = { product_name: string | null; row_kind?: string | null; price_list?: { model_jp: string | null } | null }
type Quote = {
  quote_id: number
  quote_number: string
  quote_date: string
  total_supply: number
  total_profit: number | null
  profit_rate: number | null
  status: string
  quote_type: string | null
  customer_id: number | null
  dealer_id: number | null
  pdf_url: string | null
  shipping_date: string | null
  order_memo: string | null
  order_completed_by: string | null
  tax_completed_by: string | null
  tax_invoice_date: string | null
  purchase_order_at: string | null
  tax_invoice_completed_at: string | null
  fail_reason: string | null
  quote_items: QuoteItem[] | null
  company_name: string
  dealer_name: string | null
}

// 상태 변경 창의 선택지. 되돌리기(견적중)는 실패한 건에만 붙는다.
type EditStatus = '취소요청' | '실패' | '견적중'
const EDIT_STATUSES: EditStatus[] = ['취소요청', '실패']
const EDIT_STATUSES_WITH_REVERT: EditStatus[] = ['취소요청', '실패', '견적중']
// fitToHeight: 카드가 (옆 열에 맞춰) 늘어난 높이를 목록 줄 수로 채운다.
// 끄면 지금까지처럼 10줄 고정이다.
export default function MyQuotesPanel({ engineerId, fitToHeight = false }: { engineerId: number; fitToHeight?: boolean }) {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [targetsByYear, setTargetsByYear] = useState<Record<number, { target: number; orderTarget: number }>>({})
  const [loading, setLoading] = useState(true)
  // 실제로 그리는 줄 수 = 페이징 단위. 화면 높이에 따라 달라지므로 상태로 둔다.
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const listBoxRef = useRef<HTMLDivElement>(null)   // 표가 들어가는 상자(남는 높이를 받는다)
  const headRef = useRef<HTMLTableSectionElement>(null)

  const now = new Date()
  const curFy = fiscalYear(now)
  const cm = now.getMonth() + 1
  const curQuarter = cm >= 4 && cm <= 6 ? 1 : cm >= 7 && cm <= 9 ? 2 : cm >= 10 ? 3 : 4
  const curHalf = cm >= 4 && cm <= 9 ? 1 : 2
  const [fy, setFy] = useState(curFy)
  const [unit, setUnit] = useState<Unit>('valid')   // 기본값: 유효 견적(작성일+1개월 이내)
  const [sel, setSel] = useState(cm)
  const [statusFilter, setStatusFilter] = useState('전체')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  // 메모 툴팁 + 서브모달 상태
  const [hoveredMemoId, setHoveredMemoId] = useState<number | null>(null)
  // 취소/실패
  const [editQuote, setEditQuote] = useState<Quote | null>(null)
  const [editStatus, setEditStatus] = useState<EditStatus>('취소요청')
  const [editFailReason, setEditFailReason] = useState('')
  const [saving, setSaving] = useState(false)
  // 발주서 등록
  const [poQuote, setPoQuote] = useState<Quote | null>(null)
  const [poFile, setPoFile] = useState<File | null>(null)
  const [poDelivery, setPoDelivery] = useState<'직납' | '택배발송'>('직납')
  const [poAddress, setPoAddress] = useState('')
  const [poAddressMode, setPoAddressMode] = useState<'company' | 'direct'>('company')
  const [poCompanyAddress, setPoCompanyAddress] = useState<string | null>(null)
  const [poContacts, setPoContacts] = useState<{ contact_id: number; name: string; phone: string | null; position: string | null; department: string | null }[]>([])
  const [poContactId, setPoContactId] = useState<number | ''>('')
  const [poUploading, setPoUploading] = useState(false)
  const [poIsDragging, setPoIsDragging] = useState(false)
  const poFileRef = useRef<HTMLInputElement>(null)
  // 세금계산서 요청
  const [taxQuote, setTaxQuote] = useState<Quote | null>(null)
  const [taxDate, setTaxDate] = useState('')
  const [taxSending, setTaxSending] = useState(false)
  const { errors, setErrors, clearError, validate } = useFieldErrors<'taxDate'>()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setErrors({}) }, [taxQuote])

  const changeUnit = (u: Unit) => {
    setUnit(u)
    setSel(u === 'quarter' ? curQuarter : u === 'half' ? curHalf : cm)
    setPage(1)
  }
  const fyOptions = [curFy + 1, curFy, curFy - 1, curFy - 2]

  // 데이터 로드(초기 + mutation 후 refetch). 본인 견적만.
  const loadData = async () => {
    const { data: qs } = await supabase
      .from('quotes')
      .select('quote_id, quote_number, quote_date, total_supply, total_profit, profit_rate, status, quote_type, customer_id, dealer_id, pdf_url, shipping_date, order_memo, order_completed_by, tax_completed_by, tax_invoice_date, fail_reason, purchase_order_at, tax_invoice_completed_at, quote_items(product_name, row_kind, price_list(model_jp))')
      .eq('engineer_id', engineerId)
      .order('created_at', { ascending: false })
    const list = (qs ?? []) as any[]
    // 고객사/대리점명: customers 별도 조회 후 병합(고객사 열람 권한이 없어 막히면 '-'/null).
    const ids = [...new Set(list.flatMap(q => [q.customer_id, q.dealer_id]).filter(Boolean))]
    const custMap: Record<number, string> = {}
    if (ids.length) {
      const { data: custs } = await supabase.from('customers').select('customer_id, company_name').in('customer_id', ids as number[])
      for (const c of custs ?? []) custMap[c.customer_id] = c.company_name
    }
    const { data: tgts } = await supabase.from('sales_targets').select('year, target_amount, order_target_amount').eq('engineer_id', engineerId).is('quarter', null)
    const tmap: Record<number, { target: number; orderTarget: number }> = {}
    for (const t of tgts ?? []) if (t.year != null) tmap[t.year] = { target: t.target_amount || 0, orderTarget: t.order_target_amount || 0 }
    setQuotes(list.map(q => ({
      ...q,
      company_name: (q.customer_id != null && custMap[q.customer_id]) || '-',
      dealer_name: (q.dealer_id != null && custMap[q.dealer_id]) || null,
    })) as Quote[])
    setTargetsByYear(tmap)
  }

  useEffect(() => {
    ;(async () => { await loadData(); setLoading(false) })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineerId])

  // 발주서 모달 열릴 때 연락처/회사주소 조회
  useEffect(() => {
    if (!poQuote?.customer_id) { setPoContacts([]); setPoCompanyAddress(null); return }
    Promise.all([
      supabase.from('contacts').select('contact_id, name, phone, position, department').is('deleted_at', null).eq('customer_id', poQuote.customer_id).order('contact_id'),
      supabase.from('customers').select('address').eq('customer_id', poQuote.customer_id).single(),
    ]).then(([{ data: contacts }, { data: cust }]) => {
      setPoContacts(contacts ?? [])
      setPoCompanyAddress(cust?.address ?? null)
      setPoAddressMode('company')
      setPoAddress('')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poQuote])

  // 선택 기간 → 날짜 범위. KPI·테이블 모두 이 범위 기준.
  // 유효 견적: 견적 유효기간(작성일+1개월)이 아직 안 지난 견적 = (오늘-1개월+1일) ~ 오늘.
  const validStart = () => { const s = new Date(now); s.setMonth(s.getMonth() - 1); s.setDate(s.getDate() + 1); return s }
  const { start: rangeStart, end: rangeEnd } = unit === 'valid'
    ? { start: ymd(validStart()), end: ymd(now) }
    : periodRange(fy, unit, sel)
  const dateFiltered = quotes.filter(q => q.quote_date >= rangeStart && q.quote_date <= rangeEnd)
  const quotedAmt = dateFiltered.reduce((s, q) => s + (q.total_supply || 0), 0)
  // 기간을 재는 날짜가 지표마다 다르다(실적 현황과 같은 규칙).
  //   견적 제출 — quote_date / 수주 — purchase_order_at / 매출 — tax_invoice_completed_at
  // 처리 시각이 비어 있는 건은 그 지표의 어느 기간에도 잡히지 않는다.
  const inRange = (ts: string | null) => !!ts && ts.slice(0, 10) >= rangeStart && ts.slice(0, 10) <= rangeEnd
  const orderedQuotes = quotes.filter(q => isOrdered(q.status) && inRange(q.purchase_order_at))
  const orderedAmt = orderedQuotes.reduce((s, q) => s + (q.total_supply || 0), 0)
  const revenueQuotes = quotes.filter(q => q.status === REVENUE_STATUS && inRange(q.tax_invoice_completed_at))
  const revenueAmt = revenueQuotes.reduce((s, q) => s + (q.total_supply || 0), 0)
  const profitAmt = revenueQuotes.reduce((s, q) => s + (q.total_profit || 0), 0)
  const profitRate = revenueAmt > 0 ? (profitAmt / revenueAmt * 100) : null

  // ── 달성률: 선택 기간에 맞춰 연간 목표를 분할(월÷12·분기÷4·반기÷2·연간×1). 유효 견적은 월에 준해 ÷12. ──
  //    수주 달성률 = 수주액 / 수주목표(order_target_amount), 매출 달성률 = 매출액 / 매출목표(target_amount).
  const divisor = unit === 'valid' ? 12 : UNIT_DIVISOR[unit]
  const targetYear = unit === 'valid' ? curFy : fy   // 유효 견적은 현재 회계연도 목표 기준
  const yearTargets = targetsByYear[targetYear]
  const salesTarget = yearTargets ? Math.round(yearTargets.target / divisor) : 0
  const orderTarget = yearTargets ? Math.round(yearTargets.orderTarget / divisor) : 0
  const achieve = salesTarget > 0 ? (revenueAmt / salesTarget * 100) : null
  const orderAchieve = orderTarget > 0 ? (orderedAmt / orderTarget * 100) : null
  const achieveColor = achieveColorOf(achieve)
  const orderAchieveColor = achieveColorOf(orderAchieve)

  // 옆 열(활동·알림)에 맞춰 카드가 늘어나면, 표 상자에 남는 높이만큼 줄을 더 싣는다.
  // 표 상자는 flex: 1 + overflowY: hidden 이라 줄이 늘어도 상자가 되레 커지지 않는다 →
  // 줄 수가 계속 늘어나는 되먹임 없이 한두 번에 멈춘다.
  // 초기 측정도 ResizeObserver 가 등록 직후 한 번 호출해준다(그래서 effect 본문에서 상태를 건드리지 않는다).
  useEffect(() => {
    if (!fitToHeight) return
    const box = listBoxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const avail = box.clientHeight - (headRef.current?.offsetHeight ?? 0)
      const next = Math.max(PAGE_SIZE, Math.min(MAX_PAGE_SIZE, Math.floor(avail / ROW_H)))
      setPageSize(prev => (prev === next ? prev : next))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [fitToHeight])

  const filtered = dateFiltered.filter(q => {
    const matchSearch = !search.trim() ||
      q.quote_number.toLowerCase().includes(search.toLowerCase()) ||
      q.company_name.toLowerCase().includes(search.toLowerCase())
    return matchSearch && (statusFilter === '전체' || q.status === statusFilter)
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageSafe = Math.min(page, totalPages)
  const paged = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize)
  // 목록(검색·상태·기간)이 바뀌면 사라진 견적의 선택은 자동으로 걷힌다. 이 파일엔 sel 상태가 이미 있어 이름을 달리한다.
  const quoteSel = useQuoteSelection(filtered.map(q => q.quote_id))
  const pagedIds = paged.map(q => q.quote_id)
  const allPagedSelected = pagedIds.length > 0 && pagedIds.every(id => quoteSel.isSelected(id))

  const openPdf = async (q: Quote) => {
    if (!q.pdf_url) return
    if (q.pdf_url.includes('synology')) { window.open(q.pdf_url, '_blank'); return }
    const path = q.pdf_url.startsWith('quote-pdfs/') ? q.pdf_url.replace('quote-pdfs/', '') : q.pdf_url.split('/quote-pdfs/')[1]
    if (!path) return
    const res = await fetch(`/api/quote-pdf?path=${encodeURIComponent(path)}`)
    const json = await res.json()
    if (json.signedUrl) {
      window.open(json.signedUrl, '_blank')
      await supabase.from('download_logs').insert({ engineer_id: engineerId, quote_id: q.quote_id, quote_number: q.quote_number, company_name: q.company_name === '-' ? null : q.company_name, action: 'view' })
    }
  }

  // ── mutation 핸들러 (공용 함수 사용 + toast + refetch) ──
  // 삭제 요청은 사유가 있어야 관리자가 판단할 수 있다. 다른 상태는 기존대로 선택 입력.
  const reasonRequired = editStatus === '취소요청'
  const reasonMissing = reasonRequired && !editFailReason.trim()

  const handleSave = async () => {
    if (!editQuote || reasonMissing) return
    setSaving(true)
    try {
      // 되돌릴 때는 실패 사유를 지운다(빈 문자열 → 공용 함수가 null 로 저장한다).
      const reason = editStatus === '견적중' ? '' : editFailReason
      await updateQuoteStatus({ quoteId: editQuote.quote_id, status: editStatus, reason })
      // 삭제 요청은 관리자에게 알린다. 알림이 실패해도 요청 자체는 이미 저장됐으므로 흐름을 막지 않는다.
      if (reasonRequired) await notifyDeleteRequest(editQuote.quote_id)
      toast.success(editStatus === '견적중' ? '견적중으로 되돌렸습니다' : `${editStatus} 처리되었습니다`)
      setEditQuote(null)
      await loadData()
    } catch (e: any) {
      toast.error(`처리 실패: ${e?.message ?? '오류'}`)
    } finally {
      setSaving(false)
    }
  }

  const handlePoUpload = async () => {
    if (!poQuote || !poFile) return
    setPoUploading(true)
    let deliveryAddress: string | undefined
    if (poDelivery === '택배발송') {
      const selectedContact = poContacts.find(c => c.contact_id === poContactId)
      const finalAddress = poAddressMode === 'company' ? (poCompanyAddress ?? '') : poAddress.trim()
      const parts: string[] = []
      if (selectedContact) {
        const label = [selectedContact.name, selectedContact.position || selectedContact.department].filter(Boolean).join(' ')
        parts.push(`받는사람: ${label}`)
        if (selectedContact.phone) parts.push(`연락처: ${selectedContact.phone}`)
      }
      if (finalAddress) parts.push(`주소: ${finalAddress}`)
      if (parts.length > 0) deliveryAddress = parts.join('\n')
    }
    const result = await uploadPurchaseOrder({
      quoteId: poQuote.quote_id, quoteNumber: poQuote.quote_number, file: poFile, deliveryMethod: poDelivery, deliveryAddress,
    })
    setPoUploading(false)
    if (!result.ok) { toast.error(`발주서 등록 실패: ${result.error}`); return }
    toast.success('발주서가 등록되었습니다')
    setPoQuote(null); setPoFile(null); setPoAddress(''); setPoAddressMode('company'); setPoCompanyAddress(null); setPoContactId(''); setPoContacts([])
    await loadData()
  }

  const handleTaxRequest = async () => {
    if (!taxQuote) return
    const ok = validate({ taxDate: taxDate ? null : '요청 발행일을 선택해주세요' })
    if (!ok) return
    setTaxSending(true)
    const result = await requestTaxInvoice({ quoteId: taxQuote.quote_id, taxDate: taxDate || undefined })
    setTaxSending(false)
    if (!result.ok) { toast.error(`세금계산서 요청 실패: ${result.error}`); return }
    toast.success('세금계산서 발행을 요청했습니다')
    setTaxQuote(null); setTaxDate('')
    await loadData()
  }

  const inp: CSSProperties = { padding: '6px 10px', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 13, outline: 'none', background: '#fff', boxSizing: 'border-box', colorScheme: 'light' }

  return (
    <div
      style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden',
        ...(fitToHeight ? { flex: 1, display: 'flex', flexDirection: 'column' } as const : null) }}>
      {/* 제목 + KPI */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 10 }}>내 견적</div>
        {loading ? (
          <div style={{ fontSize: 13, color: MUTED }}>불러오는 중...</div>
        ) : (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13 }}>
            <div><div style={{ color: GRAY, fontSize: 11 }}>견적 제출</div><div className="num" style={{ fontWeight: 700, color: TEXT }}>₩{numKR(quotedAmt)}</div></div>
            <div><div style={{ color: GRAY, fontSize: 11 }}>수주</div><div className="num" style={{ fontWeight: 700, color: orderedAmt > 0 ? TEXT : MUTED }}>₩{numKR(orderedAmt)}</div></div>
            <div><div style={{ color: GRAY, fontSize: 11 }}>매출 완료</div><div className="num" style={{ fontWeight: 700, color: BLUE }}>₩{numKR(revenueAmt)}</div></div>
            <div><div style={{ color: GRAY, fontSize: 11 }}>순이익</div><div className="num" style={{ fontWeight: 800, color: '#16a34a' }}>{profitAmt > 0 ? `₩${numKR(profitAmt)}` : '-'}{profitRate !== null && profitAmt > 0 && <span style={{ fontSize: 11, marginLeft: 4 }}>({profitRate.toFixed(1)}%)</span>}</div></div>
            {orderAchieve !== null && (
              <div>
                <div style={{ color: GRAY, fontSize: 11 }}>수주 달성률</div>
                <div className="num" style={{ fontWeight: 800, color: orderAchieveColor }}>
                  {orderAchieve.toFixed(1)}%
                  <span style={{ fontSize: 11, fontWeight: 600, color: GRAY, marginLeft: 6 }}>(목표 {numKR(orderTarget)}원)</span>
                </div>
              </div>
            )}
            {achieve !== null && (
              <div>
                <div style={{ color: GRAY, fontSize: 11 }}>매출 달성률</div>
                <div className="num" style={{ fontWeight: 800, color: achieveColor }}>
                  {achieve.toFixed(1)}%
                  <span style={{ fontSize: 11, fontWeight: 600, color: GRAY, marginLeft: 6 }}>(목표 {numKR(salesTarget)}원)</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 필터: 회계연도 + 단위 + 기간 + 검색 */}
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* 유효 견적 모드에선 회계연도 선택이 의미 없어 숨긴다(오늘 기준 롤링 범위) */}
        {unit !== 'valid' && (
          <select value={fy} onChange={e => { setFy(Number(e.target.value)); setPage(1) }} style={inp}>
            {fyOptions.map(y => <option key={y} value={y}>{y}년도</option>)}
          </select>
        )}
        <select value={unit} onChange={e => changeUnit(e.target.value as Unit)} style={inp}>
          <option value="valid">유효 견적</option>
          <option value="month">월</option>
          <option value="quarter">분기</option>
          <option value="half">반기</option>
          <option value="year">연간</option>
        </select>
        {unit === 'month' && (
          <select value={sel} onChange={e => { setSel(Number(e.target.value)); setPage(1) }} style={inp}>
            {MONTHS_FISCAL.map(m => <option key={m} value={m}>{m}월</option>)}
          </select>
        )}
        {unit === 'quarter' && (
          <select value={sel} onChange={e => { setSel(Number(e.target.value)); setPage(1) }} style={inp}>
            <option value={1}>1분기 (4~6월)</option>
            <option value={2}>2분기 (7~9월)</option>
            <option value={3}>3분기 (10~12월)</option>
            <option value={4}>4분기 (1~3월)</option>
          </select>
        )}
        {unit === 'half' && (
          <select value={sel} onChange={e => { setSel(Number(e.target.value)); setPage(1) }} style={inp}>
            <option value={1}>상반기 (4~9월)</option>
            <option value={2}>하반기 (10~3월)</option>
          </select>
        )}
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="견적번호 / 고객사 / 내용" style={{ ...inp, flex: 1, minWidth: 140 }} />
      </div>
      {/* 상태 필터 바 */}
      <div style={{ padding: '8px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {STATUS_TABS.map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
            style={{ padding: '4px 9px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', background: statusFilter === s ? (s === '전체' ? BLUE : getCategoryColor(SALES_STATUS_COLORS, s).text) : '#f3f4f6', color: statusFilter === s ? '#fff' : TEXT }}>
            {salesStatusLabel(s)}
          </button>
        ))}
        {/* 선택한 견적을 이익률 분석표 엑셀로 내보낸다(보이는 행만 선택 가능). */}
        <QuoteExcelButton
          quoteIds={quoteSel.selected}
          engineerId={engineerId}
          onDone={quoteSel.clear}
          style={{ padding: '4px 10px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', background: BLUE, color: '#fff' }}
        />
      </div>

      {/* 테이블 — fitToHeight 면 카드에서 남는 높이를 이 상자가 받고, 그 높이만큼 줄을 싣는다 */}
      <div ref={listBoxRef} style={{ overflowX: 'auto', ...(fitToHeight ? { flex: 1, minHeight: 0, overflowY: 'hidden' } as const : null) }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 32, color: MUTED, fontSize: 13 }}>불러오는 중...</div>
        ) : paged.length === 0 ? (
          <div style={{ height: ROW_H * pageSize, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 13 }}>견적이 없습니다</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead ref={headRef}>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                <th style={{ width: 36, padding: '8px 6px', textAlign: 'center', background: '#f8fafc' }}>
                  <input type="checkbox" checked={allPagedSelected} onChange={() => quoteSel.toggleAll(pagedIds)}
                    title="이 페이지 전체 선택/해제" style={{ cursor: 'pointer' }} />
                </th>
                {['견적번호', '날짜', '대리점', '고객사', '품목', '매출액', '순이익', '상태', '관리'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap', background: '#f8fafc' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map(q => {
                const hasProfit = q.total_profit != null && q.total_profit !== 0
                const profitConfirmed = ['발주(주문 대기)', '주문완료', '세금계산서 요청', '매출완료'].includes(q.status)
                const profitColor = profitConfirmed ? '#15803d' : TEXT
                const profitRateColor = profitConfirmed ? ((q.profit_rate || 0) >= 40 ? '#15803d' : ORANGE) : GRAY
                const itemNames = q.quote_items && q.quote_items.length > 0
                  // 할인은 품목이 아니라 총액 차감이라 목록에서 뺀다.
                  ? q.quote_items.filter(i => i.row_kind !== 'discount').map(i => i.price_list?.model_jp || i.product_name).filter(Boolean).join(', ')
                  : '-'
                const showOrderInfo = ['주문완료', '세금계산서 요청', '매출완료'].includes(q.status)
                return (
                  <tr key={q.quote_id} style={{ borderBottom: `1px solid ${BORDER}`, transition: 'background 0.12s ease' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                      <input type="checkbox" checked={quoteSel.isSelected(q.quote_id)} onChange={() => quoteSel.toggle(q.quote_id)} style={{ cursor: 'pointer' }} />
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: BLUE, whiteSpace: 'nowrap', textAlign: 'center' }}>
                      <span onClick={() => openPdf(q)} style={{ cursor: q.pdf_url ? 'pointer' : 'default' }}>
                        {q.quote_number}{q.pdf_url && <span style={{ marginLeft: 4, fontSize: 9, color: MUTED }}>PDF</span>}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', color: MUTED, whiteSpace: 'nowrap', fontSize: 11, textAlign: 'center' }}>{q.quote_date}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                      {q.dealer_name
                        ? <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#fff7ed', color: '#c2410c', fontWeight: 700, border: '1px solid #fed7aa' }}>{q.dealer_name}</span>
                        : <span style={{ fontSize: 11, color: MUTED }}>직판</span>}
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 600, whiteSpace: 'nowrap', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center', color: TEXT }}>{q.company_name || '-'}</td>
                    <td style={{ padding: '8px 10px', color: GRAY, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>{itemNames}</td>
                    <td className="num" style={{ padding: '8px 10px', fontWeight: 700, whiteSpace: 'nowrap', color: TEXT, textAlign: 'center' }}>₩{numKR(q.total_supply)}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                      {hasProfit ? <span className="num" style={{ fontWeight: 700, color: profitColor, fontSize: 11 }}>₩{numKR(q.total_profit!)}<span style={{ color: profitRateColor, marginLeft: 4 }}>{q.profit_rate?.toFixed(0)}%</span></span> : <span style={{ color: BORDER }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                        <span style={{ padding: '3px 7px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: getCategoryColor(SALES_STATUS_COLORS, q.status).bg, color: getCategoryColor(SALES_STATUS_COLORS, q.status).text, whiteSpace: 'nowrap', alignSelf: 'center' }}>
                          {q.status === '세금계산서 요청' ? '세금계산서 발행 요청' : salesStatusLabel(q.status)}
                        </span>
                        {showOrderInfo && (q.shipping_date || q.order_memo) && (
                          <div style={{ position: 'relative' }}
                            onMouseEnter={() => setHoveredMemoId(q.quote_id)}
                            onMouseLeave={() => setHoveredMemoId(null)}>
                            <span style={{ fontSize: 10, cursor: 'help', display: 'flex', alignItems: 'center', gap: 3 }}>
                              <span style={{ color: MUTED, fontWeight: 600 }}>출하예정</span>
                              <span style={{ color: '#0369a1', fontWeight: 700 }}>{q.shipping_date || '미정'}</span>
                              {q.order_memo && <span style={{ fontSize: 9 }}>📋</span>}
                            </span>
                            {hoveredMemoId === q.quote_id && (
                              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: '#1e293b', color: '#e2e8f0', borderRadius: 9, padding: '8px 12px', fontSize: 11, minWidth: 180, maxWidth: 260, lineHeight: 1.6, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', pointerEvents: 'none' }}>
                                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>처리 담당자</div>
                                <div style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: q.order_memo ? 8 : 0 }}>
                                  {q.tax_completed_by || q.order_completed_by || '-'}
                                </div>
                                {q.order_memo && (
                                  <>
                                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, marginBottom: 3 }}>메모</div>
                                    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{q.order_memo}</div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        {/* 국내수리(repair_domestic)는 발주 없이 수리중→세금계산서 요청으로 바로 간다 → 발주서 등록 숨김 */}
                        {q.status === '견적중' && q.quote_type !== 'repair_domestic' && (
                          <button onClick={() => { setPoQuote(q); setPoFile(null) }}
                            style={{ padding: '3px 7px', background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: '#7c3aed' }}>
                            발주서 등록
                          </button>
                        )}
                        {(q.status === '주문완료' || (q.quote_type === 'repair_domestic' && q.status === '수리중')) && (
                          <button onClick={() => { setTaxQuote(q); setTaxDate(q.tax_invoice_date || '') }}
                            style={{ padding: '3px 7px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: '#b45309' }}>
                            계산서 요청
                          </button>
                        )}
                        <button
                          onClick={() => { setEditQuote(q); setEditStatus('취소요청'); setEditFailReason(q.fail_reason || '') }}
                          style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6, cursor: 'pointer', fontSize: 13, color: MUTED, lineHeight: 1, flexShrink: 0 }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#fef2f2'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#fecdd3'; (e.currentTarget as HTMLButtonElement).style.color = '#be123c' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.borderColor = BORDER; (e.currentTarget as HTMLButtonElement).style.color = MUTED }}
                        >⋮</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {/* 다 안 차는 페이지는 빈 줄로 채워 목록 높이를 고정한다 */}
              {Array.from({ length: Math.max(0, pageSize - paged.length) }).map((_, i) => (
                <tr key={`pad-${i}`} style={{ height: ROW_H, borderBottom: `1px solid ${BORDER}` }}>
                  <td colSpan={TABLE_COLS} />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 페이지네이션 */}
      {!loading && filtered.length > pageSize && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: `1px solid ${BORDER}` }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={pageSafe <= 1}
            style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', cursor: pageSafe <= 1 ? 'default' : 'pointer', color: pageSafe <= 1 ? MUTED : TEXT, fontSize: 12, fontWeight: 700 }}>이전</button>
          <span style={{ fontSize: 12, color: GRAY, fontWeight: 700 }}>{pageSafe} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={pageSafe >= totalPages}
            style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', cursor: pageSafe >= totalPages ? 'default' : 'pointer', color: pageSafe >= totalPages ? MUTED : TEXT, fontSize: 12, fontWeight: 700 }}>다음</button>
        </div>
      )}

      {/* ── 발주서 등록 서브모달 ── */}
      {poQuote && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: SUBMODAL_Z, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 360, boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 6 }}>발주서 등록</div>
            <div style={{ fontSize: 12, color: GRAY, marginBottom: 16 }}>{poQuote.quote_number}</div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: GRAY, marginBottom: 6, fontWeight: 600 }}>배송 방법</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['직납', '택배발송'] as const).map(m => (
                  <button key={m} onClick={() => setPoDelivery(m)}
                    style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1.5px solid ${poDelivery === m ? '#7c3aed' : BORDER}`, cursor: 'pointer', fontWeight: 700, fontSize: 13, background: poDelivery === m ? '#f5f3ff' : '#f9fafb', color: poDelivery === m ? '#7c3aed' : GRAY, transition: 'all 0.12s' }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {poDelivery === '택배발송' && (
              <>
                {poContacts.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: GRAY, marginBottom: 6, fontWeight: 600 }}>받는 담당자</div>
                    <select value={poContactId} onChange={e => setPoContactId(e.target.value ? Number(e.target.value) : '')}
                      style={{ width: '100%', padding: '7px 10px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box' }}>
                      <option value=''>-- 담당자 선택 (선택사항) --</option>
                      {poContacts.map(c => {
                        const label = [c.name, c.position || c.department].filter(Boolean).join(' · ')
                        return <option key={c.contact_id} value={c.contact_id}>{label}{c.phone ? ` (${c.phone})` : ''}</option>
                      })}
                    </select>
                  </div>
                )}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: GRAY, marginBottom: 6, fontWeight: 600 }}>배송 주소</div>
                  <select value={poAddressMode} onChange={e => { setPoAddressMode(e.target.value as 'company' | 'direct'); setPoAddress('') }}
                    style={{ width: '100%', padding: '7px 10px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box', marginBottom: 6 }}>
                    {poCompanyAddress && <option value="company">🏢 회사 주소: {poCompanyAddress}</option>}
                    <option value="direct">✏️ 직접 입력</option>
                  </select>
                  {poAddressMode === 'direct' && (
                    <textarea value={poAddress} onChange={e => setPoAddress(e.target.value)} placeholder="배송받을 주소를 입력하세요" rows={2}
                      style={{ width: '100%', padding: '7px 10px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12, outline: 'none', resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box', fontFamily: 'inherit' }} />
                  )}
                  {poAddressMode === 'company' && poCompanyAddress && (
                    <div style={{ padding: '6px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#15803d', lineHeight: 1.5 }}>
                      {poCompanyAddress}
                    </div>
                  )}
                </div>
              </>
            )}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: GRAY, marginBottom: 6, fontWeight: 600 }}>발주서 PDF</div>
              <div
                onDragOver={e => { e.preventDefault(); setPoIsDragging(true) }}
                onDragLeave={() => setPoIsDragging(false)}
                onDrop={e => { e.preventDefault(); setPoIsDragging(false); const f = e.dataTransfer.files[0]; if (f && f.type === 'application/pdf') setPoFile(f) }}
                onClick={() => poFileRef.current?.click()}
                style={{ border: `2px dashed ${poIsDragging ? '#7c3aed' : poFile ? '#7c3aed' : BORDER}`, borderRadius: 10, padding: '18px 12px', textAlign: 'center', cursor: 'pointer', background: poIsDragging ? '#f5f3ff' : poFile ? '#faf5ff' : '#fafafa', transition: 'all 0.15s' }}>
                {poFile ? (
                  <>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>📄</div>
                    <div style={{ fontSize: 12, color: '#7c3aed', fontWeight: 700 }}>{poFile.name}</div>
                    <div style={{ fontSize: 10, color: MUTED, marginTop: 3 }}>클릭하여 다시 선택</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 22, marginBottom: 6 }}>📁</div>
                    <div style={{ fontSize: 12, color: GRAY, fontWeight: 600 }}>PDF를 여기에 드래그하거나</div>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>클릭하여 파일 선택</div>
                  </>
                )}
                <input ref={poFileRef} type="file" accept="application/pdf" onChange={e => setPoFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setPoQuote(null); setPoFile(null) }} disabled={poUploading}
                style={{ flex: 1, padding: 9, background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>취소</button>
              <button onClick={handlePoUpload} disabled={poUploading || !poFile}
                style={{ flex: 1, padding: 9, background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, opacity: (poUploading || !poFile) ? 0.6 : 1 }}>
                {poUploading ? '업로드 중...' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 세금계산서 요청 서브모달 ── */}
      {taxQuote && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: SUBMODAL_Z, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 340, boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 6 }}>세금계산서 발행 요청</div>
            <div style={{ fontSize: 12, color: GRAY, marginBottom: 16 }}>{taxQuote.quote_number}</div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: GRAY, marginBottom: 6, fontWeight: 600 }}>요청 발행일 <span style={{ color: '#dc2626' }}>*</span></div>
              <input type="date" value={taxDate} onChange={e => { setTaxDate(e.target.value); clearError('taxDate') }}
                style={{ width: '100%', padding: '7px 10px', border: errors.taxDate ? errBorder : `1px solid ${taxDate ? BORDER : '#fca5a5'}`, borderRadius: 8, fontSize: 13, outline: 'none', colorScheme: 'light', boxSizing: 'border-box' }} />
              <FieldError message={errors.taxDate} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setTaxQuote(null); setTaxDate('') }} disabled={taxSending}
                style={{ flex: 1, padding: 9, background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>취소</button>
              <button onClick={handleTaxRequest} disabled={taxSending || !taxDate}
                style={{ flex: 1, padding: 9, background: '#b45309', color: '#fff', border: 'none', borderRadius: 8, cursor: taxDate ? 'pointer' : 'not-allowed', fontWeight: 700, opacity: (taxSending || !taxDate) ? 0.45 : 1 }}>
                {taxSending ? '요청 중...' : '발행 요청'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 취소 / 실패 처리 서브모달 ── */}
      {editQuote && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: SUBMODAL_Z, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 360, boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 4 }}>삭제 / 실패 처리</div>
            <div style={{ fontSize: 12, color: GRAY, marginBottom: 16 }}>{editQuote.quote_number} · {editQuote.company_name || ''}</div>
            {/* 되돌리기(견적중)는 사람이 손으로 실패시킨 건에만 연다.
                자동 실주 건은 견적일이 이미 한 달을 넘겨, 되살리면 고객에게 나간 PDF 의
                유효기간과 어긋나므로 선택지 자체를 만들지 않는다. */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {(editQuote.status === '실패' && !isAutoFailed(editQuote.status, editQuote.fail_reason)
                ? EDIT_STATUSES_WITH_REVERT
                : EDIT_STATUSES).map(s => (
                <button key={s} onClick={() => setEditStatus(s)}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: `1.5px solid ${editStatus === s ? getCategoryColor(SALES_STATUS_COLORS, s).text : BORDER}`, cursor: 'pointer', fontWeight: 700, fontSize: 13, background: editStatus === s ? getCategoryColor(SALES_STATUS_COLORS, s).bg : '#f9fafb', color: editStatus === s ? getCategoryColor(SALES_STATUS_COLORS, s).text : GRAY, transition: 'all 0.12s' }}>
                  {s === '취소요청' ? '삭제' : s}
                </button>
              ))}
            </div>
            {/* 되돌릴 수 없는 건이면 왜 선택지가 없는지 알려준다 */}
            {isAutoFailed(editQuote.status, editQuote.fail_reason) && (
              <div style={{ padding: '10px 12px', background: '#f8fafc', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12, color: GRAY, lineHeight: 1.6, marginBottom: 12 }}>
                {AUTO_FAIL_NOTICE}
              </div>
            )}

            <div style={{ marginBottom: 6 }}>
              {editStatus === '견적중' ? (
                <div style={{ padding: '10px 12px', background: '#f8fafc', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12, color: GRAY, lineHeight: 1.6 }}>
                  {REVERT_NOTICE}
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: GRAY, marginBottom: 5, fontWeight: 600 }}>
                    {editStatus === '취소요청' ? '삭제 사유' : '실패 사유'}
                  </div>
                  <textarea value={editFailReason} onChange={e => setEditFailReason(e.target.value)} rows={3}
                    placeholder={editStatus === '취소요청' ? '삭제 요청 사유를 입력하세요' : '실패 사유를 입력하세요'}
                    style={{ width: '100%', padding: '8px 10px', border: reasonMissing ? errBorder : `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box' }} />
                  <FieldError message={reasonMissing ? '삭제 사유를 입력해주세요' : undefined} />
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => setEditQuote(null)} style={{ flex: 1, padding: '9px', background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>닫기</button>
              <button onClick={handleSave} disabled={saving || reasonMissing}
                style={{ flex: 1, padding: '9px', background: getCategoryColor(SALES_STATUS_COLORS, editStatus).text, color: '#fff', border: 'none', borderRadius: 8, cursor: (saving || reasonMissing) ? 'not-allowed' : 'pointer', fontWeight: 700, opacity: (saving || reasonMissing) ? 0.7 : 1 }}>
                {saving ? '처리 중...'
                  : editStatus === '취소요청' ? '삭제 요청'
                  : editStatus === '견적중' ? '견적중으로 되돌리기'
                  : `${editStatus} 확정`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
