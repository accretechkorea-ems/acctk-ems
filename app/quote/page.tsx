'use client'

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { loadMe } from '@/lib/appData/me'
import { useToast } from '@/components/common/Toast'
import { useFieldErrors, FieldError } from '@/components/common/fieldErrors'
import { usePageGuard } from '@/hooks/usePageGuard'
import { useQuoteCustomer } from '@/hooks/quote/useQuoteCustomer'
import { useQuoteCategories, activeQuoteCategories } from '@/lib/quoteCategories'
import { useQuoteRows } from '@/hooks/quote/useQuoteRows'
import { useQuotePrefill } from '@/hooks/quote/useQuotePrefill'
import { useQuoteDraftSync } from '@/hooks/quote/useQuoteDraftSync'
import { useQuoteSubmit } from '@/hooks/quote/useQuoteSubmit'
import AccessGate from '@/components/common/AccessGate'
import { useConfirm } from '@/components/common/ConfirmDialog'
import type { Engineer, QuoteRow, RateMeta } from './types'
import { calcRow, calcTotals } from './calc'
import { useDebounce } from './useDebounce'
import ProfitPanel from './ProfitPanel'
import CustomerCard from '@/components/quote/CustomerCard'
import PriceGuidePopup from '@/components/quote/PriceGuidePopup'
import RowAddButtons from '@/components/quote/RowAddButtons'
import EquipConfigLauncher from '@/components/quote/equip/EquipConfigLauncher'
import QuotePreviewPane from '@/components/quote/QuotePreviewPane'
import ConfirmQuoteModal from '@/components/quote/ConfirmQuoteModal'
import QuoteItemRow from './QuoteItemRow'
import { useRecentSales } from '@/hooks/quote/useRecentSales'
import { Z } from '@/lib/zIndex'
import { defaultTermsFor, normalizeTerms, termKeysFor, type SetTerms, type Terms } from '@/lib/quoteTerms'
import { defaultRemarksFor } from '@/lib/quoteRemarks'
import { normalizeSubLines } from '@/lib/quoteSubLines'

/**
 * 비고 기본 문구. 내용은 그대로 두고, 사용자가 손댔는지 비교하려고 상수로 뺐다.
 */

