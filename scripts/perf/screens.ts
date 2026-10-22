// 무엇을 재는가 — 화면과 모달 목록. **자료만** 둔다(실행은 measure.ts).
//
// 순서는 사이드바(lib/menuPerms.ts 의 group·order) 그대로다. 경로도 그 파일이 정본이라
// 거기 적힌 값을 그대로 썼다 — 고객사는 '/customers' 가 아니라 '/' 이고,
// 20 대시보드는 '/dashboard/20' 이 아니라 '/repair/dashboard' 다.
//
// ── 읽기 전용 ───────────────────────────────────────────────────────────────
//   걸음(Step)의 종류는 아래 네 가지뿐이고, measure.ts 는 그 네 가지만 실행할 수 있다.
//   글자를 넣는 걸음은 **없다**(로그인만 예외이고 그것은 measure.ts 안에 박혀 있다).
//   모달을 열고 나면 하는 일은 ESC(또는 닫기 단추)뿐이다 — 모달 **안**을 누르는 걸음은
//   목록에 적을 수 없다. 저장·등록·삭제 같은 글자는 measure.ts 의 금지 목록이 한 번 더 막는다.

export type Step =
  /** 주소로 이동. */
  | { kind: 'goto'; path: string }
  /** 보이는 글자로 누른다(첫 번째 것). */
  | { kind: 'clickText'; text: string }
  /** 선택자로 누른다 — 목록의 첫 줄처럼 글자가 매번 다른 곳에 쓴다. */
  | { kind: 'clickFirst'; selector: string }
  /** ESC. */
  | { kind: 'escape' }

export type ModalSpec = {
  label: string
  /** 여는 걸음(보통 하나). */
  open: Step[]
  /** 열렸음을 확인할 글자. 안 보이면 「열리지 않았다」로 적는다. */
  expect: string
  /** 닫는 방법. 기본은 ESC. */
  close?: Step[]
}

export type ScreenSpec = {
  label: string
  /** 사이드바 그룹 — 보고서를 그 순서로 묶는다. */
  group: string
  path: string
  /**
   * 그 화면에 들어간 **뒤** 재는 추가 걸음(탭 전환 등). 걸음마다 따로 잰다.
   * 이름은 보고서에 그대로 나간다.
   */
  after?: { label: string; steps: Step[] }[]
  modals?: ModalSpec[]
  note?: string
}

/** 목록에서 첫 줄을 눌러 상세로 들어가는 화면 — id 를 코드에 박지 않으려는 것이다. */
export const DETAIL_FROM_LIST: { label: string; group: string; from: string; click: Step; expectPath: RegExp; note?: string }[] = [
  {
    label: '고객사 상세 (목록 첫 줄)',
    group: '고객',
    from: '/',
    // 카드 안에 상세로 가는 링크가 있다(components/home/CustomerCard.tsx).
    click: { kind: 'clickFirst', selector: 'a[href^="/customer/"]' },
    expectPath: /\/customer\/\d+/,
  },
  {
    label: '의뢰서 상세 (목록 첫 줄)',
    group: '고객',
    from: '/inquiries',
    // 줄은 button 이고 안에 의뢰번호 칸(.iq-no)이 있다(app/inquiries/page.tsx).
    click: { kind: 'clickFirst', selector: 'button:has(.iq-no)' },
    // 의뢰서 id 는 숫자가 아니라 UUID 다.
    expectPath: /\/inquiries\/[0-9a-f-]{8,}/,
  },
]

