// 저장값 → 견적서 PDF props 변환 — 순수 함수만 둔다(DB·화면 의존 없음).
//
// 결재 대상 견적서는 **저장된 PDF 파일을 열지 않는다.** 확정 때 만든 파일에는 승인일이 없고,
// 결재가 끝나기 전에 그 파일이 고객에게 나가면 안 된다. 그래서 PDF 버튼을 누를 때
// DB 에 저장된 값으로 브라우저가 그 자리에서 다시 만든다.
//
// **절대 재계산하지 않는다.**
//   환율을 다시 가져오지 않고, calc.ts 로 단가·공급가·부가세를 다시 구하지도 않는다.
//   저장된 unit_price_krw·supply_amount·tax_amount·total_* 를 **그대로 꽂는다.**
//   「다시쓰기」(applyDuplicate)는 일부러 환율을 다시 계산하지만(새 견적을 쓰는 길이다),
//   이쪽은 **이미 확정된 견적을 그대로 다시 그리는** 길이라 규칙이 반대다.
//
// 복원할 수 없는 값
//   · showSignature (발주 확인 서명란) — 화면 체크박스이고 저장하지 않는다. 넣지 않는다(= 없음).
//   · showWatermark (미리보기 워터마크) — 미리보기 전용이다. 넣지 않는다.
//
// subLines (품명 아래 설명 줄 — 시리얼 번호 등)는 **이제 복원된다.** quote_items.sub_lines 에
// 저장되고 subLinesOf 가 풀어 준다. sub_lines 가 null 인 옛 견적은 빈 배열이 되어
// 지금까지와 똑같이 그려진다 — 이 변경으로 옛 견적의 PDF 는 한 글자도 달라지지 않는다.

import type { PDFDocProps } from '@/app/quote/QuotePDFDoc'
import type { QuoteRow, RowKind } from '@/app/quote/types'
import { kstYmd } from '@/lib/date'
import { termsOf } from '@/lib/quoteTerms'
import { subLinesOf } from '@/lib/quoteSubLines'

/**
 * 저장값으로 되살릴 수 없는 PDF 요소. 보고·주석에서 한 곳을 가리키도록 적어 둔다.
 * 금액·품명·품번·수량·설명 줄은 전부 저장되므로 되살아난다 — 아래 하나만 다르다.
 * (subLines 는 quote_items.sub_lines 가 생기면서 빠졌다.)
 */
export const PDF_UNRESTORABLE = [
  'showSignature (서명란) — 화면 체크박스이고 저장되지 않는다',
] as const

/** 결재가 끝나기 전 날짜 자리에 넣는 문구. */
export const APPROVAL_PENDING_TEXT = '결재 완료 시 날짜 자동 입력 예정'

/**
 * 날짜 줄 서식 — 확정 흐름(app/quote/page.tsx:214)과 **같은 식**이다.
 * 사이 공백은 전각(U+3000)이다. 바꾸면 확정 때 PDF 와 글자가 어긋난다.
 */
