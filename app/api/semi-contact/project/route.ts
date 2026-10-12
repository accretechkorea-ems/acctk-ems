// 반도체 고객 접촉 보고 — Project 만들기(POST)·정보 수정(PATCH)·삭제(DELETE).
//
// 흐름(만들기)
//   1. 접근 검사(lib/semiContactServer.ts) — 세션으로 로그인 확인, service role 로 engineers·팀 사업부를 읽어
//      반도체 팀 + contact_semi 권한 또는 사업부 전환 권한자만 통과. 없으면 403.
//   2. 본문에서 Project 번호와 Project 칸(등록표의 storage 'project')만 꺼내 검증한다.
//      번호는 사람이 직접 적는 자유 형식이다(lib/semiContact/project.ts — 앞뒤 공백 제거·빈 값 불가·길이 상한만).
//   3. 같은 번호가 있는지 대소문자를 가리지 않고 먼저 확인한다(있으면 400, 번호 칸 오류).
//      최종 방어는 DB 의 lower(project_no) 유니크 인덱스다 — 동시에 같은 번호가 들어오면 23505 를 같은 오류로 바꾼다.
//   4. service role 로 semi_projects 에 넣는다. 자동 발급용 칸(period_year·seq)은 비운다.
//
// 예전의 자동 발급(claim_semi_project_seq, PRJ-연도-순번)은 더 쓰지 않는다. 함수와 카운터 표는 DB 에 남겨 둔다.
// period_year·seq 를 비워 넣으려면 그 칸이 NULL 을 받아야 한다 — semi_project_no_manual.sql 을 먼저 적용한다.
//
// 클라이언트를 둘로 나눠 쓴다. 섞으면 안 된다.
//   세션 클라이언트 — 로그인 확인(접근 검사 안에서).
//   service role   — 조회·insert·update. semi_projects 에는 읽기 정책만 있다(쓰기는 막혀 있다).
//
// created_by 는 본문 값을 쓰지 않고 세션에서 강제한다. created_at·updated_at 은 DB 기본값(now())이 채운다.
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { authorizeSemiContact } from '@/lib/semiContactServer'
import { isSuperAdmin } from '@/lib/permissions'
import { emptyInput, toStorage, validateReport, type FieldKey } from '@/lib/semiContact'
import {
  PROJECT_KEYS, PROJECT_NO_DUP_MESSAGE, PROJECT_NO_KEY, PROJECT_TEXT_MAX, cleanProjectNo, validateProjectNo,
} from '@/lib/semiContact/project'

const TAG = 'semi-contact/project'

type Caller = { engineer_id: number; permission_level: string | null; teams: string | null }

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (message: string, status = 400, extra?: Record<string, unknown>) =>
  NextResponse.json({ error: message, ...extra }, { status })

/** 사람에게 보여줄 사유 — message 와 code 만(details·hint 는 SQL 이 섞여 화면에 내지 않는다). */
function reasonOf(e: unknown): string {
  const o = (e ?? {}) as { message?: unknown; code?: unknown }
  const msg = typeof o.message === 'string' && o.message ? o.message : '알 수 없는 오류'
  const code = typeof o.code === 'string' && o.code ? ` (${o.code})` : ''
  return `${msg}${code}`
}

const envReady = (): boolean =>
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * 같은 Project 번호가 이미 있는가(대소문자 무시). excludeId 는 정보 수정 때 자기 자신을 빼려고 쓴다.
 * 조회가 실패하면 null — 부르는 쪽이 500 으로 돌려준다.
 *
 * ilike 로 찾지 않는다 — 번호는 자유 형식이라 % _ 뿐 아니라 * 도 올 수 있는데, PostgREST 는 like 패턴의 * 를
 * % 로 바꿔 와일드카드로 읽는다(이스케이프로 막을 수 없다). Project 는 많지 않으므로 번호만 읽어 소문자로 견준다.
 * DB 의 lower(project_no) 유니크 인덱스와 같은 기준이다(동시 저장은 그 인덱스가 23505 로 막는다).
 */
async function projectNoTaken(sb: ReturnType<typeof admin>, projectNo: string, excludeId?: number): Promise<boolean | null> {
  const { data, error } = await sb.from('semi_projects').select('project_id, project_no')
  if (error) {
    console.error(`[${TAG}] project_no lookup failed`, { projectNo, error })
    return null
  }
  const target = projectNo.toLowerCase()
  return ((data ?? []) as { project_id: number; project_no: string }[])
    .some(r => r.project_id !== excludeId && r.project_no.toLowerCase() === target)
}

