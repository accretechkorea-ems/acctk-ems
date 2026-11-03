'use client'

import React, { useCallback, useMemo, useRef } from 'react'
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
const H_FIELD = 26      // 글자 칸 높이
const H_CELL = 32       // 2단 격자 칸 높이(구입가·수량·관세)
const H_MODE = 28       // 3단 칸 높이(토글·이익률·판매단가) — 2단보다 한 급 낮다
const GAP = 3           // 칸 사이·단 사이 여백

/** 칸 테두리 상자 — 접두 글자와 입력을 한 테두리 안에 담는다. */
const boxBase: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, boxSizing: 'border-box',
  border: '1px solid #ebebeb', borderRadius: 6, background: '#fff', padding: '0 8px',
}
/** 칸 안 접두 글자 — 「품번」「품명」「¥」. 바깥 라벨을 대신한다. */
const prefix: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap',
}
/** 테두리를 상자에 넘긴 입력. */
const bare: React.CSSProperties = {
  flex: 1, minWidth: 0, width: '100%', border: 'none', outline: 'none', background: 'transparent',
  fontSize: 12, color: '#111827', padding: 0, boxSizing: 'border-box',
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
/** 요약 한 줄 — **접지 않는다.** 넘치면 말줄임으로 끊는다(두 줄 고정이 무너지지 않게). */
const sumLine: React.CSSProperties = {
  fontSize: 11, color: '#9ca3af', lineHeight: 1.45,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}
/** 요약 속 숫자 — 글자는 흐리고 숫자만 진하다. */
const numStrong: React.CSSProperties = { color: '#111827', fontWeight: 600 }

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

  // ── 계산 요약: 점선 아래 **두 줄 고정** ───────────────────────────────
  //
  //   1줄  원가 ₩253,283 = ¥13,200 × 8.49 × 1.13
  //   2줄  공급가 ₩508,000 (× 2) · 부가세 ₩50,800 · 이익 50%
  //
  // 접지 않는다 — 줄 수가 값에 따라 달라지면 카드 높이가 들쑥날쑥해서 여러 줄을 훑을 때
  // 눈이 자리를 다시 찾아야 한다. 넘치면 말줄임으로 끊는다.
  const costSummary: React.ReactNode | null = (() => {
    if (isDiscount) {
      return row.supply_price < 0
        ? <>할인 <span style={numStrong}>−₩{numKR(Math.abs(row.supply_price))}</span></>
        : null
    }
    if (isService) {
      return row.product_price > 0
        ? <>원가 <span style={numStrong}>₩{numKR(row.product_price)}</span> = 부대비용 {row.expenses.length}건</>
        : null
    }
    if (isDomestic) {
      return row.product_price > 0
        ? <>원가 <span style={numStrong}>₩{numKR(row.product_price)}</span> = ₩{numKR(row.cost_price_jpy)} × {row.quantity}<span style={{ color: '#d1d5db' }}> (환율·관세 없음)</span></>
        : null
    }
    return row.product_price > 0
      ? (
        <>
          원가 <span style={numStrong}>₩{numKR(row.product_price)}</span>
          {' = '}{sym}<span style={numStrong}>{numKR(row.cost_price_jpy)}</span>
          {' × '}{row.exchange_rate.toFixed(2)}
          {' × '}{row.tariff_rate.toFixed(2)}
          {/* 구입가를 고친 줄 — 가격표에 적힌 값이 얼마였는지 같은 줄 끝에 남긴다. */}
          {costEdited && <span style={{ color: '#d1d5db' }}> (가격표 {sym}{listCostJpy == null ? '-' : numKR(listCostJpy)})</span>}
        </>
      )
      : null
  })()

  const saleSummary: React.ReactNode | null = (() => {
    if (isDiscount) {
      return row.supply_price < 0 ? <>부가세 <span style={numStrong}>−₩{numKR(Math.abs(row.tax))}</span></> : null
    }
    if (row.supply_price <= 0) return null
    return (
      <>
        공급가 <span style={numStrong}>₩{numKR(row.supply_price)}</span>
        {!isService && <span style={{ color: '#d1d5db' }}> (× {row.quantity})</span>}
        <span style={{ color: '#d1d5db' }}> · </span>
        부가세 <span style={numStrong}>₩{numKR(row.tax)}</span>
        {!isService && (
          <>
            <span style={{ color: '#d1d5db' }}> · </span>
            이익 <span style={{ color: row.realized_profit_rate < 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
              {row.realized_profit_rate.toFixed(0)}%
            </span>
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
    /** 칸 높이 — 적지 않으면 2단 격자 높이(32)다. */
    height?: number
  }) => (
    <label title={opts.title} style={{ ...boxBase, height: opts.height ?? H_CELL, cursor: 'text' }}>
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
      ...boxBase, height: H_FIELD, flex: `1 1 ${opts.basis}`, cursor: 'text',
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
    <div style={{ background: '#ffffff', borderRadius: 8, padding: '6px 10px', marginBottom: 7, border: '1px solid #ebebeb' }}>
      {/* ── 머리줄 — 번호 · 종류 · 통화 · 줄 추가 · 삭제 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: GAP, height: 18 }}>
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
        {canAddSubLine && (
          <button onClick={() => addSubLine(row.id)}
            title="상세 내용 줄 추가"
            style={{ width: 20, height: 20, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'color 0.15s ease' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#234ea2')}
            onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
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

      {/* ── 1단 — 무엇인가. 칸 **안**의 접두 글자가 바깥 라벨을 대신한다. ── */}
      <div style={{ display: 'flex', gap: GAP, marginBottom: GAP, flexWrap: 'wrap' }}>
        {/* 가격표 검색(품번) — 선택한 품목의 item_code 가 그대로 표시된다. */}
        {row.row_kind === 'price_list' && (
          <div ref={searchRef} style={{ position: 'relative', flex: '1 1 140px', minWidth: 0, display: 'flex' }}>
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
            {/* 검색 칸의 키보드·열림은 textCell 바깥에서 붙인다 — 아래 숨은 입력이 아니라
                위 입력에 직접 걸기 위해 onFocus·onKeyDown 을 가로채는 덮개를 두지 않는다. */}
            {searchOpen[row.id] && itemResults.length > 0 && (
              <div ref={itemListRef} style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: Z.inPage, background: '#fff', border: '1px solid #234ea2', borderRadius: 8, maxHeight: 200, overflowY: 'auto', boxShadow: '0 8px 24px rgba(35,78,162,0.12)' }}>
                {itemResults.map((item, i) => (
                  <div key={item.id} onClick={() => { handleSelect(row.id, item); focusItemName() }}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #ebebeb', fontSize: 11, transition: 'background 0.15s ease', background: itemKeys.active === i ? '#f0f4ff' : '#fff' }}
                    onMouseEnter={() => itemKeys.setActive(i)}>
                    <div>
                      <span style={{ fontWeight: 700, color: '#234ea2' }}>{item.item_code}</span>
                      {/* 종류 배지 — 같은 품번이 SFG/CMM 양쪽에 있거나 묶음 제목으로 나뉠 때 어느 줄인지 보인다. */}
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '1px 6px' }}>{item.sheet_name}</span>
                      <span style={{ marginLeft: 6, color: '#111827' }}>{item.item_name_jp}</span>
                      <span style={{ marginLeft: 6, color: '#6b7280' }}>({item.model_jp})</span>
                    </div>
                    <div style={{ color: '#9ca3af', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {/* 후보의 금액 — **그 가격표 줄의 통화**로 적는다(줄이 고른 통화가 아니다).
                          달러 가격표(SBS-USD)가 섞여 있어, 기호 없이 숫자만 보면 150배를 잘못 읽는다. */}
                      {(() => {
                        const isym = CURRENCY_SYMBOL[toCurrency(item.currency)]
                        return <span>정가: {isym}{item.price_jpy?.toLocaleString()} / 구입가: {isym}{item.cost_jpy?.toLocaleString()}</span>
                      })()}
                      {/* 최근 판매 — 같은 고객사에 마지막으로 판 단가. 없으면 아무것도 내지 않는다. */}
                      {(() => {
                        const sale = recentSale(item.id, item.item_code)
                        if (!sale) return null
                        return (
                          <span title={`${sale.quoteNumber} · ${sale.quoteDate}`}
                            style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#e6ecf8', color: '#234ea2' }}>
                            최근 판매 ₩{numKR(sale.unitPrice)}
                          </span>
                        )
                      })()}
                      {(() => {
                        const hasStock = item.stock_quantity != null && item.stock_quantity > 0
                        const hasDelivery = item.delivery_time != null
                        if (hasStock) return (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#dcfce7', color: '#15803d' }}>
                            재고 {item.stock_quantity}개
                          </span>
                        )
                        if (hasDelivery) return (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#fef9c3', color: '#854d0e' }}>
                            발주 후 {item.delivery_time}주
                          </span>
                        )
                        return (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#fee2e2', color: '#b91c1c' }}>
                            담당자 납기 문의
                          </span>
                        )
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
        {isDiscount && (
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <SegmentedControl
              options={DISCOUNT_LABELS.map(v => ({ label: v, value: v }))}
              value={row.itemText}
              onChange={v => updateRow(row.id, 'itemText', v)}
              equal
              height={H_FIELD}
            />
          </div>
        )}

        {/* 품명 — **회색 보조 칸**이되 고칠 수 있다. 그 글자가 견적서 PDF 에 그대로 나가고,
            품목을 고르면 커서가 맨 앞으로 와서 앞에 덧붙여 쓰는 방식이다(focusItemName). */}
        {/* ref 는 JSX 에 직접 단다 — 렌더 중에 ref 값을 넘기면 react-hooks/refs 에 걸린다
            (그 규칙의 뜻 그대로, 렌더는 ref 를 몰라야 한다). 그래서 이 칸만 손으로 적는다. */}
        {!isDiscount && (
          <label title={row.selectedItem ? '가격표 품명 — 고칠 수 있습니다' : undefined}
            style={{ ...boxBase, height: H_FIELD, flex: '1 1 140px', cursor: 'text', background: '#f8fafc' }}>
            <span style={prefix}>품명</span>
            <input ref={itemNameRef} className="q-bare" value={row.itemText}
              onChange={e => updateRow(row.id, 'itemText', e.target.value)}
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
          {row.subLines.map((line, li) => (
            <div key={li} style={{ display: 'flex', alignItems: 'center', gap: GAP, marginBottom: 3 }}>
              <label style={{ ...boxBase, height: 24, flex: 1, cursor: 'text' }}>
                <span style={prefix}>·</span>
                <input className="q-bare" value={line} onChange={e => updateSubLine(row.id, li, e.target.value)}
                  placeholder="예: - Leaf Spring 교체" style={{ ...bare, fontSize: 11 }} />
              </label>
              <button onClick={() => removeSubLine(row.id, li)}
                title="상세 줄 삭제"
                style={{ width: 18, height: 18, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
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
              style={{ ...inp, height: H_FIELD, padding: '0 8px', flex: 1, minWidth: 0, cursor: 'pointer', color: row.category ? '#111827' : '#9ca3af' }}
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
              style={{ ...inp, height: H_FIELD, padding: '0 8px', flex: 1, minWidth: 0, cursor: 'pointer', color: row.group_kind ? '#111827' : '#9ca3af' }}
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
            <span style={stepVal}>{row.quantity}<span style={{ color: '#9ca3af' }}>개</span></span>
            <button onClick={() => updateRow(row.id, 'quantity', row.quantity + 1)} style={stepBtn}>+</button>
          </div>

          {!isDomestic && (
            <div title="관세율" style={{ ...boxBase, height: H_CELL, padding: '0 5px' }}>
              <button onClick={() => updateRow(row.id, 'tariff_rate', parseFloat((row.tariff_rate - 0.01).toFixed(2)))} style={stepBtn}>−</button>
              <span style={stepVal}>×{row.tariff_rate.toFixed(2)}</span>
              <button onClick={() => updateRow(row.id, 'tariff_rate', parseFloat((row.tariff_rate + 0.01).toFixed(2)))} style={stepBtn}>+</button>
            </div>
          )}
        </div>
      )}

      {/* 할인 — 깎을 금액을 양수로 입력한다(계산에는 음수로 들어간다) */}
      {isDiscount && (
        <div style={{ marginBottom: GAP }}>
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
            height={H_MODE}
          />
          {priceInputMode ? moneyCell({
            value: row.manual_unit_price,
            onChange: v => updateRow(row.id, 'manual_unit_price', parseInt(v) || 0),
            unit: '원',
            placeholder: '판매단가',
            title: '고객이 정한 판매단가를 그대로 넣습니다',
            height: H_MODE,
          }) : (
            <div title="이익률 — 눌러서 직접 입력" style={{ ...boxBase, height: H_MODE, padding: '0 5px' }}>
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

      {/* ── 결과 줄 — 이익률 모드면 계산된 판매단가, 판매가 모드면 실현 이익률. ──
          왼쪽에는 「최근 판매」(같은 고객사에 마지막으로 판 단가)를 둔다 — 단가를 정할 때
          가장 먼저 보는 값이라 결과 바로 옆이 제자리다. */}
      {/* 아직 아무 값도 없는 줄에는 내지 않는다 — 「판매단가 ₩0」은 알려 주는 것이 없고,
          그 한 줄 때문에 빈 줄이 23px 높아진다(줄을 막 추가한 직후가 가장 흔한 상태다). */}
      {((hasPriceMode && row.unit_price > 0) || mySale) && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 3, minWidth: 0 }}>
          {mySale && (
            <span title={`${mySale.quoteNumber} · ${mySale.quoteDate}`}
              style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              최근 판매 <span style={{ color: '#234ea2', fontWeight: 600 }}>₩{numKR(mySale.unitPrice)}</span>
            </span>
          )}
          <span style={{ flex: 1 }} />
          {hasPriceMode && (
            priceInputMode ? (
              <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                실현 이익률{' '}
                <b style={{ fontSize: 12, color: row.realized_profit_rate < 0 ? '#dc2626' : '#111827' }}>
                  {row.realized_profit_rate.toFixed(1)}%
                </b>
              </span>
            ) : (
              <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                판매단가 <b style={{ fontSize: 12, color: '#111827' }}>₩{numKR(row.unit_price)}</b>
              </span>
            )
          )}
        </div>
      )}

      {/* ── 계산 요약 — 점선 아래 두 줄. 값이 아직 없으면 자리도 두지 않는다. ── */}
      {(costSummary || saleSummary) && (
        <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px dashed #ebebeb' }}>
          <div style={sumLine}>{costSummary}</div>
          <div style={sumLine}>{saleSummary}</div>
        </div>
      )}
    </div>
  )
}
