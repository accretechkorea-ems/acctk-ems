// 가격표 종류(시트) 일곱 개와 **머리글 이름 후보**.
//
// ── 왜 글자가 정본인가 ──────────────────────────────────────────────────────
//   price_list.sheet_name 에는 엑셀 시트 이름이 **그대로** 들어 있다
//   (예전 업로드 스크립트 upload_price_list.js:140 이 그렇게 넣었다).
//   그래서 아래 sheet 글자는 **DB 에 이미 들어 있는 글자와 한 글자도 달라서는 안 된다.**
//   다르게 넣으면 같은 종류가 둘로 갈려 덮어쓰기가 되지 않는다.
//   2026-10-20 기준 DB 에는 넷만 들어 있다 — SFG Accessory · CMM Accessory ·
//   SFG Spare part · CMM Spare. 나머지 셋은 첫 등록 때 전량 신규가 된다.
//
// ── 왜 열 위치를 고정하지 않는가 ────────────────────────────────────────────
//   본사 파일의 머리글을 사람이 고쳐 쓴다(영문 원본을 한글로 바꿔 쓴 파일이 있다).
//   위치를 고정하면 그런 파일에서 **엉뚱한 열을 가격으로 읽는다** — 조용히 틀리는 쪽이
//   제일 나쁘다. 그래서 이름 후보로 찾고, 못 찾으면 한글로 어느 열이 없는지 알린다.

/** 시트 구조가 갈리는 네 가지. 파서가 이 값으로 분기한다. */
export type KindProfile = 'standard' | 'cmm_main' | 'calibration' | 'twenty'

/**
 * 어느 견적 양식의 가격표인가.
 *   '80' — 80 파츠·80 장비 견적서가 쓰는 본사 가격표(기존 7개)
 *   '20' — 20 견적서가 쓰는 거래가격표(2026-10-20 추가한 9개)
 * 품번은 20·80 사이에 겹치지 않는다(겹침 0건). 그래도 **섞어 보여 주지 않는다** —
 * 20 견적에 80 품목이 들어가면 단가 기준이 달라진다. 검색을 양식으로 거른다.
 */
export type PriceLine = '80' | '20'

export type PriceListKind = {
  /** price_list.sheet_name 에 그대로 들어가는 글자. 바꾸지 마라. */
  sheet: string
  /** 화면에 보이는 짧은 설명. 저장되지 않는다. */
  hint: string
  profile: KindProfile
  line: PriceLine
}

export const PRICE_LIST_KINDS: readonly PriceListKind[] = [
  // ── 80 가격표 (본사 Price list) ──
  { sheet: 'SFG Main',       hint: '표면·윤곽 본체',   profile: 'standard',    line: '80' },
  { sheet: 'CMM Main body',  hint: '3차원 본체 · 구입가 두 열(Jig 포함/제외)', profile: 'cmm_main', line: '80' },
  { sheet: 'SFG Accessory',  hint: '표면·윤곽 부속품', profile: 'standard',    line: '80' },
  { sheet: 'CMM Accessory',  hint: '3차원 부속품',     profile: 'standard',    line: '80' },
  { sheet: 'SFG Spare part', hint: '표면·윤곽 부품',   profile: 'standard',    line: '80' },
  { sheet: 'CMM Spare',      hint: '3차원 부품',       profile: 'standard',    line: '80' },
  { sheet: 'Calibration',    hint: '교정 · 섹션으로 나뉜 시트', profile: 'calibration', line: '80' },
  // ── 20 가격표 (Transaction Price list) ──
  //    머리글이 한 벌이라 아홉 종류가 같은 프로필을 쓴다. 시트 이름만 다르다.
  { sheet: 'W10',                   hint: 'W10',          profile: 'twenty', line: '20' },
  { sheet: 'Unit_Other',            hint: '유닛·기타',    profile: 'twenty', line: '20' },
  { sheet: 'ATC',                   hint: 'ATC',          profile: 'twenty', line: '20' },
  { sheet: 'SBS',                   hint: 'SBS',          profile: 'twenty', line: '20' },
  { sheet: 'Amp',                   hint: '앰프',         profile: 'twenty', line: '20' },
  { sheet: 'Airmicrometer',         hint: '에어마이크로미터', profile: 'twenty', line: '20' },
  { sheet: 'Gauge',                 hint: '게이지',       profile: 'twenty', line: '20' },
  { sheet: 'GE_AB',                 hint: 'GE·AB',        profile: 'twenty', line: '20' },
  { sheet: 'Finger_Contact_Other',  hint: '핑거·접촉·기타', profile: 'twenty', line: '20' },
]

