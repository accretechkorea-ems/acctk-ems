// 결재 함 구성과 목록 표시 규칙 — 아마란스 양식에 맞춘 이름·분류·형식.
//
// 화면(app/approval/page.tsx)이 쓰는 순수 함수만 둔다. 판정·라우트는 건드리지 않는다 —
// 함은 이름과 묶는 방식만 바뀌었고, 어떤 문서가 어느 함에 들어가는지는 지금까지와 같은 API 응답 그대로다.
//
// 보는 자리는 두 값으로 정해진다.
//   source — 어디서 읽는가(라우트 그대로): inbox · outbox · done · cc · all
//   scope  — 그 안에서 무엇만 보는가: 모든문서 · 진행문서 · 종결문서 (+ 미결 = 반려·회수)
// 왼쪽 함 목록의 항목 하나가 곧 (source, scope) 한 쌍이고, 본문 오른쪽 위 라디오는 같은 값의
// scope 만 바꾼다. 그래서 왼쪽으로 가든 라디오로 가든 같은 자리에 닿는다 — 상태가 하나뿐이다.
//
//   상신/보관함   상신문서       (outbox, 모든문서)
//                 미결문서       (outbox, 미결 = 반려·회수)
//   결재수신함    미결문서       (inbox,  모든문서) — 내 차례라 늘 진행 중이다
//                 기결문서       (done,   모든문서)
//                 기결문서(진행) (done,   진행문서)
//                 기결문서(종결) (done,   종결문서)
//                 수신참조문서   (cc,     모든문서)
//   전체          (all, 모든문서) — approvals 권한자
//
// 아마란스의 결재분류함(예결·후결·반려·보류·전결)은 두지 않는다 — 우리 결재선 개념과 다르다.

import type { ApprovalDoc } from './DocDetail'
import type { ProgressPerson } from './ApprovalTable'
import { progressCount } from '@/lib/approval/tableCells'
import { closedAtOf } from '@/lib/approval/doneBox'
import { DOC_TYPES, DOC_TYPE_KEYS } from '@/lib/approval/docTypes'

/** 기결함 세 항목의 건수 — 서버(app/api/approval/done)가 세어 준다. 못 센 항목은 null. */
export type DoneCounts = { all: number | null; open: number | null; closed: number | null }

/** 목록을 읽어 오는 곳. 라우트의 box 값과 같은 이름이다. */
export type Source = 'inbox' | 'outbox' | 'done' | 'cc' | 'all'

/** 그 안에서 무엇만 보는가. */
export type Scope = 'all' | 'open' | 'closed' | 'unfinished'

export type BoxItem = {
  /** 항목 식별자(그리기·검사용). 주소에는 source·scope 를 싣는다. */
  key: string
  label: string
  source: Source
  scope: Scope
  /** 비었을 때 안내 */
  empty: string
}

export type BoxGroup = {
  /** 접힘 상태를 저장할 때 쓰는 이름. 화면에 보이지 않는 값이라 한글을 쓰지 않는다. */
  key: string
  /** 그룹 제목. null 이면 제목 없이 항목만 둔다(전체) — 접을 제목이 없다. */
  title: string | null
  items: BoxItem[]
}

export const BOX_GROUPS: BoxGroup[] = [
  {
    key: 'sent',
    title: '상신/보관함',
    items: [
      { key: 'outbox', label: '상신문서', source: 'outbox', scope: 'all', empty: '올린 문서가 없습니다' },
      { key: 'outbox_unfinished', label: '미결문서', source: 'outbox', scope: 'unfinished', empty: '다시 손볼 문서가 없습니다' },
    ],
  },
  {
    key: 'received',
    title: '결재수신함',
    items: [
      { key: 'inbox', label: '미결문서', source: 'inbox', scope: 'all', empty: '결재할 문서가 없습니다' },
      { key: 'done', label: '기결문서', source: 'done', scope: 'all', empty: '처리한 문서가 없습니다' },
      { key: 'done_open', label: '기결문서(진행)', source: 'done', scope: 'open', empty: '진행 중인 문서가 없습니다' },
      { key: 'done_closed', label: '기결문서(종결)', source: 'done', scope: 'closed', empty: '종결된 문서가 없습니다' },
      { key: 'cc', label: '수신참조문서', source: 'cc', scope: 'all', empty: '참조된 문서가 없습니다' },
    ],
  },
  {
    // 제목이 없는 묶음이라 접을 것도 없다(누를 제목이 없다).
    key: 'etc',
    title: null,
    items: [
      { key: 'all', label: '전체', source: 'all', scope: 'all', empty: '문서가 없습니다' },
    ],
  },
]

