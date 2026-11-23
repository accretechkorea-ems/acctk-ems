// 리드 **회수·되돌리기** — 지우지 않고 번호만 반납한다 (2026-11-23).
//
//   POST { action: 'recall',  leadId, reason }   번호 반납(행·내용은 그대로)
//   POST { action: 'restore', leadId }           번호 되찾기(아직 비어 있을 때만)
//
// 슈퍼관리자 전용이다. 하드 삭제(/api/lead-delete)를 대신하는 길이라 문턱도 그때와 같다.
// 사유는 필수다 — 「번호가 왜 비었나」를 나중에 물을 사람이 반드시 있다.
//
// 사건(customer_events)은 **고객사가 붙어 있을 때만** 적는다. 그 표는 customer_id 가
// 필수라 고객사 없는 리드는 적을 자리가 없다(그 경우 로그만 남긴다).

import { NextResponse } from 'next/server'
import { loadCaller } from '@/lib/apiCaller'
import { writeCustomerEvents } from '@/lib/customerEvents'
import {
  RECALL_SCHEMA_MESSAGE, isMissingRecallColumn, recallBlockedReason, restoreBlockedReason,
} from '@/lib/leadRecall'

const TAG = 'lead-recall'
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 회수·되돌리기에 필요한 칸만. */
const COLUMNS = 'lead_id, lead_no, recalled_no, recalled_at, recalled_by, recall_reason, status, customer_company, customer_id, lead_no'

export async function POST(req: Request) {
  const { error: authError, caller, sb } = await loadCaller({ kind: 'superadmin' }, { tag: TAG, req, method: 'POST' })
  if (authError) return authError

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('요청을 읽지 못했습니다')
  const action = String(body.action ?? '')
  const leadId = Number(body.leadId)
  if (!Number.isInteger(leadId) || leadId <= 0) return bad('리드를 찾지 못했습니다')

  const { data: lead, error: readErr } = await sb.from('leads').select(COLUMNS).eq('lead_id', leadId).maybeSingle()
  if (readErr) {
    if (isMissingRecallColumn(readErr)) return bad(RECALL_SCHEMA_MESSAGE, 503)
    return NextResponse.json({ error: readErr.message }, { status: 500 })
  }
  if (!lead) return bad('리드를 찾지 못했습니다')
  const row = lead as unknown as (Record<string, unknown> & { lead_id: number; lead_no: string | null; recalled_no: string | null })
  const now = new Date().toISOString()

  /** 고객사가 붙어 있으면 사건을 남긴다. 없으면 조용히 넘어간다(적을 자리가 없다). */
  const logEvent = async (type: 'lead_recalled' | 'lead_restored', payload: Record<string, unknown>) => {
    const customerId = Number(row.customer_id)
    if (!Number.isInteger(customerId) || customerId <= 0) return 0
    const { written } = await writeCustomerEvents(sb, [{
      customer_id: customerId,
      event_type: type,
      occurred_at: now,
      actor_engineer_id: caller.engineer_id,
      payload,
    }])
    return written
  }

  if (action === 'recall') {
    const reason = String(body.reason ?? '').trim()
    const blocked = recallBlockedReason(row, reason)
    if (blocked) return bad(blocked)

    const original = String(row.lead_no ?? '')
    const { error } = await sb.from('leads').update({
      lead_no: null,
      recalled_no: original,
      recalled_at: now,
      recalled_by: caller.engineer_id,
      recall_reason: reason,
    }).eq('lead_id', leadId)
    if (error) {
      if (isMissingRecallColumn(error)) return bad(RECALL_SCHEMA_MESSAGE, 503)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const events = await logEvent('lead_recalled', { lead_id: leadId, lead_no: original, reason })
    console.log(`[${TAG}] recall`, { leadId, original, by: caller.email })
    return NextResponse.json({ ok: true, recalled_no: original, events })
  }

  if (action === 'restore') {
    // 지금 살아 있는 번호 전부 — 그 번호를 누가 가져갔는지 본다.
    const { data: live, error: liveErr } = await sb.from('leads').select('lead_no').not('lead_no', 'is', null)
    if (liveErr) return NextResponse.json({ error: liveErr.message }, { status: 500 })
    const blocked = restoreBlockedReason(row, (live ?? []).map(l => (l as { lead_no: string | null }).lead_no))
    if (blocked) return bad(blocked, 409)

    const back = String(row.recalled_no ?? '')
    const { error } = await sb.from('leads').update({
      lead_no: back,
      recalled_no: null,
      recalled_at: null,
      recalled_by: null,
      recall_reason: null,
    }).eq('lead_id', leadId)
    if (error) {
      // 23505 = 유니크 위반. 방금 사이에 누가 그 번호를 받아 갔다.
      if (error.code === '23505') return bad(`${back} 번호를 다른 리드가 이미 쓰고 있습니다`, 409)
      if (isMissingRecallColumn(error)) return bad(RECALL_SCHEMA_MESSAGE, 503)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const events = await logEvent('lead_restored', { lead_id: leadId, lead_no: back })
    console.log(`[${TAG}] restore`, { leadId, back, by: caller.email })
    return NextResponse.json({ ok: true, lead_no: back, events })
  }

  return bad('모르는 작업입니다')
}
