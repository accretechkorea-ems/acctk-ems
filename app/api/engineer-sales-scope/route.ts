import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { canManageEngineers } from '@/lib/permissions'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * 직원 한 명의 「실적 집계」 개인 설정만 바꾼다.
 *
 * update-engineer 와 따로 둔 이유 — 그 라우트는 이름·팀·이메일·이니셜을 **매번 전부**
 * 다시 쓴다(한 칸만 보내면 나머지가 비워진다). 목표 관리창의 선택칸은 한 칸만
 * 즉시 저장하므로 이름조차 보내지 않는 좁은 길이 필요하다.
 *
 * in_sales_stats: true = 포함 · false = 제외 · null = 팀 설정을 따른다.
 */
export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('engineers')
    .select('permission_level, engineer_id')
    .eq('email', user.email!)
    .single()
  if (!caller || !canManageEngineers(caller)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { engineer_id, in_sales_stats } = body

  if (!engineer_id) return NextResponse.json({ error: '필수 값 누락' }, { status: 400 })
  // 세 가지 값만 받는다. undefined 를 그대로 넘기면 아무 일도 하지 않는 저장이 되므로 막는다.
  if (in_sales_stats !== null && typeof in_sales_stats !== 'boolean') {
    return NextResponse.json({ error: '집계 설정 값이 올바르지 않습니다.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('engineers')
    .update({ in_sales_stats })
    .eq('engineer_id', Number(engineer_id))

  if (error) {
    console.error('[engineer-sales-scope] 저장 실패', error)
    return NextResponse.json({ error: '집계 설정 저장에 실패했습니다.' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
