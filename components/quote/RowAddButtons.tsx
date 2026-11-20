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
  createTitleRow,
  type RowDefaults,
} from '@/app/quote/calc'
import { ROW_KIND_HINT, ROW_KIND_LABEL, ROW_KIND_ORDER } from '@/lib/quoteRowKinds'
import { R } from '@/lib/radius'

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
      // 제목줄은 글자만 있는 줄이라 분류 기본값(관세·이익률)을 받지 않는다.
      case 'title': return createTitleRow()
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
    // 폭이 340px 까지 좁아져도 **한 줄**이어야 한다(실측 기준). 사이 여백 4 · 좌우 4 가 그 선이다.
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {ROW_KIND_ORDER.map(kind => {
        const locked = lockedOf(kind)
        return (
          <button
            key={kind}
            onClick={() => setRows(prev => [...prev, makeRow(kind)])}
            disabled={locked !== null}
            title={locked ?? ROW_KIND_HINT[kind]}
            style={{
              // 다섯이 **같은 옷**이다 — 흰 바탕·회색 테두리·파란 글자. 가격표만 파랗게
              // 칠해 두었더니 그것이 「확정」 같은 실행 단추로 보였다(이 띠는 줄을 하나
              // 더하는 자리일 뿐이다). 어느 것을 더 자주 쓰는지는 **왼쪽부터**라는 차례가
              // 이미 말한다(ROW_KIND_ORDER).
              //
              // 글자 앞의 「+」는 되돌렸다 — 무엇을 하는 띠인지는 그 기호 하나가 가장 짧게
              // 말한다. 그만큼 폭이 늘어 좌우 여백을 4 로 줄이고 글자를 11px 로 낮췄다.
              //
              // **여섯이 한 줄에 들어가는 최소 폭은 362px 다**(실측 — 여섯 합 + 사이 여백.
              // 12px 이면 388 이다). 지금 화면에서 이 띠에 주어지는 폭은 388 이라 한 줄이다
              // (품목 패널 412 − 좌우 여백 42 … 칼럼 폭이 430 으로 고정이라 흔들리지 않는다).
              // 제목줄이 더해지기 전 다섯이던 때의 기준(340px 한 줄)은 이제 지킬 수 없다 —
              // 여백·글자를 더 줄여도(11px·여백 2) 334 가 바닥이다.
              height: 28, padding: '0 4px', borderRadius: R.icon, flex: '1 1 auto', minWidth: 0,
              background: '#fff',
              color: locked ? '#9ca3af' : '#234ea2',
              border: '1px solid #ebebeb',
              fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap',
              cursor: locked ? 'not-allowed' : 'pointer', transition: 'background 0.15s ease',
            }}
            onMouseEnter={e => { if (!locked) e.currentTarget.style.background = '#f3f4f6' }}
            onMouseLeave={e => { if (!locked) e.currentTarget.style.background = '#fff' }}
          >
            + {ROW_KIND_LABEL[kind]}
          </button>
        )
      })}
    </div>
  )
}
