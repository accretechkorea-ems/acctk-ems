// 반도체 고객 접촉 보고 — 접촉 보고서 한 장 저장(새로 쓰기만. 수정 PATCH 는 다음 단계).
//
// 흐름(로그인·권한·클라이언트 구분은 app/api/semi-contact/project/route.ts 와 같다)
//   1. 접근 검사(lib/semiContactServer.ts) — 반도체 팀 + contact_semi 권한 또는 사업부 전환 권한자만. 없으면 403.
//   2. project_id 가 실제로 있는지 service role 로 확인한다. 없으면 404.
//   3. 본문의 필드 값(등록표 36칸)·Action 줄·「Action 없음」을 lib/semiContact 의 validateReport 로 검증한다.
//      Project 칸(고객사·사업장/부서·Project/구매안건)은 본문 값을 쓰지 않고 방금 읽은 Project 값으로 채운다 —
//      이 라우트는 Project 정보를 고치지 않고, 그 칸의 정본은 semi_projects 다(prefill.ts 와 같은 규칙).
//   4. toStorage 로 칸(column)·detail jsonb 를 나눠 semi_contact_reports 에 넣는다.
//      author_id·updated_by 는 본문이 아니라 로그인한 사람으로 강제한다.
//      「Action 없음」은 detail.no_action = true 로 넣는다(false 면 키를 넣지 않는다 — detail 은 빈 값을 키째 뺀다).
//   5. 빈 줄을 뺀 Action 을 actionToStorage 로 바꿔 semi_actions 에 한 번에 넣는다.
//      owner_name 은 담당 팀 이름 문자열이다(담당은 사람이 아니라 팀). owner_id 는 이번 단계에서 null 로 강제한다.
//   6. semi_projects.updated_at 을 지금으로 갱신한다(트리거가 아니라 라우트가 직접 넣는 레포 관례).
//
// 두 저장의 묶음 처리 — 보고서 insert 와 Action insert 는 서로 다른 호출이라 DB 트랜잭션으로 묶이지 않는다.
//   그래서 Action insert 가 실패하면 방금 만든 보고서를 지워(semi_contact_reports delete) 저장 전으로 되돌리고
//   오류를 돌려준다. Action 은 여러 줄을 insert 한 번으로 넣으므로 일부 줄만 들어가는 일은 없고, 혹시 남아도
//   semi_actions 의 보고서 FK 가 on delete cascade 라 보고서와 함께 지워진다.
//   되돌리는 delete 마저 실패하면(드묾) Action 없는 보고서가 남는다 — 그 report_id 를 서버 로그와 오류 응답에 실어
//   사람이 지울 수 있게 한다.
//   Project updated_at 갱신은 보고서가 이미 저장된 뒤라 실패해도 되돌리지 않는다(로그만 남긴다 — 목록 정렬용 시각이다).
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { authorizeSemiContact } from '@/lib/semiContactServer'
import {
  FIELD_KEYS, emptyInput, meaningfulActions, toStorage, actionToStorage, validateReport,
  type ActionField, type ActionInput, type FieldKey,
} from '@/lib/semiContact'
import { PROJECT_KEYS } from '@/lib/semiContact/project'

const TAG = 'semi-contact/report'

/** 한 보고서에 받는 Action 줄 상한. 화면이 이보다 많이 보낼 일은 없다 — 잘못된 요청을 막는 안전 상한이다. */
const ACTIONS_MAX = 50

/** 칸 하나의 길이 상한. 긴 글(회의 내용 등)도 넉넉히 들어가는 값이다 — 잘못된 요청을 막는 안전 상한이다. */
const FIELD_TEXT_MAX = 10_000

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
 * 로그인 + 접촉 보고서 접근 권한. 판정은 공용 함수 authorizeSemiContact(lib/semiContactServer.ts)가 한다 —
 * 화면 가드와 같은 규칙(반도체 팀 + contact_semi 권한, 또는 사업부 전환 권한자). 메시지·상태 코드는 종전과 같다.
 */
async function authorize(): Promise<{ error: NextResponse; caller: null } | { error: null; caller: Caller }> {
  return authorizeSemiContact(TAG)
}

/** 문자열만 받는다(그 밖은 빈 값). */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 본문의 Action 한 줄을 입력 모양으로. owner_id 는 받지 않는다(이번 단계는 null 강제). */
function actionOf(v: unknown): Partial<ActionInput> {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    what: str(o.what),
    owner: str(o.owner),
    owner_id: null,
    due_date: str(o.due_date),
    status: str(o.status),
    priority: str(o.priority),
    note: str(o.note),
  }
}

