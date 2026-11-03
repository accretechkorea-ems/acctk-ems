'use client'

import { useState } from 'react'
import type { QuoteRow, RateMeta } from './types'
import { CURRENCY_SYMBOL, type Currency, type Rates } from '@/lib/quoteCurrency'
import { RATE_SOURCE } from '@/lib/exchangeRate'
import { calcTotals } from './calc'
import { isBillableRow } from '@/lib/quoteDomestic'
import { numKR } from './format'
import {
  belowMinOperatingMessage, isBelowMinOperating, minOperatingMarginOf, profitBreakdownOfLines,
} from '@/lib/quoteProfit'

export type ProfitPanelProps = {
  rows: QuoteRow[]
  /** 통화별 환율(lib/quoteCurrency.ts). 엔은 받아서 채우고 달러는 사람이 정한다. */
  rates: Rates
  /** 그 환율이 어디서 온 값인가 — **통화별**이다. 칸이 비면 아직 못 받았다(app/quote/types.ts). */
  rateMeta: Partial<Record<Currency, RateMeta>>
  rateLoading: boolean
  /** 새로고침 — 저장된 값을 보지 않고 **늘 API** 로 다시 받는다(page.tsx 의 fetchRate). */
  onFetchRate: () => void
  onRateChange: (currency: Currency, rate: number) => void
  /** 수출입은행이 준 달러 매매기준율 — 참고로 보여 주고, 누르면 그 값으로 바꾼다. */
  usdReference?: { rate: number; baseDate: string } | null
  onUseUsdReference?: () => void
  /** 고른 견적 분류 — 판관비 규칙이 여기서 나온다(TSE 30%). */
  category?: string
  /**
   * 저장된 내 설정(계정 × 분류)을 들여왔는가 — 들여왔을 때만 환율 옆에 그 사실을 적는다.
   * 관세·이익률도 그 값으로 시작했다는 뜻이라(새 줄), 숫자만 보고 「왜 60 이 아니지」
   * 하고 찾아 헤매지 않게 한다(lib/quoteUserDefaults.ts).
   */
  savedDefaultsApplied?: boolean
  /** 영업이익 하한 미만일 때 적는 사유. quotes.note 끝에 한 줄로 저장된다. */
  operatingReason: string
  setOperatingReason: (v: string) => void
}

