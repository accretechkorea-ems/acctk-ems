import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

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

  // 권한: 프로필 사진은 사내 직원끼리 열람하는 것이 정상이므로 '인증된 직원' 이면 허용한다.
  // RLS 에 의존하지 않도록 service role 로 caller 가 실제 engineers 행인지 명시적으로 확인한다.
  const { data: caller } = await supabaseAdmin
    .from('engineers')
    .select('engineer_id')
    .eq('email', user.email!)
    .single()
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 서명 대상이 실제 프로필 이미지 경로인지 service role 로 확인(버킷 내 임의 객체 서명 방지).
  const { count } = await supabaseAdmin
    .from('engineers')
    .select('engineer_id', { count: 'exact', head: true })
    .eq('profile_image_url', safePath)
  if (!count || count === 0)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await supabaseAdmin.storage
    .from('profile-images')
    .createSignedUrl(safePath, 60 * 60)

  if (error || !data) {
    console.error('[profile-image] signed url 발급 실패', error)
    return NextResponse.json({ error: '파일을 불러오지 못했습니다.' }, { status: 500 })
  }

  try {
    await supabaseAdmin.from('audit_log').insert({
      actor_email: user.email, action: 'READ', table_name: 'profile-images', row_id: safePath,
    })
  } catch { /* best-effort */ }

  return NextResponse.json({ signedUrl: data.signedUrl })
}
