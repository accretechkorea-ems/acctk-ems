// 상신 — 문서·결재선·이력을 만들고 첫 차례에게 알린다.
//
// 라우트(app/api/approval)와 다른 기능의 서버 코드(쇼룸 사용 신청 등)가 같은 상신 절차를 쓰도록
// 여기로 뽑았다. HTTP 로 서로를 부르지 않는다 — 같은 프로세스 안에서 함수로 부른다.
//
// 이 파일은 서버 전용이다(service role 클라이언트를 받는다). 화면에서 import 하지 마라.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isSuperAdmin } from '../permissions'
import { nextPendingLine, toLineRows, validateLineInput, delegatesOf } from './engine'
import { DOC_TYPES } from './docTypes'
import { checkLineRules } from './lineRules'
import { approvalDocPath, type ApprovalLine, type Delegation, type LineInput } from './types'

export type SubmitResult =
  | { ok: true; documentId: number; lines: ApprovalLine[]; notified: number | null; linesReplaced?: boolean }
  | { ok: false; error: string; status: number }

export type SubmitInput = {
  docType: string
  docNo: string
  title: string
  summary: Record<string, unknown>
  targetTable: string
  targetId: number | null
  lines: LineInput[]
  requesterId: number
  /** 오늘(KST) — 위임 판정에 쓴다. */
  today: string
}

/**
 * 결재선 검증의 **단 한 곳**. 모든 상신·재상신 경로가 여기를 지난다
 * (쇼룸 POST·PATCH, 견적 삭제, 범용 submit, 결재 라우트의 재상신). 문제가 있으면 메시지.
 *
 * 두 단계다.
 *   ① 모양 — validateLineInput(engine.ts). 문서 종류를 모르는 검사다.
 *   ② 종류별 요구 — checkLineRules(lineRules.ts). docType 을 주지 않으면 건너뛴다.
 *
 * **순서가 중요하다.** 부르는 쪽은 이 검증을 원 기록을 만들기 **전에** 해야 한다 —
 * 쇼룸 사후 신청처럼 상신 전에 사용 기록을 만드는 흐름이 결재선 때문에 막히면, 기록만 남고
 * 문서가 없는 상태가 된다(그래서 쇼룸 라우트가 checkLines 를 createUsageFromRequest 앞에 둔다).
 *
 * 직원 조회는 한 번이다 — 결재자들과 상신자를 함께 읽어 재직 여부와 등급을 같은 결과에서 본다.
 */
export async function checkLines(
  sb: SupabaseClient,
  lines: LineInput[],
  requesterId: number,
  /** 종류별 결재선 규칙을 함께 볼 때 넘긴다. 없으면 모양 검사만 한다. */
  docType?: string,
): Promise<string | null> {
  const ids = [...new Set(lines.map(l => l.approverId).filter(n => Number.isInteger(n) && n > 0))]
  // 상신자를 함께 읽는다 — 등급 면제(관리자가 올린 문서) 판정에 필요하다. 결재자 수가 적어 한 번에 끝난다.
  const lookup = [...new Set([...ids, requesterId])].filter(n => Number.isInteger(n) && n > 0)
  const { data, error } = await sb
    .from('engineers')
    .select('engineer_id, resigned_date, permission_level')
    .in('engineer_id', lookup.length > 0 ? lookup : [0])
  if (error) {
    console.error('[approval/submit] approver lookup failed', error)
    return '결재자를 확인하지 못했습니다.'
  }
  type Row = { engineer_id: number; resigned_date: string | null; permission_level: string | null }
  const rows = (data ?? []) as Row[]

  // 재직 판정에서 상신자는 뺀다 — 결재선에 본인이 들어가는 것은 validateLineInput 이 따로 막는다.
  const active = new Set(
    rows.filter(e => !e.resigned_date && e.engineer_id !== requesterId).map(e => e.engineer_id),
  )
  const shaped = validateLineInput(lines, requesterId, active)
  if (shaped) return shaped

  if (docType === undefined) return null
  const supers = new Set(
    rows.filter(e => isSuperAdmin({ permission_level: e.permission_level })).map(e => e.engineer_id),
  )
  const ruled = checkLineRules({
    lines,
    rules: DOC_TYPES[docType]?.lineRules,
    requesterIsSuperadmin: supers.has(requesterId),
    isSuperadmin: id => supers.has(id),
  })
  return ruled.ok ? null : ruled.message
}

