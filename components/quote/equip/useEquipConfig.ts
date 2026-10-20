'use client'

// 장비 구성 모달의 **상태** — 줄·환율·수량·템플릿을 여기서만 들고 있다.
//
// 모달이 열려 있는 동안만 사는 상태다. **임시저장(quote_drafts)에 들어가지 않는다** —
// 견적에 들어가는 것은 「견적에 추가」가 만든 줄이고, 그 줄은 기존 rows 로 합쳐져 기존
// 임시저장 경로를 그대로 탄다. 모달을 닫으면 여기 있던 값은 사라진다.
//
// 합계는 app/quote/calc.ts 의 calcTotals 하나만 쓴다 — 견적 화면·PDF 와 같은 함수다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { calcTotals } from '@/app/quote/calc'
import { sheetsForLine } from '@/lib/priceListKinds'
import type { PriceItem, QuoteRow } from '@/app/quote/types'
import {
  TEMPLATE_ITEM_MAX, createTemplate, deleteTemplate, loadQuoteTemplate, loadQuoteTemplates,
  loadTemplateItemCounts, markTemplateUsed, updateTemplate,
} from '@/lib/quoteTemplates'
import type { QuoteTemplate } from '@/lib/quoteTemplates'
import {
  lineFromManual, lineFromPriceItem, lineFromTemplateItem, linesOf, priceKey, recalcLines,
  toDiscountRow, toQuoteRows, toTemplateItems,
} from './equipLines'
import type { EquipGroup, EquipLine } from './equipLines'

/** 장비 구성이 보는 가격표 — 80 만. 한 번 만들어 두고 같은 배열을 쓴다. */
const EQUIP_SHEETS = sheetsForLine('80')

/** 관세율 기본값 — calc.ts 의 createRow() 와 같은 값이다(출처를 하나로 둔다). */
export const DEFAULT_TARIFF = 1.13

export type EquipConfigArgs = {
  supabase: SupabaseClient
  /** 모달이 열려 있는가. 열릴 때 목록을 읽고 닫힐 때 아무것도 하지 않는다. */
  open: boolean
  /** 내 engineer_id — 「내가 만든 것 먼저」와 「복사 저장이 기본」 판정에 쓴다. */
  myId: number | null
  /** 내 표시 이름 — 저장 이름 기본값에 들어간다(저장되는 owner_name 은 서버가 세션에서 채운다). */
  myName: string
  /** 지금 견적의 분류 — 템플릿에 함께 저장한다. */
  category: string | null
  /** 견적 화면의 환율. 모달 안에서만 고칠 수 있다. */
  defaultExchangeRate: number
  /** 견적 줄의 관세율. */
  defaultTariff: number
}

