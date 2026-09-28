// 전자결재 엔진 라우트 — 상신·승인·반려·회수·재상신과 결재함 조회.
//
// 화면은 3단계다. 이 라우트는 화면 없이도 혼자 돌아가야 하므로, 모든 판정을 여기서 끝낸다.
//
// 규칙
//   · 쓰기는 전부 service role. RLS 는 읽기 정책만 두기로 했다(설계서).
//   · 상태 전이는 조건부 UPDATE 로만 한다 — 두 사람이 동시에 승인하면 먼저 누른 쪽만 반영된다.
//     (.eq('state','대기') / .eq('status','진행중') 를 붙이고 select() 로 바뀐 행 수를 본다)
//   · doc_type 분기를 두지 않는다. 유형별 차이는 lib/approval/docTypes.ts 의 등록 정보로만 본다.
//   · 결재는 전원 공개다(설계서). 로그인한 재직자면 누구나 이 라우트를 쓸 수 있고,
//     무엇을 할 수 있는지는 그 문서의 결재선이 정한다.

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/permissions'
import { todayKST } from '@/lib/date'
import { docTypeOf, type DocTypeDef } from '@/lib/approval/docTypes'
import {
  actorFor, applyApproval, ccApproverIds, delegatesOf, isComplete,
  nextPendingLine, skippedLineIds, toLineRows, untouched, validateLineInput,
} from '@/lib/approval/engine'
import {
  APPROVAL_PATH,
  type ApprovalDocument, type ApprovalLine, type Delegation,
  type HistoryAction, type LineInput,
} from '@/lib/approval/types'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

type Caller = {
  engineer_id: number
  name: string | null
  permission_level: string | null
  teams: string | null
  resigned_date: string | null
}

/** 세션 → engineers. 퇴사자는 막는다. */
async function loadCaller(): Promise<{ caller: Caller; error: null } | { caller: null; error: NextResponse }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { caller: null, error: bad('Unauthorized', 401) }
  const { data: row, error } = await supabase
    .from('engineers')
    .select('engineer_id, name, permission_level, teams, resigned_date')
    .eq('email', user.email)
    .single()
  if (error) console.error('[approval] caller lookup failed', { email: user.email, error })
  if (!row || (row as Caller).resigned_date) return { caller: null, error: bad('Forbidden', 403) }
  return { caller: row as Caller, error: null }
}

type DocWithLines = ApprovalDocument & { approval_lines: ApprovalLine[] }

/** 문서 한 건과 그 결재선. */
async function loadDocument(documentId: number): Promise<DocWithLines | null> {
  const { data, error } = await supabaseAdmin
    .from('approval_documents')
    .select('*, approval_lines(*)')
    .eq('document_id', documentId)
    .single()
  if (error || !data) return null
  return data as DocWithLines
}

/** 그 사람들에게 걸려 있는, 오늘 유효한 위임. */
async function loadDelegations(ownerIds: number[], docType: string, today: string): Promise<Delegation[]> {
  if (ownerIds.length === 0) return []
  const { data, error } = await supabaseAdmin
    .from('approval_delegations')
    .select('owner_id, delegate_id, start_date, end_date, doc_type')
    .in('owner_id', ownerIds)
    .lte('start_date', today)
    .gte('end_date', today)
  if (error) {
    // 위임을 못 읽어도 본인 결재는 막지 않는다 — 대리 처리만 못 하게 된다.
    console.error('[approval] delegation lookup failed', { ownerIds, error })
    return []
  }
  return ((data ?? []) as Delegation[]).filter(d => d.doc_type === null || d.doc_type === docType)
}

/** 이력 한 줄. 실패해도 흐름을 막지 않고 기록만 남긴다(상태는 이미 바뀌었다). */
async function addHistory(documentId: number, action: HistoryAction, actorId: number, step: number | null, comment: string | null) {
  const { error } = await supabaseAdmin.from('approval_history').insert({
    document_id: documentId, action, actor_id: actorId, step, comment,
  })
  if (error) console.error('[approval] history insert failed', { documentId, action, error })
}

/**
 * 알림. 상태 전이는 이미 끝났으므로 실패해도 500 을 내지 않는다 —
 * 알림이 하나 빠진 것과 결재가 안 된 것은 사용자에게 전혀 다른 일이다.
 */
