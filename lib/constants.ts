/**
 * 장비 분류 칩 — 지도 필터·고객사 목록이 함께 쓴다. 값은 `devices.category` 다.
 *
 * 「20」은 2026-11-19 에 더했다. 그때까지 20 계열 장비(SURFCOM·RONDCOM·SIGMA GAUGE 등
 * 7대)는 **칩에 없어서 늘 보이는** 쪽으로 떨어졌다 — 목록 필터가 「칩에 없는 분류만
 * 가진 업체는 거르지 않는다」로 되어 있기 때문이다(app/page.tsx). 이제 칩으로 가린다.
 * 실측(2026-11-19): 83 931 · 84 295 · 81 214 · 20 7 · 공백 5 · 빈 값 2.
 * 순서는 사업부 번호대로 20 · 81 · 83 · 84 다(지도 필터·목록 필터가 같은 순서를 쓴다).
 * 20 은 **한 값**이다(21·22 처럼 나뉘지 않는다).
 */
export const CATEGORY_OPTIONS = ['20', '81', '83', '84'] as const
export type CategoryOption = typeof CATEGORY_OPTIONS[number]
