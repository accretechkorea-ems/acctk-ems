// 할 일 — 홈 「내 오늘」의 **규칙**만 둔다(순수 함수. DB·화면을 모른다).
//
// 목록에 서는 줄은 두 가지다.
//   ① 표의 줄   — 사람이 적은 할 일(db/tasks_20261126.sql). 체크해서 완료한다.
//   ② 합성 줄   — 견적 유효기간 만료 · 미배정 리드 · 결재 대기 · 설치 예정 장비 ·
//                 실주 사유 미입력. **표에 쓰지 않고 조회할 때 만든다.**
//
// ②를 표에 쓰지 않는 이유: 원본이 바뀌면 줄도 바뀌어야 한다. 발주가 나면 「유효기간
// 만료」 줄은 그 자리에서 사라져야 하는데 표에 박아 두면 지우는 일을 또 누군가 해야
// 하고, 놓치면 **없는 일이 목록에 남는다**. 할 일 목록은 믿을 수 있어야 쓴다.
//
// 두 줄은 화면에서 **같은 모양**(TaskItem)으로 다룬다 — 다른 점은 체크할 수 있는지뿐이다.

import { addDays } from './date'
import { quoteExpiry } from './quoteStatus'

/**
 * 표를 아직 안 만들었을 때 화면에 그대로 띄우는 한 줄.
 * 라우트가 503 으로 돌려주고, 홈은 이 문구만 한 줄로 띄우고 **나머지 카드는 그대로 돈다**.
 */
export const TASK_SCHEMA_MESSAGE = '할 일 표가 아직 없습니다 — db/tasks_20261126.sql 을 먼저 적용해주세요'

// ── 종류와 태그 ─────────────────────────────────────────────────────────────

export const TASK_KINDS = ['manual', 'quote_expiry', 'lead', 'forecast', 'approval', 'service'] as const
export type TaskKind = (typeof TASK_KINDS)[number]

export const TASK_REF_TYPES = ['forecast', 'quote', 'lead', 'customer', 'device'] as const
export type TaskRefType = (typeof TASK_REF_TYPES)[number]

/** 목록 오른쪽 태그 글자. DB 의 tasks_kind_chk 와 같은 값이다. */
export const KIND_LABEL: Record<TaskKind, string> = {
  manual: '할 일',
  quote_expiry: '견적',
  lead: '리드',
  forecast: '포캐스트',
  approval: '결재',
  service: '서비스',
}

/** 「＋ 할 일」 모달의 연결 대상 이름. */
export const REF_LABEL: Record<TaskRefType, string> = {
  forecast: '포캐스트',
  quote: '견적',
  lead: '리드',
  customer: '사업장',
  device: '장비',
}

export const isTaskKind = (v: unknown): v is TaskKind =>
  typeof v === 'string' && (TASK_KINDS as readonly string[]).includes(v)
export const isTaskRefType = (v: unknown): v is TaskRefType =>
  typeof v === 'string' && (TASK_REF_TYPES as readonly string[]).includes(v)

// ── 표의 줄 ─────────────────────────────────────────────────────────────────

/** tasks 한 줄(화면이 읽는 모양). */
export type TaskRow = {
  task_id: number
  title: string
  due_date: string | null
  done_at: string | null
  engineer_id: number
  created_by: number | null
  kind: string | null
  ref_type: string | null
  ref_id: number | null
  memo: string | null
}

/** 목록에 서는 한 줄 — 표의 줄과 합성 줄이 같은 모양이 된다. */
export type TaskItem = {
  /** 줄을 가리키는 열쇠. 합성 줄도 겹치지 않는다. */
  key: string
  title: string
  /** 기한('YYYY-MM-DD'). 비면 「언젠가」다 — 목록의 '이후' 끝에 선다. */
  due: string | null
  kind: TaskKind
  refType: TaskRefType | null
  refId: number | null
  /** 표의 줄인가. 합성 줄은 체크로 완료할 수 없다(원본을 처리해야 사라진다). */
  real: boolean
  /**
   * **늘 맨 위**에 서는 줄인가 (2026-11-26 묶음2 A2).
   *
   * 실주 사유 미입력 줄만 참이다. 그 줄은 기한이 없어서(due null) 차례대로 세우면 목록
   * **맨 끝**으로 떨어진다 — 「언젠가」 묶음이기 때문이다. 그런데 이 줄은 끝난 건을
   * 되돌아보는 일이라 미루면 영원히 묻힌다. 그래서 기한 대신 이 표식으로 맨 위에 세운다.
   */
  pin?: boolean
  /** 표의 줄일 때의 id. */
  taskId?: number
  memo?: string | null
}

