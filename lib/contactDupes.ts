// 담당자 **중복 의심** 찾기 — 순수 함수만 둔다 (2026-11-26, 지시 N).
//
// ── 왜 ──────────────────────────────────────────────────────────────────────
// 같은 사람이 두 번 등록되는 일이 흔하다 — 명함을 두 번 찍거나, 이름을 「김민수」와
// 「김 민수」로 적거나, 부서가 바뀌어 새로 넣는다. 그러면 활동 기록이 두 줄로 갈려
// 「이 사람과 몇 번 만났나」를 알 수 없다.
//
// ── 무엇을 같다고 보나 ──────────────────────────────────────────────────────
//   휴대폰 — 숫자만 남겨 견준다(010-1234-5678 · 01012345678 · +82 10 1234 5678 이 같다).
//   이메일 — 앞뒤 공백을 떼고 소문자로 견준다.
//
// **회사 전화(phone)는 보지 않는다.** 같은 사무실 사람끼리 같은 번호를 쓰는 것이 정상이라,
// 그것까지 중복으로 치면 한 사업장 전원에 뱃지가 붙는다.
//
// ── 자동으로 합치지 않는다 ──────────────────────────────────────────────────
// 「중복?」이라고 **묻기만** 한다(지시 N). 합치는 일은 어느 줄의 활동·명함·레포트를 어디로
// 옮기느냐를 정하는 일이고, 그것은 사람이 보고 해야 한다. 이름이 다른 두 줄이 같은
// 번호를 쓰는 경우도 있다(비서가 자기 번호를 적어 둔 자리).
//
// 이름은 **견주지 않는다** — 같은 이름이 흔하고(김영수 둘), 그것만으로 같은 사람이라
// 말하면 애먼 줄에 뱃지가 붙는다. 번호나 메일이 같을 때만 묻는다.

/** 중복을 찾는 데 필요한 담당자 한 줄의 모양. */
export type DupeContact = {
  contact_id: number
  name?: string | null
  mobile?: string | null
  email?: string | null
}

/** 휴대폰 — 숫자만. 국가번호(+82 10…)는 앞의 0 과 같은 자리라 끝 열 자리로 맞춘다. */
export function normMobile(v: string | null | undefined): string {
  const digits = (v ?? '').replace(/\D/g, '')
  if (digits.length < 9) return ''          // 번호로 보기 어려운 값은 견주지 않는다
  // +82 10 1234 5678 → 821012345678 → 끝 열 자리 1012345678
  // 010 1234 5678    → 01012345678  → 끝 열 자리 1012345678
  return digits.slice(-10)
}

/** 이메일 — 앞뒤 공백을 떼고 소문자로. */
export const normEmail = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase()

export type DupeKind = 'mobile' | 'email' | 'both'

export type DupeMark = {
  kind: DupeKind
  /** 같은 값을 쓰는 사람 수(자기 자신 포함). */
  count: number
  /** 호버에 띄우는 안내 한 줄. */
  hint: string
}

/** 안내 글 — 사람이 할 일을 그대로 적는다(합치는 길은 없다). */
export function dupeHint(kind: DupeKind, count: number, names: readonly string[] = []): string {
  const what = kind === 'mobile' ? '같은 번호' : kind === 'email' ? '같은 이메일' : '같은 번호·이메일'
  const who = names.length > 0 ? ` (${names.join(' · ')})` : ''
  return `${what} ${count}명${who} — 하나만 남기고 삭제하세요`
}

/**
 * 한 사업장의 담당자 중 **중복 의심** 줄. 돌려주는 Map 은 contact_id → 표시 하나다.
 *
 * 같은 값을 쓰는 줄이 **둘 이상**일 때만 담는다. 값이 비어 있는 줄은 세지 않는다
 * (휴대폰을 안 적은 사람끼리 중복이 될 수는 없다).
 */
export function dupeMarks(contacts: readonly DupeContact[]): Map<number, DupeMark> {
  const byMobile = new Map<string, DupeContact[]>()
  const byEmail = new Map<string, DupeContact[]>()
  for (const c of contacts) {
    const m = normMobile(c.mobile)
    if (m) {
      const list = byMobile.get(m)
      if (list) list.push(c); else byMobile.set(m, [c])
    }
    const e = normEmail(c.email)
    if (e) {
      const list = byEmail.get(e)
      if (list) list.push(c); else byEmail.set(e, [c])
    }
  }

  const nameOf = (c: DupeContact) => (c.name ?? '').trim() || `#${c.contact_id}`
  /** 자기 말고 같은 값을 쓰는 사람들. */
  const others = (list: DupeContact[], me: DupeContact) => list.filter(x => x.contact_id !== me.contact_id)

  const out = new Map<number, DupeMark>()
  for (const c of contacts) {
    const m = normMobile(c.mobile)
    const e = normEmail(c.email)
    const sameMobile = m ? others(byMobile.get(m) ?? [], c) : []
    const sameEmail = e ? others(byEmail.get(e) ?? [], c) : []
    if (sameMobile.length === 0 && sameEmail.length === 0) continue
    const kind: DupeKind = sameMobile.length > 0 && sameEmail.length > 0 ? 'both'
      : sameMobile.length > 0 ? 'mobile' : 'email'
    // 수는 **그 값을 쓰는 사람 전체**다(자기 포함). 둘이면 2 다.
    const group = kind === 'email' ? sameEmail : sameMobile
    const names = [...new Set([...sameMobile, ...sameEmail].map(nameOf))]
    out.set(c.contact_id, { kind, count: group.length + 1, hint: dupeHint(kind, group.length + 1, names) })
  }
  return out
}

/** 뱃지 글자 — 어디서나 같은 말을 쓴다. */
export const DUPE_BADGE = '중복?'

/**
 * 뱃지 색 — **한 곳에만** 적는다(담당자 카드와 회사 머리줄의 칩이 같은 값을 쓴다).
 * 장비 카드의 「지남」·20 수리의 「지연」과 같은 호박색이다(새 색이 아니다).
 * 위험(빨강)이 아니라 **묻는 것**이라 이 색이다.
 */
export const DUPE_BG = '#fef3c7'
export const DUPE_TEXT = '#92400e'
