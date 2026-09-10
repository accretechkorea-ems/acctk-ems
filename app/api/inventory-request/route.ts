// 출고 요청 등록.
//
// 화면에서 직접 쓰던 것을 이리로 옮겼다. 두 가지가 이유다.
//   · requester_id 를 클라이언트가 정하고 있었다 — 남의 이름으로 요청을 넣을 수 있었다.
//     여기서는 세션에서만 얻고, 요청 본문에 무엇이 들어오든 쓰지 않는다.
//   · 남의 engineer_id 로 notifications 를 넣는 일은 service role 에서만 하게 막는다
//     (notifications 의 INSERT 정책을 없애기 위한 선행 작업이다).
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { canViewSalesMgmt } from '@/lib/permissions'
import { withTeamPerm, loadTeamPerms, attachTeamPerm } from '@/lib/teamPermsServer'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const bad = (message: string) => NextResponse.json({ error: message }, { status: 400 })

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 재고 화면 자체가 canViewSalesMgmt 로 잠겨 있다(usePageGuard). 같은 판정을 서버에서 다시 한다.
  const { data: callerRow, error: callerErr } = await supabase
    .from('engineers')
    .select('engineer_id, teams, permission_level')
    .eq('email', user.email!)
    .single()
  if (callerErr) console.error('[inventory-request] caller lookup failed', { email: user.email, error: callerErr })
  // 권한을 거둔 직후에도 통과하면 곤란해 캐시를 건너뛴다(승인 라우트와 같은 기준).
  const caller = await withTeamPerm(callerRow, { fresh: true })
  if (!caller || !canViewSalesMgmt(caller)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const itemId = Number(body?.item_id)
  const quantity = Number(body?.quantity)
  const outletCompany = str(body?.outlet_company)
  const reason = str(body?.reason)
  const note = str(body?.note)

  // 화면의 검증과 같은 규칙을 여기서 다시 본다 — 화면 검증은 편의일 뿐이다.
  if (!Number.isInteger(itemId) || itemId < 1) return bad('품목이 올바르지 않습니다.')
  if (!Number.isInteger(quantity) || quantity < 1) return bad('수량이 올바르지 않습니다.')
  if (!outletCompany) return bad('출고 업체를 입력해주세요')
  if (!reason) return bad('출고 사유를 입력해주세요')

  // 품목 이름은 서버가 직접 읽는다 — 알림 문구에 클라이언트가 보낸 이름을 쓰지 않는다.
  const { data: item, error: itemErr } = await supabaseAdmin
    .from('inventory_items')
    .select('item_id, item_name')
    .eq('item_id', itemId)
    .single()
  if (itemErr || !item) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 })

  const { data: saved, error } = await supabaseAdmin
    .from('inventory_requests')
    .insert({
      item_id: itemId,
      // 세션에서 판정한 값. 요청 본문의 requester_id 는 읽지 않는다.
      requester_id: caller.engineer_id,
      quantity,
      outlet_company: outletCompany,
      reason,
      note: note || null,
      status: '대기중',
      requested_at: new Date().toISOString(),
    })
    .select('request_id')
    .single()
  if (error || !saved) {
    console.error('[inventory-request] insert failed', { itemId, error })
    return NextResponse.json({ error: '요청을 등록하지 못했습니다.' }, { status: 500 })
  }

  // 알림은 부가 작업이다 — 실패해도 출고 요청을 되돌리지 않고 성공으로 응답한다.
  // 대상 판정은 화면에서 쓰던 것과 같다(재직 중인 영업관리 권한자 전원, 본인 제외 없음).
  try {
    const teamPerms = await loadTeamPerms()
    const { data: allEng, error: engErr } = await supabaseAdmin
      .from('engineers')
      .select('engineer_id, teams, permission_level, resigned_date')
    if (engErr) console.error('[inventory-request] engineers lookup failed', { requestId: saved.request_id, error: engErr })
    type Row = { engineer_id: number; teams: string | null; permission_level: string | null; resigned_date: string | null }
    const managers = ((allEng ?? []) as Row[]).filter(e => canViewSalesMgmt(attachTeamPerm(teamPerms, e)) && !e.resigned_date)
    if (managers.length > 0) {
      const { error: notiErr } = await supabaseAdmin.from('notifications').insert(
        managers.map(m => ({
          engineer_id: m.engineer_id,
          title: '출고 요청 승인 필요',
          message: `${item.item_name ?? '알 수 없음'} ${quantity}개 출고 요청이 들어왔습니다`,
          type: 'stock_request',
          link: '/inventory?tab=approval',
          is_read: false,
          created_at: new Date().toISOString(),
        }))
      )
      if (notiErr) console.error('[inventory-request] notification insert failed', { requestId: saved.request_id, targets: managers.length, error: notiErr })
    }
  } catch (e) {
    console.error('[inventory-request] notification step failed', { requestId: saved.request_id, error: e })
  }

  return NextResponse.json({ success: true, request_id: saved.request_id })
}
