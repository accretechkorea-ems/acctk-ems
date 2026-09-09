import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewSalesMgmt } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  // 인증 확인 — 로그인한 직원만 견적 PDF 서명 URL 발급 가능
  // (middleware는 /api/* 를 통과시키므로 여기서 반드시 세션을 검증한다)
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const path = req.nextUrl.searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })

  // 경로 순회 방지 — 버킷 루트의 단일 파일명만 허용
  const safePath = path.replace(/\.\./g, '').replace(/^\/+/, '')
  if (!safePath || safePath.includes('/'))
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })

  // 권한: 견적 소유자 또는 superadmin/영업관리만 열람 가능.
  // RLS 에 의존하지 않도록 service role 로 caller 와 대상 견적을 직접 조회해 코드에서 판정한다.
  // 두 조회는 서로의 결과가 필요 없어 나란히 보낸다(순차로 보내면 왕복 시간이 그대로 더해진다).
  const [{ data: callerRow }, { data: quoteRows }] = await Promise.all([
    supabaseAdmin
      .from('engineers')
      .select('engineer_id, permission_level, teams')
      .eq('email', user.email!)
      .single(),
    supabaseAdmin
      .from('quotes')
      .select('engineer_id')
      .eq('pdf_url', `quote-pdfs/${safePath}`),
  ])
  const caller = await withTeamPerm(callerRow)
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!quoteRows || quoteRows.length === 0)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const privileged = canViewSalesMgmt(caller)
  if (!privileged && !quoteRows.some(q => q.engineer_id === caller.engineer_id))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabaseAdmin.storage
    .from('quote-pdfs')
    .createSignedUrl(safePath, 60 * 60)

  if (error || !data) {
    console.error('[quote-pdf] signed url 발급 실패', error)
    return NextResponse.json({ error: '파일을 불러오지 못했습니다.' }, { status: 500 })
  }

  // 감사 로그(열람) — 응답을 붙잡지 않는다. 기록이 늦거나 실패해도 서명 URL 발급과는 무관하고,
  // 기다리면 그만큼 사용자가 PDF 를 늦게 본다(왕복 1회분).
  supabaseAdmin.from('audit_log').insert({
    actor_email: user.email, action: 'READ', table_name: 'quote-pdfs', row_id: safePath,
  }).then(({ error: logErr }) => {
    if (logErr) console.error('[quote-pdf] 감사 로그 기록 실패', logErr)
  }, (e: unknown) => console.error('[quote-pdf] 감사 로그 기록 실패', e))

  return NextResponse.json({ signedUrl: data.signedUrl })
}
