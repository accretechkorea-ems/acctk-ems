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
  /**
   * 붙일 앞면이 **바로 앞 쪽이 아니다**. 돌려 읽느라 차례가 밀린 면이 엉뚱한 명함에
   * 붙어 회사명을 바꿔 버린 일이 있어(2026-11-25 실측), 떨어진 면은 합치지 않는다.
   */
  | 'orphan_back'
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
  orphan_back: '앞면과 떨어진 뒷면',
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
  | { index: number; ok: true; card_id: number; usage?: { input: number; output: number }; page?: number }
  | {
    index: number; ok: false; reason: BulkReason
    card_id?: number; name?: string | null; merged_into?: number
    usage?: { input: number; output: number }
    /** 글자가 거꾸로 놓여 못 읽었다 — 화면이 이 쪽만 돌려 다시 보낸다. */
    upside_down?: boolean
    /** 전체에서 **몇 쪽**인가(0부터). 실패 목록에 쪽 번호를 적는다. */
    page?: number
  }

/** 라우트의 응답. `last_card_id` 는 다음 요청이 `prev_card_id` 로 보내 줄 값이다. */
export type BulkResponse =
  | {
    ok: true; lines: BulkLine[]
    usage: { input: number; output: number }
    last_card_id: number | null
    /** 그 명함이 몇 쪽이었나 — 다음 요청이 그대로 돌려보낸다. */
    last_page?: number | null
  }
  | { ok: false; reason: string; max?: number }

/** 진행 집계 — 화면이 한 줄로 보여 준다. */
export type BulkTally = {
  done: number; saved: number; dup: number; failed: number
  /** 앞 명함의 뒷면으로 **합친** 쪽. */
  merged: number
  /** 사람 이름이 없어 담지 않은 쪽. */
  noPerson: number
  /** 빈 면·무늬만 있는 쪽. */
  empty: number
  /** 거꾸로 들어가 다시 읽은 쪽(화면이 센다). */
  flipped: number
}

export const EMPTY_TALLY: BulkTally =
  { done: 0, saved: 0, dup: 0, failed: 0, merged: 0, noPerson: 0, empty: 0, flipped: 0 }

/** 한 묶음의 결과를 집계에 더한다. */
export function addLines(tally: BulkTally, lines: readonly BulkLine[]): BulkTally {
  const t = { ...tally }
  for (const l of lines) {
    t.done += 1
    if (l.ok) { t.saved += 1; continue }
    if (l.reason === 'dup') t.dup += 1
    else if (l.reason === 'merged') t.merged += 1
    else if (l.reason === 'no_person' || l.reason === 'orphan_back') t.noPerson += 1
    else if (l.reason === 'empty') t.empty += 1
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

/**
 * **현지 문자**가 섞여 있나 (2026-11-25).
 * 한글만 보던 것을 한자·가나까지 넓혔다 — 일본 명함의 한자면이 로마자면과 합쳐질 때
 * 이름이 로마자로 남는 일이 있었다. 현지 문자가 본칸, 로마자가 영문 칸이다.
 *   · 한글 가-힣 · CJK 통합한자 一-鿿 · 히라가나 ぁ-ゟ · 가타카나 ゠-ヿ
 */
export const hasLocalScript = (s: string | null | undefined) =>
  /[가-힣㐀-鿿぀-ゟ゠-ヿ]/.test(String(s ?? ''))

/** 로마자만 있나(현지 문자가 없고 알파벳이 있다). */
export const isRomanOnly = (s: string | null | undefined) =>
  !hasLocalScript(s) && /[A-Za-z]/.test(String(s ?? ''))

/**
 * 견주기 전에 다듬는다 — 회사 표시(㈜·(주)·주식회사…)와 공백·기호를 턴다.
 * 「㈜가나정밀」과 「(주) 가나정밀」이 같은 것으로 보여야 한다.
 */
const norm = (s: string | null | undefined) =>
  String(s ?? '')
    // 우리말 표시
    .replace(/㈜|㈲|\(주\)|\（주\）|\(유\)|주식회사|유한회사/g, '')
    // 일본·중국 표시 — 한자면을 견주려면 이것도 떼야 한다(2026-11-25).
    .replace(/㈱|㈲|\(株\)|\（株\）|株式会社|株式會社|有限会社|有限會社/g, '')
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
 * **현지 문자 우선 교정** — 기존 줄의 이름·회사가 로마자뿐인데 이번 면에 현지 문자가
 * 있으면 그것을 앞으로 올리고, 밀려난 로마자는 영문 칸이 비어 있을 때만 그리로 옮긴다.
 *
 * 영문면이 먼저 스캔된 명함을 제자리로 돌려놓는 자리다. 기존 영문 칸에 이미 값이
 * 있으면 덮지 않는다 — 사람이 적어 둔 값을 지우지 않는다.
 * 2026-11-25에 한글만 보던 것을 **한자·가나까지** 넓혔다(일본 명함).
 */
export function localScriptPatch(
  prev: { name?: string | null; name_en?: string | null; company?: string | null; company_en?: string | null },
  next: { name?: string | null; company?: string | null },
): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const [ko, en] of [['name', 'name_en'], ['company', 'company_en']] as const) {
    const had = String(prev[ko] ?? '').trim()
    const got = String(next[ko] ?? '').trim()
    if (!isRomanOnly(had) || !hasLocalScript(got)) continue
    patch[ko] = got
    if (!String(prev[en] ?? '').trim()) patch[en] = had
  }
  return patch
}

