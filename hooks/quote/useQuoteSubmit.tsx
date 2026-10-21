'use client'

// 견적 작성 화면의 **저장·확정·PDF·초기화** — 네 함수를 한곳에 모았다.
//
// app/quote/page.tsx 에서 **그대로 옮겨 온 것**이다(분리 리팩터 3a). 함수 본문·주석·메시지·
// 호출 순서를 한 글자도 바꾸지 않았다. 아래 네 가지만 옮기면서 생긴 차이이고 동작은 같다.
//   · 파일 확장자가 .tsx 다 — handleDownloadPDF 가 <QuotePDFDoc …> 를 직접 그린다(JSX).
//   · 화면이 들고 있는 값·setter 를 전부 인자로 받는다(상태를 옮기지 않는다 — resetForm 이
//     화면 전체를 되돌려야 하기 때문이다).
//   · NO_INITIALS_MESSAGE 를 여기서 내보낸다 — 저장(이 훅)과 확정 버튼(화면)이 같은 문구를 쓴다.
//   · MAX_PDF_NAME_TRIES · isNameTakenError 는 PDF 업로드에만 쓰여 이 파일 안에 둔다.
//
// **effect 를 하나도 두지 않는다** — 네 함수 모두 사용자가 눌렀을 때만 돈다. 그래서 이 훅을
// 어디서 부르든 page.tsx 의 effect 순서는 변하지 않는다.

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pdf } from '@react-pdf/renderer'
import type { ExpenseRow, PriceItem, QuoteRow } from '@/app/quote/types'
import { calcTotals, createRow } from '@/app/quote/calc'
import { QuotePDFDoc } from '@/app/quote/QuotePDFDoc'
import { DEFAULT_TERMS, defaultTermsFor, type Terms } from '@/lib/quoteTerms'
import { clearDraft } from '@/lib/quoteDraft'
import { todayKST } from '@/lib/date'
import { canSplitRowKind } from '@/lib/quoteCategories'
import { canGroupRowKind, isEquipForm } from '@/lib/quoteForms'
import { notifyOnBehalf, type OnBehalfAssignee } from '@/lib/quoteMutations'
import type { CustomerResult } from '@/app/quote/types'
import type { SalesOpportunity } from '@/components/customer/types'
import type { useToast } from '@/components/common/Toast'

/** 검증 대상 입력 칸 — useFieldErrors 에 넘기는 키와 같다(page.tsx 의 useFieldErrors). */
export type QuoteFieldKey = 'category' | 'company' | 'eu' | 'items' | 'expenses'

/** 조건 네 줄 정규화 결과 — 화면이 이미 만들어 둔 값을 그대로 받는다(normalizeTerms). */
type TermsResult = { ok: true; terms: Terms; stored: Partial<Terms> | null } | { ok: false; message: string }
/** 품목 설명 줄 정규화 결과 — 한 품목이라도 상한을 넘으면 ok: false 다. */
type SubLinesResult = { ok: true } | { ok: false; message: string }

