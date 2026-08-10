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

  // 권한 확인 (superadmin 또는 manager만 허용)
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

  // 대상 권한 확인 — manager는 superadmin 또는 다른 manager 퇴사 처리 불가
  const { data: target } = await supabase
    .from('engineers')
    .select('permission_level')
    .eq('engineer_id', engineer_id)
    .single()

  if (target && ['superadmin', 'manager'].includes(target.permission_level)) {
    if (caller.permission_level !== 'superadmin') {
      return NextResponse.json({ error: '해당 계정을 퇴사 처리할 권한이 없습니다.' }, { status: 403 })
    }
  }

  // 1. engineers 행은 보존하고 퇴사일만 기록 (과거 서비스/견적/실적 기록 유지)
  const { error: updateError } = await supabaseAdmin
    .from('engineers')
    .update({ resigned_date: resignedDate })
    .eq('engineer_id', engineer_id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 })
  }

  // 2. 로그인(Auth) 계정 삭제 — 더 이상 로그인 불가
  const { data: users } = await supabaseAdmin.auth.admin.listUsers()
  const targetUser = users.users.find(u => u.email === email.trim())
  if (targetUser) {
    await supabaseAdmin.auth.admin.deleteUser(targetUser.id)
  }

  return NextResponse.json({ success: true })
}
