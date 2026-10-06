// 의뢰서 — 종류·상태의 단 하나뿐인 기준.
//
// 코드값(inquiry_type · status)은 DB 의 CHECK 제약과 글자 하나까지 같아야 한다
// (inquiries_schema.sql 의 inquiries_inquiry_type_check · inquiries_status_check).
// 화면 문구와 코드값을 두 벌로 들고 다니면 한쪽만 고쳐져 어긋나므로, 양쪽 짝을 여기 모은다.
//
// 이 파일에는 순수한 값과 판정만 둔다 — 화면(클라이언트)과 서버 라우트가 함께 읽는다.
// supabase 클라이언트를 여기서 만들지 마라(서버 전용 코드가 화면 번들로 끌려간다).

/** inquiries.inquiry_type 에 들어가는 값 전부. */
export const INQUIRY_TYPES = [
  'req80',
  'req20',
  'spare80',
  'domestic_po',
  'claim',
  'hq_repair',
] as const

export type InquiryType = (typeof INQUIRY_TYPES)[number]

/**
 * 왼쪽 레일에 세우는 순서와 이름.
 *
 * 「전체」는 여기 넣지 않는다 — 종류가 아니라 「거르지 않음」이라서, 목록에 섞어 두면
 * type 으로 거르는 코드가 전체만 따로 분기해야 한다. 화면이 앞에 한 줄 붙인다.
 */
export const INQUIRY_TYPE_ITEMS: { type: InquiryType; label: string }[] = [
  { type: 'req80', label: '80 의뢰서' },
  { type: 'req20', label: '20 의뢰서' },
  { type: 'spare80', label: '80 스페어파츠' },
  { type: 'domestic_po', label: '국내조달품' },
  { type: 'claim', label: '클레임' },
  { type: 'hq_repair', label: '본사수리 공번' },
]

/** 종류 코드 → 화면 이름. 목록 행에서 쓴다. */
export const INQUIRY_TYPE_LABEL: Record<InquiryType, string> =
  Object.fromEntries(INQUIRY_TYPE_ITEMS.map(i => [i.type, i.label])) as Record<InquiryType, string>

/** 주소(?type=)로 들어온 값이 아는 종류인지. 모르는 값이면 null — 화면은 「전체」로 떨어뜨린다. */
export function inquiryTypeOf(value: unknown): InquiryType | null {
  return typeof value === 'string' && (INQUIRY_TYPES as readonly string[]).includes(value)
    ? (value as InquiryType)
    : null
}

/**
 * 지금 쓰는 상태.
 *
 * 'sent'(발송)·'waiting'(회답 대기) 는 은퇴했다 — 쓰는 사람에게는 「아직 쓰는 중인가,
 * 끝났는가」 두 갈래면 충분했고, 중간 상태는 고르는 부담만 늘렸다.
 * DB 의 CHECK 제약은 그대로 둔다(그 두 값이 들어간 행이 없다는 것은 확인했다).
 * 옛 값이 어딘가에 남아 있어도 화면이 깨지지 않게, 라벨·dot 은 모르는 값을 받아들인다.
 */
export const INQUIRY_STATUSES = ['drafting', 'done', 'cancelled'] as const

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number]

/** 상태 코드 → 화면 문구. 저장값은 영문, 보이는 것은 한글이다(견적 상태와 같은 방식). */
export const INQUIRY_STATUS_LABEL: Record<InquiryStatus, string> = {
  drafting: '작성 중',
  done: '완료',
  cancelled: '취소',
}

/**
 * 사람이 직접 고를 수 있는 상태. 'cancelled' 는 여기 없다 —
 * 취소는 번호를 반환할지 버릴지 판정이 따르는 별도 동작이라, 상태 선택으로 만들 수 없다.
 * 화면의 상태 컨트롤과 라우트의 update·register 검증이 같은 목록을 쓴다.
 */
export const EDITABLE_STATUSES: readonly InquiryStatus[] = ['drafting', 'done']

/** 모르는 상태값이 들어와도 화면이 비지 않게 — 저장값을 그대로 보여 준다. */
export const inquiryStatusLabel = (status: string | null | undefined): string =>
  (status && INQUIRY_STATUS_LABEL[status as InquiryStatus]) || status || ''

