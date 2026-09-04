import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewLeads, isSuperAdmin } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { CARD_BUCKET } from '@/lib/leadOptions'

// 리드 명함 이미지의 서명 URL 발급.
// 버킷이 비공개라 화면이 직접 파일을 읽을 수 없다. 장비 사진(/api/device-image)과 같은 방식으로
// service role 이 열람 권한을 확인한 뒤 짧게 유효한 URL 을 내준다.
//
// 만료 1시간 — 코드베이스의 다른 서명 URL(견적 PDF·장비 사진·프로필·패킹리스트·서비스 레포트)과 같은 값이다.
// 상세를 열어둔 채 한참 뒤에 눌러도 유효하고, 링크가 새어 나가도 하루를 넘기지 않는다.
const SIGNED_URL_TTL = 60 * 60

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

  // 경로 순회 방지 — 버킷 루트의 단일 파일명만 허용한다.
  const safePath = path.replace(/\.\./g, '').replace(/^\/+/, '')
  if (!safePath || safePath.includes('/')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const { data: callerRow } = await supabaseAdmin
    .from('engineers')
    .select('engineer_id, permission_level, teams')
    .eq('email', user.email!)
    .single()
  const caller = await withTeamPerm(callerRow)
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // 리드 화면에 들어올 수 있는 사람만 — 관리자(전체) 또는 리드 권한이 있는 팀.
  if (!canViewLeads(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 서명 대상이 실제 리드의 명함 경로인지 확인한다. 임의의 파일명에 서명해주지 않는다.
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('lead_id, assigned_to')
    .eq('business_card_url', safePath)
    .maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 담당자는 자기에게 배정된 리드만 볼 수 있다(목록 조회와 같은 규칙).
  if (!isSuperAdmin(caller) && lead.assigned_to !== caller.engineer_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin.storage
    .from(CARD_BUCKET)
    .createSignedUrl(safePath, SIGNED_URL_TTL)
  if (error || !data) {
    console.error('[lead-card] signed url 발급 실패', { safePath, error })
    return NextResponse.json({ error: '파일을 불러오지 못했습니다.' }, { status: 500 })
  }

  try {
    await supabaseAdmin.from('audit_log').insert({
      actor_email: user.email, action: 'READ', table_name: CARD_BUCKET, row_id: safePath,
    })
  } catch { /* best-effort */ }

  return NextResponse.json({ signedUrl: data.signedUrl })
}