export async function POST(req: NextRequest) {
  try {
    return await handle(req)
  } catch (e) {
    console.error(`[${TAG}] POST 처리 중 예외`, e)
    return bad(`접촉 보고서를 저장하는 중 오류: ${reasonOf(e)}`, 500)
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

  // ── project_id ──
  const projectId = Number(body.project_id)
  if (!Number.isInteger(projectId) || projectId <= 0) return bad('Project 가 지정되지 않았습니다.')

  const sb = admin()
  const { data: project, error: projErr } = await sb
    .from('semi_projects')
    .select('project_id, customer_name, site_dept, title')
    .eq('project_id', projectId)
    .maybeSingle()
  if (projErr) {
    console.error(`[${TAG}] project lookup failed`, { projectId, error: projErr })
    return bad('Project 를 확인하지 못했습니다.', 500)
  }
  if (!project) return bad('Project 를 찾을 수 없습니다.', 404)

  // ── 필드 값 — 등록표에 있는 키만, 문자열만 ──
  const rawFields = (body.fields && typeof body.fields === 'object' ? body.fields : {}) as Record<string, unknown>
  const input = emptyInput()
  for (const k of FIELD_KEYS) input[k] = str(rawFields[k])
  // Project 칸은 본문 값을 쓰지 않는다 — 저장된 Project 값으로 채운다(맨 위 설명).
  const projectRow = project as Record<string, unknown>
  for (const k of PROJECT_KEYS) input[k] = str(projectRow[k])

  // ── Action 줄 ──
  if (body.actions != null && !Array.isArray(body.actions)) return bad('Action 목록 형식이 올바르지 않습니다.')
  const rawActions = (Array.isArray(body.actions) ? body.actions : []).map(actionOf)
  if (rawActions.length > ACTIONS_MAX) return bad(`Action 은 ${ACTIONS_MAX}줄까지 넣을 수 있습니다.`)
  const noAction = body.no_action === true

  // ── 검증 ──
  const checked = validateReport(input, rawActions, { noAction })
  const fieldErrors: Partial<Record<FieldKey | 'actions', string>> = { ...checked.errors }
  for (const k of FIELD_KEYS) {
    if (!fieldErrors[k] && input[k].length > FIELD_TEXT_MAX) fieldErrors[k] = `${FIELD_TEXT_MAX.toLocaleString()}자까지 입력할 수 있습니다`
  }
  // validateReport 의 줄별 오류는 빈 줄을 뺀 순서다. 화면이 칸 옆에 붙일 수 있게 본문의 원래 줄 번호로 돌려준다.
  const keptIndexes = rawActions.map((a, i) => ({ a, i })).filter(({ a }) => meaningfulActions([a]).length > 0).map(({ i }) => i)
  const actionErrors: { index: number; errors: Partial<Record<ActionField, string>> }[] = []
  checked.actionErrors.forEach((errs, j) => {
    if (Object.keys(errs).length > 0) actionErrors.push({ index: keptIndexes[j], errors: errs })
  })
  if (Object.keys(fieldErrors).length > 0 || actionErrors.length > 0) {
    return bad('입력값을 확인해주세요.', 400, { fieldErrors, actionErrors })
  }

  // ── 보고서 저장 ──
  const parts = toStorage(input)
  const detail: Record<string, unknown> = { ...parts.detail }
  if (noAction) detail.no_action = true

  const { data: made, error: repErr } = await sb
    .from('semi_contact_reports')
    .insert({
      ...parts.report,          // contact_date · contact_method · customer_contact · purpose · fact · next_contact_date
      project_id: projectId,
      detail,
      // 본문 값을 쓰지 않는다 — 쓴 사람이 곧 세션의 호출자다.
      author_id: caller.engineer_id,
      updated_by: caller.engineer_id,
    })
    .select('report_id')
    .single()
  if (repErr || !made) {
    console.error(`[${TAG}] report insert failed`, { projectId, error: repErr })
    return bad(`접촉 보고서를 저장하지 못했습니다: ${reasonOf(repErr)}`, 500)
  }
  const reportId = Number((made as { report_id: number }).report_id)

  // ── Action 저장 — 실패하면 보고서를 지워 되돌린다(맨 위 설명) ──
  const actionRows = meaningfulActions(rawActions).map(a => ({
    ...actionToStorage(a),
    owner_id: null,           // 이번 단계는 담당이 팀 이름 문자열뿐이다
    report_id: reportId,
    project_id: projectId,
  }))
  if (actionRows.length > 0) {
    const { error: actErr } = await sb.from('semi_actions').insert(actionRows)
    if (actErr) {
      console.error(`[${TAG}] actions insert failed — 보고서를 지워 되돌린다`, { reportId, error: actErr })
      const { error: delErr } = await sb.from('semi_contact_reports').delete().eq('report_id', reportId)
      if (delErr) {
        console.error(`[${TAG}] 되돌리기 실패 — Action 없는 보고서가 남았다`, { reportId, error: delErr })
        return bad(
          `Action 을 저장하지 못했고, 먼저 저장된 보고서(번호 ${reportId})를 지우지도 못했습니다. 관리자에게 알려주세요.`,
          500, { orphanReportId: reportId },
        )
      }
      return bad(`Action 을 저장하지 못해 보고서 저장을 취소했습니다: ${reasonOf(actErr)}`, 500)
    }
  }

  // ── Project 의 마지막 변경 시각 — 실패해도 되돌리지 않는다 ──
  const { error: touchErr } = await sb
    .from('semi_projects')
    .update({ updated_at: new Date().toISOString() })
    .eq('project_id', projectId)
  if (touchErr) console.error(`[${TAG}] project updated_at 갱신 실패(보고서는 저장됨)`, { projectId, reportId, error: touchErr })

  console.log(`[${TAG}] 저장`, { reportId, projectId, actions: actionRows.length, by: caller.engineer_id })
  return NextResponse.json({ report_id: reportId })
}
