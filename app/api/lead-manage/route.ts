// 리드 처리(배정·상태·메모·영업기회 전환).
//
// 화면에서도 역할에 따라 UI 를 감추지만 그것만으로는 막을 수 없어 여기서 다시 판정한다.
// RLS 를 켜기 전이든 뒤든 이 라우트만으로 방어가 완결되어야 한다 — RLS 는 두 번째 방어선이다.
//
// 역할
//   관리자(isSuperAdmin) : 전체 조회 / 배정 / 메모 / 배정불가 / 해제 / 삭제  (전환·미진행 불가)
//   담당자(assigned_to)  : 자기 배정 건 조회 / 메모 / 전환 / 미진행     (배정·배정불가·삭제 불가)
//
// 상태는 손으로 고르지 않는다. 배정하면 진행중, 전환하면 전환완료, 미진행 처리하면 미진행이 된다.
// 그래서 status 를 직접 받는 action 이 없다 — 없어진 '확인중'·'보류' 는 어떤 경로로도 들어올 수 없다.
//
// 배정 불가는 되돌릴 수 있다(action 'unblock'). 해제하면 '신규'·미배정으로 돌아가고 사유·처리자·
// 시각이 행에서 지워진다 — 그래서 block·unblock 둘 다 audit_log 에 한 줄씩 남긴다.
// leads.blocked_by/blocked_at 은 CHECK(leads_blocked_actor_check)가 지킨다:
// 상태가 '배정불가' 가 아니면 둘 다 null 이어야 한다. 상태를 되돌릴 때 반드시 함께 비운다.
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { canViewMenu, isSuperAdmin } from '@/lib/permissions'
import { loadTeamPerms, attachTeamPerm } from '@/lib/teamPermsServer'
import { monthToDate } from '@/components/customer/opportunity'
import { adminEngineerIds, notifyLead } from '@/lib/leadNotify'
import { sendPartnerAssignMail } from '@/lib/leadMail'
import {
  LEAD_STATUS_NEW, LEAD_STATUS_ACTIVE, LEAD_STATUS_CONVERTED, LEAD_STATUS_SKIPPED, LEAD_STATUS_BLOCKED,
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
  partner_name: string | null
  /** 파트너사 담당자 메일. 칸이 생기기 전 등록분은 null 이라 그때는 메일을 보내지 않는다. */
  partner_email: string | null
  customer_company: string
  interest_product: string
  expected_purchase: string | null
  meeting_note: string
  request_note: string | null
  status: string
  assigned_to: number | null
  /** 배정 불가 사유·처리자·시각. 해제하면 셋 다 null 로 돌아간다(CHECK 가 강제한다). */
  block_reason: string | null
  blocked_by: number | null
  blocked_at: string | null
  converted_opportunity_id: number | null
  created_at: string
}

/**
 * 리드 처리 기록을 audit_log 에 한 줄 남긴다.
 *
 * leads 에는 변경 트리거가 없고, 해제(unblock)는 사유·처리자·시각을 행에서 지운다 —
 * 그러면 「누가 왜 닫았다가 풀었는지」는 이 기록에만 남는다. 그래서 부가 작업이 아니라
 * 처리의 일부로 남긴다. 다만 **기록 실패가 처리 결과를 막지는 않는다** — 리드는 이미 바뀌었고,
 * 여기서 실패로 응답하면 사람이 같은 처리를 다시 눌러 더 나빠진다(의뢰서 라우트와 같은 방침).
 *
 * 방식은 writeInquiryAudit(app/api/inquiry/route.ts) · writeDeleteAudit(lib/approval/quoteDelete.ts)
 * 과 같다 — actor_email 은 engineers 에서 읽고, new_data 에 실행자 id·이름을 함께 넣는다.
 * row_id 는 리드 번호를 쓴다(사람이 찾는 값이다). 번호 발급이 실패한 옛 건은 lead_id 로 떨어진다.
 */
