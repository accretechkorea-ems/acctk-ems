'use client'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { usePageGuard } from '@/hooks/usePageGuard'
import { useQuoteCustomer } from '@/hooks/quote/useQuoteCustomer'
import { useQuoteRows } from '@/hooks/quote/useQuoteRows'
import { useQuotePrefill } from '@/hooks/quote/useQuotePrefill'
import { useQuoteDraftSync } from '@/hooks/quote/useQuoteDraftSync'
import { useQuoteSubmit, NO_INITIALS_MESSAGE } from '@/hooks/quote/useQuoteSubmit'
import AccessGate from '@/components/common/AccessGate'
import { BlobProvider } from '@react-pdf/renderer'
import type { Engineer, QuoteRow } from './types'
import { isClosed } from '@/components/customer/opportunity'
import { calcRow, calcTotals, createDiscountRow, createDomesticRow, createManualJpyRow, createRow, createServiceRow } from './calc'
import { numKR } from './format'
import { useDebounce } from './useDebounce'
import { QuotePDFDoc } from './QuotePDFDoc'
import ProfitPanel from './ProfitPanel'
import QuoteItemRow from './QuoteItemRow'
import { Z } from '@/lib/zIndex'
import {
  DEFAULT_TERMS, TERM_KEYS, TERM_LABELS, TERM_MAX_LEN,
  normalizeTerms, type TermKey, type Terms,
} from '@/lib/quoteTerms'
import { normalizeSubLines } from '@/lib/quoteSubLines'

/**
 * 비고 기본 문구. 내용은 그대로 두고, 사용자가 손댔는지 비교하려고 상수로 뺐다.
 */

const DEFAULT_REMARKS = '* 발주 진행 시 팩스 또는 메일로 발주서 회신 요망\n   (FAX : 031-786-4090)'

/** 조건 네 줄의 입력칸 설명 — 라벨은 등록표(lib/quoteTerms.ts)에서 읽는다. */
const TERM_PLACEHOLDERS: Record<TermKey, string> = {
  delivery_schedule: DEFAULT_TERMS.delivery_schedule,
  payment_terms: DEFAULT_TERMS.payment_terms,
  delivery_terms: DEFAULT_TERMS.delivery_terms,
  validity: DEFAULT_TERMS.validity,
}

/**
 * 견적번호 끝의 순번 글자. seq 는 1부터다(next_quote_seq 가 그날 첫 호출에 1 을 준다).
 *   1 → A … 26 → Z, 27 → AA, 28 → AB … 52 → AZ, 53 → BA (엑셀 열 이름과 같은 방식)
 * 예전에는 0 부터 세어 'A'+seq 로 만들어, 27번째부터 'Z' 다음 문자('[')가 나왔다.
 */
function seqToLetters(seq: number): string {
  let n = seq
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}


import { euDisplayName } from '@/lib/quoteEuName'
import { clearDraft, draftSavedLabel } from '@/lib/quoteDraft'
import type { OnBehalfAssignee } from '@/lib/quoteMutations'
import { todayKST } from '@/lib/date'
import { nowKSTParts } from '@/lib/date'