// 양식별 기본 문구는 lib/quoteRemarks.ts 에 있다(아래 defaultRemarks).


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
import { nowHmKST, todayKST } from '@/lib/date'
import { RATE_SOURCE } from '@/lib/exchangeRate'
import { loadQuoteUserDefaults } from '@/lib/quoteUserDefaults'
import {
  compactYmd, differsInMonth, displayYmd, isBackdated, monthOf, safeQuoteDate,
} from '@/lib/quoteDate'

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
  // 포캐스트 화면의 「견적 쓰기」가 보내는 값 — 그 안건의 고객·영업기회를 미리 채운다.
  const oppRaw = paramsCleared ? null : searchParams.get('opportunity')
  const prefillOpportunityId = oppRaw && /^\d+$/.test(oppRaw) ? Number(oppRaw) : null
  // 주소로 들어온 프리필이 있으면 그쪽이 우선이다 — 임시저장분은 묻지 않고 버린다.
  const hasUrlPrefill = repairId != null || onBehalfId != null || duplicateId != null || prefillOpportunityId != null
  const { loading: guardLoading, authorized } = usePageGuard()
  const toast = useToast()
  const { errors, setErrors, clearError, validate } = useFieldErrors<'category' | 'form' | 'company' | 'eu' | 'items' | 'expenses'>()
  // 줄별 분류를 끌 때 확인창을 띄운다(alert·confirm 대신 공용 다이얼로그).
  const confirmDialog = useConfirm()
  const [isClient, setIsClient] = useState(false)

  // ── 견적 분류 ──
  // 목록을 **가장 먼저** 읽는다. 아래 useQuoteRows 가 줄별 선택칸의 후보로 받아 쓰기 때문이다.
  // 이 훅의 effect 가 맨 앞에 끼지만, 기존 effect 들의 **상대 순서**는 그대로다.
  const { categories: allCategories, loading: categoriesLoading } = useQuoteCategories()
  // 새 견적은 활성 분류만 고른다(비활성은 이미 쓴 견적의 표기로만 남는다).
  const activeCategories = useMemo(() => activeQuoteCategories(allCategories), [allCategories])
  // 고른 견적 분류(quotes.category). 빈 글자는 미선택이고, 그때는 확정이 막힌다.
  const [category, setCategory] = useState('')
  // 「분류 나누기」 — 켜면 각 품목 줄에 분류 선택칸이 생긴다. 저장되지 않는 화면 상태다.
  const [lineSplitOn, setLineSplitOn] = useState(false)

  // ── 견적서 양식(quotes.form_kind) ──
  // 이 값 하나가 PDF 의 열·그룹 행·조건(보증)·합계 모양을 모두 가른다(lib/quoteForms.ts).
  // 빈 글자는 미선택이고, 그때는 분류와 같이 확정이 막힌다.
  const [formKind, setFormKind] = useState('')

  const [engineer, setEngineer] = useState<Engineer | null>(null)
  // 대필 대상. 서버가 승인한 뒤에만 채워진다(null 이면 평소대로 본인 견적).
  const [onBehalf, setOnBehalf] = useState<OnBehalfAssignee | null>(null)
  const [exchangeRate, setExchangeRate] = useState<number>(0)
  // 임시저장·다시쓰기 복원은 비동기라, 값을 넣는 시점의 최신 환율을 참조로 읽는다.
  // (환율이 아직 0 이면 아래 [exchangeRate] 효과가 도착 후 전 행을 다시 계산한다.)
  const rateRef = useRef(0)
  // 지금 보이는 환율이 어디서 온 값인가(app/quote/types.ts 의 RateMeta). 아직 아무것도
  // 못 받았으면 null — 그때는 화면이 「환율 로딩중」만 보여 준다.
  const [rateMeta, setRateMeta] = useState<RateMeta | null>(null)
  /**
   * 저장된 내 설정 — **분류를 고를 때** 읽어 둔 관세율·이익률이고, 이후 추가되는 줄의
   * 출발값이다(RowAddButtons → createRow). 없으면 null 이고 종전 기본값으로 간다.
   */
  const [savedDefaults, setSavedDefaults] = useState<{ tariffRate: number | null; marginRate: number | null } | null>(null)
  /** 그 줄을 실제로 적용했는가 — 환율 옆 「내 설정 불러옴」 표시의 조건이다. */
  const [savedApplied, setSavedApplied] = useState(false)
  /**
   * 마지막으로 요청한 분류. 설정을 읽는 사이에 분류를 또 바꾸면 **늦게 온 답을 버린다** —
   * 그러지 않으면 먼저 고른 분류의 환율이 나중에 도착해 화면을 덮는다.
   */
  const savedReqRef = useRef('')
  const [rateLoading, setRateLoading] = useState(false)

  const [receiver, setReceiver] = useState('')
  // 비고 — **손댄 글자만** 상태로 들고, 손대지 않았으면 양식의 기본 문구를 그대로 보여 준다.
  // null = 아직 손대지 않았다. 이렇게 두면 양식을 바꿀 때 기본 문구가 **저절로** 따라오고,
  // effect 로 상태를 덮어쓰지 않아도 된다(덮어쓰면 사람이 적던 글자를 지울 위험이 생긴다).
  const [remarksDraft, setRemarksDraft] = useState<string | null>(null)
  // 비고는 기본 문구가 채워져 있고 고칠 일이 드물어 접어서 시작한다(내용은 계속 마운트돼 있다).
  const [remarksOpen, setRemarksOpen] = useState(false)
  // 견적서 PDF 하단 서명란 표시 여부. 저장하지 않는 화면 상태라 견적을 다시 열면 항상 꺼진 상태로 시작한다.
  const [showSignature, setShowSignature] = useState(false)
  // ── 조건 네 줄 ──
  // termsOpen 이 꺼져 있으면 **기본값으로 그린다**(아래 pdfTerms). 체크를 풀면 적어 둔 값도 버린다
  // — 「닫아 두었는데 저장은 바뀐 값으로 됐다」가 되지 않게 한다.
  const [termsOpen, setTermsOpen] = useState(false)
  // 비고와 같은 규칙이다 — **손댄 값만** 상태로 들고(null = 손대지 않음), 손대지 않았으면
  // 고른 양식의 기본 문구를 그대로 본다. 그래서 양식을 바꾸면 기본값이 저절로 따라온다.
  const [termsDraft, setTermsDraft] = useState<Terms | null>(null)
  // useMemo 로 **정체를 유지한다** — 렌더마다 새 객체를 만들면 미리보기 디바운스(useDebounce)가
  // 매 렌더 다시 걸리고, 이 값을 의존성으로 쓰는 콜백도 매번 새로 만들어진다.
  const defaultTerms = useMemo(() => defaultTermsFor(formKind), [formKind])
  const terms = termsDraft ?? defaultTerms
  const setTerms = useCallback<SetTerms>(v => {
    setTermsDraft(prev => (typeof v === 'function' ? v(prev ?? defaultTerms) : v))
  }, [defaultTerms])

  // 품목 행 — 가격표 검색·선택, 행 수정, 설명 줄, 부대비용 헬퍼. 상태·함수를 그대로 옮긴 훅이다.
  // 이 훅은 effect 를 두지 않는다 — rows 와 얽힌 effect 셋은 순서 때문에 아래에 그대로 남겼다.
  const {
    rows, setRows,
    setExpensePresets, setPresetError,
    setSearchQuery, setSearchResults, setSearchOpen,
    setEditingProfitRate, setProfitRateInput,
    serviceRow, discountRow, expenses,
    clearAllRowCategories, applyCategoryDefaults, applySavedTariff,
    ctx: rowsCtx, actions: rowsActions,
  } = useQuoteRows({ supabase, exchangeRate, terms, setTerms, setTermsOpen, categories: activeCategories, lineSplitOn, formKind })
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

  // 견적 날짜 — 기본은 오늘(한국)이고 **지난 날짜로도 쓸 수 있다**(미래는 못 고른다).
  // 번호·작성일·실적 달이 모두 이 날짜를 따른다 — create_quote(p_date) 가 그 날짜의 다음
  // 순번을 주고(next_quote_seq), 실제로 넣은 시각은 quotes.created_at 에 남는다.
  // 날짜는 한국 기준으로만 다룬다 — 해외에서 열어도 번호·표시가 어긋나지 않게(lib/quoteDate.ts).
  const todayYmd = todayKST()
  const [quoteDate, setQuoteDate] = useState(() => todayKST())
  /** 날짜 칸 — 미래·망가진 값은 **오늘로 떨어뜨린다**(달력 max 와 같은 규칙을 값으로도 막는다). */
  const changeQuoteDate = (v: string) => setQuoteDate(safeQuoteDate(v, todayYmd))
  const dateStr = compactYmd(quoteDate)
  const dateDisplay = displayYmd(quoteDate)

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

  // 비고 — 고른 양식의 기본 문구. 손댔으면(remarksDraft) 그 글자가 이긴다.
  const defaultRemarks = defaultRemarksFor(formKind)
  const remarks = remarksDraft ?? defaultRemarks
  /** 비고를 **기본 문구로 되돌린다**(확정 뒤 초기화에서 쓴다). */
  const setRemarks = (v: string | null) => setRemarksDraft(v)

  // 비고 본문 — **납기 줄을 넣지 않는다.** 납기는 조건 1번 「납품일정」 한 곳에서만 적고,
  // 그 값이 quotes.delivery_info 로 저장되어 발주·결재 검토표가 쓴다(납기 칸은 없앴다).
  // 「최근 판매」 — 같은 고객사에 같은 품번을 마지막으로 판 단가(본사 엑셀의 판매실적가).
  // 품목 줄의 고른 품목과 지금 떠 있는 검색 후보를 **한 번에** 묻는다.
  const saleKeys = useMemo(() => [
    ...rows.map(r => ({ priceListId: r.selectedItem?.id ?? null, partCode: r.partCode || null })),
    ...Object.values(rowsCtx.searchResults).flat().map(it => ({ priceListId: it.id, partCode: it.item_code })),
  ], [rows, rowsCtx.searchResults])
  const recentSale = useRecentSales(supabase, customerId, saleKeys)

  // 영업이익 하한 미만일 때 적는 사유 — quotes.note 끝에 한 줄로 저장된다.
  // **PDF 비고에는 넣지 않는다**(lib/quoteOperatingNote.ts).
  const [operatingReason, setOperatingReason] = useState('')

  const finalRemarksForPDF = (() => {
    const parts: string[] = []
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
  // 양식별로 **보이는 칸만** 본다 — 장비가 아니면 보증을 저장하지 않는다.
  const termsResult = normalizeTerms(termsOpen ? terms : null, termKeysFor(formKind), defaultTerms)
  /** 미리보기에 넘길 값 — 길이 초과 중이면 그 칸만 기본값으로 그린다(미리보기를 멈추지 않는다). */
  const previewTerms = (() => {
    const r = normalizeTerms(debouncedTermsOpen ? debouncedTerms : null, termKeysFor(formKind), defaultTerms)
    return r.ok ? r.terms : defaultTerms
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





  // 저장 가능 여부 검증. 확정 모달을 열 때와 실제 저장 직전에 같은 규칙을 쓴다.
  // 고객사는 반드시 등록된 업체를 골라야 한다(customer_id 기준).
  // 직접 친 상호는 quotes 에 저장되는 곳이 없어 PDF 에만 남고, 실적·발주·엑셀에서는 빈칸이 된다.
  //   · 직판   : customerId 필수
  //   · 대리점 : customerId(대리점) + euCustomerId(최종 사용 업체) 둘 다 필수
  //              (저장 시 customer_id 에는 E.U 가 들어간다 — 거래 이력이 붙는 곳이 최종 사용 업체이므로)
  // 품목 금액은 배열이지만 "적어도 한 품목에 금액" 이라는 집계 규칙이라 단일 key(items) 로 처리한다.
  // 부대비용은 빈 행(항목명 미선택)은 조용히 무시하고, 항목명만 고른 채 금액이 0 인 행만 막는다.
  // 분류를 안 골랐으면 확정을 막는다. 품목 입력은 막지 않는다 — 금액을 먼저 잡아 보는
  // 흐름을 끊지 않으려고 **확정 버튼 한 곳에서만** 막는다.
  /**
   * 견적 분류 바꾸기 — 상태를 바꾸고, **손대지 않은 품목 줄**의 이익률 기본값도 따라가게 한다
   * (TSE 60 · 그 밖 40 — lib/quoteProfit.ts). 사람이 고친 줄은 그대로다.
   */
  const changeCategory = (v: string) => {
    setCategory(v)
    applyCategoryDefaults(v || null)
    void loadMyDefaults(v)
  }

  /**
   * 그 분류로 **내가 마지막에 확정한** 환율·관세·이익률을 들여온다(quote_user_defaults).
   *
   * 적용 범위
   *   · 환율      — 화면 환율을 그 값으로 바꾼다(RateMeta 'saved'). 새로고침을 누르면
   *                 종전대로 API 값이 이것을 덮는다.
   *   · 이익률    — **손대지 않은** 품목 줄 + 이후 추가되는 줄(applyCategoryDefaults).
   *   · 관세율    — **아직 비어 있는** 줄 + 이후 추가되는 줄(applySavedTariff).
   *     이미 품목·금액이 들어간 줄은 건드리지 않는다.
   *
   * 하지 않는 때 — 분류를 비웠을 때, 그리고 **다시쓰기**(기존 견적 복제)다. 다시쓰기는
   * 그 견적의 값이 정본이고, 사람이 분류를 고른 것이 아니라 복제가 채운 것이다
   * (복제·임시저장 되살리기는 setCategory 를 직접 부르므로 이 함수를 지나지 않는다).
   */
  const loadMyDefaults = async (v: string) => {
    savedReqRef.current = v
    if (!v || duplicateId != null) { setSavedDefaults(null); setSavedApplied(false); return }
    const d = await loadQuoteUserDefaults(supabase, engineer?.email, v)
    // 그 사이에 분류가 또 바뀌었으면 이 답은 버린다.
    if (savedReqRef.current !== v) return
    if (!d) { setSavedDefaults(null); setSavedApplied(false); return }
    setSavedDefaults({ tariffRate: d.tariffRate, marginRate: d.marginRate })
    setSavedApplied(true)
    if (d.marginRate != null) applyCategoryDefaults(v, d.marginRate)
    applySavedTariff(d.tariffRate)
    if (d.exchangeRate != null) {
      setExchangeRate(d.exchangeRate)
      setRateMeta({ kind: 'saved', savedAt: d.savedAt })
    }
  }

  const categoryMissing = category.trim() === ''
  // 양식도 같은 규칙이다 — 고르기 전에는 확정만 막는다.
  const formMissing = formKind.trim() === ''
  // 줄별 분류가 들어간 줄 수 — 「분류 나누기」 옆에 보여 주고, 끌 때 확인창 여부를 가른다.
  const splitRowCount = rows.filter(r => r.category != null).length

  /**
   * 「분류 나누기」 켜고 끄기.
   * 끌 때 이미 지정한 줄이 있으면 확인을 받는다 — 끄면 그 값들이 전부 사라지기 때문이다
   * (저장은 null 로 들어가고, 통계는 견적 분류로 떨어진다).
   */
  const toggleLineSplit = async () => {
    if (!lineSplitOn) { setLineSplitOn(true); return }
    if (splitRowCount > 0) {
      const ok = await confirmDialog({
        title: '줄별 분류 지우기',
        message: `${splitRowCount}개 줄에 지정한 분류가 사라집니다. 모든 줄이 견적 분류를 따릅니다.`,
        confirmText: '끄고 지우기',
        variant: 'danger',
      })
      if (!ok) return
    }
    clearAllRowCategories()
    setLineSplitOn(false)
  }

  const runValidation = () => validate({
    category: categoryMissing ? '견적 분류를 선택해주세요' : null,
    form: formMissing ? '견적서 양식을 선택해주세요' : null,
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
    company, receiver, finalRemarksForPDF, operatingReason, showSignature,
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
  })

  useEffect(() => { setIsClient(true) }, [])

  useEffect(() => {
    const f = async () => {
      // 본인은 공통 층에서 받는다 — 사이드바가 읽은 그 값이다(조회 0회).
      const { me } = await loadMe()
      if (me) setEngineer({
        engineer_id: me.engineer_id,
        name: me.name ?? '',
        position: me.position,
        email: me.email,
        initials: me.initials,
        tel: me.tel,
      })
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
    receiver, remarks, showSignature, termsOpen, terms, rows,
    quoteDate, setQuoteDate,
    category, formKind, setCategory, setFormKind,
    debouncedRows, debouncedCompany, debouncedReceiver, debouncedFinalRemarks,
    setCompany, setCustomerId, setSelectedCustomer, setCustomerQuery, setIsDealer,
    setEuCustomerId, setSelectedEU, setEuQuery, resolveEuParent,
    setReceiver, setRemarks, setShowSignature, setTermsOpen, setTerms, setRows,
    loadOpportunities, setOpportunityId, setOnBehalf,
  })

  // 주소 파라미터 프리필 — ?duplicate / ?on_behalf / ?repair_id. effect 셋을 그대로 옮긴 훅이다.
  // 원본에서는 다시쓰기와 대필 사이에 아래 「부대비용 프리셋」 effect 가 끼어 있었다(그것만 뒤로 밀렸다).
  useQuotePrefill({
    supabase, toast, searchParams, rateRef,
    duplicateId, onBehalfId, repairId, prefillOpportunityId, engineer,
    setOnBehalf, setRows, setIsDealer, setCustomerId, setEuCustomerId,
    setSelectedCustomer, setCustomerQuery, setCompany, setSelectedEU, setEuQuery,
    resolveEuParent, setReceiver, setTermsOpen, setTerms, setRemarks, setOperatingReason,
    setCategory, setFormKind, setLineSplitOn,
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


  /**
   * 환율을 들여온다.
   *
   * force — **새로고침 버튼이 누른 경우**다. 저장된 값을 보지 않고 곧장 API 로 간다.
   *   누른 뜻은 「지금 값을 받아라」이므로 캐시 분기를 건너뛴다. 오늘 줄이 있으면
   *   그만 돌아가던 때에는, 손으로 넣은 환율이 캐시에 섞여 있어(그때는 그것도 저장했다)
   *   새로고침을 눌러도 방금 자기가 넣은 값이 되돌아왔다 — 실시간 환율로는 못 갔다.
   *
   * 화면 처음 열 때(force 아님)는 오늘 저장된 값을 그대로 쓴다 — API 쿼터를 아낀다.
   * 그 표에는 이제 **API 가 준 값만** 들어가므로(handleRateChange 는 쓰지 않는다) 출처를
   * 기관 이름으로 적는다. 받은 시각은 표에 없어 화면이 「저장값」으로 닫는다.
   */
  const fetchRate = useCallback(async (opts?: { force?: boolean }) => {
    const force = opts?.force === true
    setRateLoading(true)
    try {
      const { data: cached } = await supabase.from('exchange_rate').select('*').order('id', { ascending: false }).limit(1).single()
      const todayStr = todayKST()

      // 오늘 날짜 캐시가 있으면 바로 사용 — 단, 새로고침을 누른 때는 보지 않는다.
      if (!force && cached && cached.updated_at === todayStr) {
        setExchangeRate(Number(cached.rate))
        setRateMeta({ kind: 'cache', source: RATE_SOURCE, baseDate: String(cached.updated_at) })
        setRateLoading(false); return
      }

      // 외부 API 호출
      try {
        const res = await fetch('/api/exchange-rate')
        const json = await res.json()
        const jpy = json.jpy
        if (jpy && jpy.deal_bas_r) {
          const rate = parseFloat(String(jpy.deal_bas_r).replace(/,/g, '')) / 100
          // 기준일 — API 가 'YYYYMMDD' 로 준다. 모양이 아니면 오늘로 적는다.
          const raw = typeof json.date === 'string' ? json.date : ''
          const baseDate = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : todayStr
          setExchangeRate(rate)
          setRateMeta({
            kind: 'api',
            // 이름은 API 가 보내 준 것을 쓴다. 기관을 바꾸면 그 라우트만 고치면 된다.
            source: typeof json.source === 'string' && json.source ? json.source : '환율 API',
            baseDate,
            fetchedAt: nowHmKST(),
          })
          await supabase.from('exchange_rate').insert([{ rate, updated_at: todayStr }])
          setRateLoading(false); return
        }
      } catch { /* API 실패 — 아래에서 갈라진다 */ }

      if (force) {
        // 누른 사람에게 **못 받았다고 말한다.** 보이는 값은 건드리지 않는다 — 저장된
        // 값으로 조용히 바꾸면 직접 넣은 환율이 사라지고, 그것도 알리지 않은 셈이 된다.
        toast.error('실시간 환율을 받지 못했습니다 — 화면의 환율을 그대로 둡니다')
      } else if (cached && cached.rate) {
        // 처음 열 때 API 가 안 되면 저장된 가장 최근 값으로라도 시작한다(0 보다 낫다).
        setExchangeRate(Number(cached.rate))
        setRateMeta({ kind: 'cache', source: RATE_SOURCE, baseDate: String(cached.updated_at) })
      }
    } catch (e) { console.error(e) }
    setRateLoading(false)
  // toast 는 <ToastProvider> 가 useMemo 로 들고 있는 한 덩어리라 바뀌지 않는다 —
  // 아래 mount 효과가 이 함수를 의존해도 다시 돌지 않는다(components/common/Toast.tsx).
  }, [toast])

  useEffect(() => { fetchRate() }, [fetchRate])
  useEffect(() => { if (!exchangeRate) return; setRows(prev => prev.map(r => calcRow(r, exchangeRate))) }, [exchangeRate]) // eslint-disable-line react-hooks/exhaustive-deps
  // 어느 품목이든 금액이 생기면 집계 에러(items) 를 즉시 해제한다.
  useEffect(() => { if (rows.some(r => r.supply_price > 0)) clearError('items') }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  // 금액 0 인 부대비용 행이 모두 해소되면 에러를 즉시 해제한다(부대비용은 rows 안에 있다).
  useEffect(() => {
    const list = rows.find(r => r.row_kind === 'service')?.expenses ?? []
    if (!list.some(e => e.item_name.trim() && e.amount <= 0)) clearError('expenses')
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 환율을 손으로 넣었다 — **이 견적에서만** 쓴다.
   *
   * exchange_rate 표에 쓰지 않는다. 그 표는 모두가 공유하는 캐시고, 거기에 넣으면
   * 오늘 견적 화면을 여는 **다른 사람**도 그 값으로 시작했다. 한 건을 본사 양식에
   * 맞추려고 넣은 숫자가 회사의 오늘 환율이 되는 셈이다(2026-10-28 에 실제로 그랬다 —
   * 매매기준율이 8.383 인 날 캐시의 최신 줄이 9.5 였다).
   *
   * 그래서 exchange_rate 에 쓰는 곳은 **API 조회가 성공한 한 곳**뿐이다(fetchRate).
   * 대신 손으로 넣은 값은 화면을 새로 열면 남지 않는다 — 그 견적을 임시저장하면
   * 줄마다 exchange_rate 가 함께 저장되므로(useQuoteSubmit) 견적 자체는 그대로다.
   */
  const handleRateChange = useCallback((rate: number) => {
    setExchangeRate(rate)
    // 직접 넣은 값이라고 적는다 — 화면이 「직접 입력」으로 보여 준다.
    setRateMeta({ kind: 'manual' })
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

          {/* 묶음 네 개는 여기서 만든다. CustomerCard 는 하나뿐이고 React.memo 를 씌우지
              않았으므로 정체를 유지해도 렌더 횟수가 달라지지 않는다 — useMemo 를 두지 않는다
              (행 카드는 수십 개가 되므로 그쪽만 useQuoteRows 에서 안정화했다). */}
          <CustomerCard
            errors={errors}
            clearError={clearError}
            category={{
              value: category, setValue: changeCategory,
              categories: activeCategories, loading: categoriesLoading,
              lineSplitOn, onToggleLineSplit: () => { void toggleLineSplit() }, splitRowCount,
              formKind, setFormKind,
            }}
            customer={{
              selectedCustomer, customerQuery, customerResults, customerSearchOpen, setCustomerSearchOpen,
              customerKeys, customerSearchRef, customerListRef,
              handleCustomerSearch, handleCustomerSelect, handleCustomerClear,
              prefillNotice, setPrefillNotice, customerId, isDealer, setIsDealer,
            }}
            eu={{
              euCustomerId, euQuery, euResults, euSearchOpen, setEuSearchOpen, euKeys,
              euSearchRef, euListRef, selectedEU, euParentName,
              handleEUSearch, handleEUSelect, handleEUClear,
            }}
            opportunity={{ loadOpportunities, opportunities, opportunityId, setOpportunityId }}
            doc={{
              receiver, setReceiver,
              remarks, setRemarks, remarksOpen, setRemarksOpen, defaultRemarks,
              showSignature, setShowSignature, termsOpen, setTermsOpen, terms, setTerms,
            }}
          />


       <div style={{ position: 'relative', overflow: 'hidden' }}>
            {[-1, 0, 1, 2].map(i => (
              <div key={i} style={{ position: 'absolute', top: `${i * 140 + 60}px`, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: Z.decor, transform: 'rotate(-20deg)', opacity: 0.05 }}>
                <span style={{ fontSize: 42, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>{engineerName}</span>
              </div>
            ))}
            <ProfitPanel rows={rows} exchangeRate={exchangeRate} rateMeta={rateMeta} rateLoading={rateLoading} onFetchRate={() => { void fetchRate({ force: true }) }} onRateChange={handleRateChange} category={category}
              savedDefaultsApplied={savedApplied && category !== ''}
              operatingReason={operatingReason} setOperatingReason={setOperatingReason} />
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
              {/* 장비 구성 선택 — 장비 양식에서만 나온다(그 밖의 양식에서는 아무것도 그리지 않는다) */}
              <EquipConfigLauncher
                formKind={formKind}
                category={category}
                exchangeRate={exchangeRate}
                setExchangeRate={setExchangeRate}
                rows={rows}
                setRows={setRows}
                myId={engineer?.engineer_id ?? null}
                myName={[engineer?.name, engineer?.position].filter(Boolean).join(' ')}
              />
              {/* 마진/정도검사 가이드 버튼 — 오른쪽 끝 */}
              <PriceGuidePopup
                open={showPriceGuide}
                setOpen={setShowPriceGuide}
                containerRef={priceGuideRef}
              />
            </div>

            {rows.map((row, rowIdx) => (
              <QuoteItemRow
                key={row.id}
                row={row}
                rowIdx={rowIdx}
                errors={errors}
                ctx={rowsCtx}
                actions={rowsActions}
                recentSale={recentSale}
              />
            ))}

            {/* rowDefaults — 분류를 비우면 저장된 설정도 쓰지 않는다(확정 뒤 초기화가 분류를 비운다). */}
            <RowAddButtons
              setRows={setRows}
              category={category}
              rowDefaults={category ? savedDefaults : null}
              serviceRow={serviceRow}
              discountRow={discountRow}
            />
            <FieldError message={errors.items} style={{ marginTop: 8 }} />
          </div>
        </div>

        <QuotePreviewPane
          isClient={isClient}
          missingInitials={missingInitials}
          seqLoadError={seqLoadError}
          quoteNo={quoteNo}
          quoteDate={quoteDate}
          onQuoteDate={changeQuoteDate}
          maxQuoteDate={todayYmd}
          backdated={isBackdated(quoteDate, todayYmd)}
          otherMonth={differsInMonth(quoteDate, todayYmd) ? monthOf(quoteDate) : 0}
          onBehalf={onBehalf}
          isSaving={isSaving}
          toast={toast}
          runValidation={runValidation}
          categoryMissing={categoryMissing || formMissing}
          formKind={formKind}
          setShowConfirmModal={setShowConfirmModal}
          dateDisplay={dateDisplay}
          engineerName={engineerName}
          engineerTel={engineerTel}
          showSignature={showSignature}
          previewTerms={previewTerms}
          debouncedCompany={debouncedCompany}
          debouncedReceiver={debouncedReceiver}
          debouncedRows={debouncedRows}
          debouncedFinalRemarks={debouncedFinalRemarks}
          pdfTotalSupply={pdfTotalSupply}
          pdfTotalTax={pdfTotalTax}
          pdfTotalAmount={pdfTotalAmount}
        />
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
        <ConfirmQuoteModal
          quoteNo={quoteNo}
          totalSupply={totalSupply}
          totalCost={totalCost}
          totalProfit={totalProfit}
          totalProfitRate={totalProfitRate}
          errors={errors}
          isSubmitting={isSubmitting}
          engineer={engineer}
          toast={toast}
          setShowConfirmModal={setShowConfirmModal}
          runConfirm={runConfirm}
        />
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
