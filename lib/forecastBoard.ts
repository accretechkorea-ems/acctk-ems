// 포캐스트 칸반의 **머리 띠** 규칙 — 순수 함수만 둔다(DB·화면을 모른다).
//
// 판은 「지금 살아 있는 건 전부」를 보여 준다. 기간으로 자르지 않는다 — 마감일이 없는 건이
// 통째로 사라지면 그 건은 아무도 다시 보지 않는다(app/pipeline/page.tsx 의 byDueDate 주석).
// 그래서 **기간은 거르개가 아니라 분포**로 보여 준다: 띠에 분기별 건수·합계를 늘어놓고,
// 누르면 그 분기만 남긴다(한 번 더 누르면 전부로 돌아온다).
//
// ── 분기는 **달력 분기**다 ──────────────────────────────────────────────────
// 이 저장소의 회계연도는 4월 시작이지만(lib/forecast.ts 의 fiscalYearOfMonth), 띠의 분기는
// 달력 분기다 — 고객과 말을 맞추는 자리라 「26년 4분기」가 10~12월이어야 한다. 실적·목표를
// 보는 자리(실적 현황·엑셀)는 그대로 회계연도를 쓴다. 둘은 **다른 질문**이다.
//
// ── 금액 축약 ───────────────────────────────────────────────────────────────
// 「1억 2,600만」까지만 적고 전체 자릿수는 호버로 본다. 판에서 알고 싶은 것은 규모이고,
// 열 폭이 좁아 전체 자릿수를 적으면 회사명이 먼저 잘린다.

/** 'YYYY-MM-DD'(또는 'YYYY-MM') → 'YY N분기' 열쇠. 값이 없으면 빈 글자다(= 미정). */
export const quarterKeyOf = (ymd: string | null | undefined): string => {
  if (!ymd || !/^\d{4}-\d{2}/.test(ymd)) return ''
  const y = ymd.slice(2, 4)
  const q = Math.floor((Number(ymd.slice(5, 7)) - 1) / 3) + 1
  return `${y} ${q}Q`
}

/** 띠에 적는 글자 — 미정은 「미정」이다. */
export const quarterLabel = (key: string): string => key || '미정'

/**
 * 금액 축약 — 「1억 2,600만」 · 「8,500만」 · 「120만」 · 「3,000」.
 * 억·만 자리를 **둘 다** 적는다(소수 한 자리로 뭉개지 않는다 — 「1.3억」은 1억 3천만과
 * 1억 2천 5백만을 같게 보이게 한다).
 */
export function krwShort(n: number | null | undefined): string {
  if (!n) return '-'
  const v = Math.round(n)
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  const eok = Math.floor(abs / 1e8)
  const man = Math.floor((abs % 1e8) / 1e4)
  const won = abs % 1e4
  const parts: string[] = []
  if (eok > 0) parts.push(`${eok.toLocaleString('ko-KR')}억`)
  if (man > 0) parts.push(`${man.toLocaleString('ko-KR')}만`)
  // 억·만이 모두 0 일 때만 원 단위를 적는다(「1억 300원」 같은 자리는 보여 줄 뜻이 없다).
  if (parts.length === 0) parts.push(won.toLocaleString('ko-KR'))
  return sign + parts.join(' ')
}

/** 호버에 적는 전체 자릿수. */
export const krwFull = (n: number | null | undefined): string =>
  n ? `₩${Math.round(n).toLocaleString('ko-KR')}` : '-'

/** 띠가 세는 데 필요한 한 건의 모양 — 판의 카드와 같은 줄이다. */
export type BoardDeal = {
  opportunity_id: number
  stage: string
  expected_amount: number | null
  expected_close: string | null
}

export type QuarterSlice = { key: string; label: string; count: number; sum: number }

/**
 * 분기 분포 — **이른 분기부터**, 미정은 맨 끝이다.
 * 금액이 비어 있는 건도 건수로는 센다(0원이라고 없는 일이 아니다).
 */
