import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ALLOWED_POSITIONS = ['사장', '총괄', '수석', '책임', '선임', '사원']
const ALLOWED_PERMISSIONS = ['superadmin', 'manager', 'member']

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 호출자 권한 확인
  const { data: caller } = await supabase
    .from('engineers')
    .select('permission_level')
    .eq('email', user.email!)
    .single()
  if (!caller || !['superadmin', 'manager'].includes(caller.permission_level)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { engineer_id, name, position, teams, email, initials, permission_level, resigned_date, office } = body

  if (!engineer_id || !name?.trim()) {
    return NextResponse.json({ error: '필수 값 누락' }, { status: 400 })
  }

  // 입력값 검증
  if (position && !ALLOWED_POSITIONS.includes(position)) {
    return NextResponse.json({ error: '유효하지 않은 직책' }, { status: 400 })
  }

  const updateData: Record<string, unknown> = {
    name: name.trim(),
    position: position || null,
    teams: teams?.trim() || null,
    email: email?.trim() || null,
    initials: initials?.trim().toUpperCase() || null,
    office: office?.trim() || null,
  }

  // 복직 처리: resigned_date 를 명시적으로 보냈을 때만 반영 (null = 재직 복귀)
  if (resigned_date !== undefined) {
    if (resigned_date === null) {
      updateData.resigned_date = null
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(resigned_date)) {
      updateData.resigned_date = resigned_date
    } else {
      return NextResponse.json({ error: '유효하지 않은 퇴사일 형식입니다.' }, { status: 400 })
    }
  }

  // permission_level 변경은 superadmin만 가능
  if (permission_level !== undefined) {
    if (caller.permission_level !== 'superadmin') {
      return NextResponse.json({ error: '권한 변경은 최고관리자만 가능합니다.' }, { status: 403 })
    }
    if (!ALLOWED_PERMISSIONS.includes(permission_level)) {
      return NextResponse.json({ error: '유효하지 않은 권한 레벨' }, { status: 400 })
    }
    updateData.permission_level = permission_level
  }

  const { error } = await supabaseAdmin
    .from('engineers')
    .update(updateData)
    .eq('engineer_id', Number(engineer_id))

  if (error) {
    console.error('[update-engineer] 수정 실패', error)
    return NextResponse.json({ error: '직원 정보 수정에 실패했습니다.' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
