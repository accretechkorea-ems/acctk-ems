// 반도체 고객 접촉 보고 — 엑셀 내려받기.
//   GET /api/semi-contact/export?project_id=<id>              → 전체 이력(시트: 이력 · Action · 요약)
//   GET /api/semi-contact/export?project_id=<id>&report_id=<id> → 보고서 한 장(파일명 <Project 번호>_#n_접촉일.xlsx)
//
// 접근 검사는 다른 접촉 보고서 라우트와 같은 authorizeSemiContact(lib/semiContactServer.ts) — 401·403 형식도 같다.
// 데이터는 service role 로 읽는다(Project 상세 화면과 같은 세 표, 작성자 이름은 author FK 임베드).
// Project 가 없으면 404, report_id 가 그 Project 의 보고서가 아니면 404.
// 시트 모양은 lib/semiContact/excel.ts 가 정하고, 이 라우트는 exceljs 로 Workbook 을 만들어 넘긴 뒤 파일로 돌려준다
// (저장소의 다른 엑셀은 브라우저에서 만들지만, 이것은 권한 검사와 service role 읽기를 한 곳에서 하려고 서버에서 만든다).
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { authorizeSemiContact } from '@/lib/semiContactServer'
import { todayKST } from '@/lib/date'
import {
  buildHistoryWorkbook, buildReportSheet,
  type ExportAction, type ExportProject, type ExportReport,
} from '@/lib/semiContact/excel'
import { contactSequence } from '@/lib/semiContact/sequence'

const TAG = 'semi-contact/export'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const bad = (message: string, status: number) => NextResponse.json({ error: message }, { status })

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

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
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`[${TAG}] 환경 변수 누락 — SUPABASE URL 또는 SERVICE_ROLE_KEY`)
    return bad('서버 설정 오류 — 환경 변수가 없습니다. 관리자에게 알려주세요.', 500)
  }
  const auth = await authorizeSemiContact(TAG)
  if (auth.error) return auth.error

  const url = new URL(req.url)
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