export default function ProfitPanel({
  rows, rates, rateMeta, rateLoading, onFetchRate, onRateChange, usdReference, onUseUsdReference,
  category, savedDefaultsApplied, operatingReason, setOperatingReason,
}: ProfitPanelProps) {
  // 어느 통화를 고치는 중인가 — null 이면 아무것도 고치지 않는다(종전 boolean 을 통화로 넓혔다).
  const [editing, setEditing] = useState<Currency | null>(null)
  const [editRateVal, setEditRateVal] = useState('')
  /** 달러 줄이 섞여 있나 — 그때만 달러 환율 칸을 낸다(엔만 쓰는 견적은 종전 모습 그대로). */
  const hasUsdRow = rows.some(r => r.currency === 'USD')

  /**
   * 환율 옆 작은 글 — **이 숫자가 어디서 온 것인가.**
   *
   * 숫자만 있으면 실시간으로 받은 값인지 누가 손으로 넣은 값인지 알 수 없다. 원가가
   * 전부 이 숫자에 걸려 있어, 견적을 넘기기 전에 그 둘은 구분돼야 한다.
   *
   *   API    「한국수출입은행 · 기준일 2026-10-28 · 14:03 조회」
   *          기준일은 **그 기관이 말하는 날**이다(주말·공휴일이면 며칠 앞), 시각은 우리가
   *          받은 때(KST).
   *   저장값 「한국수출입은행 · 기준일 2026-10-28 · 저장값」 — exchange_rate 표에 있던
   *          값이다. 그 표에는 API 가 준 값만 들어가므로 기관 이름을 적는다. 받은 시각은
   *          남아 있지 않아 「저장값」으로 닫는다(방금 받은 것과 구분된다).
   *   내 설정 「저장된 설정 · 2026-10-28」 — **내가 그 분류로 마지막에 확정할 때 쓴 환율**이다
   *          (quote_user_defaults). 기관 이름을 적지 않는다: 그때 직접 넣은 값일 수도 있다.
   *   직접   「직접 입력」
   */
  /**
   * 출처 글을 **두 토막**으로 돌려준다 — 폭이 모자랄 때 접히는 자리를 한 곳만 남기려고.
   *
   * 두 토막을 각각 nowrap 으로 두고 사이에 공백 하나만 두면, 줄이 끊기는 곳은 그 공백
   * 하나뿐이다. 그래서 「한국수출입은행 ·」 뒤에서만 접히고 「기준일 2026-10-28 · 16:08
   * 조회」가 중간에서 잘리지 않는다. 한 토막뿐이면(직접 입력) 접히지 않는다.
   */
  const rateNote = (currency: Currency): { head: string; rest: string } | null => {
    const meta = rateMeta[currency]
    if (!meta) return null
    if (meta.kind === 'manual') return { head: '직접 입력', rest: '' }
    if (meta.kind === 'saved') {
      return meta.savedAt ? { head: '저장된 설정 ·', rest: meta.savedAt } : { head: '저장된 설정', rest: '' }
    }
    return {
      head: `${meta.source} ·`,
      rest: meta.kind === 'cache'
        ? `기준일 ${meta.baseDate} · 저장값`
        : `기준일 ${meta.baseDate} · ${meta.fetchedAt} 조회`,
    }
  }

  const note = rateNote('JPY')

  /** 그 통화의 환율을 고치기 시작한다(더블클릭). 자리수는 통화에 맞춘다. */
  const startEdit = (currency: Currency) => {
    const v = rates[currency]
    setEditRateVal(v ? (currency === 'JPY' ? v.toFixed(4) : String(v)) : '')
    setEditing(currency)
  }
  const commitEdit = () => {
    const n = parseFloat(editRateVal)
    if (editing && !isNaN(n) && n > 0) onRateChange(editing, n)
    setEditing(null)
  }
  // 통합 전 이 자리의 계산식은 calcTotals 와 문자 단위로 동일했다(변수명만 다름).
  const { totalSupply, totalCost: totalProduct, totalProfit, totalProfitRate: profitPct, domesticCost } = calcTotals(rows)
  // 할인 금액(음수). calcTotals 는 건드리지 않고 여기서만 모아 표시용으로 쓴다.
  const discountAmt = rows.filter(r => r.row_kind === 'discount').reduce((s, r) => s + r.supply_price, 0)
  // 판관비·영업이익 — 분류 규칙(lib/quoteProfit.ts)으로 계산한 **표시용** 값이다.
  //
  // **줄별 분류로 안분한다**(혼합 견적 — TSE + SBS). 줄에 분류가 없으면 견적 분류를 따르므로
  // 분류를 나누지 않은 견적은 종전과 한 원도 다르지 않다. 매출·원가 **합계**는 calcTotals 가
  // 정본이라(국내조달품이 매출에서 빠지는 규칙이 거기 있다) 줄 목록은 판관비를 나눌 때만 쓴다.
  const lineBd = profitBreakdownOfLines(
    rows.map(r => ({ supply: isBillableRow(r) ? r.supply_price : 0, cost: r.product_price, category: r.category })),
    category,
  )
  const breakdown = {
    ...lineBd,
    revenue: totalSupply,
    cost: totalProduct,
    grossProfit: totalProfit,
    grossRate: profitPct,
    operatingProfit: totalProfit - lineBd.sga,
    operatingRate: totalSupply > 0 ? ((totalProfit - lineBd.sga) / totalSupply) * 100 : 0,
  }
  const sgaPct = totalSupply > 0 ? (breakdown.sga / totalSupply) * 100 : 0
  // 분류가 섞이면 「매출 × 30%」 같은 한 줄 설명이 맞지 않는다 — 섞였다고 적는다.
  const mixedCategory = new Set(rows.filter(isBillableRow).map(r => (r.category ?? '') || (category ?? ''))).size > 1
  const sgaNote = mixedCategory ? `분류별 안분 ${sgaPct.toFixed(1)}%` : `매출 × ${sgaPct.toFixed(0)}%`
  // 영업이익 하한 — 분류가 정한다(TSE 15% · SBS 6%). 미만이면 사유를 묻는다.
  // **확정을 막지는 않는다** — 경고일 뿐이다(lib/quoteProfit.ts).
  const minOperating = minOperatingMarginOf(category)
  const belowMin = isBelowMinOperating(breakdown, category)

  // ── 품목 한 칸 = 두 줄 ────────────────────────────────────────────────
  //
  // 종전에는 구입가·관세×환율·원가·판매단가·공급가·매출이익을 **여섯 줄**로 적었다.
  // 품목이 여섯이면 서른여섯 줄이라, 정작 보려던 아래쪽 합계·판관비·영업이익이 화면
  // 밖으로 밀려났다. 값은 하나도 빼지 않고 **식으로 이어** 두 줄에 담는다.
  //
  //   1줄  ¥130,500 × 1.13 × 8.46 = 원가 ₩1,248,159
  //   2줄  ₩3,000,000 × 1 = ₩3,000,000 · 매출이익 ₩1,751,841 (58.4%)
  //
  // 줄 종류마다 1줄의 재료가 다르다 — 가격표·수동입력은 구입가 식, 서비스비는 부대비용
  // 건수와 원가, 국내조달품은 원가와 「이익 없음」이다. 2줄은 모두 같다.
  const costLine = (r: QuoteRow): React.ReactNode => {
    switch (r.row_kind) {
      case 'price_list':
      case 'manual_jpy':   // 구입가 출처만 다르고 원가 산출은 동일하다
        return (
          <>
            {CURRENCY_SYMBOL[r.currency]}{r.cost_price_jpy.toLocaleString()}
            <span style={{ color: '#9ca3af' }}> × </span>{r.tariff_rate}
            <span style={{ color: '#9ca3af' }}> × </span>{r.exchange_rate.toFixed(2)}
            <span style={{ color: '#9ca3af' }}> = 원가 </span>
            <b style={{ color: '#111827', fontWeight: 600 }}>₩{numKR(r.product_price)}</b>
          </>
        )
      case 'service':
        return (
          <>
            부대비용 {r.expenses.length}건
            <span style={{ color: '#9ca3af' }}> = 원가 </span>
            <b style={{ color: '#111827', fontWeight: 600 }}>₩{numKR(r.product_price)}</b>
          </>
        )
      case 'domestic':
        return (
          <>
            <span style={{ color: '#9ca3af' }}>원가 </span>
            <b style={{ color: '#111827', fontWeight: 600 }}>₩{numKR(r.product_price)}</b>
            <span style={{ color: '#9ca3af' }}> · 이익 없음</span>
          </>
        )
      default:
        return null
    }
  }

  /**
   * 품목 이름 — **품번과 품명이 같으면 한 번만** 적는다.
   *
   * 종전에는 `{itemText} ({model_jp})` 를 그대로 이어 붙여, 가격표 품목의 품명이 모델명
   * 그대로인 줄에서 「(A-1207-0020-RBE) (A-1207-0020-RBE)」처럼 두 번 나왔다.
   * 괄호·공백을 떼고 견준 뒤 같으면 하나로 접는다.
   */
  const itemLabel = (r: QuoteRow): string => {
    const bare = (v: string | null | undefined) => (v ?? '').replace(/[()\s]/g, '').toLowerCase()
    const name = (r.itemText ?? '').trim()
    const model = (r.selectedItem?.model_jp ?? '').trim()
    if (!model) return name || '-'
    if (!name) return model
    // 품명이 모델을 이미 품고 있으면(「(모델)」로 들어간 경우 포함) 품명만 적는다.
    if (bare(name) === bare(model) || bare(name).includes(bare(model))) return name
    return `${name} (${model})`
  }

  return (
    <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #ebebeb', marginBottom: 14, overflow: 'hidden' }}>
      {/* 머리줄 — 한 줄에 네 덩어리다. **줄이는 것은 출처 글자 하나뿐**이다:
          제목·환율·오른쪽 끝(새로고침·이익률)은 flexShrink 0 으로 묶어 두고, 좁아지면
          출처만 두 줄로 접힌다. 예전에는 아무것도 묶어 두지 않아 좁은 폭에서 「수익 분석」이
          두 줄로 쪼개지고 「8.3830원」의 「원」이 혼자 다음 줄로 내려갔다. */}
      <div style={{ background: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #ebebeb' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ width: 3, height: 14, background: '#234ea2', borderRadius: 6, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 800, color: '#111827', whiteSpace: 'nowrap' }}>수익 분석</span>
        </div>
        {/* 환율 + 출처 — 이 묶음만 줄어든다(minWidth 0 이 없으면 flex 항목은 내용 밑으로 줄지 않는다). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: '1 1 auto' }}>
          {editing === 'JPY' ? (
            <input
              type="number"
              value={editRateVal}
              onChange={e => setEditRateVal(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null) }}
              autoFocus
              style={{ width: 80, fontSize: 11, fontWeight: 700, color: '#234ea2', border: '1px solid #234ea2', borderRadius: 6, padding: '1px 5px', outline: 'none' }}
            />
          ) : (
            <span
              onDoubleClick={() => startEdit('JPY')}
              title="더블클릭하여 수동 입력"
              // 이 숫자에 원가가 전부 걸려 있어 머리줄에서 가장 크게 읽힌다(11 → 17px, 진한 색).
              // 숫자와 「원」은 한 덩어리다 — 「원」만 다음 줄로 내려가면 숫자가 아닌 것으로 읽힌다.
              // 「원」은 13px 로 한 급 낮춘다(숫자가 먼저 읽히게).
              style={{
                fontSize: 17, color: '#111827', fontWeight: 700, cursor: 'text', lineHeight: 1.2,
                borderBottom: '1px dashed #9ca3af', whiteSpace: 'nowrap', flexShrink: 0,
                letterSpacing: '-0.3px',
              }}>
              {rates.JPY
                ? <>{rates.JPY.toFixed(4)}<span style={{ fontSize: 13, fontWeight: 700 }}>원</span></>
                : <span style={{ fontSize: 11, fontWeight: 500, color: '#6b7280' }}>환율 로딩중...</span>}
            </span>
          )}
          {/* 출처·기준 시각. 숫자를 고치는 중에는 내지 않는다(그 순간의 출처는 아직 모른다).
              폭이 모자라면 **이 글자만** 두 줄로 접힌다(아래 두 토막 사이의 공백 한 곳). */}
          {editing !== 'JPY' && note && (
            <span style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'normal', lineHeight: 1.35, minWidth: 0 }}>
              <span style={{ whiteSpace: 'nowrap' }}>{note.head}</span>
              {note.rest && <>{' '}<span style={{ whiteSpace: 'nowrap' }}>{note.rest}</span></>}
            </span>
          )}
          {/* 달러 환율 — **달러 줄이 섞여 있을 때만** 낸다(엔만 쓰는 견적은 종전 모습 그대로).
              엔과 달리 **사람이 정하는 값**이라 실시간 환율로 덮지 않는다(lib/quoteCurrency.ts 의
              USD_DEFAULT_RATE 에서 시작한다). 옆의 「수출입은행 …」을 누르면 그 값으로 바꾼다. */}
          {hasUsdRow && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, borderLeft: '1px solid #ebebeb', paddingLeft: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280' }}>{CURRENCY_SYMBOL.USD}</span>
              {editing === 'USD' ? (
                <input
                  type="number"
                  value={editRateVal}
                  onChange={e => setEditRateVal(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null) }}
                  autoFocus
                  style={{ width: 70, fontSize: 11, fontWeight: 700, color: '#234ea2', border: '1px solid #234ea2', borderRadius: 6, padding: '1px 5px', outline: 'none' }}
                />
              ) : (
                <span
                  onDoubleClick={() => startEdit('USD')}
                  title="더블클릭하여 수동 입력"
                  style={{
                    fontSize: 15, color: '#111827', fontWeight: 700, cursor: 'text', lineHeight: 1.2,
                    borderBottom: '1px dashed #9ca3af', whiteSpace: 'nowrap', letterSpacing: '-0.3px',
                  }}>
                  {rates.USD ? <>{numKR(rates.USD)}<span style={{ fontSize: 12, fontWeight: 700 }}>원</span></> : '-'}
                </span>
              )}
              {/* 참고값 — 누르면 그 값으로 바꾼다. 지금 값과 같으면 내지 않는다(할 일이 없다). */}
              {editing !== 'USD' && usdReference && usdReference.rate !== rates.USD && (
                <button
                  onClick={() => onUseUsdReference?.()}
                  title={`${RATE_SOURCE} 매매기준율로 바꿉니다`}
                  style={{ fontSize: 10, color: '#234ea2', background: 'none', border: 'none', padding: 0, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'underline dotted' }}
                >
                  {RATE_SOURCE} {numKR(usdReference.rate)} · {usdReference.baseDate}
                </button>
              )}
              {editing !== 'USD' && rateMeta.USD?.kind === 'manual' && (
                <span style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap' }}>직접 입력</span>
              )}
            </span>
          )}

          {/* 내 설정을 들여왔다는 표시 — 환율만이 아니라 관세·이익률도 그 값에서 시작했다.
              새로고침으로 환율을 덮은 뒤에도 남는다(관세·이익률은 그대로이므로). */}
          {savedDefaultsApplied && (
            <span
              title="이 분류로 마지막에 확정할 때 쓴 환율·관세·이익률을 들여왔습니다"
              style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap', borderLeft: '1px solid #ebebeb', paddingLeft: 6, flexShrink: 0 }}
            >
              내 설정 불러옴
            </span>
          )}
        </div>
        {/* 오른쪽 끝 — 새로고침과 이익률은 늘 한 줄로 붙어 있다(줄지 않는다). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
          <button
            onClick={onFetchRate}
            title="실시간 환율을 다시 받는다"
            disabled={rateLoading}
            style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', border: '1px solid #ebebeb', cursor: rateLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s ease' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={rateLoading ? '#9ca3af' : '#111827'} strokeWidth="2.5">
              <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
          </button>
          {/* 이익률 — **값과 무관하게 초록**이다. 낮다고 빨강으로 바꾸면 견적을 손님 앞에서
              펼칠 때 경고처럼 보인다(합계 블록의 매출이익도 같은 이유로 늘 초록). */}
          <span style={{ fontSize: 13, fontWeight: 600, color: '#16a34a', whiteSpace: 'nowrap' }}>
            이익률 {profitPct.toFixed(1)}%
          </span>
        </div>
      </div>
      <div style={{ padding: '12px 16px' }}>
        {rows.map((r, i) => {
          if (r.supply_price <= 0) return null
          const line1 = costLine(r)
          // 국내조달품은 마진이 없는 자사 부담 항목이라 이익 색상 규칙에서 제외한다(중립색).
          const profitColor = r.row_kind === 'domestic' ? '#6b7280' : (r.profit >= 0 ? '#16a34a' : '#dc2626')
          return (
          <div key={r.id} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #ebebeb' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ width: 16, height: 16, borderRadius: '50%', background: '#234ea2', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
              <span style={{ fontSize: 11, color: '#111827', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemLabel(r)}</span>
            </div>
            {/* 1줄 — 원가가 어떻게 나왔나. 종류에 따라 재료가 다르다(costLine). */}
            {line1 && (
              <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.6, paddingLeft: 22 }}>{line1}</div>
            )}
            {/* 2줄 — 얼마에 몇 개를 팔아 얼마가 남나. 모든 종류가 같다. */}
            <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.6, paddingLeft: 22 }}>
              ₩{numKR(r.unit_price)}
              <span style={{ color: '#9ca3af' }}> × </span>{r.quantity}
              <span style={{ color: '#9ca3af' }}> = </span>
              <b style={{ color: '#111827', fontWeight: 600 }}>₩{numKR(r.supply_price)}</b>
              <span style={{ color: '#d1d5db' }}> · </span>
              <span style={{ color: '#9ca3af' }}>매출이익 </span>
              <b style={{ color: profitColor, fontWeight: 600 }}>₩{numKR(r.profit)}</b>
              <span style={{ color: profitColor }}> ({r.profit_rate}%)</span>
            </div>
          </div>
          )
        })}
        <div style={{ marginTop: 2, paddingTop: 6, borderTop: '2px solid #111827' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>공급가 합계</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 600 }}>₩{numKR(totalSupply)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>원가 합계</span><span style={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>−₩{numKR(totalProduct)}</span></div>
          {/* 할인 — 총액에서 빠진 금액. 행 목록에는 공급가가 음수라 나오지 않으므로 여기서 알린다. */}
          {discountAmt < 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>할인</span><span style={{ fontSize: 13, color: '#dc2626', fontWeight: 500 }}>−₩{numKR(Math.abs(discountAmt))}</span></div>
          )}
          {/* 국내조달품이 원가에 얼마나 얹혔는지 — 마진 조절 판단용. 해당 행이 없으면 표시하지 않는다. */}
          {domesticCost > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>국내 조달품</span><span style={{ fontSize: 13, color: '#6b7280', fontWeight: 600 }}>₩{numKR(domesticCost)}</span></div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>매출이익 합계</span><span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>₩{numKR(totalProfit)} ({profitPct.toFixed(1)}%)</span></div>
          {/* 판관비·영업이익 — 분류에 규칙이 있을 때만 낸다(지금은 TSE 매출의 30%).
              **저장되는 값은 바뀌지 않는다** — total_profit·profit_rate 는 위의 매출이익 그대로다. */}
          {breakdown.hasSga && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span style={{ fontSize: 12, color: '#6b7280' }}>판관비 <span style={{ color: '#9ca3af' }}>({sgaNote})</span></span>
                <span style={{ fontSize: 13, color: '#dc2626', fontWeight: 500 }}>−₩{numKR(breakdown.sga)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #ebebeb', marginTop: 2, paddingTop: 8 }}>
                <span style={{ fontSize: 12, color: '#111827', fontWeight: 700 }}>영업이익</span>
                <span style={{ fontSize: 13, color: breakdown.operatingProfit >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                  ₩{numKR(breakdown.operatingProfit)} ({breakdown.operatingRate.toFixed(1)}%)
                </span>
              </div>
              {/* 하한 미만 — 빨간 경고와 사유 칸. 사유가 없어도 확정은 막지 않는다.
                  사유는 quotes.note 끝에 「[영업이익 사유] …」로 저장되고 고객 견적서에는
                  나가지 않는다(lib/quoteOperatingNote.ts). */}
              {belowMin && minOperating !== null && (
                <div style={{ marginTop: 6, paddingTop: 8, borderTop: `1px solid ${'#ebebeb'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#dc2626"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 700 }}>
                      {belowMinOperatingMessage(breakdown.operatingRate, minOperating)}
                    </span>
                  </div>
                  <textarea
                    value={operatingReason}
                    onChange={e => setOperatingReason(e.target.value)}
                    placeholder="예: 일진공기부 공급가격 확정 — 올해 인상 어려움, 내년에 인상 계획"
                    rows={2}
                    style={{
                      width: '100%', boxSizing: 'border-box', resize: 'vertical',
                      padding: '7px 9px', borderRadius: 6, border: `1px solid ${operatingReason.trim() ? '#ebebeb' : '#dc2626'}`,
                      fontSize: 12, lineHeight: 1.5, color: '#111827', outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>
                    고객 견적서에는 나가지 않습니다. 사유가 없어도 확정은 됩니다.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
