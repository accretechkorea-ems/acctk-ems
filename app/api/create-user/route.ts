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
  const { email, password, name, position, teams, initials, office } = body

  // 필수 입력값 검증
  if (!email?.trim() || !password?.trim() || !name?.trim()) {
    return NextResponse.json({ error: 'email, password, name은 필수입니다.' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 })
  }

  // 1. Auth 계정 생성
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { name: name.trim() },
  })

  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

  // 이미 engineers 테이블에 있으면 update, 없으면 insert
  const { error: dbError } = await supabaseAdmin.from('engineers').upsert({
    name: name.trim(),
    position: position?.trim() || null,
    teams: teams?.trim() || null,
    initials: initials?.trim().toUpperCase() || null,
    email: email.trim(),
    office: office?.trim() || null,
  }, { onConflict: 'email' })

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 400 })

  return NextResponse.json({ success: true })
}
