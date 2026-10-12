// 반도체 고객 접촉 보고 — Project 목록(GET /api/semi-contact/projects[?team=<팀 이름>]).
//
// 목록 화면이 이 라우트 하나로 읽는다. 팀 판정을 서버에서 하려는 것이다(클라이언트는 결과만 받는다).
//   team 없음 — 전부
//   team=<이름> — 그 팀의 Project 만: Project 를 만든 사람의 팀이 그 팀이거나, 그 Project 보고서 작성자 중
//                 그 팀 소속이 한 명이라도 있는 것. 팀은 engineers.teams(팀 이름 문자열)로 맞춘다 — 새 컬럼 없이 계산한다.
//                 사업부가 반도체인 팀(teams.division = '반도체')만 받는다. 그 밖의 값은 400.
// 응답에 반도체 팀 이름 목록(teams.display_order 순)도 함께 담는다 — 화면의 팀 토글이 이것으로 칸을 만든다
// (팀이 늘면 칸도 저절로 는다). 팀 목록을 못 읽으면 빈 목록으로 두고 Project 목록은 그대로 돌려준다.
// 접근 검사는 다른 접촉 보고서 라우트와 같은 authorizeSemiContact(401·403 형식 동일). 읽기는 service role.
//
// 행마다 돌려주는 값: 번호·고객사·사업장/부서·안건·생성일, 접촉 횟수, 최근 접촉(가장 늦은 contact_date,
// 같은 날이면 report_id 가 큰 보고서)의 날짜·작성자 이름·직책(engineers.position). 정렬은 최근 접촉 내림차순, 보고서가 없으면 생성일로 견준다.
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { authorizeSemiContact } from '@/lib/semiContactServer'
import { kstYmd } from '@/lib/date'

const TAG = 'semi-contact/projects'

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type ProjectRow = {
  project_id: number
  project_no: string
  customer_name: string
  site_dept: string | null
  title: string
  created_at: string
  creator: { teams: string | null } | null
}
type ReportRow = {
  report_id: number
  project_id: number
  contact_date: string
  author: { name: string | null; position: string | null; teams: string | null } | null
}

type ProjectListItem = {
  project_id: number
  project_no: string
  customer_name: string
  site_dept: string | null
  title: string
  created_at: string
  report_count: number
  last_contact_date: string | null
  last_contact_author: string | null
  last_contact_author_position: string | null
}

export async function GET(req: NextRequest) {
  try {
    return await handle(req)
  } catch (e) {
    console.error(`[${TAG}] GET 처리 중 예외`, e)
    return bad('Project 목록을 읽지 못했습니다.', 500)
  }
}

async function handle(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`[${TAG}] 환경 변수 누락 — SUPABASE URL 또는 SERVICE_ROLE_KEY`)
    return bad('서버 설정 오류 — 환경 변수가 없습니다. 관리자에게 알려주세요.', 500)
  }
  const auth = await authorizeSemiContact(TAG)
  if (auth.error) return auth.error
  const teamParam = new URL(req.url).searchParams.get('team')
  const team = teamParam === null ? null : teamParam.trim()

  const sb = admin()

  // 반도체 팀 목록 — 토글 칸과 team 값 검사에 쓴다. 실패하면 빈 목록(전체만 보이게).
  const { data: teamRows, error: teamErr } = await sb
    .from('teams')
    .select('name, display_order')
    .eq('division', '반도체')
    .order('display_order', { ascending: true })
  if (teamErr) console.error(`[${TAG}] teams lookup failed`, { error: teamErr })
  const semiTeams = teamErr ? [] : ((teamRows ?? []) as { name: string | null }[])
    .map(t => (t.name ?? '').trim()).filter(Boolean)
  if (team !== null && !semiTeams.includes(team)) {
    return bad(teamErr ? '팀 목록을 확인하지 못했습니다.' : '알 수 없는 팀입니다.', teamErr ? 500 : 400)
  }
  // 만든 사람과 보고서 작성자의 팀은 engineers 를 임베드해 읽는다. 두 표 모두 engineers 를 여러 번 가리킬 수 있어
  // 어느 FK 인지 이름으로 짚는다(semi_contact_schema.sql).
  const [p, r] = await Promise.all([
    sb.from('semi_projects')
      .select('project_id, project_no, customer_name, site_dept, title, created_at, creator:engineers!semi_projects_created_by_fkey(teams)'),
    sb.from('semi_contact_reports')
      .select('report_id, project_id, contact_date, author:engineers!semi_contact_reports_author_fkey(name, position, teams)'),
  ])
  if (p.error || r.error) {
    console.error(`[${TAG}] lookup failed`, { error: p.error ?? r.error })
    return bad('Project 목록을 읽지 못했습니다.', 500)
  }
  const projects = (p.data ?? []) as unknown as ProjectRow[]
  const reports = (r.data ?? []) as unknown as ReportRow[]

  // Project 별 접촉 횟수·최근 접촉·고른 팀 작성자 여부
  const byProject = new Map<number, { count: number; last: ReportRow | null; teamAuthor: boolean }>()
  for (const rep of reports) {
    const cur = byProject.get(rep.project_id) ?? { count: 0, last: null, teamAuthor: false }
    cur.count += 1
    if (!cur.last || rep.contact_date > cur.last.contact_date
      || (rep.contact_date === cur.last.contact_date && rep.report_id > cur.last.report_id)) cur.last = rep
    if (team && rep.author?.teams?.trim() === team) cur.teamAuthor = true
    byProject.set(rep.project_id, cur)
  }

  const inScope = (pr: ProjectRow) => {
    if (team === null) return true
    return pr.creator?.teams?.trim() === team || byProject.get(pr.project_id)?.teamAuthor === true
  }

  const items: (ProjectListItem & { sortKey: string })[] = projects.filter(inScope).map(pr => {
    const agg = byProject.get(pr.project_id)
    const last = agg?.last ?? null
    return {
      project_id: pr.project_id,
      project_no: pr.project_no,
      customer_name: pr.customer_name,
      site_dept: pr.site_dept,
      title: pr.title,
      created_at: pr.created_at,
      report_count: agg?.count ?? 0,
      last_contact_date: last?.contact_date ?? null,
      last_contact_author: last ? (last.author?.name ?? null) : null,
      last_contact_author_position: last ? (last.author?.position?.trim() || null) : null,
      // 최근 접촉일, 보고서가 없으면 생성일(한국 날짜)로 견준다.
      sortKey: last?.contact_date ?? kstYmd(pr.created_at),
    }
  })
  items.sort((a, b) =>
    b.sortKey.localeCompare(a.sortKey)
    || b.created_at.localeCompare(a.created_at)
    || b.project_id - a.project_id)

  return NextResponse.json({
    team,
    teams: semiTeams,
    projects: items.map(({ sortKey: _sortKey, ...rest }) => rest),
  })
}