/** DB 가 번호 중복(23505)이나 아직 NULL 을 못 받는 칸(23502)으로 막았을 때의 응답. 그 밖이면 null. */
function dbConstraintResponse(e: { code?: string } | null): NextResponse | null {
  if (e?.code === '23505') return bad('입력값을 확인해주세요.', 400, { fieldErrors: { [PROJECT_NO_KEY]: PROJECT_NO_DUP_MESSAGE } })
  if (e?.code === '23502') {
    return bad('DB 설정이 아직 바뀌지 않았습니다(semi_project_no_manual.sql 미적용). 관리자에게 알려주세요.', 500)
  }
  return null
}

/**
 * 로그인 + 접촉 보고서 접근 권한./**
 * 로그인 + 접촉 보고서 접근 권한. 판정은 공용 함수 authorizeSemiContact(lib/semiContactServer.ts)가 한다 —
 * 화면 가드와 같은 규칙(반도체 팀 + contact_semi 권한, 또는 사업부 전환 권한자). 메시지·상태 코드는 종전과 같다.
 */
async function authorize(): Promise<{ error: NextResponse; caller: null } | { error: null; caller: Caller }> {
  return authorizeSemiContact(TAG)
}

export async function POST(req: NextRequest) {
  try {
    return await handle(req)
  } catch (e) {
    console.error(`[${TAG}] POST 처리 중 예외`, e)
    return bad(`Project 를 만드는 중 오류: ${reasonOf(e)}`, 500)
  }
}

async function handle(req: NextRequest) {
  if (!envReady()) {
    console.error(`[${TAG}] 환경 변수 누락 — SUPABASE URL 또는 SERVICE_ROLE_KEY`)
    return bad('서버 설정 오류 — 환경 변수가 없습니다. 관리자에게 알려주세요.', 500)
  }
  const auth = await authorize()
  if (auth.error) return auth.error
  const caller = auth.caller

  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  // Project 번호와 Project 칸만 꺼낸다. 다른 키는 무시한다(보고서 칸·created_by 등은 본문에서 받지 않는다).
  const projectNo = cleanProjectNo(body[PROJECT_NO_KEY])
  const input = emptyInput()
  for (const k of PROJECT_KEYS) {
    const v = body[k]
    input[k] = typeof v === 'string' ? v : ''
  }

  // 검증은 등록표의 규칙(lib/semiContact/validate.ts)을 그대로 쓴다. 그 함수는 보고서 한 장을 통째로 보므로
  // Project 칸의 오류만 골라낸다(접촉일·FACT·Action 같은 칸은 이 단계의 입력이 아니다).
  const checked = validateReport(input, [], { noAction: true })
  const fieldErrors: Partial<Record<FieldKey | typeof PROJECT_NO_KEY, string>> = {}
  const noErr = validateProjectNo(projectNo)
  if (noErr) fieldErrors[PROJECT_NO_KEY] = noErr
  for (const k of PROJECT_KEYS) {
    const msg = checked.errors[k]
    if (msg) fieldErrors[k] = msg
    else if (input[k].trim().length > PROJECT_TEXT_MAX) fieldErrors[k] = `${PROJECT_TEXT_MAX}자까지 입력할 수 있습니다`
  }
  if (Object.keys(fieldErrors).length > 0) {
    return bad('입력값을 확인해주세요.', 400, { fieldErrors })
  }

  // 저장 모양(앞뒤 공백 제거, 빈 칸은 null)도 등록표의 변환을 쓴다.
  const project = toStorage(input).project
  const sb = admin()

  const taken = await projectNoTaken(sb, projectNo)
  if (taken === null) return bad('Project 번호를 확인하지 못했습니다.', 500)
  if (taken) return bad('입력값을 확인해주세요.', 400, { fieldErrors: { [PROJECT_NO_KEY]: PROJECT_NO_DUP_MESSAGE } })

  const { data: made, error: insErr } = await sb
    .from('semi_projects')
    .insert({
      project_no: projectNo,
      // 자동 발급을 쓰지 않으므로 발급 근거 칸은 비운다.
      period_year: null,
      seq: null,
      customer_name: project.customer_name,
      site_dept: project.site_dept,
      title: project.title,
      // 본문 값을 쓰지 않는다 — 만든 사람이 곧 세션의 호출자다.
      created_by: caller.engineer_id,
    })
    .select('project_id, project_no, customer_name, site_dept, title, created_at')
    .single()

  if (insErr || !made) {
    const known = dbConstraintResponse(insErr)
    console.error(`[${TAG}] insert failed`, { projectNo, error: insErr })
    return known ?? bad(`Project 를 저장하지 못했습니다: ${reasonOf(insErr)}`, 500)
  }

  console.log(`[${TAG}] 만듦`, { projectNo, by: caller.engineer_id })
  return NextResponse.json({ project: made })
}

