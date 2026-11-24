/**
 * 명함 **여러 장 등록**의 규칙 한 곳 (2026-11-24).
 *
 * 라우트(app/api/cards/ocr-bulk)·화면(components/cards/BulkImportModal)·하네스가
 * 같은 값을 본다. 숫자와 문구가 세 군데로 갈리지 않게 한다.
 *
 * 화면도 함께 쓰므로 **서버 전용 코드를 넣지 않는다**(모델 호출은 lib/cardOcrServer.ts).
 */

/**
 * 한 요청에 보내는 파일 수.
 *
 * Vercel 함수의 제한 시간 때문이다. 한 장에 3~6초가 걸리므로 셋을 동시에 읽어도 한
 * 요청이 그 안에서 끝난다. 더 묶으면 한 요청이 통째로 죽으면서 그 안의 성공분까지
 * 잃는다 — 나눠 보내면 앞의 묶음은 이미 담긴 뒤다.
 */
export const MAX_PER_REQUEST = 3

/** 일괄로 담은 줄의 방식. db/business_cards_bulk_20261124.sql 이 CHECK 에 넣어 준다. */
export const BULK_METHOD = 'bulk'

/** 담지 못한 까닭. */
export type BulkReason =
  /** 읽힌 번호·메일이 이미 있는 명함과 같다. */
  | 'dup'
  /** 이름도 회사도 못 읽었다 — 빈 줄을 쌓지 않는다. */
  | 'empty'
  /** 앞 명함의 **뒷면**이었다 — 그 명함의 빈 칸을 채우고 넘어갔다. */
  | 'merged'
  /** 사람 이름이 없는 면(회사명만·로고만). 담지 않고 목록에 남긴다. */
  | 'no_person'
  | 'no_key' | 'no_file' | 'too_big' | 'bad_type' | 'parse' | 'api'
  /** 읽기는 됐는데 담다가 실패했다. */
  | 'save'
  /**
   * 표가 아직 'bulk' 를 받지 않는다(CHECK 제약, 23514).
   * db/business_cards_bulk_20261124.sql 을 돌리기 전에는 **한 장도 담기지 않는다** —
   * 그냥 「담는 중 오류」로 두면 무엇을 해야 하는지 알 수 없어 따로 뗀다.
   */
  | 'schema'

/** 적용해야 하는 파일 — 화면이 그대로 보여 준다. */
export const BULK_SQL_FILE = 'db/business_cards_bulk_20261124.sql'

/** 사람에게 보여 줄 까닭. */
export const BULK_REASON_LABEL: Record<BulkReason, string> = {
  dup: '이미 있는 명함',
  empty: '이름·회사를 못 읽음',
  merged: '앞 명함의 뒷면 — 합침',
  no_person: '사람 이름 없음',
  no_key: 'OCR 설정 없음',
  no_file: '파일을 받지 못함',
  too_big: '파일이 너무 큼',
  bad_type: '읽을 수 없는 형식',
  parse: '글자를 읽지 못함',
  api: '읽는 중 오류',
  save: '담는 중 오류',
  schema: `표 손질이 먼저 필요합니다 — ${BULK_SQL_FILE}`,
}

/**
 * 한 장의 결과. index 는 **그 요청 안에서의 차례**(0‥2)다.
 *   · `card_id` — 담긴 명함, 또는 합쳐진/중복인 기존 명함
 *   · `merged_into` — 이 쪽이 **합쳐 들어간** 명함(뒷면일 때)
 *   · `usage` — 그 쪽 한 장의 토큰
 */
export type BulkLine =
  | { index: number; ok: true; card_id: number; usage?: { input: number; output: number } }
  | {
    index: number; ok: false; reason: BulkReason
    card_id?: number; name?: string | null; merged_into?: number
    usage?: { input: number; output: number }
  }

/** 라우트의 응답. `last_card_id` 는 다음 요청이 `prev_card_id` 로 보내 줄 값이다. */
export type BulkResponse =
  | {
    ok: true; lines: BulkLine[]
    usage: { input: number; output: number }
    last_card_id: number | null
  }
  | { ok: false; reason: string; max?: number }

/** 진행 집계 — 화면이 한 줄로 보여 준다. */
export type BulkTally = {
  done: number; saved: number; dup: number; failed: number
  /** 앞 명함의 뒷면으로 **합친** 쪽. */
  merged: number
  /** 사람 이름이 없어 담지 않은 쪽. */
  noPerson: number
}