export const toItem = (t: TaskRow): TaskItem => ({
  key: `task:${t.task_id}`,
  title: t.title,
  due: t.due_date,
  kind: isTaskKind(t.kind) ? t.kind : 'manual',
  refType: isTaskRefType(t.ref_type) ? t.ref_type : null,
  refId: t.ref_id,
  real: true,
  taskId: t.task_id,
  memo: t.memo,
})

// ── 기한 묶음 ───────────────────────────────────────────────────────────────

export type TaskBucket = 'late' | 'today' | 'later'

/** 기한이 없으면 '이후' 다 — 「언젠가」도 할 일이지만 재촉하지는 않는다. */
export function bucketOf(due: string | null | undefined, today: string): TaskBucket {
  if (!due) return 'later'
  if (due < today) return 'late'
  if (due === today) return 'today'
  return 'later'
}

const BUCKET_ORDER: Record<TaskBucket, number> = { late: 0, today: 1, later: 2 }

/**
 * 지남 → 오늘 → 이후. 같은 묶음 안에서는 **기한이 이른 것부터**(지남도 오래된 것이 위다 —
 * 가장 오래 밀린 일이 먼저 보여야 한다). 기한 없는 줄은 맨 끝이다.
 */
export function sortItems(items: readonly TaskItem[], today: string): TaskItem[] {
  return [...items].sort((a, b) => {
    // 못 박은 줄(실주 사유 미입력)은 기한을 보지 않고 맨 위다 — 묶음2 A2.
    if (!!a.pin !== !!b.pin) return a.pin ? -1 : 1
    const ba = BUCKET_ORDER[bucketOf(a.due, today)]
    const bb = BUCKET_ORDER[bucketOf(b.due, today)]
    if (ba !== bb) return ba - bb
    if (!a.due && !b.due) return a.key < b.key ? -1 : 1
    if (!a.due) return 1
    if (!b.due) return -1
    if (a.due !== b.due) return a.due < b.due ? -1 : 1
    return a.key < b.key ? -1 : 1
  })
}

/** 왼쪽 기한 꼬리표 — 「지남 11-21」 · 「오늘」 · 「11-25」 · 「기한 없음」. */
export function dueLabel(due: string | null | undefined, today: string): string {
  const b = bucketOf(due, today)
  if (!due) return '기한 없음'
  const md = due.slice(5)
  if (b === 'late') return `지남 ${md}`
  if (b === 'today') return '오늘'
  return md
}

// ── 합성 줄 ─────────────────────────────────────────────────────────────────
//
// 부르는 쪽이 **이미 자기 것만** 읽어 넘긴다(권한·사업부 거르개는 조회의 몫이다).
// 여기서 하는 일은 「목록에 세울 것인가」와 「무슨 글자로 세울 것인가」뿐이다.

/**
 * 만료가 다가온 견적을 할 일로 세우는 **기준 상태**.
 *
 * lib/quoteStatus.ts 의 EXPIRY_TRACKED_STATUSES 보다 좁다 — 그 목록에는 '발주(주문 대기)'
 * 가 들어 있는데, 발주가 난 건은 유효기간을 재촉할 일이 아니다(지시: 발주·실패 시 자동
 * 소멸). 그래서 **아직 답을 기다리는 세 상태**만 본다.
 */
export const EXPIRY_TASK_STATUSES = ['견적중', '결재중', '보류'] as const

/** 만료 임박으로 보는 남은 날 수. */
export const EXPIRY_SOON_DAYS = 7

export type SynthQuote = {
  quote_id: number
  quote_number: string | null
  status: string | null
  quote_date: string | null
  /** 되돌린 견적은 **되돌린 날부터** 다시 1개월이다(lib/quoteRevive.ts 와 같은 규칙). */
  revived_at?: string | null
  company?: string | null
}

/**
 * 「{회사} » {번호} — 유효기간 만료」. 이미 지난 건도 함께 세운다(가장 먼저 봐야 하는 줄이다).
 * 기한은 **만료일**이라, 지난 건은 그대로 '지남' 묶음에 들어간다.
 */