// ════════════════════════════════════════════════════════════════════
// 삭제 — DELETE /api/semi-contact/project?project_id=<id>
//
// 허용: 접근 검사(authorizeSemiContact) 통과 + (Project 를 만든 본인 또는 superadmin). 아니면 403, 없으면 404.
// 삭제 순서: Action → 보고서 → Project.
//   semi_contact_reports·semi_actions 의 Project FK 가 on delete restrict 라(semi_contact_schema.sql)
//   Project 만 지우면 막힌다. 그래서 딸린 것을 먼저 지운다. 세 번의 호출이라 DB 트랜잭션으로 묶이지 않는다 —
//   중간에 실패하면 앞 단계까지만 지워진 채 오류를 돌려준다(FK 를 어기는 상태는 생기지 않고, 다시 누르면 남은 것을 지운다).
// Project 번호는 되돌리지 않는다(semi_project_sequence 는 건드리지 않는다 — 번호 재사용 금지).
// ════════════════════════════════════════════════════════════════════
export async function DELETE(req: NextRequest) {
  try {
    return await handleDelete(req)
  } catch (e) {
    console.error(`[${TAG}] DELETE 처리 중 예외`, e)
    return bad(`Project 를 삭제하는 중 오류: ${reasonOf(e)}`, 500)
  }
}

async function handleDelete(req: NextRequest) {
  if (!envReady()) {
    console.error(`[${TAG}] 환경 변수 누락 — SUPABASE URL 또는 SERVICE_ROLE_KEY`)
    return bad('서버 설정 오류 — 환경 변수가 없습니다. 관리자에게 알려주세요.', 500)
  }
  const auth = await authorize()
  if (auth.error) return auth.error
  const caller = auth.caller

  const projectId = Number(new URL(req.url).searchParams.get('project_id'))
  if (!Number.isInteger(projectId) || projectId <= 0) return bad('Project 가 지정되지 않았습니다.')

  const sb = admin()
  const { data: project, error: findErr } = await sb
    .from('semi_projects')
    .select('project_id, project_no, created_by')
    .eq('project_id', projectId)
    .maybeSingle()
  if (findErr) {
    console.error(`[${TAG}] project lookup failed`, { projectId, error: findErr })
    return bad('Project 를 확인하지 못했습니다.', 500)
  }
  if (!project) return bad('Project 를 찾을 수 없습니다.', 404)

  const row = project as { project_id: number; project_no: string; created_by: number }
  if (row.created_by !== caller.engineer_id && !isSuperAdmin(caller)) {
    return bad('Project 를 만든 본인이나 관리자만 삭제할 수 있습니다.', 403)
  }

  // 1) Action
  const { data: delActions, error: aErr } = await sb
    .from('semi_actions').delete().eq('project_id', projectId).select('action_id')
  if (aErr) {
    console.error(`[${TAG}] actions delete failed`, { projectId, error: aErr })
    return bad(`Action 을 삭제하지 못했습니다: ${reasonOf(aErr)}`, 500)
  }
  const actions = (delActions ?? []).length

  // 2) 보고서
  const { data: delReports, error: rErr } = await sb
    .from('semi_contact_reports').delete().eq('project_id', projectId).select('report_id')
  if (rErr) {
    console.error(`[${TAG}] reports delete failed — Action 은 이미 지워졌다`, { projectId, actions, error: rErr })
    return bad(`보고서를 삭제하지 못했습니다(Action ${actions}건은 이미 삭제됨): ${reasonOf(rErr)}`, 500)
  }
  const reports = (delReports ?? []).length

  // 3) Project
  const { error: pErr } = await sb.from('semi_projects').delete().eq('project_id', projectId)
  if (pErr) {
    console.error(`[${TAG}] project delete failed — 보고서·Action 은 이미 지워졌다`, { projectId, reports, actions, error: pErr })
    return bad(`Project 를 삭제하지 못했습니다(보고서 ${reports}건·Action ${actions}건은 이미 삭제됨): ${reasonOf(pErr)}`, 500)
  }

  console.log(`[${TAG}] 삭제`, { projectId, projectNo: row.project_no, reports, actions, by: caller.engineer_id })
  return NextResponse.json({ deleted: { reports, actions } })
}

