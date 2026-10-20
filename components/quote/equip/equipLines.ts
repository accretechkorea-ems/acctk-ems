'use client'

// 장비 구성 모달이 다루는 **한 줄**과 그 변환 — 순수 함수만 둔다(화면·DB 를 모른다).
//
// ── 핵심 결정: 줄을 QuoteRow 로 들고 다닌다 ─────────────────────────────────
//   모달이 자기만의 숫자 모형을 따로 가지면 구입가·이익률·합계가 견적 화면과 **어긋난다.**
//   그래서 모달의 줄은 처음부터 QuoteRow 이고, 금액은 전부 app/quote/calc.ts 의
//   calcRow·calcTotals 가 계산한다. 「견적에 추가」는 체크된 줄을 **그대로 넘기는 일**이다.
//   새 계산식을 만들지 않는다.
//
// ── 수량 ────────────────────────────────────────────────────────────────────
//   qtyPerUnit 은 **장비 1대당 수량**이다. 본체+기본 묶음은 줄 수량이
//   qtyPerUnit × 장비 수량으로 따라 움직이고(사람이 직접 고치지 않는다),
//   옵션·포함사항·국내조달품은 줄 수량을 직접 적는다.
//   저장할 때는 모든 묶음이 qty_per_unit = 줄 수량 ÷ 장비 수량으로 돌아간다.

import type { PriceItem, QuoteRow } from '@/app/quote/types'
import { calcRow, createDiscountRow, createDomesticRow, createRow } from '@/app/quote/calc'
import type { QuoteTemplateItem, TemplateItemInput } from '@/lib/quoteTemplates'

/** 모달의 네 묶음. base·option·include 는 quote_items.group_kind 로 그대로 저장된다. */
export const EQUIP_GROUPS = ['base', 'option', 'include', 'domestic'] as const
export type EquipGroup = typeof EQUIP_GROUPS[number]

/** 묶음 제목과 설명 — 시안의 문구를 그대로 쓴다. */
export const GROUP_TITLES: Record<EquipGroup, string> = {
  base: '1. 본체 + 기본 구성',
  option: '2. 옵션',
  include: '3. 포함사항',
  domestic: '4. 국내조달품',
}
export const GROUP_HINTS: Record<EquipGroup, string> = {
  base: '기본 체크 · 수량은 장비 수량에 연동',
  option: '체크하면 포함 · 수량·판매단가 입력',
  include: '가격 없는 구성품 · 견적서에 「-」로 표시',
  domestic: '원화 금액 입력 · 원가 계산에만 들어가고 견적서에는 금액이 나오지 않는다',
}

/** 포함사항은 금액이 없다 — 판매단가 입력칸을 두지 않는다. */
export const isPriceless = (g: EquipGroup): boolean => g === 'include'
/** 본체+기본은 줄 수량을 직접 고치지 않는다(장비 수량에 연동). */
export const isQtyLocked = (g: EquipGroup): boolean => g === 'base'

/** 모달이 다루는 한 줄. */
export type EquipLine = {
  /** 견적에 그대로 들어갈 줄. 금액은 calcRow 가 채운 값이다. */
  row: QuoteRow
  checked: boolean
  group: EquipGroup
  /** 장비 1대당 수량. 저장·수량 연동의 기준이다. */
  qtyPerUnit: number
  /**
   * 템플릿에 품번이 있었는데 **지금 가격표에서 찾을 수 없는** 줄.
   * 체크를 풀어 두고 그 사실을 보여 준다 — 조용히 사라지면 빠진 것을 알 수 없다.
   */
  missing?: boolean
}

let seq = 0
/** 줄 id — 화면 안에서만 쓰는 값이다(QuoteRow.id 와 같은 방식). */
const nextId = () => `eq${++seq}${Math.random().toString(36).slice(2, 7)}`

/**
 * 가격표 줄을 찾는 열쇠 — **품번과 구분을 함께** 쓴다.
 * CMM 본체는 같은 품번이 Jig 포함·제외 두 줄이라 품번만으로는 어느 줄인지 가릴 수 없다.
 * 템플릿을 저장·복원하는 쪽과 useEquipConfig 의 조회가 같은 함수를 쓴다.
 */
export const priceKey = (itemCode: string, variant: string | null | undefined): string =>
  `${itemCode}\u0000${variant ?? ''}`

/** 그 줄 종류에 맞는 빈 QuoteRow. */
function baseRow(group: EquipGroup): QuoteRow {
  return group === 'domestic' ? createDomesticRow() : createRow()
}

/**
 * 줄 하나를 다시 계산한다. **수량을 먼저 정하고** calcRow 를 통과시킨다.
 * 본체+기본은 장비 수량에 연동되고, 포함사항은 금액을 0 으로 눕힌다.
 */
