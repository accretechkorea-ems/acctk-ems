'use client'

import React, { useCallback, useMemo, useRef } from 'react'
import { useOutsideClick } from '@/hooks/useOutsideClick'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import SegmentedControl from '@/components/common/SegmentedControl'
import type { PriceItem, QuoteRow, RowKind } from './types'
import type { QuoteRowsActions, QuoteRowsCtx } from '@/hooks/quote/useQuoteRows'
import type { RecentSaleLookup } from '@/hooks/quote/useRecentSales'
import { canSplitRowKind } from '@/lib/quoteCategories'
import { GROUP_KINDS, GROUP_LABELS, canGroupRowKind, isGeneral20Form } from '@/lib/quoteForms'
import { numKR } from './format'
import { costOf } from './calc'
import { CURRENCIES, CURRENCY_SYMBOL, toCurrency, type Currency } from '@/lib/quoteCurrency'
import { DISCOUNT_LABELS } from './types'
import { inp } from './styles'
import ExpenseSection from './ExpenseSection'
import { Z } from '@/lib/zIndex'

// 후보가 없을 때 쓰는 고정 빈 배열 — 렌더마다 새 배열을 만들지 않기 위해 모듈 상수로 둔다.
const EMPTY_ITEMS: PriceItem[] = []

// 행 카드 헤더에 붙는 종류 이름. 색 구분 없이 전부 같은 회색 배지로 쓴다.
const KIND_LABEL: Record<RowKind, string> = {
  price_list: '가격표 검색',
  manual_jpy: '수동 입력',
  domestic: '국내 조달품',
  service: '서비스 비용',
  discount: '할인',
}

// ── 줄 높이 ─────────────────────────────────────────────────────────────────
//
// 2026-11-03 에 칸 배치를 **다섯 단에서 세 단으로** 줄였다. 품목이 예닐곱 줄인 견적에서
// 한 줄이 245px 이면 스테퍼 하나 고치려고 화면을 세 번 굴려야 했다 — 줄 사이를 오가는 일이
// 작성의 대부분인데 그때마다 위아래 맥락이 사라진다.
//
// 줄인 방법은 **칸 위의 라벨을 없앤 것**이다(placeholder·기호로 대신한다). 라벨 줄 하나가
// 15px + 여백이고, 칸마다 왼쪽에 44px 라벨 칸을 비워 두느라 입력 폭도 좁았다.
// **칸과 정보는 하나도 빼지 않았다** — 자리만 바꿨다.
//
//   1단 — 무엇인가:  검색 / 품번 · 모델 · 품명
//   2단 — 얼마인가:  구입가(통화 기호) · 수량 · 관세율 · 판매단가
//   3단 — 어떻게 파는가: 이익률 | 판매가 토글 + 계산 요약 한 줄
const H = 30            // 칸 높이(종전 34)
const GAP = 6           // 칸 사이·단 사이 여백(종전 8)

/** 글자 칸 — 라벨 없이 placeholder 로 쓴다. */
const field: React.CSSProperties = { ...inp, height: H, padding: '0 9px', width: '100%' }
/** 스테퍼·숫자 칸의 테두리 상자. */
const box: React.CSSProperties = {
  height: H, border: '1px solid #ebebeb', borderRadius: 6, display: 'flex', alignItems: 'center',
  padding: '0 6px', gap: 4, minWidth: 0, boxSizing: 'border-box', background: '#fff',
}
/** 스테퍼의 −/+ 단추. */
const stepBtn: React.CSSProperties = {
  width: 18, height: 18, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
  color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0,
}
/** 스테퍼 가운데 값. */
const stepVal: React.CSSProperties = {
  flex: 1, minWidth: 0, textAlign: 'center', fontSize: 12, fontWeight: 500,
  whiteSpace: 'nowrap', overflow: 'visible', color: '#111827',
}
/** 한 단(가로 묶음). */
const band: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: GAP, marginBottom: GAP, flexWrap: 'wrap' }
/** 칸 안 오른쪽에 붙는 단위 기호(¥ · $ · 원). */
const unitMark: React.CSSProperties = {
  position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
  fontSize: 12, color: '#9ca3af', pointerEvents: 'none',
}