export const formatQuoteDate = (ymd: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${m[1]}년　${m[2]}월　${m[3]}일` : ''
}

// ── 들어오는 모양(DB 행 그대로) ──────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export type PdfQuoteRow = {
  quote_number: string | null
  recipient: string | null
  note: string | null
  total_supply: unknown
  total_tax: unknown
  total_amount: unknown
  /**
   * 조건 네 줄(quotes.terms jsonb). null·없음·깨진 값이면 termsOf 가 기본값으로 풀어 준다
   * — 그래서 terms 가 없던 옛 견적의 PDF 는 한 글자도 달라지지 않는다.
   */
  terms?: unknown
}

export type PdfItemRow = {
  item_id: number
  row_kind: string | null
  part_code: string | null
  product_name: string | null
  quantity: unknown
  unit_price_krw: unknown
  supply_amount: unknown
  tax_amount: unknown
  /**
   * 품명 아래 설명 줄(quote_items.sub_lines jsonb). null·없음이면 줄이 없다는 뜻이고,
   * 그 칸이 생기기 전의 견적은 전부 null 이다(backfill 하지 않았다).
   */
  sub_lines?: unknown
}

export type PdfDataInput = {
  quote: PdfQuoteRow
  items: PdfItemRow[]
  /** 수신처(「○○ 귀하」) — 서버가 견적서와 같은 규칙으로 만든 이름(회사명 우선). */
  company: string | null
  /** 담당자 줄 — 실적 담당자의 「이름 직급」과 전화번호(확정 때와 같다). */
  engineerName: string | null
  engineerTel: string | null
  /**
   * 결재 완료 시각(approval_documents.completed_at). 완료된 문서가 없으면 null.
   * null 이면 날짜 자리에 APPROVAL_PENDING_TEXT 를 빨간 글씨로 낸다.
   */
  approvedAt: string | null
}

/**
 * 저장된 한 행을 PDF 가 읽는 모양으로 옮긴다.
 *
 * PDF 가 실제로 읽는 칸은 여덟이다 — row_kind · partCode · itemText · subLines ·
 * quantity · unit_price · supply_price · tax (app/quote/QuotePDFDoc.tsx 의 품목 루프).
 * 나머지는 QuoteRow 타입을 채우기 위한 자리이고 **PDF 에 쓰이지 않는다.**
 * 그래서 0 으로 둔다 — 저장값(원가·이익)을 넣어도 그려지지 않으므로, 넣으면
 * 「PDF 가 원가를 안다」는 오해만 남는다.
 */
function toPdfRow(it: PdfItemRow): QuoteRow {
  const kind = (it.row_kind ?? 'price_list') as RowKind
  return {
    // id 는 React key 로만 쓰인다 — 저장된 item_id 가 유일하므로 그대로 쓴다(난수를 쓰지 않는다).
    id: String(it.item_id),
    itemText: it.product_name ?? '',
    selectedItem: null,
    // 저장된 설명 줄. null(= 줄 없음)·깨진 값이면 빈 배열이라 지금까지와 같이 그려진다.
    subLines: subLinesOf(it.sub_lines),
    quantity: num(it.quantity),
    unit_price: num(it.unit_price_krw),
    supply_price: num(it.supply_amount),
    tax: num(it.tax_amount),
    partCode: it.part_code ?? '',
    row_kind: kind,
    // ── 아래는 PDF 가 읽지 않는다(QuoteRow 를 채우는 자리) ──
    manual_unit_price: 0,
    tariff_rate: 0,
    exchange_rate: 0,
    profit_rate: 0,
    realized_profit_rate: 0,
    cost_price_jpy: 0,
    product_price: 0,
    profit: 0,
    manual_cost_jpy: 0,
    price_mode: 'rate',
    expenses: [],
  }
}

/** 결재 상태에 따른 날짜 자리. 완료면 날짜, 아니면 빨간 안내. */
export function approvalDateProps(approvedAt: string | null): {
  approvalDate?: string
  approvalPending?: boolean
} {
  if (!approvedAt) return { approvalPending: true }
  const ymd = kstYmd(approvedAt)
  // 해석할 수 없으면 날짜를 지어내지 않는다 — 아직 안 나온 것으로 둔다.
  return ymd ? { approvalDate: formatQuoteDate(ymd) } : { approvalPending: true }
}

/**
 * 저장값으로 PDF props 를 만든다.
 *
 * `dateDisplay` 는 **빈 문자열**로 둔다 — 날짜 자리는 새 prop(approvalDate·approvalPending)이
 * 그린다. 확정 흐름은 종전처럼 `dateDisplay` 를 넘기고 새 prop 을 주지 않으므로 서로 간섭하지 않는다.
 */
export function buildQuotePdfProps(input: PdfDataInput): PDFDocProps {
  const q = input.quote
  return {
    company: (input.company ?? '').trim(),
    receiver: (q.recipient ?? '').trim(),
    quoteNo: q.quote_number ?? '',
    // 날짜 줄은 아래 approvalDate·approvalPending 이 맡는다.
    dateDisplay: '',
    // item_id 순 — 화면·엑셀과 같은 순서다(임베딩된 행은 순서가 보장되지 않는다).
    rows: [...input.items].sort((a, b) => a.item_id - b.item_id).map(toPdfRow),
    remarks: q.note ?? '',
    engineerName: (input.engineerName ?? '').trim(),
    engineerTel: (input.engineerTel ?? '').trim(),
    totalSupply: num(q.total_supply),
    totalTax: num(q.total_tax),
    totalAmount: num(q.total_amount),
    // 저장된 조건 네 줄. 없으면 기본값 — 확정 때 PDF 와 같은 줄이 나온다.
    terms: termsOf(q.terms),
    ...approvalDateProps(input.approvedAt),
  }
}