/**
 * 두 면이 **같은 회사**인가 (2026-11-25).
 *
 * 같은 사람이 회사를 옮기거나 겸직하면 휴대폰·이메일이 같은 명함이 둘 나온다.
 * 전에는 그 둘을 한 장으로 합쳐 버렸다. 이제 **회사명이 둘 다 있고 서로 다르면**
 * 합치지 않는다. 한글면/영문면처럼 번역 관계인지는 `company`·`company_en` 네 값을
 * 서로 견주어 **하나라도 같으면** 같은 회사로 본다(모델에게 되묻지 않는다).
 *
 * 한쪽에 회사명이 없으면 **같다고 본다** — 뒷면에는 회사명이 없는 일이 흔하다.
 */
export function sameCompany(
  a: { company?: string | null; company_en?: string | null },
  b: { company?: string | null; company_en?: string | null },
): boolean {
  const left = [a.company, a.company_en].map(norm).filter(Boolean)
  const right = [b.company, b.company_en].map(norm).filter(Boolean)
  if (left.length === 0 || right.length === 0) return true
  return left.some(l => right.some(r => sameName(l, r)))
}

/**
 * 다듬은 회사명 둘이 같은 곳인가.
 *
 * 글자가 같거나 한쪽이 다른 쪽을 품으면 같다. 그 밖에 **앞 두 글자가 같으면**도
 * 같다고 본다 — 한자면의 「가나精密」과 한글면의 「가나정밀」을 이어 주기 위해서다
 * (2026-11-25 실측). 번호·메일이 이미 같고 **바로 앞 쪽**일 때만 쓰이는 판정이라,
 * 이 느슨함이 남의 명함을 삼키지는 않는다.
 */
function sameName(l: string, r: string): boolean {
  if (l === r || l.includes(r) || r.includes(l)) return true
  return l.length >= 2 && r.length >= 2 && l.slice(0, 2) === r.slice(0, 2)
}

/** 사건 이름 — business_card_events.event_type. */
export const EVENT_MERGED = 'card_merged_back'
export const EVENT_HANGUL = 'card_hangul_fixed'
export const EVENT_DELETED = 'card_deleted'

// ── 가져오기 묶음 ─────────────────────────────────────────────────────────
/**
 * 한 번의 여러 장 등록 = 묶음 하나(uuid). 새로 담은 줄에만 적는다 —
 * 합쳐진 뒷면과 이미 있던 명함은 **내 것이 아니므로** 적지 않는다.
 * 그래서 되돌리기가 「이번에 새로 담긴 것」만 지운다.
 * 칸은 db/business_cards_batch_20261125.sql 이 더한다.
 */
