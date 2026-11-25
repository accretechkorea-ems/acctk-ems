/**
 * 명함 — **규칙 한 곳** (2026-11-23).
 *
 * 받은 명함이 사람 서랍에만 있다. 그 사람이 자리를 옮기면 연락처가 통째로 사라진다.
 * 찍어서 올리면 글자를 읽어 칸에 넣고(lib/businessCardOcr.ts), 회사 전체가 같이 본다.
 *
 * 이 파일에는 **화면도 조회도 없다** — 값의 모양과 판정만 둔다. 그래야 하네스가 돌린다.
 *   · 어떤 칸이 있나 · 사업부 기본값 · 중복 경고 · 나이 꼬리표 · 등록자 스냅샷
 *
 * 표는 db/business_cards_20261123.sql 이다. **고객사·사업장 연결 칸은 없다**(지시).
 */

import type { Division } from './division'
import { toDivision } from './division'

// ── 칸 ────────────────────────────────────────────────────────────────────

/**
 * 명함에 적는 글자 칸 — 화면의 차례 그대로다.
 *
 * 영문 둘(`name_en`·`company_en`)은 **한글 칸 바로 아래**에 선다.
 * 표의 칸은 db/business_cards_en_20261123.sql 로 더한다 — 아직 돌리지 않았어도
 * 화면은 돈다(라우트가 없는 칸을 빼고 담고, 목록은 영문 없이 읽는다).
 */
export const CARD_FIELDS = [
  'name', 'name_en', 'company', 'company_en', 'department', 'position',
  'mobile', 'phone', 'fax', 'email', 'address', 'website', 'memo',
] as const
export type CardField = (typeof CARD_FIELDS)[number]

/** 표에 **아직 없을 수 있는** 칸 — SQL 적용 전에는 라우트·목록이 이 칸을 뺀다. */
export const EN_FIELDS: readonly CardField[] = ['name_en', 'company_en']

/** 칸 이름 — 폼·엑셀·하네스가 같은 말을 쓴다. */
export const FIELD_LABEL: Record<CardField, string> = {
  name: '이름', name_en: '영문 이름', company: '회사', company_en: '영문 회사명',
  department: '부서', position: '직급',
  mobile: '휴대폰', phone: '전화', fax: '팩스', email: '이메일',
  address: '주소', website: '홈페이지', memo: '메모',
}

/** 폰에서 알맞은 키패드가 뜨도록 — 칸마다 input type. */
export const FIELD_INPUT_TYPE: Partial<Record<CardField, 'tel' | 'email' | 'url'>> = {
  mobile: 'tel', phone: 'tel', fax: 'tel', email: 'email', website: 'url',
}

/** 이름만 필수다. 나머지는 명함에 없을 수 있다. */
export const REQUIRED_FIELDS: readonly CardField[] = ['name']

export const MEMO_MAX = 1000
export const FIELD_MAX = 200

// ── 넣는 방식 ─────────────────────────────────────────────────────────────

/**
 * 'contact' 는 **고객사 담당자에서 복사**해 담은 장이다(2026-11-25).
 * 표의 CHECK 에 그 값을 더하는 것은 db/contacts_fields_20261125.sql 이다 —
 * 적용 전에는 라우트가 'manual' 로 떨어뜨려 담는다(명함은 담기고, 꼬리표만 다르다).
 */
export const INPUT_METHODS = ['camera', 'upload', 'manual', 'bulk', 'contact'] as const
export type InputMethod = (typeof INPUT_METHODS)[number]

export const METHOD_LABEL: Record<InputMethod, string> = {
  camera: '사진 촬영', upload: '사진 올리기', manual: '직접 입력', bulk: '여러 장 등록',
  contact: '담당자에서 복사',
}

export function isInputMethod(v: unknown): v is InputMethod {
  return (INPUT_METHODS as readonly string[]).includes(String(v))
}

// ── 한 줄 ─────────────────────────────────────────────────────────────────

/** 표의 한 줄. 날짜는 ISO 글자 그대로 들고 다닌다. */
export type BusinessCard = {
  card_id: number
  name: string
  /** 영문 이름 — 표에 칸이 없을 수 있다(db/business_cards_en_20261123.sql). */
  name_en?: string | null
  company?: string | null
  /** 영문 회사명 — 위와 같다. */
  company_en?: string | null
  /** 여러 장 등록 한 번(묶음)의 id. 칸은 db/business_cards_batch_20261125.sql 이 더한다. */
  import_batch_id?: string | null
  /** 검토 대기(draft)인가 — db/business_cards_draft_20261125.sql. 칸이 없으면 active 로 본다. */
  status?: string | null
  /** 그 줄이 PDF 몇 쪽이었나(0부터). 위와 같은 SQL 이 더한다. */
  import_page?: number | null
  department?: string | null
  position?: string | null
  mobile?: string | null
  phone?: string | null
  fax?: string | null
  email?: string | null
  address?: string | null
  website?: string | null
  memo?: string | null
  division: string
  registered_at: string
  input_method?: string | null
  engineer_id?: number | null
  /** 등록한 **때의** 이름·팀·사업부. 사람이 옮겨도 과거가 바뀌지 않게 글자로 남긴다. */
  registered_name?: string | null
  registered_team?: string | null
  registered_div?: string | null
  deleted_at?: string | null
}

