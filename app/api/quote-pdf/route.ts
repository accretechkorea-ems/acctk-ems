import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu, canViewSalesMgmt } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { GATE_PDF_MESSAGE, loadQuoteGates } from '@/lib/approval/quoteApproval'

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
      // quote_id 를 함께 읽는다 — 아래 승인 게이트 판정에 쓴다(전자결재 6단계 B).
      .select('quote_id, engineer_id')
      .eq('pdf_url', `quote-pdfs/${safePath}`),
  ])
  const caller = await withTeamPerm(callerRow)
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!quoteRows || quoteRows.length === 0)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 견적서 메뉴가 없는 팀은 남의 것도 자기 것도 열지 못한다(메뉴 단위 판정).
  if (!canViewMenu(caller, 'quote')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 영업관리(발주·재고)는 남의 견적 PDF 도 연다 — 종전 자격 그대로다.
  const privileged = canViewSalesMgmt(caller)
  if (!privileged && !quoteRows.some(q => q.engineer_id === caller.engineer_id))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ── 승인 게이트 ──
  // **결재 도입 이후 견적의 저장 파일은 절대 내주지 않는다.** 확정 때 만든 그 파일에는 승인일이
  // 없어 고객에게 나갈 문서가 아니다. 그 견적은 화면이 저장값으로 **그 자리에서** 만들어 연다
  // (lib/openQuotePdf.tsx → /api/quote-approval 의 'pdf-data').
  //
  // 'exempt'(도입 전)만 지금까지처럼 그대로 연다 — 그 견적은 저장 파일이 정본이다.
  // 완료된 결재 건('approved')도 저장 파일로는 내주지 않는다. 그 파일에 승인일이 없기 때문이다.
  //
  // 한 파일이 여러 견적에 걸려 있으면(파일명이 견적번호라 보통 1:1 이지만 유니크가 아니다)
  // **전부 exempt 여야** 내준다 — 하나라도 결재 대상이면 그 파일은 정본이 아니다.
  const gateRes = await loadQuoteGates(supabaseAdmin, quoteRows.map(q => q.quote_id))
  if (!gateRes.ok) {
    console.error('[quote-pdf] 게이트 조회 실패', { safePath, error: gateRes.error })
    return NextResponse.json({ error: gateRes.error }, { status: 500 })
  }
  const allExempt = quoteRows.every(q => gateRes.gates.get(q.quote_id)?.gate === 'exempt')
  if (!allExempt) {
    console.warn('[quote-pdf] 저장 파일 차단 — 화면에서 생성해야 한다', {
      safePath,
      gates: quoteRows.map(q => ({ quoteId: q.quote_id, gate: gateRes.gates.get(q.quote_id)?.gate })),
    })
    // 감사 기록(READ)은 아래 허용된 열람에서만 남는다 — 열지 못한 것을 열람으로 남기지 않는다.
    // needsGenerate — 화면이 생성 경로로 넘어가게 하는 깃발이다(quoteId 를 함께 준다).
    return NextResponse.json({
      error: GATE_PDF_MESSAGE,
      needsGenerate: true,
      quoteId: quoteRows[0]?.quote_id ?? null,
    }, { status: 409 })
  }

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
