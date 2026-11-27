/**
 * 회사 이름을 **같은 것끼리 묶는 열쇠** (2026-11-27, 묶음5 3-8).
 *
 * ── 왜 ───────────────────────────────────────────────────────────────────
 *   같은 회사가 **회사로도, 대리점으로도** 등록되어 있는 일이 있었다(하나무역 — 묶음5 10).
 *   그러면 견적이 두 줄로 흩어지고, 실적이 갈리고, 어느 쪽을 골라야 할지 사람이 모른다.
 *   새로 만들 때 **막아 두면** 그 일이 다시 생기지 않는다.
 *
 *   이름이 **글자 그대로 같을 때만** 막으면 「(주)하나무역」과 「하나무역」을 못 잡는다.
 *   그래서 **묶는 열쇠**로 견준다:
 *     · 앞뒤 공백·가운데 공백을 모두 없앤다
 *     · 법인 꼬리표(주식회사 · (주) · ㈜ · Co., Ltd. …)를 뗀다
 *     · 영문은 소문자로
 *     · 괄호·점·가운뎃점·하이픈을 뗀다
 *
 *   ⚠ **지우는 데 쓰지 않는다.** 이 열쇠가 같다고 해서 같은 회사라고 **단정하지 않는다** —
 *     「대한정밀」이 둘일 수 있다. 하는 일은 **새로 만들 때 한 번 묻는 것**뿐이다.
 *
 * 순수 함수만 둔다 — DB·화면을 모른다.
 */

/** 떼어 내는 법인 꼬리표. 앞에 붙든 뒤에 붙든 뗀다. */
const SUFFIXES = [
  '주식회사', '유한회사', '합자회사', '합명회사', '재단법인', '사단법인',
  '(주)', '(유)', '㈜', '㈜', '(株)',
  'co.,ltd', 'co.ltd', 'coltd', 'ltd', 'inc', 'corp', 'corporation', 'company', 'llc', 'gmbh',
]

/** 뜻이 없는 글자 — 괄호·점·가운뎃점·하이픈·공백. */
const NOISE = /[\s()[\]{}.,·・‧∙•·_\-–—/\\]/g

/**
 * 묶는 열쇠. 빈 이름이면 빈 글자다(빈 것끼리는 **같다고 보지 않는다** — 부르는 쪽이 거른다).
 */
export function companyNameKey(name: string | null | undefined): string {
  let s = String(name ?? '').trim().toLowerCase()
  if (!s) return ''
  s = s.replace(NOISE, '')
  // 꼬리표는 **여러 번** 뗀다 — 「(주)○○주식회사」 같은 줄이 있다.
  let changed = true
  while (changed) {
    changed = false
    for (const suf of SUFFIXES) {
      const k = suf.replace(NOISE, '')
      if (!k) continue
      if (s.length > k.length && s.endsWith(k)) { s = s.slice(0, -k.length); changed = true }
      if (s.length > k.length && s.startsWith(k)) { s = s.slice(k.length); changed = true }
    }
  }
  return s
}

/** 두 이름이 **같은 것으로 보이는가**. 둘 중 하나가 비면 거짓이다. */
export function sameCompanyName(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = companyNameKey(a)
  const kb = companyNameKey(b)
  return ka !== '' && ka === kb
}

/** 막을 때 띄우는 글 — 두 방향이 서로 반대다. */
export const AGENCY_EXISTS_MSG = '이미 대리점으로 등록된 이름입니다. 대리점 탭에서 찾으세요'
export const COMPANY_EXISTS_MSG = '이미 회사로 등록된 이름입니다. 회사 탭에서 찾으세요'
