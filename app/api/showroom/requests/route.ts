// 쇼룸 데모 사용 신청 — 작성(POST) · 반려 건 재작성(PATCH). 흐름 전체는 ./shared.ts 머리 설명을 본다.
//
// POST  — 로그인 + canViewCustomers. approval_requests '대기중' 으로 저장하고 승인서 PDF 를 만든 뒤 superadmin 에게 알린다.
//         사전·사후는 사용일자로 서버가 정한다(KST 오늘까지 = 사후). 사후 신청은 사용 기록도 바로 만든다 —
//         만들다 실패하면 신청도 지운다.
// PATCH — 반려된 신청을 신청자 본인이 다시 쓴다. '대기중' 으로 되돌리고 의견·승인자·결정시각을 비운 뒤 PDF 를 바꾼다.
//         다시 쓴 사용일자가 오늘까지면 사후 신청이 되어 사용 기록을 바로 만든다 — 실패하면 반려 상태로 되돌린다.
// 응답에 retroactive(사후 여부)를 실어 화면이 안내 문구를 고른다.
import { NextRequest, NextResponse } from 'next/server'
import { canViewCustomers } from '@/lib/permissions'
import { todayKST } from '@/lib/date'
import { DEMO_REQUEST_TYPE, REQUEST_PENDING, REQUEST_REJECTED, type DemoRequestPayload } from '@/lib/showroom'
import {
  admin, bad, loadCaller, parseDemoBody, resolveDemo, buildPayload, findOverlap,
  allocateRequestNo, settleRequestNo, createUsageFromRequest, refreshApprovalPdf,
  notifySuperadmins, requestSummary, NOTICE_REQUEST, REQUEST_COLUMNS, type RequestRecord,
} from './shared'

const TAG = 'showroom/requests'

// ── POST: 신청 ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await loadCaller(TAG, { fresh: true })
  if (auth.error) return auth.error
  const caller = auth.caller
  if (!canViewCustomers(caller)) return bad('Forbidden', 403)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const today = todayKST()
  const parsed = parseDemoBody(body, today)
  if ('error' in parsed) return bad(parsed.error)
  const input = parsed.value

  const sb = admin()
  const resolved = await resolveDemo(sb, input)
  if ('error' in resolved) return bad(resolved.error, resolved.status)

  // 사후 신청은 사용 기록을 바로 만든다 — 겹치는 기록이 있으면 신청부터 막는다(만든 뒤 지우는 일이 없게).
  if (input.is_retroactive) {
    const ov = await findOverlap(sb, input.device_id, input.usage_date, input.start_time, input.end_time)
    if (ov.error) return bad('사용 기록을 확인하지 못했습니다.', 500)
    if (ov.clash) return bad(`같은 장비에 겹치는 사용 기록이 있습니다 (${ov.clash})`, 409)
  }

  let payload: DemoRequestPayload
  try {
    payload = buildPayload(input, resolved.snap, await allocateRequestNo(sb, today), caller)
  } catch (e) {
    console.error(`[${TAG}] request number allocate failed`, e)
    return bad('신청번호를 발급하지 못했습니다. 잠시 뒤 다시 시도해주세요.', 409)
  }

  const { data: created, error: insErr } = await sb
    .from('approval_requests')
    .insert({
      request_type: DEMO_REQUEST_TYPE,
      status: REQUEST_PENDING,
      requester_id: caller.engineer_id,
      payload,
      reason: input.reason,
    })
    .select(REQUEST_COLUMNS)
    .single()
  if (insErr || !created) {
    console.error(`[${TAG}] insert failed`, insErr)
    return bad('신청을 저장하지 못했습니다.', 500)
  }
  let record = created as unknown as RequestRecord

  // 번호를 끝내 맞추지 못하거나(동시 신청이 몰린 경우) 사용 기록을 못 만들면 신청을 지운다 — 반쪽 신청을 남기지 않는다.
  const rollback = async () => {
    const { error: rbErr } = await sb.from('approval_requests').delete().eq('request_id', record.request_id)
    if (rbErr) console.error(`[${TAG}] rollback failed`, { requestId: record.request_id, error: rbErr })
  }

  try {
    record = { ...record, payload: await settleRequestNo(sb, record.request_id, record.payload, today) }
  } catch (e) {
    console.error(`[${TAG}] request number settle failed`, { requestId: record.request_id, error: e })
    await rollback()
    return bad('신청번호가 겹쳐 저장하지 못했습니다. 다시 시도해주세요.', 409)
  }

  if (input.is_retroactive) {
    const usage = await createUsageFromRequest(sb, record.request_id, record.payload, caller.engineer_id)
    if ('error' in usage) {
      await rollback()
      return bad(usage.error, usage.status)
    }
  }

  const pdfOk = await refreshApprovalPdf(sb, record, '')

  await notifySuperadmins(sb, caller.engineer_id, {
    title: input.is_retroactive ? '쇼룸 사용 신청 (사후)' : '쇼룸 사용 신청',
    message: requestSummary(record.payload),
    type: NOTICE_REQUEST,
    link: '/requests',
  })

  return NextResponse.json({
    success: true, request_id: record.request_id, request_no: record.payload.request_no, pdfOk, retroactive: input.is_retroactive,
  })
}

