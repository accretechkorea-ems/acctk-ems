// 반도체 고객 접촉 보고 — 엑셀 내려받기.
//   GET /api/semi-contact/export?project_id=<id>              → 전체 이력(시트: 이력 · Action · 요약)
//   GET /api/semi-contact/export?project_id=<id>&report_id=<id> → 보고서 한 장(파일명 <Project 번호>_#n_접촉일.xlsx)
//   GET /api/semi-contact/export?all=1&q=&from=&to=&author=&team= → **전체**(2026-11-26, 지시 M)
//       목록에 걸린 조건 그대로 모든 Project · 모든 보고서. 시트 = 전체 · Action · 요약 + 건별 양식.
//       거르기는 목록 라우트와 **같은 순수 모듈**이 한다(lib/semiContact/search.ts) — 화면에
//       보이는 목록과 파일이 어긋나지 않는다.
//
// 접근 검사는 다른 라우트와 같은 공용 호출자다(lib/apiCaller.ts 의 Need 'semi') — 401·403 형식도 같다.
// 데이터는 service role 로 읽는다(Project 상세 화면과 같은 세 표, 작성자 이름은 author FK 임베드).
// Project 가 없으면 404, report_id 가 그 Project 의 보고서가 아니면 404.
// 시트 모양은 lib/semiContact/excel.ts 가 정하고, 이 라우트는 exceljs 로 Workbook 을 만들어 넘긴 뒤 파일로 돌려준다
// (저장소의 다른 엑셀은 브라우저에서 만들지만, 이것은 권한 검사와 service role 읽기를 한 곳에서 하려고 서버에서 만든다).
import { adminClient, adminEnvReady } from '@/lib/supabase/admin'
import ExcelJS from 'exceljs'
import { NextRequest, NextResponse } from 'next/server'
import { loadCaller } from '@/lib/apiCaller'
import { todayKST } from '@/lib/date'
import {
  buildAllWorkbook, buildHistoryWorkbook, buildReportSheet,
  type ExportAction, type ExportGroup, type ExportProject, type ExportReport,
} from '@/lib/semiContact/excel'
import { filterProjects, ymd, type SearchFilter, type SearchReport } from '@/lib/semiContact/search'
import { contactSequence } from '@/lib/semiContact/sequence'

const TAG = 'semi-contact/export'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const bad = (message: string, status: number) => NextResponse.json({ error: message }, { status })

const admin = adminClient

/** 한글 파일명이 깨지지 않게 filename*(UTF-8)을 주고, 옛 브라우저용 ASCII 이름도 함께 둔다. */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** 파일명에 쓸 수 없는 글자만 바꾼다. */
/**
 * 파일명에 쓸 수 있게 다듬는다. Project 번호는 사람이 적는 자유 형식이라 무엇이든 올 수 있다 —
 * 금지 문자(\\ / : * ? " < > |)·제어 문자는 '-' 로, 끝의 점·공백은 지우고(Windows 가 거부), 너무 길면 자른다.
 * 남는 것이 없으면 'project'.
 */
const safeName = (s: string) => {
  const cleaned = s
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '')
  return cleaned || 'project'
}

type ReportRow = Record<string, unknown> & { report_id: number; author: { name: string | null } | null }
type ActionRow = Record<string, unknown> & { action_id: number; report_id: number }

export async function GET(req: NextRequest) {
  try {
    return await handle(req)
  } catch (e) {
    console.error(`[${TAG}] 처리 중 예외`, e)
    return bad('엑셀을 만들지 못했습니다.', 500)
  }
}

