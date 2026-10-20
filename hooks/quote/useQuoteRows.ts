'use client'

// 견적 작성 화면의 **품목 행**(rows) 부분 — 가격표 검색·선택, 행 수정, 설명 줄, 부대비용 헬퍼.
//
// app/quote/page.tsx 에서 옮겨 온 것이다(분리 리팩터 3a). 함수 본문·주석은 한 글자도 바뀌지
// 않았고, 3b 에서 **감싸는 방식만** 달라졌다.
//   · 함수마다 useCallback 을 두른다 — 의존성이 그대로일 때 같은 함수를 돌려주어 행 카드에
//     넘기는 묶음(actions)의 정체가 유지된다. 의존성 배열에는 함수가 실제로 읽는 값을 전부 적는다.
//   · 행 카드가 쓰는 것을 두 묶음으로 미리 만들어 둔다(useMemo).
//       ctx     — 여러 행이 함께 읽는 값(검색 결과·프리셋·행 수 …)
//       actions — 여러 행이 함께 쓰는 콜백
//     행 카드의 prop 이 28개에서 5개로 줄고, 앞으로 행이 수십 개가 되어도 넘기는 값이 늘지 않는다.
//   · removeRow 를 더했다 — 행 카드가 setRows 를 통째로 받아 직접 지우던 것을 동작 하나로 바꿨다.
//     판정식(prev.filter(r => r.id !== rowId))은 그대로다.
//
// **이 훅은 useEffect 를 하나도 두지 않는다.** 원본에서 rows 와 얽힌 effect 는 셋인데
// (부대비용 프리셋 1회 로드, 금액 생기면 items 에러 해제, 부대비용 에러 해제) 그 셋은
// 다른 effect 들 사이에 끼어 있어 훅으로 옮기면 **flush 순서가 바뀐다.** 그래서 effect 는
// page.tsx 에 그대로 두고, 이 훅은 setExpensePresets·setPresetError 를 돌려주어 그쪽에서
// 채우게 한다.
//
// supabase 클라이언트는 **화면에서 받는다** — 훅이 createClient() 를 다시 부르면 인스턴스가
// 하나 더 생긴다. exchangeRate·delivery 도 화면이 들고 있는 값이라 그대로 받는다
// (handleSelect 가 납기 칸이 비었을 때만 채우는 규칙을 유지한다).

import { useCallback, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExpensePreset, ExpenseRow, PriceItem, QuoteRow } from '@/app/quote/types'
import { calcExpense, calcRow, createExpenseRow, createRow } from '@/app/quote/calc'
import { canSplitRowKind, type QuoteCategory } from '@/lib/quoteCategories'
import { canGroupRowKind, isEquipForm } from '@/lib/quoteForms'
import { searchPriceList } from '@/lib/priceSearch'
import { priceScopeLabel, sheetsForForm } from '@/lib/priceListKinds'
import { itemTextOnSelect } from '@/lib/priceItemText'

export type UseQuoteRowsArgs = {
  supabase: SupabaseClient
  exchangeRate: number
  delivery: string
  setDelivery: (v: string) => void
  /** 고를 수 있는 견적 분류(활성만). 줄별 분류 선택칸이 쓴다. */
  categories: QuoteCategory[]
  /** 「분류 나누기」가 켜져 있는가. 꺼져 있으면 줄별 분류 선택칸을 그리지 않는다. */
  lineSplitOn: boolean
  /** 고른 견적 양식. 장비(equip80)일 때만 줄 묶음 선택칸이 나온다. */
  formKind: string
}

/** 여러 행이 함께 **읽는** 값. 행 카드 하나하나가 따로 받을 이유가 없는 것만 모았다. */
export type QuoteRowsCtx = {
  /** 품목 행 수. 「행이 둘 이상일 때만」 순번 배지와 삭제 버튼을 낸다(종전 rows.length). */
  rowCount: number
  searchQuery: Record<string, string>
  searchResults: Record<string, PriceItem[]>
  searchOpen: Record<string, boolean>
  editingProfitRate: Record<string, boolean>
  profitRateInput: Record<string, string>
  expensePresets: ExpensePreset[]
  presetError: boolean
  invalidExpenseIds: Set<string>
  totalExpense: number
  /** 「분류 나누기」가 켜져 있는가. 꺼져 있으면 행 카드가 분류 선택칸을 그리지 않는다. */
  lineSplitOn: boolean
  /** 줄별 분류 선택칸의 후보(활성 분류만). */
  categories: QuoteCategory[]
  /** 장비 양식인가. 줄 묶음 선택칸을 낼지 가른다. */
  equipForm: boolean
  /**
   * 지금 검색이 보는 가격표 종류. null 이면 전체다.
   * 한 견적 안의 **모든 검색칸이 같은 값을 쓴다** — 줄마다 다른 가격표를 보면 헷갈린다.
   */
  priceSheets: readonly string[] | null
  /** 「전체 가격표에서 검색」이 켜져 있는가(저장하지 않는 화면 상태). */
  searchAllSheets: boolean
  /** 검색칸 옆에 적는 문구 — 「20 가격표에서 검색」 같은 글자. */
  priceScope: string
}