export const EMPTY_TALLY: BulkTally =
  { done: 0, saved: 0, dup: 0, failed: 0, merged: 0, noPerson: 0 }

/** 한 묶음의 결과를 집계에 더한다. */
export function addLines(tally: BulkTally, lines: readonly BulkLine[]): BulkTally {
  const t = { ...tally }
  for (const l of lines) {
    t.done += 1
    if (l.ok) { t.saved += 1; continue }
    if (l.reason === 'dup') t.dup += 1
    else if (l.reason === 'merged') t.merged += 1
    else if (l.reason === 'no_person') t.noPerson += 1
    else t.failed += 1
  }
  return t
}

// ── 쪽을 어떻게 다룰지 가른다 ─────────────────────────────────────────────
//
// 실제 스캐너 PDF 35쪽에서 21건이 담겼는데 그중 5건이 쓰레기였다(2026-11-24).
//   · 로고·계좌번호·예금주만 있는 **뒷면**이 새 명함이 됐다(예금주를 사람 이름으로,
//     계좌번호를 전화로 읽었다).
//   · **영문면이 한글면보다 앞**에 오면 이름·회사가 로마자로 굳고, 뒤따르는 한글면은
//     중복으로 버려졌다.
//   · 사람 이름 없이 **회사명만** 있는 면이 이름 칸에 회사명을 넣고 담겼다.
// 아래 규칙은 그 셋을 막는다. 쪽을 **차례대로** 보며 직전 명함과 견준다.

/** 한글이 섞여 있나. */
export const hasHangul = (s: string | null | undefined) => /[가-힣]/.test(String(s ?? ''))

/** 로마자만 있나(한글이 없고 알파벳이 있다). */
export const isRomanOnly = (s: string | null | undefined) =>
  !hasHangul(s) && /[A-Za-z]/.test(String(s ?? ''))

/**
 * 견주기 전에 다듬는다 — 회사 표시(㈜·(주)·주식회사…)와 공백·기호를 턴다.
 * 「㈜가나정밀」과 「(주) 가나정밀」이 같은 것으로 보여야 한다.
 */
const norm = (s: string | null | undefined) =>
  String(s ?? '')
    .replace(/㈜|㈲|\(주\)|\（주\）|\(유\)|주식회사|유한회사/g, '')
    .replace(/[\s()|·.,-]/g, '')
    .toLowerCase()

/**
 * 이 면은 **사람이 없는 면**인가 — 새 명함으로 담지 않는다.
 *   ⓐ 모델이 뒷면이라고 했다
 *   ⓑ 사람 이름이 없다
 *   ⓒ 이름 칸에 회사명이 들어왔다(둘이 같다)
 */
export function isNoPerson(
  card: { name?: string | null; company?: string | null },
  back: boolean,
): boolean {
  if (back) return true
  const name = String(card.name ?? '').trim()
  if (!name) return true
  const company = String(card.company ?? '').trim()
  return company !== '' && norm(name) === norm(company)
}

/**
 * 사람이 없는 이 면을 **직전 명함의 뒷면으로 볼 수 있나** (2026-11-24 실측에서 더했다).
 *
 * 처음에는 「사람이 없으면 무조건 앞 명함에 붙인다」로 두었더니, 사람 이름이 없는
 * **남의 명함**(부동산 사무실처럼 회사명과 전화만 있는 단면)이 앞 명함에 붙어
 * 전화·주소를 덮어썼다. 뒷면과 남의 명함을 가르는 것은 **제 연락처가 있는가**다.
 *
 *   · 뒷면 — 로고·슬로건·계좌번호뿐이라 **제 연락처가 없다**. 회사명이 영문으로만
 *     적혀 있어 앞면의 한글 회사명과 글자가 달라도 뒷면이다.
 *   · 남의 명함 — 회사명이 다르고 **제 전화·휴대폰·이메일·홈페이지를 가진다**.
 *
 * 그래서: 회사명이 앞 명함과 이어지면 붙이고, 아니면 **연락처가 하나도 없을 때만** 붙인다.
 */
