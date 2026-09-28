// 쇼룸 사용 신청 — 전자결재로 상신(POST) · 반려·회수 건 재작성(PATCH). 흐름 전체는 ./shared.ts 머리 설명을 본다.
//
// 4단계에서 승인 경로가 요청함에서 결재로 옮겨졌다. 이 라우트가 하는 일은 그대로 「신청 내용을 검증하고
// 번호를 붙이고 사후면 기록을 만드는 것」이고, 그 뒤 상신은 lib/approval/submit.ts 가 한다.
// 라우트가 라우트를 HTTP 로 부르지 않는다 — 같은 프로세스에서 함수로 부른다(두 번 왕복하지 않고,
// 중간에 끊겨 반쪽 상태가 남는 창도 없다).
//
// POST  — 로그인 + showroom 메뉴 권한. 결재선(lines)을 함께 받는다.
//         사전·사후는 사용일자로 서버가 정한다(KST 오늘까지 = 사후). 사후는 사용 기록을 먼저 만든 뒤 상신한다 —
//         이미 끝난 사용이라 결재는 「확인」이고, 반려도 없다(lib/approval/docTypes.ts 의 canRejectDoc).
// PATCH — 반려·회수된 문서를 신청자 본인이 다시 쓴다. 내용을 새로 쓰고 결재선을 처음 상태로 돌려 다시 돌린다.
//         결재선을 새로 주면 그것으로 갈아끼운다.
// 응답에 retroactive(사후 여부)를 실어 화면이 안내 문구를 고른다.
import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu } from '@/lib/permissions'
import { todayKST } from '@/lib/date'
import { type DemoRequestPayload } from '@/lib/showroom'
import { createApprovalDocument, resubmitApprovalDocument, checkLines } from '@/lib/approval/submit'
import { buildSummary, readSummary, type ShowroomSummary } from '@/lib/approval/showroomUsage'
import type { LineInput } from '@/lib/approval/types'
import {
  admin, bad, loadCaller, parseDemoBody, resolveDemo, buildPayload, findOverlap,
  allocateDocNo, settleDocNo, createUsageFromRequest,
  pdfDataFromPayload, renderApprovalPdf, dropApprovalPdf,
} from './shared'

const TAG = 'showroom/requests'

const DOC_TYPE = 'showroom_usage'
const TARGET_TABLE = 'showroom_usage'

/** 결재함 목록에 보일 제목. */
const titleOf = (p: DemoRequestPayload) => `${p.device_name} · ${p.usage_date} 쇼룸 사용 신청`

/** 화면이 보낸 결재선을 읽는다. 모양만 맞추고 내용 검증은 checkLines 가 한다. */
function readLines(raw: unknown): LineInput[] | null {
  if (!Array.isArray(raw)) return null
  return raw.map(r => ({
    step: Number((r as LineInput)?.step),
    kind: (r as LineInput)?.kind,
    approverId: Number((r as LineInput)?.approverId),
    isDelegatedAuthority: (r as LineInput)?.isDelegatedAuthority === true,
  })) as LineInput[]
}

/** 도장 없는 승인서를 만들어 summary.pdf_url 에 적는다. 실패해도 상신은 그대로 둔다. */
async function makePdf(
  sb: ReturnType<typeof admin>, documentId: number, s: ShowroomSummary, tag: string,
): Promise<boolean> {
  const data = pdfDataFromPayload(s.payload, {
    requestDate: todayKST(),
    statusLabel: s.is_retroactive ? '확인 대기' : '대기중',
    stamps: [],
    opinion: '',
  })
  const path = await renderApprovalPdf(sb, tag ? `${s.payload.request_no}-${tag}` : s.payload.request_no, data)
  if (!path) return false
  const { error } = await sb
    .from('approval_documents')
    .update({ summary: { ...s, pdf_url: path } })
    .eq('document_id', documentId)
  if (error) {
    console.error(`[${TAG}] pdf_url 기록 실패`, { documentId, error })
    await dropApprovalPdf(sb, path)
    return false
  }
  if (s.pdf_url && s.pdf_url !== path) await dropApprovalPdf(sb, s.pdf_url)
  return true
}

