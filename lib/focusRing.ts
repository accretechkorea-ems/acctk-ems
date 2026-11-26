// **고르는 자리의 링** — 호버·키보드 포커스·선택됨이 전부 같은 테두리다 (2026-11-26 묶음2 D).
//
// ── 어디서 뽑았나 ───────────────────────────────────────────────────────────
//   견적 작성 「사명」 검색칸의 포커스 모양 그대로다(app/quote/page.tsx 의 `.q-box:focus-within`
//   과 `.q-input:focus`). 값을 새로 만들지 않고 **그 코드에서 그대로** 옮겨 왔다:
//
//       border-color: #234ea2                         (디자인 표의 액센트)
//       box-shadow:   0 0 0 3px rgba(35,78,162,0.10)  (그 액센트의 10% 테두리광)
//       outline:      none
//
//   ⚠ 테두리 **두께는 1px 그대로**다. 시안 설명에는 「파란 2px 테두리」라고 적혀 있지만,
//     코드의 그 자리는 1px 테두리 + 3px 테두리광이다. 「색값은 그 코드에서 그대로
//     뽑는다」는 지시를 따라 두께도 그 자리의 것을 썼다 — 2px 로 굵히면 링이 켜질 때
//     칸이 1px 씩 커져 줄 전체가 들썩인다(테두리광은 자리를 차지하지 않는다).
//     2px 로 바꾸려면 아래 RING_WIDTH 한 줄만 고치면 된다. **판단 필요**.
//
// ── 왜 세 상태가 같은 링인가 ────────────────────────────────────────────────
//   Kevin 확정(2026-11-26): 호버·포커스·선택됨에 **단계를 두지 않는다.** 전에는 자리마다
//   달랐다 — 어떤 표는 호버에 회색 배경, 어떤 목록은 연파란 배경, 어떤 카드는 테두리만,
//   입력칸은 화면마다 포커스가 있기도 없기도 했다. 「지금 내 손이 닿아 있는 곳」을
//   가리키는 신호가 열 가지면 그것은 신호가 아니다.
//
// ── 정본은 여기, 그림은 globals.css ─────────────────────────────────────────
//   실제로 칠하는 규칙은 app/globals.css 의 「고르는 자리의 링」 블록이다(인라인 style 을
//   이기려면 !important 가 필요하고, 그것은 스타일시트에서만 쓸 수 있다). 두 곳이 어긋나지
//   않게 scripts/focus-ring-check.js 가 **값이 같은지** 본다.

/** 링의 테두리 색 — 디자인 표의 액센트. */
export const RING_COLOR = '#234ea2'

/** 테두리 두께(px). 그 자리의 것을 그대로 썼다(위 ⚠ 참고). */
export const RING_WIDTH = 1

/** 테두리광 — 액센트의 10%, 3px. 자리를 차지하지 않아 줄이 들썩이지 않는다. */
export const RING_SHADOW = '0 0 0 3px rgba(35,78,162,0.10)'

/**
 * 인라인 style 로 링을 거는 자리(드물다 — 거의 다 아래 클래스로 한다).
 * JS 로 켜고 끄는 자리가 있으면 이 값을 쓴다.
 */
export const ringStyle = {
  borderColor: RING_COLOR,
  boxShadow: RING_SHADOW,
  outline: 'none',
} as const

/**
 * **고를 수 있는 줄·카드**에 붙이는 클래스. 붙이면 세 상태에 링이 선다.
 *
 *   <div className={PICK_CLASS} aria-selected={on}>…</div>
 *
 * 선택됨은 `aria-selected="true"` 또는 `data-on="true"` 로 알린다 — 둘 다 받는다
 * (ARIA 를 쓸 수 있는 자리는 ARIA 가 먼저다. 읽어 주는 기계에도 뜻이 전해진다).
 */
export const PICK_CLASS = 'ems-pick'

/** 선택됨을 알리는 data 속성 이름 — aria-selected 를 쓸 수 없는 자리에서 쓴다. */
export const PICK_ON_ATTR = 'data-on'

/** `aria-selected`·`data-on` 을 한 번에 — 부르는 쪽이 조건만 넘긴다. */
export const pickProps = (selected: boolean) => ({
  className: PICK_CLASS,
  'aria-selected': selected,
  [PICK_ON_ATTR]: selected ? 'true' : undefined,
})
