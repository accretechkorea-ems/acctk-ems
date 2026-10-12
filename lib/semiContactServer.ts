// 접촉 보고서 서버 라우트(/api/semi-contact/*)의 공용 접근 검사.
//
// 판정은 화면 가드(hooks/usePageGuard.ts)와 같은 함수 canAccessSemiContact(lib/division.ts)로 한다.
//   (a) 본인 팀의 사업부가 반도체 + contact_semi 메뉴 권한, 또는
//   (b) 사업부 전환 권한자(superadmin + engineers.can_switch_division)
//
// 로그인 확인만 세션 클라이언트로 하고, 판정 자료(engineers 의 권한 칸·전환 권한, 팀 메뉴·사업부)는
// service role 로 읽는다 — 판정 자료가 RLS 에 막혀 비면 안 된다(lib/teamPermsServer.ts 와 같은 이유).
// 팀 권한은 캐시를 건너뛰고 새로 읽는다(상태를 바꾸는 라우트들이다).
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { canAccessSemiContact } from '@/lib/division'

export type SemiCaller = {
  engineer_id: number
  permission_level: string | null
  teams: string | null
  can_switch_division: boolean | null
}

const bad = (message: string, status: number) => NextResponse.json({ error: message }, { status })

/** 로그인 + 접촉 보고서 접근 권한. 통과하면 caller 를 돌려준다. 메시지는 종전 라우트와 같다. */
export async function authorizeSemiContact(
  tag: string,
): Promise<{ error: NextResponse; caller: null } | { error: null; caller: SemiCaller }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: bad('로그인이 필요합니다. 다시 로그인해 주세요.', 401), caller: null }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data: row, error } = await sb
    .from('engineers')
    .select('engineer_id, permission_level, teams, can_switch_division')
    .eq('email', user.email)
    .single()
  if (error) console.error(`[${tag}] caller lookup failed`, { email: user.email, error })
  const caller = await withTeamPerm((row ?? null) as SemiCaller | null, { fresh: true })
  if (!caller || !canAccessSemiContact(caller)) {
    return { error: bad('이 메뉴를 사용할 권한이 없습니다.', 403), caller: null }
  }
  return { error: null, caller }
}
