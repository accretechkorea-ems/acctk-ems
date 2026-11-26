// 수주 시 **납품 예정 장비** — 어떤 견적에 묻고, 무엇을 받는가 (2026-11-26).
//
// 순수 모듈이다 — 화면(발주서 등록 창)·라우트(발주)·하네스가 함께 읽는다.
//
// ── 판정은 **품목**이 한다 (2026-11-26 지시 ②) ──────────────────────────────
//   전에는 견적의 **분류**(CMM·ROUNDNESS·SURFACE)와 양식(equip80)으로 갈랐다. 분류는
//   「무엇을 파는 회사인가」에 가깝고 「이 견적에 장비가 들었는가」와 어긋났다 — 분류가
//   CMM 인데 부품만 든 견적도, 분류가 비었는데 본체가 든 견적도 있었다.
//   지금은 **품목에 본체 묶음 줄이 있는가**만 본다. 줄이 곧 들어올 장비다.
//
//   ⚠ **판단 필요** — 지시의 글자는 「group_kind main」이었는데, 이 DB 의 group_kind 는
//     `check (group_kind in ('base', 'option', 'include'))` 로 묶여 있다
//     (quote_category_template_schema.sql:327). 'main' 은 **들어갈 수 없는 값**이라 그대로
//     쓰면 판정이 영원히 거짓이 된다. 그래서 「본체 묶음」을 `'base'`(= 「1. 본체 + 기본
//     구성」, lib/quoteForms.ts 의 GROUP_KINDS)로 읽었다. 다른 값을 뜻했다면 아래 한 줄만
//     고치면 된다.

/** 견적 품목 한 줄 — 판정·미리 채울 때 보는 것만. */
export type QuoteItemLike = {
  product_name?: string | null
  model?: string | null
  quantity?: number | null
  row_kind?: string | null
  group_kind?: string | null
}

/** 장비 **본체** 묶음 — quote_items.group_kind 의 값(「본체 + 기본 구성」). */
export const MAIN_GROUP_KIND = 'base'

/** 본체 묶음 줄만 — 판정·줄 만들기가 같은 목록을 본다(수가 어긋나지 않는다). */
export function mainLines(items: readonly QuoteItemLike[] | null | undefined): QuoteItemLike[] {
  return (items ?? []).filter(it => String(it.group_kind ?? '').trim() === MAIN_GROUP_KIND)
}

/** 한 줄의 대수 — 1~20 으로 자른다(오타로 200대가 생기지 않게). */
const qtyOf = (it: QuoteItemLike): number => Math.max(1, Math.min(20, Math.floor(Number(it.quantity) || 1)))

/** 본체 줄 수량의 **합** — 만들 줄 수다. */
export function mainQty(items: readonly QuoteItemLike[] | null | undefined): number {
  return mainLines(items).reduce((s, it) => s + qtyOf(it), 0)
}

/**
 * 그 견적이 「납품 예정 장비」를 물어야 하는 건인가 — **본체 묶음 줄이 하나라도 있으면**이다.
 * 품목을 아직 못 읽었으면 묻지 않는다(빈 배열 = 거짓) — 일을 막지 않는 쪽이다.
 */
export function needsDeliveryDevices(items: readonly QuoteItemLike[] | null | undefined): boolean {
  return mainLines(items).length > 0
}

/** 창에서 한 줄로 받는 값. */
export type DeliveryDraft = {
  /** 라인업 — 비울 수 없다. */
  device_name: string
  /** 모델. */
  device_name2: string
  /** 구성·옵션. */
  option: string
  /** 들어갈 사업장(기본은 견적의 사업장). */
  customer_id: number | null
  /** 설치 예정월 'YYYY-MM'. */
  install_due_month: string
  /** 마스터 밖 값으로 적었는가. */
  master_pending?: boolean
}

export const EMPTY_DRAFT: DeliveryDraft = {
  device_name: '', device_name2: '', option: '',
  customer_id: null, install_due_month: '', master_pending: false,
}

/** 'YYYY-MM' 인가. */
export const isMonth = (v: string | null | undefined): boolean => /^\d{4}-\d{2}$/.test(String(v ?? ''))

/**
 * 저장할 수 있는가 — **한 줄이라도 비면 막는다**(지시).
 * 못 막는 까닭을 돌려준다(없으면 null).
 */
export function draftsBlocked(drafts: readonly DeliveryDraft[]): string | null {
  if (drafts.length === 0) return '납품 예정 장비를 한 대 이상 적어주세요'
  for (const [i, d] of drafts.entries()) {
    const no = `${i + 1}번째 줄 — `
    if (!d.device_name.trim()) return `${no}장비명(라인업)을 적어주세요`
    if (d.customer_id == null) return `${no}사업장을 고르세요`
    if (!isMonth(d.install_due_month)) return `${no}설치 예정월을 고르세요`
  }
  return null
}

/**
 * 견적 품목에서 **미리 채울 줄**을 만든다.
 *
 * **본체 묶음 줄만** 쓰고, 그 줄의 수량만큼 만든다(2대면 두 줄) — 장비는 한 대씩 S/N 이
 * 붙는다. 그래서 줄 수는 늘 `mainQty(items)` 와 같다(판정과 어긋나지 않는다).
 * 품명이 빈 줄은 건너뛴다 — 적을 것이 없다. 품명은 라인업·모델로 가르지 않는다
 * (부르는 쪽이 마스터로 맞춰 본다).
 */
export function draftsFromItems(
  items: readonly QuoteItemLike[],
  opts: { customerId: number | null; month: string },
): DeliveryDraft[] {
  const out: DeliveryDraft[] = []
  for (const it of mainLines(items)) {
    const n = qtyOf(it)
    for (let i = 0; i < n; i++) {
      out.push({
        ...EMPTY_DRAFT,
        device_name: String(it.product_name ?? '').trim(),
        device_name2: String(it.model ?? '').trim(),
        customer_id: opts.customerId,
        install_due_month: opts.month,
      })
    }
  }
  return out
}

/** 다음 달 'YYYY-MM' — 설치 예정월의 기본값(오늘 발주하면 보통 다음 달이다). */
export function nextMonthKey(today: Date = new Date()): string {
  const y = today.getFullYear()
  const m = today.getMonth() + 2   // getMonth 는 0부터 — 다음 달은 +2
  const yy = m > 12 ? y + 1 : y
  const mm = m > 12 ? 1 : m
  return `${yy}-${String(mm).padStart(2, '0')}`
}