export function quoteExpiryItems(quotes: readonly SynthQuote[], today: string): TaskItem[] {
  const limit = addDays(today, EXPIRY_SOON_DAYS)
  const out: TaskItem[] = []
  for (const q of quotes) {
    if (!q.status || !(EXPIRY_TASK_STATUSES as readonly string[]).includes(q.status)) continue
    const base = (q.revived_at ? q.revived_at.slice(0, 10) : null) ?? q.quote_date
    if (!base) continue
    const due = quoteExpiry(base)
    if (due > limit) continue
    const who = (q.company ?? '').trim()
    out.push({
      key: `quote-expiry:${q.quote_id}`,
      title: `${who ? `${who} » ` : ''}${q.quote_number ?? q.quote_id} — 유효기간 만료`,
      due,
      kind: 'quote_expiry',
      refType: 'quote',
      refId: q.quote_id,
      real: false,
    })
  }
  return out
}

export type SynthLead = {
  lead_id: number
  lead_no: string | null
  company: string | null
  created_at: string | null
}

/** 「{번호} · {회사} — 담당자 배정」. 기한은 **등록일**이다(오래 묵은 것이 위로 올라온다). */
export function leadItems(leads: readonly SynthLead[]): TaskItem[] {
  return leads.map(l => ({
    key: `lead:${l.lead_id}`,
    title: `${l.lead_no ?? l.lead_id}${l.company ? ` · ${l.company}` : ''} — 담당자 배정`,
    due: l.created_at ? l.created_at.slice(0, 10) : null,
    kind: 'lead' as TaskKind,
    refType: 'lead' as TaskRefType,
    refId: l.lead_id,
    real: false,
  }))
}

export type SynthApproval = { doc_id: number; title: string | null }

/** 「{제목} — 결재」. 기한을 매기지 않는다 — 결재는 받은 순서대로 보는 일이다. */
export function approvalItems(docs: readonly SynthApproval[]): TaskItem[] {
  return docs.map(d => ({
    key: `approval:${d.doc_id}`,
    title: `${(d.title ?? '').trim() || `문서 ${d.doc_id}`} — 결재`,
    due: null,
    kind: 'approval' as TaskKind,
    refType: null,
    refId: null,
    real: false,
  }))
}

export type SynthDevice = {
  device_id: number
  device_name: string | null
  device_name2: string | null
  site: string | null
  install_due_month: string | null
}

/**
 * 설치 예정 장비 — **예정월이 당월이거나 지난** 것만 세운다(다음 달 것을 지금 재촉하지 않는다).
 * 기한은 그 달 **말일**이다. 그래서 당월은 '이후', 지난 달은 '지남' 으로 떨어진다.
 */
export function deviceItems(devices: readonly SynthDevice[], today: string): TaskItem[] {
  const thisMonth = today.slice(0, 7)
  const out: TaskItem[] = []
  for (const d of devices) {
    const m = (d.install_due_month ?? '').trim()
    if (!/^\d{4}-\d{2}$/.test(m) || m > thisMonth) continue
    const [y, mm] = m.split('-').map(Number)
    const last = new Date(y, mm, 0).getDate()
    const name = [d.device_name, d.device_name2].map(v => (v ?? '').trim()).filter(Boolean).join(' ')
    out.push({
      key: `device:${d.device_id}`,
      title: `${d.site ? `${d.site} » ` : ''}${name || `장비 ${d.device_id}`} — 설치 예정`,
      due: `${m}-${String(last).padStart(2, '0')}`,
      kind: 'service',
      refType: 'device',
      refId: d.device_id,
      real: false,
    })
  }
  return out
}

export type SynthLost = { opportunity_id: number; title: string | null; company?: string | null }

/**
 * 실주 사유가 비어 있는 종료 건 — 「실주 사유 입력 필요」.
 * **다른 행위를 막지 않는다**(지시 L3). 목록에 한 줄로 안내만 한다.
 */
export function lostReasonItems(opps: readonly SynthLost[]): TaskItem[] {
  return opps.map(o => ({
    key: `lost:${o.opportunity_id}`,
    title: `${o.company ? `${o.company} » ` : ''}${(o.title ?? '').trim() || `포캐스트 ${o.opportunity_id}`} — 실주 사유 입력 필요`,
    due: null,
    kind: 'forecast' as TaskKind,
    refType: 'forecast' as TaskRefType,
    refId: o.opportunity_id,
    real: false,
    pin: true,
  }))
}

