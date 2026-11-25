/**
 * 문구함의 규칙 한 곳 (2026-11-25).
 *
 * 자주 쓰는 글을 담아 두고 **커서 자리에 끼워 넣는다**. 글 안의 {수신인}·{장비} 같은
 * 자리표는 끼울 때 그 화면의 값으로 바뀐다.
 *
 * 화면(문구 고르기·저장 창·내 문구 탭)·라우트·하네스가 같은 값을 쓴다 —
 * 서버 전용 코드는 넣지 않는다. 표는 db/text_snippets_20261125.sql 이 만든다.
 */

// ── 용도 ──────────────────────────────────────────────────────────────────
/** 어디에 끼우는 글인가. 'common' 은 어느 자리에서나 보인다. */
export const SNIPPET_KINDS = [
  'mail_body', 'mail_subject', 'service_content', 'service_note', 'common',
] as const
export type SnippetKind = (typeof SNIPPET_KINDS)[number]

export const KIND_LABEL: Record<SnippetKind, string> = {
  mail_body: '메일 본문',
  mail_subject: '메일 제목',
  service_content: '서비스 내용',
  service_note: '기타사항',
  common: '공통',
}

export function isSnippetKind(v: unknown): v is SnippetKind {
  return (SNIPPET_KINDS as readonly string[]).includes(String(v))
}

/** 어느 자리에서 보일 용도들 — 그 자리의 용도 + 공통. */
export function visibleKinds(kind: SnippetKind): SnippetKind[] {
  return kind === 'common' ? ['common'] : [kind, 'common']
}

// ── 범위 ──────────────────────────────────────────────────────────────────
export const SNIPPET_SCOPES = ['private', 'shared'] as const
export type SnippetScope = (typeof SNIPPET_SCOPES)[number]

export const SCOPE_LABEL: Record<SnippetScope, string> = { private: '개인', shared: '공용' }
/** 저장 창의 세그먼트 글자(시안 그대로). */
export const SCOPE_PICK_LABEL: Record<SnippetScope, string> = { private: '개인용', shared: '공용 (전사)' }

export function isSnippetScope(v: unknown): v is SnippetScope {
  return (SNIPPET_SCOPES as readonly string[]).includes(String(v))
}

/** 공용을 고르면 아래에 한 줄. */
export const SHARED_NOTICE = '공용은 모든 직원에게 보이고, 나와 관리자만 고칠 수 있습니다.'

// ── 한 줄 ─────────────────────────────────────────────────────────────────
export type Snippet = {
  snippet_id: number
  title: string
  body: string
  kind: SnippetKind
  scope: SnippetScope
  owner_engineer_id: number
  division?: string | null
  created_at?: string
  updated_at?: string
  /** 만든 사람 이름 — 라우트가 붙여 준다(공용 문구에 누가 만들었는지 보이게). */
  owner_name?: string | null
}

export const TITLE_MAX = 60
export const BODY_MAX = 2000

/** 담을 수 있나 — 못 담는 까닭을 돌려준다(없으면 null). */
export function snippetBlockedReason(form: { title?: string; body?: string }): string | null {
  if (!String(form.title ?? '').trim()) return '제목을 입력해주세요'
  if (!String(form.body ?? '').trim()) return '내용을 입력해주세요'
  if (String(form.title).trim().length > TITLE_MAX) return `제목은 ${TITLE_MAX}자까지입니다`
  if (String(form.body).length > BODY_MAX) return `내용은 ${BODY_MAX}자까지입니다`
  return null
}

// ── 자리표 ────────────────────────────────────────────────────────────────
/**
 * 글 안에 쓸 수 있는 **자리표**. 끼울 때 그 화면의 값으로 바뀐다.
 * 값이 없는 자리표는 **그대로 남긴다** — 빈 글자로 지우면 「님, 안녕하세요」처럼
 * 말이 깨지고, 사람이 무엇을 채워야 하는지도 알 수 없다.
 */
export const SNIPPET_VARS = [
  '수신인', '직급', '회사', '사업장', '장비', '품명', '견적번호', '작성자', '오늘',
] as const
export type SnippetVar = (typeof SNIPPET_VARS)[number]

export type SnippetCtx = Partial<Record<SnippetVar, string | null | undefined>>

/** 내 문구 탭 아래의 안내. */
export const VAR_HELP_HEAD = '치환 변수'
export const VAR_HELP_TAIL = '삽입할 때 그 화면의 값으로 바뀝니다. 값이 없으면 그대로 남습니다.'

/** 자리표를 그 화면의 값으로 바꾼다. 값이 없으면 **그대로 둔다**. */
export function applyVars(body: string, ctx: SnippetCtx = {}): string {
  let out = String(body ?? '')
  for (const name of SNIPPET_VARS) {
    const v = String(ctx[name] ?? '').trim()
    if (!v) continue
    out = out.split(`{${name}}`).join(v)
  }
  return out
}

