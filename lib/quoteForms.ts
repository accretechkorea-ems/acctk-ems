// 견적서 **양식**(quotes.form_kind) 과 장비 구성 **묶음**(quote_items.group_kind).
//
// ⚠ quote_type 과 다른 축이다 — 섞어 쓰지 마라.
//   quotes.quote_type 은 수리 라우팅 전용(null / 'repair_hq' / 'repair_domestic')이고 네 곳이
//   그 값으로 분기한다(auto-fail · 실적 현황 · 홈 내 견적 · 결재 summary). 양식은 **새 칸**이다.
//
// ── 양식 세 가지 ───────────────────────────────────────────────────────────
//   general20 : 20 견적서  — 열에 「모델」이 하나 더 있다. 표 첫 줄에 부제 줄이 붙는다.
//   parts80   : 80 파츠    — 가장 단순한 뼈대. 부가세 열이 없다.
//   equip80   : 80 장비    — 구성 묶음(그룹) 행과 계층 번호가 붙고, 조건에 「보증」이 더해지며
//                            특별 할인이 합계 블록 위로 올라간다(소계 → 특별 할인 → 합계).
//
// null 은 「기존 양식」이다 — 개편 전 견적이 그 상태다. 저장된 PDF 는 다시 만들지 않으므로
// 옛 견적은 영향이 없고, 새로 그릴 때만 parts80 뼈대로 떨어진다(FALLBACK_FORM_KIND).
//
// DB·화면에 의존하지 않는다(import 가 없다) — 스크립트로 그대로 돌려 볼 수 있다.

/** 저장·전달에 쓰는 양식 열쇠. 순서가 곧 화면 선택칸의 순서다. */
export const FORM_KINDS = ['general20', 'parts80', 'equip80'] as const

export type FormKind = typeof FORM_KINDS[number]

/** 화면 선택칸·관리 화면에 보이는 이름. */
export const FORM_LABELS: Record<FormKind, string> = {
  general20: '20 견적서',
  parts80: '80 파츠',
  equip80: '80 장비',
}

/**
 * 양식을 모르는 견적(form_kind 가 null·빈 글자·모르는 값)을 그릴 때 쓰는 뼈대.
 * 파츠가 가장 단순해서 어떤 품목 구성이 와도 깨지지 않는다 — 열이 가장 적고 그룹도 없다.
 */
export const FALLBACK_FORM_KIND: FormKind = 'parts80'

/** 저장값을 **늘 쓸 수 있는 양식으로** 풀어 준다. 무엇이 와도 깨지지 않는다. */
export function formKindOf(stored: string | null | undefined): FormKind {
  return isFormKind(stored) ? stored : FALLBACK_FORM_KIND
}

export function isFormKind(v: string | null | undefined): v is FormKind {
  return v != null && (FORM_KINDS as readonly string[]).includes(v)
}

/** 장비 양식인가. 그룹 행·계층 번호·보증 조건·소계 블록이 여기서만 나온다. */
export const isEquipForm = (v: string | null | undefined): boolean => v === 'equip80'

/** 20 견적서인가. 「모델」 열과 부제 줄이 여기서만 나온다. */
export const isGeneral20Form = (v: string | null | undefined): boolean => v === 'general20'

/**
 * 20 견적서 표 첫 줄의 부제.
 *
 * ⚠ **데이터 출처가 없다.** 지금 코드·DB 어디에도 이 문구를 담는 칸이 없고, 레퍼런스(v13)에
 *   표 첫 줄로 들어가 있어 양식에 딸린 고정 문구로 둔다. 건마다 달라야 한다면 칸이 필요하다.
 */
export const GENERAL20_SUBTITLE = '예비품 견적서'

// ── 장비 구성 묶음 ─────────────────────────────────────────────────────────

/** 저장·전달에 쓰는 묶음 열쇠. 순서가 곧 PDF 의 그룹 순서다. */
export const GROUP_KINDS = ['base', 'option', 'include'] as const

export type GroupKind = typeof GROUP_KINDS[number]

/** PDF 의 그룹 제목. **영문을 붙이지 않는다**(레퍼런스의 괄호 영문은 뺐다). */
export const GROUP_PDF_LABELS: Record<GroupKind, string> = {
  base: '본체 + 기본 구성',
  option: '옵션',
  include: '포함사항',
}

/** 화면 선택칸의 짧은 이름. */
export const GROUP_LABELS: Record<GroupKind, string> = {
  base: '본체 + 기본',
  option: '옵션',
  include: '포함사항',
}

export function isGroupKind(v: string | null | undefined): v is GroupKind {
  return v != null && (GROUP_KINDS as readonly string[]).includes(v)
}

/**
 * 묶음을 고를 수 있는 품목 종류.
 * 국내조달품(domestic)은 PDF 에 나오지 않고, 할인(discount)은 합계 블록으로 올라가므로
 * 둘에는 묶음이 없다. 서비스비는 장비 견적에도 줄로 들어갈 수 있어 넣어 둔다.
 */
export const GROUPABLE_ROW_KINDS: readonly string[] = ['price_list', 'manual_jpy', 'service']

/** 이 줄에 묶음 선택칸을 낼 것인가. */
export const canGroupRowKind = (rowKind: string | null | undefined): boolean =>
  rowKind != null && GROUPABLE_ROW_KINDS.includes(rowKind)