export function recalcLine(line: EquipLine, machineQty: number, exRate: number, tariff: number): EquipLine {
  const qty = isQtyLocked(line.group)
    ? Math.max(0, Math.round(line.qtyPerUnit * machineQty))
    : line.row.quantity
  const next: QuoteRow = {
    ...line.row,
    quantity: qty,
    tariff_rate: tariff,
    // 포함사항은 금액이 없다 — 판매단가 0 · price 모드로 눕힌다. rate 모드로 두면 calcRow 가
    // 이익률로 단가를 **역산해 버린다**(가격표 품목이면 구입가가 있으니 금액이 생긴다).
    manual_unit_price: isPriceless(line.group) ? 0 : line.row.manual_unit_price,
    price_mode: isPriceless(line.group) ? 'price' : line.row.price_mode,
    // 구성 묶음은 그대로 저장된다(국내조달품은 묶음을 쓰지 않는다 — PDF 에 나오지 않는다).
    group_kind: line.group === 'domestic' ? null : line.group,
  }
  return { ...line, row: calcRow(next, exRate) }
}

/** 여러 줄을 한 번에 다시 계산한다. */
export const recalcLines = (lines: EquipLine[], machineQty: number, exRate: number, tariff: number): EquipLine[] =>
  lines.map(l => recalcLine(l, machineQty, exRate, tariff))

/**
 * 가격표 품목으로 줄을 만든다.
 * **기존 품목 선택(handleSelect)이 만드는 모양을 따른다** — selectedItem 을 담고 품번은
 * item_code, 품명은 모델명을 괄호로 붙인다. 그래야 견적에 붙은 뒤의 모양이 손으로 고른 줄과 같다.
 */
export function lineFromPriceItem(
  item: PriceItem, group: EquipGroup,
  opts: { checked: boolean; qtyPerUnit: number; sellPrice?: number | null; quantity?: number },
): EquipLine {
  const model = item.model_jp ? `(${item.model_jp})` : ''
  const name = [item.item_name_jp ?? '', model].filter(Boolean).join(' ').trim()
  const row: QuoteRow = {
    ...baseRow(group),
    id: nextId(),
    selectedItem: item,
    partCode: item.item_code,
    itemText: name || item.item_code,
    quantity: Math.max(0, Math.round(opts.quantity ?? opts.qtyPerUnit)),
    // 판매단가를 받았으면 그 값을 쓴다(사람이 정한 값이라 다시 계산할 수 없다).
    // 없으면 이익률 모드로 두어 기존 규칙대로 역산된다.
    price_mode: opts.sellPrice != null ? 'price' : 'rate',
    manual_unit_price: opts.sellPrice ?? 0,
  }
  return { row, checked: opts.checked, group, qtyPerUnit: opts.qtyPerUnit }
}

/**
 * 가격표에 없는 항목을 직접 넣는다.
 *   국내조달품 — row_kind = domestic. 입력한 금액이 **원가**가 된다(calc.ts 의 domestic 분기).
 *   그 밖      — 가격표 품목과 같은 모양이되 selectedItem 이 없다(구입가를 모른다).
 *                판매단가를 직접 넣으면 그 값이 쓰인다.
 */
export function lineFromManual(
  group: EquipGroup,
  opts: { partCode?: string; name: string; qtyPerUnit: number; price?: number | null; checked?: boolean; quantity?: number },
): EquipLine {
  const row: QuoteRow = {
    ...baseRow(group),
    id: nextId(),
    partCode: (opts.partCode ?? '').trim(),
    itemText: opts.name.trim(),
    quantity: Math.max(0, Math.round(opts.quantity ?? opts.qtyPerUnit)),
    price_mode: 'price',
    manual_unit_price: opts.price ?? 0,
  }
  return { row, checked: opts.checked !== false, group, qtyPerUnit: opts.qtyPerUnit }
}

/**
 * 템플릿 줄 → 모달 줄.
 * 품번이 있으면 가격표에서 찾아 **구입가를 새로 계산한다**(템플릿은 원가를 저장하지 않는다).
 * 찾지 못하면 missing 으로 두고 체크를 푼다 — 줄 자체는 남겨 사람이 보고 판단하게 한다.
 *
 * 줄 수량은 **qty_per_unit × 장비 수량**으로 펼친다. 본체+기본은 그 뒤에도 장비 수량을 따라
 * 움직이고(recalcLine), 나머지 묶음은 이 값에서 사람이 직접 고친다.
 */
