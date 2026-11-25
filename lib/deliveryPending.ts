// 수주 시 **납품 예정 장비** — 어떤 견적에 묻고, 무엇을 받는가 (2026-11-26).
//
// 순수 모듈이다 — 화면(발주서 등록 창)·라우트(발주)·하네스가 함께 읽는다.

/** 장비를 파는 견적인가 — **양식**이 장비이거나 **분류**가 장비 분류다. */
export const EQUIPMENT_FORM_KIND = 'equip80'

/**
 * 장비로 보는 견적 **분류**(quote_categories.code).
 *
 * 표에 있는 아홉 가운데 셋만 넣었다 — CMM(삼차원)·Roundness(진원도)·Surface(표면거칠기).
 * BCT·TSE·SBS·KOLAS·Measuring Service·LABOR 은 부품·서비스·교정이 섞여 있어 **일부러
 * 뺐다**(판단 필요). 적게 잡는 쪽이 안전하다 — 섹션이 안 뜨면 종전처럼 발주만 되고,
 * 잘못 뜨면 **장비를 채워야 저장이 된다**(일을 막는다).
 */
export const EQUIPMENT_CATEGORY_CODES: readonly string[] = ['CMM', 'ROUNDNESS', 'SURFACE']

/** 그 견적이 「납품 예정 장비」를 물어야 하는 건인가. */
export function needsDeliveryDevices(
  quote: { form_kind?: string | null; category?: string | null } | null | undefined,
): boolean {
  if (!quote) return false
  if (String(quote.form_kind ?? '') === EQUIPMENT_FORM_KIND) return true
  return EQUIPMENT_CATEGORY_CODES.includes(String(quote.category ?? '').trim().toUpperCase())
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

/** 견적 품목 한 줄 — 미리 채울 때 보는 것만. */
export type QuoteItemLike = {
  product_name?: string | null
  model?: string | null
  quantity?: number | null
  row_kind?: string | null
  group_kind?: string | null
}

/**
 * 견적 품목에서 **미리 채울 줄**을 만든다.
 *
 * 장비 본체로 보이는 줄만 쓴다 — 묶음이 'main'(장비 본체)이거나, 묶음이 없고 품명이 있는 줄.
 * 수량만큼 줄을 만든다(2대면 두 줄) — 장비는 한 대씩 S/N 이 붙는다.
 * 품명은 라인업·모델로 가르지 않는다(부르는 쪽이 마스터로 맞춰 본다).
 */
export function draftsFromItems(
  items: readonly QuoteItemLike[],
  opts: { customerId: number | null; month: string },
): DeliveryDraft[] {
  const out: DeliveryDraft[] = []
  for (const it of items) {
    const name = String(it.product_name ?? '').trim()
    if (!name) continue
    const kind = String(it.group_kind ?? it.row_kind ?? '').trim()
    if (kind && !/main|본체|장비/i.test(kind)) continue
    const n = Math.max(1, Math.min(20, Math.floor(Number(it.quantity) || 1)))
    for (let i = 0; i < n; i++) {
      out.push({
        ...EMPTY_DRAFT,
        device_name: name,
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