export function newBatchId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // 아주 오래된 브라우저 — 묶음 id 는 서로 다르기만 하면 된다.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = Math.floor(Math.random() * 16)
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** uuid 꼴인가 — 라우트가 받은 값을 믿기 전에 본다. */
export function isBatchId(v: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''))
}

/** 되돌리기 전에 묻는 말 — **무엇이 남는지**를 함께 적는다. */
export function undoQuestion(count: number): string {
  return `이번에 새로 담긴 ${count}건을 삭제합니다. 합쳐진 뒷면·기존 명함은 그대로입니다.`
}

// ── 뒤집힌 쪽 ─────────────────────────────────────────────────────────────
/**
 * 이 쪽을 **돌려서 다시 읽어 볼** 값어치가 있나 (2026-11-25에 좁혔다).
 *
 * 처음에는 「사람 이름 없음·빈 면」이면 무조건 다시 읽었다. 그런데 그 둘은 대개
 * **진짜 뒷면이거나 진짜 빈 면**이라, 돌려도 달라지지 않으면서 토큰만 두 배로 썼다.
 * 이제는 모델이 「글자가 거꾸로 보인다」고 한 쪽만 돌린다(text_upside_down).
 */
export function worthRetry(line: { ok: boolean; upside_down?: boolean }): boolean {
  return !line.ok && line.upside_down === true
}

/**
 * 돌려 읽은 결과를 **받아들일까**.
 *
 * 받아들이는 것은 담겼거나(ok) 기존 명함과 맞물린(dup·merged) 경우뿐이다.
 * 「이름 + 연락할 길이 있어야 한다」는 조건은 **라우트가** 본다(값을 들고 있는 쪽이다) —
 * 다시 읽기(retry)로 온 요청에서 그 조건을 못 넘기면 라우트가 담지 않고 no_person 으로
 * 돌려주므로, 여기서는 그 결과만 보면 된다.
 */
export function acceptRetry(line: { ok: boolean; reason?: BulkReason }): boolean {
  return line.ok || line.reason === 'dup' || line.reason === 'merged'
}

/** 담기 전에 — 이 값들이면 사람으로 쳐 준다(이름 + 연락할 길 하나). */
export function hasContact(row: {
  name?: string | null; mobile?: string | null; email?: string | null; phone?: string | null
}): boolean {
  const name = String(row.name ?? '').trim()
  if (!name) return false
  return [row.mobile, row.email, row.phone].some(v => String(v ?? '').trim() !== '')
}

// ── 누가 지울 수 있나 ─────────────────────────────────────────────────────
/**
 * 그 명함을 지울 수 있는 사람인가.
 *   · 본인이 등록한 줄 — 누구나 지운다(자기가 넣은 것을 치우는 길).
 *   · admin 이상 — 전체.
 * 판정은 라우트와 화면이 **같은 함수**를 쓴다. 화면이 보낸 값을 라우트가 다시 센다.
 */
export function canDeleteCard(
  me: { engineer_id?: number | null; permission_level?: string | null } | null | undefined,
  card: { engineer_id?: number | null },
): boolean {
  if (!me) return false
  const level = String(me.permission_level ?? '')
  if (level === 'admin' || level === 'superadmin') return true
  const mine = Number(me.engineer_id ?? 0)
  return mine > 0 && Number(card.engineer_id ?? 0) === mine
}

/** 「권한 없는 N건은 제외됩니다」 — 0이면 빈 글자(안내를 띄우지 않는다). */
export function skippedNotice(count: number): string {
  return count > 0 ? `권한 없는 ${count}건은 제외됩니다` : ''
}

/** 선택 띠의 왼쪽 글자. */
export function selectionTitle(count: number): string {
  return `${count}건 선택`
}

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
  if (t.empty > 0) parts.push(`빈 면 ${t.empty}`)
  if (t.flipped > 0) parts.push(`뒤집어 다시 읽음 ${t.flipped}`)
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
