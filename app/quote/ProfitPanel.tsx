'use client'

import { useState } from 'react'
import type { QuoteRow, RateMeta } from './types'
import { CURRENCY_SYMBOL, type Currency, type Rates } from '@/lib/quoteCurrency'
import { RATE_SOURCE } from '@/lib/exchangeRate'
import { calcTotals } from './calc'
import { isBillableRow } from '@/lib/quoteDomestic'
import { ROW_KIND_LABEL } from '@/lib/quoteRowKinds'
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

/**
 * 품목 칸과 합계 칸이 **함께 쓰는 열 폭** — 라벨 · 식 · 금액.
 * 둘이 다른 값을 쓰면 금액 열이 어긋나고, 그때부터 세로로 훑을 수 없다.
 */
const ROW_GRID = '62px 1fr auto'
/** 금액 칸 — 늘 오른쪽 끝에 붙고 자릿수가 고정폭이다(.num = tabular-nums). */
const amountCell: React.CSSProperties = { textAlign: 'right', whiteSpace: 'nowrap', fontSize: 12 }
/** 라벨 칸. */
const labelCell: React.CSSProperties = { fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }
/**
 * 식 줄 — 원가가 어떻게 나왔고 얼마가 남나. **왼쪽 정렬**이고 번호 뱃지 폭만큼 들여 쓴다
 * (제목 줄의 품명과 같은 선에서 시작한다). 금액은 제목 줄 오른쪽 끝으로 옮겼으므로
 * 이 줄은 설명만 남는다 — 설명을 오른쪽에 붙여 두면 품명과 끝선이 어긋나 읽는 눈이
 * 줄마다 좌우로 움직인다. 접지 않는다(넘치면 식만 말줄임으로 끊는다).
 */
const itemLine: React.CSSProperties = {
  fontSize: 12, color: '#9ca3af', lineHeight: 1.6, paddingLeft: 22,
  // **두 토막**이다 — 넘칠 때 왼쪽(식)만 줄어든다.
  display: 'flex', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden',
}
/** 품목 번호 뱃지 — 품목 패널의 줄 번호와 같은 수다. 폭 16 + 여백 6 = 식 줄 들여쓰기. */
const numBadge: React.CSSProperties = {
  width: 16, height: 16, borderRadius: '50%', background: '#234ea2', color: '#fff',
  fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center',
  justifyContent: 'center', flexShrink: 0,
}
/**
 * 환율 묶음 — 「¥ 10.0000원」. **숫자만 크고**(17/700) 통화 기호와 「원」은 회색 곁글이다.
 * 점선 밑줄은 걷었다 — 링크처럼 보여 한 번 눌러 보게 만들었는데, 고치는 길은 더블클릭이다.
 */
