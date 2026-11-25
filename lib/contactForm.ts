/**
 * 고객사 **담당자 칸**의 규칙 한 곳 (2026-11-25).
 *
 * 담당자는 이름·부서·직급·전화·이메일 다섯 칸뿐이었다. 명함을 사진으로 읽어 담당자를
 * 만들 수 있게 되면서 **명함과 같은 칸**을 갖췄다(회사·주소·홈페이지는 사업장 것이라 뺀다).
 *
 * 추가 칸은 db/contacts_fields_20261125.sql 로 더한다 — **그 전에도 화면은 돈다**.
 * 라우트가 없는 칸을 빼고 담는다(명함 영문 칸과 같은 길).
 *
 * 화면(추가·수정 창)·라우트·하네스가 같은 값을 쓴다.
 */

/** 담당자가 가지는 칸 — 화면의 차례 그대로. */
export const CONTACT_FIELDS = [
  'name', 'name_en', 'position', 'department',
  'mobile', 'phone', 'fax', 'email', 'memo',
] as const
export type ContactField = (typeof CONTACT_FIELDS)[number]

/** 표에 **아직 없을 수 있는** 칸 — SQL 적용 전에는 라우트가 뺀다. */
export const CONTACT_NEW_FIELDS: readonly ContactField[] = ['name_en', 'mobile', 'fax', 'memo']

export const CONTACT_LABEL: Record<ContactField, string> = {
  name: '이름', name_en: '영문 이름', position: '직급', department: '부서',
  mobile: '휴대폰', phone: '전화', fax: '팩스', email: '이메일', memo: '메모',
}

/** 폰에서 알맞은 키패드가 뜨도록. */
export const CONTACT_INPUT_TYPE: Partial<Record<ContactField, 'tel' | 'email'>> = {
  mobile: 'tel', phone: 'tel', fax: 'tel', email: 'email',
}

/**
 * **꼭 있어야 하는 다섯**.
 *
 * 전화는 「휴대폰 **또는** 전화」다 — 휴대폰이 없는 일본 명함이 흔해, 둘 중 하나면 된다.
 * 그래서 아래 목록의 `mobile` 은 그 **한 쌍**을 가리킨다(checkRequired 가 가른다).
 */
export const REQUIRED_CONTACT_FIELDS: readonly ContactField[] =
  ['name', 'position', 'department', 'mobile', 'email']

export type ContactValues = Partial<Record<ContactField, string>>

const filled = (v: string | undefined | null) => String(v ?? '').trim() !== ''

/** 그 필수 칸이 채워졌나. 휴대폰은 전화로 대신할 수 있다. */
export function isRequiredMet(values: ContactValues, field: ContactField): boolean {
  if (field === 'mobile') return filled(values.mobile) || filled(values.phone)
  return filled(values[field])
}

/** 아직 비어 있는 필수 칸들. */
export function missingRequired(values: ContactValues): ContactField[] {
  return REQUIRED_CONTACT_FIELDS.filter(f => !isRequiredMet(values, f))
}

/** 저장 단추 옆 글자. 다 찼으면 빈 글자. */
export function missingLabel(values: ContactValues): string {
  const n = missingRequired(values).length
  return n > 0 ? `필수 ${n}개 남음` : ''
}

/** 저장할 수 있나. */
export function canSaveContact(values: ContactValues): boolean {
  return missingRequired(values).length === 0
}

// ── 칸 테두리 ─────────────────────────────────────────────────────────────
/**
 * 필수 칸의 테두리 색을 고른다.
 *   · 비어 있으면 **빨강** — 처음부터 그렇다(눌러 봐야 아는 일이 없게).
 *   · 차 있으면 **테마 파랑** — 사진에서 읽혀 찬 칸도 같다.
 *   · 필수가 아니면 보통 테두리.
 * 색 값은 부르는 쪽이 토큰으로 준다 — 이 함수는 **어느 것**인지만 고른다.
 */
export type BorderKind = 'required' | 'ok' | 'normal'

export function borderKind(values: ContactValues, field: ContactField): BorderKind {
  if (!REQUIRED_CONTACT_FIELDS.includes(field)) return 'normal'
  return isRequiredMet(values, field) ? 'ok' : 'required'
}

/** 라벨 옆의 별표 — 필수 칸에만. */
export const REQUIRED_MARK = '*'

// ── 명함첩에도 담기 ───────────────────────────────────────────────────────
/** 담당자를 복사해 만든 명함의 방식. db/contacts_fields_20261125.sql 이 CHECK 에 넣는다. */
export const CONTACT_INPUT_METHOD = 'contact'

/** 저장을 마치고 묻는 말. */
export const COPY_TO_CARDS_TITLE = '명함첩에도 등록할까요?'
export const COPY_TO_CARDS_MESSAGE =
  '담당자로 저장했습니다. 같은 내용을 명함첩에도 한 장 담아 둘 수 있습니다.'

/**
 * 담당자 값 → 명함 값.
 * 사람 쪽 값은 그대로 옮기고, **회사·주소·홈페이지는 사업장 것**을 붙인다.
 * 연결 키는 두지 않는다 — 복사일 뿐이다(지시).
 */
export function cardPatchFromContact(
  values: ContactValues,
  site: { company?: string | null; address?: string | null; website?: string | null },
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of CONTACT_FIELDS) {
    const v = String(values[f] ?? '').trim()
    if (v) out[f] = v
  }
  for (const [k, v] of Object.entries(site)) {
    const s = String(v ?? '').trim()
    if (s) out[k] = s
  }
  return out
}

/**
 * 직급 **고르는 목록** — 자주 쓰는 값이다(2026-11-26).
 *
 * 선택지일 뿐 제한이 아니다. 목록에 없으면 그대로 적으면 된다(자유 입력) —
 * 담당자의 직급은 회사마다 달라 가둘 수 있는 값이 아니다. 목록을 두는 까닭은
 * 같은 직급이 「과장」·「과장님」·「과 장」으로 갈려 쌓이던 것을 줄이려는 것이다.
 * 차례는 **위가 높은 쪽**이다 — 고르는 사람이 눈으로 찾는 순서다.
 */
export const POSITION_OPTIONS: readonly string[] = [
  '회장', '부회장', '사장', '부사장', '전무', '상무', '이사', '고문',
  '본부장', '실장', '공장장', '소장', '센터장', '팀장', '파트장',
  '부장', '차장', '과장', '대리', '주임', '사원',
  '수석', '책임', '선임', '연구원', '기사', '기술사', '담당',
]

/** 적은 글자에 맞는 직급만 — 비어 있으면 전부(고르는 자리에서 처음부터 보여 준다). */
export function positionMatches(query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...POSITION_OPTIONS]
  return POSITION_OPTIONS.filter(p => p.toLowerCase().includes(q))
}