// ── PATCH: 반려 건 재작성 ───────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const auth = await loadCaller(TAG, { fresh: true })
  if (auth.error) return auth.error
  const caller = auth.caller
  if (!canViewCustomers(caller)) return bad('Forbidden', 403)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const requestId = Number(body.request_id)
  if (!Number.isInteger(requestId) || requestId <= 0) return bad('신청을 지정해주세요.')

  const sb = admin()
  const { data: row, error: rowErr } = await sb.from('approval_requests').select(REQUEST_COLUMNS).eq('request_id', requestId).maybeSingle()
  if (rowErr) {
    console.error(`[${TAG}] row lookup failed`, { requestId, error: rowErr })
    return bad('신청을 불러오지 못했습니다.', 500)
  }
  const current = row as unknown as RequestRecord | null
  if (!current || current.request_type !== DEMO_REQUEST_TYPE) return bad('신청을 찾을 수 없습니다.', 404)
  if (current.requester_id !== caller.engineer_id) return bad('본인이 낸 신청만 다시 쓸 수 있습니다.', 403)
  if (current.status !== REQUEST_REJECTED) return bad('반려된 신청만 다시 쓸 수 있습니다.', 409)

  // 사전·사후는 다시 쓴 사용일자로 정한다 — 반려된 사전 신청을 지난 날짜로 다시 쓰면 사후 신청이 된다.
  const parsed = parseDemoBody(body, todayKST())
  if ('error' in parsed) return bad(parsed.error)
  const input = parsed.value
  const resolved = await resolveDemo(sb, input)
  if ('error' in resolved) return bad(resolved.error, resolved.status)

  // 사후가 되면 사용 기록을 바로 만든다 — 겹치는 기록이 있으면 먼저 막는다.
  if (input.is_retroactive) {
    const ov = await findOverlap(sb, input.device_id, input.usage_date, input.start_time, input.end_time)
    if (ov.error) return bad('사용 기록을 확인하지 못했습니다.', 500)
    if (ov.clash) return bad(`같은 장비에 겹치는 사용 기록이 있습니다 (${ov.clash})`, 409)
  }

  const payload = buildPayload(input, resolved.snap, current.payload.request_no, caller)
  const now = new Date().toISOString()
  // 반려 상태 조건을 함께 건다 — 0건이면 그사이 상태가 바뀐 것이다.
  const { data: updated, error: updErr } = await sb
    .from('approval_requests')
    .update({
      payload,
      reason: parsed.value.reason,
      status: REQUEST_PENDING,
      comment: null,
      approver_id: null,
      decided_at: null,
      updated_at: now,
    })
    .eq('request_id', requestId)
    .eq('status', REQUEST_REJECTED)
    .select(REQUEST_COLUMNS)
  if (updErr) {
    console.error(`[${TAG}] rewrite update failed`, { requestId, error: updErr })
    return bad('신청을 다시 저장하지 못했습니다.', 500)
  }
  if (!updated || updated.length === 0) return bad('반려된 신청만 다시 쓸 수 있습니다.', 409)
  const record = updated[0] as unknown as RequestRecord

  if (input.is_retroactive) {
    const usage = await createUsageFromRequest(sb, requestId, record.payload, caller.engineer_id)
    if ('error' in usage) {
      // 사용 기록을 못 만들었으면 재작성 전(반려) 그대로 되돌린다 — 기록 없는 사후 신청을 남기지 않는다.
      const { error: rbErr } = await sb
        .from('approval_requests')
        .update({
          payload: current.payload,
          reason: current.reason,
          status: REQUEST_REJECTED,
          comment: current.comment,
          approver_id: current.approver_id,
          decided_at: current.decided_at,
          updated_at: new Date().toISOString(),
        })
        .eq('request_id', requestId)
        .eq('status', REQUEST_PENDING)
      if (rbErr) console.error(`[${TAG}] rewrite rollback failed`, { requestId, error: rbErr })
      return bad(usage.error, usage.status)
    }
  }

  const pdfOk = await refreshApprovalPdf(sb, record, 'rev')

  await notifySuperadmins(sb, caller.engineer_id, {
    title: input.is_retroactive ? '쇼룸 사용 신청 (재작성 · 사후)' : '쇼룸 사용 신청 (재작성)',
    message: requestSummary(record.payload),
    type: NOTICE_REQUEST,
    link: '/requests',
  })

  return NextResponse.json({
    success: true, request_id: requestId, request_no: record.payload.request_no, pdfOk, retroactive: input.is_retroactive,
  })
}