export function canMergeBack(
  prev: { company?: string | null; company_en?: string | null },
  row: { company?: string | null; mobile?: string | null; phone?: string | null; email?: string | null; website?: string | null },
): boolean {
  const company = norm(row.company)
  if (company) {
    for (const side of [prev.company, prev.company_en]) {
      const had = norm(side)
      if (!had) continue
      if (had === company || had.includes(company) || company.includes(had)) return true
    }
  }
  // 회사명이 이어지지 않는다 — 제 연락처가 하나라도 있으면 **남의 명함**이다.
  const own = [row.mobile, row.phone, row.email, row.website]
    .some(v => String(v ?? '').trim() !== '')
  return !own
}

/** 빈 칸만 채우는 조각 — 이미 든 값은 덮지 않는다. */
export function fillBlanks(
  prev: Record<string, unknown>,
  next: Record<string, string | null>,
  fields: readonly string[],
): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const f of fields) {
    const have = String(prev[f] ?? '').trim()
    const got = String(next[f] ?? '').trim()
    if (!have && got) patch[f] = got
  }
  return patch
}

/**
 * **한글 우선 교정** — 기존 줄의 이름·회사가 로마자뿐인데 이번 면에 한글이 있으면
 * 한글을 앞으로 올리고, 밀려난 로마자는 영문 칸이 비어 있을 때만 그리로 옮긴다.
 *
 * 영문면이 먼저 스캔된 명함을 제자리로 돌려놓는 자리다. 기존 영문 칸에 이미 값이
 * 있으면 덮지 않는다 — 사람이 적어 둔 값을 지우지 않는다.
 */
export function hangulPatch(
  prev: { name?: string | null; name_en?: string | null; company?: string | null; company_en?: string | null },
  next: { name?: string | null; company?: string | null },
): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const [ko, en] of [['name', 'name_en'], ['company', 'company_en']] as const) {
    const had = String(prev[ko] ?? '').trim()
    const got = String(next[ko] ?? '').trim()
    if (!isRomanOnly(had) || !hasHangul(got)) continue
    patch[ko] = got
    if (!String(prev[en] ?? '').trim()) patch[en] = had
  }
  return patch
}

/** 사건 이름 — business_card_events.event_type. */
export const EVENT_MERGED = 'card_merged_back'
export const EVENT_HANGUL = 'card_hangul_fixed'

// ── 읽기 비용 ─────────────────────────────────────────────────────────────
/**
 * 1M 토큰당 원. claude-haiku-5-5 의 $0.10 / $0.50 를 1,400원/달러로 환산한 값이다.
 * 환율·단가가 바뀌면 **이 둘만** 고친다.
 */
export const WON_PER_MTOK = { input: 140, output: 700 } as const

/** 읽기 비용(원). 소수점은 버린다 — 「약 N원」으로만 말한다. */
export function costWon(usage: { input: number; output: number }): number {
  const won = (usage.input * WON_PER_MTOK.input + usage.output * WON_PER_MTOK.output) / 1_000_000
  return Math.round(won)
}

/** 요약 마지막 줄. */
export function costLabel(usage: { input: number; output: number }): string {
  return `읽기 비용 약 ${costWon(usage).toLocaleString('ko-KR')}원`
}

/** 「137 / 300」. */
export function progressLabel(done: number, total: number): string {
  return `${done} / ${total}`
}

/** 0‥100. 총 개수를 모르면 0. */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((done / total) * 100))
}

/** 끝났을 때 한 줄. 0인 항목은 적지 않는다 — 줄이 길어지면 읽히지 않는다. */
export function summaryLabel(t: BulkTally): string {
  const parts = [`등록 ${t.saved}`, `중복 ${t.dup}`]
  if (t.merged > 0) parts.push(`뒷면 합침 ${t.merged}`)
  if (t.noPerson > 0) parts.push(`사람 이름 없음 ${t.noPerson}`)
  parts.push(`실패 ${t.failed}`)
  return parts.join(' · ')
}

/** 진행 중에 닫으려 할 때 묻는 말 — 이미 담긴 것은 남는다는 사실을 먼저 적는다. */
export function stopQuestion(saved: number): string {
  return `지금까지 읽힌 ${saved}건은 저장되어 있습니다. 중단할까요?`
}

/** 파일을 세 개씩 끊는다. */
export function chunk<T>(items: readonly T[], size = MAX_PER_REQUEST): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
