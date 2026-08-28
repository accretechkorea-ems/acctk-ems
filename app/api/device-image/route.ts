import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewCustomers } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const path = req.nextUrl.searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })

  const safePath = path.replace(/\.\./g, '').replace(/^\/+/, '')
  if (!safePath || safePath.includes('/'))
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })

  // 권한: 고객 장비 사진이므로 고객사 열람 권한(can_view_customers)이 있는 팀만 볼 수 있다.
  // RLS 에 의존하지 않도록 service role 로 caller 를 조회해 코드에서 판정한다.
  const { data: callerRow } = await supabaseAdmin
    .from('engineers')
    .select('permission_level, teams')
    .eq('email', user.email!)
    .single()
  const caller = await withTeamPerm(callerRow)
  if (!canViewCustomers(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 서명 대상이 실제 장비 이미지 경로인지 service role 로 확인.
  const { count } = await supabaseAdmin
    .from('devices')
    .select('device_id', { count: 'exact', head: true })
    .eq('image_url', safePath)
  if (!count || count === 0)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await supabaseAdmin.storage
    .from('device-images')
    .createSignedUrl(safePath, 60 * 60)

  if (error || !data) {
    console.error('[device-image] signed url 발급 실패', error)
    return NextResponse.json({ error: '파일을 불러오지 못했습니다.' }, { status: 500 })
  }

  try {
    await supabaseAdmin.from('audit_log').insert({
      actor_email: user.email, action: 'READ', table_name: 'device-images', row_id: safePath,
    })
  } catch { /* best-effort */ }

  return NextResponse.json({ signedUrl: data.signedUrl })
}