/** 폼이 들고 있는 값. 글자 칸은 전부 글자다(빈 칸은 빈 글자). */
export type CardForm = Record<CardField, string> & {
  division: Division
  input_method: InputMethod
}

export const EMPTY_CARD_FORM: CardForm = {
  name: '', name_en: '', company: '', company_en: '', department: '', position: '',
  mobile: '', phone: '', fax: '', email: '', address: '', website: '', memo: '',
  division: '계측', input_method: 'manual',
}

// ── 사업부 ────────────────────────────────────────────────────────────────

/**
 * 폼의 사업부 기본값 — **등록하는 사람의 팀 사업부**. 폼에서 바꿀 수 있다.
 * 팀이 없거나 못 읽었으면 계측이다(teams.division 의 기본값과 같다).
 */
export function defaultDivision(me?: { perm?: { division?: string | null } | null } | null): Division {
  return toDivision(me?.perm?.division)
}

/**
 * 그 사람이 볼 수 있는 명함의 사업부.
 * 전환 가능 팀은 **양쪽**을, 그 밖에는 자기 사업부만 본다(lib/division.ts canSwitchDivision).
 * 빈 배열을 돌려주지 않는다 — 아무것도 못 보는 상태를 만들지 않는다.
 */
export function visibleDivisions(opts: { canSwitch: boolean; teamDivision: Division }): Division[] {
  return opts.canSwitch ? ['계측', '반도체'] : [opts.teamDivision]
}

// ── 저장할 수 있는가 ──────────────────────────────────────────────────────

/** 못 저장하는 까닭 — 첫 번째 하나만. 없으면 null. */
export function cardBlockedReason(form: Pick<CardForm, 'name' | 'memo'>): string | null {
  if (!form.name.trim()) return '이름을 적어주세요'
  if (form.name.trim().length > FIELD_MAX) return `이름은 ${FIELD_MAX}자까지 적을 수 있습니다`
  if (form.memo.length > MEMO_MAX) return `메모는 ${MEMO_MAX}자까지 적을 수 있습니다`
  return null
}

// ── 같은 명함인가 ─────────────────────────────────────────────────────────

/** 번호에서 숫자만 — 「010-1234-5678」과 「01012345678」을 같게 본다. */
export const digitsOf = (v: string | null | undefined): string => String(v ?? '').replace(/\D/g, '')

/** 이름은 공백을 털고 소문자로. */
export const nameKey = (v: string | null | undefined): string => String(v ?? '').replace(/\s/g, '').toLowerCase()

/** 이메일은 공백을 털고 소문자로. */
export const emailKey = (v: string | null | undefined): string => String(v ?? '').trim().toLowerCase()

/**
 * 이미 있는 명함인가 — **이름+휴대폰이 같거나, 이메일이 같으면** 그 줄을 돌려준다.
 *
 * 막지는 않는다. 같은 사람이 회사를 옮겨 명함이 두 장이 되는 일은 정상이다.
 * 「이미 등록된 명함입니다 — 기존 것 열기 / 그래도 저장」으로 **물어보기만** 한다.
 */
export function findDuplicate(
  form: Pick<CardForm, 'name' | 'mobile' | 'email'>,
  rows: readonly BusinessCard[],
): BusinessCard | null {
  const n = nameKey(form.name)
  const m = digitsOf(form.mobile)
  const e = emailKey(form.email)
  for (const r of rows) {
    if (r.deleted_at) continue
    if (n && m && nameKey(r.name) === n && digitsOf(r.mobile) === m) return r
    if (e && emailKey(r.email) === e) return r
  }
  return null
}

export const DUPLICATE_TITLE = '이미 등록된 명함입니다'
export const DUPLICATE_OPEN = '기존 것 열기'
export const DUPLICATE_SAVE = '그래도 저장'

// ── 나이 꼬리표 ───────────────────────────────────────────────────────────

/** 꼬리표 색. 값은 디자인 표의 상태색이다(.claude/rules/design-system.md). */
export const AGE_TONES = {
  fresh: '#16a34a',   // 1년 미만
  stale: '#f59e0b',   // 1~3년
  old: '#ef4444',     // 3년 이상
} as const
export type AgeTone = keyof typeof AGE_TONES

/** 하루(ms). 경계를 날짜 수로 센다 — 시각이 섞이면 같은 날이 다르게 보인다. */
const DAY = 24 * 60 * 60 * 1000

/** 두 날짜 사이의 **날짜 수**(KST 기준 자정끼리). */
export function daysBetween(fromIso: string, nowIso: string): number {
  const a = Date.parse(fromIso)
  const b = Date.parse(nowIso)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.floor((b - a) / DAY)
}