// ── 내용 기록의 방향 ────────────────────────────────────────────────
// inquiry_messages.direction — 'sent'(발신) · 'received'(회신). **NOT NULL 이 풀려 null 을 허용한다**
// (제약 inquiry_messages_direction_check 는 그대로 있다 — 두 값만 들어간다).
//
// 세 가지 값이 섞여 있다.
//   · 'sent'·'received' — 방향을 쓰던 때 저장된 기록, 그리고 지금 새로 만드는 기록
//   · null              — 방향을 쓰지 않던 동안 만들어진 기록
// 화면은 null 과 모르는 값을 **발신으로 읽는다**(directionOf). 그 기록은 대부분 본사로 보낸 것이고,
// 「방향 없음」이라는 세 번째 칸을 만들면 뱃지·목록·필터가 전부 세 갈래가 된다.
// 되돌릴 수 있는 쪽으로 기울였다 — 사람이 편집 모드에서 회신으로 고치면 그때부터 제 값이 된다.

export const INQUIRY_DIRECTIONS = ['sent', 'received'] as const

export type InquiryDirection = (typeof INQUIRY_DIRECTIONS)[number]

/** 화면 문구. 저장값은 영문, 보이는 것은 한글이다(상태와 같은 방식). */
export const INQUIRY_DIRECTION_LABEL: Record<InquiryDirection, string> = {
  sent: '발신',
  received: '회신',
}

/**
 * 뱃지 색 — **새 값을 만들지 않고** 기존 서비스 유형 색 쌍을 그대로 쓴다.
 *   발신 = 「신규설치」 쌍(연한 파랑 + 액센트 글자)
 *   회신 = 「교육」 쌍(연한 녹색)
 * 값을 복사하지 않고 lib/categoryColors.ts 를 참조만 한다 — 한쪽만 바뀌는 일이 없게.
 * dot 색은 상세 카드의 왼쪽 세로 막대가 쓴다.
 */
export const INQUIRY_DIRECTION_COLOR: Record<InquiryDirection, { text: string; bg: string; dot: string }> = {
  sent: { text: '#234ea2', bg: '#eff4ff', dot: '#3b82f6' },
  received: { text: '#15803d', bg: '#f0fdf4', dot: '#22c55e' },
}

/**
 * 저장값 → 표시용 방향. 'received' 만 회신이고 **그 밖은 전부 발신**이다
 * (null·undefined·빈 문자열·모르는 값 포함 — 위 설명 참고).
 * 순수 함수다 — 화면과 스크립트가 같은 답을 본다.
 */
export function directionOf(value: unknown): InquiryDirection {
  return value === 'received' ? 'received' : 'sent'
}

/** 보낼 값이 올바른 방향인지. 서버가 본문 값을 검증할 때 쓴다(화면도 같은 목록을 본다). */
export function isInquiryDirection(value: unknown): value is InquiryDirection {
  return typeof value === 'string' && (INQUIRY_DIRECTIONS as readonly string[]).includes(value)
}

/** 「발신 / 회신」 분할 선택에 그대로 넘기는 선택지. 순서가 곧 화면 순서다. */
export const INQUIRY_DIRECTION_OPTIONS: { label: string; value: InquiryDirection }[] =
  INQUIRY_DIRECTIONS.map(d => ({ label: INQUIRY_DIRECTION_LABEL[d], value: d }))

// ── 내용(내용 기록 본문) ────────────────────────────────────────────

/**
 * 내용 기록 본문 길이 상한. DB 제약 inquiry_messages_body_check(≤ 20000)와 같은 값이어야 한다.
 * 서버 라우트(app/api/inquiry/route.ts 의 BODY_MAX)가 이 값을 그대로 쓴다 — 두 벌로 두지 않는다.
 */
export const INQUIRY_BODY_MAX = 20000