export function useEquipConfig(args: EquipConfigArgs) {
  const { supabase, open, myId, myName, category, defaultExchangeRate, defaultTariff } = args

  // ── 머리 입력 ──
  // 환율은 **파생값**이다. 모달 안에서 손대기 전에는 견적 화면의 환율을 그대로 따라가고
  // (모달을 먼저 열어 둔 사이에 환율이 도착하는 일이 있다), 손댄 뒤에는 그 값을 쓴다.
  // 효과로 베껴 쓰지 않는 이유 — 베끼면 사람이 친 값을 덮을 틈이 생기고 렌더가 한 번 더 돈다.
  const [ownRate, setOwnRate] = useState(defaultExchangeRate)
  const [rateTouched, setRateTouched] = useState(false)
  const exRate = rateTouched ? ownRate : (defaultExchangeRate || ownRate)
  const [tariff, setTariff] = useState(defaultTariff || DEFAULT_TARIFF)
  const [machineQty, setMachineQty] = useState(1)
  const [discount, setDiscount] = useState(0)

  // ── 줄 ──
  // **입력만** 담는다. 금액·연동 수량은 아래 memo 가 calc.ts 로 다시 만든다 —
  // 상태에 계산 결과를 같이 넣어 두면 환율이 바뀔 때마다 효과로 상태를 고쳐야 한다.
  const [rawLines, setRawLines] = useState<EquipLine[]>([])

  // ── 템플릿 목록 ──
  const [templates, setTemplates] = useState<QuoteTemplate[]>([])
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [listLoading, setListLoading] = useState(true)
  const [picked, setPicked] = useState<QuoteTemplate | null>(null)
  const [modelKey, setModelKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 목록은 모달을 열 때 읽는다. 닫는 동안에는 읽지 않는다.
  const reloadList = useCallback(async () => {
    setListLoading(true)
    const list = await loadQuoteTemplates(supabase)
    const map = await loadTemplateItemCounts(supabase, list.map(t => t.id))
    setTemplates(list)
    setCounts(map)
    setListLoading(false)
  }, [supabase])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    loadQuoteTemplates(supabase).then(async list => {
      const map = await loadTemplateItemCounts(supabase, list.map(t => t.id))
      if (cancelled) return
      setTemplates(list)
      setCounts(map)
      setListLoading(false)
    })
    return () => { cancelled = true }
  }, [open, supabase])

  /**
   * 화면·합계·저장이 모두 쓰는 **계산된 줄.**
   * 환율·관세율·장비 수량이 바뀌면 여기서 한 번에 다시 계산된다(본체+기본의 수량 연동 포함).
   */
  const lines = useMemo(
    () => recalcLines(rawLines, machineQty, exRate, tariff),
    [rawLines, machineQty, exRate, tariff],
  )

  /** 줄 입력을 바꾼다. 금액은 바로 위 memo 가 다시 만든다. */
  const applyLines = useCallback(
    (next: EquipLine[] | ((prev: EquipLine[]) => EquipLine[])) => setRawLines(next),
    [],
  )

  // ── 템플릿 고르기 ──

  /** 템플릿을 불러 줄을 채운다. 품번이 있는 줄은 **가격표에서 원가를 새로 계산**한다. */
  const selectTemplate = useCallback(async (t: QuoteTemplate) => {
    setBusy(true)
    setError('')
    const full = await loadQuoteTemplate(supabase, t.id)
    if (!full) {
      setBusy(false)
      setError('템플릿을 불러오지 못했습니다')
      return
    }
    // 품번을 한 번에 조회한다 — 줄마다 검색하면 왕복이 수십 번이 된다.
    const codes = Array.from(new Set(full.items.map(i => (i.part_code ?? '').trim()).filter(Boolean)))
    const byCode = new Map<string, PriceItem>()
    if (codes.length > 0) {
      const { data, error: qErr } = await supabase
        .from('price_list').select('*')
        .in('item_code', codes)
        // 장비 구성은 80 가격표만 쓴다 — 20 가격표 품목이 섞여 들어오지 않게 한다.
        .in('sheet_name', EQUIP_SHEETS)
        .order('sheet_name')
      if (qErr) console.error('[equip] 가격표 조회 실패', qErr)
      // 열쇠는 **(품번, 구분)** 이다 — 품번만 쓰면 Jig 포함/제외가 서로를 덮어쓴다.
      //
      // 같은 (품번, 구분)이 **여러 종류에 있을 때**(SFG Spare 와 CMM Spare 에 313건이 겹친다)
      // 어느 쪽을 쓸지는 정해 두어야 한다. 이름·모델이 같은 같은 부품이라 값이 같으므로
      // **sheet_name 오름차순의 첫 줄**을 쓴다 — 아무 쪽이나 쓰더라도 **늘 같은 쪽**이 골라져야
      // 불러올 때마다 원가가 흔들리지 않는다(위 order('sheet_name') 가 그 순서를 만든다).
      for (const p of (data ?? []) as PriceItem[]) {
        const key = priceKey(p.item_code, p.variant)
        if (!byCode.has(key)) byCode.set(key, p)
      }
    }
    setPicked(full)
    setModelKey(full.model_key ?? '')
    applyLines(full.items.map(it => lineFromTemplateItem(it, byCode, machineQty)))
    setBusy(false)
  }, [supabase, applyLines, machineQty])

  /** 빈 구성으로 시작한다. */
  const startEmpty = useCallback(() => {
    setPicked(null)
    setModelKey('')
    setError('')
    applyLines([])
  }, [applyLines])

  // ── 줄 조작 ──

  const toggleLine = useCallback((id: string, checked: boolean) => {
    applyLines(prev => prev.map(l => (l.row.id === id ? { ...l, checked } : l)))
  }, [applyLines])

  const toggleGroup = useCallback((group: EquipGroup, checked: boolean) => {
    applyLines(prev => prev.map(l => (l.group === group ? { ...l, checked } : l)))
  }, [applyLines])

  /** 수량 — 본체+기본은 장비 수량에 연동되므로 qtyPerUnit 을, 그 밖은 줄 수량을 고친다. */
  const setLineQty = useCallback((id: string, qty: number) => {
    const q = Math.max(0, Math.min(99999, Math.round(qty) || 0))
    applyLines(prev => prev.map(l => (l.row.id === id
      ? { ...l, qtyPerUnit: q, row: { ...l.row, quantity: q } }
      : l)))
  }, [applyLines])

  /** 판매단가 — 사람이 친 값이라 price 모드로 고정한다(이익률로 역산하지 않는다). */
  const setLinePrice = useCallback((id: string, price: number) => {
    applyLines(prev => prev.map(l => (l.row.id === id
      ? { ...l, row: { ...l.row, price_mode: 'price', manual_unit_price: Math.max(0, price) } }
      : l)))
  }, [applyLines])

  const setLineText = useCallback((id: string, field: 'itemText' | 'partCode', value: string) => {
    applyLines(prev => prev.map(l => (l.row.id === id ? { ...l, row: { ...l.row, [field]: value } } : l)))
  }, [applyLines])

  const removeLine = useCallback((id: string) => {
    applyLines(prev => prev.filter(l => l.row.id !== id))
  }, [applyLines])

  /** 가격표에서 고른 품목을 그 묶음에 붙인다. */
  const addPriceItem = useCallback((group: EquipGroup, item: PriceItem) => {
    applyLines(prev => (prev.length >= TEMPLATE_ITEM_MAX
      ? prev
      : [...prev, lineFromPriceItem(item, group, { checked: true, qtyPerUnit: 1, sellPrice: null })]))
  }, [applyLines])

  /** 가격표에 없는 항목을 직접 붙인다(국내조달품은 금액이 원가다). */
  const addManualItem = useCallback((group: EquipGroup, name: string, price: number) => {
    const text = name.trim()
    if (!text) return
    applyLines(prev => (prev.length >= TEMPLATE_ITEM_MAX
      ? prev
      : [...prev, lineFromManual(group, { name: text, qtyPerUnit: 1, price })]))
  }, [applyLines])

  // ── 합계 (견적 화면과 같은 함수) ──

  const checkedRows = useMemo(() => toQuoteRows(lines), [lines])
  const discountRow = useMemo(() => toDiscountRow(discount, exRate), [discount, exRate])

  const totals = useMemo(() => {
    const before = calcTotals(checkedRows)
    const after = calcTotals(discountRow ? [...checkedRows, discountRow] : checkedRows)
    return {
      /** 할인 전 공급가 합. */
      subtotal: before.totalSupply,
      /** 할인 후 — 합계·부가세·총계·원가·이익률 모두 calcTotals 가 낸 값이다. */
      supply: after.totalSupply,
      tax: after.totalTax,
      amount: after.totalAmount,
      cost: after.totalCost,
      profitRate: after.totalProfitRate,
      domesticCost: after.domesticCost,
    }
  }, [checkedRows, discountRow])

  const checkedCount = checkedRows.length
  const missingCount = useMemo(() => lines.filter(l => l.missing).length, [lines])

  // ── 템플릿 저장·삭제 ──

  /** 저장 이름 기본값 — 「만든 사람 · 기종 · N항목」. */
  const defaultName = useCallback((who: string) => {
    const parts = [who || myName, modelKey.trim() || '기종 미지정', `${lines.length}항목`]
    return parts.filter(Boolean).join(' · ')
  }, [myName, modelKey, lines.length])

  /**
   * 템플릿 저장. mode 가 'copy' 면 새로 만들고 'overwrite' 면 고른 템플릿을 고친다.
   * 쓰기는 서버 라우트만 한다(owner 는 서버가 세션에서 채운다).
   */
  const saveTemplate = useCallback(async (name: string, mode: 'copy' | 'overwrite'): Promise<string> => {
    if (lines.length === 0) return '저장할 항목이 없습니다'
    setBusy(true)
    const input = {
      name: name.trim(),
      model_key: modelKey.trim() || null,
      category,
      items: toTemplateItems(lines, machineQty),
    }
    const res = mode === 'overwrite' && picked
      ? await updateTemplate(picked.id, input)
      : await createTemplate(input)
    setBusy(false)
    if (!res.ok) return res.error
    await reloadList()
    return ''
  }, [lines, modelKey, category, machineQty, picked, reloadList])

  /** 지우기 — 행은 남고 is_deleted 가 선다. 지운 템플릿이 열려 있었다면 빈 구성으로 돌린다. */
  const removeTemplate = useCallback(async (id: string): Promise<string> => {
    setBusy(true)
    const res = await deleteTemplate(id)
    setBusy(false)
    if (!res.ok) return res.error
    if (picked?.id === id) startEmpty()
    await reloadList()
    return ''
  }, [picked, startEmpty, reloadList])

  /**
   * 「견적에 추가」가 넘길 줄과, 함께 쓸 사용 기록.
   * 사용 기록은 **기다리지 않는다** — 실패해도 견적 추가를 막지 않는다는 규칙이다.
   */
  const takeRows = useCallback((): { rows: QuoteRow[]; discount: QuoteRow | null } => {
    if (picked) void markTemplateUsed(picked.id)
    return { rows: checkedRows, discount: discountRow }
  }, [picked, checkedRows, discountRow])

  return {
    // 머리
    exRate,
    setExRate: (v: number) => { setRateTouched(true); setOwnRate(v) },
    tariff, setTariff, machineQty, setMachineQty, discount, setDiscount,
    // 줄
    lines, linesOf, toggleLine, toggleGroup, setLineQty, setLinePrice, setLineText, removeLine,
    addPriceItem, addManualItem,
    // 템플릿
    templates, counts, listLoading, picked, modelKey, setModelKey,
    selectTemplate, startEmpty, saveTemplate, removeTemplate, defaultName, myId,
    // 결과
    totals, checkedCount, missingCount, busy, error, takeRows,
  }
}

export type EquipConfigCtx = ReturnType<typeof useEquipConfig>