// ── POST: 상신 ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await loadCaller(TAG, { fresh: true })
  if (auth.error) return auth.error
  const caller = auth.caller
  if (!canViewMenu(caller, 'showroom')) return bad('Forbidden', 403)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const today = todayKST()
  const parsed = parseDemoBody(body, today)
  if ('error' in parsed) return bad(parsed.error)
  const input = parsed.value

  const lines = readLines(body.lines)
  if (!lines) return bad('결재선을 지정해주세요.')

  const sb = admin()
  const resolved = await resolveDemo(sb, input)
  if ('error' in resolved) return bad(resolved.error, resolved.status)

  // 결재선은 기록을 만들기 전에 본다 — 결재선이 틀려서 상신이 막힐 건이면 기록도 만들지 않는다.
  const lineProblem = await checkLines(sb, lines, caller.engineer_id)
  if (lineProblem) return bad(lineProblem)

  // 사후 신청은 사용 기록을 바로 만든다 — 겹치는 기록이 있으면 신청부터 막는다(만든 뒤 지우는 일이 없게).
  if (input.is_retroactive) {
    const ov = await findOverlap(sb, input.device_id, input.usage_date, input.start_time, input.end_time)
    if (ov.error) return bad('사용 기록을 확인하지 못했습니다.', 500)
    if (ov.clash) return bad(`같은 장비에 겹치는 사용 기록이 있습니다 (${ov.clash})`, 409)
  }

  let payload: DemoRequestPayload
  try {
    payload = buildPayload(input, resolved.snap, await allocateDocNo(sb, today), caller)
  } catch (e) {
    console.error(`[${TAG}] doc number allocate failed`, e)
    return bad('신청번호를 발급하지 못했습니다. 잠시 뒤 다시 시도해주세요.', 409)
  }

  // 사후 신청 — 기록을 먼저 만든다. 상신이 실패하면 이 기록을 지운다.
  let usageId: number | null = null
  if (input.is_retroactive) {
    const made = await createUsageFromRequest(sb, null, payload, caller.engineer_id)
    if ('error' in made) return bad(made.error, made.status)
    usageId = made.usageId
  }

  const summary = buildSummary(payload, { usageId })
  const made = await createApprovalDocument(sb, {
    docType: DOC_TYPE, docNo: payload.request_no, title: titleOf(payload), summary,
    targetTable: TARGET_TABLE, targetId: usageId,
    lines, requesterId: caller.engineer_id, today,
  })
  if (!made.ok) {
    if (usageId != null) {
      // 문서가 없는 사용 기록을 남기지 않는다.
      const { error } = await sb.from('showroom_usage').delete().eq('usage_id', usageId)
      if (error) console.error(`[${TAG}] usage rollback failed`, { usageId, error })
    }
    return bad(made.error, made.status)
  }

  // 번호가 겹쳤으면(동시 상신) 다음 번호로 옮긴다. 옮겨진 번호를 summary 에도 반영한다.
  let finalNo = payload.request_no
  try {
    finalNo = await settleDocNo(sb, made.documentId, payload.request_no, today)
  } catch (e) {
    console.error(`[${TAG}] doc number settle failed`, { documentId: made.documentId, error: e })
  }
  const settled: ShowroomSummary = finalNo === payload.request_no
    ? summary
    : { ...summary, payload: { ...payload, request_no: finalNo } }

  const pdfOk = await makePdf(sb, made.documentId, settled, '')

  return NextResponse.json({
    success: true,
    document_id: made.documentId,
    request_no: finalNo,
    pdfOk,
    retroactive: input.is_retroactive,
    notified: made.notified,
  })
}