function QuotePageInner() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  // 확정 후 초기화에서 주소창 파라미터를 지우는데, useSearchParams 가 그것을 언제 반영하는지에
  // 기대지 않는다 — 이 깃발이 서면 파라미터를 읽지 않은 것으로 친다. repair_id 가 남으면 다음 견적이
  // 또 수리 건으로 저장되고 repairs.quote_id 가 덮어써지므로, 화면 표시만의 문제가 아니다.
  const [paramsCleared, setParamsCleared] = useState(false)
  // 수리 건에서 넘어온 경우: repair_id(숫자만 유효) + prefill 파라미터. 없거나 무효면 일반 견적서.
  const repairIdRaw = paramsCleared ? null : searchParams.get('repair_id')
  const repairId = repairIdRaw && /^\d+$/.test(repairIdRaw) ? Number(repairIdRaw) : null
  // 견적 대필: ?on_behalf=<engineer_id> 로 넘어온 경우. 이 파라미터는 주소창으로 아무나 만들 수 있어
  // 값 자체를 믿지 않는다 — 서버(/api/quote-on-behalf)가 "작성자가 영업관리인가" 를 판정하고,
  // 통과했을 때 돌려주는 담당자 정보만 대필 모드의 근거로 쓴다.
  const onBehalfRaw = paramsCleared ? null : searchParams.get('on_behalf')
  const onBehalfId = onBehalfRaw && /^\d+$/.test(onBehalfRaw) ? Number(onBehalfRaw) : null
  // 다시쓰기: ?duplicate=<quote_id>. on_behalf 와 같은 이유로 값 자체는 믿지 않는다 —
  // 서버(/api/quote-duplicate)가 본인 견적인지 확인한 뒤 돌려주는 내용만 화면에 채운다.
  const duplicateRaw = paramsCleared ? null : searchParams.get('duplicate')
  const duplicateId = duplicateRaw && /^\d+$/.test(duplicateRaw) ? Number(duplicateRaw) : null
  // 주소로 들어온 프리필이 있으면 그쪽이 우선이다 — 임시저장분은 묻지 않고 버린다.
  const hasUrlPrefill = repairId != null || onBehalfId != null || duplicateId != null
  const { loading: guardLoading, authorized } = usePageGuard()
  const toast = useToast()
  const { errors, setErrors, clearError, validate } = useFieldErrors<'company' | 'eu' | 'items' | 'expenses'>()
  const [isClient, setIsClient] = useState(false)

  const [engineer, setEngineer] = useState<Engineer | null>(null)
  // 대필 대상. 서버가 승인한 뒤에만 채워진다(null 이면 평소대로 본인 견적).
  const [onBehalf, setOnBehalf] = useState<OnBehalfAssignee | null>(null)
  const [exchangeRate, setExchangeRate] = useState<number>(0)
  // 임시저장·다시쓰기 복원은 비동기라, 값을 넣는 시점의 최신 환율을 참조로 읽는다.
  // (환율이 아직 0 이면 아래 [exchangeRate] 효과가 도착 후 전 행을 다시 계산한다.)
  const rateRef = useRef(0)
  const [rateUpdatedAt, setRateUpdatedAt] = useState('')
  const [rateLoading, setRateLoading] = useState(false)

  const [receiver, setReceiver] = useState('')
  const [remarks, setRemarks] = useState(DEFAULT_REMARKS)
  // 비고는 기본 문구가 채워져 있고 고칠 일이 드물어 접어서 시작한다(내용은 계속 마운트돼 있다).
  const [remarksOpen, setRemarksOpen] = useState(false)
  // 견적서 PDF 하단 서명란 표시 여부. 저장하지 않는 화면 상태라 견적을 다시 열면 항상 꺼진 상태로 시작한다.
  const [showSignature, setShowSignature] = useState(false)
  // ── 조건 네 줄 ──
  // termsOpen 이 꺼져 있으면 **기본값으로 그린다**(아래 pdfTerms). 체크를 풀면 적어 둔 값도 버린다
  // — 「닫아 두었는데 저장은 바뀐 값으로 됐다」가 되지 않게 한다.
  const [termsOpen, setTermsOpen] = useState(false)
  const [terms, setTerms] = useState<Terms>({ ...DEFAULT_TERMS })
  const [delivery, setDelivery] = useState('')

  // 품목 행 — 가격표 검색·선택, 행 수정, 설명 줄, 부대비용 헬퍼. 상태·함수를 그대로 옮긴 훅이다.
  // 이 훅은 effect 를 두지 않는다 — rows 와 얽힌 effect 셋은 순서 때문에 아래에 그대로 남겼다.
  const {
    rows, setRows,
    expensePresets, setExpensePresets,
    presetError, setPresetError,
    searchQuery, setSearchQuery,
    searchResults, setSearchResults,
    searchOpen, setSearchOpen,
    editingProfitRate, setEditingProfitRate,
    profitRateInput, setProfitRateInput,
    handleSearch, handleSelect, updateRow, clearItem,
    updateSubLine, addSubLine, removeSubLine,
    serviceRow, discountRow, expenses,
    updateExpense, addExpense, removeExpense, selectExpensePreset,
    totalExpense, invalidExpenseIds,
  } = useQuoteRows({ supabase, exchangeRate, delivery, setDelivery })
  const [showPriceGuide, setShowPriceGuide] = useState(false)
  const priceGuideRef = useRef<HTMLDivElement | null>(null)

  // 고객사·대리점·E.U·영업기회 — 검색·선택·해제. 상태·함수를 그대로 옮긴 훅이다.
  // **이 자리에서 부른다** — 훅 안의 useOutsideClick·useListKeyboard 네 개가 원본에서 첫 effect 들이었다.
  const {
    company, setCompany,
    isDealer, setIsDealer,
    customerId, setCustomerId,
    customerQuery, setCustomerQuery,
    customerResults, setCustomerResults,
    customerSearchOpen, setCustomerSearchOpen,
    prefillNotice, setPrefillNotice,
    selectedCustomer, setSelectedCustomer,
    opportunities, setOpportunities, opportunityId, setOpportunityId,
    euCustomerId, setEuCustomerId,
    euQuery, setEuQuery,
    euResults, setEuResults,
    euSearchOpen, setEuSearchOpen,
    selectedEU, setSelectedEU,
    euParentName,
    customerSearchRef, euSearchRef, customerListRef, euListRef,
    customerKeys, euKeys,
    handleCustomerSearch, loadOpportunities,
    handleCustomerSelect, handleCustomerClear,
    handleEUSearch, resolveEuParent, handleEUSelect, handleEUClear,
  } = useQuoteCustomer({ supabase, clearError })

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

  // 견적번호와 작성일은 한국 날짜로 쓴다 — 해외에서 열어도 번호·표시가 어긋나지 않게.
  const { y: yyyy, m: mm, d: dd } = nowKSTParts()
  const dateStr = `${yyyy}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}`
  const dateDisplay = `${yyyy}년　${String(mm).padStart(2, '0')}월　${String(dd).padStart(2, '0')}일`

  // 미리보기용 예상 순번(1부터). 실제 번호는 확정할 때 create_quote 함수가 정한다 —
  // 두 사람이 거의 동시에 확정하면 여기 보이는 번호와 실제 번호가 다를 수 있다.
  const [previewSeq, setPreviewSeq] = useState(1)
  // 예상 순번 조회가 실패했을 때만 채워진다. 미리보기만 못 할 뿐 번호는 저장할 때 DB 가
  // 원자적으로 발급하므로, 이것 때문에 확정을 막지는 않는다(헤더에 사실만 알린다).
  const [seqLoadError, setSeqLoadError] = useState<string | null>(null)

  // ── PDF용 debounced 값 (600ms 지연) ─────────────────────────────────────────
  // 고객사를 골라야만 저장되므로 미리보기도 선택된 이름만 쓴다(타이핑 중인 값은 반영하지 않는다).
  const debouncedCompany = useDebounce(company, 600)
  const debouncedReceiver = useDebounce(receiver, 600)
  const debouncedRows = useDebounce(rows, 600)
  // 조건 네 줄 — 미리보기도 다른 칸과 같은 600ms 디바운스를 쓴다(글자마다 PDF 를 다시 그리지 않게).
  const debouncedTerms = useDebounce(terms, 600)
  const debouncedTermsOpen = useDebounce(termsOpen, 600)

  const finalRemarksForPDF = (() => {
    const parts: string[] = []
    if (delivery.trim()) parts.push(`* 납기 : 발주 후 ${delivery.trim()}`)
    // 줄을 낼지는 종전과 같이 고른 값(euQuery)으로 가르고, **찍는 이름만** 회사 이름을 우선한다.
    if (isDealer && euQuery.trim()) parts.push(`* E.U  : ${euDisplayName({ siteName: euQuery, parentName: euParentName })}`)
    if (remarks.trim()) parts.push(remarks.trim())
    return parts.join('\n')
  })()
  const debouncedFinalRemarks = useDebounce(finalRemarksForPDF, 600)

 useEffect(() => {
    if (!engineer) return
    const f = async () => {
      // maybeSingle 을 쓴다 — single 은 '행 없음'도 오류(PGRST116)로 돌려주어,
      // 그날의 첫 견적(정상)과 권한 거부(사고)를 구분할 수 없다.
      // maybeSingle 은 행이 없으면 data=null, error=null 이므로 남는 error 는 전부 진짜 실패다.
      const { data, error } = await supabase
        .from('quote_sequence').select('seq')
        .eq('date_str', dateStr).eq('engineer_id', engineer.engineer_id)
        .order('seq', { ascending: false }).limit(1).maybeSingle()
      if (error) {
        // 조용히 0(=A)으로 떨어지면 안 된다 — 그러면 이미 쓴 번호가 다시 발급된다.
        console.error('[quote] quote_sequence 조회 실패', { dateStr, engineerId: engineer.engineer_id, error })
        setSeqLoadError(error.code || error.message || '알 수 없는 오류')
        return
      }
      setSeqLoadError(null)
      // 그날 이 사람의 카운터 값 + 1 이 다음에 발급될 순번이다(행이 없으면 그날 첫 견적 = 1 = A).
      setPreviewSeq(data ? data.seq + 1 : 1)
    }
    f()
  }, [engineer, dateStr])

  // 견적번호 = 작성자 이니셜 + 날짜 + 순번 글자. 이니셜이 없으면 번호를 만들지 않는다(저장도 막는다).
  // 예전에는 'KJW' 로 대신해, 이니셜이 빈 사람의 번호가 4번 엔지니어(KJW)의 번호와 겹칠 수 있었다.
  const initials = engineer?.initials?.trim().toUpperCase() || null
  const missingInitials = !!engineer && !initials
  const buildQuoteNo = (seq: number) => (initials ? `No.${initials}${dateStr}-${seqToLetters(seq)}` : '')
  /** 미리보기 번호. 저장되는 번호는 create_quote 함수가 만든다(동시 확정 시 이 값과 다를 수 있다). */
  const quoteNo = buildQuoteNo(previewSeq)
  const { totalSupply, totalTax, totalAmount, totalCost, totalProfit, totalProfitRate } = calcTotals(rows)
  // 견적서에 찍히는 담당자는 실적 담당자다 — 고객이 연락할 사람이 작성자가 아니라 그쪽이기 때문이다.
  // 대필이 아니면 실적 담당자가 곧 본인이라 종전과 같다. (견적번호는 반대로 작성자 이니셜을 쓴다.)
  const creditedName = onBehalf ? onBehalf.name : (engineer?.name ?? '')
  const creditedPosition = onBehalf ? onBehalf.position : (engineer?.position ?? null)
  const engineerName = creditedName ? `${creditedName} ${creditedPosition || ''}`.trim() : ''
  const engineerTel = (onBehalf ? onBehalf.tel : engineer?.tel)?.trim() || ''   // 담당자란에 병기하는 전화번호

  /**
   * 확정·저장에 쓸 조건. 체크가 꺼져 있으면 **적지 않은 것으로 본다**(기본값·저장 안 함).
   * ok 가 false 면 40자를 넘긴 칸이 있다 — 확정 전에 안내하고 막는다.
   */
  const termsResult = normalizeTerms(termsOpen ? terms : null)
  /** 미리보기에 넘길 값 — 길이 초과 중이면 그 칸만 기본값으로 그린다(미리보기를 멈추지 않는다). */
  const previewTerms = (() => {
    const r = normalizeTerms(debouncedTermsOpen ? debouncedTerms : null)
    return r.ok ? r.terms : { ...DEFAULT_TERMS }
  })()

  /**
   * 품목 설명 줄의 정규화 — **확정과 PDF 가 같은 결과를 쓴다.**
   * 한 품목이라도 상한을 넘으면 ok: false 이고, 그때 확정이 막힌다(자르지 않는다).
   */
  const subLinesResult = (() => {
    for (const r of rows) {
      const res = normalizeSubLines(r.subLines)
      if (!res.ok) return res
    }
    return { ok: true as const }
  })()

  /** 그 품목의 저장 모양 — 줄이 없으면 null. 상한을 넘은 상태면 저장하지 않는다(확정이 막힌다). */
  const normalizedSubLines = (r: QuoteRow): string[] | null => {
    const res = normalizeSubLines(r.subLines)
    return res.ok ? res.stored : null
  }

  /** PDF 에 넘길 rows — 설명 줄만 정규화한다(금액·환율은 손대지 않는다). */
  const withNormalizedSubLines = (list: QuoteRow[]): QuoteRow[] =>
    list.map(r => {
      const res = normalizeSubLines(r.subLines)
      return res.ok ? { ...r, subLines: res.lines } : r
    })

  // PDF용 합계 (debounced rows 기준)
  const { totalSupply: pdfTotalSupply, totalTax: pdfTotalTax, totalAmount: pdfTotalAmount } = calcTotals(debouncedRows)





  // 사명·E.U 아래 안내 문구. 셋 중 하나만 나온다.
  //   ① ?customer= 로 후보가 여럿일 때 ② 검색 결과가 없을 때 ③ 평소(상시 안내)
  const custNoResult = customerQuery.trim().length > 0 && customerResults.length === 0
  // 안내는 "찾아봤는데 없다" 일 때만 낸다. 사전 등록이 필요하다는 사실은 placeholder 가 이미 말한다.
  const customerGuide = prefillNotice
    ?? (custNoResult ? '검색 결과가 없습니다. 고객사 현황에서 업체를 먼저 등록해주세요' : null)
  // 링크는 "검색해도 없다" 일 때만 — 후보가 여럿인 경우엔 고르면 되므로 링크가 오히려 방해다.
  const showCustomerLink = !prefillNotice && custNoResult

  // 고를 수 있는 영업기회 — 종결된 건은 이미 연결돼 있을 때만 남긴다(선택 유지용).
  // 이 목록이 비면 영업기회 칸 자체를 그리지 않는다.
  const selectableOpportunities = opportunities.filter(o => !isClosed(o) || o.opportunity_id === opportunityId)

  // 비고 — 접힌 줄에 보여줄 첫 줄과, 기본 문구에서 손댔는지 여부.
  const remarksPreview = remarks.trim().split('\n')[0] ?? ''
  const remarksEdited = remarks.trim() !== DEFAULT_REMARKS.trim()
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




  // 저장·확정·PDF·초기화. 네 함수를 그대로 옮긴 훅이다(effect 는 두지 않는다).
  const {
    isSaving, showConfirmModal, setShowConfirmModal, isSubmitting, runConfirm,
  } = useQuoteSubmit({
    supabase, toast, router, engineer, initials, onBehalf,
    dateStr, dateDisplay, quoteNo, engineerName, engineerTel,
    company, receiver, delivery, finalRemarksForPDF, showSignature,
    rows, expenses, exchangeRate,
    customerId, euCustomerId, isDealer, opportunityId,
    totalSupply, totalTax, totalAmount, totalCost, totalProfit, totalProfitRate,
    termsResult, subLinesResult, normalizedSubLines, withNormalizedSubLines,
    runValidation, setErrors,
    repairId, hasUrlPrefill, setParamsCleared, setPreviewSeq,
    defaultRemarks: DEFAULT_REMARKS,
    setCompany, setCustomerId, setCustomerQuery, setCustomerResults, setCustomerSearchOpen,
    setSelectedCustomer, setPrefillNotice, setIsDealer,
    setEuCustomerId, setEuQuery, setEuResults, setEuSearchOpen, setSelectedEU, resolveEuParent,
    setOpportunities, setOpportunityId,
    setReceiver, setDelivery, setRemarks, setRemarksOpen, setShowSignature,
    setRows, setSearchQuery, setSearchResults, setSearchOpen,
    setEditingProfitRate, setProfitRateInput, setOnBehalf,
  })

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

  useEffect(() => { rateRef.current = exchangeRate }, [exchangeRate])

  // 임시저장 — 저장분 확인 · 되돌리기 · 자동 저장. effect 둘을 그대로 옮긴 훅이다.
  // 모달에 답하기 전에는 자동 저장이 시작되지 않는다(draftReady). 순서가 규칙이라 여기서 부른다.
  const { draftAsk, setDraftAsk, setDraftReady, applyDraft } = useQuoteDraftSync({
    toast, rateRef, engineer, hasUrlPrefill,
    onBehalf, company, customerId, selectedCustomer, customerQuery, isDealer,
    euCustomerId, selectedEU, euQuery, opportunityId,
    receiver, delivery, remarks, showSignature, termsOpen, terms, rows,
    debouncedRows, debouncedCompany, debouncedReceiver, debouncedFinalRemarks,
    setCompany, setCustomerId, setSelectedCustomer, setCustomerQuery, setIsDealer,
    setEuCustomerId, setSelectedEU, setEuQuery, resolveEuParent,
    setReceiver, setDelivery, setRemarks, setShowSignature, setTermsOpen, setTerms, setRows,
    loadOpportunities, setOpportunityId, setOnBehalf,
  })

  // 주소 파라미터 프리필 — ?duplicate / ?on_behalf / ?repair_id. effect 셋을 그대로 옮긴 훅이다.
  // 원본에서는 다시쓰기와 대필 사이에 아래 「부대비용 프리셋」 effect 가 끼어 있었다(그것만 뒤로 밀렸다).
  useQuotePrefill({
    supabase, toast, searchParams, rateRef,
    duplicateId, onBehalfId, repairId, engineer,
    setOnBehalf, setRows, setIsDealer, setCustomerId, setEuCustomerId,
    setSelectedCustomer, setCustomerQuery, setCompany, setSelectedEU, setEuQuery,
    resolveEuParent, setReceiver, setDelivery, setTermsOpen, setTerms, setRemarks,
    loadOpportunities, setOpportunityId, handleCustomerSelect,
    setCustomerResults, setCustomerSearchOpen, setPrefillNotice,
  })

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


  const fetchRate = useCallback(async () => {
    setRateLoading(true)
    try {
      const { data: cached } = await supabase.from('exchange_rate').select('*').order('id', { ascending: false }).limit(1).single()
      const todayStr = todayKST()

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
  useEffect(() => { if (!exchangeRate) return; setRows(prev => prev.map(r => calcRow(r, exchangeRate))) }, [exchangeRate]) // eslint-disable-line react-hooks/exhaustive-deps
  // 어느 품목이든 금액이 생기면 집계 에러(items) 를 즉시 해제한다.
  useEffect(() => { if (rows.some(r => r.supply_price > 0)) clearError('items') }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  // 금액 0 인 부대비용 행이 모두 해소되면 에러를 즉시 해제한다(부대비용은 rows 안에 있다).
  useEffect(() => {
    const list = rows.find(r => r.row_kind === 'service')?.expenses ?? []
    if (!list.some(e => e.item_name.trim() && e.amount <= 0)) clearError('expenses')
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRateChange = useCallback(async (rate: number) => {
    const todayStr = todayKST()
    setExchangeRate(rate)
    setRateUpdatedAt(todayStr)
    await supabase.from('exchange_rate').insert([{ rate, updated_at: todayStr }])
  }, [])


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
        /* 두 칸을 한 줄로. 화면이 좁아지면 세로로 접힌다. */
        .q-two {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        /* grid 자식은 기본이 min-width:auto 라 내용보다 작아지지 않는다.
           풀어주지 않으면 두 상자가 카드 밖으로 밀려난다. */
        .q-two > * { min-width: 0; }
        /* 왼쪽 입력 열은 화면 폭과 상관없이 430px 고정이라, 예전 1100px 기준은 의미가 없어졌다.
           상단 바로 바뀌는 모바일에서만 한 칸씩 내린다. */
        @media (max-width: 768px) {
          .q-two { grid-template-columns: 1fr; }
        }

        /* 라벨을 입력칸 안에 넣는 상자.
           포커스는 :focus-within 으로 상자 전체에 건다 — 라벨만 남고 입력만 파래지는 모양을 피한다.
           값은 .q-input:focus 와 같은 것을 쓴다. */
        .q-box {
          display: flex;
          align-items: stretch;
          position: relative;
          background: #fff;
          border: 1px solid #ebebeb;
          border-radius: 6px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .q-box:focus-within {
          border-color: #234ea2;
          box-shadow: 0 0 0 3px rgba(35,78,162,0.10);
        }
        /* 라벨 — 상자 안 왼쪽. 오른쪽에 세로 구분선을 둔다.
           폭은 가장 긴 상시 라벨(수신인 = 54px)에 맞춰 모두 같게 한다. 글자 수대로 두면
           상자마다 입력이 시작되는 자리가 어긋나 균형이 깨진다.
           min-width 라서 더 긴 라벨(영업기회)만 필요한 만큼 늘어나고 잘리지 않는다. */
        .q-box-label {
          display: flex;
          align-items: center;
          flex-shrink: 0;
          min-width: 54px;
          box-sizing: border-box;
          padding: 0 10px;
          border-right: 1px solid #ebebeb;
          font-size: 12px;
          font-weight: 600;
          color: #111827;
          white-space: nowrap;
        }
        .q-box-field {
          flex: 1;
          min-width: 0;
          padding: 8px 11px;
          border: none;
          outline: none;
          background: transparent;
          font-family: inherit;
          font-size: 12px;
          color: #111827;
        }
        /* 상자 오른쪽 끝 컨트롤(체크박스·지우기·펼침 화살표) */
        .q-box-tail {
          display: flex;
          align-items: center;
          flex-shrink: 0;
          gap: 6px;
          padding-right: 10px;
        }
        /* 비고 상자 — 머리줄 아래로 textarea 가 펼쳐진다 */
        .q-box-col { flex-direction: column; align-items: stretch; }
        .q-box-head {
          display: flex;
          align-items: stretch;
          width: 100%;
          /* 미리보기 글자가 본문(12px)보다 작아 다른 상자보다 1px 낮아지던 것을 맞춘다 */
          min-height: 34px;
          padding: 0;
          background: none;
          border: none;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
        }
        /* 조건 편집 영역 — grid 0fr↔1fr 로 높이를 연다(비고 접기와 같은 방식).
           내용은 늘 마운트돼 있어 접었다 펴도 입력이 남는다. */
        .q-terms-wrap {
          display: grid;
          transition: grid-template-rows 0.25s ease, opacity 0.25s ease;
        }
        .q-terms-inner { overflow: hidden; min-height: 0; }
        @media (prefers-reduced-motion: reduce) {
          .q-terms-wrap { transition: none; }
        }
        .q-term-input {
          flex: 1;
          min-width: 0;
          box-sizing: border-box;
          padding: 6px 9px;
          border: 1px solid #ebebeb;
          border-radius: 6px;
          outline: none;
          background: #ffffff;
          font-family: inherit;
          font-size: 12px;
          color: #111827;
        }
        .q-term-input:focus { border-color: #c7d7f8; }
        .q-box-area {
          width: 100%;
          box-sizing: border-box;
          padding: 8px 11px;
          border: none;
          border-top: 1px solid #ebebeb;
          outline: none;
          background: transparent;
          font-family: inherit;
          font-size: 12px;
          line-height: 1.7;
          color: #111827;
          resize: vertical;
        }
      `}</style>
      {repairId != null && (
        <div style={{ padding: '16px 20px 0' }}>
          <div style={{ background: '#eff4ff', border: '1px solid #c7d7f8', borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 700, color: '#234ea2' }}>
            수리 건 #{repairId} 의 견적서를 작성 중입니다
          </div>
        </div>
      )}
      {/* 폭 상한을 두지 않는다 — 사이드바가 232px 을 가져가므로 남는 폭을 미리보기가 그대로 쓴다.
          입력칸은 430px 고정, 미리보기는 남은 폭. 둘이 함께 들어갈 폭이 안 되면(약 930px 미만)
          미리보기가 아래로 내려간다(flexWrap). */}
      <div style={{ padding: 20, display: 'flex', flexWrap: 'wrap', gap: 20 }}>

        <div style={{ width: 430, flexShrink: 0 }}>

          {/* 기본 정보 */}
          <div style={{ background: '#fff', borderRadius: 8, padding: '14px 16px', marginBottom: 14, border: '1px solid #ebebeb' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 3, height: 14, background: '#234ea2', borderRadius: 6, flexShrink: 0 }} />
              <span style={{ fontWeight: 800, fontSize: 13, color: '#111827' }}>기본 정보</span>
            </div>

            {/* 사명 + 대리점 체크박스 */}
            <div style={{ marginBottom: errors.company ? 8 + 18 : 8 }}>
              <div ref={customerSearchRef} className="q-box" style={{ border: errors.company ? errBorder : undefined }}>
                <span className="q-box-label">사명</span>
                  {/* 고르고 나면 이름을 글자로 보여준다 — 체크를 이름 바로 뒤에 붙이려면
                      칸이 글자 폭만큼만 차지해야 하고, input 은 그렇게 줄지 않는다.
                      다시 찾을 때는 × 로 비운다(그 편이 '고른 업체'와 '치고 있는 글자'가 어긋나지 않는다). */}
                  {selectedCustomer ? (
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 11px' }}>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: '#111827' }}>
                        {customerQuery}
                      </span>
                      <span title="등록된 업체와 연결됨" style={{ display: 'flex', alignItems: 'center', color: '#234ea2', flexShrink: 0 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                      </span>
                    </span>
                  ) : (
                    <input
                      className="q-box-field"
                      value={customerQuery}
                      onChange={e => { handleCustomerSearch(e.target.value); clearError('company'); setPrefillNotice(null) }}
                      onFocus={() => customerResults.length > 0 && setCustomerSearchOpen(true)}
                      onKeyDown={customerKeys.onKeyDown}
                      placeholder="업체명 검색 (사전 등록 필요)"
                    />
                  )}
                  {/* 상자 오른쪽 끝 — 지우기 × 와 대리점 체크박스 */}
                  <div className="q-box-tail">
                    {selectedCustomer && (
                      <button onClick={handleCustomerClear}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 0, display: 'flex', alignItems: 'center' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>
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
                  <FieldError message={errors.company} style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, whiteSpace: 'nowrap' }} />
                  {customerSearchOpen && customerResults.length > 0 && (
                    <div ref={customerListRef} style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: Z.inPage, background: '#fff', border: '1px solid #234ea2', borderRadius: 8, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(35,78,162,0.12)' }}>
                      {customerResults.map((c, i) => (
                        <div key={c.customer_id} onClick={() => handleCustomerSelect(c)}
                          style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid #ebebeb', fontSize: 12, transition: 'background 0.15s ease', background: customerKeys.active === i ? '#f0f4ff' : '#fff' }}
                          onMouseEnter={() => customerKeys.setActive(i)}>
                          <div style={{ fontWeight: 700, color: '#234ea2' }}>{c.company_name}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{c.address ?? ''}{c.status ? ` · ${c.status}` : ''}</div>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
              {/* 고른 업체를 알리는 칩 줄은 두지 않는다 — 상자 안에 업체명이 그대로 들어가 있어
                  같은 말을 두 번 하는 셈이고, 대리점 여부는 상자 안 체크박스와 E.U 상자가 보여준다.
                  미선택 상태도 시작 상태일 뿐이라 배지로 강조하지 않는다(안 고르면 검증이 붉게 막는다). */}
              {!selectedCustomer && customerGuide && (
                <div style={{ marginTop: 4, marginLeft: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
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
                {/* E.U 상자 — 대리점 건이라 테두리만 주황 계열을 유지한다(기존 색). */}
                <div ref={euSearchRef} className="q-box" style={{ borderColor: '#fed7aa' }}>
                    <span className="q-box-label" style={{ borderRightColor: '#fed7aa' }}>E.U</span>
                    <input
                      className="q-box-field"
                      value={euQuery}
                      onChange={e => { handleEUSearch(e.target.value); clearError('eu') }}
                      onFocus={() => euResults.length > 0 && setEuSearchOpen(true)}
                      onKeyDown={euKeys.onKeyDown}
                      placeholder="최종 사용 업체 검색 (사전 등록 필요)"
                    />
                    {/* 고른 뒤에는 상자 안 오른쪽 끝에 체크(= 거래이력 연동)와 지우기만 남긴다. */}
                    {selectedEU && (
                      <div className="q-box-tail">
                        <span title="거래이력 연동" style={{ display: 'flex', alignItems: 'center', color: '#c2410c' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                        </span>
                        <button onClick={handleEUClear}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 0, display: 'flex', alignItems: 'center' }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                    )}
                    {euSearchOpen && euResults.length > 0 && (
                      <div ref={euListRef} style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: Z.inPage, background: '#fff', border: '1px solid #c2410c', borderRadius: 8, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(194,65,12,0.12)' }}>
                        {euResults.map((c, i) => (
                          <div key={c.customer_id} onClick={() => handleEUSelect(c)}
                            style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid #ebebeb', fontSize: 12, transition: 'background 0.15s ease', background: euKeys.active === i ? '#fff7ed' : '#fff' }}
                            onMouseEnter={() => euKeys.setActive(i)}>
                            <div style={{ fontWeight: 700, color: '#c2410c' }}>{c.company_name}</div>
                            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{c.address ?? ''}{c.status ? ` · ${c.status}` : ''}</div>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
                {/* 고른 사업장이 회사 아래 묶여 있으면 견적서에는 **회사 이름**이 찍힌다.
                    입력칸에는 고른 사업장이 그대로 보이므로, 무엇이 나가는지 여기서 알린다. */}
                {selectedEU && euParentName && (
                  <div style={{ marginLeft: 10, marginTop: 4, fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
                    견적서 표기: {euDisplayName({ siteName: euQuery, parentName: euParentName })}
                  </div>
                )}
                {/* 미선택 안내는 두지 않는다 — 사전 등록이 필요하다는 사실은 placeholder 가 말하고,
                    안 고른 채 저장하면 아래 검증이 붉게 막는다(사명 칸과 같은 규칙). */}
                <FieldError message={errors.eu} style={{ marginLeft: 10 }} />
              </div>
            )}

            {/* 영업기회 연결 — 선택 사항. 내부 정보이며 PDF 에는 나가지 않는다.
                후보가 있는 업체는 몇 곳뿐이라, 고를 것이 있을 때만 칸을 낸다.
                (업체 미선택·기회 없음 상태에서는 안내만 남고 늘 비어 있던 칸이다) */}
            {selectableOpportunities.length > 0 && (
              <div className="q-box" style={{ marginBottom: 8, animation: 'modal-in 0.15s ease' }}>
                <span className="q-box-label">영업기회</span>
                <select
                  className="q-box-field"
                  value={opportunityId ?? ''}
                  onChange={e => setOpportunityId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">연결 안 함</option>
                  {selectableOpportunities.map(o => (
                    <option key={o.opportunity_id} value={o.opportunity_id}>{`${o.stage} · ${o.title}`}</option>
                  ))}
                </select>
              </div>
            )}

            {/* 수신인 · 납기 — 한 줄. 좁아지면 .q-two 가 1열로 접힌다. */}
            <div className="q-two" style={{ marginBottom: 8 }}>
              <div className="q-box">
                <span className="q-box-label">수신인</span>
                <input className="q-box-field" value={receiver} onChange={e => setReceiver(e.target.value)} placeholder="예: 홍길동 부장님" />
              </div>
              <div className="q-box">
                <span className="q-box-label">납기</span>
                <input
                  className="q-box-field"
                  value={delivery}
                  onChange={e => setDelivery(e.target.value)}
                  placeholder="없을 시 입력 (N주)"
                />
              </div>
            </div>

            {/* 비고 — 기본 문구가 채워져 있고 고칠 일이 드물어 접어 둔다.
                접힌 줄에 첫 줄을 회색으로 보여주고, 기본 문구에서 손댔으면 「수정됨」을 붙인다. */}
            <div className="q-box q-box-col">
              {/* 머리줄 — [비고 │ 미리보기 … ›]. 펼치기 화살표는 상자 오른쪽 끝. */}
              <button type="button" className="q-box-head" onClick={() => setRemarksOpen(o => !o)}>
                <span className="q-box-label">비고</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 11px' }}>
                  {remarksEdited && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#234ea2', flexShrink: 0 }}>수정됨</span>
                  )}
                  {!remarksOpen && (
                    <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {remarksPreview}
                    </span>
                  )}
                </span>
                <span className="q-box-tail">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="3"
                    style={{ transition: 'transform 0.15s ease', transform: remarksOpen ? 'rotate(90deg)' : 'none' }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              </button>
              {/* grid 1fr↔0fr 로 높이를 애니메이션한다. 내용은 늘 마운트돼 있어 접었다 펴도 값이 남는다. */}
              <div style={{ display: 'grid', gridTemplateRows: remarksOpen ? '1fr' : '0fr', transition: 'grid-template-rows 0.15s ease' }}>
                <div style={{ overflow: 'hidden', minHeight: 0 }}>
                  <textarea className="q-box-area" value={remarks} onChange={e => setRemarks(e.target.value)} rows={3} />
                </div>
              </div>
            </div>

            {/* 서명란·조건은 비고와 별개 항목이라 상자 밖 독립된 줄로 뺀다. 줄 오른쪽 끝에 붙인다.
                왼쪽이 「조건 변경」, 오른쪽이 「고객사 서명란 추가」다(같은 스타일). */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={termsOpen}
                  onChange={e => {
                    const on = e.target.checked
                    setTermsOpen(on)
                    // 체크를 풀면 적어 둔 값도 **기본값으로 돌린다** — 닫아 둔 값이 조용히 저장되지 않게.
                    if (!on) setTerms({ ...DEFAULT_TERMS })
                  }}
                  style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#234ea2' }}
                />
                <span style={{ fontSize: 11, fontWeight: 700, color: termsOpen ? '#234ea2' : '#6b7280' }}>조건 변경</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showSignature}
                  onChange={e => setShowSignature(e.target.checked)}
                  style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#234ea2' }}
                />
                <span style={{ fontSize: 11, fontWeight: 700, color: showSignature ? '#234ea2' : '#6b7280' }}>고객사 서명란 추가</span>
              </label>
            </div>

            {/* 조건 편집 — 체크했을 때만 열린다. 네 줄의 라벨·순서는 PDF 와 같다(등록표에서 읽는다). */}
            <div
              className="q-terms-wrap"
              style={{ gridTemplateRows: termsOpen ? '1fr' : '0fr', opacity: termsOpen ? 1 : 0 }}
              aria-hidden={!termsOpen}
            >
              <div className="q-terms-inner">
                <div style={{
                  marginTop: 8, border: '1px solid #ebebeb', borderRadius: 8, padding: '10px 12px',
                  display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                  {TERM_KEYS.map(key => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 56, flexShrink: 0, fontSize: 11, fontWeight: 700, color: '#6b7280' }}>
                        {TERM_LABELS[key]}
                      </span>
                      <input
                        className="q-term-input"
                        value={terms[key]}
                        maxLength={TERM_MAX_LEN}
                        placeholder={TERM_PLACEHOLDERS[key]}
                        tabIndex={termsOpen ? 0 : -1}
                        onChange={e => setTerms(prev => ({ ...prev, [key]: e.target.value }))}
                      />
                    </div>
                  ))}
                  {/* 견적유효 아래 보조 글씨 — 문구를 고쳐도 만료 판정은 바뀌지 않는다. */}
                  <span style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.6, paddingLeft: 64 }}>
                    문구만 바뀝니다. 자동 만료 판정은 작성일로부터 1개월 기준입니다.
                  </span>
                </div>
              </div>
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

        {/* PDF 미리보기 — 480px 밑으로 눌리면 글자가 읽히지 않아 그 전에 아래로 내려간다 */}
        <div style={{ flex: '1 1 480px', minWidth: 0 }}>
          <div style={{ background: '#f3f4f6', borderRadius: 8, overflow: 'hidden', border: '1px solid #ebebeb', height: 'calc(100vh - 40px)', position: 'sticky', top: 20, display: 'flex', flexDirection: 'column' }}>

            {/* 헤더 */}
            <div style={{ background: '#234ea2', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 500, marginBottom: 2 }}>예상 견적 번호</div>
                {/* 조회가 실패했으면 번호 대신 그 사실을 낸다 — 잘못된 번호를 그럴듯하게 보여주지 않는다.
                    파란 헤더 위라 붉은 글씨는 읽히지 않으므로, 흰 글씨에 반투명 테두리로 구분한다(기존 대필 배지와 같은 방식). */}
                {missingInitials || seqLoadError ? (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.5)' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span style={{ fontSize: 12, color: '#ffffff', fontWeight: 700 }}>
                      {missingInitials ? '이니셜 미등록 — 견적번호를 만들 수 없습니다' : `예상 번호 조회 실패 (${seqLoadError}) — 번호는 확정할 때 발급됩니다`}
                    </span>
                  </div>
                ) : (
                  <div style={{ fontSize: 14, color: '#ffffff', fontWeight: 600 }}>{quoteNo}</div>
                )}
              </div>
              {/* 대필 중임을 작성하는 내내 보이게 둔다 — 남의 실적으로 저장되는 화면이라 헷갈리면 안 된다. */}
              {onBehalf && (
                <span style={{ padding: '4px 10px', borderRadius: 99, background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.5)', color: '#ffffff', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {`${onBehalf.name} ${onBehalf.position || ''}`.trim()} 대신 작성 중
                </span>
              )}
              {/* 번호는 확정할 때 DB 가 발급하므로, 예상 번호를 못 읽었다고 확정을 막지 않는다.
                  이니셜이 없으면 번호를 만들 수 없어 누르는 즉시 안내하고 멈춘다. */}
              {(() => {
                const locked = isSaving
                return (
                  <button
                    onClick={() => {
                      if (missingInitials) { toast.error(NO_INITIALS_MESSAGE); return }
                      if (!runValidation()) return
                      setShowConfirmModal(true)
                    }}
                    disabled={locked}
                    style={{
                      padding: '6px 14px', boxSizing: 'border-box',
                      background: locked ? 'transparent' : '#ffffff',
                      color: locked ? '#ffffff' : '#234ea2',
                      border: locked ? '1px solid #ffffff' : 'none',
                      borderRadius: 6, fontWeight: 600, fontSize: 13,
                      cursor: locked ? 'not-allowed' : 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={e => { if (!locked) (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}
                    onMouseLeave={e => { if (!locked) (e.currentTarget as HTMLButtonElement).style.background = '#ffffff' }}>
                    {isSaving ? '저장 중...' : '견적 확정'}
                  </button>
                )
              })()}
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
                    terms={previewTerms}
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
      {/* 임시저장 안내 — 저장분이 있을 때만. 답하기 전에는 자동 저장이 시작되지 않는다. */}
      {draftAsk && engineer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 32, width: '100%', maxWidth: 440, boxShadow: '0 24px 64px rgba(0,0,0,0.22)', animation: 'modal-in 0.18s ease' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', marginBottom: 4, letterSpacing: '-0.3px' }}>작성 중이던 내용이 있습니다</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, fontWeight: 500 }}>
              {draftSavedLabel(draftAsk.savedAt)} 까지 쓴 내용{draftAsk.company.trim() ? ` · ${draftAsk.company.trim()}` : ''}
            </div>
            <div style={{ background: '#eff4ff', border: '1px solid #c7d7f8', borderRadius: 8, padding: '12px 14px', marginBottom: 24 }}>
              <div style={{ fontSize: 12, color: '#234ea2', lineHeight: 1.8 }}>
                이어서 쓰거나, 새로 시작할 수 있습니다. <b>새로 쓰기를 고르면 저장분은 사라집니다.</b>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { clearDraft(engineer.engineer_id); setDraftAsk(null); setDraftReady(true) }}
                style={{ padding: '11px 20px', background: '#fff', color: '#6b7280', border: '1px solid #ebebeb', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                새로 쓰기
              </button>
              <button
                onClick={() => { applyDraft(draftAsk) }}
                style={{ padding: '11px 24px', background: '#234ea2', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                이어쓰기
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfirmModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 32, width: '100%', maxWidth: 440, boxShadow: '0 24px 64px rgba(0,0,0,0.22)', animation: 'modal-in 0.18s ease' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', marginBottom: 4, letterSpacing: '-0.3px' }}>견적 확정</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, fontWeight: 500 }}>{quoteNo} <span style={{ color: '#9ca3af' }}>(예상 번호 — 확정할 때 발급)</span></div>
            <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '12px 14px', marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.8 }}>
                확정하면 <b>견적번호가 발급되고 실적으로 기록됩니다.</b>
                <br />견적서 PDF 가 바로 만들어져 내려받아집니다.
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
              {/* 여기서 바로 확정한다 — 결재선을 받는 단계는 없앴다(runConfirm 설명). */}
              <button onClick={() => {
                if (isSubmitting) return
                // 작성자 정보(담당자 줄·대필 판정)가 PDF 에 들어가므로 먼저 있어야 한다.
                if (!engineer) { toast.error('엔지니어 정보를 불러오는 중입니다'); return }
                void runConfirm()
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