// 품목 행 카드 1개(일반 품목 / 서비스비 공용). page.tsx 의 rows.map 본문을 그대로 옮긴 것.
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

  // 판매가 산출 방식을 고를 수 있는 종류 — 가격표 품목과 수동입력 품목.
  // (서비스비·할인은 금액을 직접 받으므로 해당 없음)
  // 국내조달품도 이익률로 역산하거나 판매단가를 직접 넣는다(2026-10-23 — 일반 품목이 됐다).
  const hasPriceMode = row.row_kind === 'price_list' || row.row_kind === 'manual_jpy' || row.row_kind === 'domestic'
  // '판매가' 모드 — 판매단가 칸이 입력이 되고 이익률은 결과(실현 이익률)로만 보인다.
  const priceInputMode = hasPriceMode && row.price_mode === 'price'
  // 국내조달품 — 마진이 없어 관세율 스테퍼가 필요 없다(원가가 이미 원화다).
  const isDomestic = row.row_kind === 'domestic'
  // 할인 — 라벨과 금액만 받는다. 품번·상세줄·수량·이익률·관세는 쓰지 않는다.
  const isDiscount = row.row_kind === 'discount'
  /** 20 견적서인가 — 수동 입력 칸 순서(품번 → 품명 → 모델)가 그 양식의 열 순서를 따른다. */
  const is20 = isGeneral20Form(formKind)
  // 가격표 품목의 구입가 — 줄에서 직접 고칠 수 있다(2026-11-02).
  //   listCostJpy — 가격표에 적힌 값(정본). selectedItem 은 손대지 않으므로 늘 남아 있다.
  //   shownCostJpy— 지금 계산에 쓰는 값(고친 값이 있으면 그것).
  //   costEdited  — 둘이 다른가 → 칸 옆에 되돌리기를, 요약에 가격표 값을 낸다.
  /** 이 줄의 통화 기호 — 구입가 칸·요약에 붙는다(원화 줄은 쓰지 않는다). */
  const sym = CURRENCY_SYMBOL[row.currency]
  const listCostJpy = row.selectedItem?.cost_jpy ?? null
  const shownCostJpy = costOf(row)
  const costEdited = row.cost_jpy_override !== null && row.cost_jpy_override !== listCostJpy

  // 품목을 고르면 품명 칸으로 커서를 옮긴다. 위치는 맨 앞(자동으로 들어간 모델명 앞에 이어 적도록).
  // 품명 값이 갱신된 뒤에 커서를 잡아야 해서 다음 프레임에서 실행한다.
  const itemNameRef = useRef<HTMLInputElement>(null)
  const focusItemName = () => requestAnimationFrame(() => {
    const el = itemNameRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(0, 0)
  })

  /**
   * 모델 직접 입력 — 수동입력 품목만(국내조달품은 견적서에 모델이 나가지 않는다).
   * 20 견적서의 모델 열과 80 견적서 품명의 「(모델)」이 이 값을 읽는다.
   * 두는 자리만 양식에 따라 다르다(품명 앞이냐 뒤냐).
   */
  const modelField = row.row_kind === 'manual_jpy' ? (
    <input className="q-input" value={row.manual_model}
      onChange={e => updateRow(row.id, 'manual_model', e.target.value)}
      placeholder="모델 (예: NEX 200)" style={{ ...field, flex: '1 1 26%', minWidth: 88 }} />
  ) : null

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

  // ── 계산 요약 ──────────────────────────────────────────────────────────
  //
  // 종전에는 항목마다 줄을 나눠 최대 다섯 줄이었다. 지금은 **한 줄에 이어 붙이고** 폭이
  // 모자랄 때만 접힌다(가운뎃점으로 나눈다). 값은 하나도 빼지 않았다 —
  // 최근 판매 · 원가식 · 공급가식 · 부가세 · 실현 이익률 · 고치기 전 가격표 값.
  const summaryParts: React.ReactNode[] = []
  if (mySale) {
    summaryParts.push(
      <>최근 판매 <b style={{ color: '#234ea2' }}>₩{numKR(mySale.unitPrice)}</b>
        <span style={{ color: '#9ca3af' }}> {mySale.quoteDate} {mySale.quoteNumber}</span></>)
  }
  if ((row.row_kind === 'manual_jpy' || row.row_kind === 'price_list') && row.product_price > 0) {
    summaryParts.push(
      <>{sym}{numKR(row.cost_price_jpy)} × {row.exchange_rate.toFixed(2)} × {row.tariff_rate.toFixed(2)} = 원가 <b>₩{numKR(row.product_price)}</b></>)
  }
  // 고친 줄에만 — 가격표에 적힌 값이 얼마였는지(되돌리기 단추는 구입가 칸 옆에 있다).
  if (costEdited) {
    summaryParts.push(<span style={{ color: '#9ca3af' }}>가격표 {sym}{listCostJpy == null ? '-' : numKR(listCostJpy)}</span>)
  }
  if (isDiscount && row.supply_price < 0) {
    summaryParts.push(<>할인 <b>−₩{numKR(Math.abs(row.supply_price))}</b></>)
    summaryParts.push(<>부가세 −₩{numKR(Math.abs(row.tax))}</>)
  }
  if (row.supply_price > 0) {
    if (isDomestic) {
      summaryParts.push(<>원가 ₩{numKR(row.cost_price_jpy)} × {row.quantity} = <b>₩{numKR(row.product_price)}</b> <span style={{ color: '#9ca3af' }}>(환율·관세 없음)</span></>)
    }
    if (row.row_kind !== 'service') {
      summaryParts.push(<>₩{numKR(row.unit_price)} × {row.quantity} = 공급가 <b>₩{numKR(row.supply_price)}</b></>)
    } else {
      summaryParts.push(<>공급가 <b>₩{numKR(row.supply_price)}</b></>)
    }
    summaryParts.push(<>부가세 ₩{numKR(row.tax)}</>)
    if (row.row_kind !== 'service') {
      // 실현 이익률 — 1,000원 올림과 판매단가 직접 입력이 반영된 실제 값이다.
      // 이익률 모드의 스테퍼는 '목표'라 올림 때문에 이 값과 다를 수 있어 항상 함께 보여준다.
      // 원가 이하로 팔면 음수가 되므로 그때는 붉게 낸다.
      summaryParts.push(
        <>실현 <b style={{ color: row.realized_profit_rate < 0 ? '#dc2626' : '#6b7280' }}>
          {row.realized_profit_rate.toFixed(1)}%
        </b></>)
    }
  }
  const summary = summaryParts.length > 0 ? (
    <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5, minWidth: 0, flex: 1 }}>
      {summaryParts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: '#d1d5db' }}> · </span>}
          {part}
        </React.Fragment>
      ))}
    </div>
  ) : null

  /** 수량 스테퍼 — 서비스비·할인 말고는 전부 쓴다. */
  const qtyCell = (
    <div title="수량" style={{ ...box, width: 76, flexShrink: 0 }}>
      <button onClick={() => updateRow(row.id, 'quantity', Math.max(1, row.quantity - 1))} style={stepBtn}>−</button>
      <span style={stepVal}>{row.quantity}<span style={{ color: '#9ca3af' }}>개</span></span>
      <button onClick={() => updateRow(row.id, 'quantity', row.quantity + 1)} style={stepBtn}>+</button>
    </div>
  )

  /** 관세율 스테퍼 — 국내조달품은 쓰지 않는다(원가가 이미 원화다). */
  const tariffCell = (
    <div title="관세율" style={{ ...box, width: 90, flexShrink: 0 }}>
      <button onClick={() => updateRow(row.id, 'tariff_rate', parseFloat((row.tariff_rate - 0.01).toFixed(2)))} style={stepBtn}>−</button>
      <span style={stepVal}><span style={{ color: '#9ca3af' }}>관세</span> ×{row.tariff_rate.toFixed(2)}</span>
      <button onClick={() => updateRow(row.id, 'tariff_rate', parseFloat((row.tariff_rate + 0.01).toFixed(2)))} style={stepBtn}>+</button>
    </div>
  )

  /** 이익률 스테퍼 — 이익률 모드에서만. 판매가 모드에서는 실현 이익률이 요약에 있다. */
  const marginCell = (
    <div title="이익률" style={{ ...box, width: 108, flexShrink: 0 }}>
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
          style={{ flex: 1, minWidth: 0, width: '100%', textAlign: 'center', fontWeight: 500, fontSize: 12, border: '1px solid #234ea2', borderRadius: 6, padding: '1px 2px', outline: 'none', color: '#111827', boxSizing: 'border-box' }}
        />
      ) : (
        <span
          onClick={() => { setEditingProfitRate(p => ({ ...p, [row.id]: true })); setProfitRateInput(p => ({ ...p, [row.id]: String(row.profit_rate) })) }}
          title="클릭하여 직접 입력"
          style={{ ...stepVal, color: row.profit_rate >= 40 ? '#16a34a' : '#dc2626', cursor: 'text' }}
        ><span style={{ color: '#9ca3af' }}>이익</span> {row.profit_rate}%</span>
      )}
      <button onClick={() => updateRow(row.id, 'profit_rate', Math.min(95, row.profit_rate + 5))} style={stepBtn}>+</button>
    </div>
  )

  /** 판매단가 — 판매가 모드는 입력, 이익률 모드는 계산 결과(읽기). 둘 다 같은 자리다. */
  const unitPriceCell = priceInputMode ? (
    <div style={{ position: 'relative', flex: '1 1 0', minWidth: 92 }}>
      <input className="q-input" type="number" value={row.manual_unit_price || ''}
        onChange={e => updateRow(row.id, 'manual_unit_price', parseInt(e.target.value) || 0)}
        placeholder="판매단가"
        style={{ ...field, textAlign: 'right', paddingRight: 26 }} />
      <span style={unitMark}>원</span>
    </div>
  ) : (
    <div title="이익률로 역산한 판매단가(1,000원 올림)"
      style={{ ...box, flex: '1 1 0', minWidth: 92, justifyContent: 'flex-end', background: '#f3f4f6', borderColor: '#f3f4f6' }}>
      <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 'auto' }}>판매단가</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>₩{numKR(row.unit_price)}</span>
    </div>
  )

  return (
    <div style={{ background: '#ffffff', borderRadius: 8, padding: '10px 12px', marginBottom: 8, border: '1px solid #ebebeb' }}>
      {/* ── 머리 — 번호·종류·통화·삭제. 통화 선택을 여기로 올려 칸 한 단을 없앴다. ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: GAP }}>
        {rowCount > 1 && (
          <span style={{ width: 18, height: 18, borderRadius: 999, background: '#234ea2', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0 }}>{rowIdx + 1}</span>
        )}
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px', whiteSpace: 'nowrap' }}>{KIND_LABEL[row.row_kind]}</span>

        {/* 수동입력 줄 — **통화를 고른다.** 고치면 그 줄의 원가가 그 통화의 환율로 다시
            계산된다(app/quote/calc.ts). 가격표 줄에는 내지 않는다(가격표가 정본이다). */}
        {row.row_kind === 'manual_jpy' && (
          <div style={{ width: 128, flexShrink: 0 }}>
            <SegmentedControl
              options={CURRENCIES.map(c => ({ label: `${CURRENCY_SYMBOL[c]} ${c}`, value: c }))}
              value={row.currency}
              onChange={v => updateRow(row.id, 'currency', v as Currency)}
              equal
              height={24}
            />
          </div>
        )}
        {/* 가격표 줄의 통화 — 고를 수 없다(가격표가 정한다). 무엇으로 계산 중인지만 알린다. */}
        {row.row_kind === 'price_list' && row.selectedItem && (
          <span title="가격표가 정한 통화입니다 — 줄에서 바꿀 수 없습니다"
            style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', whiteSpace: 'nowrap' }}>
            {sym} {row.currency}
          </span>
        )}

        <span style={{ flex: 1 }} />
        {rowCount > 1 && (
          <button onClick={() => removeRow(row.id)}
            title="삭제"
            style={{ width: 22, height: 22, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'color 0.15s ease' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
            onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        )}
      </div>

      {/* ── 1단: 무엇인가 — 검색 / 품번 · 모델 · 품명 ── */}
      <div style={band}>
        {/* 가격표 검색(품번) — 선택한 품목의 item_code 가 그대로 표시된다. */}
        {row.row_kind === 'price_list' && (
          <div ref={searchRef} style={{ position: 'relative', flex: '1 1 38%', minWidth: 130 }}>
            <input className="q-input" value={searchQuery[row.id] || ''} onChange={e => handleSearch(row.id, e.target.value)}
              onFocus={() => setSearchOpen(prev => ({ ...prev, [row.id]: true }))}
              onKeyDown={itemKeys.onKeyDown}
              placeholder="품번 · 품명 · 모델 검색" style={{ ...field, paddingRight: row.selectedItem ? 26 : 9 }} />
            {row.selectedItem && (
              <button onClick={() => clearItem(row.id)}
                title="품목 해제"
                style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s ease' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            )}
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

        {/* 품번 직접 입력 — 수동입력 품목 · 국내조달품 공용 */}
        {(row.row_kind === 'manual_jpy' || isDomestic) && (
          <input className="q-input" value={row.partCode}
            onChange={e => updateRow(row.id, 'partCode', e.target.value)}
            placeholder="품번 (예: KT35000)" style={{ ...field, flex: '1 1 26%', minWidth: 88 }} />
        )}

        {/* 모델 — 80 양식은 품명에 「(모델)」로 들어가므로 품명 **앞**이다.
            20 견적서는 열 순서가 품번·품명·모델이라 **품명 뒤**에 둔다. */}
        {!is20 && modelField}

        {/* 할인 — 견적서에 찍히는 문구만 고른다(로직은 동일) */}
        {isDiscount && (
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <SegmentedControl
              options={DISCOUNT_LABELS.map(v => ({ label: v, value: v }))}
              value={row.itemText}
              onChange={v => updateRow(row.id, 'itemText', v)}
              equal
              height={H}
            />
          </div>
        )}

        {!isDiscount && (
          <div style={{ position: 'relative', flex: '1 1 52%', minWidth: 130 }}>
            {/* 품명 — 가격표 줄은 고른 품목의 이름이 들어와 있다. **회색 보조 칸**으로 두되
                고칠 수는 있다(그 글자가 견적서 PDF 에 그대로 나가고, 품목을 고르면 커서가
                맨 앞으로 와서 앞에 덧붙여 쓰는 방식이다 — focusItemName). */}
            <input ref={itemNameRef} className="q-input" value={row.itemText}
              onChange={e => updateRow(row.id, 'itemText', e.target.value)}
              placeholder="품명 (예: 스타일러스)"
              title={row.selectedItem ? '가격표 품명 — 고칠 수 있습니다' : undefined}
              style={{
                ...field, paddingRight: isDomestic ? 9 : 52,
                background: row.selectedItem ? '#f8fafc' : '#fff',
                color: row.selectedItem ? '#6b7280' : '#111827',
              }} />
            {/* 국내조달품은 상세 줄이 필요 없어 숨긴다(서비스비는 유지). */}
            {!isDomestic && (
              <button onClick={() => addSubLine(row.id)}
                title="상세 내용 줄 추가"
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', padding: '2px 5px', background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', transition: 'color 0.15s ease' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#234ea2')}
                onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}>
                줄 추가
              </button>
            )}
          </div>
        )}

        {/* 20 견적서의 모델 칸 — 품번 → 품명 → 모델 순서다(그 양식의 열 순서와 같다). */}
        {is20 && modelField}
      </div>

      {/* 상세 줄 — 품명 아래에 그대로 붙는다(견적서 PDF 에 나가는 글자다). */}
      {row.subLines.length > 0 && (
        <div style={{ marginBottom: GAP }}>
          {row.subLines.map((line, li) => (
            <div key={li} style={{ position: 'relative', marginBottom: 4 }}>
              <input className="q-input" value={line} onChange={e => updateSubLine(row.id, li, e.target.value)} placeholder="예: - Leaf Spring 교체" style={{ ...field, height: 26, fontSize: 11, paddingRight: 26 }} />
              <button onClick={() => removeSubLine(row.id, li)}
                title="삭제"
                style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s ease' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 줄별 분류·묶음 — 켠 견적에만 나온다. 둘 다 켜면 한 단에 나란히 둔다. */}
      {((lineSplitOn && canSplitRowKind(row.row_kind)) || (equipForm && canGroupRowKind(row.row_kind))) && (
        <div style={band}>
          {/* 비워 두면 견적 분류를 따른다(= quote_items.category 가 null 로 저장된다). */}
          {lineSplitOn && canSplitRowKind(row.row_kind) && (
            <select
              className="q-input"
              value={row.category ?? ''}
              onChange={e => setRowCategory(row.id, e.target.value)}
              title="줄 분류"
              style={{ ...field, flex: 1, minWidth: 0, cursor: 'pointer', color: row.category ? '#111827' : '#9ca3af' }}
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
              style={{ ...field, flex: 1, minWidth: 0, cursor: 'pointer', color: row.group_kind ? '#111827' : '#9ca3af' }}
            >
              <option value="">묶음 없음</option>
              {GROUP_KINDS.map(k => (
                <option key={k} value={k}>묶음: {GROUP_LABELS[k]}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* ── 2단: 얼마인가 — 구입가 · 수량 · 관세율 · 판매단가 ── */}
      {!isDiscount && row.row_kind !== 'service' && (
        <div style={band}>
          {/* 가격표 품목의 구입가 — **직접 고칠 수 있다.** 가격표 값은 selectedItem 에 그대로
              남아 있어 언제든 되돌릴 수 있다(cost_jpy_override). 칸을 비우면 가격표 값으로
              돌아간다(null). 고치면 원가·단가·이익률이 함께 다시 계산된다. */}
          {row.row_kind === 'price_list' && row.selectedItem && (
            <div style={{ position: 'relative', flex: '1 1 0', minWidth: 96 }}>
              <input className="q-input" type="number" value={shownCostJpy || ''}
                onChange={e => {
                  const v = e.target.value.trim()
                  // 빈 칸은 「고치지 않음」으로 되돌린다 — 0 을 적으면 구입가 0 이다.
                  updateRow(row.id, 'cost_jpy_override', v === '' ? null : (parseInt(v) || 0))
                }}
                placeholder="구입가"
                title="가격표 구입가 — 고치면 원가가 따라 바뀝니다"
                style={{ ...field, textAlign: 'right', paddingRight: costEdited ? 46 : 26 }} />
              <span style={unitMark}>{sym}</span>
              {/* 고친 줄에만 되돌리기(가격표에 적힌 값은 요약 줄에 있다). */}
              {costEdited && (
                <button onClick={() => updateRow(row.id, 'cost_jpy_override', null)}
                  title={`가격표 값(${sym}${listCostJpy == null ? '-' : numKR(listCostJpy)})으로 되돌리기`}
                  style={{ position: 'absolute', right: 24, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s ease' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#234ea2')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* 수동입력 품목 — 구입가(그 줄의 통화). 국내조달품 — **원화** 원가를 직접 넣는다
              (칸은 manual_cost_jpy 를 쓴다. 이 줄에서는 원화다 — app/quote/calc.ts 의 ⚠ 참고). */}
          {(row.row_kind === 'manual_jpy' || isDomestic) && (
            <div style={{ position: 'relative', flex: '1 1 0', minWidth: 96 }}>
              <input className="q-input" type="number" value={row.manual_cost_jpy || ''}
                onChange={e => updateRow(row.id, 'manual_cost_jpy', parseInt(e.target.value) || 0)}
                placeholder={isDomestic ? '국내 구입가' : '구입가 직접 입력'}
                style={{ ...field, textAlign: 'right', paddingRight: 26 }} />
              <span style={unitMark}>{isDomestic ? '원' : sym}</span>
            </div>
          )}

          {qtyCell}
          {!isDomestic && tariffCell}
          {unitPriceCell}
        </div>
      )}

      {/* 할인 — 깎을 금액을 양수로 입력한다(계산에는 음수로 들어간다) */}
      {isDiscount && (
        <div style={band}>
          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
            <input className="q-input" type="number" value={row.manual_unit_price || ''}
              onChange={e => updateRow(row.id, 'manual_unit_price', parseInt(e.target.value) || 0)}
              placeholder="깎을 금액"
              style={{ ...field, textAlign: 'right', paddingRight: 26 }} />
            <span style={unitMark}>원</span>
          </div>
        </div>
      )}

      {/* 서비스비 — 금액 직접 입력 + 부대비용 내역(원가) */}
      {row.row_kind === 'service' && (
        <>
          <div style={band}>
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <input className="q-input" type="number" value={row.manual_unit_price || ''}
                onChange={e => updateRow(row.id, 'manual_unit_price', parseInt(e.target.value) || 0)}
                placeholder="서비스 금액"
                style={{ ...field, textAlign: 'right', paddingRight: 26 }} />
              <span style={unitMark}>원</span>
            </div>
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

      {/* ── 3단: 어떻게 파는가 — 이익률 | 판매가 토글 + 계산 요약 한 줄 ──
          발주서가 먼저 온 건은 고객이 정한 금액이 있어, 이익률을 더듬는 대신 그 단가를
          그대로 넣는다(판매가 모드). 그때 이익률 칸은 사라지고 실현 이익률이 요약에 남는다. */}
      {(hasPriceMode || summary) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: GAP, flexWrap: 'wrap' }}>
          {hasPriceMode && (
            <div style={{ width: 132, flexShrink: 0 }}>
              <SegmentedControl
                options={[{ label: '이익률', value: 'rate' }, { label: '판매가', value: 'price' }]}
                value={row.price_mode}
                onChange={v => updateRow(row.id, 'price_mode', v)}
                equal
                height={26}
              />
            </div>
          )}
          {hasPriceMode && !priceInputMode && marginCell}
          {summary}
        </div>
      )}
    </div>
  )
}