/** 여러 행이 함께 **쓰는** 콜백. 전부 useCallback 으로 정체가 유지된다. */
export type QuoteRowsActions = {
  updateRow: (rowId: string, field: keyof QuoteRow, value: unknown) => void
  addSubLine: (rowId: string) => void
  updateSubLine: (rowId: string, idx: number, val: string) => void
  removeSubLine: (rowId: string, idx: number) => void
  handleSearch: (rowId: string, q: string) => void
  handleSelect: (rowId: string, item: PriceItem) => void
  clearItem: (rowId: string) => void
  removeRow: (rowId: string) => void
  /** 줄별 분류를 바꾼다. 빈 글자를 주면 null(= 견적 분류를 따른다)로 돌아간다. */
  setRowCategory: (rowId: string, code: string) => void
  /** 장비 구성 묶음을 바꾼다. 빈 글자를 주면 null(= 묶음 없음)로 돌아간다. */
  setRowGroupKind: (rowId: string, kind: string) => void
  setSearchOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  /** 「전체 가격표에서 검색」 토글. */
  setSearchAllSheets: (v: boolean) => void
  setEditingProfitRate: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setProfitRateInput: React.Dispatch<React.SetStateAction<Record<string, string>>>
  addExpense: () => void
  removeExpense: (expenseId: string) => void
  updateExpense: (expenseId: string, patch: Partial<ExpenseRow>) => void
  selectExpensePreset: (expenseId: string, itemName: string) => void
}