export const PRICE_LIST_SHEETS: readonly string[] = PRICE_LIST_KINDS.map(k => k.sheet)

/**
 * 그 묶음(20/80)에 속한 시트 이름들. 검색 필터와 등록 화면의 묶음 나누기가 함께 쓴다.
 *
 * **한 번 만들어 두고 같은 배열을 돌려준다.** 호출마다 새 배열을 만들면 이 값을 받는
 * 훅의 의존성이 매번 달라져(useCallback·useMemo) 검색 콜백이 렌더마다 새로 만들어진다.
 */
const SHEETS_BY_LINE: Record<PriceLine, readonly string[]> = {
  '80': PRICE_LIST_KINDS.filter(k => k.line === '80').map(k => k.sheet),
  '20': PRICE_LIST_KINDS.filter(k => k.line === '20').map(k => k.sheet),
}

export const sheetsForLine = (line: PriceLine): readonly string[] => SHEETS_BY_LINE[line]

export const kindsForLine = (line: PriceLine): readonly PriceListKind[] =>
  PRICE_LIST_KINDS.filter(k => k.line === line)

/**
 * 견적 양식이 쓰는 가격표 시트 목록 — **이 판정은 여기 한 곳에만 둔다.**
 *   general20        → 20 가격표만
 *   parts80·equip80  → 80 가격표만
 *   그 밖(미선택 등) → null = 전체에서 찾는다(양식을 고르면 걸린다)
 * lib/quoteForms.ts 의 양식 값을 쓰지만 import 하지 않는다 — 가격표 쪽이 견적 양식 모듈에
 * 매달리지 않게, 글자만 비교한다(양식이 늘면 이 함수만 고친다).
 */
export function sheetsForForm(formKind: string | null | undefined): readonly string[] | null {
  if (formKind === 'general20') return sheetsForLine('20')
  if (formKind === 'parts80' || formKind === 'equip80') return sheetsForLine('80')
  return null
}

/** 지금 어느 가격표에서 찾는지 알리는 문구. */
export function priceScopeLabel(formKind: string | null | undefined, all: boolean): string {
  if (all) return '전체 가격표에서 검색'
  if (formKind === 'general20') return '20 가격표에서 검색'
  if (formKind === 'parts80' || formKind === 'equip80') return '80 가격표에서 검색'
  return '전체 가격표에서 검색'
}

/** 종류 글자로 찾는다. 목록에 없는 글자는 받지 않는다(서버도 같은 함수로 검사한다). */
export const kindOf = (sheet: string): PriceListKind | null =>
  PRICE_LIST_KINDS.find(k => k.sheet === sheet) ?? null

/**
 * 그 가격표 줄이 어느 묶음인가 — **sheet_name 으로만** 가른다.
 * 견적 양식으로 가르지 않는 이유: 「전체 가격표에서 검색」을 켜면 80 양식에서도 20 품목을
 * 고를 수 있다. 그때도 품명·모델은 **그 줄이 온 가격표의 규칙**을 따라야 한다.
 * 목록에 없는 sheet_name(옛 데이터·시험 데이터)은 null 이고, 부르는 쪽은 80 으로 다룬다.
 */
export const lineOfSheet = (sheet: string | null | undefined): PriceLine | null =>
  (sheet ? kindOf(sheet)?.line ?? null : null)

/** 20 가격표에서 온 줄인가(품명·모델 규칙이 80 과 다르다). */
export const isTwentySheet = (sheet: string | null | undefined): boolean =>
  lineOfSheet(sheet) === '20'

// ── 머리글 후보 ─────────────────────────────────────────────────────────────

/** 파서가 찾는 열. 값은 price_list 의 칸 이름을 그대로 쓴다(jig 두 개만 예외). */
export type HeaderTarget =
  | 'item_code' | 'cost_jpy' | 'cost_jig_in' | 'cost_jig_out' | 'price_jpy'
  | 'item_name_jp' | 'model_jp' | 'note1_jp' | 'note2_jp' | 'plnt' | 'grp'
  | 'delivery_time'

/** 오류·미리보기 문구에 쓰는 한글 이름. */
export const TARGET_LABELS: Record<HeaderTarget, string> = {
  item_code: '품번',
  cost_jpy: '구입가',
  cost_jig_in: '구입가(Jig 포함)',
  cost_jig_out: '구입가(Jig 제외)',
  price_jpy: '정가',
  item_name_jp: '모델',
  model_jp: '설명·규격',
  note1_jp: '비고1',
  note2_jp: '비고2',
  plnt: '플랜트',
  grp: '그룹',
  delivery_time: '납기',
}