const ratePrefix: React.CSSProperties = { fontSize: 11, color: '#6b7280', fontWeight: 600 }
const rateNum: React.CSSProperties = {
  fontSize: 17, color: '#111827', fontWeight: 700, cursor: 'text', lineHeight: 1.2,
  whiteSpace: 'nowrap', letterSpacing: '-0.3px',
}
const rateUnit: React.CSSProperties = { fontSize: 12, color: '#6b7280', fontWeight: 600, letterSpacing: 0 }
/** 환율을 손으로 고치는 칸. */
const rateEditBox: React.CSSProperties = {
  fontSize: 15, fontWeight: 700, color: '#234ea2', border: '1px solid #234ea2',
  borderRadius: 6, padding: '1px 5px', outline: 'none',
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
   * 환율 옆 작은 글 — **이 숫자가 어디서 온 것인가.** 「한국수출입은행 · 11-03」 한 줄이다.
   *
   * 숫자만 있으면 받은 값인지 누가 손으로 넣은 값인지 알 수 없고, 원가가 전부 이 숫자에
   * 걸려 있어 그 둘은 넘기기 전에 구분돼야 한다. 다만 적을 것은 **기관과 날**뿐이다 —
   * 조회 시각·「저장값」 같은 말은 숫자를 읽는 데 보태는 것이 없는데도 머리줄을 두 줄로
   * 밀어 냈다(기준일과 조회 시각이 한 줄에 나란히 붙어 어느 쪽이 환율의 날인지도 흐렸다).
   *
   *   받은 값·저장값  「한국수출입은행 · 11-03」 — 11-03 은 **그 기관이 말하는 기준일**이다
   *                   (주말·공휴일이면 며칠 앞). exchange_rate 표에 있던 값도 그 기관이 준
   *                   값이므로 같게 적는다.
   *   내 설정         「저장된 설정 · 11-03」 — 내가 그 분류로 마지막에 확정할 때 쓴 환율이다
   *                   (quote_user_defaults). 그때 직접 넣은 값일 수도 있어 기관을 적지 않는다.
   *   직접 입력        **빈 글.** 출처가 없다 — 칸이 비어 있는 것이 곧 손으로 넣었다는 뜻이다.
   */
  const rateNote = (currency: Currency): string => {
    const meta = rateMeta[currency]
    if (!meta || meta.kind === 'manual') return ''
    // 기준일·저장일은 'YYYY-MM-DD' 다. 머리줄에는 월·일만 쓴다(해는 올해다).
    const mmdd = (d: string) => d.slice(5) || d
    if (meta.kind === 'saved') return meta.savedAt ? `저장된 설정 · ${mmdd(meta.savedAt)}` : '저장된 설정'
    return `${meta.source} · ${mmdd(meta.baseDate)}`
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

  // ── 품목 한 칸 = 제목 줄 + 식 줄 ───────────────────────────────────
  //
  //   ① A-1207-0020-RBE  ×1                                    ₩286,000
  //      ¥13,900 × 1.13 × 10.00 = ₩157,070 (원가) · 매출이익 ₩128,930 (45.1%)
  //
  // **제목 줄이 그 품목의 결론이다** — 무엇을 몇 개 팔아 얼마가 되나. 그래서 금액(공급가
  // = 단가 × 수량)은 제목 줄 오른쪽 끝, 아래 합계 금액 열과 **같은 끝선**에 붙는다.
  // 단가는 적지 않는다(식 줄에서 원가를 보고 나면 단가는 공급가 ÷ 수량이고, 그 세 수를
  // 한 줄에 늘어놓으면 어느 것이 손님에게 나가는 금액인지가 흐려진다).
  //
  // 색은 세 단이다 — 식은 흐리게(#9ca3af), 금액은 한 단 진하게(#374151), 공급가만
  // 본문색으로 굵게. 매출이익만 초록이라 눈이 먼저 간다.
  const costExpr = (r: QuoteRow): React.ReactNode => {
    switch (r.row_kind) {
      case 'price_list':
      case 'manual_jpy':   // 구입가 출처만 다르고 원가 산출은 동일하다
        return (
          <>
            {CURRENCY_SYMBOL[r.currency]}{r.cost_price_jpy.toLocaleString()}
            <span style={{ color: '#d1d5db' }}> × </span>{r.tariff_rate}
            <span style={{ color: '#d1d5db' }}> × </span>{r.exchange_rate.toFixed(2)}
          </>
        )
      case 'service':
        return <>부대비용 {r.expenses.length}건</>
      case 'domestic':
        return <>₩{numKR(r.cost_price_jpy)}<span style={{ color: '#d1d5db' }}> × </span>{r.quantity}</>
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

  /** 품목도 금액도 없는 줄은 패널에 내지 않는다(합계에는 어느 쪽이든 0 이다). */
  const hasContent = (r: QuoteRow): boolean => !!r.selectedItem || r.manual_cost_jpy > 0
    || r.manual_unit_price > 0 || (r.row_kind === 'service' && r.expenses.length > 0)
  /**
   * 패널에 낼 줄 — **번호는 견적 줄 번호**다(품목 패널의 번호와 같아야 한다. 건너뛴 줄이
   * 있어도 번호는 밀리지 않는다). 지브라 띠는 **여기 보이는 순서**로 센다 — 줄 번호로
   * 세면 건너뛴 자리에서 같은 색 띠가 두 줄 이어진다.
   */
  const shown = rows
    .map((row, i) => ({ row, no: i + 1 }))
    .filter(({ row }) => row.supply_price !== 0 || hasContent(row))

  return (
    <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #ebebeb', marginBottom: 14, overflow: 'hidden' }}>
      {/* 머리줄 — 한 줄에 **세 덩어리**다: 제목 · 환율 묶음 · 오른쪽 끝 이익률.
          환율 묶음은 「¥ 10.0000원 ↻」 하나로 읽힌다 — 숫자·단위·새로고침을 한 덩어리로
          붙여 **그 버튼이 이 숫자를 다시 받는 버튼**임을 자리로 알린다(예전에는 오른쪽 끝
          이익률 옆에 떨어져 있어, 무엇을 새로 받는 단추인지 글로만 설명됐다).
          줄이는 것은 출처 글자 하나뿐이다 — 제목·환율·이익률은 flexShrink 0 으로 묶는다. */}
      <div style={{ background: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #ebebeb' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ width: 3, height: 14, background: '#234ea2', borderRadius: 6, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 800, color: '#111827', whiteSpace: 'nowrap' }}>수익 분석</span>
        </div>
        {/* 환율 묶음 + 출처 — 이 묶음만 줄어든다(minWidth 0 이 없으면 flex 항목은 내용 밑으로 줄지 않는다). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '1 1 auto' }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 3, flexShrink: 0 }}>
            <span style={ratePrefix}>{CURRENCY_SYMBOL.JPY}</span>
            {editing === 'JPY' ? (
              <input
                type="number"
                value={editRateVal}
                onChange={e => setEditRateVal(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null) }}
                autoFocus
                style={{ ...rateEditBox, width: 90 }}
              />
            ) : (
              <span onDoubleClick={() => startEdit('JPY')} title="더블클릭하여 수동 입력" style={rateNum}>
                {rates.JPY
                  ? <>{rates.JPY.toFixed(4)}<span style={rateUnit}>원</span></>
                  : <span style={{ fontSize: 11, fontWeight: 500, color: '#6b7280' }}>환율 로딩중...</span>}
              </span>
            )}
            {/* 새로고침 — **환율 묶음 안**이다(위 주석). 동작은 종전 그대로: 저장값을 보지 않고
                늘 API 로 다시 받는다. 테두리 없는 아이콘 하나로 둔다 — 동그란 테두리를 두면
                숫자 옆에 단추가 하나 더 선 것처럼 보여 묶음이 끊긴다. */}
            <button
              onClick={onFetchRate}
              title="실시간 환율을 다시 받는다"
              disabled={rateLoading}
              style={{ background: 'none', border: 'none', padding: 0, marginLeft: 1, alignSelf: 'center', display: 'flex', alignItems: 'center', flexShrink: 0, cursor: rateLoading ? 'not-allowed' : 'pointer' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={rateLoading ? '#d1d5db' : '#9ca3af'} strokeWidth="2" strokeLinecap="round">
                <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
          </span>

          {/* 달러 환율 — **달러 줄이 섞여 있을 때만** 낸다(엔만 쓰는 견적은 종전 모습 그대로).
              엔과 달리 **사람이 정하는 값**이라 실시간 환율로 덮지 않는다(lib/quoteCurrency.ts 의
              USD_DEFAULT_RATE 에서 시작한다). 옆의 「수출입은행 …」을 누르면 그 값으로 바꾼다.
              모양은 엔과 같다 — 「$ 1,600원」. */}
          {hasUsdRow && (
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 3, flexShrink: 0, borderLeft: '1px solid #ebebeb', paddingLeft: 8 }}>
              <span style={ratePrefix}>{CURRENCY_SYMBOL.USD}</span>
              {editing === 'USD' ? (
                <input
                  type="number"
                  value={editRateVal}
                  onChange={e => setEditRateVal(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null) }}
                  autoFocus
                  style={{ ...rateEditBox, width: 80 }}
                />
              ) : (
                <span onDoubleClick={() => startEdit('USD')} title="더블클릭하여 수동 입력" style={{ ...rateNum, fontSize: 15 }}>
                  {rates.USD ? <>{numKR(rates.USD)}<span style={rateUnit}>원</span></> : '-'}
                </span>
              )}
              {/* 참고값 — 누르면 그 값으로 바꾼다. 지금 값과 같으면 내지 않는다(할 일이 없다). */}
              {editing !== 'USD' && usdReference && usdReference.rate !== rates.USD && (
                <button
                  onClick={() => onUseUsdReference?.()}
                  title={`${RATE_SOURCE} 매매기준율로 바꿉니다`}
                  style={{ fontSize: 11, color: '#234ea2', background: 'none', border: 'none', padding: 0, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'underline dotted', alignSelf: 'center' }}
                >
                  {RATE_SOURCE} {numKR(usdReference.rate)}
                </button>
              )}
            </span>
          )}

          {/* 출처 — 「한국수출입은행 · 11-03」 한 줄(위 rateNote). 숫자를 고치는 중에는 내지
              않는다(그 순간의 출처는 아직 모른다). 손으로 넣은 환율에는 출처가 없어 빈 글이다. */}
          {editing !== 'JPY' && note && (
            <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              {note}
            </span>
          )}

          {/* 내 설정을 들여왔다는 표시 — 환율만이 아니라 관세·이익률도 그 값에서 시작했다.
              새로고침으로 환율을 덮은 뒤에도 남는다(관세·이익률은 그대로이므로). */}
          {savedDefaultsApplied && (
            <span
              title="이 분류로 마지막에 확정할 때 쓴 환율·관세·이익률을 들여왔습니다"
              style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', borderLeft: '1px solid #ebebeb', paddingLeft: 6, flexShrink: 0 }}
            >
              내 설정 불러옴
            </span>
          )}
        </div>
        {/* 오른쪽 끝 — **이익률 하나뿐**이다. 값과 무관하게 초록이다 — 낮다고 빨강으로 바꾸면
            견적을 손님 앞에서 펼칠 때 경고처럼 보인다(합계의 매출이익도 같은 이유로 늘 초록). */}
        <span style={{ fontSize: 13, fontWeight: 600, color: '#16a34a', whiteSpace: 'nowrap', marginLeft: 'auto', flexShrink: 0 }}>
          이익률 {profitPct.toFixed(1)}%
        </span>
      </div>
      <div style={{ padding: '12px 16px' }}>
        {shown.map(({ row: r, no }, vi) => {
          const isDiscount = r.row_kind === 'discount'
          // **판매가가 아직 없는 품목도 자리를 지킨다.** 종전에는 공급가 0 인 줄을 걸러
          // 냈는데, 판매가 모드로 바꾸는 순간(단가를 적기 전) 그 품목이 패널에서 통째로
          // 사라져 아래 합계가 위로 솟았다 — 숫자를 치던 사람 눈앞에서 화면이 뛴다.
          //
          // 그 자리글은 **파는 줄에만** 낸다(가격표·직접 입력). 할인은 깎을 금액이 곧 그
          // 줄의 전부이고 국내 구매는 원가에서 판매가가 따라 나오므로, 둘에 「판매가 미입력」을
          // 적으면 적을 칸이 없는 것을 적으라고 말하는 꼴이다(종전에는 할인 줄에 떴다).
          const waiting = r.supply_price <= 0 && (r.row_kind === 'price_list' || r.row_kind === 'manual_jpy')
          const expr = costExpr(r)
          // 국내조달품은 마진이 없는 자사 부담 항목이라 이익 색상 규칙에서 제외한다(중립색).
          const profitColor = r.row_kind === 'domestic' ? '#6b7280' : (r.profit >= 0 ? '#16a34a' : '#dc2626')
          return (
          // 품목 사이에는 구분선을 두지 않는다 — 품목 다섯이면 선이 다섯이고, 그 선들이
          // 합계 위 굵은 선보다 먼저 눈에 들어온다. 대신 **홀수 블록에만 아주 연한 띠**를
          // 깔아 두 줄이 한 품목이라는 것을 묶어 보인다.
          //
          // 좌우로 음수 마진을 줘 **띠만** 바깥으로 넓힌다 — 안쪽 여백(8)을 그만큼 되돌려
          // 제목 줄 금액의 끝선이 아래 합계 금액 열과 **같은 자리**에 서게 한다.
          <div key={r.id} style={{
            background: vi % 2 === 0 ? '#fafbfc' : '#fff',
            borderRadius: 6, padding: '7px 8px', margin: '0 -8px 2px',
          }}>
            {/* 제목 줄 — 번호 · 품명 · ×수량 ……… 공급가(단가 × 수량). */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={numBadge}>{no}</span>
              <span style={{ fontSize: 11, color: '#111827', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemLabel(r)}</span>
              {/* 수량 — 할인 줄에는 수량이 없다(0 이다). */}
              {r.quantity > 0 && (
                <span className="num" style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>×{r.quantity}</span>
              )}
              <span style={{ flex: 1 }} />
              {!waiting && (
                // 할인은 **빼는 금액**이라 빨강에 음수 부호다(합계의 할인 줄과 같은 꼴).
                <span className="num" style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, color: isDiscount ? '#dc2626' : '#111827' }}>
                  {isDiscount ? <>−₩{numKR(Math.abs(r.supply_price))}</> : <>₩{numKR(r.supply_price)}</>}
                </span>
              )}
            </div>
            {/* 식 줄 — 할인에는 없다(제목 줄의 금액이 그 줄의 전부다). */}
            {!isDiscount && (waiting ? (
              <div style={itemLine}><span style={{ color: '#9ca3af' }}>판매가 미입력</span></div>
            ) : (
              // 넘치면 **식만** 줄인다. 매출이익은 이 줄에서 가장 중요한 값이라 끝까지
              // 남겨야 한다(원가보다 싸게 판 줄의 「(-24364.8%)」가 잘리면 그 줄이 멀쩡해 보인다).
              <div className="num" style={itemLine}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {expr}
                  <span style={{ color: '#d1d5db' }}> = </span>
                  <span style={{ color: '#374151', fontWeight: 500 }}>₩{numKR(r.product_price)}</span>
                  <span style={{ color: '#9ca3af' }}> (원가)</span>
                </span>
                <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                  <span style={{ color: '#d1d5db' }}> · </span>
                  매출이익{' '}
                  <span style={{ color: profitColor, fontWeight: 500 }}>₩{numKR(r.profit)}</span>
                  {/* **실현** 이익률(매출이익 ÷ 공급가)이다 — 이익률 칸의 목표가 아니다. */}
                  <span style={{ color: profitColor }}> ({r.realized_profit_rate.toFixed(1)}%)</span>
                </span>
              </div>
            ))}
          </div>
          )
        })}
        {/* 합계 — 위 품목과 **같은 열 폭**이라 금액이 한 줄에 선다(ROW_GRID). 띠 밖이다. */}
        <div style={{
          marginTop: 2, paddingTop: 7, borderTop: '2px solid #111827',
          display: 'grid', gridTemplateColumns: ROW_GRID, columnGap: 8, rowGap: 5, alignItems: 'baseline',
        }}>
          <span style={{ ...labelCell, gridColumn: '1 / 3' }}>공급가 합계</span>
          <span className="num" style={{ ...amountCell, fontSize: 13, color: '#111827', fontWeight: 600 }}>₩{numKR(totalSupply)}</span>

          <span style={{ ...labelCell, gridColumn: '1 / 3' }}>원가 합계</span>
          <span className="num" style={{ ...amountCell, fontSize: 13, color: '#dc2626', fontWeight: 600 }}>−₩{numKR(totalProduct)}</span>

          {/* 할인 — 총액에서 빠진 금액. 행 목록에는 공급가가 음수라 나오지 않으므로 여기서 알린다. */}
          {discountAmt < 0 && (
            <>
              <span style={{ ...labelCell, gridColumn: '1 / 3' }}>할인</span>
              <span className="num" style={{ ...amountCell, fontSize: 13, color: '#dc2626', fontWeight: 500 }}>−₩{numKR(Math.abs(discountAmt))}</span>
            </>
          )}

          {/* 국내조달품이 원가에 얼마나 얹혔는지 — 마진 조절 판단용. 해당 행이 없으면 표시하지 않는다. */}
          {domesticCost > 0 && (
            <>
              <span style={{ ...labelCell, gridColumn: '1 / 3' }}>{ROW_KIND_LABEL.domestic}</span>
              <span className="num" style={{ ...amountCell, fontSize: 13, color: '#6b7280', fontWeight: 600 }}>₩{numKR(domesticCost)}</span>
            </>
          )}

          <span style={{ ...labelCell, gridColumn: '1 / 3' }}>
            매출이익 합계 <span style={{ color: '#9ca3af' }}>({profitPct.toFixed(1)}%)</span>
          </span>
          {/* 매출이익이 **음수면 빨강**이다 — 원가가 매출을 넘은 견적을 초록으로 적으면
              가장 큰 사고를 가장 안심되는 색으로 알리는 꼴이 된다(품목 줄과 같은 규칙). */}
          <span className="num" style={{ ...amountCell, fontSize: 13, color: totalProfit >= 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>₩{numKR(totalProfit)}</span>

          {breakdown.hasSga && (
            <>
              <span style={{ ...labelCell, gridColumn: '1 / 3' }}>
                판관비 <span style={{ color: '#9ca3af' }}>({sgaNote})</span>
              </span>
              <span className="num" style={{ ...amountCell, fontSize: 13, color: '#dc2626', fontWeight: 500 }}>−₩{numKR(breakdown.sga)}</span>

              <span style={{ ...labelCell, gridColumn: '1 / 3', color: '#111827', fontWeight: 700, borderTop: '1px solid #ebebeb', paddingTop: 6, marginTop: 1 }}>
                영업이익 <span style={{ color: '#9ca3af', fontWeight: 500 }}>({breakdown.operatingRate.toFixed(1)}%)</span>
              </span>
              <span className="num" style={{ ...amountCell, fontSize: 13, fontWeight: 700, color: breakdown.operatingProfit >= 0 ? '#16a34a' : '#dc2626', borderTop: '1px solid #ebebeb', paddingTop: 6, marginTop: 1 }}>
                ₩{numKR(breakdown.operatingProfit)}
              </span>
              {/* 하한 미만 — 빨간 경고와 사유 칸. 사유가 없어도 확정은 막지 않는다.
                  사유는 quotes.note 끝에 「[영업이익 사유] …」로 저장되고 고객 견적서에는
                  나가지 않는다(lib/quoteOperatingNote.ts). */}
              {belowMin && minOperating !== null && (
                <div style={{ gridColumn: '1 / -1', marginTop: 4, paddingTop: 8, borderTop: '1px solid #ebebeb' }}>
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
