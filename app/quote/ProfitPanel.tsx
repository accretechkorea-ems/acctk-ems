'use client'

import { useState } from 'react'
import type { QuoteRow, RateMeta } from './types'
import { calcTotals } from './calc'
import { numKR } from './format'
import {
  belowMinOperatingMessage, isBelowMinOperating, minOperatingMarginOf, profitBreakdown,
} from '@/lib/quoteProfit'

export type ProfitPanelProps = {
  rows: QuoteRow[]
  exchangeRate: number
  /** 그 환율이 어디서 온 값인가. 아직 못 받았으면 null(app/quote/types.ts). */
  rateMeta: RateMeta | null
  rateLoading: boolean
  /** 새로고침 — 저장된 값을 보지 않고 **늘 API** 로 다시 받는다(page.tsx 의 fetchRate). */
  onFetchRate: () => void
  onRateChange: (rate: number) => void
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
  rows, exchangeRate, rateMeta, rateLoading, onFetchRate, onRateChange, category, savedDefaultsApplied,
  operatingReason, setOperatingReason,
}: ProfitPanelProps) {
  const [editingRate, setEditingRate] = useState(false)
  const [editRateVal, setEditRateVal] = useState('')

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
  const rateNote = (): { head: string; rest: string } | null => {
    if (!rateMeta) return null
    if (rateMeta.kind === 'manual') return { head: '직접 입력', rest: '' }
    if (rateMeta.kind === 'saved') {
      return rateMeta.savedAt ? { head: '저장된 설정 ·', rest: rateMeta.savedAt } : { head: '저장된 설정', rest: '' }
    }
    return {
      head: `${rateMeta.source} ·`,
      rest: rateMeta.kind === 'cache'
        ? `기준일 ${rateMeta.baseDate} · 저장값`
        : `기준일 ${rateMeta.baseDate} · ${rateMeta.fetchedAt} 조회`,
    }
  }

  const note = rateNote()

  const startEdit = () => {
    setEditRateVal(exchangeRate ? exchangeRate.toFixed(4) : '')
    setEditingRate(true)
  }
  const commitEdit = () => {
    const n = parseFloat(editRateVal)
    if (!isNaN(n) && n > 0) onRateChange(n)
    setEditingRate(false)
  }
  // 통합 전 이 자리의 계산식은 calcTotals 와 문자 단위로 동일했다(변수명만 다름).
  const { totalSupply, totalCost: totalProduct, totalProfit, totalProfitRate: profitPct, domesticCost } = calcTotals(rows)
  // 할인 금액(음수). calcTotals 는 건드리지 않고 여기서만 모아 표시용으로 쓴다.
  const discountAmt = rows.filter(r => r.row_kind === 'discount').reduce((s, r) => s + r.supply_price, 0)
  // 판관비·영업이익 — 분류 규칙(lib/quoteProfit.ts)으로 계산한 **표시용** 값이다.
  const breakdown = profitBreakdown(totalSupply, totalProduct, category)
  const sgaPct = totalSupply > 0 ? (breakdown.sga / totalSupply) * 100 : 0
  // 영업이익 하한 — 분류가 정한다(TSE 15% · SBS 6%). 미만이면 사유를 묻는다.
  // **확정을 막지는 않는다** — 경고일 뿐이다(lib/quoteProfit.ts).
  const minOperating = minOperatingMarginOf(category)
  const belowMin = isBelowMinOperating(breakdown, category)

  // 행 종류별 원가 상세. 새 종류(manual_jpy·domestic)는 case 만 추가하면 된다.
  // null 을 반환하면 원가 줄 없이 판매단가부터 표시된다(구분선도 생략).
  const costDetail = (r: QuoteRow) => {
    switch (r.row_kind) {
      case 'price_list':
      case 'manual_jpy':   // 구입가 출처만 다르고 원가 산출은 동일하다
        return (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>구입가</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>¥{r.cost_price_jpy.toLocaleString()}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>관세 × 환율</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>×{r.tariff_rate} × {r.exchange_rate.toFixed(2)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>원가</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>₩{numKR(r.product_price)}</span></div>
          </>
        )
      case 'service':
        return (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>부대비용</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>{r.expenses.length}건</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>원가</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>₩{numKR(r.product_price)}</span></div>
          </>
        )
      case 'domestic':
        return (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>원가</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>₩{numKR(r.product_price)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>이익</span><span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>이익 없음</span></div>
          </>
        )
    }
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
          {editingRate ? (
            <input
              type="number"
              value={editRateVal}
              onChange={e => setEditRateVal(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingRate(false) }}
              autoFocus
              style={{ width: 80, fontSize: 11, fontWeight: 700, color: '#234ea2', border: '1px solid #234ea2', borderRadius: 6, padding: '1px 5px', outline: 'none' }}
            />
          ) : (
            <span
              onDoubleClick={startEdit}
              title="더블클릭하여 수동 입력"
              // 이 숫자에 원가가 전부 걸려 있어 머리줄에서 가장 크게 읽힌다(11 → 17px, 진한 색).
              // 숫자와 「원」은 한 덩어리다 — 「원」만 다음 줄로 내려가면 숫자가 아닌 것으로 읽힌다.
              // 「원」은 13px 로 한 급 낮춘다(숫자가 먼저 읽히게).
              style={{
                fontSize: 17, color: '#111827', fontWeight: 700, cursor: 'text', lineHeight: 1.2,
                borderBottom: '1px dashed #9ca3af', whiteSpace: 'nowrap', flexShrink: 0,
                letterSpacing: '-0.3px',
              }}>
              {exchangeRate
                ? <>{exchangeRate.toFixed(4)}<span style={{ fontSize: 13, fontWeight: 700 }}>원</span></>
                : <span style={{ fontSize: 11, fontWeight: 500, color: '#6b7280' }}>환율 로딩중...</span>}
            </span>
          )}
          {/* 출처·기준 시각. 숫자를 고치는 중에는 내지 않는다(그 순간의 출처는 아직 모른다).
              폭이 모자라면 **이 글자만** 두 줄로 접힌다(아래 두 토막 사이의 공백 한 곳). */}
          {!editingRate && note && (
            <span style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'normal', lineHeight: 1.35, minWidth: 0 }}>
              <span style={{ whiteSpace: 'nowrap' }}>{note.head}</span>
              {note.rest && <>{' '}<span style={{ whiteSpace: 'nowrap' }}>{note.rest}</span></>}
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
          const detail = costDetail(r)
          return (
          <div key={r.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#234ea2', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
              <span style={{ fontSize: 11, color: '#111827', fontWeight: 600 }}>{r.itemText && r.itemText}{r.selectedItem && ` (${r.selectedItem.model_jp})`}</span>
            </div>
            {detail}
            <div style={{ borderTop: detail ? '1px solid #ebebeb' : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>판매단가</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>₩{numKR(r.unit_price)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>공급가</span><span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>₩{numKR(r.supply_price)}</span></div>
              {/* 국내조달품은 마진이 없는 자사 부담 항목이라 이익 색상 규칙에서 제외한다(중립색). */}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}><span style={{ fontSize: 12, color: '#6b7280' }}>매출이익 <span style={{ color: r.row_kind === 'domestic' ? '#6b7280' : (r.profit >= 0 ? '#16a34a' : '#dc2626') }}>({r.profit_rate}%)</span></span><span style={{ fontSize: 13, color: r.row_kind === 'domestic' ? '#6b7280' : (r.profit >= 0 ? '#16a34a' : '#dc2626'), fontWeight: 500 }}>₩{numKR(r.profit)}</span></div>
            </div>
          </div>
          )
        })}
        <div style={{ marginTop: 4, paddingTop: 6, borderTop: '2px solid #111827' }}>
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
                <span style={{ fontSize: 12, color: '#6b7280' }}>판관비 <span style={{ color: '#9ca3af' }}>(매출 × {(sgaPct).toFixed(0)}%)</span></span>
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