/**
 * 방금 만든 문서를 지운다 — 상신 절차가 중간에 깨졌을 때만 쓴다. 성공하면 true.
 *
 * 순서가 있다: 이력을 먼저 지우고 문서를 지운다. 결재선(approval_lines)은 document_id 가
 * ON DELETE CASCADE 라 함께 사라진다(approval_schema.sql).
 *
 * **이미 돌기 시작한 문서에는 쓰지 마라.** 결재 이력을 지우는 것이라, 상신 직후의 되돌리기
 * (또는 그 직후에 딸린 처리가 실패해 상신 자체를 없던 일로 만드는 경우)에만 쓴다.
 * 반려·회수된 문서를 치우는 길은 지우기가 아니라 '폐기' 상태다.
 */
export async function rollbackApprovalDocument(sb: SupabaseClient, documentId: number): Promise<boolean> {
  await sb.from('approval_history').delete().eq('document_id', documentId)
  const { error } = await sb.from('approval_documents').delete().eq('document_id', documentId)
  if (error) {
    console.error('[approval/submit] rollback failed — 문서가 남았다', { documentId, error })
    return false
  }
  return true
}

/** 첫 차례 결재자와 그 대리인에게 「결재할 문서가 있습니다」. 실패해도 상신은 되돌리지 않는다. */
async function notifyFirst(sb: SupabaseClient, documentId: number, docType: string, title: string, line: ApprovalLine, today: string) {
  const { data, error } = await sb
    .from('approval_delegations')
    .select('owner_id, delegate_id, start_date, end_date, doc_type')
    .eq('owner_id', line.approver_id)
    .lte('start_date', today)
    .gte('end_date', today)
  if (error) console.error('[approval/submit] delegation lookup failed', error)
  const targets = [
    line.approver_id,
    ...delegatesOf(line.approver_id, ((data ?? []) as Delegation[]), today, docType),
  ]
  const { error: notiErr } = await sb.from('notifications').insert(
    [...new Set(targets)].map(engineer_id => ({
      engineer_id,
      title: '결재할 문서가 있습니다',
      message: title,
      type: 'approval_pending',
      // 누르면 그 문서를 바로 연다(예전에는 결재함 목록으로만 보냈다).
      link: approvalDocPath(documentId),
      is_read: false,
    })),
  )
  if (notiErr) console.error('[approval/submit] notification insert failed', notiErr)
}

/**
 * 문서를 만들어 '진행중' 으로 올린다.
 *
 * insert 가 셋(문서 → 결재선 → 이력)이고 트랜잭션을 걸 수 없으므로, 뒤가 실패하면 문서를 지워
 * 되돌린다(결재선은 FK CASCADE 로 함께 사라진다). 되돌리기까지 실패하면 그 사실을 메시지로 알린다.
 *
 * 결재선 검증은 부르는 쪽에서 checkLines 로 먼저 한다 — 쇼룸처럼 상신 전에 다른 일(기록 생성)을
 * 하는 흐름이 검증만 따로 앞세울 수 있어야 하기 때문이다.
 */
export async function createApprovalDocument(sb: SupabaseClient, input: SubmitInput): Promise<SubmitResult> {
  const now = new Date().toISOString()
  const { data: created, error: docErr } = await sb
    .from('approval_documents')
    .insert({
      doc_type: input.docType, doc_no: input.docNo, title: input.title, summary: input.summary,
      target_table: input.targetTable, target_id: input.targetId,
      status: '진행중', requester_id: input.requesterId,
      current_step: 1, submitted_at: now,
    })
    .select('document_id')
    .single()
  if (docErr || !created) {
    console.error('[approval/submit] document insert failed', docErr)
    return { ok: false, error: '상신하지 못했습니다.', status: 500 }
  }
  const documentId = (created as { document_id: number }).document_id

  const rollback = async (why: string, detail: unknown): Promise<SubmitResult> => {
    console.error('[approval/submit] rollback', { documentId, why, detail })
    const ok = await rollbackApprovalDocument(sb, documentId)
    if (!ok) {
      return { ok: false, error: '상신에 실패했고 되돌리지도 못했습니다. 결재함에서 상태를 확인해주세요.', status: 500 }
    }
    return { ok: false, error: '상신하지 못했습니다.', status: 500 }
  }

  const { data: madeLines, error: linesErr } = await sb
    .from('approval_lines')
    .insert(toLineRows(documentId, input.lines))
    .select('*')
  if (linesErr) return rollback('lines', linesErr)

  const { error: histErr } = await sb.from('approval_history').insert({
    document_id: documentId, action: '상신', actor_id: input.requesterId, step: null, comment: null,
  })
  if (histErr) return rollback('history', histErr)

  const lines = ((madeLines ?? []) as ApprovalLine[])
  const first = nextPendingLine(lines)
  if (first) await notifyFirst(sb, documentId, input.docType, input.title, first, input.today)

  return { ok: true, documentId, lines, notified: first ? first.approver_id : null }
}

