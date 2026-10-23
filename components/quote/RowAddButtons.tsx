'use client'

// 견적 작성 화면의 **품목 행 추가 버튼** 다섯 개 — 품목 · 수동입력 · 국내조달품 · 서비스비 · 할인.
//
// app/quote/page.tsx 에서 **그대로 옮겨 온 것**이다(분리 리팩터 3a). JSX·스타일·문구·주석·
// hover 처리를 한 글자도 바꾸지 않았다(들여쓰기 12칸만 덜어냈다).
//
// 서비스비와 할인은 **견적당 1건**이라 이미 있으면 비활성이다. 그 판정에 쓰는 두 행은
// rows 에서 파생된 값이라 화면에서 받는다(useQuoteRows 의 serviceRow·discountRow).

import type { QuoteRow } from '@/app/quote/types'
import {
  createDiscountRow, createDomesticRow, createManualJpyRow, createRow, createServiceRow,
} from '@/app/quote/calc'

export type RowAddButtonsProps = {
  setRows: React.Dispatch<React.SetStateAction<QuoteRow[]>>
  /** 서비스비 행(있으면 그 버튼이 잠긴다). */
  serviceRow: QuoteRow | null
  /** 할인 행(있으면 그 버튼이 잠긴다). */
  discountRow: QuoteRow | null
  /** 지금 고른 견적 분류 — 새 줄의 이익률 기본값이 여기서 나온다(TSE 60 · 그 밖 40). */
  category?: string
}

export default function RowAddButtons({ setRows, serviceRow, discountRow, category }: RowAddButtonsProps) {
  // 행 추가 버튼 — 1행: 주버튼(품목) + 수동입력 / 2행: 국내조달품 + 서비스비
  return (
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
  <button
    onClick={() => setRows(prev => [...prev, createRow(category)])}
    style={{ minWidth: 0, padding: '11px', background: '#234ea2', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'background 0.15s ease' }}
    onMouseEnter={e => (e.currentTarget.style.background = '#1c3e87')}
    onMouseLeave={e => (e.currentTarget.style.background = '#234ea2')}
  >
    + 품목 추가
  </button>
  {/* 수동입력 품목 — 가격표에 없는 제품. 개수 제한 없음. */}
  <button
    onClick={() => setRows(prev => [...prev, createManualJpyRow(category)])}
    title="가격표에 없는 품목을 구입가(JPY) 직접 입력으로 추가합니다"
    style={{ minWidth: 0, padding: '11px', background: '#fff', color: '#234ea2', border: '1px solid #ebebeb', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'background 0.15s ease' }}
    onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6')}
    onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#fff')}
  >
    + 수동입력
  </button>
  {/* 국내조달품 — 원화 원가만. 고객 견적서에는 금액 없이 포함사항으로 나간다. */}
  <button
    onClick={() => setRows(prev => [...prev, createDomesticRow(category)])}
    title="국내에서 조달하는 항목(원화 원가만, 마진 없음)"
    style={{ minWidth: 0, padding: '11px', background: '#fff', color: '#234ea2', border: '1px solid #ebebeb', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'background 0.15s ease' }}
    onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6')}
    onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#fff')}
  >
    + 국내조달품
  </button>
  {/* 서비스비는 견적당 1건. 이미 있으면 비활성. */}
  <button
    onClick={() => setRows(prev => [...prev, createServiceRow()])}
    disabled={serviceRow !== null}
    title={serviceRow !== null ? '서비스비는 견적당 1건만 추가할 수 있습니다' : undefined}
    style={{ minWidth: 0, padding: '11px', background: '#fff', color: serviceRow !== null ? '#9ca3af' : '#234ea2', border: '1px solid #ebebeb', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: serviceRow !== null ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'background 0.15s ease' }}
    onMouseEnter={e => { if (serviceRow === null) (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}
    onMouseLeave={e => { if (serviceRow === null) (e.currentTarget as HTMLButtonElement).style.background = '#fff' }}
  >
    + 서비스비
  </button>
  {/* 할인 — 총액에서 한 번만 빼므로 견적당 1건. 이미 있으면 비활성. */}
  <button
    onClick={() => setRows(prev => [...prev, createDiscountRow()])}
    disabled={discountRow !== null}
    title={discountRow !== null ? '할인은 견적당 1건만 추가할 수 있습니다' : '총액에서 빼는 할인 행을 추가합니다'}
    style={{ gridColumn: '1 / -1', minWidth: 0, padding: '11px', background: '#fff', color: discountRow !== null ? '#9ca3af' : '#234ea2', border: '1px solid #ebebeb', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: discountRow !== null ? 'not-allowed' : 'pointer', transition: 'background 0.15s ease' }}
    onMouseEnter={e => { if (discountRow === null) (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}
    onMouseLeave={e => { if (discountRow === null) (e.currentTarget as HTMLButtonElement).style.background = '#fff' }}
  >
    + DISCOUNT
  </button>
</div>
  )
}
