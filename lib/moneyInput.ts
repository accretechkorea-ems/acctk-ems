// 금액 입력 칸의 **글자 ↔ 숫자** 규칙 — 순수 함수만 둔다(하네스가 그대로 돌린다).
//
// ── 왜 따로 두는가 ──────────────────────────────────────────────────────────
//   견적 화면의 금액 칸은 여섯 자리가 넘는 수를 손으로 친다(구입가·판매단가·할인·국내
//   구입가·서비스 금액·부대비용 단가). 쉼표가 없으면 「3000000」이 300만인지 3천만인지
//   눈으로 세어야 하고, 한 자리 잘못 친 견적은 확정 전에 아무도 못 잡는다.
//   그렇다고 저장값에 쉼표를 넣을 수는 없으므로, **보이는 글자에만** 쉼표를 넣고
//   상태·계산·저장은 늘 순수 숫자로 둔다.
//
// ── 커서 자리를 함께 돌려준다 ──────────────────────────────────────────────
//   쉼표가 끼어들면 글자 수가 달라져, 아무 보정 없이 그리면 커서가 뒤로 밀리거나 끝으로
//   튄다(「1,234」 가운데를 고치려다 맨 뒤에 쓰게 된다). 그래서 「커서 앞에 숫자가 몇 개
//   있었나」를 세어, 새 글자에서 그만큼 지난 자리로 커서를 옮긴다.
//
// ── 통화 ───────────────────────────────────────────────────────────────────
//   엔·원은 정수다(소수가 들어올 일이 없다). 달러만 소수 두 자리를 받는다.

/** 소수 자리 — 0 이면 정수만 받는다. */
export type MoneyFormat = { decimals?: number }

/** 천 단위 쉼표. 소수부는 **치는 중 그대로** 둔다(「1.」·「1.5」도 지운 뒤 다시 붙이지 않는다). */
export function groupDigits(raw: string): string {
  const [int, ...rest] = raw.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return rest.length > 0 ? `${grouped}.${rest.join('')}` : grouped
}

/**
 * 사람이 친 글자에서 **쓸 수 있는 것만** 남긴다.
 *   · 숫자 아닌 글자는 버린다(쉼표·공백·한글·기호 — 붙여넣기 「1,234,567」도 이 길로 들어온다).
 *   · 소수점은 decimals 가 0 보다 클 때만, **한 번만**, 그 자리 수까지.
 *   · 맨 앞의 0 은 하나만 남긴다(「007」 → 「7」, 「0.5」는 그대로).
 */
export function sanitizeMoney(input: string, fmt: MoneyFormat = {}): string {
  const decimals = fmt.decimals ?? 0
  let out = ''
  let dot = false
  for (const ch of String(input ?? '')) {
    if (ch >= '0' && ch <= '9') { out += ch; continue }
    if (decimals > 0 && (ch === '.') && !dot && out !== '') { out += '.'; dot = true }
  }
  if (dot) {
    const [int, frac] = out.split('.')
    out = `${int}.${frac.slice(0, decimals)}`
  }
  // 앞의 0 — 「0」 자체와 「0.」 은 남기고, 「0123」 은 「123」 으로.
  out = out.replace(/^0+(?=\d)/, '')
  return out
}

/** 글자 → 숫자. 빈 글자·점만 있으면 null(= 비어 있다). */
export function parseMoney(input: string, fmt: MoneyFormat = {}): number | null {
  const clean = sanitizeMoney(input, fmt)
  if (clean === '' || clean === '.') return null
  const n = Number(clean)
  return Number.isFinite(n) ? n : null
}

/** 숫자 → 칸에 보일 글자. null·0 은 빈 글자다(placeholder 가 보이게). */
export function formatMoney(value: number | null | undefined, fmt: MoneyFormat = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return ''
  const decimals = fmt.decimals ?? 0
  const fixed = decimals > 0 ? String(Math.round(value * 10 ** decimals) / 10 ** decimals) : String(Math.round(value))
  return groupDigits(fixed)
}

export type MoneyEdit = {
  /** 칸에 넣을 글자(쉼표 포함). */
  text: string
  /** 그 글자 기준의 커서 자리. */
  caret: number
  /** 상태·계산·저장에 쓸 값. 비어 있으면 null. */
  value: number | null
}

/**
 * 한 번의 입력을 글자·커서·값으로 바꾼다.
 *
 * @param input 사람이 친 그대로의 칸 내용(쉼표가 섞여 있다)
 * @param caret 그 내용 기준의 커서 자리(selectionStart)
 */
export function moneyEdit(input: string, caret: number, fmt: MoneyFormat = {}): MoneyEdit {
  const raw = String(input ?? '')
  const pos = Math.max(0, Math.min(caret ?? raw.length, raw.length))
  // 커서 **앞에** 살아남을 글자가 몇 개인가 — 쉼표를 다시 깔아도 이 수는 변하지 않는다.
  const kept = sanitizeMoney(raw.slice(0, pos), fmt).length
  const clean = sanitizeMoney(raw, fmt)
  const text = clean === '' ? '' : groupDigits(clean)

  // 그 수만큼 지난 자리를 새 글자에서 찾는다(쉼표는 세지 않는다).
  let seen = 0
  let next = text.length
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ',') seen++
    if (seen >= kept) { next = i + 1; break }
  }
  if (kept === 0) next = 0

  return { text, caret: next, value: parseMoney(clean, fmt) }
}