/**
 * 명함의 나이 — 며칠 됐나와 어느 색인가.
 *   1년 미만(364일 이하) 초록 · 1~3년(365~1094일) 주황 · 3년 이상(1095일~) 빨강
 */
export function ageTone(days: number): AgeTone {
  if (days >= 1095) return 'old'
  if (days >= 365) return 'stale'
  return 'fresh'
}

/** 꼬리표 글자 — 「12일 전」·「3개월 전」·「2년 전」. */
export function ageLabel(days: number): string {
  if (days <= 0) return '오늘'
  if (days < 30) return `${days}일 전`
  if (days < 365) return `${Math.floor(days / 30)}개월 전`
  return `${Math.floor(days / 365)}년 전`
}


// ── 등록자 스냅샷 ─────────────────────────────────────────────────────────

/** 등록한 때의 사람 — 라우트가 **세션에서** 만들어 담는다(화면이 보낸 값을 믿지 않는다). */
export type RegistrarSnapshot = {
  engineer_id: number | null
  registered_name: string | null
  registered_team: string | null
  registered_div: string | null
}

export function snapshotOf(
  me: { engineer_id?: number | null; name?: string | null; teams?: string | null } | null | undefined,
  division: string,
): RegistrarSnapshot {
  return {
    engineer_id: me?.engineer_id ?? null,
    registered_name: (me?.name ?? '').trim() || null,
    registered_team: (me?.teams ?? '').trim() || null,
    registered_div: toDivision(division),
  }
}

/**
 * 목록에 보여 줄 **연락처 한 줄** (2026-11-25).
 *
 * 휴대폰이 먼저다. 없으면 **회사 전화**를 대신 보여 주고 「회사」라고 적어 둔다 —
 * 전에는 휴대폰이 없는 명함이 `—` 로만 보여, 전화가 적혀 있는데도 연락할 길이
 * 없는 것처럼 읽혔다. 둘 다 없으면 null.
 */
export function displayPhone(
  card: Pick<BusinessCard, 'mobile' | 'phone'>,
): { number: string; isCompany: boolean } | null {
  const mobile = String(card.mobile ?? '').trim()
  if (mobile) return { number: mobile, isCompany: false }
  const phone = String(card.phone ?? '').trim()
  if (phone) return { number: phone, isCompany: true }
  return null
}

/** 회사 전화임을 알리는 작은 글자. */
export const COMPANY_PHONE_MARK = '회사'

/** 목록에 보이는 등록자 — 그때의 글자가 먼저다(지금 소속을 따라가지 않는다). */
export function registrarLabel(card: Pick<BusinessCard, 'registered_name' | 'registered_team'>): string {
  const name = (card.registered_name ?? '').trim()
  const team = (card.registered_team ?? '').trim()
  if (!name) return '-'
  return team ? `${name} · ${team}` : name
}

// ── 찾기 ──────────────────────────────────────────────────────────────────

/** 검색이 보는 칸 — 이름·회사·부서·전화·이메일. */
export const SEARCH_FIELDS: readonly CardField[] =
  ['name', 'name_en', 'company', 'company_en', 'department', 'mobile', 'phone', 'email']

/** 그 명함이 검색어에 걸리는가. 번호는 숫자만 비교한다(「010-1234」로도 걸린다). */
export function matchesCard(card: BusinessCard, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = SEARCH_FIELDS.map(f => String(card[f] ?? '')).join(' ').toLowerCase()
  if (hay.includes(q)) return true
  const qd = digitsOf(q)
  if (!qd) return false
  return [card.mobile, card.phone, card.fax].some(v => digitsOf(v).includes(qd))
}

/** 엑셀로 내보내는 열 — 등록자 이름·팀·사업부를 함께 낸다(요청). */
/**
 * 차례는 **목록과 같게** 둔다 — 등록일·회사·부서·이름·직급·연락처가 먼저 서고,
 * 영문·팩스·홈페이지·주소·메모는 뒤로 보낸다(2026-11-25에 다시 세웠다).
 * 「지난 기간」·「등록자 팀」·「등록자 사업부」는 뺐다 — 세어 보지 않는 열이었다.
 */
export const EXCEL_COLUMNS: readonly { key: string; label: string }[] = [
  { key: 'registered_at', label: '등록일' },
  { key: 'company', label: FIELD_LABEL.company },
  { key: 'department', label: FIELD_LABEL.department },
  { key: 'name', label: FIELD_LABEL.name },
  { key: 'position', label: FIELD_LABEL.position },
  { key: 'mobile', label: FIELD_LABEL.mobile },
  { key: 'phone', label: FIELD_LABEL.phone },
  { key: 'email', label: FIELD_LABEL.email },
  { key: 'division', label: '사업부' },
  { key: 'registered_name', label: '등록자' },
  { key: 'name_en', label: FIELD_LABEL.name_en },
  { key: 'company_en', label: FIELD_LABEL.company_en },
  { key: 'fax', label: FIELD_LABEL.fax },
  { key: 'website', label: FIELD_LABEL.website },
  { key: 'address', label: FIELD_LABEL.address },
  { key: 'memo', label: FIELD_LABEL.memo },
]
