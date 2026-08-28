import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { canViewSalesMgmt } from '@/lib/permissions'
import { loadTeamPerms, attachTeamPerm } from '@/lib/teamPermsServer'

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
    .select('engineer_id, name, position, permission_level, teams')
    .eq('email', user.email!)
    .single()
  if (callerErr) console.error(' caller lookup failed', { email: user.email, error: callerErr })
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 팀 권한 플래그 — caller 판정과 아래 알림 대상 선별에 함께 쓴다.
  const teamPerms = await loadTeamPerms()

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const quoteId = formData.get('quoteId') as string | null
  const quoteNumber = formData.get('quoteNumber') as string | null
  const action = formData.get('action') as string | null

  if (!quoteId) return NextResponse.json({ error: '필수 값 누락' }, { status: 400 })

  // 권한: superadmin/영업관리팀은 모든 견적. 그 외에는 본인 견적(소유자)만 허용.
  // 모든 action 이 quoteId 를 필수로 받으므로(위 검증) 항상 소유자 판정이 가능하다.
  // service role(supabaseAdmin)로 조회해 RLS 를 우회하므로, 아래에서 engineer_id 를 명시적으로 비교한다.
  const privileged = canViewSalesMgmt(attachTeamPerm(teamPerms, caller))
  if (!privileged) {
    const { data: ownerQuote, error: ownerErr } = await supabaseAdmin
      .from('quotes')
      .select('engineer_id')
      .eq('quote_id', Number(quoteId))
      .single()
    if (ownerErr) console.error(' owner lookup failed', { action, quoteId, error: ownerErr })
    if (!ownerQuote || ownerQuote.engineer_id !== caller.engineer_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // 로그: 누가 어떤 action 을 어떤 견적에 했는지 추적
  console.log('[purchase-order]', { action, quoteId, callerId: caller.engineer_id, callerEmail: user.email, privileged })

  const sender = caller
  const senderLabel = [sender.name, sender.position].filter(Boolean).join(' ') || (user.email ?? '')

  // 발주서 업로드
  if (action === 'upload') {
    if (!file || !quoteNumber) return NextResponse.json({ error: '파일 또는 견적번호 누락' }, { status: 400 })

    const arrayBuffer = await file.arrayBuffer()

    // PDF 파일 시그니처 검증 (magic bytes: %PDF = 0x25 0x50 0x44 0x46)
    const header = new Uint8Array(arrayBuffer.slice(0, 4))
    if (header[0] !== 0x25 || header[1] !== 0x50 || header[2] !== 0x44 || header[3] !== 0x46) {
      return NextResponse.json({ error: 'PDF 파일만 업로드 가능합니다.' }, { status: 400 })
    }

    const fileName = `${quoteNumber}_${Date.now()}.pdf`
    const { error: uploadError } = await supabaseAdmin.storage
      .from('purchase_orders')
      .upload(fileName, arrayBuffer, { contentType: 'application/pdf', upsert: true })

    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

    const deliveryMethod = formData.get('deliveryMethod') as string | null
    const deliveryAddress = formData.get('deliveryAddress') as string | null

    const { error: updErr } = await supabaseAdmin.from('quotes').update({
      status: '발주(주문 대기)',
      purchase_order_url: `purchase_orders/${fileName}`,
      purchase_order_at: new Date().toISOString(),
      delivery_method: deliveryMethod || null,
      delivery_info: deliveryAddress || null,
    }).eq('quote_id', Number(quoteId))
    if (updErr) console.error(' quotes update failed', { action, quoteId, error: updErr })

    // 영업관리팀 + superadmin 알림
    const { data: allEng, error: engErr } = await supabaseAdmin
      .from('engineers')
      .select('engineer_id, teams, permission_level, resigned_date')
    if (engErr) console.error(' engineers lookup failed', { action, quoteId, error: engErr })

    const targets = (allEng || []).filter((e: { engineer_id: number; teams: string | null; permission_level: string; resigned_date: string | null }) =>
      canViewSalesMgmt(attachTeamPerm(teamPerms, e)) && !e.resigned_date && e.engineer_id !== caller.engineer_id
    )

    if (targets.length > 0) {
      const { error: notiErr } = await supabaseAdmin.from('notifications').insert(
        targets.map((m: { engineer_id: number }) => ({
          engineer_id: m.engineer_id,
          title: '📦 발주서 등록',
          message: `${senderLabel}이(가) 발주서를 등록했습니다. [${quoteNumber}]`,
          type: 'purchase_order',
          link: '/purchase',
          is_read: false,
        }))
      )
      if (notiErr) console.error(' notification insert failed', { action, quoteId, targets: targets.length, error: notiErr })
    }
    return NextResponse.json({ success: true })
  }

  // 주문완료 처리
  if (action === 'complete_order') {
    const shippingDate = formData.get('shippingDate') as string | null
    const orderMemo = formData.get('orderMemo') as string | null

    const { data: quote, error: quoteErr } = await supabaseAdmin
      .from('quotes')
      .select('quote_number, engineer_id')
      .eq('quote_id', Number(quoteId))
      .single()
    if (quoteErr) console.error(' quote lookup failed', { action, quoteId, error: quoteErr })

    const { error: updErr } = await supabaseAdmin.from('quotes').update({
      status: '주문완료',
      shipping_date: shippingDate || null,
      order_memo: orderMemo || null,
      order_completed_at: new Date().toISOString(),
      order_completed_by: senderLabel,
    }).eq('quote_id', Number(quoteId))
    if (updErr) console.error(' quotes update failed', { action, quoteId, error: updErr })

    // 견적 발행자에게 알림
    if (quote?.engineer_id && quote.engineer_id !== caller.engineer_id) {
      const { error: notiErr } = await supabaseAdmin.from('notifications').insert({
        engineer_id: quote.engineer_id,
        title: '✅ 주문 완료',
        message: `[${quote.quote_number}] 주문이 완료되었습니다.${shippingDate ? ` 출하 예정: ${shippingDate}` : ''}`,
        type: 'order_completed',
        link: '/sales',
        is_read: false,
      })
      if (notiErr) console.error(' notification insert failed', { action, quoteId, error: notiErr })
    }
    return NextResponse.json({ success: true })
  }

  // 세금계산서 발행 요청
  if (action === 'request_tax') {
    const taxDate = formData.get('taxDate') as string | null

    const { error: updErr } = await supabaseAdmin.from('quotes').update({
      status: '세금계산서 요청',
      tax_invoice_date: taxDate || null,
      tax_invoice_requested_at: new Date().toISOString(),
    }).eq('quote_id', Number(quoteId))
    if (updErr) console.error(' quotes update failed', { action, quoteId, error: updErr })

    const { data: taxAllEng, error: taxEngErr } = await supabaseAdmin
      .from('engineers')
      .select('engineer_id, teams, permission_level, resigned_date')
    if (taxEngErr) console.error(' engineers lookup failed', { action, quoteId, error: taxEngErr })

    const taxTargets = (taxAllEng || []).filter((e: { engineer_id: number; teams: string | null; permission_level: string; resigned_date: string | null }) =>
      canViewSalesMgmt(attachTeamPerm(teamPerms, e)) && !e.resigned_date && e.engineer_id !== caller.engineer_id
    )

    const { data: quote, error: quoteErr } = await supabaseAdmin
      .from('quotes')
      .select('quote_number')
      .eq('quote_id', Number(quoteId))
      .single()
    if (quoteErr) console.error(' quote lookup failed', { action, quoteId, error: quoteErr })

    if (taxTargets.length > 0) {
      const { error: notiErr } = await supabaseAdmin.from('notifications').insert(
        taxTargets.map((m: { engineer_id: number }) => ({
          engineer_id: m.engineer_id,
          title: '🧾 세금계산서 발행 요청',
          message: `${senderLabel}이(가) 세금계산서 발행을 요청했습니다. [${quote?.quote_number}]${taxDate ? ` 요청일: ${taxDate}` : ''}`,
          type: 'tax_invoice_request',
          link: '/purchase',
          is_read: false,
        }))
      )
      if (notiErr) console.error(' notification insert failed', { action, quoteId, targets: taxTargets.length, error: notiErr })
    }
    return NextResponse.json({ success: true })
  }

  // 세금계산서 발행완료
  if (action === 'complete_tax') {
    const { data: quote, error: quoteErr } = await supabaseAdmin
      .from('quotes')
      .select('quote_number, engineer_id, opportunity_id')
      .eq('quote_id', Number(quoteId))
      .single()
    if (quoteErr) console.error(' quote lookup failed', { action, quoteId, error: quoteErr })

    const { error: updErr } = await supabaseAdmin.from('quotes').update({
      status: '매출완료',
      tax_invoice_completed_at: new Date().toISOString(),
      tax_completed_by: senderLabel,
    }).eq('quote_id', Number(quoteId))
    if (updErr) console.error(' quotes update failed', { action, quoteId, error: updErr })

    // 매출이 확정되면 연결된 영업기회를 종료한다(closed_at 기록).
    // 영업 단계는 수주까지만 다루고, 그 뒤 회계 흐름은 quotes.status 가 담당한다.
    // 이미 종료된 건은 최초 종료 시점을 덮지 않는다. 실패해도 매출 처리는 되돌리지 않는다.
    if (!updErr && quote?.opportunity_id) {
      const { error: oppErr } = await supabaseAdmin
        .from('sales_opportunities')
        .update({ closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('opportunity_id', quote.opportunity_id)
        .is('closed_at', null)
      if (oppErr) console.error(' opportunity auto-close failed', { action, quoteId, opportunityId: quote.opportunity_id, error: oppErr })
    }

    if (quote?.engineer_id && quote.engineer_id !== caller.engineer_id) {
      const { error: notiErr } = await supabaseAdmin.from('notifications').insert({
        engineer_id: quote.engineer_id,
        title: '🎉 세금계산서 발행 완료',
        message: `[${quote.quote_number}] 세금계산서가 발행되었습니다. 매출 완료 처리되었습니다.`,
        type: 'tax_invoice_completed',
        link: '/sales',
        is_read: false,
      })
      if (notiErr) console.error(' notification insert failed', { action, quoteId, error: notiErr })
    }
    return NextResponse.json({ success: true })
  }

  // 출하일정/메모 수정
  if (action === 'update_schedule') {
    const shippingDate = formData.get('shippingDate') as string | null
    const orderMemo = formData.get('orderMemo') as string | null

    const { data: quote, error: quoteErr } = await supabaseAdmin
      .from('quotes')
      .select('quote_number, engineer_id')
      .eq('quote_id', Number(quoteId))
      .single()
    if (quoteErr) console.error(' quote lookup failed', { action, quoteId, error: quoteErr })

    const { error: updErr } = await supabaseAdmin.from('quotes').update({
      shipping_date: shippingDate || null,
      order_memo: orderMemo || null,
    }).eq('quote_id', Number(quoteId))
    if (updErr) console.error(' quotes update failed', { action, quoteId, error: updErr })

    if (quote?.engineer_id && quote.engineer_id !== caller.engineer_id) {
      const parts: string[] = []
      if (shippingDate) parts.push(`출하 예정: ${shippingDate}`)
      if (orderMemo) parts.push(`메모: ${orderMemo}`)
      const { error: notiErr } = await supabaseAdmin.from('notifications').insert({
        engineer_id: quote.engineer_id,
        title: '📅 출하일정/메모 업데이트',
        message: `[${quote.quote_number}] ${senderLabel}이(가) 일정/메모를 수정했습니다.${parts.length > 0 ? ' ' + parts.join(' / ') : ''}`,
        type: 'schedule_updated',
        link: '/sales',
        is_read: false,
      })
      if (notiErr) console.error(' notification insert failed', { action, quoteId, error: notiErr })
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 })
}

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const path = searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })

  // 경로 정규화 및 순회 공격 방지
  const safePath = path.replace(/\.\./g, '').replace(/^\/+/, '')
  const fileName = safePath.startsWith('purchase_orders/')
    ? safePath.slice('purchase_orders/'.length)
    : safePath

  if (!fileName || fileName.includes('/')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  // DB에서 해당 파일이 실제 발주서인지 확인 (RLS 적용됨)
  const { count, error: countErr } = await supabase
    .from('quotes')
    .select('quote_id', { count: 'exact', head: true })
    .eq('purchase_order_url', `purchase_orders/${fileName}`)
  if (countErr) console.error(' GET quote lookup failed', { fileName, error: countErr })
  if (!count || count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data, error } = await supabaseAdmin.storage
    .from('purchase_orders')
    .createSignedUrl(fileName, 600)

  if (error || !data?.signedUrl) return NextResponse.json({ error: 'URL 생성 실패' }, { status: 500 })
  return NextResponse.json({ signedUrl: data.signedUrl })
}