async function writeLeadAudit(
  lead: { lead_id: number; lead_no: string | null },
  opts: {
    action: 'LEAD_ASSIGN' | 'LEAD_BLOCK' | 'LEAD_UNBLOCK'
    actorId: number
    oldData?: Record<string, unknown> | null
    newData?: Record<string, unknown> | null
  },
) {
  const { data: actor, error: actorErr } = await supabaseAdmin
    .from('engineers').select('email, name').eq('engineer_id', opts.actorId).maybeSingle()
  if (actorErr) console.error('[lead-manage] actor lookup failed', { actorId: opts.actorId, error: actorErr })
  const who = (actor ?? null) as { email: string | null; name: string | null } | null

  const { error } = await supabaseAdmin.from('audit_log').insert({
    actor_email: who?.email ?? null,
    action: opts.action,
    table_name: 'leads',
    row_id: lead.lead_no ?? String(lead.lead_id),
    old_data: opts.oldData ?? null,
    new_data: { ...(opts.newData ?? {}), by: opts.actorId, by_name: who?.name ?? null },
  })
  if (error) console.error('[lead-manage] audit insert failed', { action: opts.action, leadId: lead.lead_id, error })
}

/**
 * 파트너사에 담당자 배정을 알린다. 담당자 정보는 engineers 에서 읽는다
 * (이 표의 전화 칸은 tel 하나뿐이다 — contact_mobile 은 고객사 담당자 것이라 쓰지 않는다).
 * 외부로 나가는 메일이라 성패를 돌려준다. 실패해도 배정 자체는 되돌리지 않는다.
 */
