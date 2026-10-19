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

/** 시트 구조가 갈리는 세 가지. 파서가 이 값으로 분기한다. */
export type KindProfile = 'standard' | 'cmm_main' | 'calibration'

export type PriceListKind = {
  /** price_list.sheet_name 에 그대로 들어가는 글자. 바꾸지 마라. */
  sheet: string
  /** 화면에 보이는 짧은 설명. 저장되지 않는다. */
  hint: string
  profile: KindProfile
}

export const PRICE_LIST_KINDS: readonly PriceListKind[] = [
  { sheet: 'SFG Main',       hint: '표면·윤곽 본체',   profile: 'standard' },
  { sheet: 'CMM Main body',  hint: '3차원 본체 · 구입가 두 열(Jig 포함/제외)', profile: 'cmm_main' },
  { sheet: 'SFG Accessory',  hint: '표면·윤곽 부속품', profile: 'standard' },
  { sheet: 'CMM Accessory',  hint: '3차원 부속품',     profile: 'standard' },
  { sheet: 'SFG Spare part', hint: '표면·윤곽 부품',   profile: 'standard' },
  { sheet: 'CMM Spare',      hint: '3차원 부품',       profile: 'standard' },
  { sheet: 'Calibration',    hint: '교정 · 섹션으로 나뉜 시트', profile: 'calibration' },
]

export const PRICE_LIST_SHEETS: readonly string[] = PRICE_LIST_KINDS.map(k => k.sheet)

/** 종류 글자로 찾는다. 목록에 없는 글자는 받지 않는다(서버도 같은 함수로 검사한다). */
export const kindOf = (sheet: string): PriceListKind | null =>
  PRICE_LIST_KINDS.find(k => k.sheet === sheet) ?? null

// ── 머리글 후보 ─────────────────────────────────────────────────────────────

/** 파서가 찾는 열. 값은 price_list 의 칸 이름을 그대로 쓴다(jig 두 개만 예외). */
export type HeaderTarget =
  | 'item_code' | 'cost_jpy' | 'cost_jig_in' | 'cost_jig_out' | 'price_jpy'
  | 'item_name_jp' | 'model_jp' | 'note1_jp' | 'note2_jp' | 'plnt' | 'grp'

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
    '아이템코드', '품번', '코드', '제품코드',
  ],
  cost_jpy: [
    'Net price', 'Net Price', 'NetPrice', 'Net price (JPY)', '仕切り', '現法 仕切り',
    '넷프라이스', '구입가', '매입가',
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
    '모델', '모델명', '품명',
  ],
  model_jp: [
    'Description', 'Specification', 'Model (JP)', '仕様', '規格',
    '디스크립션', '설명', '규격',
  ],
  note1_jp: [
    'Model (EN)', 'Model(EN)', 'Calibration items', 'Calibration Items',
    '모델(영문)', '교정항목',
  ],
  note2_jp: [
    'Description (EN)', 'Description(EN)', '디스크립션(영문)', '설명(영문)',
  ],
  plnt: ['Plnt', 'Plant', '플랜트'],
  grp: ['Group', 'Grp', '그룹'],
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
