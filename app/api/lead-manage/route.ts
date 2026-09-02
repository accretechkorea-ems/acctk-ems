// 리드 처리(배정·상태·메모·영업기회 전환).
//
// 화면에서도 역할에 따라 UI 를 감추지만 그것만으로는 막을 수 없어 여기서 다시 판정한다.
// RLS 를 켜기 전이든 뒤든 이 라우트만으로 방어가 완결되어야 한다 — RLS 는 두 번째 방어선이다.
//
// 역할
//   관리자(isSuperAdmin) : 전체 조회 / 배정 / 메모 / 삭제               (전환·미진행 불가)
//   담당자(assigned_to)  : 자기 배정 건 조회 / 메모 / 전환 / 미진행     (배정·삭제 불가)
//
// 상태는 손으로 고르지 않는다. 배정하면 진행중, 전환하면 전환완료, 미진행 처리하면 미진행이 된다.
// 그래서 status 를 직접 받는 action 이 없다 — 없어진 '확인중'·'보류' 는 어떤 경로로도 들어올 수 없다.
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { canViewLeads, isSuperAdmin } from '@/lib/permissions'
import { loadTeamPerms, attachTeamPerm } from '@/lib/teamPermsServer'
import { monthToDate } from '@/components/customer/opportunity'
import { adminEngineerIds, notifyLead } from '@/lib/leadNotify'
import {
  LEAD_STATUS_NEW, LEAD_STATUS_ACTIVE, LEAD_STATUS_CONVERTED, LEAD_STATUS_SKIPPED,
  LEAD_CONVERT_ACTIVITY_TYPE, MAX_LEN, SKIP_REASON_MIN, isLeadClosed, leadNoTag,
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

    // 배정에 따라 상태가 자동으로 따라간다. 다만 종결된 건(전환완료·미진행)은 건드리지 않는다.
    const statusPatch = isLeadClosed(lead.status)
      ? {}
      : { status: assignedTo === null ? LEAD_STATUS_NEW : LEAD_STATUS_ACTIVE }

    const { error } = await supabaseAdmin.from('leads')
      .update({ assigned_to: assignedTo, ...statusPatch, ...touch })
      .eq('lead_id', leadId)
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
    return NextResponse.json({ success: true, assignedTo, status: statusPatch.status ?? lead.status })
  }

  // ── 미진행 처리 — 담당자만. 되돌릴 수 없는 종결이라 사유를 반드시 받는다. ──
  if (action === 'skip') {
    if (!assignee) return bad('배정받은 담당자만 미진행 처리할 수 있습니다.', 403)
    if (isLeadClosed(lead.status)) return bad('이미 종결된 리드입니다.')

    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) return bad('미진행 사유를 입력해주세요.')
    if (reason.length < SKIP_REASON_MIN) return bad(`미진행 사유는 ${SKIP_REASON_MIN}자 이상 입력해주세요.`)
    if (reason.length > MAX_LEN.skip_reason) return bad(`미진행 사유는 ${MAX_LEN.skip_reason}자를 넘을 수 없습니다.`)

    const { error } = await supabaseAdmin.from('leads')
      .update({ status: LEAD_STATUS_SKIPPED, skip_reason: reason, ...touch })
      .eq('lead_id', leadId)
    if (error) return fail('skip update failed', error)

    // 담당자의 판단이므로 관리자에게 알린다. 사유는 길이가 제각각이라 메시지에 넣지 않는다
    // (대시보드 알림 카드는 한 줄로 잘린다). 링크를 누르면 상세에서 전문을 볼 수 있다.
    await notifyLead({
      engineerIds: await adminEngineerIds(),
      title: '리드 미진행',
      message: `${leadNoTag(lead.lead_no)}리드가 미진행 처리되었습니다.`,
      type: 'lead_skipped',
      leadId,
    })
    return NextResponse.json({ success: true, status: LEAD_STATUS_SKIPPED })
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
    if (isLeadClosed(lead.status) || lead.converted_opportunity_id) return bad('이미 종결된 리드입니다.')

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
