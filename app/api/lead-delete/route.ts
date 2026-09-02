// 리드 삭제(하드 삭제).
//
// 화면(/leads)에서도 superadmin 에게만 버튼을 보이지만, 그것만으로는 막을 수 없어
// 권한과 확인 문구를 여기서 다시 검증한다. 화면을 거치지 않고 이 라우트를 직접 부르는 경우가 방어 대상이다.
// leads 를 참조하는 FK 는 없으므로 행 하나만 지우면 되고, 전환된 영업기회·활동 기록은 건드리지 않는다.
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/permissions'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller, error: callerErr } = await supabase
    .from('engineers')
    .select('engineer_id, name, permission_level')
    .eq('email', user.email!)
    .single()
  if (callerErr) console.error('[lead-delete] caller lookup failed', { email: user.email, error: callerErr })
  // 리드 삭제는 되돌릴 수 없어 superadmin 으로 제한한다(팀 권한 플래그와 무관).
  if (!caller || !isSuperAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { leadId?: unknown; confirmText?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청을 읽을 수 없습니다.' }, { status: 400 })
  }

  const leadId = Number(body.leadId)
  if (!Number.isInteger(leadId) || leadId <= 0) {
    return NextResponse.json({ error: '리드를 지정해주세요.' }, { status: 400 })
  }

  const { data: lead, error: leadErr } = await supabaseAdmin
    .from('leads')
    .select('lead_id, customer_company, converted_opportunity_id')
    .eq('lead_id', leadId)
    .single()
  if (leadErr || !lead) return NextResponse.json({ error: '리드를 찾을 수 없습니다.' }, { status: 404 })

  // 전환된 리드는 영업기회의 출처 기록이 사라지므로 고객사명을 그대로 입력해야 지워진다.
  // 화면에서도 같은 검사를 하지만, 화면을 거치지 않는 호출을 막는 것은 이 검사다.
  if (lead.converted_opportunity_id) {
    const typed = typeof body.confirmText === 'string' ? body.confirmText.trim() : ''
    if (typed !== (lead.customer_company ?? '').trim()) {
      return NextResponse.json({ error: '고객사명이 일치하지 않습니다.' }, { status: 400 })
    }
  }

  const { error: delErr } = await supabaseAdmin.from('leads').delete().eq('lead_id', leadId)
  if (delErr) {
    console.error('[lead-delete] delete failed', { leadId, error: delErr })
    return NextResponse.json({ error: '삭제하지 못했습니다.' }, { status: 500 })
  }

  console.log('[lead-delete]', { leadId, callerId: caller.engineer_id, callerEmail: user.email, converted: lead.converted_opportunity_id })
  return NextResponse.json({ success: true })
}