export const SCREENS: ScreenSpec[] = [
  // ── 주 메뉴 ───────────────────────────────────────────────────────────────
  {
    label: '홈', group: '주 메뉴', path: '/dashboard',
    modals: [
      { label: '내 견적 (전체 탭)', open: [{ kind: 'clickText', text: '내 견적' }], expect: '내 견적' },
      { label: '내 실적 → 월별 그래프', open: [{ kind: 'clickText', text: '내 실적' }], expect: '월별 실적' },
    ],
  },
  { label: '알림', group: '주 메뉴', path: '/notifications',
    after: [
      { label: '탭: 안 읽음', steps: [{ kind: 'clickText', text: '안 읽음' }] },
      { label: '탭: 전체', steps: [{ kind: 'clickText', text: '전체' }] },
    ],
  },
  {
    label: '전자결재', group: '주 메뉴', path: '/approval',
    after: [
      { label: '탭: 기결', steps: [{ kind: 'clickText', text: '기결' }] },
      { label: '탭: 상신', steps: [{ kind: 'clickText', text: '상신' }] },
      { label: '탭: 참조', steps: [{ kind: 'clickText', text: '참조' }] },
      { label: '탭: 미결', steps: [{ kind: 'clickText', text: '미결' }] },
    ],
  },

  // ── 대시보드 ──────────────────────────────────────────────────────────────
  // 20 대시보드에는 모달이 없다(숫자·그래프만 있는 화면이다 — 코드에 모달 상태가 없다).
  { label: '20 대시보드', group: '대시보드', path: '/repair/dashboard' },
  // 80 대시보드의 모달은 둘 다 **고치는 폼**이다(포캐스트·홀딩) — 아래 SKIPPED_MODALS 에 적었다.
  { label: '80 대시보드', group: '대시보드', path: '/dashboard/80' },
  { label: '활동 현황', group: '대시보드', path: '/activity' },

  // ── 고객 ─────────────────────────────────────────────────────────────────
  { label: '고객사 목록', group: '고객', path: '/' },
  { label: '20 수리', group: '고객', path: '/repair' },
  { label: '쇼룸', group: '고객', path: '/showroom' },
  { label: '의뢰서', group: '고객', path: '/inquiries' },

  // ── 영업 ─────────────────────────────────────────────────────────────────
  { label: '리드', group: '영업', path: '/leads' },
  { label: '포캐스트', group: '영업', path: '/pipeline' },
  { label: '견적서', group: '영업', path: '/quote' },
  {
    label: '접촉 보고서', group: '영업', path: '/contact/semi',
    note: '반도체 사업부 전용 — 계측 계정이면 「접근 권한이 없습니다」가 뜬다(그 사실을 적는다).',
  },

  // ── 주문 ─────────────────────────────────────────────────────────────────
  { label: '발주', group: '주문', path: '/purchase' },
  { label: '재고', group: '주문', path: '/inventory' },

  // ── 하단 ─────────────────────────────────────────────────────────────────
  { label: '건의사항', group: '하단', path: '/suggestions' },

  // ── 관리 ─────────────────────────────────────────────────────────────────
  {
    label: '실적 현황', group: '관리', path: '/sales',
    modals: [
      { label: '담당자 → 월별 그래프', open: [{ kind: 'clickFirst', selector: 'button[title="월별 실적 차트"]' }], expect: '월별 실적' },
    ],
  },
  { label: '관리', group: '관리', path: '/admin' },
]

/**
 * 재지 못한 모달과 이유 — 여는 데 **쓰기 직전 상태**가 필요하거나, 글자를 넣어야 열리는 것들이다.
 * 도구가 못 하는 일이 아니라 **하지 않기로 한** 일이다(읽기 전용 규칙).
 */
export const SKIPPED_MODALS: { screen: string; modal: string; why: string }[] = [
  { screen: '견적서', modal: '장비 구성 선택', why: '견적 분류·양식을 먼저 골라야 단추가 열린다 — 고르는 것은 입력이다' },
  { screen: '견적서', modal: '템플릿 저장', why: '저장 모달이다(쓰기 직전)' },
  { screen: '견적서', modal: '품목 검색', why: '검색창에 글자를 넣어야 결과가 나온다' },
  { screen: '고객사 상세', modal: '고객사 수정 · 장비 추가 · 서비스 추가', why: '전부 입력 폼이다. 열기만 해도 되지만 그 안의 단추가 쓰기라 아예 건드리지 않는다' },
  { screen: '전자결재', modal: '결재선 지정', why: '상신 흐름 안에서만 열린다(상신은 쓰기)' },
  { screen: '관리', modal: '가격표 등록', why: '파일 업로드 모달이다' },
  { screen: '의뢰서', modal: '의뢰서 작성', why: '등록 폼이다' },
  { screen: '포캐스트', modal: '포캐스트 추가', why: '등록 폼이다' },
  { screen: '80 대시보드', modal: '포캐스트 수정 · 홀딩 처리', why: '줄을 누르면 고치는 폼이 열린다(OpportunityModal·HoldingModal)' },
  { screen: '20 대시보드', modal: '(없음)', why: '모달이 없는 화면이다 — 숫자와 그래프만 있다' },
]