/**
 * 머리글 이름 후보. 비교는 normHeader 로 공백·대소문자·줄바꿈을 지운 뒤 **완전히 같은지**로 본다.
 * 부분일치로 보지 않는 이유 — 'Model' 과 'Model (EN)', 'Net price' 와
 * 'Net price with Jig' 가 서로를 잡아먹는다.
 *
 * ⚠ 仕切価格(Calibration G열)은 **일부러 후보에 넣지 않았다.** 그 열은 #REF! 오류가 많아
 *   읽으면 안 된다(가격표 1단계 조사). 교정 시트의 구입가는 Net Price 열이다.
 */
export const HEADER_CANDIDATES: Record<HeaderTarget, readonly string[]> = {
  item_code: [
    'Item code', 'Item Code', 'Code', 'Product code', 'Product Code', '品目コード',
    '아이템코드', '품번', '코드', '제품코드', '상품코드',
  ],
  cost_jpy: [
    'Net price', 'Net Price', 'NetPrice', 'Net price (JPY)', '仕切り', '現法 仕切り',
    '넷프라이스', '구입가', '매입가',
    // 20 가격표 — 구입가 칸이 「거래가」다(TRANSACTION PRICE).
    'Transaction price (JPY)', 'Transaction price', '거래가', '거래가격', '거래단가',
  ],
  cost_jig_in: [
    'Net price with Jig', 'Net Price with Jig', 'Net price (with Jig)', 'with Jig',
    '넷프라이스(지그포함)', '구입가(지그포함)', '구입가(Jig 포함)',
  ],
  cost_jig_out: [
    'Net price without Jig', 'Net Price without Jig', 'Net price (without Jig)', 'without Jig',
    '넷프라이스(지그제외)', '구입가(지그제외)', '구입가(Jig 제외)',
  ],
  price_jpy: [
    'List price', 'List Price', 'ListPrice', 'List price (JPY)', '販売定価',
    '리스트프라이스', '정가',
  ],
  item_name_jp: [
    'Model', 'Item name', 'Item Name', 'Product name', 'Product Name', '品名',
    '모델', '모델명', '품명', '상품명', '제품명',
  ],
  model_jp: [
    'Description', 'Specification', 'Model (JP)', '仕様', '規格',
    '디스크립션', '설명', '규격',
    // 20 가격표 — 규격 칸 이름이 SPEC 이다.
    'Spec', '스펙',
  ],
  note1_jp: [
    'Model (EN)', 'Model(EN)', 'Calibration items', 'Calibration Items',
    '모델(영문)', '교정항목',
    // 20 가격표 — 비고 칸이 Comments 다.
    'Comments', 'Comment', '비고', '코멘트',
  ],
  note2_jp: [
    'Description (EN)', 'Description(EN)', '디스크립션(영문)', '설명(영문)',
  ],
  plnt: ['Plnt', 'Plant', '플랜트'],
  grp: ['Group', 'Grp', '그룹'],
  // 20 가격표에만 있는 납기 칸. 「1.0 month」 같은 글자가 들어 있어 주(週)로 환산해 쓴다.
  delivery_time: ['Standard lead time', 'Lead time', 'Leadtime', '납기', '표준납기'],
}

/** 머리글 비교용 정규화 — 공백(전각 포함)·줄바꿈을 지우고 소문자로. */
export const normHeader = (v: unknown): string =>
  String(v ?? '').replace(/[\s　​]+/g, '').toLowerCase()

/** 그 글자가 어떤 열 이름인가(머리글 반복 행을 걸러낼 때도 쓴다). */
export function targetOfHeader(v: unknown): HeaderTarget | null {
  const n = normHeader(v)
  if (!n) return null
  for (const [target, list] of Object.entries(HEADER_CANDIDATES)) {
    if (list.some(c => normHeader(c) === n)) return target as HeaderTarget
  }
  return null
}

/** 못 찾은 열을 알릴 때 쓰는 후보 목록 문구(앞에서 다섯 개만). */
export const candidateHint = (target: HeaderTarget): string =>
  HEADER_CANDIDATES[target].slice(0, 5).join(' / ')

// ── Jig 표기 ────────────────────────────────────────────────────────────────

/**
 * CMM Main body 의 두 줄을 사람이 구별하는 **글자**.
 * variant('jig_in'/'jig_out')는 기계가 덮어쓸 줄을 찾는 열쇠이고, 이 글자는 눈으로 보는 표시다.
 * 설명(model_jp) 끝에 붙어 검색 결과·견적 품명·PDF 에 그대로 나간다.
 */
export const JIG_VARIANTS = {
  jig_in: { variant: 'jig_in', mark: '(Jig 포함)' },
  jig_out: { variant: 'jig_out', mark: '(Jig 제외)' },
} as const
