// 소속회사(부모 업체) 관리 — 이름 수정과 삭제.
//
// 라우트로 둔 이유:
//   · 삭제는 되돌릴 수 없고, 소속 업체가 남아 있으면 그 업체들의 parent_customer_id 가 끊긴다.
//     화면에서 세는 것만으로는 그 사이에 다른 사람이 업체를 연결했을 때를 막지 못하므로,
//     지우기 직전에 서버가 다시 세어 0 이 아니면 거부한다.
//   · service role 로 세야 RLS·필터에 가려 실제보다 적게 세는 일이 없다.
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/permissions'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 이 소속회사에 붙어 있는 살아있는 업체 수. 삭제 판정의 유일한 근거다. */
async function childCount(parentId: number): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('customers')
    .select('customer_id', { count: 'exact', head: true })
    .eq('parent_customer_id', parentId)
    .is('deleted_at', null)
  if (error) throw error
  return count ?? 0
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('engineers')
    .select('engineer_id, permission_level')
    .eq('email', user.email!)
    .single()
  // 소속회사는 여러 업체가 함께 물려 있는 구조라 superadmin 으로 제한한다(팀·직원 관리와 같은 기준).
  if (!caller || !isSuperAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const action: string = body?.action ?? ''
  const parentId = Number(body?.parentId)
  if (!Number.isInteger(parentId) || parentId <= 0) return bad('소속회사를 지정해주세요.')

  // 대상이 실제로 소속회사인지 확인한다 — 일반 업체 행이 이 라우트로 지워지면 안 된다.
  const { data: target } = await supabaseAdmin
    .from('customers')
    .select('customer_id, company_name, is_parent, deleted_at')
    .eq('customer_id', parentId)
    .maybeSingle()
  if (!target || target.deleted_at) return bad('소속회사를 찾을 수 없습니다.', 404)
  if (!target.is_parent) return bad('소속회사가 아닙니다.')

  // ── 이름 수정 ──
  if (action === 'rename') {
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return bad('소속회사명을 입력해주세요.')

    // 같은 이름의 소속회사가 이미 있으면 막는다(자기 자신은 제외).
    const { data: dup } = await supabaseAdmin
      .from('customers')
      .select('customer_id')
      .eq('is_parent', true)
      .is('deleted_at', null)
      .eq('company_name', name)
      .neq('customer_id', parentId)
    if (dup && dup.length > 0) return bad('같은 이름의 소속회사가 이미 있습니다.')

    const { error } = await supabaseAdmin
      .from('customers').update({ company_name: name }).eq('customer_id', parentId)
    if (error) {
      console.error('[parent-company] rename failed', { parentId, error })
      return bad('이름을 수정하지 못했습니다.', 500)
    }
    console.log('[parent-company] rename', { parentId, from: target.company_name, to: name, by: user.email })
    return NextResponse.json({ success: true })
  }

  // ── 삭제 ──
  if (action === 'delete') {
    let children: number
    try {
      children = await childCount(parentId)
    } catch (e) {
      console.error('[parent-company] child count failed', { parentId, error: e })
      return bad('소속 업체 수를 확인하지 못했습니다.', 500)
    }
    // 화면에서 이미 걸렀더라도 여기서 다시 센다 — 그 사이에 업체가 연결됐을 수 있다.
    if (children > 0) return bad(`소속 업체 ${children}곳이 연결되어 있습니다.`, 409)

    const { error } = await supabaseAdmin
      .from('customers').delete().eq('customer_id', parentId)
    if (error) {
      console.error('[parent-company] delete failed', { parentId, error })
      return bad('삭제하지 못했습니다.', 500)
    }
    console.log('[parent-company] delete', { parentId, name: target.company_name, by: user.email })
    return NextResponse.json({ success: true })
  }

  return bad('알 수 없는 요청입니다.')
}
