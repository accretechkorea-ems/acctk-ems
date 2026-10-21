'use client'

// 모달 **오른쪽** 요약 — 소계 · 특별 할인 · 합계 · 부가세 · 총계 · 총 원가 · 이익률.
//
// 숫자는 전부 useEquipConfig 가 calcTotals(app/quote/calc.ts)로 낸 값이다. 견적 화면·PDF 가
// 쓰는 그 함수라서 **모달과 견적서의 숫자가 갈라질 수 없다.**
// 국내조달품은 매출에서 빠지고 원가에만 들어간다(calcTotals 의 정의 그대로).

import { C, S, num, parseNum, won } from './equipStyles'
import type { EquipLine } from './equipLines'

export type EquipSummaryProps = {
  modelKey: string
  machineQty: number
  lines: EquipLine[]
  discount: number
  setDiscount: (v: number) => void
  totals: {
    subtotal: number
    supply: number
    tax: number
    amount: number
    cost: number
    profitRate: number
    domesticCost: number
  }
}

export default function EquipSummary(props: EquipSummaryProps) {
  const { modelKey, machineQty, lines, discount, setDiscount, totals } = props
  const picked = lines.filter(l => l.checked)

  return (
    <div>
      <h3 style={S.rightLabel}>견적 요약</h3>
      <div style={S.pill}>
        <b style={{ fontWeight: 700 }}>{modelKey.trim() || '기종 미지정'}</b>
        {` × ${machineQty}대`}
      </div>

      <h3 style={S.rightLabel}>선택 항목 {picked.length}개</h3>
      <ul style={{ margin: '6px 0 12px', paddingLeft: 16, color: C.MUT, fontSize: 12, fontWeight: 500 }}>
        {picked.length === 0 && <li style={{ color: C.DIM }}>선택한 항목이 없습니다</li>}
        {picked.map(l => (
          <li key={l.row.id}>
            {(l.row.partCode.trim() || l.row.itemText.trim() || '이름 없음')} × {l.row.quantity}
          </li>
        ))}
      </ul>

      <div style={S.kv}><span>소 계</span><span className="num">{won(totals.subtotal)}</span></div>
      <div style={S.kv}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          특별 할인
          <input
            value={discount || ''}
            onChange={e => setDiscount(parseNum(e.target.value))}
            aria-label="특별 할인"
            style={{ ...S.num, width: 84 }}
          />
        </span>
        <span className="num" style={{ color: C.RED, whiteSpace: 'nowrap' }}>
          {discount > 0 ? `- ₩${num(discount)}` : '-'}
        </span>
      </div>
      <div style={S.kv}><span>합 계</span><span className="num">{won(totals.supply)}</span></div>
      <div style={S.kv}><span>부가세 10%</span><span className="num">{won(totals.tax)}</span></div>
      <div style={S.kvBold}><span>총 계</span><span className="num">{won(totals.amount)}</span></div>

      <div style={{ ...S.pill, marginTop: 14 }}>
        <div style={{ ...S.kv, padding: '2px 0' }}>
          <span style={{ color: C.MUT }}>총 구입원가</span>
          <span className="num">{won(totals.cost)}</span>
        </div>
        {totals.domesticCost > 0 && (
          <div style={{ ...S.kv, padding: '2px 0' }}>
            <span style={{ color: C.MUT }}>그중 원화 원가</span>
            <span className="num" style={{ color: C.MUT }}>{won(totals.domesticCost)}</span>
          </div>
        )}
        <div style={{ ...S.kv, padding: '2px 0' }}>
          <span style={{ color: C.MUT }}>이익률 (할인 후)</span>
          <b className="num" style={{ fontWeight: 700 }}>
            {totals.supply > 0 ? `${totals.profitRate.toFixed(1)}%` : '-'}
          </b>
        </div>
      </div>
    </div>
  )
}
