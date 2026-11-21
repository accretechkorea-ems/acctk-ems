// 반도체 접촉 보고 — 목록 **거르기**(검색어·기간·작성자) (2026-11-22).
//
// 순수 모듈이다. 라우트(/api/semi-contact/projects)가 이 함수들을 쓰고,
// 하네스(scripts/semi-search-check.js)가 같은 함수를 키 없이 시험한다.
//
// ── 규칙 ───────────────────────────────────────────────────────────────────
//   기간·작성자는 **보고서 단위** 조건이다 — 그 조건을 지나는 보고서가 한 건이라도 있는
//   Project 가 남는다. 검색어는 Project 칸(번호·고객사·사업장/부서·안건)에 걸리거나,
//   **그 조건을 지난 보고서의 본문**에 걸리면 남는다.
//
//   보고서 본문은 글자 칸 **전부**다 — 접촉일·접촉방법·고객 담당자·목적·FACT·작성자 이름,
//   그리고 detail(jsonb)에 든 모든 글자. 화면에 없는 자료라 서버에서만 찾을 수 있다.
//
//   기간은 **접촉일**(semi_contact_reports.contact_date)로 잰다. 지시의 말은 「작성일」
//   이었는데, 이 표에서 보고서의 날짜는 접촉일이고 화면도 그 값을 「최근 접촉」으로
//   보여 준다 — 사람이 고르는 기간도 그것이라 보았다. 넣은 날짜(created_at)로 걸러야
//   하면 reportInRange 가 보는 칸 하나만 바꾸면 된다.

/** 거르기에 쓰는 보고서 한 줄의 모양(라우트가 읽는 칸 중 필요한 것만). */
export type SearchReport = {
  report_id: number
  project_id: number
  contact_date: string | null
  author_id: number | null
  contact_method?: string | null
  customer_contact?: string | null
  purpose?: string | null
  fact?: string | null
  detail?: Record<string, unknown> | null
  author?: { name?: string | null } | null
}

/** 거르기에 쓰는 Project 한 줄의 모양. */
export type SearchProject = {
  project_id: number
  project_no: string
  customer_name: string
  site_dept: string | null
  title: string
}

export type SearchFilter = {
  /** 소문자로 바꾼 검색어. 빈 글자면 검색어 조건이 없다. */
  q: string
  /** 'YYYY-MM-DD' 또는 빈 글자. 양끝 포함. */
  from: string
  to: string
  /** engineers.engineer_id 또는 null(= 전체). */
  author: number | null
}

/** 'YYYY-MM-DD' 꼴만 받는다. 아니면 빈 글자 — 잘못 적힌 값으로 목록을 비우지 않는다. */
export function ymd(value: string | null | undefined): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? (value as string) : ''
}

/** 접촉일이 기간 안인가 — 양끝 포함. 날짜가 없는 보고서는 기간을 걸면 빠진다. */
export function reportInRange(rep: SearchReport, from: string, to: string): boolean {
  const d = (rep.contact_date ?? '').slice(0, 10)
  if (!d) return !from && !to
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

/** 기간·작성자를 지나는가. */
export function reportPasses(rep: SearchReport, f: Pick<SearchFilter, 'from' | 'to' | 'author'>): boolean {
  if (!reportInRange(rep, f.from, f.to)) return false
  return f.author === null || Number(rep.author_id) === f.author
}

/** 보고서 한 건의 **글자 전부**(detail 의 값까지). 소문자로 돌려준다. */
export function reportText(rep: SearchReport): string {
  const parts: string[] = [
    rep.contact_date ?? '', rep.contact_method ?? '', rep.customer_contact ?? '',
    rep.purpose ?? '', rep.fact ?? '', rep.author?.name ?? '',
  ]
  const detail = rep.detail
  if (detail && typeof detail === 'object') {
    for (const v of Object.values(detail)) if (typeof v === 'string') parts.push(v)
  }
  return parts.join('\n').toLowerCase()
}

/** Project 칸의 글자(소문자). */
export function projectText(pr: SearchProject): string {
  return [pr.project_no, pr.customer_name, pr.site_dept ?? '', pr.title].join('\n').toLowerCase()
}

/** 조건이 하나라도 걸렸는가 — 걸리지 않았으면 전부 보여 준다. */
export function isNarrowed(f: SearchFilter): boolean {
  return f.q !== '' || f.from !== '' || f.to !== '' || f.author !== null
}

/**
 * Project 를 거른다. 돌려주는 순서는 **넘겨받은 순서 그대로**다(정렬은 부르는 쪽 일이다).
 * reports 는 그 Project 들의 보고서 전부다.
 */
export function filterProjects(
  projects: SearchProject[],
  reports: SearchReport[],
  f: SearchFilter,
): SearchProject[] {
  const passed = new Map<number, SearchReport[]>()
  for (const rep of reports) {
    if (!reportPasses(rep, f)) continue
    const list = passed.get(rep.project_id)
    if (list) list.push(rep); else passed.set(rep.project_id, [rep])
  }
  // 기간·작성자를 걸었는가 — 걸었으면 그 조건을 지난 보고서가 있어야 남는다.
  const byReport = f.from !== '' || f.to !== '' || f.author !== null
  return projects.filter(pr => {
    const mine = passed.get(pr.project_id) ?? []
    if (byReport && mine.length === 0) return false
    if (!f.q) return true
    if (projectText(pr).includes(f.q)) return true
    return mine.some(rep => reportText(rep).includes(f.q))
  })
}

/** 작성자 드롭다운 칸 — 보고서를 한 건이라도 쓴 사람만, 이름순. */
export function authorOptions(reports: SearchReport[]): { engineer_id: number; name: string }[] {
  const map = new Map<number, string>()
  for (const rep of reports) {
    const id = Number(rep.author_id)
    if (!Number.isFinite(id) || id <= 0) continue
    if (!map.has(id)) map.set(id, (rep.author?.name ?? '').trim() || `#${id}`)
  }
  return [...map].map(([engineer_id, name]) => ({ engineer_id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}