export function quarterSlices(deals: readonly BoardDeal[]): QuarterSlice[] {
  const by = new Map<string, QuarterSlice>()
  for (const d of deals) {
    const key = quarterKeyOf(d.expected_close)
    const cur = by.get(key) ?? { key, label: quarterLabel(key), count: 0, sum: 0 }
    cur.count++
    cur.sum += d.expected_amount ?? 0
    by.set(key, cur)
  }
  return [...by.values()].sort((a, b) => {
    if (a.key === b.key) return 0
    if (!a.key) return 1
    if (!b.key) return -1
    return a.key < b.key ? -1 : 1
  })
}

/** 마감 임박으로 보는 기준 — 이번 달에 닫히기로 한 건. */
export const soonMonthOf = (today: string): string => today.slice(0, 7)

// 「14일 넘게 활동 없음」은 **띠에 두지 않는다** — 세어 봐야 어느 건인지는 알 수 없고,
// 판에서는 **그 카드를 흐리게**(opacity .55) 두는 편이 바로 눈에 든다(2026-11-26 묶음2 C3).
// 홈의 「멈춘 딜」 타일·카드도 같은 날 걷었다 — 이제 이 판이 그 일을 혼자 한다.

export type BoardSummary = {
  count: number
  sum: number
  /** 단계별 건수 — 받은 단계 차례 그대로다(없는 단계도 0 으로 남는다). */
  byStage: { stage: string; count: number }[]
  /** 이번 달 마감 예정 건수. */
  soon: number
}

/**
 * 띠 하나에 들어가는 수 전부. **판에 보이는 줄만** 넣는다 — 걸러 놓고 전체를 세면
 * 띠와 판이 어긋난다(어느 쪽이 맞는지 알 길이 없다).
 */
export function boardSummary(
  deals: readonly BoardDeal[],
  stages: readonly string[],
  today: string,
): BoardSummary {
  const month = soonMonthOf(today)
  let sum = 0
  let soon = 0
  const counts = new Map<string, number>(stages.map(s => [s, 0]))
  for (const d of deals) {
    sum += d.expected_amount ?? 0
    if ((d.expected_close ?? '').slice(0, 7) === month) soon++
    if (counts.has(d.stage)) counts.set(d.stage, (counts.get(d.stage) ?? 0) + 1)
  }
  return {
    count: deals.length,
    sum,
    byStage: stages.map(s => ({ stage: s, count: counts.get(s) ?? 0 })),
    soon,
  }
}

/** 고른 분기만 남긴다. 아무것도 고르지 않았으면(null) 전부다. */
export const inQuarter = <T extends { expected_close: string | null }>(row: T, quarter: string | null): boolean =>
  quarter === null || quarterKeyOf(row.expected_close) === quarter

// ── 카드 한 장이 말하는 것 (2026-11-26 묶음2 C3) ────────────────────────────
//
// 카드는 다섯 줄이다 — 회사 » 사업장 / 제목 / 금액 / 예정·담당·마지막 활동 / 다음 할 일.
// 「무엇을 언제까지, 누가, 다음에 무엇을」이 한 장에 다 있어야 판에서 손이 멈추지 않는다.
// 아래 함수들은 그 다섯 줄에 **무슨 글자를 적을지**만 정한다(순수 함수다).

/** 활동이 없다고 보는 날 수 — 그 넘으면 카드를 흐리게 둔다. */
export const IDLE_DIM_DAYS = 14

/**
 * 마지막 활동으로부터 지난 날. 활동이 없으면 **만든 날**부터 센다(그만큼 멈춰 있다).
 * 둘 다 없으면 null — 「활동 없음」으로 적는다.
 */
