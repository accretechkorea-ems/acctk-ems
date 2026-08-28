import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { canManageEngineers } from '@/lib/permissions'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  // 인증 확인
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 권한 확인 (계정 관리는 superadmin 전용)
  const { data: caller } = await supabase
    .from('engineers')
    .select('permission_level')
    .eq('email', user.email!)
    .single()
  if (!caller || !canManageEngineers(caller)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { engineer_id, email, resigned_date } = body

  // 필수 입력값 검증
  if (!engineer_id || !email?.trim()) {
    return NextResponse.json({ error: 'engineer_id와 email은 필수입니다.' }, { status: 400 })
  }

  // 퇴사일 검증 (YYYY-MM-DD). 미입력 시 오늘 날짜.
  let resignedDate: string
  if (resigned_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(resigned_date)) {
      return NextResponse.json({ error: '유효하지 않은 퇴사일 형식입니다.' }, { status: 400 })
    }
    resignedDate = resigned_date
  } else {
    resignedDate = new Date().toISOString().slice(0, 10)
  }

  // 자기 자신은 퇴사 처리 불가
  if (user.email === email.trim()) {
    return NextResponse.json({ error: '자기 자신은 퇴사 처리할 수 없습니다.' }, { status: 400 })
  }

  // 대상 권한 확인 — superadmin 계정은 superadmin 만 퇴사 처리할 수 있다.
  // (계정 관리 자체가 superadmin 전용이라 지금은 항상 통과하지만, 권한이 넓어져도 안전하도록 남긴다)
  const { data: target } = await supabase
    .from('engineers')
    .select('permission_level')
    .eq('engineer_id', engineer_id)
    .single()

  if (target?.permission_level === 'superadmin' && caller.permission_level !== 'superadmin') {
    return NextResponse.json({ error: '해당 계정을 퇴사 처리할 권한이 없습니다.' }, { status: 403 })
  }

  // 1. engineers 행은 보존하고 퇴사일 기록 + 이메일 회수 (과거 서비스/견적/실적 기록 유지)
  //    - email 을 비우면 재입사 시 create-user 의 upsert(onConflict:'email')가 이 행을 덮어쓰지 않고
  //      새 행을 만든다. 옛 행은 과거 기록의 작성자로 그대로 남는다.
  //    - Auth 계정이 나중에 같은 이메일로 다시 만들어져도 이 행에 권한이 붙지 않는다
  //      (RLS 함수가 engineers.email 로 로그인 사용자를 찾으므로).
  //    - permission_level 은 건드리지 않는다.
  //    - teams(문자열)는 반드시 남긴다 — 실적·활동의 팀별 집계가 이 값으로 이뤄지므로
  //      비우면 퇴사자의 과거 기여분이 팀 소계에서 사라진다.
  //    - 반대로 team_id(teams.id FK)는 끊는다. 앱은 이 컬럼을 읽는 곳이 한 곳도 없고,
  //      값이 남아 있으면 그 팀을 지울 때 FK 위반(23503)으로 삭제가 막히기 때문이다.
  //      즉 표시·집계용 소속(teams)은 남기고, 참조 무결성만 끊는다.
  const { error: updateError } = await supabaseAdmin
    .from('engineers')
    .update({ resigned_date: resignedDate, email: null, team_id: null })
    .eq('engineer_id', engineer_id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 })
  }

  // 2. 로그인(Auth) 계정 삭제 — 더 이상 로그인 불가.
  //    여기서 실패해도 위 퇴사 처리는 이미 끝났으므로 400 으로 되돌리지 않는다.
  //    대신 무엇이 되고 무엇이 안 됐는지 warning 으로 구분해 알린다.
  const targetEmail = email.trim()
  let authWarning: string | null = null
  try {
    // listUsers 는 페이지 단위(기본 50건)라, 한 번 못 찾았다고 단정하지 않고 끝까지 훑는다.
    const PER_PAGE = 200
    let targetUser: { id: string } | null = null
    for (let page = 1; page <= 20 && !targetUser; page++) {
      const { data: users, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PER_PAGE })
      if (listErr) throw listErr
      targetUser = users.users.find(u => u.email === targetEmail) ?? null
      if (users.users.length < PER_PAGE) break
    }
    if (targetUser) {
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(targetUser.id)
      if (delErr) throw delErr
    }
    // 계정이 아예 없으면(이미 지워졌거나 만든 적 없음) 목적은 이미 달성된 상태라 경고하지 않는다.
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[delete-user] auth account delete failed', { engineer_id, error: msg })
    authWarning = `직원은 퇴사 처리됐으나 로그인 계정 삭제에 실패했습니다 (${msg}). Supabase 인증에서 직접 삭제해주세요`
  }

  return NextResponse.json({ success: true, authDeleted: !authWarning, warning: authWarning })
}
