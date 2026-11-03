'use client'

// **입력 중인 칸을 화면의 같은 자리에 붙들어 둔다.**
//
// ── 무엇을 막는가 ──────────────────────────────────────────────────────────
//   견적 작성 화면은 왼쪽에 줄 카드가 쌓이고, 줄을 더하거나 지우거나 설명 줄을 붙이면
//   그 위쪽 높이가 바뀐다. 브라우저는 스크롤을 문서 맨 위 기준으로 유지하므로, 내가 보고
//   있던 칸이 **그만큼 위아래로 뛴다.** 숫자를 치던 중이면 커서는 칸에 남아 있는데 칸이
//   눈앞에서 사라지고, 그 자리에 다른 줄의 칸이 들어온다 — 거기에 계속 치면 엉뚱한 줄이
//   고쳐진다.
//
// ── 어떻게 ────────────────────────────────────────────────────────────────
//   그릴 때마다(useLayoutEffect — **화면에 칠해지기 전**) 지금 커서가 있는 칸의 화면
//   좌표를 적어 둔다. 다음 번에 그 칸이 그대로라면, 적어 둔 좌표와 지금 좌표의 차이만큼
//   스크롤을 밀어 **눈에 보이는 자리를 되돌린다.** 그 사이에 사람이 직접 굴렸다면 그 양은
//   빼고 본다(안 그러면 사람이 굴린 것을 되감아 버린다).
//
//   effect 가 아니라 **layout** effect 인 이유는, 칠해진 뒤에 고치면 한 프레임 동안
//   튀는 것이 그대로 보이기 때문이다.

import { useLayoutEffect, useRef, type DependencyList } from 'react'

/** 그 칸이 들어 있는 **굴러가는 상자**. 없으면 null — 창 전체가 굴러간다는 뜻이다. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let p: HTMLElement | null = el.parentElement
  while (p) {
    const s = getComputedStyle(p)
    if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return p
    p = p.parentElement
  }
  return null
}

type Anchor = {
  el: HTMLElement
  /** 화면 기준 윗변(px). */
  top: number
  scroller: HTMLElement | null
  /** 적어 둘 때의 스크롤 위치 — 사람이 굴린 양을 가려내는 데 쓴다. */
  scrollTop: number
}

/**
 * @param deps 높이가 바뀔 만한 값(견적 화면은 줄 목록). 이 값이 바뀔 때마다 보정한다.
 */
export function useFocusAnchor(deps: DependencyList): void {
  const prev = useRef<Anchor | null>(null)

  /** 지금 커서가 있는 칸의 자리를 적어 둔다. */
  const record = () => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || active === document.body) { prev.current = null; return }
    const scroller = scrollParentOf(active)
    prev.current = {
      el: active,
      top: active.getBoundingClientRect().top,
      scroller,
      scrollTop: scroller ? scroller.scrollTop : window.scrollY,
    }
  }

  // **커서가 옮겨 갈 때도 적어 둔다.** deps 가 바뀔 때만 적으면, 칸을 누른 **직후**
  // 일어나는 첫 변화(모드 전환·줄 추가)는 견줄 자리가 없어 그냥 뛴다 — 실측에서 첫
  // 한 번만 19px 어긋나던 것이 이것이었다.
  useLayoutEffect(() => {
    document.addEventListener('focusin', record, true)
    return () => document.removeEventListener('focusin', record, true)
  }, [])

  useLayoutEffect(() => {
    const active = document.activeElement
    const focused = active instanceof HTMLElement && active !== document.body ? active : null
    const p = prev.current

    // 같은 칸에 커서가 그대로 있고, 그 칸이 아직 문서에 있을 때만 보정한다.
    if (focused && p && p.el === focused && focused.isConnected) {
      const nowScroll = p.scroller ? p.scroller.scrollTop : window.scrollY
      // 사람이 그사이 굴린 만큼은 뺀다 — 굴린 결과는 되돌리지 않는다.
      const expected = p.top - (nowScroll - p.scrollTop)
      const delta = focused.getBoundingClientRect().top - expected
      // 1px 미만은 둔다(소수점 반올림까지 쫓으면 매 렌더 스크롤이 떨린다).
      if (Math.abs(delta) >= 1) {
        if (p.scroller) p.scroller.scrollTop = nowScroll + delta
        else window.scrollTo(window.scrollX, window.scrollY + delta)
      }
    }

    // 다음 번에 견줄 자리를 적어 둔다(보정한 뒤의 값이다).
    record()
    // 부르는 쪽이 넘긴 값에만 반응한다(그 값이 「높이가 바뀔 만한 일」의 목록이다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
