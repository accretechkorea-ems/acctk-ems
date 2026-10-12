// 반도체 고객 접촉 보고 — Action 상태 바꾸기.
//   PATCH /api/semi-contact/action  body {action_id, status}
//
// 허용: 접근 검사(authorizeSemiContact)만 통과하면 누구나 — Action 의 담당은 사람이 아니라 팀이라,
// 보고서 작성자가 아니어도 처리 결과(상태)를 바꿀 수 있어야 한다. 401·403 형식은 다른 접촉 보고서 라우트와 같다.
// 이 라우트는 상태(status)만 바꾼다 — 본문에 다른 칸이 와도 쓰지 않는다. 상태 값은 등록표(ACTION_STATUSES)의 것만.
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { authorizeSemiContact } from '@/lib/semiContactServer'
import { ACTION_STATUSES } from '@/lib/semiContact'

const TAG = 'semi-contact/action'

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function PATCH(req: NextRequest) {
  try {
    return await handle(req)
  } catch (e) {
    console.error(`[${TAG}] PATCH 처리 중 예외`, e)
    return bad('Action 상태를 바꾸지 못했습니다.', 500)
  }
}

async function handle(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`[${TAG}] 환경 변수 누락 — SUPABASE URL 또는 SERVICE_ROLE_KEY`)
    return bad('서버 설정 오류 — 환경 변수가 없습니다. 관리자에게 알려주세요.', 500)
  }
  const auth = await authorizeSemiContact(TAG)
  if (auth.error) return auth.error

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const actionId = Number(body.action_id)
  if (!Number.isInteger(actionId) || actionId <= 0) return bad('Action 이 지정되지 않았습니다.')
  const status = typeof body.status === 'string' ? body.status.trim() : ''
  if (!(ACTION_STATUSES as readonly string[]).includes(status)) return bad('상태 값이 올바르지 않습니다.')

  const sb = admin()
  const { data, error } = await sb
    .from('semi_actions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('action_id', actionId)
    .select('action_id, status')
    .maybeSingle()
  if (error) {
    console.error(`[${TAG}] update failed`, { actionId, error })
    return bad('Action 상태를 바꾸지 못했습니다.', 500)
  }
  if (!data) return bad('Action 을 찾을 수 없습니다.', 404)

  console.log(`[${TAG}] 상태 변경`, { actionId, status, by: auth.caller.engineer_id })
  return NextResponse.json({ action: data })
}