export type SynthReasonPending = {
  quote_id: number
  quote_number: string | null
  company?: string | null
}

/**
 * 실패인데 **사유가 비어 있는 견적** — 「{회사} » {번호} — 실주 사유 입력 필요」 (지시 L3).
 * 안내만 한다. 기한을 매기지 않는다 — 급한 일이 아니고, 재촉하면 아무 사유나 고르게 된다.
 * 판정은 lib/lostReason.ts 의 isReasonPending 이 하고(부르는 쪽이 이미 걸러 넘긴다),
 * 여기서는 글자만 만든다.
 */
export function reasonPendingItems(quotes: readonly SynthReasonPending[]): TaskItem[] {
  return quotes.map(q => ({
    key: `quote-reason:${q.quote_id}`,
    title: `${q.company ? `${q.company} » ` : ''}${q.quote_number ?? q.quote_id} — 실주 사유 입력 필요`,
    due: null,
    kind: 'quote_expiry' as TaskKind,
    refType: 'quote' as TaskRefType,
    refId: q.quote_id,
    real: false,
    pin: true,
  }))
}

export type SynthInput = {
  today: string
  quotes?: readonly SynthQuote[]
  /** 미배정 신규 리드. **누구에게 보일지는 부르는 쪽이 정한다**(지시: superadmin 에게만). */
  leads?: readonly SynthLead[]
  approvals?: readonly SynthApproval[]
  devices?: readonly SynthDevice[]
  lost?: readonly SynthLost[]
  /** 실패인데 사유가 빈 견적(지시 L3). */
  reasonPending?: readonly SynthReasonPending[]
}

/** 합성 줄 전부. 못 읽은 자료는 빼고 넘기면 그 줄만 빠진다(카드가 통째로 비지 않는다). */
export function synthItems(input: SynthInput): TaskItem[] {
  return [
    ...quoteExpiryItems(input.quotes ?? [], input.today),
    ...leadItems(input.leads ?? []),
    ...approvalItems(input.approvals ?? []),
    ...deviceItems(input.devices ?? [], input.today),
    ...lostReasonItems(input.lost ?? []),
    ...reasonPendingItems(input.reasonPending ?? []),
  ]
}

/** 표의 줄 + 합성 줄을 한 목록으로. 끝낸 줄은 빼고 기한 순으로 세운다. */
export function buildTaskList(rows: readonly TaskRow[], synth: SynthInput): TaskItem[] {
  const mine = rows.filter(t => !t.done_at).map(toItem)
  return sortItems([...mine, ...synthItems(synth)], synth.today)
}

// ── 제목 옆의 두 수 ─────────────────────────────────────────────────────────
//
// 타일 다섯(지난 할 일·오늘 할 일·멈춘 딜·미배정 리드·결재 대기)은 2026-11-26(묶음2 A1)에
// **걷었다.** 아래 목록이 이미 같은 줄을 세고 있어, 타일은 같은 말을 두 번 하는 자리였다.
// 남긴 둘(지남·오늘)은 할 일 카드의 **제목 옆 한 줄**로 간다.
//
// 함께 지운 것 — staleDeals·STALE_DAYS·StaleDeal(멈춘 딜 판정), tileCounts·TileCounts.
//   멈춘 딜은 판에서 **카드 흐림**과 정렬이 대신한다(묶음2 C3 — 14일 이상 활동 없음은
//   카드를 opacity .55 로 둔다). 교정 예정(calibrationSoon)은 그 전 회차에 걷었다.

export type DueCounts = {
  /** 기한이 지난 줄 수. */
  late: number
  /** 기한이 오늘인 줄 수. */
  today: number
}

/**
 * 목록과 **같은 줄**을 센다 — 한 곳에서 만들기 때문에 제목의 수와 목록이 어긋나지 않는다.
 * 못 박은 줄(실주 사유 미입력)은 기한이 없어 어느 쪽에도 들어가지 않는다.
 */
export function dueCounts(items: readonly TaskItem[], today: string): DueCounts {
  let late = 0
  let now = 0
  for (const it of items) {
    const b = bucketOf(it.due, today)
    if (b === 'late') late++
    else if (b === 'today') now++
  }
  return { late, today: now }
}
