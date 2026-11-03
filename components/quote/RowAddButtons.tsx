'use client'

// 견적 작성 화면의 **품목 줄 추가 버튼** — 가격표 · 직접 입력 · 국내 구매 · 서비스비 · 할인.
//
// ── 큰 단추 다섯에서 작은 띠 하나로 ────────────────────────────────────────
//   종전에는 11px 패딩의 큰 단추가 2열 3줄로 쌓여 품목 목록 아래를 150px 넘게 차지했다.
//   줄을 하나 더 넣는 일보다 **이미 넣은 줄을 고치는 일**이 훨씬 잦은데, 그 자리를 단추가
//   먹고 있었다. 높이 30px 짜리 한 줄로 눕히고 좁으면 접히게 둔다.
//
// 이름은 lib/quoteRowKinds.ts 한 곳에서 온다 — 줄 머리의 배지와 **같은 글자**여야 한다.
//
// 서비스비와 할인은 **견적당 1건**이라 이미 있으면 비활성이다. 그 판정에 쓰는 두 행은
// rows 에서 파생된 값이라 화면에서 받는다(useQuoteRows 의 serviceRow·discountRow).

import type { QuoteRow, RowKind } from '@/app/quote/types'
import {
  createDiscountRow, createDomesticRow, createManualJpyRow, createRow, createServiceRow,
  type RowDefaults,
} from '@/app/quote/calc'
import { ROW_KIND_HINT, ROW_KIND_LABEL, ROW_KIND_ORDER } from '@/lib/quoteRowKinds'

export type RowAddButtonsProps = {
  setRows: React.Dispatch<React.SetStateAction<QuoteRow[]>>
  /** 서비스비 행(있으면 그 버튼이 잠긴다). */
  serviceRow: QuoteRow | null
  /** 할인 행(있으면 그 버튼이 잠긴다). */
  discountRow: QuoteRow | null
  /** 지금 고른 견적 분류 — 새 줄의 이익률 기본값이 여기서 나온다(TSE 60 · 그 밖 40). */
  category?: string
  /**
   * 저장된 내 설정(관세율·이익률) — 있으면 **분류 기본값보다 앞선다.**
   * 그 사람이 그 분류로 마지막에 확정한 값이다(lib/quoteUserDefaults.ts).
   * 서비스비·할인 줄에는 넘기지 않는다 — 두 줄에는 관세도 이익률도 뜻이 없다.
   */
  rowDefaults?: RowDefaults | null
}

export default function RowAddButtons({ setRows, serviceRow, discountRow, category, rowDefaults }: RowAddButtonsProps) {
  const d = rowDefaults ?? undefined

  /** 그 종류의 새 줄을 만든다 — 서비스비·할인에는 분류 기본값을 넘기지 않는다. */
  const makeRow = (kind: RowKind): QuoteRow => {
    switch (kind) {
      case 'manual_jpy': return createManualJpyRow(category, d)
      case 'domestic': return createDomesticRow(category, d)
      case 'service': return createServiceRow()
      case 'discount': return createDiscountRow()
      default: return createRow(category, d)
    }
  }

  /** 견적당 1건인 두 종류 — 이미 있으면 잠근다. */
  const lockedOf = (kind: RowKind): string | null => {
    if (kind === 'service' && serviceRow !== null) return '서비스비는 견적당 1건만 추가할 수 있습니다'
    if (kind === 'discount' && discountRow !== null) return '할인은 견적당 1건만 추가할 수 있습니다'
    return null
  }

  return (
    // 폭이 340px 까지 좁아져도 **한 줄**이어야 한다(실측 기준). 여백 4 · 좌우 6 이 그 선이다.
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {ROW_KIND_ORDER.map(kind => {
        // 가격표 줄이 주버튼이다 — 열에 아홉은 이것으로 넣는다.
        const primary = kind === 'price_list'
        const locked = lockedOf(kind)
        return (
          <button
            key={kind}
            onClick={() => setRows(prev => [...prev, makeRow(kind)])}
            disabled={locked !== null}
            title={locked ?? ROW_KIND_HINT[kind]}
            style={{
              // 다섯이 **한 줄**에 들어가야 한다(340px 폭 기준). 그래서 글자에서 「+」를 떼고
              // 좌우 여백을 8 로 줄였다 — 「+ 」 다섯 개가 50px 쯤을 먹어 그것만으로 줄이
              // 넘쳤다. 폭 규칙은 다섯이 같다(주버튼도 같다 — 색만 다르다).
              height: 28, padding: '0 6px', borderRadius: 6, flex: '1 1 auto', minWidth: 0,
              background: primary && !locked ? '#234ea2' : '#fff',
              color: locked ? '#9ca3af' : primary ? '#fff' : '#234ea2',
              border: primary && !locked ? 'none' : '1px solid #ebebeb',
              fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
              cursor: locked ? 'not-allowed' : 'pointer', transition: 'background 0.15s ease',
            }}
            onMouseEnter={e => {
              if (locked) return
              e.currentTarget.style.background = primary ? '#1c3e87' : '#f3f4f6'
            }}
            onMouseLeave={e => {
              if (locked) return
              e.currentTarget.style.background = primary ? '#234ea2' : '#fff'
            }}
          >
            {ROW_KIND_LABEL[kind]}
          </button>
        )
      })}
    </div>
  )
}