export function useQuoteRows({
  supabase, exchangeRate, delivery, setDelivery, categories, lineSplitOn, formKind,
}: UseQuoteRowsArgs) {
  const [rows, setRows] = useState<QuoteRow[]>([createRow()])
  const [expensePresets, setExpensePresets] = useState<ExpensePreset[]>([])
  const [presetError, setPresetError] = useState(false)
  const [searchQuery, setSearchQuery] = useState<Record<string, string>>({})
  const [searchResults, setSearchResults] = useState<Record<string, PriceItem[]>>({})
  const [searchOpen, setSearchOpen] = useState<Record<string, boolean>>({})
  const [editingProfitRate, setEditingProfitRate] = useState<Record<string, boolean>>({})
  const [profitRateInput, setProfitRateInput] = useState<Record<string, string>>({})

  // 「전체 가격표에서 검색」 — 기본은 꺼짐(양식에 맞는 가격표만 본다).
  // 저장하지 않는다(임시저장·다시쓰기에 들어가지 않는 화면 상태다).
  const [searchAllSheets, setSearchAllSheets] = useState(false)
  // 양식이 정한 허용 목록. 토글을 켜면 null(전체)이 된다.
  const priceSheets = searchAllSheets ? null : sheetsForForm(formKind)

  const handleSearch = useCallback(async (rowId: string, q: string) => {
    setSearchQuery(prev => ({ ...prev, [rowId]: q }))
    // 품번은 검색창 내용을 그대로 따라간다 — 가격표에서 고르지 않고 직접 친 값도 PDF 품번 칸에 나간다.
    setRows(prev => prev.map(r => r.id !== rowId ? r : { ...r, partCode: q }))
    if (!q.trim()) { setSearchResults(prev => ({ ...prev, [rowId]: [] })); return }
    // 가격표 검색은 lib/priceSearch.ts 한 곳에서 한다 — 장비 구성 모달도 같은 함수를 쓴다.
    // 양식이 정한 가격표 안에서만 찾는다(토글을 켜면 전체).
    const found = await searchPriceList(supabase, q, priceSheets)
    setSearchResults(prev => ({ ...prev, [rowId]: found }))
    setSearchOpen(prev => ({ ...prev, [rowId]: true }))
  }, [supabase, priceSheets])

  const handleSelect = useCallback((rowId: string, item: PriceItem) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r
      // 품목 선택 시점에 품명 칸을 1회 채운다(이후 itemText 는 순수 사용자 입력).
      // 무엇을 채우는지는 가격표(20/80)에 따라 다르다 — lib/priceItemText.ts 가 정한다.
      const itemText = itemTextOnSelect(r.itemText, !!r.selectedItem, item)
      return calcRow({ ...r, selectedItem: item, itemText, partCode: item.item_code }, exchangeRate)
    }))
    setSearchOpen(prev => ({ ...prev, [rowId]: false }))
    setSearchQuery(prev => ({ ...prev, [rowId]: item.item_code }))
    if (item.delivery_time && delivery === '') {
      setDelivery(item.delivery_time + '주')
    }
  }, [exchangeRate, delivery, setDelivery])

  const updateRow = useCallback((rowId: string, field: keyof QuoteRow, value: any) =>
    setRows(prev => prev.map(r => r.id !== rowId ? r : calcRow({ ...r, [field]: value }, exchangeRate))),
    [exchangeRate])

  const clearItem = useCallback((rowId: string) => {
    // 품목 해제(× 버튼) — 종류는 price_list 그대로 두고 선택만 비운다.
    setRows(prev => prev.map(r => r.id !== rowId ? r : calcRow({ ...r, selectedItem: null, manual_unit_price: 0, partCode: '' }, exchangeRate)))
    setSearchQuery(prev => ({ ...prev, [rowId]: '' }))
    setSearchResults(prev => ({ ...prev, [rowId]: [] }))
  }, [exchangeRate])

  const updateSubLine = useCallback((rowId: string, idx: number, val: string) =>
    setRows(prev => prev.map(r => { if (r.id !== rowId) return r; const lines = [...r.subLines]; lines[idx] = val; return { ...r, subLines: lines } })), [])
  const addSubLine = useCallback((rowId: string) =>
    setRows(prev => prev.map(r => r.id !== rowId ? r : { ...r, subLines: [...r.subLines, ''] })), [])
  const removeSubLine = useCallback((rowId: string, idx: number) =>
    setRows(prev => prev.map(r => r.id !== rowId ? r : { ...r, subLines: r.subLines.filter((_, i) => i !== idx) })), [])

  // 행 삭제 — 행 카드가 setRows 를 통째로 받아 직접 지우던 자리다(판정식은 그대로).
  const removeRow = useCallback((rowId: string) =>
    setRows(prev => prev.filter(r => r.id !== rowId)), [])

  // 줄별 분류 — 빈 글자는 null 로 눕힌다(「견적 분류를 따른다」가 그 뜻이다).
  // 매출 줄이 아니면 값을 넣지 않는다(domestic·discount 는 통계에서 쓸 자리가 없다).
  const setRowCategory = useCallback((rowId: string, code: string) =>
    setRows(prev => prev.map(r =>
      r.id !== rowId ? r : { ...r, category: canSplitRowKind(r.row_kind) ? (code || null) : null })), [])

  /** 모든 줄의 분류를 지운다. 「분류 나누기」를 끌 때 쓴다. */
  const clearAllRowCategories = useCallback(() =>
    setRows(prev => prev.map(r => r.category == null ? r : { ...r, category: null })), [])

  // 장비 구성 묶음 — 빈 글자는 null 로 눕힌다(「묶음 없음」이 그 뜻이다).
  // 묶음을 둘 수 없는 줄(국내조달품·할인)에는 값을 넣지 않는다.
  const setRowGroupKind = useCallback((rowId: string, kind: string) =>
    setRows(prev => prev.map(r =>
      r.id !== rowId ? r : { ...r, group_kind: canGroupRowKind(r.row_kind) ? (kind || null) : null })), [])

  // 부대비용은 서비스비 행(견적당 1건)에 속한다. 별도 state 없이 rows 에서 파생시킨다.
  const serviceRow = rows.find(r => r.row_kind === 'service') ?? null
  // 할인도 서비스비와 같이 견적당 1건이다(총액에서 한 번만 뺀다).
  const discountRow = rows.find(r => r.row_kind === 'discount') ?? null
  const expenses = serviceRow?.expenses ?? []

  // 부대비용 내역 갱신 — 서비스비 행의 expenses 를 바꾼 뒤 calcRow 로 원가·이익을 재계산한다.
  // (calcExpense 로 amount 재계산 → calcRow 로 행 원가 반영, 두 단계 모두 map 안에서 처리)
  const updateServiceExpenses = useCallback((fn: (list: ExpenseRow[]) => ExpenseRow[]) =>
    setRows(prev => prev.map(r => r.row_kind !== 'service' ? r : calcRow({ ...r, expenses: fn(r.expenses) }, exchangeRate))),
    [exchangeRate])

  // 항목명 선택은 unit_price 도 함께 바꾸므로 patch 객체로 받는다.
  const updateExpense = useCallback((expenseId: string, patch: Partial<ExpenseRow>) =>
    updateServiceExpenses(list => list.map(e => e.id !== expenseId ? e : calcExpense({ ...e, ...patch }))),
    [updateServiceExpenses])

  const addExpense = useCallback(() => updateServiceExpenses(list => [...list, createExpenseRow()]), [updateServiceExpenses])
  const removeExpense = useCallback((expenseId: string) => updateServiceExpenses(list => list.filter(e => e.id !== expenseId)), [updateServiceExpenses])

  const selectExpensePreset = useCallback((expenseId: string, itemName: string) => {
    const preset = expensePresets.find(p => p.item_name === itemName)
    updateExpense(expenseId, { item_name: itemName, unit_price: preset?.unit_price ?? 0 })
  }, [expensePresets, updateExpense])

  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0)
  // 항목명은 골랐는데 금액이 0 인 행(= 단가·인원·일수 중 0). 저장 시 에러 표시 대상.
  const invalidExpenseIds = new Set(expenses.filter(e => e.item_name.trim() && e.amount <= 0).map(e => e.id))

  // ── 행 카드에 넘기는 두 묶음 ───────────────────────────────────────────────
  // invalidExpenseIds 는 렌더마다 새 Set 이라 그 내용이 같아도 ctx 가 새로 만들어진다.
  // 그래서 **품목 id 를 이어붙인 글자**를 의존성으로 쓴다 — 내용이 그대로면 같은 ctx 를 돌려준다.
  // (Set 자체를 의존성에 넣으면 useMemo 가 매번 다시 돌아 묶음의 뜻이 없어진다)
  const invalidExpenseKey = [...invalidExpenseIds].join(',')
  const ctx = useMemo<QuoteRowsCtx>(() => ({
    rowCount: rows.length,
    searchQuery, searchResults, searchOpen,
    editingProfitRate, profitRateInput,
    expensePresets, presetError,
    invalidExpenseIds, totalExpense,
    lineSplitOn, categories, equipForm: isEquipForm(formKind),
    priceSheets, searchAllSheets, priceScope: priceScopeLabel(formKind, searchAllSheets),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows.length, searchQuery, searchResults, searchOpen,
       editingProfitRate, profitRateInput, expensePresets, presetError,
       invalidExpenseKey, totalExpense, lineSplitOn, categories, formKind,
       priceSheets, searchAllSheets])

  const actions = useMemo<QuoteRowsActions>(() => ({
    updateRow, addSubLine, updateSubLine, removeSubLine,
    handleSearch, handleSelect, clearItem, removeRow, setRowCategory, setRowGroupKind,
    setSearchOpen, setEditingProfitRate, setProfitRateInput, setSearchAllSheets,
    addExpense, removeExpense, updateExpense, selectExpensePreset,
  }), [updateRow, addSubLine, updateSubLine, removeSubLine,
       handleSearch, handleSelect, clearItem, removeRow, setRowCategory, setRowGroupKind,
       addExpense, removeExpense, updateExpense, selectExpensePreset])

  return {
    rows, setRows,
    expensePresets, setExpensePresets,
    presetError, setPresetError,
    searchQuery, setSearchQuery,
    searchResults, setSearchResults,
    searchOpen, setSearchOpen,
    editingProfitRate, setEditingProfitRate,
    profitRateInput, setProfitRateInput,
    handleSearch,
    handleSelect,
    updateRow,
    clearItem,
    updateSubLine,
    addSubLine,
    removeSubLine,
    removeRow,
    setRowCategory,
    setRowGroupKind,
    clearAllRowCategories,
    serviceRow,
    discountRow,
    expenses,
    updateServiceExpenses,
    updateExpense,
    addExpense,
    removeExpense,
    selectExpensePreset,
    totalExpense,
    invalidExpenseIds,
    ctx,
    actions,
  }
}