async function notifyPartnerAssigned(lead: LeadRow, assignedTo: number, changed: boolean): Promise<boolean> {
  if (!lead.partner_email) return false
  const { data, error } = await supabaseAdmin
    .from('engineers')
    .select('name, position, tel, email')
    .eq('engineer_id', assignedTo)
    .maybeSingle()
  if (error || !data) {
    console.error('[lead-manage] 담당자 조회 실패 — 파트너사 메일을 보내지 못했다', { leadId: lead.lead_id, assignedTo, error })
    return false
  }
  const e = data as { name: string | null; position: string | null; tel: string | null; email: string | null }
  return sendPartnerAssignMail({
    lead_id: lead.lead_id,
    lead_no: lead.lead_no,
    partner_email: lead.partner_email,
    partner_name: lead.partner_name,
    customer_company: lead.customer_company,
    engineer: { name: e.name, position: e.position, tel: e.tel, email: e.email },
    changed,
  })
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
    .select('lead_id, lead_no, partner_name, partner_email, customer_company, interest_product, expected_purchase, meeting_note, request_note, status, assigned_to, block_reason, blocked_by, blocked_at, converted_opportunity_id, created_at')
    .eq('lead_id', leadId)
    .single<LeadRow>()
  if (leadErr || !lead) return bad('리드를 찾을 수 없습니다.', 404)

  const admin = isSuperAdmin(caller)
  // 소속 팀에 리드 메뉴 권한이 있는지 — 배정만으로 통과시키면 나중에 메뉴를 꺼도
  // 과거에 배정받은 건을 계속 만질 수 있다. superadmin 은 hasPerm 이 먼저 통과시킨다.
  // 리드를 배정·이관하는 라우트다. 권한 변경이 즉시 반영돼야 해 캐시를 건너뛴다.
  const hasLeadPerm = canViewMenu(attachTeamPerm(await loadTeamPerms({ fresh: true }), caller), 'leads')
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
    // 배정 불가인 건에는 담당자를 붙이지 않는다.
    //
    // 붙이면 「배정불가인데 담당자가 있는」 모순 상태가 된다 — block 이 일부러 배정을 푸는 것과
    // 정면으로 어긋난다. DB 의 CHECK(leads_blocked_actor_check)는 blocked_by/blocked_at 만 보고
    // assigned_to 는 보지 않으므로 여기서 막는 수밖에 없다.
    //
    // 전환완료·미진행은 막지 않는다(종전 동작 그대로 — 그 두 상태는 담당자가 이미 제 일을 한
    // 뒤의 종결이라, 뒤늦게 담당자를 고치는 일이 있다). 그래서 isLeadClosed 로 뭉뚱그리지 않고
    // 배정불가만 따로 본다. 회수(assignedTo = null)도 함께 막는다 — 배정불가 건은 이미
    // 담당자가 없고, 그대로 통과시키면 assigned_by 만 이 사람으로 덮인다.
    if (lead.status === LEAD_STATUS_BLOCKED) {
      return bad('배정 불가 상태에서는 담당자를 지정할 수 없습니다. 먼저 배정 불가를 해제해 주세요.', 409)
    }
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

    // 배정에 따라 상태가 자동으로 따라간다. 다만 종결된 건은 건드리지 않는다.
    // 여기 올 수 있는 종결은 전환완료·미진행 둘뿐이다(배정불가는 위에서 돌려보냈다).
    const statusPatch = isLeadClosed(lead.status)
      ? {}
      : { status: assignedTo === null ? LEAD_STATUS_NEW : LEAD_STATUS_ACTIVE }

    // 배정자 = 이 배정을 실행한 사람. 세션에서 판정한 caller 만 쓴다(요청 본문의 값은 읽지 않는다).
    // 재배정하면 그때의 실행자로 갱신된다 — 최초 배정자를 고정해 두지 않는다.
    // 회수(assignedTo === null)도 실행 기록이므로 같이 남긴다.
    const { error } = await supabaseAdmin.from('leads')
      .update({ assigned_to: assignedTo, assigned_by: caller.engineer_id, ...statusPatch, ...touch })
      .eq('lead_id', leadId)
    if (error) return fail('assign update failed', error)

    // 누가 누구에게 넘겼는지. 리드 행에는 「지금 담당자」만 남아 이전 담당자는 여기서만 확인된다.
    await writeLeadAudit(lead, {
      action: 'LEAD_ASSIGN', actorId: caller.engineer_id,
      oldData: { assigned_to: lead.assigned_to, status: lead.status },
      newData: { assigned_to: assignedTo, status: statusPatch.status ?? lead.status },
    })

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
    // 파트너사에 담당자를 알린다. 배정을 푸는 경우(null)와 같은 사람으로 다시 저장한 경우는 보내지 않는다.
    // 이전 담당자가 있었으면 '변경', 없었으면 '배정'으로 제목·첫 문장이 갈린다.
    const partnerMailSent = assignedTo !== null && assignedTo !== lead.assigned_to
      ? await notifyPartnerAssigned(lead, assignedTo, lead.assigned_to != null)
      : false
    return NextResponse.json({ success: true, assignedTo, status: statusPatch.status ?? lead.status, partnerMailSent })
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

  // ── 배정 불가 — 관리자만. 담당자를 붙이지 않고 닫는 종결이라 사유를 반드시 받는다. ──
  if (action === 'block') {
    if (!admin) return bad('배정 불가 처리는 관리자만 할 수 있습니다.', 403)
    if (isLeadClosed(lead.status)) return bad('이미 종결된 리드입니다.', 409)

    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) return bad('배정 불가 사유를 입력해주세요.')
    if (reason.length < SKIP_REASON_MIN) return bad(`배정 불가 사유는 ${SKIP_REASON_MIN}자 이상 입력해주세요.`)
    if (reason.length > MAX_LEN.skip_reason) return bad(`배정 불가 사유는 ${MAX_LEN.skip_reason}자를 넘을 수 없습니다.`)

    // 배정 불가인데 담당자가 남아 있으면 모순이라 배정을 함께 푼다.
    // 배정자(assigned_by)는 남긴다 — 누가 배정했던 건인지는 기록으로 남아야 한다.
    const previousAssignee = lead.assigned_to
    // 처리자는 세션에서 판정한 caller 만 쓴다(본문 값은 읽지 않는다 — 배정자와 같은 규칙).
    // 시각은 updated_at 과 따로 둔다: updated_at 은 뒤에 메모만 고쳐도 바뀐다.
    const { error } = await supabaseAdmin.from('leads')
      .update({
        status: LEAD_STATUS_BLOCKED, block_reason: reason, assigned_to: null,
        blocked_by: caller.engineer_id, blocked_at: new Date().toISOString(),
        ...touch,
      })
      .eq('lead_id', leadId)
    if (error) return fail('block update failed', error)

    await writeLeadAudit(lead, {
      action: 'LEAD_BLOCK', actorId: caller.engineer_id,
      oldData: { status: lead.status, assigned_to: previousAssignee },
      newData: { status: LEAD_STATUS_BLOCKED, block_reason: reason, previous_assignee: previousAssignee },
    })

    // 배정되어 있던 담당자에게만 알린다(배정 전 건이면 알릴 사람이 없다).
    // 사유는 길이가 제각각이라 메시지에 넣지 않는다 — 링크를 누르면 상세에서 전문을 본다(미진행과 같은 규칙).
    if (previousAssignee != null) {
      await notifyLead({
        engineerIds: [previousAssignee],
        title: '리드 배정 불가',
        message: `${leadNoTag(lead.lead_no)}리드가 배정 불가로 처리되어 배정이 해제되었습니다.`,
        type: 'lead_blocked',
        leadId,
      })
    }
    return NextResponse.json({ success: true, status: LEAD_STATUS_BLOCKED, unassigned: previousAssignee != null })
  }

  // ── 배정 불가 해제 — 관리자만. '신규'·미배정으로 되돌린다. ──
  //
  // 되돌리는 것은 배정 불가 하나뿐이다. 전환완료·미진행은 여기로 오지 못한다(상태 검사에서 걸린다) —
  // 전환은 영업기회가 이미 만들어졌고, 미진행은 담당자의 판단이라 관리자가 뒤집을 일이 아니다.
  //
  // 사유·처리자·시각을 **반드시 함께 비운다**. 상태만 되돌리면 CHECK(leads_blocked_actor_check)가
  // 막는다 — 「배정불가가 아닌데 처리 기록이 남아 있는」 행을 DB 가 애초에 허용하지 않는다.
  //
  // 알림은 보내지 않는다. 이전 담당자는 배정 불가 때 이미 해제 알림을 받았고, 지금은 담당자가
  // 없는 상태로 돌아가는 것뿐이라 알릴 사람이 없다. 파트너사 메일도 배정이 생길 때만 나간다.
  if (action === 'unblock') {
    if (!admin) return bad('배정 불가 해제는 관리자만 할 수 있습니다.', 403)
    if (lead.status !== LEAD_STATUS_BLOCKED) return bad('배정 불가 상태가 아닙니다.', 409)

    // 조건부 UPDATE — 읽은 뒤 누가 먼저 바꿨으면 0행이 되어 되살아나지 않는다.
    const { data: done, error } = await supabaseAdmin.from('leads')
      .update({
        status: LEAD_STATUS_NEW,
        block_reason: null, blocked_by: null, blocked_at: null,
        assigned_to: null,
        ...touch,
      })
      .eq('lead_id', leadId)
      .eq('status', LEAD_STATUS_BLOCKED)
      .select('lead_id')
    if (error) return fail('unblock update failed', error)
    if (!done || done.length === 0) return bad('이미 처리되었거나 없는 리드입니다.', 409)

    // 지운 값을 old_data 에 남긴다 — 해제하고 나면 리드 행에는 아무 흔적도 없어
    // 이 한 줄이 「무슨 사유로 누가 언제 닫았던 건인지」의 유일한 증거다.
    await writeLeadAudit(lead, {
      action: 'LEAD_UNBLOCK', actorId: caller.engineer_id,
      oldData: {
        status: LEAD_STATUS_BLOCKED,
        block_reason: lead.block_reason,
        blocked_by: lead.blocked_by,
        blocked_at: lead.blocked_at,
      },
      newData: { status: LEAD_STATUS_NEW, assigned_to: null },
    })
    return NextResponse.json({ success: true, status: LEAD_STATUS_NEW })
  }

  // ── 파트너사 메일 재발송 — 관리자만. 배정 통보를 다시 보낸다(데이터는 건드리지 않는다). ──
  if (action === 'resend_mail') {
    if (!admin) return bad('메일 재발송은 관리자만 할 수 있습니다.', 403)
    if (lead.assigned_to == null) return bad('담당자가 배정된 리드만 다시 보낼 수 있습니다.')
    if (!lead.partner_email) return bad('파트너사 이메일이 없습니다.')
    // 재발송은 '변경' 이 아니라 지금 상태를 다시 알리는 것이므로 배정 문구로 보낸다.
    const partnerMailSent = await notifyPartnerAssigned(lead, lead.assigned_to, false)
    return NextResponse.json({ success: true, partnerMailSent })
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