export type UseQuoteSubmitArgs = {
  supabase: SupabaseClient
  toast: ReturnType<typeof useToast>
  router: { push: (href: string) => void }
  engineer: { engineer_id: number } | null
  initials: string | null
  onBehalf: OnBehalfAssignee | null

  dateStr: string
  dateDisplay: string
  quoteNo: string
  engineerName: string
  engineerTel: string

  company: string
  receiver: string
  finalRemarksForPDF: string
  showSignature: boolean
  /** 견적 분류(quotes.category). 빈 글자면 저장하지 않는다 — runValidation 이 먼저 막는다. */
  category: string
  /** 견적서 양식(quotes.form_kind). 같은 규칙으로 빈 글자면 저장되지 않는다. */
  formKind: string
  setCategory: React.Dispatch<React.SetStateAction<string>>
  setFormKind: React.Dispatch<React.SetStateAction<string>>
  setLineSplitOn: React.Dispatch<React.SetStateAction<boolean>>

  rows: QuoteRow[]
  expenses: ExpenseRow[]
  exchangeRate: number

  customerId: number | null
  euCustomerId: number | null
  isDealer: boolean
  opportunityId: number | null

  totalSupply: number
  totalTax: number
  totalAmount: number
  totalCost: number
  totalProfit: number
  totalProfitRate: number

  termsResult: TermsResult
  subLinesResult: SubLinesResult
  normalizedSubLines: (r: QuoteRow) => string[] | null
  withNormalizedSubLines: (list: QuoteRow[]) => QuoteRow[]

  runValidation: () => boolean
  setErrors: React.Dispatch<React.SetStateAction<Partial<Record<QuoteFieldKey, string>>>>

  repairId: number | null
  hasUrlPrefill: boolean
  setParamsCleared: React.Dispatch<React.SetStateAction<boolean>>
  setPreviewSeq: React.Dispatch<React.SetStateAction<number>>
  /** 비고 기본 문구(page.tsx 의 DEFAULT_REMARKS). resetForm 이 이 값으로 되돌린다. */

  setCompany: React.Dispatch<React.SetStateAction<string>>
  setCustomerId: React.Dispatch<React.SetStateAction<number | null>>
  setCustomerQuery: React.Dispatch<React.SetStateAction<string>>
  setCustomerResults: React.Dispatch<React.SetStateAction<CustomerResult[]>>
  setCustomerSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedCustomer: React.Dispatch<React.SetStateAction<CustomerResult | null>>
  setPrefillNotice: React.Dispatch<React.SetStateAction<string | null>>
  setIsDealer: React.Dispatch<React.SetStateAction<boolean>>
  setEuCustomerId: React.Dispatch<React.SetStateAction<number | null>>
  setEuQuery: React.Dispatch<React.SetStateAction<string>>
  setEuResults: React.Dispatch<React.SetStateAction<CustomerResult[]>>
  setEuSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedEU: React.Dispatch<React.SetStateAction<CustomerResult | null>>
  resolveEuParent: (customerId: number | null) => void
  setOpportunities: React.Dispatch<React.SetStateAction<SalesOpportunity[]>>
  setOpportunityId: React.Dispatch<React.SetStateAction<number | null>>
  setReceiver: React.Dispatch<React.SetStateAction<string>>
  /** null = 손댄 글자를 버린다(양식의 기본 문구로 돌아간다). */
  setRemarks: (v: string | null) => void
  /** 견적 날짜를 오늘로 되돌린다(확정 뒤 초기화). */
  setQuoteDate: (v: string) => void
  setRemarksOpen: React.Dispatch<React.SetStateAction<boolean>>
  setShowSignature: React.Dispatch<React.SetStateAction<boolean>>
  setRows: React.Dispatch<React.SetStateAction<QuoteRow[]>>
  setSearchQuery: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setSearchResults: React.Dispatch<React.SetStateAction<Record<string, PriceItem[]>>>
  setSearchOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setEditingProfitRate: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setProfitRateInput: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setOnBehalf: React.Dispatch<React.SetStateAction<OnBehalfAssignee | null>>
}

/** 이니셜이 없는 사람은 번호를 만들 수 없다 — 다른 사람 이니셜로 대신하면 번호가 겹친다. */
export const NO_INITIALS_MESSAGE = '이니셜이 등록되지 않았습니다. 관리자에게 문의해주세요'

/**
 * 견적서 PDF 파일명이 겹쳤을 때 접미사를 붙여 시도하는 최대 횟수.
 * 같은 이니셜·같은 날·같은 순번이 다섯 번 겹치는 일은 실제로 없다 — 무한 루프를 막는 상한이다.
 */
const MAX_PDF_NAME_TRIES = 5

