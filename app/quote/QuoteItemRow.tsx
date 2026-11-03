'use client'

import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useOutsideClick } from '@/hooks/useOutsideClick'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import SegmentedControl from '@/components/common/SegmentedControl'
import type { PriceItem, QuoteRow } from './types'
import type { QuoteRowsActions, QuoteRowsCtx } from '@/hooks/quote/useQuoteRows'
import type { RecentSaleLookup } from '@/hooks/quote/useRecentSales'
import { canSplitRowKind } from '@/lib/quoteCategories'
import { GROUP_KINDS, GROUP_LABELS, canGroupRowKind, isGeneral20Form } from '@/lib/quoteForms'
import { ROW_KIND_LABEL } from '@/lib/quoteRowKinds'
import { numKR } from './format'
import { costOf } from './calc'
import { CURRENCIES, CURRENCY_SYMBOL, toCurrency, type Currency } from '@/lib/quoteCurrency'
import { DISCOUNT_LABELS } from './types'
import { inp } from './styles'
import ExpenseSection from './ExpenseSection'
import { Z } from '@/lib/zIndex'

// 후보가 없을 때 쓰는 고정 빈 배열 — 렌더마다 새 배열을 만들지 않기 위해 모듈 상수로 둔다.
const EMPTY_ITEMS: PriceItem[] = []

// ── 줄 모양 ─────────────────────────────────────────────────────────────────
//
// 품목 패널은 폭이 340px 남짓이고 견적 하나에 줄이 예닐곱이다. 그래서 **한 줄이 한눈에
// 들어오는 것**이 이 카드의 목표다. 2026-11-03 에 두 번 줄였다(245 → 151 → 지금).
//
//   머리줄   번호 · 종류 · 통화 · (줄 추가) · 삭제
//   1단      품번(검색) · 모델 · 품명        — 칸 **안**에 접두 글자를 둔다(바깥 라벨 없음)
//   2단      구입가 · 수량 −/+ · 관세 −/+     — 3칸 격자 1.2 : 1 : 1
//   3단      [이익률|판매가] · 값 칸          — 2칸 격자
//   결과     판매단가(이익률 모드) 또는 실현 이익률(판매가 모드)
//   요약     점선 아래 **두 줄 고정**(줄바꿈 없음)
//
// 칸 위에 라벨을 다는 대신 칸 안 왼쪽에 작은 글자를 둔다. 라벨 줄 하나가 15px + 여백이고,
// 왼쪽 44px 라벨 칸 때문에 입력 폭도 그만큼 좁았다. **칸과 정보는 하나도 빼지 않았다.**
// **칸 높이는 하나다(32px).** 단마다 높이가 다르면 세로로 훑을 때 칸의 윗변이 들쭉날쭉해
// 줄이 세 단이 아니라 다섯 단처럼 보인다. 품번·품명·구입가·수량·관세·토글·값 칸이 모두 같다.
const H_CELL = 28
/** 상세 설명 줄 — 품목 칸이 아니라 그 아래 딸린 글이라 한 급 낮다. */
const H_SUB = 24
const GAP = 4           // 칸 사이·단 사이 여백

/**
 * 칸 테두리 상자 — 접두 글자와 입력을 한 테두리 안에 담는다.
 *
 * 테두리를 한 단 진하게(#ebebeb → #d1d5db) 하고 **줄 카드 바탕을 회색(#f8fafc)**, 칸만
 * 흰색으로 둔다. 종전에는 카드도 칸도 흰색이고 테두리가 가장 연한 색이라, 칸이 몇 개이고
 * 어디서 끝나는지 눈으로 세어야 했다. 이제 흰 칸이 회색 바탕 위에 떠 보인다.
 */
const boxBase: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, boxSizing: 'border-box',
  border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', padding: '0 8px',
}
/** 칸 안 접두 글자 — 「품번」「품명」「¥」. 바깥 라벨을 대신한다. */
const prefix: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap',
}
/**
 * 테두리를 상자에 넘긴 입력 — **사람이 넣은 값**이라 가장 진하다(#111827 · 500).
 * 접두어(prefix)와 단위는 한 단 흐리게 둬서, 한 칸 안에서 값이 먼저 읽힌다.
 * placeholder 는 손대지 않는다 — 브라우저가 글자색의 절반 농도로 그린다(globals.css).
 */
const bare: React.CSSProperties = {
  flex: 1, minWidth: 0, width: '100%', border: 'none', outline: 'none', background: 'transparent',
  fontSize: 12, fontWeight: 500, color: '#111827', padding: 0, boxSizing: 'border-box',
}
/** 스테퍼의 −/+ 단추. */
const stepBtn: React.CSSProperties = {
  width: 18, height: 18, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
  color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0,
}
/** 스테퍼 가운데 값. */
const stepVal: React.CSSProperties = {
  flex: 1, minWidth: 0, textAlign: 'center', fontSize: 12, fontWeight: 500,
  whiteSpace: 'nowrap', color: '#111827',
}
/** 머리줄 배지. */
const badge: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6',
  borderRadius: 99, padding: '1px 7px', whiteSpace: 'nowrap', flexShrink: 0,
}
/** 결과 줄의 숫자 — 그 줄에서 사람이 가장 자주 보는 값이라 한 급 크다. */
const resultNum: React.CSSProperties = { marginLeft: 2, fontSize: 13, fontWeight: 700, color: '#111827' }

