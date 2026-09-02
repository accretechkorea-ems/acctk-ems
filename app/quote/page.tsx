'use client'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { usePageGuard } from '@/hooks/usePageGuard'
import { useOutsideClick } from '@/hooks/useOutsideClick'
import AccessGate from '@/components/common/AccessGate'
import { canViewQuote } from '@/lib/permissions'
import { BlobProvider, pdf } from '@react-pdf/renderer'
import type { CustomerResult, Engineer, ExpensePreset, ExpenseRow, PriceItem, QuoteRow } from './types'
import type { SalesOpportunity } from '@/components/customer/types'
import { isClosed } from '@/components/customer/opportunity'
import { calcExpense, calcRow, calcTotals, createDiscountRow, createDomesticRow, createExpenseRow, createManualJpyRow, createRow, createServiceRow } from './calc'
import { numKR } from './format'
import { inp } from './styles'
import { useDebounce } from './useDebounce'
import { QuotePDFDoc } from './QuotePDFDoc'
import ProfitPanel from './ProfitPanel'
import QuoteItemRow from './QuoteItemRow'
import { Z } from '@/lib/zIndex'

function QuotePageInner() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  // 수리 건에서 넘어온 경우: repair_id(숫자만 유효) + prefill 파라미터. 없거나 무효면 일반 견적서.
  const repairIdRaw = searchParams.get('repair_id')
  const repairId = repairIdRaw && /^\d+$/.test(repairIdRaw) ? Number(repairIdRaw) : null
  const { loading: guardLoading, authorized } = usePageGuard(canViewQuote)
  const toast = useToast()
  const { errors, clearError, validate } = useFieldErrors<'company' | 'eu' | 'items' | 'expenses'>()
  const [isClient, setIsClient] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  // 확정 모달의 확인 버튼 중복 클릭 방지. 저장 → PDF 가 끝날 때까지 잠근다.
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [engineer, setEngineer] = useState<Engineer | null>(null)
  const [exchangeRate, setExchangeRate] = useState<number>(0)
  const [rateUpdatedAt, setRateUpdatedAt] = useState('')
  const [rateLoading, setRateLoading] = useState(false)

  const [company, setCompany] = useState('')
  const [receiver, setReceiver] = useState('')
  const [remarks, setRemarks] = useState('* 발주 진행 시 팩스 또는 메일로 발주서 회신 요망\n   (FAX : 031-786-4090)')
  // 견적서 PDF 하단 서명란 표시 여부. 저장하지 않는 화면 상태라 견적을 다시 열면 항상 꺼진 상태로 시작한다.
  const [showSignature, setShowSignature] = useState(false)
  const [delivery, setDelivery] = useState('')
  const [isDealer, setIsDealer] = useState(false)

  const [customerId, setCustomerId] = useState<number | null>(null)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerResult[]>([])
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false)
  // ?customer= 로 넘어왔는데 후보가 여러 건일 때 띄우는 안내(사용자가 직접 골라야 저장된다)
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerResult | null>(null)
  // 영업기회 연결 (선택 사항). 견적 계산·PDF 와는 무관한 내부 정보다.
  const [opportunities, setOpportunities] = useState<SalesOpportunity[]>([])
  const [opportunityId, setOpportunityId] = useState<number | null>(null)

  const [euCustomerId, setEuCustomerId] = useState<number | null>(null)
  const [euQuery, setEuQuery] = useState('')
  const [euResults, setEuResults] = useState<CustomerResult[]>([])
  const [euSearchOpen, setEuSearchOpen] = useState(false)
  const [selectedEU, setSelectedEU] = useState<CustomerResult | null>(null)

  const [rows, setRows] = useState<QuoteRow[]>([createRow()])
  const [expensePresets, setExpensePresets] = useState<ExpensePreset[]>([])
  const [presetError, setPresetError] = useState(false)
  const [searchQuery, setSearchQuery] = useState<Record<string, string>>({})
  const [searchResults, setSearchResults] = useState<Record<string, PriceItem[]>>({})
  const [searchOpen, setSearchOpen] = useState<Record<string, boolean>>({})
  const [editingProfitRate, setEditingProfitRate] = useState<Record<string, boolean>>({})
  const [profitRateInput, setProfitRateInput] = useState<Record<string, string>>({})
  const [showPriceGuide, setShowPriceGuide] = useState(false)
  const priceGuideRef = useRef<HTMLDivElement | null>(null)

  // 사명·E.U 검색 드롭다운 — 바깥 클릭(및 ESC)으로 닫는다(품목 검색창과 동일 방식).
  // 드롭다운이 ref 안쪽에 있어 항목 클릭은 '바깥'으로 판정되지 않는다.
  const customerSearchRef = useRef<HTMLDivElement | null>(null)
  const euSearchRef = useRef<HTMLDivElement | null>(null)
  useOutsideClick(customerSearchRef, useCallback(() => setCustomerSearchOpen(false), []), customerSearchOpen)
  useOutsideClick(euSearchRef, useCallback(() => setEuSearchOpen(false), []), euSearchOpen)

  useEffect(() => {
    if (!showPriceGuide) return
    const handleClickOutside = (e: MouseEvent) => {
      if (priceGuideRef.current && !priceGuideRef.current.contains(e.target as Node)) {
        setShowPriceGuide(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showPriceGuide])

  const today = new Date()
  const yyyy = today.getFullYear()
  const mm = today.getMonth() + 1
  const dd = today.getDate()
  const dateStr = `${yyyy}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}`
  const dateDisplay = `${yyyy}년　${String(mm).padStart(2, '0')}월　${String(dd).padStart(2, '0')}일`

  const [seqIndex, setSeqIndex] = useState(0)
  const seqLetter = String.fromCharCode(65 + seqIndex)

  // ── PDF용 debounced 값 (600ms 지연) ─────────────────────────────────────────
  // 고객사를 골라야만 저장되므로 미리보기도 선택된 이름만 쓴다(타이핑 중인 값은 반영하지 않는다).
  const debouncedCompany = useDebounce(company, 600)
  const debouncedReceiver = useDebounce(receiver, 600)
  const debouncedRows = useDebounce(rows, 600)

  const finalRemarksForPDF = (() => {
    const parts: string[] = []
    if (delivery.trim()) parts.push(`* 납기 : 발주 후 ${delivery.trim()}`)
    if (isDealer && euQuery.trim()) parts.push(`* E.U  : ${euQuery.trim()}`)
    if (remarks.trim()) parts.push(remarks.trim())
    return parts.join('\n')
  })()
  const debouncedFinalRemarks = useDebounce(finalRemarksForPDF, 600)

 useEffect(() => {
    if (!engineer) return
    const f = async () => {
      const { data } = await supabase
        .from('quote_sequence').select('seq')
        .eq('date_str', dateStr).eq('engineer_id', engineer.engineer_id)
        .order('seq', { ascending: false }).limit(1).single()
      // 오늘 마지막으로 쓴 seq+1 로 시작 (없으면 0 = A)
      setSeqIndex(data ? data.seq + 1 : 0)
    }
    f()
  }, [engineer, dateStr])

  const quoteNo = `No.${(engineer?.initials || 'KJW').toUpperCase()}${dateStr}-${seqLetter}`
  const { totalSupply, totalTax, totalAmount, totalCost, totalProfit, totalProfitRate } = calcTotals(rows)
  const engineerName = engineer ? `${engineer.name} ${engineer.position || ''}`.trim() : ''
  const engineerTel = engineer?.tel?.trim() || ''   // 견적 작성자(로그인 사용자) 전화번호. 등록 시 담당자란에 병기.

  // PDF용 합계 (debounced rows 기준)
  const { totalSupply: pdfTotalSupply, totalTax: pdfTotalTax, totalAmount: pdfTotalAmount } = calcTotals(debouncedRows)

  const handleCustomerSearch = async (q: string) => {
    setCustomerQuery(q)
    if (!q.trim()) { setCustomerResults([]); return }
    const { data } = await supabase
      .from('customers').select('customer_id, company_name, address, status')
      .is('deleted_at', null)
      .ilike('company_name', `%${q}%`).limit(10)
    setCustomerResults(data || [])
    setCustomerSearchOpen(true)
  }

  // 견적이 실제로 붙는 업체(대리점 건이면 E.U)의 진행 중 기회만 후보로 삼는다.
  const loadOpportunities = async (cid: number | null) => {
    setOpportunityId(null)
    if (!cid) { setOpportunities([]); return }
    const { data, error } = await supabase
      .from('sales_opportunities')
      .select('*')
      .eq('customer_id', cid)
      .order('created_at', { ascending: false })
    if (error) { console.error('[quote] load opportunities failed', error); setOpportunities([]); return }
    setOpportunities((data as SalesOpportunity[]) ?? [])
  }

  const handleCustomerSelect = (c: CustomerResult) => {
    setSelectedCustomer(c)
    setCustomerId(c.customer_id)
    setCompany(c.company_name)
    setCustomerQuery(c.company_name)
    setCustomerSearchOpen(false)
    setCustomerResults([])
    clearError('company')
    if (!isDealer) loadOpportunities(c.customer_id)
  }

  const handleCustomerClear = () => {
    setSelectedCustomer(null)
    setCustomerId(null)
    setCustomerQuery('')
    setCompany('')
    if (!isDealer) loadOpportunities(null)
  }

  const handleEUSearch = async (q: string) => {
    setEuQuery(q)
    if (!q.trim()) { setEuResults([]); return }
    const { data } = await supabase
      .from('customers').select('customer_id, company_name, address, status')
      .is('deleted_at', null)
      .ilike('company_name', `%${q}%`).limit(10)
    setEuResults(data || [])
    setEuSearchOpen(true)
  }

  const handleEUSelect = (c: CustomerResult) => {
    setSelectedEU(c)
    setEuCustomerId(c.customer_id)
    setEuQuery(c.company_name)
    setEuSearchOpen(false)
    setEuResults([])
    loadOpportunities(c.customer_id)
  }

  const handleEUClear = () => {
    setSelectedEU(null)
    setEuCustomerId(null)
    setEuQuery('')
    loadOpportunities(null)
  }

const handleDownloadPDF = async (
    overrideCompany?: string,
    overrideReceiver?: string,
    overrideRows?: QuoteRow[],
    overrideRemarks?: string,
    overrideQuoteNo?: string,
  ) => {
    const finalCompany = overrideCompany ?? company
    const finalReceiver = overrideReceiver ?? receiver
    const finalRows = overrideRows ?? rows
    const finalRemarks = overrideRemarks ?? finalRemarksForPDF
    const finalQuoteNo = overrideQuoteNo ?? quoteNo

    const firstItem = finalRows.find(r => r.supply_price > 0)
    const itemName = firstItem
      ? (firstItem.selectedItem?.model_jp || firstItem.itemText || '').trim()
      : ''
    const companyName = finalCompany.trim()
    const fileName = [finalQuoteNo, companyName, '견적서', itemName]
      .filter(Boolean)
      .join('_')
      .replace(/[\\/:*?"<>|]/g, '') + '.pdf'

    const { totalSupply: finalTotalSupply, totalTax: finalTotalTax, totalAmount: finalTotalAmount } = calcTotals(finalRows)

    const blob = await pdf(
      <QuotePDFDoc
        company={finalCompany}
        receiver={finalReceiver}
        quoteNo={finalQuoteNo}
        dateDisplay={dateDisplay}
        rows={finalRows}
        remarks={finalRemarks}
        engineerName={engineerName}
        engineerTel={engineerTel}
        totalSupply={finalTotalSupply}
        totalTax={finalTotalTax}
        totalAmount={finalTotalAmount}
        showSignature={showSignature}
      />
    ).toBlob()

    const safeFileName = `${finalQuoteNo}.pdf`
    await supabase.storage.from('quote-pdfs').upload(safeFileName, blob, {
      contentType: 'application/pdf',
      upsert: true,
    })

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)

    await supabase.from('download_logs').insert({
      engineer_id: engineer?.engineer_id ?? null,
      quote_id: null,
      quote_number: finalQuoteNo,
      company_name: companyName,
      action: 'download',
    })
  }

  // 사명·E.U 아래 안내 문구. 셋 중 하나만 나온다.
  //   ① ?customer= 로 후보가 여럿일 때 ② 검색 결과가 없을 때 ③ 평소(상시 안내)
  const custNoResult = customerQuery.trim().length > 0 && customerResults.length === 0
  const customerGuide = prefillNotice
    ?? (custNoResult
      ? '검색 결과가 없습니다. 고객사 현황에서 업체를 먼저 등록해주세요'
      : '견적서 작성 전 고객사 현황에서 업체를 먼저 등록해주세요')
  // 링크는 "검색해도 없다" 일 때만 — 후보가 여럿인 경우엔 고르면 되므로 링크가 오히려 방해다.
  const showCustomerLink = !prefillNotice && custNoResult
  const euNoResult = euQuery.trim().length > 0 && euResults.length === 0
  const euGuide = euNoResult
    ? '검색 결과가 없습니다. 고객사 현황에서 업체를 먼저 등록해주세요'
    : '견적서 작성 전 고객사 현황에서 업체를 먼저 등록해주세요'

  // 저장 가능 여부 검증. 확정 모달을 열 때와 실제 저장 직전에 같은 규칙을 쓴다.
  // 고객사는 반드시 등록된 업체를 골라야 한다(customer_id 기준).
  // 직접 친 상호는 quotes 에 저장되는 곳이 없어 PDF 에만 남고, 실적·발주·엑셀에서는 빈칸이 된다.
  //   · 직판   : customerId 필수
  //   · 대리점 : customerId(대리점) + euCustomerId(최종 사용 업체) 둘 다 필수
  //              (저장 시 customer_id 에는 E.U 가 들어간다 — 거래 이력이 붙는 곳이 최종 사용 업체이므로)
  // 품목 금액은 배열이지만 "적어도 한 품목에 금액" 이라는 집계 규칙이라 단일 key(items) 로 처리한다.
  // 부대비용은 빈 행(항목명 미선택)은 조용히 무시하고, 항목명만 고른 채 금액이 0 인 행만 막는다.
  const runValidation = () => validate({
    company: customerId
      ? null
      : (isDealer ? '등록된 대리점을 검색해서 선택해주세요' : '등록된 고객사를 검색해서 선택해주세요'),
    eu: isDealer && !euCustomerId ? '최종 사용 업체를 검색해서 선택해주세요' : null,
    items: rows.some(r => r.supply_price > 0) ? null : '품목 금액을 입력해주세요',
    expenses: expenses.some(e => e.item_name.trim() && e.amount <= 0)
      ? '단가 · 인원 · 일수를 입력해주세요' : null,
  })

  // 저장 결과 — 검증·저장 실패({ ok: false })와 저장 성공을 호출부가 구분할 수 있게 한다.
  // 성공일 때만 PDF 생성·견적번호 증가로 넘어간다.
  type SaveResult = { ok: false } | { ok: true; linked: boolean }

  const handleSaveQuote = async (): Promise<SaveResult> => {
    if (!engineer) { toast.error('엔지니어 정보를 불러오는 중입니다'); return { ok: false } }
    const ok = runValidation()
    if (!ok) return { ok: false }

    setIsSaving(true)
    let linkedRepair = false
    try {
      await supabase.from('quote_sequence').insert({
        date_str: dateStr, engineer_id: engineer.engineer_id, seq: seqIndex,
      })

      // 수리 건에서 온 견적이면 그 수리의 special_type 으로 견적 유형(quote_type)을 결정한다.
      //   본사수리 → 'repair_hq'(기존 흐름), 그 외(국내수리) → 'repair_domestic'(단축 흐름), 수리 건 없음 → null(일반).
      // 국내수리는 견적중을 거치지 않고 '수리중' 상태로 시작한다(수리가 이미 진행 중이므로).
      let quoteType: string | null = null
      let initialStatus = '견적중'
      if (repairId != null) {
        const { data: repairRow } = await supabase
          .from('repairs').select('special_type').eq('repair_id', repairId).single()
        quoteType = repairRow?.special_type === '본사수리' ? 'repair_hq' : 'repair_domestic'
        if (quoteType === 'repair_domestic') initialStatus = '수리중'
      }

      const { data: quoteData, error: quoteError } = await supabase
        .from('quotes').insert({
          quote_number: quoteNo,
          customer_id: isDealer ? euCustomerId : customerId,
          dealer_id: isDealer ? customerId : null,
          opportunity_id: opportunityId,
          delivery_info: delivery.trim() || null,
          engineer_id: engineer.engineer_id,
          quote_date: `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
          total_supply: totalSupply,
          total_tax: totalTax,
          total_amount: totalAmount,
          total_cost: totalCost,
          total_profit: totalProfit,
          profit_rate: parseFloat(totalProfitRate.toFixed(2)),
          quote_type: quoteType,
          status: initialStatus,
          recipient: receiver,
          note: finalRemarksForPDF,
          pdf_url: `quote-pdfs/${quoteNo}.pdf`,
        }).select().single()

      if (quoteError) throw quoteError

      // 금액이 있는 행만 저장한다. 할인은 공급가가 음수라 별도로 통과시킨다
      // (금액 0 인 채로 남은 할인 행은 기록할 것이 없어 저장하지 않는다).
      const items = rows.filter(r => r.supply_price > 0 || (r.row_kind === 'discount' && r.supply_price < 0)).map(r => ({
        quote_id: quoteData.quote_id,
        price_list_id: r.selectedItem?.id ?? null,
        part_code: r.partCode.trim() || null,   // 품번 스냅샷(가격표 변경돼도 과거 견적 유지). 직접 입력한 품번도 그대로 저장, 빈 값은 null.
        row_kind: r.row_kind,
        product_name: r.itemText || r.selectedItem?.model_jp || '',
        quantity: r.quantity,
        unit_price_jpy: r.row_kind === 'manual_jpy' ? r.manual_cost_jpy : (r.selectedItem?.cost_jpy ?? null),
        unit_price_krw: r.unit_price,
        supply_amount: r.supply_price,
        tax_amount: r.tax,
        category: null,
        cost_amount: r.product_price,
        profit_amount: r.profit,
        profit_rate: r.profit_rate,
        exchange_rate: r.exchange_rate || exchangeRate,
        tariff_rate: r.tariff_rate,
      }))

      if (items.length > 0) {
        const { error: itemsError } = await supabase.from('quote_items').insert(items)
        if (itemsError) throw itemsError
      }

      // 부대비용(내부 관리용). 견적 합계·PDF 와 무관하게 quote_expenses 에만 기록한다.
      // unit_price 는 저장 시점 스냅샷이므로 프리셋 재조회 없이 화면 값을 그대로 넣는다.
      const expenseRows = expenses
        .filter(e => e.item_name.trim() && e.amount > 0)
        .map(e => ({
          quote_id: quoteData.quote_id,
          item_name: e.item_name.trim(),
          unit_price: e.unit_price,
          headcount: e.headcount,
          days: e.days,
          amount: e.amount,
        }))

      if (expenseRows.length > 0) {
        const { error: expensesError } = await supabase.from('quote_expenses').insert(expenseRows)
        if (expensesError) throw expensesError
      }
toast.success(`견적서 ${quoteNo} 확정 완료`)

      // 수리 건에서 온 경우: repairs.quote_id 자동 연결 (repairs RLS 상 teams='20' UPDATE 허용).
      // 연결 실패해도 견적서 저장 자체는 유효 → 실패만 안내하고 수동 연결 유도.
      if (repairId != null) {
        const { data: linked, error: linkError } = await supabase
          .from('repairs').update({ quote_id: quoteData.quote_id }).eq('repair_id', repairId).select('repair_id')
        if (linkError || !linked || linked.length === 0) {
          toast.error('견적서는 저장됐지만 수리 건 연결에 실패했습니다. 수리 목록에서 수동으로 연결해주세요.')
        } else {
          toast.success(`수리 건 #${repairId} 에 견적서가 연결되었습니다`)
          linkedRepair = true
        }
      }
    } catch (e) {
      console.error(e)
      toast.error('저장 중 오류가 발생했습니다')
      setIsSaving(false)
      return { ok: false }
    }
    setIsSaving(false)
    return { ok: true, linked: linkedRepair }
  }

  useEffect(() => { setIsClient(true) }, [])

  useEffect(() => {
    const f = async () => {
      const { data: u } = await supabase.auth.getUser()
      if (!u.user?.email) return
      const { data } = await supabase.from('engineers').select('*').eq('email', u.user.email).single()
      if (data) setEngineer(data)
    }
    f()
  }, [])

  // 부대비용 표준 항목·단가(expense_presets) 1회 로드.
  // 실패 시 presetError → 카드에 안내 + 추가 버튼 비활성(단가 0 스냅샷 방지).
  useEffect(() => {
    const f = async () => {
      // 관리자 화면과 같은 순서(display_order)로, 비활성 항목은 제외하고 가져온다.
      const { data, error } = await supabase.from('expense_presets')
        .select('item_name, unit_price')
        .eq('is_active', true)
        .order('display_order')
      if (error || !data) {
        setPresetError(true)
        toast.error('부대비용 단가 정보를 불러오지 못했습니다')
        return
      }
      setExpensePresets(data.map(p => ({ item_name: p.item_name, unit_price: Number(p.unit_price) || 0 })))
    }
    f()
  }, [])

  // 수리 건 → 견적서 prefill (1회). repair_id 가 유효할 때만. 없으면 일반 견적서로 동작.
  const prefillDone = useRef(false)
  useEffect(() => {
    if (prefillDone.current || repairId == null) return
    prefillDone.current = true
    const product = (searchParams.get('product') ?? '').trim()
    const serial = (searchParams.get('serial') ?? '').trim()
    const customer = (searchParams.get('customer') ?? '').trim()
    // product → 첫 품목 itemText, serial → 첫 품목 subLines
    if (product || serial) {
      setRows(prev => {
        if (prev.length === 0) return prev
        const first = { ...prev[0], itemText: product || prev[0].itemText, subLines: serial ? [serial] : prev[0].subLines }
        return [first, ...prev.slice(1)]
      })
    }
    // customer → customers ilike. 정확히 1건이면 자동선택.
    // 여러 건이면 고객사를 고르지 않으면 저장이 막히므로, 후보 목록을 바로 펼쳐 두고 안내한다.
    if (customer) {
      setCustomerQuery(customer)
      supabase.from('customers').select('customer_id, company_name, address, status')
        .is('deleted_at', null).ilike('company_name', `%${customer}%`).limit(10)
        .then(({ data }) => {
          if (!data || data.length === 0) return
          if (data.length === 1) { handleCustomerSelect(data[0]); return }
          setCustomerResults(data)
          setCustomerSearchOpen(true)
          setPrefillNotice('여러 업체가 검색되었습니다. 하나를 선택해주세요')
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repairId])

  const fetchRate = useCallback(async () => {
    setRateLoading(true)
    try {
      const { data: cached } = await supabase.from('exchange_rate').select('*').order('id', { ascending: false }).limit(1).single()
      const todayStr = new Date().toISOString().slice(0, 10)

      // 오늘 날짜 캐시가 있으면 바로 사용
      if (cached && cached.updated_at === todayStr) {
        setExchangeRate(Number(cached.rate)); setRateUpdatedAt(cached.updated_at); setRateLoading(false); return
      }

      // 외부 API 호출
      try {
        const res = await fetch('/api/exchange-rate')
        const json = await res.json()
        const jpy = json.jpy
        if (jpy && jpy.deal_bas_r) {
          const rate = parseFloat(jpy.deal_bas_r.replace(',', '')) / 100
          setExchangeRate(rate); setRateUpdatedAt(todayStr)
          await supabase.from('exchange_rate').insert([{ rate, updated_at: todayStr }])
          setRateLoading(false); return
        }
      } catch { /* API 실패 시 아래 캐시 fallback 사용 */ }

      // API 실패 시 DB에 저장된 가장 최근 환율로 fallback
      if (cached && cached.rate) {
        setExchangeRate(Number(cached.rate)); setRateUpdatedAt(cached.updated_at)
      }
    } catch (e) { console.error(e) }
    setRateLoading(false)
  }, [])

  useEffect(() => { fetchRate() }, [fetchRate])
  useEffect(() => { if (!exchangeRate) return; setRows(prev => prev.map(r => calcRow(r, exchangeRate))) }, [exchangeRate])
  // 어느 품목이든 금액이 생기면 집계 에러(items) 를 즉시 해제한다.
  useEffect(() => { if (rows.some(r => r.supply_price > 0)) clearError('items') }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  // 금액 0 인 부대비용 행이 모두 해소되면 에러를 즉시 해제한다(부대비용은 rows 안에 있다).
  useEffect(() => {
    const list = rows.find(r => r.row_kind === 'service')?.expenses ?? []
    if (!list.some(e => e.item_name.trim() && e.amount <= 0)) clearError('expenses')
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRateChange = useCallback(async (rate: number) => {
    const todayStr = new Date().toISOString().slice(0, 10)
    setExchangeRate(rate)
    setRateUpdatedAt(todayStr)
    await supabase.from('exchange_rate').insert([{ rate, updated_at: todayStr }])
  }, [])

  const handleSearch = async (rowId: string, q: string) => {
    setSearchQuery(prev => ({ ...prev, [rowId]: q }))
    // 품번은 검색창 내용을 그대로 따라간다 — 가격표에서 고르지 않고 직접 친 값도 PDF 품번 칸에 나간다.
    setRows(prev => prev.map(r => r.id !== rowId ? r : { ...r, partCode: q }))
    if (!q.trim()) { setSearchResults(prev => ({ ...prev, [rowId]: [] })); return }
    const { data } = await supabase.from('price_list').select('*').or(`item_code.ilike.%${q}%,model_jp.ilike.%${q}%`).limit(20)
    setSearchResults(prev => ({ ...prev, [rowId]: data || [] }))
    setSearchOpen(prev => ({ ...prev, [rowId]: true }))
  }

  const handleSelect = (rowId: string, item: PriceItem) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r
      // 품목 선택 시점에 품명에 모델명을 1회 넣는다(이후 itemText 는 순수 사용자 입력).
      //  - 처음 선택   : 사용자가 적어 둔 품명 뒤에 덧붙인다
      //  - 다른 품목으로 교체 : 품명을 비우고 새 모델명만 넣는다
      const model = item.model_jp ? `(${item.model_jp})` : ''
      const base = r.itemText.trimEnd()
      // 이미 다른 가격표 품목이 선택돼 있었으면 품명을 비우고 새 모델명만 넣는다.
      const itemText = r.selectedItem
        ? model
        : (model ? (base ? `${base} ${model}` : model) : r.itemText)
      return calcRow({ ...r, selectedItem: item, itemText, partCode: item.item_code }, exchangeRate)
    }))
    setSearchOpen(prev => ({ ...prev, [rowId]: false }))
    setSearchQuery(prev => ({ ...prev, [rowId]: item.item_code }))
    if (item.delivery_time && delivery === '') {
      setDelivery(item.delivery_time + '주')
    }
  }

  const updateRow = (rowId: string, field: keyof QuoteRow, value: any) =>
    setRows(prev => prev.map(r => r.id !== rowId ? r : calcRow({ ...r, [field]: value }, exchangeRate)))

  const clearItem = (rowId: string) => {
    // 품목 해제(× 버튼) — 종류는 price_list 그대로 두고 선택만 비운다.
    setRows(prev => prev.map(r => r.id !== rowId ? r : calcRow({ ...r, selectedItem: null, manual_unit_price: 0, partCode: '' }, exchangeRate)))
    setSearchQuery(prev => ({ ...prev, [rowId]: '' }))
    setSearchResults(prev => ({ ...prev, [rowId]: [] }))
  }

  const updateSubLine = (rowId: string, idx: number, val: string) =>
    setRows(prev => prev.map(r => { if (r.id !== rowId) return r; const lines = [...r.subLines]; lines[idx] = val; return { ...r, subLines: lines } }))
  const addSubLine = (rowId: string) =>
    setRows(prev => prev.map(r => r.id !== rowId ? r : { ...r, subLines: [...r.subLines, ''] }))
  const removeSubLine = (rowId: string, idx: number) =>
    setRows(prev => prev.map(r => r.id !== rowId ? r : { ...r, subLines: r.subLines.filter((_, i) => i !== idx) }))

  // 부대비용은 서비스비 행(견적당 1건)에 속한다. 별도 state 없이 rows 에서 파생시킨다.
  const serviceRow = rows.find(r => r.row_kind === 'service') ?? null
  // 할인도 서비스비와 같이 견적당 1건이다(총액에서 한 번만 뺀다).
  const discountRow = rows.find(r => r.row_kind === 'discount') ?? null
  const expenses = serviceRow?.expenses ?? []

  // 부대비용 내역 갱신 — 서비스비 행의 expenses 를 바꾼 뒤 calcRow 로 원가·이익을 재계산한다.
  // (calcExpense 로 amount 재계산 → calcRow 로 행 원가 반영, 두 단계 모두 map 안에서 처리)
  const updateServiceExpenses = (fn: (list: ExpenseRow[]) => ExpenseRow[]) =>
    setRows(prev => prev.map(r => r.row_kind !== 'service' ? r : calcRow({ ...r, expenses: fn(r.expenses) }, exchangeRate)))

  // 항목명 선택은 unit_price 도 함께 바꾸므로 patch 객체로 받는다.
  const updateExpense = (expenseId: string, patch: Partial<ExpenseRow>) =>
    updateServiceExpenses(list => list.map(e => e.id !== expenseId ? e : calcExpense({ ...e, ...patch })))

  const addExpense = () => updateServiceExpenses(list => [...list, createExpenseRow()])
  const removeExpense = (expenseId: string) => updateServiceExpenses(list => list.filter(e => e.id !== expenseId))

  const selectExpensePreset = (expenseId: string, itemName: string) => {
    const preset = expensePresets.find(p => p.item_name === itemName)
    updateExpense(expenseId, { item_name: itemName, unit_price: preset?.unit_price ?? 0 })
  }

  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0)
  // 항목명은 골랐는데 금액이 0 인 행(= 단가·인원·일수 중 0). 저장 시 에러 표시 대상.
  const invalidExpenseIds = new Set(expenses.filter(e => e.item_name.trim() && e.amount <= 0).map(e => e.id))

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <div className="quote-page" style={{ background: '#fafafa', minHeight: '100vh' }}>
      <style>{`
        .q-input:focus {
          border-color: #234ea2 !important;
          box-shadow: 0 0 0 3px rgba(35,78,162,0.10) !important;
          outline: none;
        }
        /* 숫자 입력창의 브라우저 기본 스피너(위아래 화살표) 제거.
           type="number" 는 그대로 둬서 모바일 숫자 키패드는 유지된다.
           .quote-page 하위로 한정해 다른 화면에는 영향이 없다. */
        .quote-page input[type="number"]::-webkit-outer-spin-button,
        .quote-page input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .quote-page input[type="number"] {
          -moz-appearance: textfield;
          appearance: textfield;
        }
        @keyframes modal-in {
          from { opacity: 0; transform: scale(0.97) translateY(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      {repairId != null && (
        <div style={{ maxWidth: 1320, margin: '0 auto', padding: '16px 20px 0' }}>
          <div style={{ background: '#eff4ff', border: '1px solid #c7d7f8', borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 700, color: '#234ea2' }}>
            수리 건 #{repairId} 의 견적서를 작성 중입니다
          </div>
        </div>
      )}
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: 20, display: 'flex', gap: 20 }}>

        <div style={{ width: 430, flexShrink: 0 }}>

          {/* 기본 정보 */}
          <div style={{ background: '#fff', borderRadius: 8, padding: '14px 16px', marginBottom: 14, border: '1px solid #ebebeb' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 3, height: 14, background: '#234ea2', borderRadius: 6, flexShrink: 0 }} />
              <span style={{ fontWeight: 800, fontSize: 13, color: '#111827' }}>기본 정보</span>
            </div>

            {/* 사명 + 대리점 체크박스 */}
            <div style={{ marginBottom: errors.company ? 8 + 18 : 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap', width: 56, flexShrink: 0 }}>사명</span>
                <div ref={customerSearchRef} style={{ position: 'relative', flex: 1 }}>
                  <input
                    className="q-input"
                    value={customerQuery}
                    onChange={e => { handleCustomerSearch(e.target.value); clearError('company'); setPrefillNotice(null) }}
                    onFocus={() => customerResults.length > 0 && setCustomerSearchOpen(true)}
                    placeholder="업체명 검색"
                    style={{ ...inp, width: '100%', paddingRight: selectedCustomer ? 32 : 11, border: errors.company ? errBorder : (customerSearchOpen ? '1px solid #234ea2' : '1px solid #ebebeb') }}
                  />
                  {selectedCustomer && (
                    <button onClick={handleCustomerClear}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 0, display: 'flex', alignItems: 'center' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  )}
                  <FieldError message={errors.company} style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, whiteSpace: 'nowrap' }} />
                  {customerSearchOpen && customerResults.length > 0 && (
                    <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: Z.inPage, background: '#fff', border: '1px solid #234ea2', borderRadius: 8, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(35,78,162,0.12)' }}>
                      {customerResults.map(c => (
                        <div key={c.customer_id} onClick={() => handleCustomerSelect(c)}
                          style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid #ebebeb', fontSize: 12, transition: 'background 0.15s ease' }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                          onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                          <div style={{ fontWeight: 700, color: '#234ea2' }}>{c.company_name}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{c.address ?? ''}{c.status ? ` · ${c.status}` : ''}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  <input
                    type="checkbox"
                    checked={isDealer}
                    onChange={e => {
                      setIsDealer(e.target.checked)
                      if (!e.target.checked) { handleEUClear() }
                      // 견적이 붙는 업체가 바뀌므로 영업기회 후보도 다시 잡는다
                      loadOpportunities(e.target.checked ? euCustomerId : customerId)
                    }}
                    style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#234ea2' }}
                  />
                  <span style={{ fontSize: 11, fontWeight: 700, color: isDealer ? '#234ea2' : '#6b7280' }}>대리점</span>
                </label>
              </div>
              {selectedCustomer && (
                <div style={{ marginTop: 4, marginLeft: 64, padding: '3px 8px', background: isDealer ? '#fff7ed' : '#eff4ff', borderRadius: 6, fontSize: 11, color: isDealer ? '#c2410c' : '#234ea2', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                  {selectedCustomer.company_name} {isDealer ? '(대리점)' : '연결됨'}
                </div>
              )}
              {!selectedCustomer && (
                <div style={{ marginTop: 4, marginLeft: 64, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ padding: '3px 8px', background: '#f3f4f6', borderRadius: 6, fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>미선택</span>
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>{customerGuide}</span>
                  {showCustomerLink && (
                    <a href="/" target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: '#234ea2', fontWeight: 600, textDecoration: 'none' }}>
                      고객사 현황 열기 →
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* E.U 필드 (대리점 체크 시 표시) */}
            {isDealer && (
              <div style={{ marginBottom: 8, animation: 'modal-in 0.15s ease' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap', width: 56, flexShrink: 0 }}>E.U</span>
                  <div ref={euSearchRef} style={{ position: 'relative', flex: 1 }}>
                    <input
                      className="q-input"
                      value={euQuery}
                      onChange={e => { handleEUSearch(e.target.value); clearError('eu') }}
                      onFocus={() => euResults.length > 0 && setEuSearchOpen(true)}
                      placeholder="최종 사용 업체 검색"
                      style={{ ...inp, width: '100%', paddingRight: selectedEU ? 32 : 11, border: euSearchOpen ? '1px solid #c2410c' : '1px solid #fed7aa' }}
                    />
                    {selectedEU && (
                      <button onClick={handleEUClear}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 0, display: 'flex', alignItems: 'center' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                    {euSearchOpen && euResults.length > 0 && (
                      <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: Z.inPage, background: '#fff', border: '1px solid #c2410c', borderRadius: 8, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(194,65,12,0.12)' }}>
                        {euResults.map(c => (
                          <div key={c.customer_id} onClick={() => handleEUSelect(c)}
                            style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid #ebebeb', fontSize: 12, transition: 'background 0.15s ease' }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#fff7ed')}
                            onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                            <div style={{ fontWeight: 700, color: '#c2410c' }}>{c.company_name}</div>
                            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{c.address ?? ''}{c.status ? ` · ${c.status}` : ''}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {selectedEU && (
                  <div style={{ marginTop: 4, marginLeft: 64, padding: '3px 8px', background: '#fff7ed', borderRadius: 6, fontSize: 11, color: '#c2410c', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    {selectedEU.company_name} 연결됨 (거래이력 연동)
                  </div>
                )}
                {!selectedEU && (
                  <div style={{ marginTop: 4, marginLeft: 64, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ padding: '3px 8px', background: '#f3f4f6', borderRadius: 6, fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>미선택</span>
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>{euGuide}</span>
                    {euNoResult && (
                      <a href="/" target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, color: '#234ea2', fontWeight: 600, textDecoration: 'none' }}>
                        고객사 현황 열기 →
                      </a>
                    )}
                  </div>
                )}
                <FieldError message={errors.eu} style={{ marginLeft: 64 }} />
              </div>
            )}

            {/* 영업기회 연결 — 선택 사항. 내부 정보이며 PDF 에는 나가지 않는다.
                업체가 정해져야 후보를 고를 수 있다(대리점 건이면 E.U 기준). */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap', width: 56, flexShrink: 0 }}>영업기회</span>
              <select
                className="q-input"
                value={opportunityId ?? ''}
                disabled={opportunities.length === 0}
                onChange={e => setOpportunityId(e.target.value ? Number(e.target.value) : null)}
                style={{ ...inp, flex: 1, background: opportunities.length === 0 ? '#f9fafb' : '#fff' }}
              >
                <option value="">
                  {(isDealer ? euCustomerId : customerId)
                    ? (opportunities.length === 0 ? '진행 중인 기회 없음' : '연결 안 함')
                    : '업체를 먼저 선택하세요'}
                </option>
                {opportunities
                  .filter(o => !isClosed(o) || o.opportunity_id === opportunityId)
                  .map(o => (
                    <option key={o.opportunity_id} value={o.opportunity_id}>{`${o.stage} · ${o.title}`}</option>
                  ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap', width: 56, flexShrink: 0 }}>수신인</span>
              <input className="q-input" value={receiver} onChange={e => setReceiver(e.target.value)} placeholder="예: 홍길동 부장님" style={{ ...inp, flex: 1 }} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap', width: 56, flexShrink: 0 }}>납기</span>
              <input
                className="q-input"
                value={delivery}
                onChange={e => setDelivery(e.target.value)}
                placeholder="품목 선택 후 납기 정보가 없을 시 입력"
                style={{ ...inp, flex: 1 }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4, display: 'block' }}>비고</label>
              <textarea className="q-input" value={remarks} onChange={e => setRemarks(e.target.value)} rows={3}
                style={{ ...inp, width: '100%', resize: 'vertical', lineHeight: 1.7 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={showSignature}
                  onChange={e => setShowSignature(e.target.checked)}
                  style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#234ea2' }}
                />
                <span style={{ fontSize: 11, fontWeight: 700, color: showSignature ? '#234ea2' : '#6b7280' }}>고객사 서명란 추가</span>
              </label>
            </div>
          </div>

       <div style={{ position: 'relative', overflow: 'hidden' }}>
            {[-1, 0, 1, 2].map(i => (
              <div key={i} style={{ position: 'absolute', top: `${i * 140 + 60}px`, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: Z.decor, transform: 'rotate(-20deg)', opacity: 0.05 }}>
                <span style={{ fontSize: 42, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>{engineerName}</span>
              </div>
            ))}
            <ProfitPanel rows={rows} exchangeRate={exchangeRate} rateUpdatedAt={rateUpdatedAt} rateLoading={rateLoading} onFetchRate={fetchRate} onRateChange={handleRateChange} />
          </div>

          {/* 품목 */}
          <div onClick={() => showPriceGuide && setShowPriceGuide(false)} style={{ background: '#fff', borderRadius: 8, padding: '20px 20px', border: '1px solid #ebebeb', position: 'relative' }}>
            {/* 워터마크 — 자체 overflow:hidden 컨테이너로 분리하여 팝업이 잘리지 않도록 */}
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: Z.decor, borderRadius: 8 }}>
              {Array.from({ length: 20 }, (_, i) => i).map(i => (
                <div key={i} style={{ position: 'absolute', top: `${i * 140}px`, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'rotate(-20deg)', opacity: 0.05 }}>
                  <span style={{ fontSize: 42, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>{engineerName}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 3, height: 16, background: '#234ea2', borderRadius: 6, flexShrink: 0 }} />
              <span style={{ fontWeight: 800, fontSize: 14, color: '#111827' }}>품목</span>
              {rows.length > 0 && (
                <span style={{ fontSize: 12, color: '#9ca3af' }}>총 {rows.length}개</span>
              )}
              {/* 마진/정도검사 가이드 버튼 — 오른쪽 끝 */}
              <div ref={priceGuideRef} style={{ marginLeft: 'auto', position: 'relative' }}>
                <button
                  onClick={() => setShowPriceGuide(p => !p)}
                  title="마진 및 정도검사 가격 안내"
                  style={{ width: 20, height: 20, borderRadius: '50%', background: showPriceGuide ? '#234ea2' : '#e8edf5', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 900, color: showPriceGuide ? '#fff' : '#234ea2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: 1 }}
                >!</button>
                {/* 팝업 — 버튼 오른쪽, 세로 중앙 정렬 */}
                {showPriceGuide && (
                  <div
                    style={{ position: 'absolute', left: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)', zIndex: Z.inPage, background: '#fff', borderRadius: 8, border: '1px solid #ebebeb', boxShadow: '0 12px 36px rgba(0,0,0,0.16)', width: 340, padding: '16px 18px', maxHeight: '70vh', overflowY: 'auto' }}
                  >
                  {/* 닫기 */}
                  <button onClick={() => setShowPriceGuide(false)} style={{ position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#f3f4f6', cursor: 'pointer', fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>

                  {/* 섹션1: 견적서 마진 */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#1e3a6e', borderRadius: 6, padding: '4px 10px', marginBottom: 8, display: 'inline-block' }}>견적서 제출 마진</div>
                    {[
                      { label: '대리점 및 기존 고객사 (스타일러스)', value: '40%' },
                      { label: '신규고객사 (스타일러스)', value: '50%' },
                      { label: '장비 업그레이드 / 일본가격문의', value: '60%' },
                    ].map((item, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 6px', borderRadius: 6, background: i % 2 === 0 ? '#f3f4f6' : '#fff', marginBottom: 2 }}>
                        <span style={{ fontSize: 11, color: '#111827' }}>{item.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#234ea2', flexShrink: 0, marginLeft: 8 }}>{item.value}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ height: 1, background: '#ebebeb', marginBottom: 14 }} />

                  {/* 섹션2: 정도검사 */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#1e3a6e', borderRadius: 6, padding: '4px 10px', marginBottom: 8, display: 'inline-block' }}>측정기 정도 검사</div>
                    {[
                      { cat: '83', items: [{ label: '조도', price: '600,000' }, { label: '형상', price: '800,000' }, { label: '조도형상', price: '1,000,000' }] },
                      { cat: '84', items: [{ label: '소형 43C', price: '800,000' }, { label: '중형 R-NEX200', price: '1,000,000' }, { label: 'R55/R60', price: '1,200,000' }, { label: 'R73A', price: '4,000,000' }] },
                      { cat: '81', items: [{ label: 'CMM', price: '3,500,000' }] },
                    ].map((group, gi) => (
                      <div key={gi} style={{ display: 'flex', marginBottom: gi < 2 ? 6 : 0 }}>
                        <div style={{ width: 28, flexShrink: 0, display: 'flex', alignItems: 'flex-start', paddingTop: 5 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#234ea2', borderRadius: 6, padding: '1px 5px' }}>{group.cat}</span>
                        </div>
                        <div style={{ flex: 1 }}>
                          {group.items.map((item, ii) => (
                            <div key={ii} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', borderRadius: 6, background: ii % 2 === 0 ? '#f3f4f6' : '#fff', marginBottom: 2 }}>
                              <span style={{ fontSize: 11, color: '#111827' }}>{item.label}</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#111827' }}>₩{item.price}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                )}
              </div>
            </div>

            {rows.map((row, rowIdx) => (
              <QuoteItemRow
                key={row.id}
                row={row}
                rowIdx={rowIdx}
                rows={rows}
                setRows={setRows}
                updateRow={updateRow}
                addSubLine={addSubLine}
                updateSubLine={updateSubLine}
                removeSubLine={removeSubLine}
                handleSearch={handleSearch}
                handleSelect={handleSelect}
                clearItem={clearItem}
                searchQuery={searchQuery}
                searchResults={searchResults}
                searchOpen={searchOpen}
                setSearchOpen={setSearchOpen}
                editingProfitRate={editingProfitRate}
                setEditingProfitRate={setEditingProfitRate}
                profitRateInput={profitRateInput}
                setProfitRateInput={setProfitRateInput}
                expensePresets={expensePresets}
                presetError={presetError}
                errors={errors}
                invalidExpenseIds={invalidExpenseIds}
                totalExpense={totalExpense}
                addExpense={addExpense}
                removeExpense={removeExpense}
                updateExpense={updateExpense}
                selectExpensePreset={selectExpensePreset}
              />
            ))}

            {/* 행 추가 버튼 — 1행: 주버튼(품목) + 수동입력 / 2행: 국내조달품 + 서비스비 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <button
                onClick={() => setRows(prev => [...prev, createRow()])}
                style={{ minWidth: 0, padding: '11px', background: '#234ea2', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'background 0.15s ease' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1c3e87')}
                onMouseLeave={e => (e.currentTarget.style.background = '#234ea2')}
              >
                + 품목 추가
              </button>
              {/* 수동입력 품목 — 가격표에 없는 제품. 개수 제한 없음. */}
              <button
                onClick={() => setRows(prev => [...prev, createManualJpyRow()])}
                title="가격표에 없는 품목을 구입가(JPY) 직접 입력으로 추가합니다"
                style={{ minWidth: 0, padding: '11px', background: '#fff', color: '#234ea2', border: '1px solid #ebebeb', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'background 0.15s ease' }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#fff')}
              >
                + 수동입력
              </button>
              {/* 국내조달품 — 원화 원가만. 고객 견적서에는 금액 없이 포함사항으로 나간다. */}
              <button
                onClick={() => setRows(prev => [...prev, createDomesticRow()])}
                title="국내에서 조달하는 항목(원화 원가만, 마진 없음)"
                style={{ minWidth: 0, padding: '11px', background: '#fff', color: '#234ea2', border: '1px solid #ebebeb', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'background 0.15s ease' }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#fff')}
              >
                + 국내조달품
              </button>
              {/* 서비스비는 견적당 1건. 이미 있으면 비활성. */}
              <button
                onClick={() => setRows(prev => [...prev, createServiceRow()])}
                disabled={serviceRow !== null}
                title={serviceRow !== null ? '서비스비는 견적당 1건만 추가할 수 있습니다' : undefined}
                style={{ minWidth: 0, padding: '11px', background: '#fff', color: serviceRow !== null ? '#9ca3af' : '#234ea2', border: '1px solid #ebebeb', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: serviceRow !== null ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'background 0.15s ease' }}
                onMouseEnter={e => { if (serviceRow === null) (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}
                onMouseLeave={e => { if (serviceRow === null) (e.currentTarget as HTMLButtonElement).style.background = '#fff' }}
              >
                + 서비스비
              </button>
              {/* 할인 — 총액에서 한 번만 빼므로 견적당 1건. 이미 있으면 비활성. */}
              <button
                onClick={() => setRows(prev => [...prev, createDiscountRow()])}
                disabled={discountRow !== null}
                title={discountRow !== null ? '할인은 견적당 1건만 추가할 수 있습니다' : '총액에서 빼는 할인 행을 추가합니다'}
                style={{ gridColumn: '1 / -1', minWidth: 0, padding: '11px', background: '#fff', color: discountRow !== null ? '#9ca3af' : '#234ea2', border: '1px solid #ebebeb', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: discountRow !== null ? 'not-allowed' : 'pointer', transition: 'background 0.15s ease' }}
                onMouseEnter={e => { if (discountRow === null) (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}
                onMouseLeave={e => { if (discountRow === null) (e.currentTarget as HTMLButtonElement).style.background = '#fff' }}
              >
                + DISCOUNT
              </button>
            </div>
            <FieldError message={errors.items} style={{ marginTop: 8 }} />
          </div>
        </div>

        {/* PDF 미리보기 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ background: '#f3f4f6', borderRadius: 8, overflow: 'hidden', border: '1px solid #ebebeb', height: 'calc(100vh - 40px)', position: 'sticky', top: 20, display: 'flex', flexDirection: 'column' }}>

            {/* 헤더 */}
            <div style={{ background: '#234ea2', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 500, marginBottom: 2 }}>견적 번호</div>
                <div style={{ fontSize: 14, color: '#ffffff', fontWeight: 600 }}>{quoteNo}</div>
              </div>
              <button
                onClick={() => { if (!runValidation()) return; setShowConfirmModal(true) }}
                disabled={isSaving}
                style={{
                  padding: '6px 14px', boxSizing: 'border-box',
                  background: isSaving ? 'transparent' : '#ffffff',
                  color: isSaving ? '#ffffff' : '#234ea2',
                  border: isSaving ? '1px solid #ffffff' : 'none',
                  borderRadius: 6, fontWeight: 600, fontSize: 13,
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={e => { if (!isSaving) (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}
                onMouseLeave={e => { if (!isSaving) (e.currentTarget as HTMLButtonElement).style.background = '#ffffff' }}>
                {isSaving ? '저장 중...' : '견적 확정'}
              </button>
            </div>

            {/* PDF — debounced 값 사용으로 깜빡임 방지 */}
            {isClient && (
              <div style={{ flex: 1, minWidth: 0, padding: 0, overflow: 'hidden' }}>
                <BlobProvider document={
                  <QuotePDFDoc
                    company={debouncedCompany}
                    receiver={debouncedReceiver}
                    quoteNo={quoteNo}
                    dateDisplay={dateDisplay}
                    rows={debouncedRows}
                    remarks={debouncedFinalRemarks}
                    engineerName={engineerName}
                    engineerTel={engineerTel}
                    totalSupply={pdfTotalSupply}
                    totalTax={pdfTotalTax}
                    totalAmount={pdfTotalAmount}
                    showWatermark={true}
                    showSignature={showSignature}
                  />
                }>
                  {({ url }) => url ? (
                    <iframe
                      title="견적서 미리보기"
                      src={`${url}#view=FitH&toolbar=0&navpanes=0&scrollbar=0`}
                      style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                    />
                  ) : null}
                </BlobProvider>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 견적 확정 확인 모달 */}
      {showConfirmModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 32, width: '100%', maxWidth: 440, boxShadow: '0 24px 64px rgba(0,0,0,0.22)', animation: 'modal-in 0.18s ease' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', marginBottom: 4, letterSpacing: '-0.3px' }}>견적 확정</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, fontWeight: 500 }}>{quoteNo}</div>
            <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '12px 14px', marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.8 }}>
                견적 확정 시 실적으로 기록되며, <b>관리자의 승인 없이는 삭제가 불가능합니다.</b>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 24 }}>
              <div style={{ background: '#eff4ff', borderRadius: 8, padding: '12px 14px', border: '1px solid #c7d7f8', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>공급가</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#234ea2' }}>₩{numKR(totalSupply)}</div>
              </div>
              <div style={{ background: '#f3f4f6', borderRadius: 8, padding: '12px 14px', border: '1px solid #ebebeb', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>원가</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>₩{numKR(totalCost)}</div>
              </div>
              <div style={{ background: totalProfitRate >= 40 ? '#f0fdf4' : '#fef2f2', borderRadius: 8, padding: '12px 14px', border: `1px solid ${totalProfitRate >= 40 ? '#bbf7d0' : '#fecaca'}`, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>순이익</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: totalProfitRate >= 40 ? '#16a34a' : '#dc2626' }}>
                  ₩{numKR(totalProfit)}<br />
                  <span style={{ fontSize: 11 }}>({totalProfitRate.toFixed(1)}%)</span>
                </div>
              </div>
            </div>
            {/* 저장이 막혔을 때 창을 닫지 않고 이유를 여기 모아 보여준다(칸 옆 빨간 글씨는 그대로 있다) */}
            {(() => {
              const messages = [errors.company, errors.eu, errors.items, errors.expenses].filter(Boolean)
              if (messages.length === 0) return null
              return (
                <div style={{ marginBottom: 10, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6 }}>
                  {messages.map((m, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#dc2626', lineHeight: 1.6 }}>{m}</div>
                  ))}
                </div>
              )
            })()}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowConfirmModal(false)}
                disabled={isSubmitting}
                style={{ flex: 1, padding: '12px', background: '#f3f4f6', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 14, cursor: isSubmitting ? 'not-allowed' : 'pointer', color: '#111827', opacity: isSubmitting ? 0.6 : 1 }}>
                취소
              </button>
              <button onClick={async () => {
                if (isSubmitting) return
                setIsSubmitting(true)
                try {
                  const snapshotCompany = company
                  const snapshotReceiver = receiver
                  const snapshotRows = [...rows]
                  const snapshotRemarks = finalRemarksForPDF
                  const snapshotQuoteNo = quoteNo
                  const result = await handleSaveQuote()
                  // 저장이 막히면 여기서 끝낸다 — PDF 도 만들지 않고 견적번호도 올리지 않는다.
                  if (!result.ok) return

                  await handleDownloadPDF(snapshotCompany, snapshotReceiver, snapshotRows, snapshotRemarks, snapshotQuoteNo)
                  setSeqIndex(prev => prev + 1)
                  setShowConfirmModal(false)
                  // 수리 건 연결이 됐으면 PDF 생성 후 수리 목록으로 이동
                  if (result.linked) router.push('/repair')
                } finally {
                  setIsSubmitting(false)
                }
              }}
                disabled={isSubmitting}
                style={{ flex: 1, padding: '12px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 14, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 }}>
                {isSubmitting ? '저장 중...' : '확인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// useSearchParams 는 Suspense 경계가 필요하므로 감싼다(인벤토리 페이지와 동일 패턴).
export default function QuotePage() {
  return (
    <Suspense fallback={null}>
      <QuotePageInner />
    </Suspense>
  )
}
