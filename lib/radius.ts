// 모서리 둥글기(radius) 토큰 — 화면 어디서나 이 값만 쓴다.
//
// 왜 TS 모듈인가: 이 프로젝트는 tailwind 클래스(`rounded-*`)를 쓰지 않는다(전수 0건).
// 모서리는 전부 인라인 `style={{ borderRadius: … }}` 로 들어가므로, 토큰도 숫자로
// 집어넣을 수 있어야 한다. app/globals.css 의 `--radius-*` 는 같은 값을 CSS 쪽에
// 둔 짝이다 — 둘을 바꿀 때는 함께 바꾼다.
//
// 역할로 고른다. 값이 같아도 역할이 다르면 다른 이름을 쓴다(나중에 역할별로
// 값을 달리할 수 있게).
export const R = {
  /** 카드·패널 */
  card: 12,
  /** 모달 */
  modal: 14,
  /** 버튼·입력칸·셀렉트·드롭다운 */
  control: 8,
  /** 아이콘 버튼 */
  icon: 6,
  /** 태그(분류·상태 같은 작은 꼬리표) */
  tag: 4,
  /** 칩(필터)·숫자 배지 — 알약 모양 */
  pill: 999,
  /** 통계 타일 */
  tile: 10,
} as const

/** 원형 — 아바타·상태 점·지도 마커. 토큰 밖 예외이지만 이름은 두어 쓴다. */
export const CIRCLE = '50%' as const

export type RadiusToken = keyof typeof R