export type ResubmitInput = {
  documentId: number
  requesterId: number
  today: string
  /** 새 결재선. 주면 통째로 갈아끼우고, 주지 않으면 있던 결재선을 '대기' 로 되돌린다. */
  lines?: LineInput[]
  /** 내용이 바뀌었으면 함께 고친다(쇼룸 재작성처럼 상신 내용을 다시 쓰는 경우). */
  summary?: Record<string, unknown>
  title?: string
}

/**
 * 반려·회수된 문서를 처음부터 다시 돌린다.
 *
 * 조건부 UPDATE(.in('status', ['반려','회수']))로 상태를 바꾸므로, 동시에 두 번 눌러도 한 번만 올라간다.
 * 결재선을 갈아끼우는 경우에는 옛 결재선을 먼저 지운다 — 그 뒤 insert 가 실패하면 되돌릴 값이 없으므로
 * 문서를 반려·회수 상태 그대로 두고 「결재선을 다시 지정해주세요」로 알린다.
 */
export async function resubmitApprovalDocument(sb: SupabaseClient, input: ResubmitInput): Promise<SubmitResult> {
  const { documentId } = input
  const { data: row, error: rowErr } = await sb
    .from('approval_documents')
    .select('document_id, doc_type, title, status, requester_id, summary')
    .eq('document_id', documentId)
    .maybeSingle()
  if (rowErr) {
    console.error('[approval/submit] resubmit lookup failed', { documentId, error: rowErr })
    return { ok: false, error: '문서를 불러오지 못했습니다.', status: 500 }
  }
  const doc = row as { doc_type: string; title: string; status: string; requester_id: number; summary: Record<string, unknown> } | null
  if (!doc) return { ok: false, error: '문서를 찾을 수 없습니다.', status: 404 }
  if (doc.requester_id !== input.requesterId) return { ok: false, error: '상신한 사람만 다시 올릴 수 있습니다.', status: 403 }
  if (doc.status !== '반려' && doc.status !== '회수') {
    return { ok: false, error: '반려·회수된 문서만 다시 올릴 수 있습니다.', status: 409 }
  }

  let replaced = false
  if (input.lines) {
    const { error: delErr } = await sb.from('approval_lines').delete().eq('document_id', documentId)
    if (delErr) {
      console.error('[approval/submit] resubmit line delete failed', { documentId, error: delErr })
      return { ok: false, error: '결재선을 바꾸지 못했습니다.', status: 500 }
    }
    const { error: insErr } = await sb.from('approval_lines').insert(toLineRows(documentId, input.lines))
    if (insErr) {
      console.error('[approval/submit] resubmit line insert failed', { documentId, error: insErr })
      return { ok: false, error: '결재선을 다시 넣지 못했습니다. 결재선을 다시 지정해주세요.', status: 500 }
    }
    replaced = true
  } else {
    const { error } = await sb
      .from('approval_lines')
      .update({ state: '대기', acted_by: null, acted_at: null, comment: null })
      .eq('document_id', documentId)
    if (error) {
      console.error('[approval/submit] resubmit line reset failed', { documentId, error })
      return { ok: false, error: '다시 올리지 못했습니다.', status: 500 }
    }
  }

  const now = new Date().toISOString()
  const { data: opened, error: docErr } = await sb
    .from('approval_documents')
    .update({
      status: '진행중', current_step: 1,
      summary: input.summary ?? doc.summary,
      ...(input.title ? { title: input.title } : null),
      submitted_at: now, completed_at: null, updated_at: now,
    })
    .eq('document_id', documentId)
    .in('status', ['반려', '회수'])
    .select('document_id')
  if (docErr) {
    console.error('[approval/submit] resubmit document update failed', { documentId, error: docErr })
    return { ok: false, error: '다시 올리지 못했습니다.', status: 500 }
  }
  if (!opened || opened.length === 0) return { ok: false, error: '이미 다시 올라간 문서입니다.', status: 409 }

  const { error: histErr } = await sb.from('approval_history').insert({
    document_id: documentId, action: '재상신', actor_id: input.requesterId, step: null, comment: null,
  })
  if (histErr) console.error('[approval/submit] resubmit history insert failed', { documentId, error: histErr })

  const { data: fresh, error: lineErr } = await sb.from('approval_lines').select('*').eq('document_id', documentId)
  if (lineErr) console.error('[approval/submit] resubmit line reload failed', { documentId, error: lineErr })
  const lines = ((fresh ?? []) as ApprovalLine[])
  const first = nextPendingLine(lines)
  if (first) await notifyFirst(sb, documentId, doc.doc_type, input.title ?? doc.title, first, input.today)

  return { ok: true, documentId, lines, notified: first ? first.approver_id : null, linesReplaced: replaced }
}
