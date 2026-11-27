/**
 * 장비 **이름 한 줄** — 조립하는 자리는 여기 하나다 (2026-11-27, 묶음5 3-7).
 *
 * ── 왜 모았나 ────────────────────────────────────────────────────────────
 *   장비 이름은 세 칸(라인업 · 모델 · 구성)에 나뉘어 있고, 거기에 프로그램이 붙는다.
 *   그것을 **자리마다 따로** 이어 붙이고 있었다 — 지도 카드, 목록, 사업장 카드, 견적,
 *   엑셀, PDF, 의뢰서… 규칙이 조금씩 달라 같은 장비가 화면마다 다르게 보였다.
 *
 *   가장 눈에 띄던 것: 프로그램이 글자 **「없음」** 으로 저장된 줄이 있는데, 그것을
 *   그대로 괄호에 넣어 **「SURFCOM TOUCH550-13(없음)」** 이라고 적고 있었다.
 *   「없음」은 값이 아니라 **값이 없다는 말**이다 — 괄호째 떼어야 한다.
 *
 * ── 규칙 ─────────────────────────────────────────────────────────────────
 *   이름  = 라인업 + 모델 + 구성 을 **붙여** 쓴다(「SURFCOM」+「TOUCH550」+「-13」).
 *           붙여 쓰는 까닭: 「SURFCOM NEX040」 처럼 원래 한 낱말인 자리가 많고,
 *           띄우면 같은 장비가 「SURFCOM NEX 040」 으로 달라 보인다.
 *   꼬리  = 프로그램이 **있을 때만** 「(ACCTee)」. 없거나 「없음」·「-」 이면 **안 붙인다**.
 *
 * 순수 함수만 둔다 — DB·화면을 모른다.
 */

/** 이름을 짓는 데 보는 칸. 전부 선택이다(없는 칸은 빈 글자로 친다). */
export type DeviceNameLike = {
  /** 라인업 — 「SURFCOM」. */
  device_name?: string | null
  /** 모델 — 「TOUCH550」. */
  device_name2?: string | null
  /** 구성 — 「-13」. */
  option?: string | null
  /** 프로그램 — 「ACCTee」. 「없음」이면 없는 것이다. */
  program?: string | null
}

/**
 * 「값이 없다」는 뜻으로 쓰이는 글자들.
 * 고르는 칸의 기본값이 글자로 저장돼 들어온 자리가 있다 — 지우지 못하므로 **읽을 때** 거른다.
 */
const BLANKS = new Set(['', '-', '없음', '(없음)', 'none', 'n/a', 'na'])

const clean = (v: string | null | undefined): string => {
  const s = String(v ?? '').trim()
  return BLANKS.has(s.toLowerCase()) ? '' : s
}

/** 라인업 + 모델 + 구성 — **붙여** 쓴다. 셋 다 비면 빈 글자다. */
export function deviceModelName(d: DeviceNameLike): string {
  return `${clean(d.device_name)}${clean(d.device_name2)}${clean(d.option)}`.trim()
}

/** 프로그램 — 있을 때만. 「없음」이면 없는 것이다. */
export function deviceProgram(d: DeviceNameLike): string {
  return clean(d.program)
}

/**
 * 화면·엑셀·PDF 가 쓰는 **한 줄**.
 *   「SURFCOM TOUCH550-13 (ACCTee)」 · 프로그램이 없으면 「SURFCOM TOUCH550-13」.
 * 이름이 아예 없으면 빈 글자를 돌려준다 — 「(없음)」 하나만 남는 일이 없게.
 */
export function deviceName(d: DeviceNameLike): string {
  const name = deviceModelName(d)
  if (!name) return ''
  const prog = deviceProgram(d)
  return prog ? `${name} (${prog})` : name
}

/**
 * 이름이 비었을 때 **무엇이든 적어야 하는** 자리(목록 줄·고르는 칸)가 쓰는 꼴.
 * 번호라도 보여야 어느 줄인지 집을 수 있다.
 */
export function deviceNameOr(d: DeviceNameLike, fallback: string): string {
  return deviceName(d) || fallback
}

/** 여러 대를 한 줄로 — 「A / B / C」. 이름이 없는 줄은 건너뛴다. */
export function deviceNames(list: readonly DeviceNameLike[] | null | undefined): string[] {
  return (list ?? []).map(deviceName).filter(Boolean)
}
export function deviceNameLine(list: readonly DeviceNameLike[] | null | undefined): string {
  const names = deviceNames(list)
  return names.length === 0 ? '-' : names.join(' / ')
}

/**
 * 「… 외 N대」 — 지도 팝업·카드처럼 **한 줄만** 쓰는 자리.
 * 한 대면 그 이름만, 여럿이면 첫 이름 뒤에 남은 수를 적는다.
 */
export function deviceNameSummary(list: readonly DeviceNameLike[] | null | undefined): string {
  const names = deviceNames(list)
  if (names.length === 0) return '-'
  if (names.length === 1) return names[0]
  return `${names[0]} 외 ${names.length - 1}대`
}