/**
 * 스토리지 업로드 오류가 "이름이 이미 있다" 인지. 이때만 다른 이름으로 다시 시도한다.
 * supabase-js 는 이 경우 409 를 주는데, 버전에 따라 statusCode 가 문자열/숫자로 오고
 * 메시지도 조금씩 달라 둘 다 본다.
 */
function isNameTakenError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { statusCode?: string | number; message?: string; error?: string }
  if (String(e.statusCode ?? '') === '409') return true
  return /already exists|duplicate/i.test(`${e.message ?? ''} ${e.error ?? ''}`)
}

export function useQuoteSubmit({
  supabase, toast, router, engineer, initials, onBehalf,
  dateStr, dateDisplay, quoteNo, engineerName, engineerTel,
  company, receiver, finalRemarksForPDF, showSignature,
  category, formKind, setCategory, setFormKind, setLineSplitOn,
  rows, expenses, exchangeRate,
  customerId, euCustomerId, isDealer, opportunityId,
  totalSupply, totalTax, totalAmount, totalCost, totalProfit, totalProfitRate,
  termsResult, subLinesResult, normalizedSubLines, withNormalizedSubLines,
  runValidation, setErrors,
  repairId, hasUrlPrefill, setParamsCleared, setPreviewSeq,
  setCompany, setCustomerId, setCustomerQuery, setCustomerResults, setCustomerSearchOpen,
  setSelectedCustomer, setPrefillNotice, setIsDealer,
  setEuCustomerId, setEuQuery, setEuResults, setEuSearchOpen, setSelectedEU, resolveEuParent,
  setOpportunities, setOpportunityId,
  setReceiver, setRemarks, setRemarksOpen, setShowSignature, setQuoteDate,
  setRows, setSearchQuery, setSearchResults, setSearchOpen,
  setEditingProfitRate, setProfitRateInput, setOnBehalf,
}: UseQuoteSubmitArgs) {
  const [isSaving, setIsSaving] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  // 확정 모달의 확인 버튼 중복 클릭 방지. 저장 → PDF 가 끝날 때까지 잠근다.
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleDownloadPDF = async (
    overrideCompany?: string,
    overrideReceiver?: string,
    overrideRows?: QuoteRow[],
    overrideRemarks?: string,
    overrideQuoteNo?: string,
    /** 확정 직후 저장된 견적 id. 업로드가 끝나면 이 행의 pdf_url 을 실제 이름으로 채운다. */
    quoteId?: number,
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
        terms={termsResult.ok ? termsResult.terms : defaultTermsFor(formKind)}
        formKind={formKind}
      />
    ).toBlob()

    // 스토리지 저장. upsert 를 쓰지 않는다 — 파일명이 견적번호라, 이니셜이 겹치는 두 사람이
    // 같은 날 같은 순번을 받으면 남의 견적서를 조용히 덮어썼다.
    // 이름이 이미 있으면 접미사를 붙여 새 이름으로 올린다(둘 다 남긴다).
    let storedName: string | null = null
    for (let attempt = 1; attempt <= MAX_PDF_NAME_TRIES; attempt++) {
      const candidate = attempt === 1 ? `${finalQuoteNo}.pdf` : `${finalQuoteNo}_${attempt}.pdf`
      const { error } = await supabase.storage.from('quote-pdfs').upload(candidate, blob, {
        contentType: 'application/pdf',
        upsert: false,
      })
      if (!error) { storedName = candidate; break }
      if (!isNameTakenError(error)) {
        // 이름 충돌이 아니면 다시 시도해도 같은 결과다(권한·용량 등).
        console.error('[quote] PDF 업로드 실패', { candidate, error })
        break
      }
      console.error('[quote] PDF 파일명이 이미 있어 다른 이름으로 시도한다', { candidate })
    }

    if (storedName && quoteId) {
      // 실제로 저장된 이름을 그대로 넣는다. 접미사가 붙었으면 그 이름이 들어간다.
      const { error: urlErr } = await supabase
        .from('quotes').update({ pdf_url: `quote-pdfs/${storedName}` }).eq('quote_id', quoteId)
      if (urlErr) {
        console.error('[quote] pdf_url 갱신 실패', { quoteId, storedName, error: urlErr })
        toast.error('견적은 저장되었으나 PDF 연결에 실패했습니다. 관리자에게 알려주세요.')
      }
    } else if (!storedName) {
      // pdf_url 은 비워 둔 채로 남는다 — 없는 파일을 가리키지 않게 하는 것이 중요하다.
      toast.error('견적은 저장되었으나 PDF 생성에 실패했습니다. 관리자에게 알려주세요.')
    }

    // 확정과 동시에 내려받는다. **날짜(확정일)가 찍힌 고객 발송용 문서다** —
    // 날짜 자리는 dateDisplay(확정일, KST)로 그려진다. 결재 완료를 기다리지 않는다:
    // 급한 건을 고객에게 바로 보낼 수 있어야 한다는 것이 확정된 방침이다.
    // 결재는 그대로 돈다(상신·승인·반려, '결재중' 잠금, 발주·계산서·상태 변경의 승인 게이트).
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

  // 저장 결과 — 검증·저장 실패({ ok: false })와 저장 성공을 호출부가 구분할 수 있게 한다.
  // 성공일 때만 PDF 생성·견적번호 증가로 넘어간다.
  // quoteId 는 PDF 를 올린 뒤 pdf_url 을 실제 파일 이름으로 채우는 데 쓴다.
  // quoteNo·seq 는 실제로 발급·저장된 번호다(미리보기 번호와 다를 수 있다) — PDF·다음 미리보기가 이 값을 쓴다.
  type SaveResult = { ok: false } | { ok: true; linked: boolean; quoteId: number; quoteNo: string; seq: number }

  // create_quote(RPC) 가 돌려주는 행. returns table 이라 배열로 온다.
  //   repair_linked — true 연결됨 / false 대상 수리 건이 없었음 / null 연결 시도 자체가 없었음
  type CreateQuoteRow = { quote_id: number; quote_number: string; seq: number; repair_linked: boolean | null }

  /**
   * 확정 후 화면을 처음 들어왔을 때 상태로 되돌린다.
   *
   * 라우터 이동·새로고침 대신 state 만 되돌린다 — useSearchParams 를 감싼 Suspense 경계가
   * 다시 걸리면 화면이 한 번 비었다가 그려지고(깜빡임), 환율·부대비용 프리셋을 다시 받아오며,
   * 스크롤도 맨 위로 튄다. state 리셋은 그 셋 다 없다.
   *
   * 건드리지 않는 것: 견적번호(previewSeq — 호출부에서 실제 발급 번호의 다음으로 맞춘다), 환율, 로그인 정보,
   * 부대비용 프리셋. 부대비용·DISCOUNT 는 rows 안에 들어 있어 rows 를 비우면 함께 사라진다.
   */
  const resetForm = () => {
    setCompany(''); setCustomerId(null); setCustomerQuery(''); setCustomerResults([])
    setCustomerSearchOpen(false); setSelectedCustomer(null); setPrefillNotice(null)
    setIsDealer(false)
    setEuCustomerId(null); setEuQuery(''); setEuResults([]); setEuSearchOpen(false); setSelectedEU(null)
    resolveEuParent(null)
    setOpportunities([]); setOpportunityId(null)
    // 비고는 **손댄 글자를 버린다**(null) — 그러면 다음 견적의 양식에 맞는 기본 문구가 보인다.
    setReceiver(''); setRemarks(null); setRemarksOpen(false); setShowSignature(false)
    // 견적 날짜도 오늘로 되돌린다 — 지난 날짜로 한 건 쓴 뒤 다음 건이 그 날짜로 이어지지 않게.
    setQuoteDate(todayKST())
    setRows([createRow()])
    setSearchQuery({}); setSearchResults({}); setSearchOpen({})
    setEditingProfitRate({}); setProfitRateInput({})
    // 분류·양식도 처음 상태로. 이어서 다음 견적을 쓸 때 다시 고르게 한다(다른 건일 수 있다).
    setCategory(''); setFormKind(''); setLineSplitOn(false)
    setOnBehalf(null)
    setErrors({})
    // 주소창의 프리필 파라미터를 지운다. 라우터를 거치지 않아 이 컴포넌트가 다시 마운트되지 않는다.
    // 값 자체는 paramsCleared 로 무효화하므로 useSearchParams 의 갱신 시점과 무관하게 안전하다.
    if (hasUrlPrefill) {
      setParamsCleared(true)
      window.history.replaceState(null, '', '/quote')
    }
    // 자동 저장 effect 도 빈 상태를 보고 지우지만, 확정 직후 저장분이 남는 순간이 없도록 여기서 먼저 지운다.
    if (engineer) clearDraft(engineer.engineer_id)
  }

  const handleSaveQuote = async (): Promise<SaveResult> => {
    if (!engineer) { toast.error('엔지니어 정보를 불러오는 중입니다'); return { ok: false } }
    // 이니셜이 없으면 번호를 만들 수 없다. 함수도 같은 검사를 하지만 왕복 전에 먼저 막는다.
    if (!initials) { toast.error(NO_INITIALS_MESSAGE); return { ok: false } }
    const ok = runValidation()
    if (!ok) return { ok: false }
    // 견적 날짜는 **오늘을 넘길 수 없다.** 화면이 이미 막지만(달력 max·safeQuoteDate),
    // 번호에 박히는 값이라 저장 직전에 한 번 더 본다. 'YYYYMMDD' 는 글자 비교가 곧 날짜 비교다.
    if (!dateStr || dateStr > todayKST().replace(/-/g, '')) {
      toast.error('견적 날짜는 오늘까지만 고를 수 있습니다')
      return { ok: false }
    }
    // 조건 네 줄의 길이 — **확정 전에** 막는다. 자르지 않고 어느 칸인지 알린다
    // (잘라서 저장하면 반 토막 문구가 고객에게 나간다).
    if (!termsResult.ok) { toast.error(termsResult.message); return { ok: false } }
    // 품목 설명 줄의 줄 수·길이 — 같은 이유로 확정 전에 막는다(자르지 않는다).
    if (!subLinesResult.ok) { toast.error(subLinesResult.message); return { ok: false } }

    setIsSaving(true)
    let linkedRepair = false
    // 저장된 견적 id — PDF 업로드 뒤 pdf_url 을 채우는 데 쓴다.
    let savedQuoteId = 0
    // 실제로 발급된 순번과 번호 — 화면에 보이던 미리보기 번호가 아니라 이것이 저장된다.
    let issuedSeq = 0
    let issuedNo = ''
    try {
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

      // 금액이 있는 행만 저장한다. 예외가 둘 있다.
      //   할인     — 공급가가 음수다(금액 0 인 채로 남은 할인 행은 기록할 것이 없어 저장하지 않는다).
      //   포함사항 — 장비 양식의 「포함사항」은 **금액이 없는 것이 정의**다(견적서에 「-」로 찍힌다).
      //              금액으로만 걸러 내면 견적서에는 나오는데 quote_items 에는 남지 않아
      //              다시쓰기·통계에서 그 줄이 사라진다. 그래서 글자가 있는 포함사항 줄은 통과시킨다.
      //              group_kind 는 장비 양식에서만 채워지므로 다른 두 양식은 종전과 같다.
      // quote_id 는 넣지 않는다 — 함수가 방금 만든 견적의 id 로 채운다(클라이언트 값은 믿지 않는다).
      const keepItem = (r: QuoteRow) =>
        r.supply_price > 0
        || (r.row_kind === 'discount' && r.supply_price < 0)
        || (isEquipForm(formKind) && r.group_kind === 'include' && !!(r.partCode.trim() || r.itemText.trim()))
      const items = rows.filter(keepItem).map(r => ({
        price_list_id: r.selectedItem?.id ?? null,
        part_code: r.partCode.trim() || null,   // 품번 스냅샷(가격표 변경돼도 과거 견적 유지). 직접 입력한 품번도 그대로 저장, 빈 값은 null.
        row_kind: r.row_kind,
        product_name: r.itemText || r.selectedItem?.model_jp || '',
        quantity: r.quantity,
        unit_price_jpy: r.row_kind === 'manual_jpy' ? r.manual_cost_jpy : (r.selectedItem?.cost_jpy ?? null),
        unit_price_krw: r.unit_price,
        supply_amount: r.supply_price,
        tax_amount: r.tax,
        // 줄별 분류 — 매출 줄만. 비웠으면 null 이고 그 뜻은 「견적 분류를 따른다」다.
        category: canSplitRowKind(r.row_kind) ? (r.category || null) : null,
        // 장비 구성 묶음 — **장비 양식일 때만** 저장한다. 양식을 바꿨다가 되돌린 경우
        // 화면에 안 보이는 값이 조용히 저장되는 것을 막는다.
        group_kind: (isEquipForm(formKind) && canGroupRowKind(r.row_kind)) ? (r.group_kind || null) : null,
        cost_amount: r.product_price,
        profit_amount: r.profit,
        // 목표값이 아니라 실현 이익률을 남긴다 — 1,000원 올림·판매단가 직접 입력이 반영된 값이라
        // profit_amount / supply_amount 와 앞뒤가 맞는다(엑셀 분석표가 이 값을 그대로 쓴다).
        profit_rate: r.realized_profit_rate,
        exchange_rate: r.exchange_rate || exchangeRate,
        tariff_rate: r.tariff_rate,
        // 품명 아래 설명 줄 — **줄이 없으면 null**(저장하지 않는다 = 줄 없음).
        // 확정 때 PDF 가 그리는 값과 같은 정규화 결과다(normalizedSubLines).
        sub_lines: normalizedSubLines(r),
        // 수동입력 줄의 모델 — 적지 않았으면 null.
        // ⚠ quote_items 에 아직 이 칸이 없다. create_quote 가 품목을
        //   jsonb_populate_recordset 으로 받으므로 **지금은 조용히 버려진다**(예외는 나지 않는다).
        //   quote_items_model_schema.sql 의 단계 1·2 를 실행하면 그때부터 그대로 저장된다.
        model_name: r.row_kind === 'manual_jpy' ? (r.manual_model.trim() || null) : null,
      }))

      // 부대비용(내부 관리용). 견적 합계·PDF 와 무관하게 quote_expenses 에만 기록한다.
      // unit_price 는 저장 시점 스냅샷이므로 프리셋 재조회 없이 화면 값을 그대로 넣는다.
      const expenseRows = expenses
        .filter(e => e.item_name.trim() && e.amount > 0)
        .map(e => ({
          item_name: e.item_name.trim(),
          unit_price: e.unit_price,
          headcount: e.headcount,
          days: e.days,
          amount: e.amount,
        }))

      // 견적·품목·부대비용·수리 연결을 DB 함수 하나로 묶는다(전부 한 트랜잭션).
      // 예전에는 여기서 세 번 나눠 insert 해, 중간에 실패하면 품목 없는 견적이 남았다.
      // 번호 채번·조립과 created_by, 자식 행의 quote_id 는 함수가 정한다 — 보내지 않는다.
      const { data, error } = await supabase.rpc('create_quote', {
        p_date: dateStr,
        p_quote: {
          customer_id: isDealer ? euCustomerId : customerId,
          dealer_id: isDealer ? customerId : null,
          opportunity_id: opportunityId,
          // 납기 칸이 있던 자리 — 조건 1번 「납품일정」 값을 담는다(발주·결재 검토표가 읽는다).
          // termsResult 는 조건 블록이 꺼져 있으면 기본값(「담당자와 협의」)을 돌려준다.
          delivery_info: termsResult.ok ? termsResult.terms.delivery_schedule : DEFAULT_TERMS.delivery_schedule,
          // 실적 귀속자. 대필이 아니면 작성자와 같다(대필 자격은 함수가 다시 본다).
          engineer_id: onBehalf ? onBehalf.engineer_id : engineer.engineer_id,
          recipient: receiver,
          note: finalRemarksForPDF,
          quote_type: quoteType,
          // 견적 분류 — 빈 글자는 null 로 눕힌다(확정 전 검증이 비어 있는 채로는 못 오게 막는다).
          category: category || null,
          // 견적서 양식 — 같은 규칙. null 은 「기존 양식」이라는 뜻이 되므로 비워 저장하지 않는다.
          form_kind: formKind || null,
          status: initialStatus,
          total_supply: totalSupply,
          total_tax: totalTax,
          total_amount: totalAmount,
          total_cost: totalCost,
          total_profit: totalProfit,
          profit_rate: parseFloat(totalProfitRate.toFixed(2)),
          // 조건 네 줄 — **모두 기본이면 null**(저장하지 않는다 = 기본). 확정 때 PDF 와 같은 값이다.
          terms: termsResult.ok ? termsResult.stored : null,
        },
        p_items: items,
        p_expenses: expenseRows,
        p_repair_id: repairId ?? null,
      })
      if (error) throw error
      const saved = (data as CreateQuoteRow[] | null)?.[0]
      if (!saved?.quote_id) throw new Error('견적을 저장하지 못했습니다')
      savedQuoteId = Number(saved.quote_id)
      issuedNo = saved.quote_number
      issuedSeq = saved.seq

      // 저장이 전부 끝난 뒤에 지운다. 실패하면 아무것도 저장되지 않으므로 초안을 남겨 이어 쓰게 한다.
      clearDraft(engineer.engineer_id)
      // 동시 확정으로 미리보기와 다른 번호가 나왔으면 그 사실을 함께 알린다.
      toast.success(issuedNo === quoteNo
        ? `견적서 ${issuedNo} 확정 완료`
        : `견적서 ${issuedNo} 확정 완료 · 견적번호가 ${issuedNo} 로 발급되었습니다`)

      // 대필이면 실적 담당자에게 알린다. 자기가 쓰지 않은 견적이 자기 실적에 잡히기 때문이다.
      // 대필 여부·수신자는 서버가 견적 행을 보고 다시 판정하므로 여기서는 부르기만 한다.
      // 알림이 실패해도 견적 확정은 성공이다(라우트 안에서 콘솔에만 남는다).
      if (onBehalf) await notifyOnBehalf(savedQuoteId)

      // 수리 건 연결은 함수가 같은 트랜잭션에서 끝냈다. 결과만 안내한다.
      //   false = 그 수리 건이 없어 연결하지 못함 / null = 수리 건에서 온 견적이 아님(안내 없음)
      if (saved.repair_linked === false) {
        toast.error('견적서는 저장됐지만 수리 건 연결에 실패했습니다. 수리 목록에서 수동으로 연결해주세요.')
      } else if (saved.repair_linked === true) {
        toast.success(`수리 건 #${repairId} 에 견적서가 연결되었습니다`)
        linkedRepair = true
      }
    } catch (e) {
      // 함수가 던지는 예외 메시지는 사용자에게 그대로 보여도 되는 한국어다
      // ('견적 작성 권한이 없습니다' 등). 코드가 있으면 괄호로 덧붙인다.
      const err = e as { code?: string; message?: string } | null
      console.error('[quote] 저장 실패', { dateStr, engineerId: engineer.engineer_id, error: e })
      toast.error(`${err?.message || '저장 중 오류가 발생했습니다'}${err?.code ? ` (${err.code})` : ''}`)
      setIsSaving(false)
      return { ok: false }
    }
    setIsSaving(false)
    return { ok: true, linked: linkedRepair, quoteId: savedQuoteId, quoteNo: issuedNo, seq: issuedSeq }
  }

  /**
   * 확정 — 저장 → PDF 저장·내려받기.
   *
   * **전자결재 기안을 만들지 않는다.** 확정과 동시에 결재를 올리던 단계는 걷어냈다(결재 자체는
   * 그대로 돈다 — 결재함·승인·반려·삭제 요청 결재는 손대지 않았다).
   *   · 번호는 create_quote 가 발급한다. 채번은 롤백되지 않으므로 저장이 성공하면 끝이다.
   *   · PDF 는 만들어 스토리지에 올리고 **그 자리에서 내려받는다.** 날짜 자리에 확정일(KST)이
   *     찍힌 고객 발송용 문서다 — 급한 건을 바로 보낼 수 있어야 한다는 것이 확정된 방침이다.
   */
  const runConfirm = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    // 저장이 끝난 뒤의 실패(PDF 생성 등)를 저장 실패와 가르는 근거. 저장 성공 시에만 채워진다.
    let saved: Extract<SaveResult, { ok: true }> | null = null
    try {
      const snapshotCompany = company
      const snapshotReceiver = receiver
      // 설명 줄은 확정 저장과 **같은 정규화 결과**를 쓴다 — 빈 줄이 PDF 에만 남지 않게.
      const snapshotRows = withNormalizedSubLines(rows)
      const snapshotRemarks = finalRemarksForPDF
      const result = await handleSaveQuote()
      // 저장이 막히면 여기서 끝낸다 — PDF 도 만들지 않고 미리보기 번호도 그대로 둔다.
      if (!result.ok) return
      saved = result

      // PDF 는 실제로 발급·저장된 번호로 만든다(화면에 보이던 미리보기 번호가 아니다).
      await handleDownloadPDF(
        snapshotCompany, snapshotReceiver, snapshotRows, snapshotRemarks,
        result.quoteNo, result.quoteId,
      )
      // 다음 미리보기는 방금 발급된 순번의 다음이다.
      setPreviewSeq(result.seq + 1)
      setShowConfirmModal(false)
      // 수리 건 연결이 됐으면 PDF 생성 후 수리 목록으로 이동
      if (result.linked) { router.push('/repair'); return }
      // 이어서 다음 견적을 쓸 수 있게 화면을 비운다(번호는 위에서 이미 다음 것으로 올렸다).
      resetForm()
    } catch (e) {
      console.error('[quote] 확정 처리 실패', { saved, error: e })
      if (!saved) {
        // 저장 전에 난 예외 — 아무것도 저장되지 않았다. 모달을 열어 둔 채 다시 시도할 수 있게 한다.
        toast.error('저장 중 오류가 발생했습니다')
        return
      }
      // 견적은 이미 저장됐다. 모달을 그대로 두면 사용자가 다시 눌러 같은 내용이 새 번호로 또 저장되므로,
      // 성공했을 때와 똑같이 번호를 올리고 모달을 닫고 화면을 비운다(PDF 만 없는 상태로 남는다).
      toast.error(`견적 ${saved.quoteNo} 은 저장되었습니다. PDF 생성에 실패했습니다 — 다시 확정하지 마시고 관리자에게 알려주세요.`)
      setPreviewSeq(saved.seq + 1)
      setShowConfirmModal(false)
      if (saved.linked) { router.push('/repair'); return }
      resetForm()
    } finally {
      setIsSubmitting(false)
    }
  }


  return {
    isSaving, showConfirmModal, setShowConfirmModal, isSubmitting,
    handleDownloadPDF, resetForm, handleSaveQuote, runConfirm,
  }
}
