/**
 * z-index 층위 단일 소스.
 *
 * 값을 직접 쓰지 말고 여기서 가져다 쓴다. 예전에는 9999 한 값에 헤더·모달·툴팁 등
 * 일곱 종류가 몰려 있어서, 무엇이 위로 오는지가 DOM 순서라는 우연에 기대고 있었다.
 *
 * 아래에서 위로:
 *   thead      표 헤더 고정(sticky) — 스크롤되는 행 위
 *   decor      페이지 장식 — 워터마크처럼 내용 위에 얹히지만 조작할 수 없는 것
 *   inPage     페이지 안에서 뜨는 UI — 포털을 쓰지 않아 조상 밖으로 못 나가는 것
 *   header     상단 헤더(sticky)
 *   headerMenu 헤더 안에서 열리는 메뉴 — 헤더가 자체 스택 컨텍스트라 이 값은
 *              '헤더 안에서의 순서'일 뿐, 헤더 밖(모달 등)으로는 못 올라간다.
 *   modal      모달 오버레이
 *   subModal   모달 위에서 다시 열리는 모달
 *   fullscreen 전체화면 지도 — 모달을 덮지만 확인 창보다는 아래
 *   confirm    확인·경고 창 — 무엇 위에서든 답을 받아야 한다
 *   popover    포털로 body 에 붙는 드롭다운·팝오버·툴팁 — 모달 안에서 열려도 위로 뜬다
 *   toast      알림 — 항상 맨 위
 *
 * 컴포넌트 안에서만 겹치는 z-index(SegmentedControl 인디케이터, 지도 오버레이,
 * 카드 안 배지 등 1~3)는 전역 층위와 무관하므로 여기에 두지 않는다.
 */
export const Z = {
  thead: 1,
  decor: 10,
  inPage: 100,
  header: 9000,
  headerMenu: 9010,
  modal: 10000,
  subModal: 10010,
  fullscreen: 10020,
  confirm: 10030,
  popover: 10040,
  toast: 10050,
} as const
