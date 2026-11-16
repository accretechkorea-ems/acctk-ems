// 견적에서 파생되는 **두 문서** — 거래명세서 · 수리내역서.
//
// ── 문서번호는 견적번호에 글자 하나를 붙인 것이다 ──────────────────────────
//   견적 No.AKM20261116-B → 거래명세서 AKM20261116-BT · 수리내역서 AKM20261116-BR
//   앞의 「No.」는 견적서 화면용 접두라 문서번호에는 쓰지 않는다(양식 최종안도 그렇다).
//   파일 이름도 같다 — quote-pdfs 버킷에 {문서번호}.pdf 로 올리고 다시 만들면 덮어쓴다.
//
// ── 여기 있는 것 ────────────────────────────────────────────────────────────
//   순수 규칙만 둔다(하네스가 그대로 돌린다 — scripts/quote-docs-check.js).
//   그리는 일은 components/pdf/*, 받아 오고 올리는 일은 lib/quoteDocGenerate.ts 다.

export type QuoteDocKind = 'transaction' | 'repair'

/** 문서 이름 — 화면 단추·토스트가 함께 쓴다. */
export const DOC_LABEL: Record<QuoteDocKind, string> = {
  transaction: '거래명세서',
  repair: '수리내역서',
}

/** 견적번호에서 「No.」 접두를 뗀다. 없으면 그대로. */
export const bareQuoteNumber = (quoteNumber: string): string =>
  (quoteNumber ?? '').trim().replace(/^No\./i, '')

/** 문서번호 — 견적번호 뒤에 T(거래명세서) · R(수리내역서). */
export const docNumber = (quoteNumber: string, kind: QuoteDocKind): string =>
  `${bareQuoteNumber(quoteNumber)}${kind === 'transaction' ? 'T' : 'R'}`

/** 버킷에 올릴 파일 이름. */
export const docFileName = (quoteNumber: string, kind: QuoteDocKind): string =>
  `${docNumber(quoteNumber, kind)}.pdf`

// ════════════════════════════════════════════════════════════════════════════
// 거래명세서
// ════════════════════════════════════════════════════════════════════════════

/** 표를 채우는 데 필요한 품목 한 줄(저장된 quote_items 의 모양). */
export type DocItem = {
  row_kind?: string | null
  product_name?: string | null
  model_name?: string | null
  part_code?: string | null
  quantity?: number | null
  supply_amount?: number | null
  /** 가격표 품목의 모델 — model_name 이 비었을 때 쓴다. */
  price_list?: { model_jp?: string | null } | null
}

/** 수리 건의 칸 — 품명 줄의 S/N 과 수리내역서의 접수 사항에 쓴다. */
export type DocRepair = {
  serial_number?: string | null
  product_type?: string | null
  item_type?: string | null
  received_date?: string | null
  repair_done_at?: string | null
  shipped_date?: string | null
}

/** 부가세 — 공급가액의 10%, 원 단위 반올림(음수 할인 줄도 같은 규칙이라 부호가 따라간다). */
export const vatOf = (supply: number): number => Math.round((supply ?? 0) * 0.1)

/** 그 줄의 모델 — 적어 둔 값이 먼저고, 없으면 가격표 모델, 그것도 없으면 품명이다. */
export const modelOf = (it: DocItem): string =>
  ((it.model_name ?? '').trim() || (it.price_list?.model_jp ?? '').trim() || (it.product_name ?? '').trim())

/**
 * 거래명세서 품명 줄.
 *   수리 건   「AKM20261116-B_E-TS-0000B-P0 (S/N 000000) 수리 건」
 *   일반 견적 「AKM20261116-B_E-TS-0000B-P0」            ← S/N 도 「수리 건」도 없다
 * 할인 줄처럼 모델이라는 말이 맞지 않는 줄은 **적힌 품명 그대로** 쓴다.
 */
export function transactionItemName(
  quoteNumber: string,
  it: DocItem,
  repair: DocRepair | null,
): string {
  const bare = bareQuoteNumber(quoteNumber)
  if (it.row_kind === 'discount') return (it.product_name ?? '').trim() || '할인'
  const model = modelOf(it) || '-'
  const serial = (repair?.serial_number ?? '').trim()
  if (!repair) return `${bare}_${model}`
  return serial ? `${bare}_${model} (S/N ${serial}) 수리 건` : `${bare}_${model} 수리 건`
}

/** 품명 아래 회색 보조 줄 — 「품명 · 처리 결과 첫 줄」. 처리 결과가 없으면 품명만. */
export function transactionItemSub(it: DocItem, result: string | null | undefined): string {
  const name = (it.product_name ?? '').trim()
  const first = (result ?? '').split('\n').map(s => s.trim()).find(s => s !== '') ?? ''
  if (!name && !first) return ''
  if (!first) return name
  return name ? `${name} · ${first}` : first
}

export type TransactionLine = {
  no: number
  name: string
  sub: string
  quantity: number
  supply: number
  tax: number
}

/**
 * 거래명세서 줄 — **제목줄은 빼고** 금액이 있는 줄만 담는다.
 * 합계가 견적의 공급가 합계와 어긋나지 않게 할인 줄도 그대로 담는다(음수).
 */
export function transactionLines(
  quoteNumber: string,
  items: DocItem[],
  repair: DocRepair | null,
  result: string | null | undefined,
): TransactionLine[] {
  return items
    .filter(it => it.row_kind !== 'title')
    .filter(it => (it.supply_amount ?? 0) !== 0)
    .map((it, i) => {
      const supply = Number(it.supply_amount) || 0
      return {
        no: i + 1,
        name: transactionItemName(quoteNumber, it, repair),
        sub: transactionItemSub(it, result),
        quantity: Number(it.quantity) || 0,
        supply,
        tax: vatOf(supply),
      }
    })
}