/**
 * 본문을 한 줄로 — 줄바꿈·연속 공백을 한 칸으로 접고, 길면 끝에 「…」를 붙여 자른다.
 * 상세 정보 카드의 「내용」 칸이 쓴다(전체 글은 그 칸의 title 로 보여 준다).
 *
 * 목록의 「내용」 열은 DB 함수(inquiry_list_extras)가 같은 일을 SQL 로 한다 — 그쪽은 50건을
 * 한 번에 접어야 해서 서버가 하고, 여기는 이미 읽어 둔 본문 하나라 화면에서 한다.
 */
export function inquiryOneLine(body: string | null | undefined, max = 120): string {
  const one = (body ?? '').replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return `${one.slice(0, max)}…`
}

// ── 번호 조립 ───────────────────────────────────────────────────────
// 순수 함수다. 여기서 날짜를 직접 만들지 않고 부르는 쪽이 넘겨준다 —
// 「오늘」은 반드시 KST 여야 하는데(lib/date.ts 의 todayKST), 그 판단을 이 파일에 두면
// 서버·화면 어느 쪽에서 불렀는지에 따라 답이 갈릴 수 있다.

/** 80 의뢰서(req80)에 쓸 수 있는 장비 계열. req20 은 '20' 고정이라 여기 없다. */
export const REQ80_SERIES: readonly string[] = ['81', '83', '84']

/** 20 의뢰서의 계열은 하나뿐이다. DB CHECK 에도 들어 있는 값이다. */
export const REQ20_SERIES = '20'

/**
 * 채번 카운터의 기간 키.
 * 본사수리 공번만 연도 리셋이 없어 'ALL' 한 줄을 계속 쓴다(inquiries_schema.sql 참고).
 */
export function periodKeyFor(type: InquiryType, year: number | string): string {
  return type === 'hq_repair' ? 'ALL' : String(year)
}

const pad = (n: number | string, width: number): string => String(n).padStart(width, '0')

/** 'YYYY-MM-DD' → 'YYMMDD'. 형식이 아니면 빈 문자열(부르는 쪽이 이미 검증했다는 뜻). */
const yymmdd = (ymd: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${m[1].slice(2)}${m[2]}${m[3]}` : ''
}

export type BuildInquiryNoInput = {
  /** claim_inquiry_seq 가 돌려준 순번. */
  seq: number
  /** 번호에 찍을 연도(4자리). 발행일의 연도다. hq_repair 는 쓰지 않는다. */
  year: number | string
  /** 장비 계열. req80 은 필수(81·83·84), req20 은 '20', 나머지는 쓰지 않는다. */
  series?: string | null
  /** 발행일 'YYYY-MM-DD'(KST). spare80 만 쓴다. */
  issuedDate?: string
}

/**
 * 종류별 의뢰서 번호를 만든다.
 *
 *   req80        BY26-81-001        계열별로 순번이 나뉘지 않는다 — 카운터는 종류 단위다
 *   req20        BY26-20-001
 *   hq_repair    239-0001           연도가 들어가지 않아 리셋도 없다
 *   claim        ACCTK26-001
 *   domestic_po  #PO-T4-2026-001    여기만 연도가 4자리다
 *   spare80      001-K260929        번호가 앞, 날짜가 뒤. 발행일 기준이다
 *
 * 형식이 서로 전혀 닮지 않은 이유는 각 서류가 이미 바깥(본사·거래처)에서 그 모양으로
 * 쓰이고 있기 때문이다. 하나로 통일하지 않는다.
 */
export function buildInquiryNo(type: InquiryType, input: BuildInquiryNoInput): string {
  return assembleNo(type, input, false)
}

/**
 * 안내판에 보여 줄 번호. buildInquiryNo 와 같은 형식이되, 아직 정해지지 않은 자리를 XX 로 둔다.
 *
 * 80 의뢰서의 계열(81·83·84)이 그 자리다 — 카운터는 종류 단위 하나라서 계열을 모른 채로도
 * 다음 순번은 정해지지만, 번호 전체는 계열을 골라야 확정된다. 그 자리를 아무 값으로나 채워
 * 보여 주면 「저 번호가 나온다」고 오해하게 된다.
 *
 * buildInquiryNo 와 달리 던지지 않는다 — 안내판은 값이 덜 찼을 때도 그려져야 한다.
 */
export function previewInquiryNo(
  type: InquiryType,
  input: { seq: number; year: number | string; issuedDate?: string },
): string {
  return assembleNo(type, input, true)
}

/**
 * 두 함수의 공통 몸통. preview 가 true 면 계열 자리를 XX 로 두고, 없는 값에 너그럽다.
 * 형식을 한 곳에만 두려고 합쳤다 — 두 벌이면 한쪽만 고쳐져 안내판과 실제 번호가 어긋난다.
 */
function assembleNo(
  type: InquiryType,
  input: { seq: number; year: number | string; series?: string | null; issuedDate?: string },
  preview: boolean,
): string {
  const yy = String(input.year).slice(2)
  const seq3 = pad(input.seq, 3)

  switch (type) {
    case 'req80': {
      // 안내판에서는 계열이 아직 정해지지 않았다 — 그 자리를 비워 둔다.
      if (preview) return `BY${yy}-XX-${seq3}`
      const s = input.series ?? ''
      if (!REQ80_SERIES.includes(s)) {
        throw new Error(`80 의뢰서는 장비 계열(81·83·84)이 필요합니다 (받은 값: ${s || '없음'})`)
      }
      return `BY${yy}-${s}-${seq3}`
    }
    case 'req20':
      return `BY${yy}-${REQ20_SERIES}-${seq3}`
    case 'hq_repair':
      return `239-${pad(input.seq, 4)}`
    case 'claim':
      return `ACCTK${yy}-${seq3}`
    case 'domestic_po':
      return `#PO-T4-${input.year}-${seq3}`
    case 'spare80': {
      const d = yymmdd(input.issuedDate ?? '')
      if (!d) {
        // 안내판은 날짜가 덜 찼어도 형식을 보여 준다. 실제 발급은 반드시 날짜를 받는다.
        if (preview) return `${seq3}-K______`
        throw new Error(`80 스페어파츠는 발행일(YYYY-MM-DD)이 필요합니다 (받은 값: ${input.issuedDate ?? '없음'})`)
      }
      return `${seq3}-K${d}`
    }
  }
}

