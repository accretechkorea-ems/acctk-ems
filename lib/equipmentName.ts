// 장비 **품명 한 줄**을 라인업 · 모델 · 구성으로 가르는 규칙 (2026-11-26).
//
// ── 규칙(2026-11-19 에 정한 것) ──────────────────────────────────────────
//   라인업 = 브랜드 + 시리즈   「SURFCOM NEX」
//   모델   = 규격              「040」
//   구성   = 뒤에 붙는 사양 코드 「DX2-11」
//
// 값이 깨끗하지 않다 — 가격표(price_list)의 품명은 사람이 적은 글이라 모양이 여럿이다.
// 그래서 **차례대로 모양을 맞춰 보고**, 맞는 것이 없으면 마지막 규칙으로 떨어진다.
// 어느 규칙으로 갈랐는지(rule)와 **확신도**(sure)를 함께 돌려준다 — 애매한 줄은
// 문서·시드에 그대로 표시해 사람이 뒤에 고칠 수 있게 한다.
//
// 순수 모듈이다 — 파싱 스크립트·대조 스크립트·하네스가 함께 읽는다.

export type EquipmentParse = {
  /** 원문 품명. */
  raw: string
  lineup: string
  model: string | null
  config: string | null
  /** 어느 규칙으로 갈랐나(문서에 적는다). */
  rule: string
  /** 확신도 — false 면 「판단 필요」로 적는다. */
  sure: boolean
}

/** 브랜드 = 라인업의 첫 낱말. 「XYZAX SVF NEX」의 브랜드는 XYZAX 다. */
export const brandOf = (lineup: string): string => lineup.trim().split(/\s+/)[0] ?? ''
/** 시리즈 = 라인업에서 브랜드를 뺀 나머지(없으면 빈 글자). */
export const seriesOf = (lineup: string): string =>
  lineup.trim().split(/\s+/).slice(1).join(' ')

/** 구성 코드처럼 생겼는가 — 「DX2-11」·「SD-14」·「TL3」 꼴. */
const CONFIG_CODE = /^(?:DX2?|SD|TL|XXT|PH|RDS)[A-Za-z]*-?\d*$/i

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * 품명 한 줄을 가른다. **빈 글자면 라인업도 빈 글자**다(부르는 쪽이 거른다).
 *
 * 차례:
 *   A 「… 040 DX2-12」      숫자 세 자리 규격 + 구성        — 확신
 *   B 「… 7/5/5 PH C2」     빗금 규격 + 구성                — 확신
 *   C 「… 4/4/3-C1」        빗금 규격에 구성이 붙음         — 확신
 *   D 「… 1400G-11」        규격에 두 자리 코드가 붙음      — **애매**(코드가 구성인지 규격의 일부인지)
 *   E 「… 35」              숫자 규격만                     — 확신
 *   F 「… DX-12」           구성 코드만(규격이 없다)        — **애매**
 *   G 그 밖                 마지막 낱말을 모델로            — **애매**
 */
export function parseEquipmentName(input: string | null | undefined): EquipmentParse {
  const raw = clean(String(input ?? ''))
  const none: EquipmentParse = { raw, lineup: '', model: null, config: null, rule: '빈 값', sure: false }
  if (!raw) return none

  let m: RegExpExecArray | null

  // A — 숫자 규격(두세 자리) + 구성
  m = /^(.+?)\s+(\d{2,4})\s+(.+)$/.exec(raw)
  if (m) return { raw, lineup: clean(m[1]), model: m[2], config: clean(m[3]), rule: 'A 규격+구성', sure: true }

  // B — 빗금 규격 + 구성
  m = /^(.+?)\s+(\d+(?:\/\d+)+)\s+(.+)$/.exec(raw)
  if (m) return { raw, lineup: clean(m[1]), model: m[2], config: clean(m[3]), rule: 'B 빗금규격+구성', sure: true }

  // C — 빗금 규격에 구성이 붙은 꼴
  m = /^(.+?)\s+(\d+(?:\/\d+)+)-([A-Za-z0-9]+)$/.exec(raw)
  if (m) return { raw, lineup: clean(m[1]), model: m[2], config: m[3], rule: 'C 빗금규격-구성', sure: true }

  // D — 규격 뒤에 두 자리 코드(1400G-11)
  m = /^(.+?)\s+(\d+[A-Za-z]*)-(\d{1,2})$/.exec(raw)
  if (m) return { raw, lineup: clean(m[1]), model: m[2], config: m[3], rule: 'D 규격-코드', sure: false }

  // E — 숫자 규격만
  m = /^(.+?)\s+(\d+)$/.exec(raw)
  if (m) return { raw, lineup: clean(m[1]), model: m[2], config: null, rule: 'E 규격만', sure: true }

  // F — 구성 코드만(규격이 없다)
  m = /^(.+?)\s+([A-Za-z0-9]+-\d+)$/.exec(raw)
  if (m && CONFIG_CODE.test(m[2].split('-')[0])) {
    return { raw, lineup: clean(m[1]), model: null, config: m[2], rule: 'F 구성만', sure: false }
  }

  // G — 그 밖: 낱말이 둘 이상이면 마지막을 모델로 본다.
  const t = raw.split(/\s+/)
  if (t.length >= 2) {
    return { raw, lineup: clean(t.slice(0, -1).join(' ')), model: t[t.length - 1], config: null, rule: 'G 끝낱말=모델', sure: false }
  }
  return { raw, lineup: raw, model: null, config: null, rule: 'G 한 낱말', sure: false }
}

/** 대조용 — 공백·대소문자·구분기호를 없앤 비교 열쇠. */
export const normKey = (s: string | null | undefined): string =>
  String(s ?? '').toLowerCase().replace(/[\s_\-+/]/g, '')
