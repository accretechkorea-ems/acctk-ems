import { adminClient } from '@/lib/supabase/admin'
import { isOwner, loadCaller } from '@/lib/apiCaller'
import { NextResponse } from 'next/server'

const supabaseAdmin = adminClient()

export async function POST(req: Request) {
  // 재고 메뉴 권한 또는 superadmin만 허용
  // 재고 요청을 승인·반려하는 라우트다. 권한 변경이 즉시 반영돼야 해 캐시를 건너뛴다.
  // 재고 요청을 승인·반려하는 라우트다. 쓰기라 팀 권한 캐시를 건너뛴다.
  const { error: authErr, caller } = await loadCaller({ kind: 'menu', keys: ['inventory'] }, { tag: 'inventory-approval', req })
  if (authErr) return authErr

  const body = await req.json()
  const { action, request_id, reject_reason } = body

  if (!request_id) return NextResponse.json({ error: '필수 값 누락' }, { status: 400 })
  if (!['approve', 'reject'].includes(action)) return NextResponse.json({ error: '유효하지 않은 action' }, { status: 400 })

  // 요청 정보 조회
  const { data: req_data, error: reqErr } = await supabaseAdmin
    .from('inventory_requests')
    .select('*, inventory_items(item_name, part_code)')
    .eq('request_id', Number(request_id))
    .single()

  if (reqErr || !req_data) return NextResponse.json({ error: '요청을 찾을 수 없습니다.' }, { status: 404 })
  if (req_data.status !== '대기중') return NextResponse.json({ error: '이미 처리된 요청입니다.' }, { status: 409 })

  // **자기 요청은 자기가 승인하지 못한다**(2026-11-02 추가 — D37 조사 ②).
  //   재고 메뉴 권한만 있으면 승인·반려가 되는 라우트라, 요청자와 승인자가 같아도 통과했다.
  //   재고가 실제로 줄어드는 자리라 둘을 갈라야 한다. 메뉴는 사이드바에서 숨겨졌지만
  //   (/inventory 직접 접근은 살아 있다) 라우트는 그대로 돌고 있으므로 여기서 막는다.
  if (isOwner(req_data, caller)) {
    return NextResponse.json({ error: '본인 요청은 승인할 수 없습니다.' }, { status: 403 })
  }

  if (action === 'approve') {
    // 재고 수량 확인
    const { data: item, error: itemErr } = await supabaseAdmin
      .from('inventory_items')
      .select('quantity')
      .eq('item_id', req_data.item_id)
      .single()
    if (itemErr) console.error(' item lookup failed', { action, request_id, itemId: req_data.item_id, error: itemErr })

    if (!item || item.quantity < req_data.quantity) {
      return NextResponse.json({ error: `재고 부족 (현재: ${item?.quantity ?? 0}개, 요청: ${req_data.quantity}개)` }, { status: 400 })
    }

    // 재고 차감
    const { error: e1 } = await supabaseAdmin
      .from('inventory_items')
      .update({ quantity: item.quantity - req_data.quantity })
      .eq('item_id', req_data.item_id)
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

    // 요청 상태 업데이트
    const { error: e2 } = await supabaseAdmin
      .from('inventory_requests')
      .update({ status: '승인', processed_at: new Date().toISOString(), processed_by: caller.engineer_id })
      .eq('request_id', Number(request_id))
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

    // 출고 로그 기록
    const { error: e3 } = await supabaseAdmin
      .from('inventory_logs')
      .insert([{
        item_id: req_data.item_id,
        engineer_id: caller.engineer_id,
        requester_id: req_data.requester_id,
        quantity_out: req_data.quantity,
        log_type: 'out',
        outlet_company: req_data.outlet_company,
        reason: req_data.reason,
        logged_at: new Date().toISOString(),
      }])
    if (e3) return NextResponse.json({ error: e3.message }, { status: 500 })

    // 요청자에게 알림
    const { error: notiErr } = await supabaseAdmin.from('notifications').insert([{
      engineer_id: req_data.requester_id,
      title: '출고 요청 승인됨',
      message: `${req_data.inventory_items?.item_name ?? '품목'} ${req_data.quantity}개 출고 요청이 승인되었습니다`,
      type: 'stock_approved',
      link: '/inventory?tab=requests',
      is_read: false,
      created_at: new Date().toISOString(),
    }])
    if (notiErr) console.error(' notification insert failed', { action, request_id, requesterId: req_data.requester_id, error: notiErr })

    return NextResponse.json({ success: true })
  }

  // action === 'reject'
  if (!reject_reason?.trim()) return NextResponse.json({ error: '반려 사유를 입력해주세요.' }, { status: 400 })

  const { error: e1 } = await supabaseAdmin
    .from('inventory_requests')
    .update({
      status: '반려',
      reject_reason: reject_reason.trim(),
      processed_at: new Date().toISOString(),
      processed_by: caller.engineer_id,
    })
    .eq('request_id', Number(request_id))
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  const { error: rejectNotiErr } = await supabaseAdmin.from('notifications').insert([{
    engineer_id: req_data.requester_id,
    title: '출고 요청 반려됨',
    message: `${req_data.inventory_items?.item_name ?? '품목'} ${req_data.quantity}개 출고 요청이 반려되었습니다. 사유: ${reject_reason.trim()}`,
    type: 'stock_rejected',
    link: '/inventory?tab=requests',
    is_read: false,
    created_at: new Date().toISOString(),
  }])
  if (rejectNotiErr) console.error(' notification insert failed', { action, request_id, requesterId: req_data.requester_id, error: rejectNotiErr })

  return NextResponse.json({ success: true })
}