/** 그 글이 쓰는 자리표들(안내·미리보기에 쓴다). */
export function varsIn(body: string): SnippetVar[] {
  return SNIPPET_VARS.filter(v => String(body ?? '').includes(`{${v}}`))
}

// ── 끼워 넣기 ─────────────────────────────────────────────────────────────
/**
 * 커서 자리에 글을 끼운 결과. **기존 글은 지우지 않는다** — 고른 범위가 있으면 그 자리를
 * 바꾸고, 없으면 커서 자리에 넣는다. 돌려주는 caret 은 끼운 글 **뒤**다.
 */
export function spliceAt(
  value: string, start: number, end: number, text: string,
): { value: string; caret: number } {
  const src = String(value ?? '')
  const from = Math.max(0, Math.min(src.length, Math.min(start, end)))
  const to = Math.max(0, Math.min(src.length, Math.max(start, end)))
  const next = src.slice(0, from) + text + src.slice(to)
  return { value: next, caret: from + text.length }
}

/** 칸(textarea·input)의 커서 자리에 끼운다. 다음 값을 돌려준다(상태는 부르는 쪽이 넣는다). */
export function insertAtCursor(
  el: HTMLTextAreaElement | HTMLInputElement | null | undefined,
  text: string,
): string {
  if (!el) return text
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  const { value, caret } = spliceAt(el.value, start, end, text)
  // 커서는 **다음 프레임**에 옮긴다 — React 가 값을 다시 그린 뒤여야 자리가 남는다.
  if (typeof window !== 'undefined') {
    window.requestAnimationFrame(() => {
      try { el.setSelectionRange(caret, caret); el.focus() } catch { /* 떠난 칸이면 그만둔다 */ }
    })
  }
  return value
}

// ── 고르기 목록 ───────────────────────────────────────────────────────────
/** 한 줄을 목록에서 찾는 글자 — 제목과 내용 둘 다 본다. */
export function matchSnippet(s: Snippet, query: string): boolean {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return true
  return `${s.title} ${s.body}`.toLowerCase().includes(q)
}

/** 목록 한 줄의 미리보기 — 줄바꿈을 공백으로 눌러 한 줄로 만든다. */
export function oneLine(body: string, max = 120): string {
  const flat = String(body ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** 내 것인가. */
export function isMine(s: Snippet, meId: number | null | undefined): boolean {
  return Number(meId ?? 0) > 0 && s.owner_engineer_id === Number(meId)
}

/**
 * 고치고 지울 수 있나 — 내 것이거나, 공용이면서 내가 admin 이상일 때.
 * 라우트와 화면이 **같은 함수**를 쓴다(화면이 보낸 값을 라우트가 다시 센다).
 */
export function canEditSnippet(
  me: { engineer_id?: number | null; permission_level?: string | null } | null | undefined,
  s: Snippet,
): boolean {
  if (!me) return false
  if (isMine(s, me.engineer_id)) return true
  const level = String(me.permission_level ?? '')
  return s.scope === 'shared' && (level === 'admin' || level === 'superadmin')
}

/** 용도별로 묶는다(내 문구 탭). 용도 차례는 SNIPPET_KINDS 그대로. */
export function groupByKind(list: readonly Snippet[]): { kind: SnippetKind; rows: Snippet[] }[] {
  return SNIPPET_KINDS
    .map(kind => ({ kind, rows: list.filter(s => s.kind === kind) }))
    .filter(g => g.rows.length > 0)
}

/** 묶음 머리줄 — 「메일 본문 · 3」. */
export function groupLabel(kind: SnippetKind, count: number): string {
  return `${KIND_LABEL[kind]} · ${count}`
}

/** 공용을 내 것으로 복사할 때의 제목(그대로 쓴다 — 사람이 고칠 수 있다). */
export function copyTitle(title: string): string {
  return String(title ?? '').trim()
}

/** 지우기 전에 묻는 말. */
export function deleteQuestion(title: string): string {
  return `「${String(title ?? '').trim()}」 문구를 지웁니다. 되돌릴 수 없습니다.`
}

// ── 라우트와 화면이 함께 쓰는 말 ─────────────────────────────────────────
export const SCHEMA_MESSAGE =
  '문구함을 쓰려면 db/text_snippets_20261125.sql 을 먼저 적용해야 합니다'
export const FORBIDDEN_MESSAGE = '이 문구를 고칠 권한이 없습니다'
export const PICK_LABEL = '문구 ▾'
export const SAVE_CURRENT_LABEL = '＋ 지금 내용을 문구로 저장'
export const OTHER_KINDS_LABEL = '다른 용도 문구 전체 보기 ›'
export const INSERT_HINT = '고르면 커서 자리에 끼워 넣습니다. 기존 글은 지우지 않습니다.'
export const EMPTY_MESSAGE = '담아 둔 문구가 없습니다'