// ════════════════════════════════════════════════════════════════════
// 정보 수정 — PATCH /api/semi-contact/project
//   body {project_id, project_no, customer_name, site_dept, title}. 번호도 고칠 수 있다(만들 때와 같은 검증·중복 검사,
//   자기 자신은 빼고 본다).
//
// 허용: 접근 검사(authorize) 통과 + (Project 를 만든 본인 또는 superadmin). 아니면 403, 없으면 404.
// 검증은 만들 때(POST)와 같다 — 등록표 검증(validateReport)에서 Project 칸 오류만 골라내고, 길이 상한은 PROJECT_TEXT_MAX.
// ════════════════════════════════════════════════════════════════════
export async function PATCH(req: NextRequest) {
  try {
    return await handlePatch(req)
  } catch (e) {
    console.error(`[${TAG}] PATCH 처리 중 예외`, e)
    return bad(`Project 를 수정하는 중 오류: ${reasonOf(e)}`, 500)
  }
}

async function handlePatch(req: NextRequest) {
  if (!envReady()) {
    console.error(`[${TAG}] 환경 변수 누락 — SUPABASE URL 또는 SERVICE_ROLE_KEY`)
    return bad('서버 설정 오류 — 환경 변수가 없습니다. 관리자에게 알려주세요.', 500)
  }
  const auth = await authorize()
  if (auth.error) return auth.error
  const caller = auth.caller

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const projectId = Number(body.project_id)
  if (!Number.isInteger(projectId) || projectId <= 0) return bad('Project 가 지정되지 않았습니다.')

  const sb = admin()
  const { data: found, error: findErr } = await sb
    .from('semi_projects')
    .select('project_id, created_by')
    .eq('project_id', projectId)
    .maybeSingle()
  if (findErr) {
    console.error(`[${TAG}] project lookup failed`, { projectId, error: findErr })
    return bad('Project 를 확인하지 못했습니다.', 500)
  }
  if (!found) return bad('Project 를 찾을 수 없습니다.', 404)
  if ((found as { created_by: number }).created_by !== caller.engineer_id && !isSuperAdmin(caller)) {
    return bad('Project 를 만든 본인이나 관리자만 수정할 수 있습니다.', 403)
  }

  // 번호와 Project 칸만 꺼낸다 — 다른 키는 무시한다.
  const projectNo = cleanProjectNo(body[PROJECT_NO_KEY])
  const input = emptyInput()
  for (const k of PROJECT_KEYS) {
    const v = body[k]
    input[k] = typeof v === 'string' ? v : ''
  }
  const checked = validateReport(input, [], { noAction: true })
  const fieldErrors: Partial<Record<FieldKey | typeof PROJECT_NO_KEY, string>> = {}
  const noErr = validateProjectNo(projectNo)
  if (noErr) fieldErrors[PROJECT_NO_KEY] = noErr
  for (const k of PROJECT_KEYS) {
    const msg = checked.errors[k]
    if (msg) fieldErrors[k] = msg
    else if (input[k].trim().length > PROJECT_TEXT_MAX) fieldErrors[k] = `${PROJECT_TEXT_MAX}자까지 입력할 수 있습니다`
  }
  if (Object.keys(fieldErrors).length > 0) return bad('입력값을 확인해주세요.', 400, { fieldErrors })

  const taken = await projectNoTaken(sb, projectNo, projectId)
  if (taken === null) return bad('Project 번호를 확인하지 못했습니다.', 500)
  if (taken) return bad('입력값을 확인해주세요.', 400, { fieldErrors: { [PROJECT_NO_KEY]: PROJECT_NO_DUP_MESSAGE } })

  const project = toStorage(input).project
  const { data: saved, error: upErr } = await sb
    .from('semi_projects')
    .update({
      project_no: projectNo,
      customer_name: project.customer_name,
      site_dept: project.site_dept,
      title: project.title,
      updated_at: new Date().toISOString(),
    })
    .eq('project_id', projectId)
    .select('project_id, project_no, customer_name, site_dept, title')
    .single()
  if (upErr || !saved) {
    const known = dbConstraintResponse(upErr)
    console.error(`[${TAG}] project update failed`, { projectId, error: upErr })
    return known ?? bad(`Project 를 수정하지 못했습니다: ${reasonOf(upErr)}`, 500)
  }

  console.log(`[${TAG}] 정보 수정`, { projectId, by: caller.engineer_id })
  return NextResponse.json({ project: saved })
}