// ── PATCH: 반려·회수 건 재작성 ───────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const auth = await loadCaller(TAG, { fresh: true })
  if (auth.error) return auth.error
  const caller = auth.caller
  if (!canViewMenu(caller, 'showroom')) return bad('Forbidden', 403)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const documentId = Number(body.document_id)
  if (!Number.isInteger(documentId) || documentId <= 0) return bad('문서를 지정해주세요.')

  const sb = admin()
  const { data: row, error: rowErr } = await sb
    .from('approval_documents')
    .select('document_id, doc_type, status, requester_id, summary')
    .eq('document_id', documentId)
    .maybeSingle()
  if (rowErr) {
    console.error(`[${TAG}] document lookup failed`, { documentId, error: rowErr })
    return bad('문서를 불러오지 못했습니다.', 500)
  }
  const doc = row as { doc_type: string; status: string; requester_id: number; summary: Record<string, unknown> } | null
  if (!doc || doc.doc_type !== DOC_TYPE) return bad('문서를 찾을 수 없습니다.', 404)
  if (doc.requester_id !== caller.engineer_id) return bad('본인이 낸 신청만 다시 쓸 수 있습니다.', 403)
  if (doc.status !== '반려' && doc.status !== '회수') return bad('반려·회수된 신청만 다시 쓸 수 있습니다.', 409)
  const before = readSummary(doc.summary)
  if (!before) return bad('신청 내용을 읽지 못했습니다.', 500)

  // 사전·사후는 다시 쓴 사용일자로 정한다 — 반려된 사전 신청을 지난 날짜로 다시 쓰면 사후 신청이 된다.
  const today = todayKST()
  const parsed = parseDemoBody(body, today)
  if ('error' in parsed) return bad(parsed.error)
  const input = parsed.value
  const resolved = await resolveDemo(sb, input)
  if ('error' in resolved) return bad(resolved.error, resolved.status)

  // 결재선을 새로 준 경우에만 검증한다(주지 않으면 있던 결재선을 그대로 다시 쓴다).
  const lines = body.lines === undefined ? undefined : readLines(body.lines)
  if (body.lines !== undefined && !lines) return bad('결재선을 지정해주세요.')
  if (lines) {
    const lineProblem = await checkLines(sb, lines, caller.engineer_id)
    if (lineProblem) return bad(lineProblem)
  }

  if (input.is_retroactive) {
    const ov = await findOverlap(sb, input.device_id, input.usage_date, input.start_time, input.end_time)
    if (ov.error) return bad('사용 기록을 확인하지 못했습니다.', 500)
    if (ov.clash) return bad(`같은 장비에 겹치는 사용 기록이 있습니다 (${ov.clash})`, 409)
  }

  // 번호는 처음 상신 때 받은 것을 그대로 쓴다(승인서·기록이 그 번호로 이어져 있다).
  const payload = buildPayload(input, resolved.snap, before.payload.request_no, caller)

  // 사후로 바뀌었으면 기록을 지금 만든다. 다시 올리기가 실패하면 지운다.
  let usageId = before.usage_id ?? null
  if (input.is_retroactive && usageId == null) {
    const made = await createUsageFromRequest(sb, null, payload, caller.engineer_id)
    if ('error' in made) return bad(made.error, made.status)
    usageId = made.usageId
  }

  const summary = buildSummary(payload, { usageId, pdfUrl: before.pdf_url ?? null })
  const again = await resubmitApprovalDocument(sb, {
    documentId, requesterId: caller.engineer_id, today, lines: lines ?? undefined, summary, title: titleOf(payload),
  })
  if (!again.ok) {
    if (usageId != null && (before.usage_id ?? null) == null) {
      const { error } = await sb.from('showroom_usage').delete().eq('usage_id', usageId)
      if (error) console.error(`[${TAG}] usage rollback failed`, { usageId, error })
    }
    return bad(again.error, again.status)
  }

  if (usageId != null && (before.usage_id ?? null) == null) {
    const { error } = await sb.from('approval_documents').update({ target_id: usageId }).eq('document_id', documentId)
    if (error) console.error(`[${TAG}] target_id update failed`, { documentId, error })
  }

  const pdfOk = await makePdf(sb, documentId, summary, 'rev')

  return NextResponse.json({
    success: true,
    document_id: documentId,
    request_no: payload.request_no,
    pdfOk,
    retroactive: input.is_retroactive,
    notified: again.notified,
  })
}
