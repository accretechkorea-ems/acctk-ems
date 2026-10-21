// 가격표 품목을 고를 때 **품명 칸에 무엇이 들어가는가** — 순수 함수 하나.
//
// 훅(hooks/quote/useQuoteRows.ts 의 handleSelect) 안에 있던 식을 꺼냈다.
// 20·80 이 갈리는 자리라서, 화면 없이 **값으로 증명**할 수 있어야 한다
// (scripts/price-list-parse-check.js 가 이 함수를 그대로 돌린다).

import { isTwentySheet } from './priceListKinds'
import type { PriceItem } from '@/app/quote/types'

/**
 * 품목을 고른 뒤 품명 칸에 채울 글자.
 *
 * ── 20 과 80 이 다르다 ──────────────────────────────────────────────────────
 *   80 가격표 — **「(설명)」**을 붙인다(model_jp = Description·규격).
 *     80 견적서에는 모델 열이 없어 규격이 품명에 함께 나가야 한다.
 *   20 가격표 — **PRODUCT NAME**(item_name_jp)을 넣는다.
 *     20 견적서에는 모델 열이 따로 있고 그 열이 model_jp(= SPEC)를 읽는다
 *     (app/quote/QuotePDFDoc.tsx 의 modelText). 품명에 「(SPEC)」을 붙이면 PDF 가
 *     그것을 떼어 내(stripModelSuffix) **품명 칸이 비어 버린다.**
 *
 * ── 판별은 가격표(sheet_name)로 한다 ───────────────────────────────────────
 *   견적 양식으로 가르지 않는다. 「전체 가격표에서 검색」을 켜면 80 양식에서도 20 품목을
 *   고를 수 있고, 그때도 그 줄이 온 가격표의 규칙을 따라야 한다.
 *
 * ── 덧붙이기 규칙은 종전과 같다 ────────────────────────────────────────────
 *   처음 선택이면 사용자가 적어 둔 글자 뒤에 덧붙이고, 이미 다른 품목이 선택돼 있었으면
 *   비우고 새 값만 넣는다. 채울 값이 없으면 손대지 않는다.
 */
/**
 * 모델 열이 **없는** 양식(80)에서 품명 뒤에 붙일 「(모델)」.
 *
 * 가격표 품목은 고르는 순간 품명에 「(model_jp)」가 붙는다(아래 itemTextOnSelect 의 80 규칙).
 * 직접 적은 줄은 그 자리가 비어 있어, 모델 칸(QuoteRow.manual_model)에 적은 값을
 * **그릴 때** 같은 모양으로 붙인다 — 값은 건드리지 않는다.
 *   · 모델이 비었으면 품명 그대로.
 *   · 이미 같은 괄호로 끝나면 두 번 붙이지 않는다(사람이 품명에 직접 적은 경우).
 * 20 양식은 모델 열이 따로 있어 이 함수를 쓰지 않는다(그 열이 모델을 받고, 품명 끝의
 * 「(모델)」은 app/quote/QuotePDFDoc.tsx 의 stripModelSuffix 가 떼어 낸다).
 */
export function withModelSuffix(name: string, model: string): string {
  const m = model.trim()
  if (m === '') return name
  const tail = `(${m})`
  const base = name.trimEnd()
  if (base.endsWith(tail)) return base
  return base ? `${base} ${tail}` : tail
}

export function itemTextOnSelect(prevText: string, hadItem: boolean, item: PriceItem): string {
  const fill = isTwentySheet(item.sheet_name)
    ? (item.item_name_jp ?? '').trim()
    : (item.model_jp ? `(${item.model_jp})` : '')
  if (hadItem) return fill
  if (!fill) return prevText
  const base = prevText.trimEnd()
  return base ? `${base} ${fill}` : fill
}
