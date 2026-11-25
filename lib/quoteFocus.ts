'use client'

/**
 * 견적 작성의 **손이 가는 차례** (2026-11-25).
 *
 * 대리점을 고르면 그 아래 칸이 새로 나타나는데, 커서는 그대로 서 있었다. 고를 때마다
 * 마우스로 다음 칸을 찍어야 했다. 고른 **그 순간 다음 칸으로 옮긴다**.
 *
 *   사명 → (대리점이면) E.U → 수신인 → 품목의 가격표 검색
 *
 * ── 왜 등록소인가 ────────────────────────────────────────────────────────
 * 다음 칸은 다른 컴포넌트(품목 줄)에 있고, 대리점 칸은 **고른 뒤에야 그려진다.**
 * ref 를 위아래로 넘기면 세 겹을 지나야 해서, 칸들이 제 이름을 여기 적어 두고
 * 고른 쪽이 이름으로 부른다.
 *
 * ── 사람이 직접 누른 자리는 건드리지 않는다 ──────────────────────────────
 * 자동 이동은 **고르기(Enter·클릭)에서만** 부른다. 사람이 칸을 직접 클릭해 옮긴
 * 자리에서는 아무 일도 하지 않는다.
 */

/** 차례의 이름. */
export type QuoteFocusStep = 'company' | 'eu' | 'recipient' | 'priceSearch'

export const QUOTE_FOCUS_ORDER: readonly QuoteFocusStep[] =
  ['company', 'eu', 'recipient', 'priceSearch']

/**
 * 이 칸을 고른 뒤 갈 곳.
 * 직판(대리점 없음)이면 E.U 칸이 없으므로 사명 다음이 곧 수신인이다.
 */
export function nextFocusStep(
  from: QuoteFocusStep,
  opts: { isDealer: boolean },
): QuoteFocusStep | null {
  if (from === 'company') return opts.isDealer ? 'eu' : 'recipient'
  if (from === 'eu') return 'recipient'
  if (from === 'recipient') return 'priceSearch'
  return null
}

/** 칸 하나. select 도 input 도 focus 를 받는다. */
type Target = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

const targets = new Map<QuoteFocusStep, Target>()

/** 칸이 제 이름을 적어 둔다. 사라질 때는 지운다. */
export function registerQuoteFocus(step: QuoteFocusStep, el: Target | null): void {
  if (el) targets.set(step, el)
  else targets.delete(step)
}

/** 등록된 칸(하네스가 본다). */
export function quoteFocusTarget(step: QuoteFocusStep): Target | null {
  return targets.get(step) ?? null
}

/**
 * 그 칸이 **쓸 수 있게 되기를 기다렸다가** 커서를 옮긴다.
 *
 * 고른 직후에는 다음 칸이 아직 그려지지 않았고(E.U 칸), 그려졌어도 **잠겨 있다** —
 * 수신인 드롭다운은 담당자를 조회해 올 때까지 「고객사를 먼저 선택하세요」로 잠긴 채다.
 * 잠긴 칸에 focus() 를 걸면 아무 일도 일어나지 않는다(2026-11-25 실측에서 커서가
 * body 에 남았다). 그래서 프레임마다 다시 보고, 열리는 그 프레임에 옮긴다.
 *
 * 드롭다운(select)은 열어 보이기까지 한다(showPicker 가 있는 브라우저에서만).
 */
/** 기다리는 한도 — 60fps 에서 약 1.5초. 그 안에 열리지 않으면 포기한다(커서를 뺏지 않는다). */
const MAX_FRAMES = 90
/** 뒤에 온 요청이 앞의 기다림을 끊는다. */
let token = 0

export function focusQuoteStep(step: QuoteFocusStep, opts: { open?: boolean } = {}): void {
  if (typeof window === 'undefined') return
  const mine = ++token
  let frames = 0

  const tick = () => {
    if (mine !== token) return
    const el = targets.get(step)
    /**
     * 사람이 그새 **다른 칸을 직접 잡았으면** 그만둔다 — 기다리는 동안 눌러 둔 자리를
     * 1초 뒤에 빼앗지 않는다. 첫 프레임은 보지 않는다(고르기 전 커서가 아직 검색칸에 있다).
     */
    const taken = document.activeElement
    if (frames > 0 && taken && taken !== document.body && taken !== el
      && /^(input|select|textarea|button)$/i.test(taken.tagName)) return

    if (el && !(el as HTMLInputElement | HTMLSelectElement).disabled) {
      el.focus()
      if (opts.open && el instanceof HTMLSelectElement) {
        // showPicker 는 아직 모든 브라우저에 없다 — 없으면 포커스만으로 끝낸다.
        const picker = (el as HTMLSelectElement & { showPicker?: () => void }).showPicker
        if (typeof picker === 'function') {
          try { picker.call(el) } catch { /* 사용자 제스처 밖이면 막힌다 — 포커스로 충분하다 */ }
        }
      }
      return
    }
    if (frames++ < MAX_FRAMES) window.requestAnimationFrame(tick)
  }

  window.requestAnimationFrame(() => window.requestAnimationFrame(tick))
}

/** 고른 뒤 한 번에 — 다음 칸을 찾아 옮긴다. */
export function advanceQuoteFocus(from: QuoteFocusStep, opts: { isDealer: boolean }): void {
  const next = nextFocusStep(from, opts)
  if (next) focusQuoteStep(next, { open: next === 'recipient' })
}

/**
 * 담당자가 **한 사람뿐이면** 고르게 할 것이 없다 — 그 사람으로 정하고 다음으로 넘어간다.
 * 돌려주는 값은 고를 contact_id(없으면 null).
 */
export function onlyContactId(contacts: readonly { contact_id: number }[]): number | null {
  return contacts.length === 1 ? contacts[0].contact_id : null
}
