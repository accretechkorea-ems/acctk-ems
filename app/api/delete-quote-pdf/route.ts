import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canManageEngineers } from '@/lib/permissions'

export async function POST(req: NextRequest) {
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
  const { filePath } = body
  if (!filePath?.trim()) return NextResponse.json({ error: 'filePath required' }, { status: 400 })

  // 경로 순회 공격 방지: 파일명만 허용 (폴더 구분자 금지)
  const safePath = filePath.trim().replace(/\.\./g, '').replace(/^\/+/, '')
  if (!safePath || safePath.includes('/')) {
    return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
  }

  // DB에서 해당 파일이 실제 견적서 PDF인지 확인
  const { count } = await supabase
    .from('quotes')
    .select('quote_id', { count: 'exact', head: true })
    .eq('pdf_url', `quote-pdfs/${safePath}`)
  if (!count || count === 0) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error } = await supabaseAdmin.storage.from('quote-pdfs').remove([safePath])
  if (error) {
    console.error('[delete-quote-pdf] 삭제 실패', error)
    return NextResponse.json({ error: '파일 삭제에 실패했습니다.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
