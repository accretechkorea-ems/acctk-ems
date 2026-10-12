// 반도체 고객 접촉 보고 — Project 목록(GET /api/semi-contact/projects?scope=all|team).
//
// 목록 화면이 이 라우트 하나로 읽는다. 「내 팀」 판정을 서버에서 하려는 것이다(클라이언트는 결과만 받는다).
//   scope=all  — 전부
//   scope=team — 내 팀 Project 만: Project 를 만든 사람의 팀이 내 팀이거나, 그 Project 보고서 작성자 중
//                내 팀 소속이 한 명이라도 있는 것. 팀은 engineers.teams(팀 이름 문자열)로 맞춘다 — 새 컬럼 없이 계산한다.
//                사업부 전환 권한이 있는 superadmin 도 본인 소속 팀 기준이다. 소속 팀이 없으면 빈 목록.
// 접근 검사는 다른 접촉 보고서 라우트와 같은 authorizeSemiContact(401·403 형식 동일). 읽기는 service role.
//
// 행마다 돌려주는 값: 번호·고객사·사업장/부서·안건·생성일, 접촉 횟수, 최근 접촉(가장 늦은 contact_date,
// 같은 날이면 report_id 가 큰 보고서)의 날짜·작성자 이름. 정렬은 최근 접촉 내림차순, 보고서가 없으면 생성일로 견준다.
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
  author: { name: string | null; teams: string | null } | null
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
  const myTeam = auth.caller.teams?.trim() || null

  const scope = new URL(req.url).searchParams.get('scope') === 'team' ? 'team' : 'all'

  const sb = admin()
  // 만든 사람과 보고서 작성자의 팀은 engineers 를 임베드해 읽는다. 두 표 모두 engineers 를 여러 번 가리킬 수 있어
  // 어느 FK 인지 이름으로 짚는다(semi_contact_schema.sql).
  const [p, r] = await Promise.all([
    sb.from('semi_projects')
      .select('project_id, project_no, customer_name, site_dept, title, created_at, creator:engineers!semi_projects_created_by_fkey(teams)'),
    sb.from('semi_contact_reports')
      .select('report_id, project_id, contact_date, author:engineers!semi_contact_reports_author_fkey(name, teams)'),
  ])
  if (p.error || r.error) {
    console.error(`[${TAG}] lookup failed`, { error: p.error ?? r.error })
    return bad('Project 목록을 읽지 못했습니다.', 500)
  }
  const projects = (p.data ?? []) as unknown as ProjectRow[]
  const reports = (r.data ?? []) as unknown as ReportRow[]

  // Project 별 접촉 횟수·최근 접촉·내 팀 작성자 여부
  const byProject = new Map<number, { count: number; last: ReportRow | null; teamAuthor: boolean }>()
  for (const rep of reports) {
    const cur = byProject.get(rep.project_id) ?? { count: 0, last: null, teamAuthor: false }
    cur.count += 1
    if (!cur.last || rep.contact_date > cur.last.contact_date
      || (rep.contact_date === cur.last.contact_date && rep.report_id > cur.last.report_id)) cur.last = rep
    if (myTeam && rep.author?.teams?.trim() === myTeam) cur.teamAuthor = true
    byProject.set(rep.project_id, cur)
  }

  const inScope = (pr: ProjectRow) => {
    if (scope === 'all') return true
    if (!myTeam) return false
    return pr.creator?.teams?.trim() === myTeam || byProject.get(pr.project_id)?.teamAuthor === true
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
      // 최근 접촉일, 보고서가 없으면 생성일(한국 날짜)로 견준다.
      sortKey: last?.contact_date ?? kstYmd(pr.created_at),
    }
  })
  items.sort((a, b) =>
    b.sortKey.localeCompare(a.sortKey)
    || b.created_at.localeCompare(a.created_at)
    || b.project_id - a.project_id)

  return NextResponse.json({
    scope,
    my_team: myTeam,
    projects: items.map(({ sortKey: _sortKey, ...rest }) => rest),
  })
}