export function idleDaysOf(lastAt: string | null | undefined, createdAt: string | null | undefined, today: string): number | null {
  const base = (lastAt ?? '').slice(0, 10) || (createdAt ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return null
  const d = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${base}T00:00:00Z`)) / 86400000)
  return d < 0 ? 0 : d
}

/** 4행 오른쪽 글자 — 「오늘 활동」 · 「3일 전」 · 「활동 없음」. */
export function idleLabel(days: number | null): string {
  if (days === null) return '활동 없음'
  if (days === 0) return '오늘 활동'
  return `${days}일 전`
}

/** 14일 넘게 아무 일도 없었나 — 카드를 흐리게 둘지. 알 수 없으면(날짜 없음) 흐리게 둔다. */
export const isIdle = (days: number | null): boolean => days === null || days >= IDLE_DIM_DAYS

/**
 * 담당자 이니셜 — 「김철수」 → 「김철」, 「Hong Gildong」 → 「HG」.
 * 한글은 **앞 두 글자**다(성 한 자만 두면 같은 성이 전부 같아 보인다).
 */
export function initialsOf(name: string | null | undefined): string {
  const n = (name ?? '').trim()
  if (!n) return '?'
  const words = n.split(/\s+/).filter(Boolean)
  if (words.length > 1 && /^[A-Za-z]/.test(n)) return words.slice(0, 2).map(w => w[0].toUpperCase()).join('')
  return n.slice(0, 2)
}

/** 4행 왼쪽 글자 — 「예정 2026 12월」. 마감월이 없으면 「예정 미정」. */
export function dueLabelOf(expectedClose: string | null | undefined): string {
  const m = (expectedClose ?? '').trim()
  if (!/^\d{4}-\d{2}/.test(m)) return '예정 미정'
  return `예정 ${m.slice(0, 4)} ${Number(m.slice(5, 7))}월`
}

/** 5행이 말하는 다음 할 일 한 줄. */
export type NextTask = {
  title: string
  /** 'YYYY-MM-DD' 또는 null(기한 없음). */
  due: string | null
}

/** 그 할 일이 **늦었나** — 기한이 오늘보다 앞이면 참이다. */
export const isTaskLate = (t: NextTask | null, today: string): boolean =>
  !!t && !!t.due && t.due < today

/**
 * 5행 글자 — 「→ 11-28 구매팀 가격 협의」 · 「→ 구매팀 가격 협의」 · 「다음 할 일 없음」.
 * 날짜는 월-일만 적는다(띠 한 줄에 제목이 들어가야 한다).
 */
export function nextTaskLabel(t: NextTask | null): string {
  if (!t) return '다음 할 일 없음'
  const head = t.due ? `${t.due.slice(5)} ` : ''
  return `→ ${head}${t.title}`
}

/**
 * 한 포캐스트의 **다음 할 일** — 기한이 이른 것 하나. 기한 없는 줄은 기한 있는 줄 뒤다
 * (언젠가 할 일보다 날이 박힌 일이 먼저 보여야 한다).
 */
export function pickNextTask(
  tasks: readonly { ref_type?: string | null; ref_id?: number | null; title: string; due_date: string | null; done_at?: string | null }[],
  opportunityId: number,
): NextTask | null {
  const mine = tasks
    .filter(t => t.ref_type === 'forecast' && Number(t.ref_id) === opportunityId && !t.done_at)
    .sort((a, b) => {
      if (!a.due_date && !b.due_date) return a.title < b.title ? -1 : 1
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date < b.due_date ? -1 : 1
    })
  const first = mine[0]
  return first ? { title: first.title, due: first.due_date } : null
}

/** 기회별 **마지막 활동일** — 판이 이미 읽어 둔 활동 줄에서 만든다(조회를 늘리지 않는다). */
export function lastActivityByOpp(
  activities: readonly { opportunity_id?: number | null; activity_date?: string | null }[],
): Map<number, string> {
  const out = new Map<number, string>()
  for (const a of activities) {
    const id = Number(a.opportunity_id)
    const d = (a.activity_date ?? '').slice(0, 10)
    if (!Number.isInteger(id) || !d) continue
    const was = out.get(id)
    if (!was || was < d) out.set(id, d)
  }
  return out
}