/** 표가 비어 보이지 않게 채우는 빈 줄 수(열 줄을 채운다). */
export const TRANSACTION_MIN_ROWS = 10
/** 열 줄일 때의 줄 높이(mm) — 양식 최종안 그대로. */
export const TRANSACTION_ROW_MM = 11.2

/**
 * 줄 높이 — 열 줄까지는 그대로, 넘치면 **줄여서 한 장에 담는다**.
 * 열한 줄째부터 (열 줄 × 높이)를 줄 수로 나눠 전체 높이를 지킨다. 너무 납작해지지 않게
 * 바닥을 둔다(5mm — 9.8pt 글자가 들어가는 최소 높이다).
 */
export function transactionRowHeight(rows: number): number {
  if (rows <= TRANSACTION_MIN_ROWS) return TRANSACTION_ROW_MM
  return Math.max(5, (TRANSACTION_ROW_MM * TRANSACTION_MIN_ROWS) / rows)
}

// ════════════════════════════════════════════════════════════════════════════
// 수리내역서
// ════════════════════════════════════════════════════════════════════════════

/** 교환 부품으로 올라가는 줄 종류 — 서비스비·할인·제목줄은 부품이 아니다. */
export const PART_ROW_KINDS: readonly string[] = ['price_list', 'manual_jpy', 'domestic']

export type PartRow = { no: number; name: string; code: string; quantity: number }

/** 교환 부품 표 — 부품명=품명, 품번·규격=품번, 수량. */
export function partRows(items: DocItem[]): PartRow[] {
  return items
    .filter(it => PART_ROW_KINDS.includes(it.row_kind ?? ''))
    .map((it, i) => ({
      no: i + 1,
      name: (it.product_name ?? '').trim() || modelOf(it) || '-',
      code: (it.part_code ?? '').trim() || '-',
      quantity: Number(it.quantity) || 0,
    }))
}

/** 아홉 줄까지는 한 장이 보장된다. */
export const PART_MIN_ROWS = 9
/** 아홉 줄일 때의 줄 높이(mm). */
export const PART_ROW_MM = 5.9

/** 교환 부품 줄 높이 — 열 줄부터 줄인다(거래명세서와 같은 규칙, 바닥만 더 낮다). */
export function partRowHeight(rows: number): number {
  if (rows <= PART_MIN_ROWS) return PART_ROW_MM
  return Math.max(3.6, (PART_ROW_MM * PART_MIN_ROWS) / rows)
}

/**
 * 사진 배치 — 1장 1칸 · 2장 1×2 · 3장 1×3 · 4장 2×2.
 * **영역 높이는 고정**이다(넉 장일 때와 한 장일 때가 같은 자리를 쓴다) — 사진 수에 따라
 * 아래 절(교환 부품)이 오르내리면 같은 문서가 장마다 다르게 보인다.
 *
 * 높이 50mm 는 **실측으로 정한 값**이다. 60mm(양식 예시의 24mm×2줄)로 두면 사진이 한 장만
 * 있어도 A4 한 장을 넘겼다(scratch 측정: 사진 1~4장 모두 2쪽). 50mm 에서 사진 0~4장 ×
 * 부품 3~9줄이 전부 한 장에 들어간다.
 */
export const PHOTO_AREA_MM = 50
export function photoLayout(count: number): { cols: number; rows: number; imgMM: number } {
  if (count <= 0) return { cols: 0, rows: 0, imgMM: 0 }
  if (count === 1) return { cols: 1, rows: 1, imgMM: 44 }
  if (count === 2) return { cols: 2, rows: 1, imgMM: 44 }
  if (count === 3) return { cols: 3, rows: 1, imgMM: 44 }
  return { cols: 2, rows: 2, imgMM: 20 }
}

/** 처리 일시 — 「입고일 ~ 수리완료일」. 완료일이 없으면 입고일만. */
export function workPeriod(repair: DocRepair | null): string {
  const inDay = (repair?.received_date ?? '').slice(0, 10)
  const doneDay = (repair?.repair_done_at ?? '').slice(0, 10)
  if (!inDay && !doneDay) return '-'
  if (!doneDay) return inDay || '-'
  if (!inDay) return doneDay
  return `${inDay} ~ ${doneDay}`
}

/** 수리담당 사무실 전화 — 프로필에 구미로 적힌 사람만 구미, 그 밖은 동탄. */
export const OFFICE_TEL = { dongtan: '031-786-4093', gumi: '054-971-5512' } as const
export function officeTel(office: string | null | undefined): string {
  return /구미|gumi/i.test(office ?? '') ? OFFICE_TEL.gumi : OFFICE_TEL.dongtan
}

/** 「홍길동 사원」 — 이름과 직급. 직급이 없으면 이름만. */
export function personLabel(name: string | null | undefined, position: string | null | undefined): string {
  const n = (name ?? '').trim()
  const p = (position ?? '').trim().replace(/님+$/, '').trim()
  if (!n) return p
  return p ? `${n} ${p}` : n
}

/** 「홍길동 책임 / 010-0000-0000」 — 담당자 줄. 전화가 없으면 이름·직위만. */
export function contactLine(
  name: string | null | undefined,
  position: string | null | undefined,
  phone: string | null | undefined,
): string {
  const who = personLabel(name, position)
  const tel = (phone ?? '').trim()
  if (!who && !tel) return '-'
  if (!tel) return who
  return who ? `${who} / ${tel}` : tel
}

/** 「2026년 11월 16일」 — 거래일·확인란에 쓴다. */
export function longDate(ymd: string | null | undefined): string {
  const m = (ymd ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '-'
  return `${m[1]}년 ${m[2]}월 ${m[3]}일`
}