export const BOX_ITEMS: BoxItem[] = BOX_GROUPS.flatMap(g => g.items)

/** 그 함이 어느 묶음에 속하는지. 지금 고른 함을 감추지 않기 위해 쓴다. */
export const groupKeyOfItem = (itemKey: string): string | null =>
  BOX_GROUPS.find(g => g.items.some(i => i.key === itemKey))?.key ?? null

// ── 묶음 접힘 저장 ───────────────────────────────────────────────────
// 계정별로 저장한다 — 같은 컴퓨터를 여러 사람이 쓰는 현장이 있다.
// 읽기·쓰기 모두 try/catch 로 감싼다(비공개 모드·저장소 차단). 실패하면 기본값(모두 펼침)으로
// 두고 접기 자체는 그대로 동작한다 — 사이드바 접힘 저장과 같은 규칙이다.

const GROUP_KEYS = BOX_GROUPS.map(g => g.key)

export const boxGroupsStorageKey = (engineerId: number): string => `approval:boxgroups:${engineerId}`

/** 접혀 있는 묶음 이름들. 저장된 적이 없거나 값이 깨졌으면 빈 목록(모두 펼침). */
export function readCollapsedGroups(engineerId: number): string[] {
  try {
    const raw = localStorage.getItem(boxGroupsStorageKey(engineerId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // 모르는 이름은 버린다 — 묶음 구성이 바뀌어도 옛 값에 걸려 이상하게 접히지 않는다.
    return parsed.filter((k): k is string => typeof k === 'string' && GROUP_KEYS.includes(k))
  } catch {
    return []
  }
}

export function writeCollapsedGroups(engineerId: number, keys: string[]): void {
  try {
    localStorage.setItem(boxGroupsStorageKey(engineerId), JSON.stringify(keys))
  } catch {
    /* 저장 못 해도 접기는 동작한다 */
  }
}

/** 목록을 읽는 주소. */
export const SOURCE_API: Record<Source, string> = {
  inbox: '/api/approval?box=inbox',
  outbox: '/api/approval?box=outbox',
  done: '/api/approval/done',
  cc: '/api/approval?box=cc',
  all: '/api/approval?box=all',
}

/** 서버가 기간·종류·페이지를 걸어 주는 함. 그 밖은 한 벌을 받아 화면에서 거른다. */
export const SERVER_FILTERED: { source: Source; scope: Scope } = { source: 'done', scope: 'closed' }

export const isServerFiltered = (source: Source, scope: Scope): boolean =>
  source === SERVER_FILTERED.source && scope === SERVER_FILTERED.scope

/**
 * 목록 주소를 만든다.
 *
 * 기결문서(종결)만 서버가 **기간·종류를 limit 보다 먼저** 걸고 페이지로 끊어 준다 — 그 함은
 * 「종결된 내 문서」 전부라서 한 벌로 받으면 상한에 걸린다(app/api/approval/done/route.ts 머리말).
 * 나머지 함은 지금까지처럼 한 벌을 받아 화면에서 거른다 — 주소도 지금 것 그대로다.
 */
export function listUrl(
  source: Source,
  scope: Scope,
  opts?: { from?: string; to?: string; docType?: string | null; page?: number; size?: number },
): string {
  const base = SOURCE_API[source]
  if (source !== 'done') return base
  const q = new URLSearchParams({ scope })
  if (isServerFiltered(source, scope)) {
    if (opts?.from) q.set('from', opts.from)
    if (opts?.to) q.set('to', opts.to)
    if (opts?.docType) q.set('doc_type', opts.docType)
    if (opts?.page) q.set('page', String(opts.page))
    if (opts?.size) q.set('size', String(opts.size))
  }
  return `${base}?${q.toString()}`
}

// ── 문서 종류 선택 ──────────────────────────────────────────────────
//
// 목록은 **등록표(lib/approval/docTypes.ts)에서 읽는다** — 화면에 유형 이름을 적지 않는다.
// 새 유형을 등록표에 더하면 이 선택지에도 자동으로 나온다.

/** 종류 선택에서 「전체」를 뜻하는 값. 등록표의 key 와 섞이지 않는 문자열이다. */
export const DOC_TYPE_ALL = 'all'

/** 선택지 — 「전체」 + 등록된 종류. */
export const docTypeOptions = (): { value: string; label: string }[] => [
  { value: DOC_TYPE_ALL, label: '전체' },
  ...DOC_TYPE_KEYS.map(k => ({ value: k, label: DOC_TYPES[k].label })),
]

/** 선택값을 서버·필터에 넘길 모양으로. 「전체」와 모르는 값은 null(= 거르지 않는다). */
export const docTypeFilter = (value: string): string | null =>
  value && value !== DOC_TYPE_ALL && Object.prototype.hasOwnProperty.call(DOC_TYPES, value) ? value : null

/** 처음 열었을 때 보는 자리 — 내 차례(결재수신함 · 미결문서). */
export const DEFAULT_VIEW: { source: Source; scope: Scope } = { source: 'inbox', scope: 'all' }

/** 본문 오른쪽 위 라디오. 미결(반려·회수)은 함 자체가 뜻을 정하므로 여기 두지 않는다. */
export const SCOPES: { value: Scope; label: string }[] = [
  { value: 'all', label: '모든문서' },
  { value: 'open', label: '진행문서' },
  { value: 'closed', label: '종결문서' },
]

/**
 * 라디오를 보여줄 자리인가.
 *   · 미결문서(inbox) — 내 차례인 문서는 늘 진행 중이라 고를 것이 없다.
 *   · 미결문서(outbox, 반려·회수) — 함 이름이 곧 상태다.
 */
export const showsScopeRadio = (source: Source, scope: Scope): boolean =>
  source !== 'inbox' && scope !== 'unfinished'

// ── 주소 ────────────────────────────────────────────────────────────

const SOURCES: Source[] = ['inbox', 'outbox', 'done', 'cc', 'all']

/** 옛 주소의 하위 구분 값 → 지금의 scope. */
const LEGACY_SCOPE: Record<string, Scope> = {
  progress: 'open', complete: 'closed', unfinished: 'unfinished',
  open: 'open', closed: 'closed', all: 'all',
}

/**
 * 주소 → 보는 자리. 옛 주소를 모두 받아 준다(알림·즐겨찾기가 들고 있을 수 있다).
 *   ?tab=inbox            → 결재수신함 미결문서
 *   ?tab=inbox&sub=done   → 기결문서
 *   ?tab=outbox&sub=unfinished / ?box=outbox&view=unfinished → 상신함 미결문서
 * 모르는 값은 기본 자리로 돌린다.
 */
export function parseView(params: {
  box?: string | null; tab?: string | null; view?: string | null; sub?: string | null
}): { source: Source; scope: Scope } {
  const raw = params.box ?? params.tab ?? null
  const sub = params.view ?? params.sub ?? null

  // 옛 이름 — 결재함(inbox)의 「완료」 하위 탭은 지금의 기결문서다.
  if (raw === 'inbox' || raw === 'pending' || raw === null) {
    if (sub === 'done') return { source: 'done', scope: 'all' }
    return { source: 'inbox', scope: 'all' }
  }
  if (raw === 'done') {
    return { source: 'done', scope: LEGACY_SCOPE[sub ?? 'all'] ?? 'all' }
  }
  if ((SOURCES as string[]).includes(raw)) {
    const source = raw as Source
    const scope = LEGACY_SCOPE[sub ?? 'all'] ?? 'all'
    // 미결(반려·회수)은 상신함에만 뜻이 있다.
    if (scope === 'unfinished' && source !== 'outbox') return { source, scope: 'all' }
    return { source, scope }
  }
  return { ...DEFAULT_VIEW }
}

/** 보는 자리 → 주소 뒷부분. 기본 자리는 빈 문자열(주소를 깨끗이 둔다). */
export function viewQuery(source: Source, scope: Scope): string {
  const q = new URLSearchParams()
  if (source !== DEFAULT_VIEW.source) q.set('box', source)
  if (scope !== 'all') q.set('view', scope)
  return q.toString()
}

/** 왼쪽 목록에서 지금 자리로 표시할 항목. 딱 맞는 것이 없으면 같은 함의 「모든문서」를 짚는다. */
export function activeItem(source: Source, scope: Scope): BoxItem {
  return BOX_ITEMS.find(i => i.source === source && i.scope === scope)
    ?? BOX_ITEMS.find(i => i.source === source)
    ?? BOX_ITEMS[0]
}

// ── 분류 ────────────────────────────────────────────────────────────

/** scope 에 맞는 문서인가. */
export function matchesScope(scope: Scope, doc: ApprovalDoc): boolean {
  if (scope === 'all') return true
  if (scope === 'open') return doc.status === '진행중'
  if (scope === 'closed') return doc.status !== '진행중'
  // 미결 — 신청자가 다시 손봐야 하는 건. 폐기한 문서는 손볼 일이 없어 여기서 빠진다
  // (상신문서·기결함·전체함에는 그대로 남는다 — 감추지 않는다).
  return doc.status === '반려' || doc.status === '회수'
}

/** 상신함 「미결문서」 건수 — 왼쪽 목록에 그대로 쓰인다. */
export const unfinishedCount = (docs: ApprovalDoc[]): number =>
  docs.filter(d => matchesScope('unfinished', d)).length

/** 문서 상세(DocDetail)가 아는 함 이름으로 바꾼다 — 버튼 구성이 이 값으로 갈린다. */
export const detailBox = (source: Source): 'pending' | 'done' | 'outbox' | 'cc' | 'all' =>
  source === 'inbox' ? 'pending' : source

// ── 날짜 ────────────────────────────────────────────────────────────
// 기결문서는 내가 처리한 날(결재일), 그 밖은 상신일(기안일)이 기준이다.

/** 내가 처리한 줄 — 내 차례였던 것과 위임받아 대결한 것 둘 다. */
export function myActedLine(doc: ApprovalDoc, myId: number | null) {
  if (myId == null) return null
  const mine = (doc.approval_lines ?? []).filter(
    l => l.state !== '대기' && (l.approver_id === myId || l.acted_by === myId),
  )
  if (mine.length === 0) return null
  return mine.reduce((a, b) => ((a.acted_at ?? '') >= (b.acted_at ?? '') ? a : b))
}

export function approvalDate(
  doc: ApprovalDoc, source: Source, myId: number | null, scope?: Scope,
): string | null {
  // 기결문서(종결)는 **종결 시각**이 기준이다 — 정렬도 그 값이고, 내 줄이 '대기' 인 채 끝난 문서는
  // 애초에 내가 처리한 날이 없다(내 차례 전에 반려된 건).
  if (source === 'done' && scope === 'closed') return closedAtOf(doc)
  if (source === 'done') return myActedLine(doc, myId)?.acted_at ?? doc.updated_at ?? null
  return doc.submitted_at ?? doc.created_at ?? null
}

/** 첫 열 이름 — 기결문서만 「결재일」이다. */
export const dateColumnLabel = (source: Source): string => (source === 'done' ? '결재일' : '기안일')

// ── 결재상태 ────────────────────────────────────────────────────────

const nameWithPosition = (p: ProgressPerson | undefined, id: number): string => {
  if (!p) return `#${id}`
  return [p.name ?? `#${id}`, p.position ?? ''].filter(Boolean).join(' ')
}

/** 마지막으로 처리한 사람 — 대결이면 실제로 누른 사람. */
function lastActor(doc: ApprovalDoc, states: string[]): number | null {
  const acted = (doc.approval_lines ?? [])
    .filter(l => states.includes(l.state))
    .sort((a, b) => (a.acted_at ?? '').localeCompare(b.acted_at ?? ''))
  const last = acted[acted.length - 1]
  if (!last) return null
  return last.acted_by ?? last.approver_id
}

/**
 * 「종결(이상철 사장)」 「반려(양정모 책임)」 「진행(3/5)」 처럼 한 덩어리로.
 * 처리자 이름을 괄호에 넣고, 진행중이면 **결재란에 도장이 찍힌 칸 / 결재란의 칸 수**를 적는다.
 */
export function statusText(doc: ApprovalDoc, people: Record<number, ProgressPerson>): string {
  if (doc.status === '진행중') {
    // **결재란(결재표)의 칸을 그대로 센다.** 예전에는 결재선 줄만 세서, 결재란이 기안자·수석·총괄
    // 3칸에 도장 2개인 문서가 「진행(2/2)」로 적혔다 — 표와 글자가 서로 다른 말을 했다.
    // 칸 규칙은 lib/approval/tableCells.ts 한 곳에 있고 결재표도 같은 함수를 쓴다.
    const { done, total } = progressCount(doc)
    return total > 0 ? `진행(${done}/${total})` : '진행'
  }
  if (doc.status === '완료') {
    const id = lastActor(doc, ['승인', '전결', '대결'])
    return id == null ? '종결' : `종결(${nameWithPosition(people[id], id)})`
  }
  if (doc.status === '반려') {
    const id = lastActor(doc, ['반려'])
    return id == null ? '반려' : `반려(${nameWithPosition(people[id], id)})`
  }
  if (doc.status === '회수') {
    const id = doc.requester_id
    return `회수(${nameWithPosition(people[id], id)})`
  }
  if (doc.status === '폐기') {
    // 폐기는 상신자 본인만 할 수 있다 — 괄호 안 이름이 곧 치운 사람이다.
    const id = doc.requester_id
    return `폐기(${nameWithPosition(people[id], id)})`
  }
  return doc.status
}

// ── 첨부 ────────────────────────────────────────────────────────────

/**
 * 첨부 개수. 지금 결재 문서에는 첨부 테이블이 따로 없고, summary 에 담긴 파일이 전부다
 * (쇼룸 사용 신청의 승인서 PDF — pdf_url). 배열로 오는 유형이 생기면 그것도 센다.
 */
export function attachmentCount(summary: Record<string, unknown> | null | undefined): number {
  if (!summary) return 0
  const list = (summary as { attachments?: unknown }).attachments
  if (Array.isArray(list)) return list.length
  const pdf = (summary as { pdf_url?: unknown }).pdf_url
  return typeof pdf === 'string' && pdf.trim() ? 1 : 0
}

// ── 검색 ────────────────────────────────────────────────────────────

/** 문서번호·제목·상신자 이름. 빈 검색어는 전부 통과. */
export function matchesSearch(doc: ApprovalDoc, query: string, people: Record<number, ProgressPerson>): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const requester = people[doc.requester_id]?.name ?? ''
  return [doc.doc_no, doc.title, requester].some(v => (v ?? '').toLowerCase().includes(q))
}

// ── 기간 ────────────────────────────────────────────────────────────

/** 기준일이 from~to(양 끝 포함) 안인가. 날짜가 없는 문서는 거르지 않는다. */
export function inPeriod(iso: string | null, from: string, to: string): boolean {
  if (!iso) return true
  const ymd = iso.slice(0, 10)
  return ymd >= from && ymd <= to
}

// ── 목록 ────────────────────────────────────────────────────────────

/** 기준일 순으로 세운다. 기본은 최신순(desc). */
export function sortDocs(
  docs: ApprovalDoc[], source: Source, myId: number | null, desc: boolean, scope?: Scope,
): ApprovalDoc[] {
  return [...docs].sort((a, b) => {
    const av = approvalDate(a, source, myId, scope) ?? ''
    const bv = approvalDate(b, source, myId, scope) ?? ''
    if (av !== bv) return desc ? bv.localeCompare(av) : av.localeCompare(bv)
    // 같은 시각이면 번호가 큰 쪽(나중 문서)이 먼저 — 순서가 흔들리지 않게 고정한다.
    return b.document_id - a.document_id
  })
}

/**
 * 한 벌에 scope·종류·기간·검색을 모두 걸고 세운다.
 *
 * **서버가 이미 걸러 준 함(기결문서(종결))에서는 scope·종류·기간을 다시 걸지 않는다.**
 * 그 함은 서버가 종결 시각으로 기간을 걸었고 페이지로 끊어 주었다 — 여기서 다시 걸면
 * 기준일이 다른 값(내가 처리한 날)이라 내 줄이 '대기' 인 채 끝난 문서가 떨어져 나간다.
 * 검색만 화면에서 거른다(검색은 지금 페이지 안에서 찾는 일이다).
 */
export function filterDocs(
  docs: ApprovalDoc[],
  opts: {
    source: Source; scope: Scope; query: string; from: string; to: string
    myId: number | null; people: Record<number, ProgressPerson>; desc: boolean
    /** null = 전체 종류. */
    docType?: string | null
  },
): ApprovalDoc[] {
  if (isServerFiltered(opts.source, opts.scope)) {
    const found = docs.filter(d => matchesSearch(d, opts.query, opts.people))
    return opts.desc ? found : sortDocs(found, opts.source, opts.myId, false, opts.scope)
  }
  const kept = docs.filter(d =>
    matchesScope(opts.scope, d)
    && (!opts.docType || d.doc_type === opts.docType)
    && inPeriod(approvalDate(d, opts.source, opts.myId, opts.scope), opts.from, opts.to)
    && matchesSearch(d, opts.query, opts.people),
  )
  return sortDocs(kept, opts.source, opts.myId, opts.desc, opts.scope)
}

/**
 * 왼쪽 목록에 붙는 건수 — 기간·검색·종류를 걸기 전, 그 함에 들어 있는 전부.
 *
 * 기결함 세 항목은 **서버가 센 숫자**를 쓴다. 화면이 받은 한 벌로 세면 상한(50건·한 페이지)에
 * 걸려 숫자가 작게 나온다 — 세는 일과 자르는 일을 떼어 놓은 이유다.
 */
export function itemCount(
  item: BoxItem,
  docsBySource: Partial<Record<Source, ApprovalDoc[]>>,
  doneCounts?: DoneCounts | null,
): number | null {
  if (item.source === 'done') {
    if (!doneCounts) return null
    return doneCounts[item.scope as 'all' | 'open' | 'closed'] ?? null
  }
  const rows = docsBySource[item.source]
  if (rows === undefined) return null
  return rows.filter(d => matchesScope(item.scope, d)).length
}