export function lineFromTemplateItem(
  it: QuoteTemplateItem, priceByCode: Map<string, PriceItem>, machineQty: number,
): EquipLine {
  const qty = it.qty_per_unit * (machineQty > 0 ? machineQty : 1)
  const group = (EQUIP_GROUPS as readonly string[]).includes(it.group_kind)
    ? it.group_kind as EquipGroup
    : 'option'
  const code = (it.part_code ?? '').trim()
  // **(품번, 구분) 짝**으로 찾는다. 품번만으로 찾으면 Jig 포함/제외 중 아무 줄이나 걸린다.
  const found = code ? priceByCode.get(priceKey(code, it.variant)) : undefined

  if (group === 'domestic') {
    // 국내조달품 — default_sell_price 를 **기본 금액(원가)** 으로 쓴다(겸용. lib/quoteTemplates.ts 참조).
    return lineFromManual('domestic', {
      partCode: code,
      name: it.item_name ?? code,
      qtyPerUnit: it.qty_per_unit,
      quantity: qty,
      price: it.default_sell_price,
      checked: it.default_checked,
    })
  }
  if (found) {
    const line = lineFromPriceItem(found, group, {
      checked: it.default_checked,
      qtyPerUnit: it.qty_per_unit,
      quantity: qty,
      sellPrice: it.default_sell_price,
    })
    // 템플릿에 품명이 적혀 있으면 그 글자를 살린다(사람이 고쳐 둔 설명일 수 있다).
    return it.item_name ? { ...line, row: { ...line.row, itemText: it.item_name } } : line
  }
  // 품번이 있었는데 가격표에 없다 — 또는 애초에 품번 없이 직접 적은 줄이다.
  const manual = lineFromManual(group, {
    partCode: code,
    name: it.item_name ?? code,
    qtyPerUnit: it.qty_per_unit,
    quantity: qty,
    price: it.default_sell_price,
    checked: it.default_checked,
  })
  if (!code) return manual
  return { ...manual, checked: false, missing: true }
}

/** 템플릿으로 저장할 줄 모양. 가격(구입가)은 담지 않는다 — 품번만 담는다. */
export function toTemplateItems(lines: EquipLine[], machineQty: number): TemplateItemInput[] {
  const qtyBase = machineQty > 0 ? machineQty : 1
  return lines.map((l, i) => ({
    group_kind: l.group,
    row_kind: l.row.row_kind,
    part_code: l.row.partCode.trim() || null,
    // 가격표에서 고른 줄이면 그 줄의 구분(Jig 포함/제외)을 함께 남긴다.
    // 직접 적은 줄은 가격표에 없으니 '' 다. (옛 임시저장에는 이 칸이 없을 수 있다 → ?? '')
    variant: l.row.selectedItem?.variant ?? '',
    item_name: l.row.itemText.trim() || null,
    // 장비 1대당 수량으로 되돌린다. 나누어떨어지지 않으면 소수로 남는다(numeric 칸이다).
    qty_per_unit: Math.round((l.row.quantity / qtyBase) * 1000) / 1000,
    default_checked: l.checked,
    // 포함사항은 금액이 없다. 국내조달품은 이 칸이 「기본 금액」이다(겸용).
    default_sell_price: isPriceless(l.group) ? null : (l.row.manual_unit_price || null),
    sort_order: i,
  }))
}

/**
 * 「견적에 추가」 — 체크된 줄을 견적 줄로 넘긴다.
 * 이미 calcRow 를 통과한 값이라 **그대로 쓰면 된다.** 다만 견적에 들어갈 때 id 를 새로 받아
 * 기존 줄과 겹치지 않게 한다(화면이 id 로 줄을 찾는다).
 */
export function toQuoteRows(lines: EquipLine[]): QuoteRow[] {
  return lines
    .filter(l => l.checked)
    .map(l => ({ ...l.row, id: Math.random().toString(36).slice(2) }))
}

/** 모달에서 적은 특별 할인 → 기존 할인 줄(견적당 1건). 0 이면 줄을 만들지 않는다. */
export function toDiscountRow(amount: number, exRate: number): QuoteRow | null {
  if (!(amount > 0)) return null
  return calcRow({ ...createDiscountRow(), manual_unit_price: amount }, exRate)
}

/** 체크된 줄만. 요약·저장이 함께 쓴다. */
export const checkedLines = (lines: EquipLine[]): EquipLine[] => lines.filter(l => l.checked)

/** 그 묶음의 줄만. */
export const linesOf = (lines: EquipLine[], group: EquipGroup): EquipLine[] =>
  lines.filter(l => l.group === group)

/**
 * 그 줄의 **구입가를 계산할 근거가 있는가.**
 * 가격표 품목인데 원가(cost_jpy)가 비어 있으면 구입가를 「-」로 두고 이익률도 비운다 —
 * 0 원으로 보여 주면 「원가가 없다」와 「원가가 0 이다」가 구별되지 않는다.
 */
export function hasCost(line: EquipLine): boolean {
  if (line.group === 'domestic') return true
  if (line.row.row_kind === 'price_list') return !!line.row.selectedItem?.cost_jpy
  if (line.row.row_kind === 'manual_jpy') return line.row.manual_cost_jpy > 0
  return false
}

/** 가격표에서 온 줄인가(품번을 고쳐 쓰지 않는다). */
export const isFromPriceList = (line: EquipLine): boolean => line.row.selectedItem != null
