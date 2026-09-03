import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewQuote, canViewSalesMgmt } from '@/lib/permissions'
import { loadTeamPerms, attachTeamPerm } from '@/lib/teamPermsServer'

// 견적 대필(다른 사람의 실적으로 잡히는 견적)을 다루는 라우트. 동작은 action 으로 나눈다.
//   · resolve — /quote?on_behalf= 로 들어올 때, 그 대필이 허용되는지 서버에서 판정하고
//               담당자 이름을 돌려준다. 화면은 이 응답이 성공했을 때만 대필 모드로 들어간다.
//   · notify  — 확정된 대필 견적을 실적 담당자에게 알린다.
//
// 라우트로 둔 이유:
//   · ?on_behalf= 는 주소창으로 아무나 만들 수 있다. "작성자가 영업관리인가" 는
//     화면이 아니라 서버에서 판정해야 한다.
//   · 남의 engineer_id 로 notifications 를 넣는 일은 서버(service role)에서만 하게 막는다.
//     (견적 삭제 알림 라우트와 같은 방침)

const TYPE_ON_BEHALF = 'quote_on_behalf'

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const action: string = body?.action ?? 'resolve'
  if (action !== 'resolve' && action !== 'notify') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const supabaseAdmin = admin()
  const teamPerms = await loadTeamPerms()

  const { data: callerRow } = await supabase
    .from('engineers')
    .select('engineer_id, name, position, permission_level, teams')
    .eq('email', user.email!)
    .single()
  if (!callerRow) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const caller = attachTeamPerm(teamPerms, callerRow)

  // 대필은 영업관리(+superadmin)만 한다. 두 action 모두 같은 문턱을 쓴다 —
  // notify 만 통과시키면 남의 실적으로 만든 견적에 알림까지 붙일 수 있다.
  if (!canViewSalesMgmt(caller)) {
    return NextResponse.json({ error: '견적 대필은 영업관리팀만 할 수 있습니다.' }, { status: 403 })
  }

  // ── 대필 대상 확인 ──
  if (action === 'resolve') {
    const engineerId = Number(body?.engineerId)
    if (!Number.isFinite(engineerId) || engineerId <= 0) {
      return NextResponse.json({ error: 'engineerId required' }, { status: 400 })
    }
    const { data: target } = await supabaseAdmin
      .from('engineers')
      .select('engineer_id, name, position, tel, teams, permission_level, resigned_date')
      .eq('engineer_id', engineerId)
      .maybeSingle()
    // 실적을 받을 사람은 "견적 권한이 있는 재직자" 여야 한다(고를 때와 같은 조건).
    if (!target || target.resigned_date || !canViewQuote(attachTeamPerm(teamPerms, target))) {
      return NextResponse.json({ error: '대필할 수 없는 담당자입니다.' }, { status: 400 })
    }
    // tel 까지 돌려주는 이유: 견적서 PDF 의 「담당자」 줄은 고객이 연락할 사람,
    // 즉 작성자가 아니라 실적 담당자여야 한다.
    return NextResponse.json({
      assignee: { engineer_id: target.engineer_id, name: target.name, position: target.position, tel: target.tel ?? null },
    })
  }

  // ── 대필 알림 ──
  // 견적 행을 근거로 삼는다 — 클라이언트가 보낸 값으로 수신자를 정하지 않는다.
  const quoteId = Number(body?.quoteId)
  if (!Number.isFinite(quoteId) || quoteId <= 0) {
    return NextResponse.json({ error: 'quoteId required' }, { status: 400 })
  }
  const { data: quote } = await supabaseAdmin
    .from('quotes')
    .select('quote_id, quote_number, engineer_id, created_by')
    .eq('quote_id', quoteId)
    .maybeSingle()
  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

  // 자기가 쓴 견적에 대해서만 알릴 수 있다.
  if (quote.created_by !== caller.engineer_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // 대필이 아니면(두 값이 같으면) 알릴 것이 없다. 본인에게 보내는 알림도 여기서 걸러진다.
  if (!quote.engineer_id || quote.engineer_id === quote.created_by) {
    return NextResponse.json({ success: true, notified: 0 })
  }

  const writer = [caller.name, caller.position].filter(Boolean).join(' ') || (user.email ?? '')
  const { error: notiErr } = await supabaseAdmin.from('notifications').insert({
    engineer_id: quote.engineer_id,
    title: '대필 견적 등록',
    // 작성자 이름을 넣는다 — 받는 사람은 자기가 쓰지 않은 견적을 받는 것이라
    // 누구에게 물어야 하는지가 알림의 핵심 정보다. 직책으로 끝나는 이름도 있어 조사는 「님이」로 둔다.
    message: `[${quote.quote_number}] ${writer}님이 대신 작성한 견적이 등록되었습니다.`,
    type: TYPE_ON_BEHALF,
    // 「내 견적」 목록에서 그 견적이 바로 보이도록 견적번호를 검색어로 넘긴다.
    link: `/dashboard?quote=${encodeURIComponent(quote.quote_number)}`,
    is_read: false,
  })
  if (notiErr) {
    console.error('[quote-on-behalf] notification insert failed', { quoteId, error: notiErr })
    return NextResponse.json({ error: '알림 생성에 실패했습니다.' }, { status: 500 })
  }
  return NextResponse.json({ success: true, notified: 1 })
}
