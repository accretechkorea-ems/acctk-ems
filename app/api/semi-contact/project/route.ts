// 반도체 고객 접촉 보고 — 새 Project 만들기(번호 발급 포함).
//
// 흐름은 의뢰서 발급(app/api/inquiry/route.ts 의 create)을 그대로 따른다.
//   1. 접근 검사(lib/semiContactServer.ts) — 세션으로 로그인 확인, service role 로 engineers·팀 사업부를 읽어
//      반도체 팀 + contact_semi 권한 또는 사업부 전환 권한자만 통과. 없으면 403.
//   2. 본문에서 Project 칸(등록표의 storage 'project')만 꺼내 lib/semiContact 의 검증으로 확인한다.
//   3. service role 로 claim_semi_project_seq(연도) 를 불러 순번을 받고 PRJ-연도-순번 을 만든다.
//   4. service role 로 semi_projects 에 넣는다.
//
// 클라이언트를 둘로 나눠 쓴다. 섞으면 안 된다.
//   세션 클라이언트 — 로그인 확인(접근 검사 안에서).
//   service role   — 채번 함수와 insert. semi_projects 에는 읽기 정책만 있고(쓰기는 막혀 있다),
//                    claim_semi_project_seq 의 EXECUTE 도 service_role 에만 있다(semi_contact_schema.sql).
//
// created_by 는 본문 값을 쓰지 않고 세션에서 강제한다. created_at·updated_at 은 DB 기본값(now())이 채운다.
//
// 번호가 발급됐는데 저장이 실패하면 — 그 번호는 버린다(되돌리지 않는다, 번호에 구멍이 생기는 것을 허용한다).
//   채번과 insert 는 서로 다른 호출이라 insert 실패 때 카운터를 되돌릴 수 없고, 되돌리려다 다른 사람이
//   그 사이에 받은 번호와 겹치면 더 위험하다(의뢰서와 같은 원칙: 구멍보다 중복이 훨씬 위험하다).
//   번호가 겹친 경우(23505)만 새 번호로 다시 시도하고, 그 밖의 실패는 오류로 돌려준다.
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { authorizeSemiContact } from '@/lib/semiContactServer'
import { todayKST } from '@/lib/date'
import { emptyInput, toStorage, validateReport, type FieldKey } from '@/lib/semiContact'
import { PROJECT_KEYS, PROJECT_TEXT_MAX, buildProjectNo } from '@/lib/semiContact/project'

const TAG = 'semi-contact/project'

/** 번호가 겹쳤을 때 다시 발급해 보는 횟수(의뢰서와 같은 값). 채번이 원자적이라 정상 흐름에서는 겹치지 않는다. */
const MAX_TRIES = 5

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

/** rpc 가 「함수가 없다」고 답했는가 — semi_contact_schema.sql 을 아직 적용하지 않은 경우다. */
const isMissingFunction = (e: unknown): boolean => {
  const o = (e ?? {}) as { code?: unknown; message?: unknown }
  if (o.code === 'PGRST202') return true
  return typeof o.message === 'string' && /could not find the function/i.test(o.message)
}

/**
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

  // Project 칸만 꺼낸다. 다른 키는 무시한다(보고서 칸·created_by 등은 본문에서 받지 않는다).
  const input = emptyInput()
  for (const k of PROJECT_KEYS) {
    const v = body[k]
    input[k] = typeof v === 'string' ? v : ''
  }

  // 검증은 등록표의 규칙(lib/semiContact/validate.ts)을 그대로 쓴다. 그 함수는 보고서 한 장을 통째로 보므로
  // Project 칸의 오류만 골라낸다(접촉일·FACT·Action 같은 칸은 이 단계의 입력이 아니다).
  const checked = validateReport(input, [], { noAction: true })
  const fieldErrors: Partial<Record<FieldKey, string>> = {}
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

  // 연도는 한국 시간 기준이다. 서버(Vercel)는 UTC 라 new Date().getFullYear() 를 쓰면
  // 1월 1일 0~9시에 전년도 번호가 나간다.
  const year = Number(todayKST().slice(0, 4))
  const sb = admin()

  for (let i = 0; i < MAX_TRIES; i++) {
    const { data: seqData, error: seqErr } = await sb.rpc('claim_semi_project_seq', { p_year: year })
    if (seqErr) {
      console.error(`[${TAG}] claim_semi_project_seq failed`, { year, error: seqErr })
      if (isMissingFunction(seqErr)) {
        return bad('번호 발급 함수가 DB 에 없습니다. 관리자에게 알려주세요(semi_contact_schema.sql 미적용).', 500)
      }
      return bad('Project 번호를 발급하지 못했습니다.', 500)
    }
    const seq = Number(seqData)
    if (!Number.isInteger(seq) || seq < 1) {
      console.error(`[${TAG}] claim_semi_project_seq 가 이상한 값을 돌려줬다`, { year, seqData })
      return bad('Project 번호를 발급하지 못했습니다.', 500)
    }
    const projectNo = buildProjectNo(year, seq)

    const { data: made, error: insErr } = await sb
      .from('semi_projects')
      .insert({
        project_no: projectNo,
        period_year: year,
        seq,
        customer_name: project.customer_name,
        site_dept: project.site_dept,
        title: project.title,
        // 본문 값을 쓰지 않는다 — 만든 사람이 곧 세션의 호출자다.
        created_by: caller.engineer_id,
      })
      .select('project_id, project_no, customer_name, site_dept, title, created_at')
      .single()

    if (!insErr && made) {
      console.log(`[${TAG}] 발급`, { projectNo, by: caller.engineer_id })
      return NextResponse.json({ project: made })
    }

    // 23505 = unique_violation. 번호가 겹친 것이므로 이 번호는 버리고 다음 번호로 다시 해 본다.
    if (insErr?.code === '23505') {
      console.error(`[${TAG}] 번호 중복 — 버리고 다시 발급한다`, { projectNo, try: i + 1 })
      continue
    }

    // 그 밖의 실패 — 발급된 번호는 버린다(되돌리지 않는다. 맨 위 설명).
    console.error(`[${TAG}] insert failed — 발급된 번호는 버린다`, { projectNo, error: insErr })
    return bad(`Project 를 저장하지 못했습니다: ${reasonOf(insErr)}`, 500)
  }

  console.error(`[${TAG}] 번호 발급을 ${MAX_TRIES}회 시도했지만 계속 겹쳤다`, { year })
  return bad('번호가 계속 겹칩니다. 잠시 뒤 다시 시도해주세요.', 409)
}
