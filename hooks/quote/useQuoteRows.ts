'use client'

// 견적 작성 화면의 **품목 행**(rows) 부분 — 가격표 검색·선택, 행 수정, 설명 줄, 부대비용 헬퍼.
//
// app/quote/page.tsx 에서 **그대로 옮겨 온 것**이다(분리 리팩터 3a). 상태 이름·초기값·본문·
// 주석을 한 글자도 바꾸지 않았다.
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

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExpensePreset, ExpenseRow, PriceItem, QuoteRow } from '@/app/quote/types'
import { calcExpense, calcRow, createExpenseRow, createRow } from '@/app/quote/calc'

export type UseQuoteRowsArgs = {
  supabase: SupabaseClient
  exchangeRate: number
  delivery: string
  setDelivery: (v: string) => void
}

export function useQuoteRows({ supabase, exchangeRate, delivery, setDelivery }: UseQuoteRowsArgs) {
  const [rows, setRows] = useState<QuoteRow[]>([createRow()])
  const [expensePresets, setExpensePresets] = useState<ExpensePreset[]>([])
  const [presetError, setPresetError] = useState(false)
  const [searchQuery, setSearchQuery] = useState<Record<string, string>>({})
  const [searchResults, setSearchResults] = useState<Record<string, PriceItem[]>>({})
  const [searchOpen, setSearchOpen] = useState<Record<string, boolean>>({})
  const [editingProfitRate, setEditingProfitRate] = useState<Record<string, boolean>>({})
  const [profitRateInput, setProfitRateInput] = useState<Record<string, string>>({})

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
  }
}