async function handle(req: NextRequest) {
  if (!adminEnvReady()) {
    console.error(`[${TAG}] 환경 변수 누락 — SUPABASE URL 또는 SERVICE_ROLE_KEY`)
    return bad('서버 설정 오류 — 환경 변수가 없습니다. 관리자에게 알려주세요.', 500)
  }
  // 로그인 + 접촉 보고서 권한(사업부 + contact_semi) — 공용 함수의 Need 'semi' 다.
  // 401·403 문구는 **공용 모양**('Unauthorized'/'Forbidden')으로 통일했다. 한국어 안내는
  // 화면이 만든다(lib/semiContact.ts 의 apiErrorText).
  const auth = await loadCaller({ kind: 'semi' }, { tag: TAG, method: 'GET' })
  if (auth.error) return auth.error

  const url = new URL(req.url)
  // 전체 엑셀 — 목록 조건 그대로(지시 M). project_id 를 받지 않는다.
  if (url.searchParams.get('all') === '1') return handleAll(req, auth.caller.engineer_id)

  const projectId = Number(url.searchParams.get('project_id'))
  if (!Number.isInteger(projectId) || projectId <= 0) return bad('Project 가 지정되지 않았습니다.', 400)
  const reportParam = url.searchParams.get('report_id')
  const reportId = reportParam === null ? null : Number(reportParam)
  if (reportId !== null && (!Number.isInteger(reportId) || reportId <= 0)) return bad('보고서가 올바르지 않습니다.', 400)

  const sb = admin()
  const [p, r, a] = await Promise.all([
    sb.from('semi_projects')
      .select('project_id, project_no, customer_name, site_dept, title')
      .eq('project_id', projectId).maybeSingle(),
    sb.from('semi_contact_reports')
      .select('*, author:engineers!semi_contact_reports_author_fkey(name)')
      .eq('project_id', projectId)
      .order('contact_date', { ascending: true })
      .order('report_id', { ascending: true }),
    sb.from('semi_actions')
      .select('*')
      .eq('project_id', projectId)
      .order('action_id', { ascending: true }),
  ])
  if (p.error) {
    console.error(`[${TAG}] project lookup failed`, { projectId, error: p.error })
    return bad('Project 를 확인하지 못했습니다.', 500)
  }
  if (!p.data) return bad('Project 를 찾을 수 없습니다.', 404)
  if (r.error || a.error) {
    console.error(`[${TAG}] reports/actions lookup failed`, { projectId, error: r.error ?? a.error })
    return bad('접촉 보고서를 읽지 못했습니다.', 500)
  }

  const project = p.data as ExportProject
  const reports: ExportReport[] = ((r.data ?? []) as unknown as ReportRow[])
    .map(row => ({ report_id: row.report_id, row, authorName: row.author?.name ?? '' }))
  const actions: ExportAction[] = ((a.data ?? []) as unknown as ActionRow[])
    .map(row => ({ action_id: row.action_id, report_id: row.report_id, row }))

  const wb = new ExcelJS.Workbook()
  wb.creator = 'EMS'
  wb.created = new Date()

  let fileName: string
  if (reportId !== null) {
    const report = reports.find(x => x.report_id === reportId)
    if (!report) return bad('보고서를 찾을 수 없습니다.', 404)
    const date = typeof report.row.contact_date === 'string' ? report.row.contact_date : ''
    // 접촉 차수 — 화면과 같은 계산(이 Project 의 보고서 전체를 접촉일·report_id 오름차순으로 센다).
    const seq = contactSequence(reports.map(x => ({
      report_id: x.report_id,
      contact_date: typeof x.row.contact_date === 'string' ? x.row.contact_date : '',
    }))).get(report.report_id)
    buildReportSheet(wb, { project, report, actions, seq })
    fileName = seq
      ? `${safeName(project.project_no)}_#${seq}_${date}.xlsx`
      : `${safeName(project.project_no)}_${date}.xlsx`
  } else {
    buildHistoryWorkbook(wb, { project, reports, actions, today: todayKST() })
    fileName = `${safeName(project.project_no)}_이력.xlsx`
  }

  const buffer = await wb.xlsx.writeBuffer()
  console.log(`[${TAG}] 내려받기`, { projectId, reportId, by: auth.caller.engineer_id })
  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': disposition(fileName),
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * 전체 엑셀 — 목록에 걸린 조건 그대로 **모든 Project · 모든 보고서** (2026-11-26, 지시 M).
 *
 * 왜 한 파일인가 — 지금은 Project 하나씩 내려받는다. 반기 보고를 쓰려면 스무 번을 눌러
 * 스무 파일을 합쳐야 했다.
 *
 * 거르기는 목록 라우트(/api/semi-contact/projects)와 **같은 순수 모듈**이 한다
 * (lib/semiContact/search.ts). 그래서 화면에 보이는 목록과 파일 속 Project 가 어긋나지
 * 않는다 — 조건을 두 곳에서 따로 적으면 반드시 갈린다.
 *
 * 팀(team)도 목록과 같은 규칙으로 좁힌다(만든 사람이 그 팀이거나, 그 팀 사람이 쓴 보고서가 있는 건).
 */
async function handleAll(req: NextRequest, byEngineerId: number) {
  const sp = new URL(req.url).searchParams
  const teamParam = sp.get('team')
  const team = teamParam === null ? null : teamParam.trim()
  const authorRaw = Number(sp.get('author'))
  const filter: SearchFilter = {
    q: (sp.get('q') ?? '').trim().toLowerCase(),
    from: ymd(sp.get('from')),
    to: ymd(sp.get('to')),
    author: Number.isInteger(authorRaw) && authorRaw > 0 ? authorRaw : null,
  }

  const sb = admin()
  const [p, r, a] = await Promise.all([
    sb.from('semi_projects')
      .select('project_id, project_no, customer_name, site_dept, title, creator:engineers!semi_projects_created_by_fkey(teams)'),
    sb.from('semi_contact_reports')
      .select('*, author:engineers!semi_contact_reports_author_fkey(name, teams)')
      .order('contact_date', { ascending: true })
      .order('report_id', { ascending: true }),
    sb.from('semi_actions').select('*').order('action_id', { ascending: true }),
  ])
  if (p.error || r.error || a.error) {
    console.error(`[${TAG}] 전체 조회 실패`, { error: p.error ?? r.error ?? a.error })
    return bad('접촉 보고서를 읽지 못했습니다.', 500)
  }

  type AllProjectRow = ExportProject & { project_id: number; creator: { teams: string | null } | null }
  type AllReportRow = Record<string, unknown> & {
    report_id: number; project_id: number
    author: { name: string | null; teams: string | null } | null
  }
  const projects = (p.data ?? []) as unknown as AllProjectRow[]
  const reports = (r.data ?? []) as unknown as AllReportRow[]
  const actions = (a.data ?? []) as unknown as ActionRow[]

  // 팀으로 좁히기 — 목록 라우트와 같은 규칙이다.
  const teamAuthor = new Set<number>()
  if (team) {
    for (const rep of reports) if (rep.author?.teams?.trim() === team) teamAuthor.add(rep.project_id)
  }
  const scoped = projects.filter(pr =>
    team === null || pr.creator?.teams?.trim() === team || teamAuthor.has(pr.project_id))

  // 검색어·기간·작성자 — 순수 모듈이 판정한다(목록과 같은 함수).
  const searchReports: SearchReport[] = reports.map(rep => ({
    report_id: rep.report_id,
    project_id: rep.project_id,
    contact_date: typeof rep.contact_date === 'string' ? rep.contact_date : null,
    author_id: typeof rep.author_id === 'number' ? rep.author_id : null,
    contact_method: typeof rep.contact_method === 'string' ? rep.contact_method : null,
    customer_contact: typeof rep.customer_contact === 'string' ? rep.customer_contact : null,
    purpose: typeof rep.purpose === 'string' ? rep.purpose : null,
    fact: typeof rep.fact === 'string' ? rep.fact : null,
    detail: (rep.detail ?? null) as Record<string, unknown> | null,
    author: rep.author ? { name: rep.author.name } : null,
  }))
  const kept = filterProjects(
    scoped.map(pr => ({
      project_id: pr.project_id, project_no: pr.project_no,
      customer_name: pr.customer_name, site_dept: pr.site_dept, title: pr.title,
    })),
    searchReports, filter)
  if (kept.length === 0) return bad('조건에 맞는 Project 가 없습니다.', 404)

  // Project 마다 그 보고서·Action 을 모아 넘긴다.
  // ⚠ 보고서는 **거르지 않는다** — Project 가 남았으면 그 Project 의 이력 전부를 담는다.
  //   기간을 걸어 놓고 파일을 열었을 때 「그 기간의 보고서만」이 아니라 「그 기간에 움직인
  //   Project 의 이력 전부」가 보이는 쪽이 보고에 쓰인다(목록의 접촉 횟수도 같은 규칙이다).
  const keptIds = new Set(kept.map(k => k.project_id))
  const byProject = new Map<number, AllReportRow[]>()
  for (const rep of reports) {
    if (!keptIds.has(rep.project_id)) continue
    const list = byProject.get(rep.project_id)
    if (list) list.push(rep); else byProject.set(rep.project_id, [rep])
  }
  const actionsByProject = new Map<number, ActionRow[]>()
  for (const act of actions) {
    const pid = Number((act as Record<string, unknown>).project_id)
    if (!keptIds.has(pid)) continue
    const list = actionsByProject.get(pid)
    if (list) list.push(act); else actionsByProject.set(pid, [act])
  }

  const groups: ExportGroup[] = kept.map(k => {
    const pr = scoped.find(x => x.project_id === k.project_id)!
    return {
      projectId: k.project_id,
      project: { project_no: pr.project_no, customer_name: pr.customer_name, site_dept: pr.site_dept, title: pr.title },
      reports: (byProject.get(k.project_id) ?? []).map(row => ({
        report_id: row.report_id, row, authorName: row.author?.name ?? '',
      })) as ExportReport[],
      actions: (actionsByProject.get(k.project_id) ?? []).map(row => ({
        action_id: row.action_id, report_id: row.report_id, row,
      })) as ExportAction[],
    }
  })

  const wb = new ExcelJS.Workbook()
  wb.creator = 'EMS'
  wb.created = new Date()
  const made = buildAllWorkbook(wb, { groups, today: todayKST() })

  // 파일명 꼬리 — 무엇을 내보냈는지 파일만 보고 알 수 있게.
  const tail = [team, filter.from || filter.to ? `${filter.from || '처음'}~${filter.to || '지금'}` : '', filter.q ? `검색` : '']
    .filter(Boolean).join('_')
  const fileName = `접촉보고서_전체_${todayKST().replace(/-/g, '')}${tail ? `_${safeName(tail)}` : ''}.xlsx`

  const buffer = await wb.xlsx.writeBuffer()
  console.log(`[${TAG}] 전체 내려받기`, { ...made, by: byEngineerId, team, ...filter })
  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': disposition(fileName),
      // 화면이 「건별 시트 N장 / M건은 전체 시트에만」을 알려 줄 수 있게 수를 함께 준다.
      'X-Export-Counts': JSON.stringify(made),
      'Cache-Control': 'no-store',
    },
  })
}