// 품목 행 카드 1개(일반 품목 / 서비스비 공용).
//
// prop 은 다섯 개다(3b 정리 전에는 28개였다).
//   row · rowIdx · errors — 이 행 하나에 딸린 값
//   ctx                   — 여러 행이 함께 **읽는** 값(검색 결과·프리셋·행 수 …)
//   actions               — 여러 행이 함께 **쓰는** 콜백
// 두 묶음은 useQuoteRows 가 useMemo·useCallback 으로 만들어 정체를 유지한다. 그래서 행이
// 수십 개로 늘어도 넘기는 값이 늘지 않고, 앞으로 React.memo 를 씌울 때도 그대로 먹는다.
export type QuoteItemRowProps = {
  row: QuoteRow
  rowIdx: number
  errors: { expenses?: string }
  ctx: QuoteRowsCtx
  actions: QuoteRowsActions
  /** 「최근 판매」 찾기 — 화면이 한 번에 받아 온 것을 넘겨 준다(lib/recentSalePrice.ts). */
  recentSale: RecentSaleLookup
}

export default function QuoteItemRow({ row, rowIdx, errors, ctx, actions, recentSale }: QuoteItemRowProps) {
  const {
    rowCount, searchQuery, searchResults, searchOpen, priceSheets,
    editingProfitRate, profitRateInput, expensePresets, presetError,
    invalidExpenseIds, totalExpense, lineSplitOn, categories, equipForm, formKind,
  } = ctx
  const {
    updateRow, addSubLine, updateSubLine, removeSubLine,
    handleSearch, handleSelect, clearItem, removeRow, setRowCategory, setRowGroupKind,
    setSearchOpen, setEditingProfitRate, setProfitRateInput,
    addExpense, removeExpense, updateExpense, selectExpensePreset,
  } = actions
  // 할인 줄의 이름 — 평소에는 글자와 ▾ 뿐이고, 더블클릭하면 직접 쓰는 칸이 된다.
  const [discountMenu, setDiscountMenu] = useState(false)
  const [editingDiscountName, setEditingDiscountName] = useState(false)
  const discountMenuRef = useRef<HTMLDivElement>(null)
  useOutsideClick(discountMenuRef, useCallback(() => setDiscountMenu(false), []), discountMenu)

  // 가격표 검색 드롭다운 — 바깥 클릭(및 ESC)으로 닫는다. 항목을 반드시 골라야 빠져나올 수 있던 문제 해결.
  // 드롭다운은 searchRef 안에 있으므로 항목 클릭은 '바깥'으로 판정되지 않아 선택 동작에 영향이 없다.
  const searchRef = useRef<HTMLDivElement>(null)
  const closeSearch = useCallback(
    () => setSearchOpen(prev => (prev[row.id] ? { ...prev, [row.id]: false } : prev)),
    [setSearchOpen, row.id],
  )
  useOutsideClick(searchRef, closeSearch, !!searchOpen[row.id])

  // 판매가 산출 방식을 고를 수 있는 종류 — 가격표 품목과 직접 입력 품목.
  // (서비스비·할인은 금액을 직접 받으므로 해당 없음)
  // 국내 구매도 이익률로 역산하거나 판매단가를 직접 넣는다(2026-10-23 — 일반 품목이 됐다).
  const hasPriceMode = row.row_kind === 'price_list' || row.row_kind === 'manual_jpy' || row.row_kind === 'domestic'
  // '판매가' 모드 — 값 칸이 판매단가 입력이 되고, 이익률은 결과(실현 이익률)로만 보인다.
  const priceInputMode = hasPriceMode && row.price_mode === 'price'
  // 국내 구매 — 마진이 없어 관세율이 필요 없다(원가가 이미 원화다).
  const isDomestic = row.row_kind === 'domestic'
  // 할인 — 라벨과 금액만 받는다. 품번·상세줄·수량·이익률·관세는 쓰지 않는다.
  const isDiscount = row.row_kind === 'discount'
  const isService = row.row_kind === 'service'
  /** 20 견적서인가 — 직접 입력 칸 순서(품번 → 품명 → 모델)가 그 양식의 열 순서를 따른다. */
  const is20 = isGeneral20Form(formKind)
  // 가격표 품목의 구입가 — 줄에서 직접 고칠 수 있다(2026-11-02).
  //   listCostJpy — 가격표에 적힌 값(정본). selectedItem 은 손대지 않으므로 늘 남아 있다.
  //   shownCostJpy— 지금 계산에 쓰는 값(고친 값이 있으면 그것).
  //   costEdited  — 둘이 다른가 → 칸 안에 되돌리기를, 요약에 가격표 값을 낸다.
  /** 이 줄의 통화 기호 — 구입가 칸·요약에 붙는다(원화 줄은 쓰지 않는다). */
  const sym = CURRENCY_SYMBOL[row.currency]
  const listCostJpy = row.selectedItem?.cost_jpy ?? null
  const shownCostJpy = costOf(row)
  const costEdited = row.cost_jpy_override !== null && row.cost_jpy_override !== listCostJpy
  /** 상세 줄을 붙일 수 있는 종류 — 국내 구매·할인은 뺀다(견적서에 설명 줄이 나가지 않는다). */
  const canAddSubLine = !isDomestic && !isDiscount

  // 품목을 고르면 품명 칸으로 커서를 옮긴다. 위치는 맨 앞(자동으로 들어간 모델명 앞에 이어 적도록).
  // 품명 값이 갱신된 뒤에 커서를 잡아야 해서 다음 프레임에서 실행한다.
  const itemNameRef = useRef<HTMLInputElement>(null)
  const focusItemName = () => requestAnimationFrame(() => {
    const el = itemNameRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(0, 0)
  })

  // 가격표 후보 목록의 ↓/↑·Enter. 닫기(Esc·바깥 클릭)는 위 useOutsideClick 이 이미 맡고 있다.
  // 후보가 없을 때 매번 새 배열을 만들면 훅 안의 effect 가 계속 다시 도므로 고정된 빈 배열을 쓴다.
  // 검색 결과 — **지금 양식이 보는 가격표만** 남긴다.
  //
  // 서버 질의에도 같은 조건이 걸려 있다(lib/priceSearch.ts). 여기서 한 번 더 거르는 이유는
  // **양식을 바꾼 순간** 이미 떠 있던 지난 결과가 그대로 남기 때문이다 — 20 으로 바꿨는데
  // 80 품목이 목록에 남아 있으면 그걸 고를 수 있다. 거르면 목록이 저절로 비므로
  // 효과(effect)로 결과를 지우지 않아도 된다. 이미 견적에 넣은 줄은 건드리지 않는다.
  const allResults = searchResults[row.id] ?? EMPTY_ITEMS
  // 「최근 판매」 — 같은 고객사에 같은 품번을 마지막으로 판 단가. 조회는 **화면이 한 번에**
  // 하고(app/quote/page.tsx 의 useRecentSales) 줄은 찾아 쓰기만 한다. 줄마다 묻게 하면
  // 품목이 열 줄이면 조회가 열 번 나간다.
  const mySale = recentSale(row.selectedItem?.id ?? null, row.partCode || null)
  const itemResults = useMemo(
    () => (priceSheets ? allResults.filter(r => priceSheets.includes(r.sheet_name)) : allResults),
    [allResults, priceSheets],
  )
  const itemListRef = useRef<HTMLDivElement | null>(null)
  const itemKeys = useListKeyboard(itemResults, !!searchOpen[row.id], itemListRef, (item: PriceItem) => {
    handleSelect(row.id, item)
    focusItemName()
  })

  /**
   * **원가보다 싸게 판 줄인가.** 판매가 모드에서 단가를 손으로 적다 보면 원가 아래로
   * 내려가는 일이 있는데, 금액만 보고는 알 수 없다(숫자가 커서 커 보인다).
   * 실현 이익률이 음수라는 뜻이고, 그때만 결과 줄이 붉어진다.
   */
  const belowCost = row.supply_price > 0 && row.realized_profit_rate < 0
  /**
   * 이 줄에 **무엇이든 들어 있나** — 품목·구입가·금액 중 하나.
   * 결과 줄을 낼지 가르는 기준이다(아래 result 주석). 아직 아무것도 아닌 줄은 조용히 둔다.
   */
  const hasContent = !!row.selectedItem || row.manual_cost_jpy > 0 || row.manual_unit_price > 0 || row.unit_price > 0

  // ── 결과 한 줄 ────────────────────────────────────────────────────
  //
  //   판매단가 ₩227,000 · 공급가 ₩681,000 (× 3)
  //
  // 종전에는 점선 아래에 원가 식·부가세·이익률까지 두 줄로 적었다. 그 셋은 **수익 분석
  // 패널에 이미 같은 값으로 있고**(원가 식·매출이익·합계), 줄마다 되풀이되면서 정작
  // 고치려는 칸보다 글자가 많아졌다. 줄에 남길 것은 「얼마에 팔아 얼마가 되는가」뿐이다.
  //
  // 수량이 1이면 공급가 = 판매단가라 **공급가를 적지 않는다**(같은 수를 두 번 적는 꼴).
  // 할인·서비스비는 판매단가라는 말이 맞지 않아 각자의 말로 적는다.
  const result: React.ReactNode | null = (() => {
    if (isDiscount) {
      return row.supply_price < 0
        ? <>할인 <b style={resultNum}>−₩{numKR(Math.abs(row.supply_price))}</b></>
        : null
    }
    if (isService) {
      return row.supply_price > 0 ? <>공급가 <b style={resultNum}>₩{numKR(row.supply_price)}</b></> : null
    }
    // **판매단가가 아직 없어도 줄 자리는 지킨다.** 판매가 모드로 바꾸면 사람이 단가를
    // 적기 전까지 공급가가 0 이라, 결과 줄이 사라지면서 카드가 20px 쯤 줄어든다 —
    // 그 순간 아래 줄들이 위로 올라오고, 치려던 칸이 눈앞에서 비켜난다.
    // 품목도 금액도 없는 **아직 아무것도 아닌 줄**에만 줄을 내지 않는다(그때는 어느
    // 모드에서도 안 내므로 모드를 오가도 높이가 같다).
    if (row.supply_price <= 0) {
      return hasContent ? <>판매단가 <span style={{ ...resultNum, color: '#9ca3af' }}>—</span></> : null
    }
    return (
      <>
        판매단가 <b style={resultNum}>₩{numKR(row.unit_price)}</b>
        {/* 판매가 모드에만 **실현 이익률**을 붙인다 — 이익률 모드는 목표값이 바로 위
            토글 옆 칸에 있어 같은 수를 두 번 적는 꼴이 된다. 판매가 모드에는 그 칸이
            없어(₩ 입력으로 바뀐다) 이 줄이 이익률을 볼 수 있는 유일한 자리다. */}
        {priceInputMode && (
          // 이익이 나는 것이 보통이라 **평소 초록**이고, 원가 아래로 내려갈 때만 빨강이다
          // (늘 회색이면 좋은지 나쁜지 읽으려 멈춰야 한다). 소수 한 자리로 끊는다.
          <span style={{ color: belowCost ? '#dc2626' : '#16a34a', fontWeight: 700, whiteSpace: 'nowrap' }}>
            {' '}({row.realized_profit_rate.toFixed(1)}%)
          </span>
        )}
        {row.quantity > 1 && (
          <>
            <span style={{ color: '#d1d5db' }}> · </span>
            공급가 <b style={resultNum}>₩{numKR(row.supply_price)}</b>
            <span style={{ color: '#9ca3af' }}> (× {row.quantity})</span>
          </>
        )}
      </>
    )
  })()

  /** 숫자 칸 하나 — 오른쪽 정렬 입력 + 단위 기호(¥ · $ · 원). */
  const moneyCell = (opts: {
    value: number | null
    onChange: (v: string) => void
    unit: string
    placeholder: string
    title?: string
    extra?: React.ReactNode
  }) => (
    <label title={opts.title} style={{ ...boxBase, height: H_CELL, cursor: 'text' }}>
      <input className="q-bare" type="number" value={opts.value || ''}
        onChange={e => opts.onChange(e.target.value)}
        placeholder={opts.placeholder}
        style={{ ...bare, textAlign: 'right' }} />
      {opts.extra}
      <span style={prefix}>{opts.unit}</span>
    </label>
  )

  /** 글자 칸 하나 — 칸 안 접두 글자 + 입력. */
  const textCell = (opts: {
    label: string
    value: string
    onChange: (v: string) => void
    placeholder: string
    basis: string
    muted?: boolean
    title?: string
    extra?: React.ReactNode
    /** 가격표 검색 칸만 쓴다 — 후보 목록을 열고(onFocus) 화살표·Enter 를 받는다(onKeyDown). */
    onFocus?: () => void
    onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  }) => (
    <label title={opts.title} style={{
      ...boxBase, height: H_CELL, flex: `1 1 ${opts.basis}`, cursor: 'text',
      background: opts.muted ? '#f8fafc' : '#fff',
    }}>
      <span style={prefix}>{opts.label}</span>
      <input className="q-bare" value={opts.value}
        onChange={e => opts.onChange(e.target.value)}
        onFocus={opts.onFocus}
        onKeyDown={opts.onKeyDown}
        placeholder={opts.placeholder}
        style={{ ...bare, color: opts.muted ? '#6b7280' : '#111827' }} />
      {opts.extra}
    </label>
  )

  /** 모델 칸 — 직접 입력 줄만. 두는 자리는 양식이 정한다(80 은 품명 앞, 20 은 뒤). */
  const modelCell = row.row_kind === 'manual_jpy' ? textCell({
    label: '모델',
    value: row.manual_model,
    onChange: v => updateRow(row.id, 'manual_model', v),
    placeholder: '예: NEX 200',
    basis: '110px',
  }) : null

  return (
    <div style={{ background: '#f8fafc', borderRadius: 8, padding: '4px 8px', marginBottom: 6, border: '1px solid #e5e7eb' }}>
      {/* ── 머리줄 — 번호 · 종류 · 통화 · 줄 추가 · 삭제 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: GAP, height: 17 }}>
        {rowCount > 1 && (
          <span style={{ width: 17, height: 17, borderRadius: 999, background: '#234ea2', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0 }}>{rowIdx + 1}</span>
        )}
        <span style={badge}>{ROW_KIND_LABEL[row.row_kind]}</span>

        {/* 통화 — **직접 입력 줄만 고를 수 있다.** 고치면 그 줄의 원가가 그 통화의 환율로
            다시 계산된다(app/quote/calc.ts). 가격표 줄은 가격표가 정하므로 배지로만 알린다. */}
        {row.row_kind === 'manual_jpy' && (
          <select
            value={row.currency}
            onChange={e => updateRow(row.id, 'currency', e.target.value as Currency)}
            title="이 줄의 통화"
            style={{ ...badge, color: '#234ea2', border: 'none', cursor: 'pointer', height: 19, padding: '0 4px', appearance: 'none', textAlign: 'center' }}
          >
            {CURRENCIES.map(c => <option key={c} value={c}>{CURRENCY_SYMBOL[c]} {c}</option>)}
          </select>
        )}
        {row.row_kind === 'price_list' && row.selectedItem && (
          <span title="가격표가 정한 통화입니다 — 줄에서 바꿀 수 없습니다" style={badge}>
            {sym} {row.currency}
          </span>
        )}

        <span style={{ flex: 1 }} />

        {/* 줄 추가 — 품명 아래에 붙는 설명 줄(견적서 PDF 에 그대로 나간다). */}
        {/* 줄 추가 — **동작은 종전 그대로**다(useQuoteRows 의 addSubLine: 그 품목의
            subLines 에 빈 줄을 하나 더한다 = 품명 아래에 빈 설명 줄이 생긴다).
            아이콘만으로는 무엇이 추가되는지 알 수 없어 글자로 되돌린다. */}
        {canAddSubLine && (
          <button onClick={() => addSubLine(row.id)}
            title="품명 아래에 상세 설명 줄을 하나 더합니다"
            style={{ height: 18, padding: '0 5px', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, transition: 'color 0.15s ease' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#234ea2')}
            onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
            + 줄 추가
          </button>
        )}
        {rowCount > 1 && (
          <button onClick={() => removeRow(row.id)}
            title="줄 삭제"
            style={{ width: 20, height: 20, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'color 0.15s ease' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
            onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        )}
      </div>

      {/* ── 1단 — 무엇인가. 칸 **안**의 접두 글자가 바깥 라벨을 대신한다. ──
          검색 후보 목록은 **이 단 전체 폭**으로 펼친다(품번 칸 폭이 아니라). 품번·품명·모델이
          한 줄에 들어가야 고를 수 있는데, 140px 짜리 품번 칸 폭에서는 품명이 두 글자 만에
          잘렸다. 기준 상자(position:relative)와 바깥 클릭 감지(searchRef)가 여기 있는 이유다. */}
      <div ref={searchRef} style={{ position: 'relative', display: 'flex', gap: GAP, marginBottom: GAP, flexWrap: 'wrap' }}>
        {/* 가격표 검색(품번) — 선택한 품목의 item_code 가 그대로 표시된다. */}
        {row.row_kind === 'price_list' && (
          <>
            {textCell({
              label: '품번',
              value: searchQuery[row.id] || '',
              onChange: v => handleSearch(row.id, v),
              placeholder: '가격표 검색',
              basis: '140px',
              onFocus: () => setSearchOpen(prev => ({ ...prev, [row.id]: true })),
              onKeyDown: itemKeys.onKeyDown,
              extra: row.selectedItem ? (
                <button onClick={() => clearItem(row.id)}
                  title="품목 해제"
                  style={{ width: 16, height: 16, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              ) : null,
            })}
          </>
        )}

        {/* 후보 목록 — 한 줄에 **품번 · 시트 · 품명 · (모델)**, 그 아래 작은 글씨로 정가·구입가와
            오른쪽 끝 뱃지(재고·납기·최근 판매). 뱃지를 아래 줄 오른쪽 끝에 **한 줄로** 묶어
            두면 폭이 좁아도 세로로 깨지지 않는다. 줄 높이를 낮춰 한 번에 보이는 수를 늘렸다. */}
        {row.row_kind === 'price_list' && searchOpen[row.id] && itemResults.length > 0 && (
          <div ref={itemListRef} style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, zIndex: Z.inPage, background: '#fff', border: '1px solid #234ea2', borderRadius: 8, maxHeight: 300, overflowY: 'auto', boxShadow: '0 8px 24px rgba(35,78,162,0.12)' }}>
            {itemResults.map((item, i) => {
              const isym = CURRENCY_SYMBOL[toCurrency(item.currency)]
              const sale = recentSale(item.id, item.item_code)
              const hasStock = item.stock_quantity != null && item.stock_quantity > 0
              const hasDelivery = item.delivery_time != null
              return (
                <div key={item.id} onClick={() => { handleSelect(row.id, item); focusItemName() }}
                  style={{ padding: '5px 9px', cursor: 'pointer', borderBottom: '1px solid #ebebeb', transition: 'background 0.15s ease', background: itemKeys.active === i ? '#f0f4ff' : '#fff' }}
                  onMouseEnter={() => itemKeys.setActive(i)}>
                  {/* 1줄 — 무엇인가. 넘치면 품명부터 줄어든다(품번·모델은 끝까지 남는다). */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    <span style={{ fontWeight: 700, color: '#234ea2', flexShrink: 0 }}>{item.item_code}</span>
                    {/* 종류 배지 — 같은 품번이 SFG/CMM 양쪽에 있거나 묶음 제목으로 나뉠 때 어느 줄인지 보인다. */}
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '0 5px', flexShrink: 0 }}>{item.sheet_name}</span>
                    <span style={{ color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.item_name_jp}</span>
                    {item.model_jp && <span style={{ color: '#9ca3af', flexShrink: 0 }}>({item.model_jp})</span>}
                  </div>
                  {/* 2줄 — 왼쪽 금액, 오른쪽 끝 뱃지. 금액은 **그 가격표 줄의 통화**로 적는다
                      (달러 가격표가 섞여 있어, 기호 없이 숫자만 보면 150배를 잘못 읽는다). */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 1, fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      정가 {item.price_jpy == null ? '-' : `${isym}${item.price_jpy.toLocaleString()}`}
                      <span style={{ color: '#d1d5db' }}> · </span>
                      구입가 {item.cost_jpy == null ? '-' : `${isym}${item.cost_jpy.toLocaleString()}`}
                    </span>
                    <span style={{ flex: 1 }} />
                    {/* 최근 판매 — 같은 고객사에 마지막으로 판 단가. 없으면 내지 않는다. */}
                    {sale && (
                      <span title={`${sale.quoteNumber} · ${sale.quoteDate}`}
                        style={{ fontSize: 10, fontWeight: 700, padding: '0 5px', borderRadius: 6, background: '#e6ecf8', color: '#234ea2', flexShrink: 0 }}>
                        최근 ₩{numKR(sale.unitPrice)}
                      </span>
                    )}
                    {hasStock ? (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '0 5px', borderRadius: 6, background: '#dcfce7', color: '#15803d', flexShrink: 0 }}>
                        재고 {item.stock_quantity}개
                      </span>
                    ) : hasDelivery ? (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '0 5px', borderRadius: 6, background: '#fef9c3', color: '#854d0e', flexShrink: 0 }}>
                        발주 후 {item.delivery_time}주
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '0 5px', borderRadius: 6, background: '#fee2e2', color: '#b91c1c', flexShrink: 0 }}>
                        담당자 납기 문의
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 품번 직접 입력 — 직접 입력 품목 · 국내 구매 공용 */}
        {(row.row_kind === 'manual_jpy' || isDomestic) && textCell({
          label: '품번',
          value: row.partCode,
          onChange: v => updateRow(row.id, 'partCode', v),
          placeholder: '예: KT35000',
          basis: '110px',
        })}

        {/* 모델 — 80 양식은 품명에 「(모델)」로 들어가므로 품명 **앞**이다. */}
        {!is20 && modelCell}

        {/* 할인 — 견적서에 찍히는 문구만 고른다(로직은 동일) */}
        {/* 품명 — **회색 보조 칸**이되 고칠 수 있다. 그 글자가 견적서 PDF 에 그대로 나가고,
            품목을 고르면 커서가 맨 앞으로 와서 앞에 덧붙여 쓰는 방식이다(focusItemName). */}
        {/* ref 는 JSX 에 직접 단다 — 렌더 중에 ref 값을 넘기면 react-hooks/refs 에 걸린다
            (그 규칙의 뜻 그대로, 렌더는 ref 를 몰라야 한다). 그래서 이 칸만 손으로 적는다. */}
        {!isDiscount && (
          <label title={row.selectedItem ? '가격표 품명 — 고칠 수 있습니다' : undefined}
            style={{ ...boxBase, height: H_CELL, flex: '1 1 140px', cursor: 'text' }}>
            <span style={prefix}>품명</span>
            <input ref={itemNameRef} className="q-bare" value={row.itemText}
              onChange={e => updateRow(row.id, 'itemText', e.target.value)}
              onFocus={closeSearch}
              placeholder="예: 스타일러스"
              style={{ ...bare, color: '#6b7280' }} />
          </label>
        )}

        {/* 20 견적서의 모델 칸 — 품번 → 품명 → 모델 순서다(그 양식의 열 순서와 같다). */}
        {is20 && modelCell}
      </div>

      {/* 상세 줄 — 품명 아래에 그대로 붙는다(견적서 PDF 에 나가는 글자다). */}
      {row.subLines.length > 0 && (
        <div style={{ marginBottom: GAP }}>
          {/* 삭제는 **칸 안** 오른쪽 끝이다. 바깥에 ✕ 를 두면 그만큼 칸이 짧아지는데,
              이 줄은 견적서에 그대로 나가는 글이라 폭이 가장 아쉬운 자리다. */}
          {row.subLines.map((line, li) => (
            <label key={li} style={{ ...boxBase, height: H_SUB, cursor: 'text', marginBottom: 3, paddingRight: 2 }}>
              <span style={prefix}>·</span>
              <input className="q-bare" value={line} onChange={e => updateSubLine(row.id, li, e.target.value)}
                placeholder="예: - Leaf Spring 교체" style={{ ...bare, fontSize: 11 }} />
              <button onClick={() => removeSubLine(row.id, li)}
                title="이 설명 줄 지우기"
                // 누르는 자리는 24px 로 넉넉히 두고, 보이는 아이콘만 작다.
                style={{ width: 24, height: 24, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'color 0.15s ease' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#6b7280')}
                onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
            </label>
          ))}
        </div>
      )}

      {/* 줄별 분류·묶음 — 켠 견적에만 나온다. 둘 다 켜면 한 단에 나란히 둔다. */}
      {((lineSplitOn && canSplitRowKind(row.row_kind)) || (equipForm && canGroupRowKind(row.row_kind))) && (
        <div style={{ display: 'flex', gap: GAP, marginBottom: GAP }}>
          {/* 비워 두면 견적 분류를 따른다(= quote_items.category 가 null 로 저장된다). */}
          {lineSplitOn && canSplitRowKind(row.row_kind) && (
            <select
              className="q-input"
              value={row.category ?? ''}
              onChange={e => setRowCategory(row.id, e.target.value)}
              title="줄 분류"
              style={{ ...inp, height: H_CELL, padding: '0 8px', flex: 1, minWidth: 0, cursor: 'pointer', color: row.category ? '#111827' : '#9ca3af' }}
            >
              <option value="">분류: 견적 분류 그대로</option>
              {categories.map(c => (
                <option key={c.code} value={c.code}>분류: {c.label}</option>
              ))}
            </select>
          )}
          {/* 장비 구성 묶음 — 비워 두면 그룹 없이 PDF 맨 뒤에 붙는다. 7단계 구성 모달이 이 값을 대신 채운다. */}
          {equipForm && canGroupRowKind(row.row_kind) && (
            <select
              className="q-input"
              value={row.group_kind ?? ''}
              onChange={e => setRowGroupKind(row.id, e.target.value)}
              title="장비 구성 묶음"
              style={{ ...inp, height: H_CELL, padding: '0 8px', flex: 1, minWidth: 0, cursor: 'pointer', color: row.group_kind ? '#111827' : '#9ca3af' }}
            >
              <option value="">묶음 없음</option>
              {GROUP_KINDS.map(k => (
                <option key={k} value={k}>묶음: {GROUP_LABELS[k]}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* ── 2단 — 얼마인가. 3칸 격자(구입가 1.2 : 수량 1 : 관세 1). ──
          국내 구매는 관세가 없어 두 칸이다(구입가·수량). */}
      {!isDiscount && !isService && (
        <div style={{
          display: 'grid', gap: GAP, marginBottom: GAP,
          gridTemplateColumns: isDomestic ? '1.2fr 1fr' : '1.2fr 1fr 1fr',
        }}>
          {/* 가격표 품목의 구입가 — **직접 고칠 수 있다.** 가격표 값은 selectedItem 에 그대로
              남아 있어 언제든 되돌릴 수 있다(cost_jpy_override). 칸을 비우면 가격표 값으로
              돌아간다(null). 고치면 원가·단가·이익률이 함께 다시 계산된다. */}
          {row.row_kind === 'price_list' && moneyCell({
            value: shownCostJpy,
            onChange: v => updateRow(row.id, 'cost_jpy_override', v.trim() === '' ? null : (parseInt(v) || 0)),
            unit: sym,
            placeholder: '구입가',
            title: '가격표 구입가 — 고치면 원가가 따라 바뀝니다',
            extra: costEdited ? (
              <button onClick={() => updateRow(row.id, 'cost_jpy_override', null)}
                title={`가격표 값(${sym}${listCostJpy == null ? '-' : numKR(listCostJpy)})으로 되돌리기`}
                style={{ width: 16, height: 16, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                onMouseEnter={e => (e.currentTarget.style.color = '#234ea2')}
                onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                </svg>
              </button>
            ) : null,
          })}

          {/* 직접 입력 품목 — 구입가(그 줄의 통화). 국내 구매 — **원화** 원가를 직접 넣는다
              (칸은 manual_cost_jpy 를 쓴다. 이 줄에서는 원화다 — app/quote/calc.ts 의 ⚠ 참고). */}
          {(row.row_kind === 'manual_jpy' || isDomestic) && moneyCell({
            value: row.manual_cost_jpy,
            onChange: v => updateRow(row.id, 'manual_cost_jpy', parseInt(v) || 0),
            unit: isDomestic ? '원' : sym,
            placeholder: isDomestic ? '국내 구입가' : '구입가',
          })}

          <div title="수량" style={{ ...boxBase, height: H_CELL, padding: '0 5px' }}>
            <button onClick={() => updateRow(row.id, 'quantity', Math.max(1, row.quantity - 1))} style={stepBtn}>−</button>
            <span style={stepVal}>{row.quantity}<span style={{ color: '#9ca3af', fontWeight: 400 }}>개</span></span>
            <button onClick={() => updateRow(row.id, 'quantity', row.quantity + 1)} style={stepBtn}>+</button>
          </div>

          {!isDomestic && (
            <div title="관세율" style={{ ...boxBase, height: H_CELL, padding: '0 5px' }}>
              <button onClick={() => updateRow(row.id, 'tariff_rate', parseFloat((row.tariff_rate - 0.01).toFixed(2)))} style={stepBtn}>−</button>
              <span style={stepVal}><span style={{ color: '#9ca3af', fontWeight: 400 }}>×</span>{row.tariff_rate.toFixed(2)}</span>
              <button onClick={() => updateRow(row.id, 'tariff_rate', parseFloat((row.tariff_rate + 0.01).toFixed(2)))} style={stepBtn}>+</button>
            </div>
          )}
        </div>
      )}

      {/* 할인 — 깎을 금액을 양수로 입력한다(계산에는 음수로 들어간다) */}
      {/* 할인 — **한 줄이다.** 이름과 깎을 금액 둘뿐이라 단을 나눌 것이 없다.
          이름은 견적서 PDF 의 품명 칸에 **그 글자 그대로** 나가고 저장도 그 글자다
          (quote_items.product_name). 종전 슬라이딩 토글은 고를 수 있는 글자가 둘뿐이라
          그 밖의 말을 쓸 수 없었다 — 이제 ▾ 로 둘을 고르고, 더블클릭하면 직접 쓴다.
          옛 견적은 저장된 글자를 그대로 되살리므로 그대로 보인다. */}
      {isDiscount && (
        <div style={{ display: 'flex', gap: GAP, marginBottom: GAP }}>
          <div ref={discountMenuRef} style={{ position: 'relative', flex: '0 0 150px', minWidth: 0 }}>
            {editingDiscountName ? (
              <label style={{ ...boxBase, height: H_CELL, cursor: 'text' }}>
                <input
                  autoFocus
                  className="q-bare"
                  value={row.itemText}
                  onChange={e => updateRow(row.id, 'itemText', e.target.value)}
                  onBlur={() => setEditingDiscountName(false)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur() }}
                  placeholder="예: SPECIAL DISCOUNT"
                  style={{ ...bare, fontWeight: 700 }}
                />
              </label>
            ) : (
              <div
                onDoubleClick={() => setEditingDiscountName(true)}
                title="더블클릭하면 이름을 직접 쓸 수 있습니다"
                style={{ ...boxBase, height: H_CELL, cursor: 'default' }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.itemText || DISCOUNT_LABELS[0]}
                </span>
                <button
                  onClick={() => setDiscountMenu(v => !v)}
                  title="자주 쓰는 이름"
                  style={{ width: 16, height: 16, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 10, lineHeight: 1, flexShrink: 0 }}
                >▾</button>
              </div>
            )}
            {/* 자주 쓰는 이름 — 고르면 그 글자가 그대로 들어간다(값이 아니라 글자다). */}
            {discountMenu && !editingDiscountName && (
              <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, zIndex: Z.inPage, background: '#fff', border: '1px solid #234ea2', borderRadius: 6, boxShadow: '0 8px 24px rgba(35,78,162,0.12)', overflow: 'hidden' }}>
                {DISCOUNT_LABELS.map(label => (
                  <button
                    key={label}
                    onClick={() => { updateRow(row.id, 'itemText', label); setDiscountMenu(false) }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', border: 'none', background: row.itemText === label ? '#f0f4ff' : '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap' }}
                  >{label}</button>
                ))}
                <button
                  onClick={() => { setDiscountMenu(false); setEditingDiscountName(true) }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', border: 'none', borderTop: '1px solid #ebebeb', background: '#fff', cursor: 'pointer', fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}
                >직접 쓰기…</button>
              </div>
            )}
          </div>
          {moneyCell({
            value: row.manual_unit_price,
            onChange: v => updateRow(row.id, 'manual_unit_price', parseInt(v) || 0),
            unit: '원',
            placeholder: '깎을 금액',
          })}
        </div>
      )}

      {/* 서비스비 — 금액 직접 입력 + 부대비용 내역(원가). 부대비용 블록은 그대로다. */}
      {isService && (
        <>
          <div style={{ marginBottom: GAP }}>
            {moneyCell({
              value: row.manual_unit_price,
              onChange: v => updateRow(row.id, 'manual_unit_price', parseInt(v) || 0),
              unit: '원',
              placeholder: '서비스 금액',
            })}
          </div>

          <ExpenseSection
            row={row}
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
        </>
      )}

      {/* ── 3단 — 어떻게 파는가. 2칸 격자: [이익률|판매가] 토글 · 값 칸. ──
          발주서가 먼저 온 건은 고객이 정한 금액이 있어, 이익률을 더듬는 대신 그 단가를
          그대로 넣는다(판매가 모드). 그때 값 칸은 ₩ 입력이 된다. */}
      {hasPriceMode && (
        <div style={{ display: 'grid', gap: GAP, gridTemplateColumns: '1fr 1fr' }}>
          <SegmentedControl
            options={[{ label: '이익률', value: 'rate' }, { label: '판매가', value: 'price' }]}
            value={row.price_mode}
            onChange={v => updateRow(row.id, 'price_mode', v)}
            equal
            height={H_CELL}
          />
          {priceInputMode ? moneyCell({
            value: row.manual_unit_price,
            onChange: v => updateRow(row.id, 'manual_unit_price', parseInt(v) || 0),
            unit: '원',
            placeholder: '판매단가',
            title: '고객이 정한 판매단가를 그대로 넣습니다',
          }) : (
            <div title="이익률 — 눌러서 직접 입력" style={{ ...boxBase, height: H_CELL, padding: '0 5px' }}>
              <button onClick={() => updateRow(row.id, 'profit_rate', Math.max(0, row.profit_rate - 5))} style={stepBtn}>−</button>
              {editingProfitRate[row.id] ? (
                <input
                  autoFocus
                  type="number"
                  value={profitRateInput[row.id] ?? ''}
                  onChange={e => setProfitRateInput(p => ({ ...p, [row.id]: e.target.value }))}
                  onBlur={() => {
                    const v = Math.min(95, Math.max(0, parseInt(profitRateInput[row.id] || '0') || 0))
                    updateRow(row.id, 'profit_rate', v)
                    setEditingProfitRate(p => ({ ...p, [row.id]: false }))
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
                  }}
                  style={{ ...bare, textAlign: 'center', fontWeight: 500, border: '1px solid #234ea2', borderRadius: 6, padding: '1px 2px' }}
                />
              ) : (
                <span
                  onClick={() => { setEditingProfitRate(p => ({ ...p, [row.id]: true })); setProfitRateInput(p => ({ ...p, [row.id]: String(row.profit_rate) })) }}
                  style={{ ...stepVal, color: row.profit_rate >= 40 ? '#16a34a' : '#dc2626', cursor: 'text' }}
                >{row.profit_rate}%</span>
              )}
              <button onClick={() => updateRow(row.id, 'profit_rate', Math.min(95, row.profit_rate + 5))} style={stepBtn}>+</button>
            </div>
          )}
        </div>
      )}

      {/* ── 결과 줄 — 그 줄이 얼마가 되는가. 왼쪽에는 「최근 판매」(같은 고객사에 마지막으로
          판 단가)를 둔다 — 단가를 정할 때 가장 먼저 보는 값이라 결과 바로 옆이 제자리다. ── */}
      {(result || mySale || belowCost) && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2, minWidth: 0, lineHeight: 1.25 }}>
          {/* 원가 아래로 판 줄 — 오른쪽 %만 붉히면 작아서 지나친다. 왼쪽에 말로 적는다. */}
          {belowCost && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', whiteSpace: 'nowrap', flexShrink: 0 }}>
              원가보다 낮음
            </span>
          )}
          {mySale && (
            <span title={`${mySale.quoteNumber} · ${mySale.quoteDate}`}
              style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              최근 판매 <span style={{ color: '#234ea2', fontWeight: 600 }}>₩{numKR(mySale.unitPrice)}</span>
            </span>
          )}
          <span style={{ flex: 1 }} />
          {result && (
            <span className="num" style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {result}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
