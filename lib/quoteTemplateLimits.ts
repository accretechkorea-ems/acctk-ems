// 장비 구성 템플릿의 **입력 상한** — 화면과 서버가 같은 값을 본다.
//
// ── 왜 파일을 따로 두는가 ───────────────────────────────────────────────────
//   이 값들은 원래 lib/quoteTemplates.ts 에 있었다. 그 파일은 `'use client'` 다.
//   API 라우트(app/api/quote-templates/route.ts)가 거기서 상수를 가져오자, Next 가 그
//   모듈을 **client reference proxy** 로 바꿔 끼웠다 — 서버에서 TEMPLATE_NAME_MAX 는
//   숫자 60 이 아니라 「부르면 던지는 함수」였다.
//
//   그래서 `name.slice(0, TEMPLATE_NAME_MAX)` 가 `slice(0, NaN)` 이 되어 **빈 글자**를
//   돌려주고, 라우트는 「템플릿 이름을 입력해주세요」로 막았다. 화면에는 이름이 또렷이
//   보이는데 서버는 빈 이름을 받은 것처럼 굴었다(2026-10-21 추적).
//   같은 이유로 줄 수·수량·금액 상한 비교도 전부 NaN 과의 비교라 **검사가 무력했다.**
//
//   값만 담은 이 파일에는 `'use client'` 를 붙이지 않는다. 그래야 서버가 숫자를 본다.
//   화면 쪽은 lib/quoteTemplates.ts 가 다시 내보내 주므로 import 경로를 바꾸지 않아도 된다.

/** 템플릿 이름 길이. 목록 한 줄에 들어가는 선이다. */
export const TEMPLATE_NAME_MAX = 60
/** 한 템플릿의 줄 수 상한. 장비 한 대 구성이 200줄을 넘는 일은 없다. */
export const TEMPLATE_ITEM_MAX = 200
/** 수량·금액의 범위. 음수와 터무니없는 값을 막는다. */
export const TEMPLATE_QTY_MAX = 9999
export const TEMPLATE_PRICE_MAX = 100_000_000_000