async function notify(rows: { engineer_id: number; title: string; message: string; type: string }[]) {
  if (rows.length === 0) return
  const { error } = await supabaseAdmin.from('notifications').insert(
    rows.map(r => ({ ...r, link: APPROVAL_PATH, is_read: false })),
  )
  if (error) console.error('[approval] notification insert failed', error)
}

/** 다음 차례 사람과 그 대리인들에게 「결재할 문서가 있습니다」. */
async function notifyTurn(doc: { document_id: number; doc_type: string; title: string }, line: ApprovalLine, today: string) {
  const delegations = await loadDelegations([line.approver_id], doc.doc_type, today)
  const targets = [line.approver_id, ...delegatesOf(line.approver_id, delegations, today, doc.doc_type)]
  await notify([...new Set(targets)].map(engineer_id => ({
    engineer_id,
    title: '결재할 문서가 있습니다',
    message: doc.title,
    type: 'approval_pending',
  })))
}

// ── POST ────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const { caller, error: authErr } = await loadCaller()
  if (authErr) return authErr

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const action = typeof body?.action === 'string' ? body.action : ''

  switch (action) {
    case 'submit': return submit(caller, body!)
    case 'approve': return approve(caller, body!)
    case 'reject': return reject(caller, body!)
    case 'withdraw': return withdraw(caller, body!)
    case 'resubmit': return resubmit(caller, body!)
    default: return bad('action 이 올바르지 않습니다.')
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const docIdOf = (v: unknown) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** 결재선 입력을 받아 검증까지. 문제가 있으면 응답을 돌려준다. */
async function readLines(raw: unknown, requesterId: number): Promise<{ lines: LineInput[]; error: null } | { lines: null; error: NextResponse }> {
  if (!Array.isArray(raw)) return { lines: null, error: bad('결재선을 지정해주세요.') }
  const lines = raw.map(r => ({
    step: Number((r as LineInput)?.step),
    kind: (r as LineInput)?.kind,
    approverId: Number((r as LineInput)?.approverId),
    isDelegatedAuthority: (r as LineInput)?.isDelegatedAuthority === true,
  })) as LineInput[]

  const ids = [...new Set(lines.map(l => l.approverId).filter(n => Number.isInteger(n) && n > 0))]
  const { data: engs, error } = await supabaseAdmin
    .from('engineers')
    .select('engineer_id, resigned_date')
    .in('engineer_id', ids.length > 0 ? ids : [0])
  if (error) {
    console.error('[approval] approver lookup failed', error)
    return { lines: null, error: bad('결재자를 확인하지 못했습니다.', 500) }
  }
  const active = new Set(
    ((engs ?? []) as { engineer_id: number; resigned_date: string | null }[])
      .filter(e => !e.resigned_date)
      .map(e => e.engineer_id),
  )
  const msg = validateLineInput(lines, requesterId, active)
  if (msg) return { lines: null, error: bad(msg) }
  return { lines, error: null }
}

// ── 상신 ────────────────────────────────────────────────────────────────────
async function submit(caller: Caller, body: Record<string, unknown>) {
  const def = docTypeOf(body.docType)
  if (!def) return bad('등록되지 않은 문서 유형입니다.')

  const docNo = str(body.docNo)
  const title = str(body.title)
  const targetTable = str(body.targetTable)
  if (!docNo) return bad('문서번호가 필요합니다.')
  if (!title) return bad('제목이 필요합니다.')
  if (!targetTable) return bad('원 문서 위치(targetTable)가 필요합니다.')
  const summary = (body.summary ?? {}) as Record<string, unknown>
  if (typeof summary !== 'object' || Array.isArray(summary)) return bad('summary 는 객체여야 합니다.')
  const targetId = body.targetId == null ? null : docIdOf(body.targetId)
  if (body.targetId != null && targetId === null) return bad('targetId 가 올바르지 않습니다.')

  const { lines, error: lineErr } = await readLines(body.lines, caller.engineer_id)
  if (lineErr) return lineErr

  const now = new Date().toISOString()
  const { data: created, error: docErr } = await supabaseAdmin
    .from('approval_documents')
    .insert({
      doc_type: def.key, doc_no: docNo, title, summary,
      target_table: targetTable, target_id: targetId,
      status: '진행중', requester_id: caller.engineer_id,
      current_step: 1, submitted_at: now,
    })
    .select('document_id')
    .single()
  if (docErr || !created) {
    console.error('[approval] document insert failed', docErr)
    return bad('상신하지 못했습니다.', 500)
  }
  const documentId = (created as { document_id: number }).document_id

  // 되돌리기 — 문서를 지우면 approval_lines 는 FK CASCADE 로 함께 사라진다.
  // 이력은 아직 없지만(이력 insert 전에 실패한 경우뿐), 남아 있어도 지워지도록 먼저 치운다.
  const rollback = async (why: string, detail: unknown) => {
    console.error('[approval] submit rollback', { documentId, why, detail })
    await supabaseAdmin.from('approval_history').delete().eq('document_id', documentId)
    const { error } = await supabaseAdmin.from('approval_documents').delete().eq('document_id', documentId)
    if (error) {
      console.error('[approval] rollback failed — 문서가 남았다', { documentId, error })
      return bad('상신에 실패했고 되돌리지도 못했습니다. 결재함에서 상태를 확인해주세요.', 500)
    }
    return bad('상신하지 못했습니다.', 500)
  }

  const { error: linesErr } = await supabaseAdmin.from('approval_lines').insert(toLineRows(documentId, lines))
  if (linesErr) return rollback('lines', linesErr)

  const { error: histErr } = await supabaseAdmin.from('approval_history').insert({
    document_id: documentId, action: '상신' as HistoryAction, actor_id: caller.engineer_id, step: null, comment: null,
  })
  if (histErr) return rollback('history', histErr)

  // 첫 차례에게 알린다.
  const doc = await loadDocument(documentId)
  const first = doc ? nextPendingLine(doc.approval_lines) : null
  if (doc && first) await notifyTurn(doc, first, todayKST())

  return NextResponse.json({
    ok: true,
    documentId,
    status: '진행중',
    currentStep: 1,
    notified: first ? first.approver_id : null,
    lines: doc?.approval_lines ?? [],
  })
}

// ── 승인 ────────────────────────────────────────────────────────────────────
async function approve(caller: Caller, body: Record<string, unknown>) {
  const documentId = docIdOf(body.documentId)
  if (!documentId) return bad('문서를 지정해주세요.')
  const comment = str(body.comment) || null

  const doc = await loadDocument(documentId)
  if (!doc) return bad('문서를 찾을 수 없습니다.', 404)
  const def = docTypeOf(doc.doc_type)
  if (!def) return bad('등록되지 않은 문서 유형입니다.')
  if (doc.status !== '진행중') return bad(`이미 ${doc.status} 상태인 문서입니다.`, 409)

  const line = nextPendingLine(doc.approval_lines)
  if (!line) return bad('처리할 차례가 남아 있지 않습니다.', 409)

  const today = todayKST()
  const delegations = await loadDelegations([line.approver_id], doc.doc_type, today)
  const act = actorFor(line, caller.engineer_id, delegations, today, doc.doc_type)
  if (!act.ok) return bad('지금은 결재할 차례가 아닙니다.', 403)

  const state = line.is_delegated_authority ? '전결' : (act.asDelegate ? '대결' : '승인')

  // 조건부 UPDATE — 아직 '대기' 일 때만. 동시에 누르면 뒤에 누른 쪽은 여기서 0행이 된다.
  const { data: touched, error: lineErr } = await supabaseAdmin
    .from('approval_lines')
    .update({ state, acted_by: caller.engineer_id, acted_at: new Date().toISOString(), comment })
    .eq('line_id', line.line_id)
    .eq('state', '대기')
    .select('line_id')
  if (lineErr) {
    console.error('[approval] approve line update failed', { documentId, lineId: line.line_id, error: lineErr })
    return bad('결재하지 못했습니다.', 500)
  }
  if (!touched || touched.length === 0) return bad('이미 처리된 결재입니다.', 409)

  // 전결이면 뒤의 결재·합의를 생략으로 남긴다(앞 순번은 손대지 않는다).
  let skipped: number[] = []
  if (line.is_delegated_authority) {
    skipped = skippedLineIds(doc.approval_lines, line.step ?? 0)
    if (skipped.length > 0) {
      const { error } = await supabaseAdmin
        .from('approval_lines')
        .update({ state: '생략' })
        .in('line_id', skipped)
        .eq('state', '대기')
      if (error) console.error('[approval] skip update failed', { documentId, skipped, error })
    }
  }

  const after = applyApproval(doc.approval_lines, line.line_id, state, skipped)
  const done = isComplete(after)
  const historyAction: HistoryAction = line.is_delegated_authority ? '전결' : (act.asDelegate ? '대결' : '승인')
  await addHistory(documentId, historyAction, caller.engineer_id, line.step ?? null, comment)

  if (done) {
    const { data: closed, error } = await supabaseAdmin
      .from('approval_documents')
      .update({ status: '완료', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('document_id', documentId)
      .eq('status', '진행중')
      .select('document_id')
    if (error) console.error('[approval] complete update failed', { documentId, error })
    if (closed && closed.length > 0) {
      // 유형별 실행. 2단계에서는 빈 함수다. 실패해도 결재 자체는 이미 끝났으므로 기록만 남긴다.
      try {
        await def.onComplete({
          documentId, docNo: doc.doc_no, targetTable: doc.target_table, targetId: doc.target_id,
          summary: doc.summary ?? {}, requesterId: doc.requester_id, actorId: caller.engineer_id,
        })
      } catch (e) {
        console.error('[approval] onComplete failed', { documentId, docType: doc.doc_type, error: e })
      }
      await notify([doc.requester_id, ...ccApproverIds(after)].map(engineer_id => ({
        engineer_id,
        title: '결재가 완료되었습니다',
        message: doc.title,
        type: 'approval_completed',
      })))
    }
    return NextResponse.json({ ok: true, documentId, lineState: state, status: '완료', completed: true, skipped })
  }

  const next = nextPendingLine(after)!
  const { error: stepErr } = await supabaseAdmin
    .from('approval_documents')
    .update({ current_step: next.step ?? 1, updated_at: new Date().toISOString() })
    .eq('document_id', documentId)
    .eq('status', '진행중')
  if (stepErr) console.error('[approval] current_step update failed', { documentId, error: stepErr })
  await notifyTurn(doc, next, today)

  return NextResponse.json({
    ok: true, documentId, lineState: state, status: '진행중', completed: false,
    currentStep: next.step, nextApprover: next.approver_id, skipped,
  })
}

// ── 반려 ────────────────────────────────────────────────────────────────────
async function reject(caller: Caller, body: Record<string, unknown>) {
  const documentId = docIdOf(body.documentId)
  if (!documentId) return bad('문서를 지정해주세요.')
  const comment = str(body.comment)
  if (!comment) return bad('반려 사유를 입력해주세요.')

  const doc = await loadDocument(documentId)
  if (!doc) return bad('문서를 찾을 수 없습니다.', 404)
  const def: DocTypeDef | null = docTypeOf(doc.doc_type)
  if (!def) return bad('등록되지 않은 문서 유형입니다.')
  if (!def.canReject) return bad(`${def.label}은(는) 반려할 수 없는 문서입니다.`)
  if (doc.status !== '진행중') return bad(`이미 ${doc.status} 상태인 문서입니다.`, 409)

  const line = nextPendingLine(doc.approval_lines)
  if (!line) return bad('처리할 차례가 남아 있지 않습니다.', 409)

  const today = todayKST()
  const delegations = await loadDelegations([line.approver_id], doc.doc_type, today)
  const act = actorFor(line, caller.engineer_id, delegations, today, doc.doc_type)
  if (!act.ok) return bad('지금은 결재할 차례가 아닙니다.', 403)

  const { data: touched, error: lineErr } = await supabaseAdmin
    .from('approval_lines')
    .update({ state: '반려', acted_by: caller.engineer_id, acted_at: new Date().toISOString(), comment })
    .eq('line_id', line.line_id)
    .eq('state', '대기')
    .select('line_id')
  if (lineErr) {
    console.error('[approval] reject line update failed', { documentId, error: lineErr })
    return bad('반려하지 못했습니다.', 500)
  }
  if (!touched || touched.length === 0) return bad('이미 처리된 결재입니다.', 409)

  // 뒤의 줄은 '대기' 그대로 둔다 — 재상신하면 처음부터 다시 돌기 때문이다.
  const { data: closed, error: docErr } = await supabaseAdmin
    .from('approval_documents')
    .update({ status: '반려', updated_at: new Date().toISOString() })
    .eq('document_id', documentId)
    .eq('status', '진행중')
    .select('document_id')
  if (docErr) console.error('[approval] reject document update failed', { documentId, error: docErr })

  await addHistory(documentId, '반려', caller.engineer_id, line.step ?? null, comment)
  if (closed && closed.length > 0) {
    await notify([{
      engineer_id: doc.requester_id,
      title: '결재가 반려되었습니다',
      message: `${doc.title} — ${comment}`,
      type: 'approval_rejected',
    }])
  }
  return NextResponse.json({ ok: true, documentId, status: '반려', rejectedLine: line.line_id })
}

// ── 회수 ────────────────────────────────────────────────────────────────────
async function withdraw(caller: Caller, body: Record<string, unknown>) {
  const documentId = docIdOf(body.documentId)
  if (!documentId) return bad('문서를 지정해주세요.')

  const doc = await loadDocument(documentId)
  if (!doc) return bad('문서를 찾을 수 없습니다.', 404)
  if (doc.requester_id !== caller.engineer_id) return bad('상신한 사람만 회수할 수 있습니다.', 403)
  if (doc.status !== '진행중') return bad(`이미 ${doc.status} 상태인 문서입니다.`, 409)
  if (!untouched(doc.approval_lines)) return bad('이미 결재가 시작되어 회수할 수 없습니다.', 409)

  const { data: closed, error } = await supabaseAdmin
    .from('approval_documents')
    .update({ status: '회수', updated_at: new Date().toISOString() })
    .eq('document_id', documentId)
    .eq('status', '진행중')
    .select('document_id')
  if (error) {
    console.error('[approval] withdraw failed', { documentId, error })
    return bad('회수하지 못했습니다.', 500)
  }
  // 조건부 UPDATE 가 0행이면 그 사이에 누가 결재했다는 뜻이다.
  if (!closed || closed.length === 0) return bad('이미 처리되어 회수할 수 없습니다.', 409)

  await addHistory(documentId, '회수', caller.engineer_id, null, null)
  return NextResponse.json({ ok: true, documentId, status: '회수' })
}

// ── 재상신 ──────────────────────────────────────────────────────────────────
async function resubmit(caller: Caller, body: Record<string, unknown>) {
  const documentId = docIdOf(body.documentId)
  if (!documentId) return bad('문서를 지정해주세요.')

  const doc = await loadDocument(documentId)
  if (!doc) return bad('문서를 찾을 수 없습니다.', 404)
  if (doc.requester_id !== caller.engineer_id) return bad('상신한 사람만 다시 올릴 수 있습니다.', 403)
  if (doc.status !== '반려' && doc.status !== '회수') return bad('반려·회수된 문서만 다시 올릴 수 있습니다.', 409)

  // 결재선을 새로 주면 통째로 갈아끼우고, 주지 않으면 있던 결재선을 처음 상태로 되돌린다.
  let replaced = false
  if (body.lines !== undefined) {
    const { lines, error: lineErr } = await readLines(body.lines, caller.engineer_id)
    if (lineErr) return lineErr
    const { error: delErr } = await supabaseAdmin.from('approval_lines').delete().eq('document_id', documentId)
    if (delErr) {
      console.error('[approval] resubmit line delete failed', { documentId, error: delErr })
      return bad('결재선을 바꾸지 못했습니다.', 500)
    }
    const { error: insErr } = await supabaseAdmin.from('approval_lines').insert(toLineRows(documentId, lines))
    if (insErr) {
      // 옛 결재선은 이미 지워졌다 — 되돌릴 값이 남아 있지 않으므로 문서를 그대로 두고 알린다.
      console.error('[approval] resubmit line insert failed', { documentId, error: insErr })
      return bad('결재선을 다시 넣지 못했습니다. 결재선을 다시 지정해주세요.', 500)
    }
    replaced = true
  } else {
    const { error } = await supabaseAdmin
      .from('approval_lines')
      .update({ state: '대기', acted_by: null, acted_at: null, comment: null })
      .eq('document_id', documentId)
    if (error) {
      console.error('[approval] resubmit line reset failed', { documentId, error })
      return bad('다시 올리지 못했습니다.', 500)
    }
  }

  const summary = body.summary === undefined ? doc.summary : (body.summary as Record<string, unknown>)
  const { data: opened, error: docErr } = await supabaseAdmin
    .from('approval_documents')
    .update({
      status: '진행중', current_step: 1, summary,
      submitted_at: new Date().toISOString(), completed_at: null, updated_at: new Date().toISOString(),
    })
    .eq('document_id', documentId)
    .in('status', ['반려', '회수'])
    .select('document_id')
  if (docErr) {
    console.error('[approval] resubmit document update failed', { documentId, error: docErr })
    return bad('다시 올리지 못했습니다.', 500)
  }
  if (!opened || opened.length === 0) return bad('이미 다시 올라간 문서입니다.', 409)

  await addHistory(documentId, '재상신', caller.engineer_id, null, null)

  const fresh = await loadDocument(documentId)
  const first = fresh ? nextPendingLine(fresh.approval_lines) : null
  if (fresh && first) await notifyTurn(fresh, first, todayKST())

  return NextResponse.json({
    ok: true, documentId, status: '진행중', currentStep: 1,
    linesReplaced: replaced, notified: first ? first.approver_id : null,
  })
}

// ── GET — 결재함 ────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const { caller, error: authErr } = await loadCaller()
  if (authErr) return authErr

  const box = new URL(req.url).searchParams.get('box') ?? 'inbox'
  if (!['inbox', 'outbox', 'cc', 'all'].includes(box)) return bad('box 가 올바르지 않습니다.')
  if (box === 'all' && !isSuperAdmin(caller)) return bad('Forbidden', 403)

  const today = todayKST()
  const select = '*, approval_lines(*)'

  if (box === 'outbox') {
    const { data, error } = await supabaseAdmin
      .from('approval_documents').select(select)
      .eq('requester_id', caller.engineer_id)
      .order('created_at', { ascending: false })
    if (error) return listFailed(error)
    return NextResponse.json({ box, documents: withProgress(data as DocWithLines[]) })
  }

  if (box === 'cc') {
    const { data: ccLines, error: ccErr } = await supabaseAdmin
      .from('approval_lines').select('document_id')
      .eq('kind', 'cc').eq('approver_id', caller.engineer_id)
    if (ccErr) return listFailed(ccErr)
    const ids = [...new Set(((ccLines ?? []) as { document_id: number }[]).map(l => l.document_id))]
    if (ids.length === 0) return NextResponse.json({ box, documents: [] })
    const { data, error } = await supabaseAdmin
      .from('approval_documents').select(select)
      .in('document_id', ids)
      .neq('status', '임시저장')
      .order('created_at', { ascending: false })
    if (error) return listFailed(error)
    return NextResponse.json({ box, documents: withProgress(data as DocWithLines[]) })
  }

  if (box === 'all') {
    const { data, error } = await supabaseAdmin
      .from('approval_documents').select(select)
      .neq('status', '임시저장')
      .order('created_at', { ascending: false })
    if (error) return listFailed(error)
    return NextResponse.json({ box, documents: withProgress(data as DocWithLines[]) })
  }

  // inbox — 진행중 문서 가운데 지금 차례가 나(또는 내가 위임받은 사람)인 것.
  const { data, error } = await supabaseAdmin
    .from('approval_documents').select(select)
    .eq('status', '진행중')
    .order('submitted_at', { ascending: true })
  if (error) return listFailed(error)

  const docs = (data ?? []) as DocWithLines[]
  const ownerIds = [...new Set(docs.map(d => nextPendingLine(d.approval_lines)?.approver_id).filter((n): n is number => !!n))]
  const delegations = await loadDelegations(ownerIds, '', today)   // 유형은 문서마다 따로 본다

  const mine = docs.filter(d => {
    const line = nextPendingLine(d.approval_lines)
    if (!line) return false
    const forDoc = delegations.filter(x => x.doc_type === null || x.doc_type === d.doc_type)
    return actorFor(line, caller.engineer_id, forDoc, today, d.doc_type).ok
  })

  return NextResponse.json({
    box,
    documents: withProgress(mine).map(d => ({
      ...d,
      delegated: nextPendingLine(d.approval_lines)?.approver_id !== caller.engineer_id,
    })),
  })
}

function listFailed(error: unknown) {
  console.error('[approval] list failed', error)
  return bad('결재함을 불러오지 못했습니다.', 500)
}

/** 각 문서에 결재선 진행 상태를 함께 담는다. */
function withProgress(docs: DocWithLines[]) {
  return (docs ?? []).map(d => {
    const lines = [...(d.approval_lines ?? [])].sort(
      (a, b) => (a.step ?? 99) - (b.step ?? 99) || a.line_id - b.line_id,
    )
    const next = nextPendingLine(lines)
    const ordered = lines.filter(l => l.kind !== 'cc')
    return {
      ...d,
      approval_lines: lines,
      progress: {
        total: ordered.length,
        done: ordered.filter(l => l.state !== '대기').length,
        currentStep: next?.step ?? null,
        currentApproverId: next?.approver_id ?? null,
      },
    }
  })
}