/**
 * 상태 dot 색. 글자는 중립으로 두고 색은 dot 에만 준다(디자인 규칙).
 * 값은 전부 디자인 표에 있는 것이다 — 결재 화면의 STATUS_DOT 과 같은 층위로 골랐다.
 *
 * 키를 InquiryStatus 로 묶지 않고 string 으로 둔다 — 은퇴한 값(sent·waiting)의 색을
 * 남겨 두려는 것이다. 옛 행이 하나라도 있으면 dot 이 비지 않고 제 색으로 보인다.
 * 새로 그 값을 고를 길은 없다(EDITABLE_STATUSES 에 없다).
 */
export const INQUIRY_STATUS_DOT: Record<string, string> = {
  drafting: '#d1d5db',   // 아직 아무 일도 일어나지 않은 상태(결재의 '임시저장'과 같은 층위)
  done: '#16a34a',
  cancelled: '#9ca3af',
  // 은퇴한 값 — 고를 수는 없지만 색은 남긴다.
  sent: '#234ea2',
  waiting: '#f59e0b',
}

// ───────────────────────── TEMP-BULK-IMPORT ─────────────────────────
/**
 * 일괄 등록(임시 기능) 스위치. false 면 목록 화면의 진입 버튼이 사라진다.
 *
 * 지난 파일을 넣는 동안만 쓰는 기능이다. 등록이 끝나면 이렇게 지운다:
 *   1. 이 상수와 이 주석 블록을 지운다.
 *   2. components/inquiry/bulk/ 폴더를 통째로 지운다.
 *   3. app/inquiries/page.tsx 에서 TEMP-BULK-IMPORT 로 묶인 줄을 지운다(여섯 군데:
 *      import · NextNoBoard 의 rightSlot prop · 안내 줄 · bulkOpen 상태 · 버튼 · 모달 마운트).
 * 그 밖의 파일은 손대지 않았으므로 더 찾을 곳이 없다.
 */
export const BULK_IMPORT_ENABLED = true
// ─────────────────────────────────────────────────────────────────────
