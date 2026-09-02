// 리드 처리(배정·상태·메모·영업기회 전환).
//
// 화면에서도 역할에 따라 UI 를 감추지만 그것만으로는 막을 수 없어 여기서 다시 판정한다.
// RLS 를 켜기 전이든 뒤든 이 라우트만으로 방어가 완결되어야 한다 — RLS 는 두 번째 방어선이다.
//
// 역할
//   관리자(isSuperAdmin) : 전체 조회 / 배정 / 상태 / 메모 / 삭제        (전환 불가)
//   담당자(assigned_to)  : 자기 배정 건 조회 / 상태 / 메모 / 전환       (배정·삭제 불가)
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { canViewLeads, isSuperAdmin } from '@/lib/permissions'
import { loadTeamPerms, attachTeamPerm } from '@/lib/teamPermsServer'
import { monthToDate } from '@/components/customer/opportunity'
import { adminEngineerIds, notifyLead } from '@/lib/leadNotify'
import {
  LEAD_MANUAL_STATUSES, LEAD_STATUS_CONVERTED, LEAD_STATUS_HOLD,
  LEAD_CONVERT_ACTIVITY_TYPE, MAX_LEN, leadNoTag,
} from '@/lib/leadOptions'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

type LeadRow = {
  lead_id: number
  lead_no: string | null
  customer_company: string
  interest_product: string
  expected_purchase: string | null
  meeting_note: string
  request_note: string | null
  status: string
  assigned_to: number | null
  converted_opportunity_id: number | null
  created_at: string
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return bad('Unauthorized', 401)

  const { data: caller, error: callerErr } = await supabase
    .from('engineers')
    .select('engineer_id, name, permission_level, teams')
    .eq('email', user.email!)
    .single()
  if (callerErr) console.error('[lead-manage] caller lookup failed', { email: user.email, error: callerErr })
  if (!caller) return bad('Forbidden', 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return bad('요청을 읽을 수 없습니다.')
  }

  const action = typeof body.action === 'string' ? body.action : ''
  const leadId = Number(body.leadId)
  if (!Number.isInteger(leadId) || leadId <= 0) return bad('리드를 지정해주세요.')

  // 권한 판정은 화면이 보낸 값이 아니라 DB 의 현재 값으로 한다.
  const { data: lead, error: leadErr } = await supabaseAdmin
    .from('leads')
    .select('lead_id, lead_no, customer_company, interest_product, expected_purchase, meeting_note, request_note, status, assigned_to, converted_opportunity_id, created_at')
    .eq('lead_id', leadId)
    .single<LeadRow>()
  if (leadErr || !lead) return bad('리드를 찾을 수 없습니다.', 404)

  const admin = isSuperAdmin(caller)
  // 소속 팀에 리드 권한이 있는지 — 배정만으로 통과시키면 나중에 팀 플래그를 꺼도
  // 과거에 배정받은 건을 계속 만질 수 있다. superadmin 은 hasPerm 이 먼저 통과시킨다.
  const hasLeadPerm = canViewLeads(attachTeamPerm(await loadTeamPerms(), caller))
  const assignee = hasLeadPerm && lead.assigned_to != null && lead.assigned_to === caller.engineer_id
  // 관리자도 담당자도 아니면 이 리드에 손댈 수 없다(존재 여부도 알려주지 않는다).
  if (!admin && !assignee) return bad('Forbidden', 403)

  const touch = { updated_at: new Date().toISOString() }
  const fail = (what: string, error: unknown) => {
    console.error('[lead-manage] ' + what, { action, leadId, error })
    return bad('저장하지 못했습니다.', 500)
  }

  // ── 담당자 배정 — 관리자만 ──
  if (action === 'assign') {
    if (!admin) return bad('담당자 배정은 관리자만 할 수 있습니다.', 403)
    const raw = body.assignedTo
    const assignedTo = raw === null || raw === '' ? null : Number(raw)
    if (assignedTo !== null && !Number.isInteger(assignedTo)) return bad('담당자가 올바르지 않습니다.')

    if (assignedTo !== null) {
      // 실재하는 재직 직원인지 확인한다(퇴사자나 없는 id 로 배정되지 않게).
      const { data: target } = await supabaseAdmin
        .from('engineers')
        .select('engineer_id, resigned_date')
        .eq('engineer_id', assignedTo)
        .single()
      if (!target || target.resigned_date) return bad('배정할 수 없는 담당자입니다.')
    }

    const { error } = await supabaseAdmin.from('leads').update({ assigned_to: assignedTo, ...touch }).eq('lead_id', leadId)
    if (error) return fail('assign update failed', error)

    // 새 담당자가 생겼을 때만 그 사람에게 알린다.
    //   null → A : A 에게   /   A → B : B 에게만   /   A → null : 없음   /   A → A : 없음
    // 회수·교체 때 이전 담당자에게 보내지 않는 것은, 관리자가 조정 중일 뿐인 경우가 많고
    // "당신 것이 아니게 되었다"는 알림이 받는 사람에게 득이 없기 때문이다.
    if (assignedTo !== null && assignedTo !== lead.assigned_to) {
      await notifyLead({
        engineerIds: [assignedTo],
        title: '리드 배정',
        message: `${leadNoTag(lead.lead_no)}리드가 배정되었습니다.`,
        type: 'lead_assigned',
        leadId,
      })
    }
    return NextResponse.json({ success: true, assignedTo })
  }

  // ── 상태 변경 — 관리자·담당자 ──
  if (action === 'status') {
    const status = typeof body.status === 'string' ? body.status : ''
    // '전환완료' 는 전환이 성공했을 때만 붙는 값이라 손으로 고를 수 없다.
    if (!(LEAD_MANUAL_STATUSES as readonly string[]).includes(status)) return bad('상태 값이 올바르지 않습니다.')
    if (lead.converted_opportunity_id) return bad('이미 전환된 리드는 상태를 바꿀 수 없습니다.')

    const { error } = await supabaseAdmin.from('leads').update({ status, ...touch }).eq('lead_id', leadId)
    if (error) return fail('status update failed', error)

    // 담당자가 보류로 돌린 것만 관리자에게 알린다.
    // 관리자가 직접 바꾼 경우(admin)는 본인이 한 일이라 보내지 않고,
    // 이미 보류인 건을 다시 보류로 저장하는 경우도 보내지 않는다.
    if (!admin && status === LEAD_STATUS_HOLD && lead.status !== LEAD_STATUS_HOLD) {
      await notifyLead({
        engineerIds: await adminEngineerIds(),
        title: '리드 보류',
        message: `${leadNoTag(lead.lead_no)}리드가 보류 처리되었습니다.`,
        type: 'lead_held',
        leadId,
      })
    }
    return NextResponse.json({ success: true, status })
  }

  // ── 메모 — 관리자·담당자 ──
  if (action === 'memo') {
    const memo = typeof body.memo === 'string' ? body.memo.trim() : ''
    if (memo.length > MAX_LEN.request_note) return bad(`메모는 ${MAX_LEN.request_note}자를 넘을 수 없습니다.`)

    const { error } = await supabaseAdmin.from('leads').update({ admin_memo: memo || null, ...touch }).eq('lead_id', leadId)
    if (error) return fail('memo update failed', error)
    return NextResponse.json({ success: true })
  }

  // ── 영업기회 전환 — 담당자만 ──
  // 관리자는 전환하지 않는다. 자기 자신을 담당자로 배정한 경우에만 담당자 자격으로 가능하다.
  if (action === 'convert') {
    if (!assignee) return bad('배정받은 담당자만 영업기회로 전환할 수 있습니다.', 403)
    if (lead.converted_opportunity_id) return bad('이미 전환된 리드입니다.')

    const customerId = Number(body.customerId)
    if (!Number.isInteger(customerId) || customerId <= 0) return bad('고객사를 선택해주세요.')
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('customer_id, company_name, deleted_at')
      .eq('customer_id', customerId)
      .single()
    if (!customer || customer.deleted_at) return bad('선택한 고객사를 찾을 수 없습니다.')

    // 리드에는 고객사명 문자열만 있어 업체는 화면에서 고른 것을 쓴다.
    // expected_close 는 date 컬럼이라 예상 구매 시기가 있으면 그 달의 말일로 맞춘다(영업기회 규칙과 동일).
    const { data: opp, error: oppErr } = await supabaseAdmin
      .from('sales_opportunities')
      .insert({
        customer_id: customerId,
        engineer_id: lead.assigned_to,
        title: `${lead.customer_company} ${lead.interest_product}`.trim(),
        expected_close: lead.expected_purchase ? monthToDate(lead.expected_purchase.slice(0, 7)) : null,
      })
      .select('opportunity_id')
      .single()
    if (oppErr || !opp) {
      console.error('[lead-manage] opportunity insert failed', { leadId, error: oppErr })
      return bad('영업기회를 만들지 못했습니다.', 500)
    }

    // 회의록·요청사항을 영업활동으로 남긴다. 실패해도 전환 자체는 되돌리지 않는다.
    const content = [lead.meeting_note, lead.request_note].filter(t => t && t.trim()).join('\n\n')
    const { error: actErr } = await supabaseAdmin.from('sales_activities').insert({
      opportunity_id: opp.opportunity_id,
      customer_id: customerId,
      engineer_id: lead.assigned_to,
      activity_date: lead.created_at.slice(0, 10),
      activity_type: LEAD_CONVERT_ACTIVITY_TYPE,
      content,
    })
    if (actErr) console.error('[lead-manage] activity insert failed', { leadId, opportunityId: opp.opportunity_id, error: actErr })

    const { error: updErr } = await supabaseAdmin
      .from('leads')
      .update({ status: LEAD_STATUS_CONVERTED, converted_opportunity_id: opp.opportunity_id, ...touch })
      .eq('lead_id', leadId)
    if (updErr) {
      // 기회는 만들어졌는데 리드를 닫지 못한 상태 — 사람이 알아야 하므로 로그를 남기고 실패로 답한다.
      console.error('[lead-manage] lead close failed after convert', { leadId, opportunityId: opp.opportunity_id, error: updErr })
      return bad('영업기회는 만들어졌지만 리드 상태를 바꾸지 못했습니다. 관리자에게 알려주세요.', 500)
    }

    return NextResponse.json({ success: true, opportunityId: opp.opportunity_id, activityLogged: !actErr })
  }

  return bad('알 수 없는 요청입니다.')
}
