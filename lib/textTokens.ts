/**
 * 글자 토큰 — **역할마다 하나**.
 *
 * ── 2026-11-23: 글자색 규칙을 전역으로 ────────────────────────────────────
 * 화면 전체에서 라벨·안내문·placeholder·드롭다운 항목·보조 글자가 너무 연해 읽기 힘들었다.
 * 흰 바탕에서 `#9ca3af` 는 대비가 2.8:1 로 기준(4.5:1)에 한참 못 미친다. 그런데 그 값이
 * 라벨에도, 날짜에도, 힌트에도 쓰였다 — 「연한 글자」 하나로 뭉뚱그려져 있었다.
 *
 * 이제 **역할로 가른다.** 읽어야 하는 글자는 전부 4.5:1 을 넘고, 못 넘는 값(#9ca3af)은
 * **비활성 상태 하나**로 쓰임을 좁혔다.
 *
 *   역할                     값        흰 바탕 대비
 *   라벨                     #374151   10.3:1   (굵기 600)
 *   입력값 · 항목 본문        #111827   16.1:1
 *   안내문 · 보조 글자        #4b5563    7.5:1
 *   placeholder              #6b7280    4.8:1
 *   항목 묶음 머리            #374151   10.3:1   (굵기 600)
 *   표 머리줄                #374151   10.3:1
 *   비활성(disabled)          #9ca3af    2.8:1   ← 여기에만 쓴다
 *
 * ── 어디에 걸리나 ─────────────────────────────────────────────────────────
 *   · 화면 코드는 이 파일이나 components/common/ui.ts 의 토큰을 쓴다.
 *   · native `<select>` 의 `option`·`optgroup` 과 `::placeholder` 는 **CSS 가 아니면 닿지 않는다** —
 *     app/globals.css 가 한 번에 칠한다(브라우저 기본색이 더 연하다).
 *   · 토큰 값 자체도 한 단씩 진해졌다(components/common/ui.ts 의 SUB·MUTED·FAINT).
 *     그래서 토큰을 쓰던 800여 자리는 고치지 않아도 함께 진해진다.
 *
 * 색은 .claude/rules/design-system.md 의 표에 있는 값만 쓴다(새 색 금지).
 */

import type { CSSProperties } from 'react'

// ── 글자색(역할) ──────────────────────────────────────────────────────────

/** 입력칸·항목의 **본문** — 사람이 고른 값, 드롭다운 한 줄의 이름. */
export const TEXT_VALUE = '#111827'

/** 칸 이름(라벨). 굵기는 LABEL_WEIGHT. */
export const TEXT_LABEL = '#374151'

/** 표의 머리줄. 라벨과 같은 급이다. */
export const TEXT_TABLE_HEAD = '#374151'

/** 항목 묶음의 머리(`<optgroup label>` 의 「대리점 · 하나무역」 같은 것). */
export const TEXT_OPTGROUP = '#374151'

/** 안내문 · 보조 글자(견적서 표기·주소·날짜 같은 것). */
export const TEXT_NOTE = '#4b5563'

/** 아직 적지 않았을 때 보이는 글자(placeholder). */
export const TEXT_PLACEHOLDER = '#6b7280'

/**
 * **비활성(disabled)에만.** 흰 바탕 대비가 2.8:1 이라 읽히지 않는 값이다 —
 * 「지금은 쓸 수 없다」를 보여 주는 자리에만 쓴다. 읽어야 하는 글자에는 쓰지 않는다.
 */
export const TEXT_DISABLED = '#9ca3af'

/** 라벨·묶음 머리의 굵기. */
export const LABEL_WEIGHT = 600

/** 읽어야 하는 글자가 지켜야 하는 최소 대비(WCAG AA 본문). */
export const MIN_CONTRAST = 4.5

// ── 글자 묶음 — 목록 보기(고객사)가 쓰는 한 벌 ────────────────────────────
// 같은 자리의 글자가 화면마다 13/700 과 14/700 로 갈렸고, 보조 글자는 #6b7280 과
// #9ca3af 가 섞여 「어느 것이 덜 중요한가」가 들쭉날쭉했다. 카드 머리줄, 본문, 라벨
// 셋만 정해 두고 그 밖은 만들지 않는다.

/** 카드·구역 머리줄 — 「사업장 6」·「활동 이력」·「장비」. */
export const TITLE: CSSProperties = { fontSize: 16, fontWeight: 600, color: TEXT_VALUE, letterSpacing: '-0.2px' }

/** 본문 — 표의 값, 카드의 내용. */
export const BODY: CSSProperties = { fontSize: 13, color: TEXT_VALUE }

/** 보조 — 본문에 딸린 설명·메타. */
export const SUB: CSSProperties = { fontSize: 12, color: TEXT_NOTE }

/** 라벨 — 칸 이름(폼·정보 줄의 왼쪽). */
export const LABEL: CSSProperties = { fontSize: 12, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL }

/**
 * 간격은 **8의 배수**로만 고른다. 4 는 글자 사이처럼 아주 좁은 자리에만 쓴다.
 * (6·10·14 처럼 어중간한 값을 없애려고 둔다 — 줄을 맞춰 보면 바로 티가 난다)
 */
export const SPACE = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const
