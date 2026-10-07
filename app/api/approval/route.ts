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
//   · 그래서 **상신만은 이 라우트로 하지 않는다.** action 'submit' 은 막혀 있다
//     (GENERIC_SUBMIT_DISABLED — 이유는 그 상수 설명에 있다). 상신은 업무별 라우트가
//     원 문서를 검증한 뒤 lib/approval/submit.ts 를 직접 부른다.

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { canViewMenu } from '@/lib/permissions'
import { todayKST } from '@/lib/date'
import { canRejectDocument, canResubmitDocument, docTypeOf, type DocTypeDef } from '@/lib/approval/docTypes'
import { handlersOf } from '@/lib/approval/handlers'
import {
  actorFor, applyApproval, ccApproverIds, delegatesOf, isComplete,
  nextPendingLine, skippedLineIds, toLineRows, untouched,
} from '@/lib/approval/engine'
import {
  APPROVAL_PATH, DISCARDABLE_STATUSES, approvalDocPath,
  type ApprovalDocument, type ApprovalLine, type Delegation,
  type HistoryAction, type LineInput,
} from '@/lib/approval/types'
import { checkLines, createApprovalDocument } from '@/lib/approval/submit'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * 범용 상신(action === 'submit')을 막아 둔 스위치. false 로 바꾸면 아래 submit() 이 예전처럼 동작한다.
 * 방식은 /api/lead-delete 와 같다 — 코드를 지우지 않고 입구에서만 막는다.
 *
 * 왜 막는가 — 이 액션은 docType·docNo·targetTable·targetId·summary 를 본문에서 그대로 받고,
 * **그 원 문서가 부르는 사람의 것인지 보지 않는다.** 결재는 전원 공개라 로그인한 재직자면 누구나
 * 부를 수 있으므로, quote_delete 를 이 길로 올리면 남의 견적을 지우는 결재 문서가 만들어진다
 * (onCompleteQuoteDelete 가 target_id 를 그대로 지운다). 전용 라우트는 그 검증을 한다 —
 * app/api/quote-delete 는 견적이 '취소요청' 인지·사유가 있는지·같은 견적으로 도는 문서가 없는지 보고,
 * app/api/showroom/requests 는 쇼룸 메뉴 권한과 신청 내용을 본다.
 *
 * 화면·스크립트에서 이 액션을 부르는 곳은 없다(조사 결과 0건). 문서 종류별 상신 경로는
 * lib/approval/submit.ts 의 createApprovalDocument 를 직접 부르므로 이 스위치와 무관하다.
 */
const GENERIC_SUBMIT_DISABLED = true

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
async function notify(rows: { engineer_id: number; title: string; message: string; type: string; link?: string }[]) {
  if (rows.length === 0) return
  const { error } = await supabaseAdmin.from('notifications').insert(
    // link 를 주지 않은 줄은 종전처럼 결재함으로 간다(문서와 무관한 알림이 그렇다).
    rows.map(r => ({ ...r, link: r.link ?? APPROVAL_PATH, is_read: false })),
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
    // 누르면 그 문서를 바로 연다(예전에는 결재함 목록으로만 보냈다).
    link: approvalDocPath(doc.document_id),
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
    case 'discard': return discard(caller, body!)
    default: return bad('action 이 올바르지 않습니다.')
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const docIdOf = (v: unknown) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * 결재선 입력을 모양만 읽은 뒤 검증은 lib/approval/submit.ts 의 checkLines 에 넘긴다.
 * 쇼룸·견적 삭제와 **같은 함수**를 쓴다 — 종류별 결재선 규칙이 경로마다 갈리지 않게 하기 위해서다
 * (예전에는 이 안에서 engineers 를 따로 읽고 validateLineInput 만 불렀다).
 */
async function readLines(raw: unknown, requesterId: number, docType: string): Promise<{ lines: LineInput[]; error: null } | { lines: null; error: NextResponse }> {
  if (!Array.isArray(raw)) return { lines: null, error: bad('결재선을 지정해주세요.') }
  const lines = raw.map(r => ({
    step: Number((r as LineInput)?.step),
    kind: (r as LineInput)?.kind,
    approverId: Number((r as LineInput)?.approverId),
    isDelegatedAuthority: (r as LineInput)?.isDelegatedAuthority === true,
  })) as LineInput[]

  const msg = await checkLines(supabaseAdmin, lines, requesterId, docType)
  if (msg) return { lines: null, error: bad(msg) }
  return { lines, error: null }
}

// ── 상신 ────────────────────────────────────────────────────────────────────
async function submit(caller: Caller, body: Record<string, unknown>) {
  // 권한·내용을 보기 전에 막는다 — 누가 부르든 답이 같아야 한다.
  // 410 Gone: 있던 경로를 의도적으로 걷어냈다는 뜻이다(404 는 「원래 없다」로 읽힌다).
  if (GENERIC_SUBMIT_DISABLED) {
    return bad('범용 상신은 지원하지 않습니다. 각 업무 화면의 상신 기능을 사용해 주세요.', 410)
  }

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

  const { lines, error: lineErr } = await readLines(body.lines, caller.engineer_id, def.key)
  if (lineErr) return lineErr

  // 실제 상신은 lib/approval/submit.ts 가 한다 — 쇼룸 사용 신청처럼 다른 서버 코드가
  // 같은 절차(문서·결재선·이력·첫 차례 알림, 실패 시 되돌리기)를 그대로 쓰기 때문이다.
  const made = await createApprovalDocument(supabaseAdmin, {
    docType: def.key, docNo, title, summary, targetTable, targetId,
    lines, requesterId: caller.engineer_id, today: todayKST(),
  })
  if (!made.ok) return bad(made.error, made.status)

  return NextResponse.json({
    ok: true,
    documentId: made.documentId,
    status: '진행중',
    currentStep: 1,
    notified: made.notified,
    lines: made.lines,
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
  // 전결이면 뒤의 결재·합의가 생략된다 — 이 승인으로 문서가 끝나는지 먼저 계산한다.
  const skipped: number[] = line.is_delegated_authority ? skippedLineIds(doc.approval_lines, line.step ?? 0) : []
  const after = applyApproval(doc.approval_lines, line.line_id, state, skipped)
  const done = isComplete(after)

  // 이 승인으로 끝난다면 유형별 점검을 먼저 받는다 — 막히면 줄도 건드리지 않고 409 로 돌려보낸다
  // (쇼룸 사전 신청의 사용 시간 겹침처럼, 결재가 도는 동안 바깥 사정이 바뀌는 경우).
  const hooks = handlersOf(doc.doc_type)
  if (done && hooks.beforeComplete) {
    const problem = await hooks.beforeComplete({
      documentId, docNo: doc.doc_no, targetTable: doc.target_table, targetId: doc.target_id,
      summary: doc.summary ?? {}, requesterId: doc.requester_id, actorId: caller.engineer_id, lines: after,
    })
    if (problem) return bad(problem, 409)
  }

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
  if (skipped.length > 0) {
    const { error } = await supabaseAdmin
      .from('approval_lines')
      .update({ state: '생략' })
      .in('line_id', skipped)
      .eq('state', '대기')
    if (error) console.error('[approval] skip update failed', { documentId, skipped, error })
  }

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
      // 유형별 실행. 실패해도 결재 자체는 이미 끝났으므로 되돌리지 않고 기록만 남긴다.
      try {
        await hooks.onComplete?.({
          documentId, docNo: doc.doc_no, targetTable: doc.target_table, targetId: doc.target_id,
          summary: doc.summary ?? {}, requesterId: doc.requester_id, actorId: caller.engineer_id, lines: after,
        })
      } catch (e) {
        console.error('[approval] onComplete failed', { documentId, docType: doc.doc_type, error: e })
      }
      await notify([doc.requester_id, ...ccApproverIds(after)].map(engineer_id => ({
        engineer_id,
        title: '결재가 완료되었습니다',
        message: doc.title,
        type: 'approval_completed',
        link: approvalDocPath(documentId),
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

/**
 * 결재가 완료되지 않고 끝났을 때 유형별 되돌리기를 부른다 — 반려·회수·폐기가 모두 여기를 거친다.
 *
 * 유형 분기는 두지 않는다. 훅이 없는 유형이면 아무 일도 일어나지 않는다.
 * 실패해도 결재 상태 변경은 이미 끝났으므로 되돌리지 않고 기록만 남긴다(onComplete 와 같은 규칙).
 */
async function runRevert(doc: DocWithLines, actorId: number) {
  const hooks = handlersOf(doc.doc_type)
  if (!hooks.onRevert) return
  try {
    await hooks.onRevert({
      documentId: doc.document_id, docNo: doc.doc_no, targetTable: doc.target_table, targetId: doc.target_id,
      summary: doc.summary ?? {}, requesterId: doc.requester_id, actorId, lines: doc.approval_lines,
    })
  } catch (e) {
    console.error('[approval] onRevert failed', { documentId: doc.document_id, docType: doc.doc_type, error: e })
  }
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
  // 유형 전체(canReject)와 문서 하나(canRejectDoc)를 함께 본다 — 쇼룸 사후 신청처럼
  // 같은 유형 안에서 문서마다 갈리는 경우가 있다(이미 끝난 사용은 「확인」만 하므로 반려가 없다).
  if (!canRejectDocument(def, doc.summary)) {
    return bad(`${def.label}은(는) 반려할 수 없는 문서입니다.`)
  }
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
    // 원 문서를 결재 전 상태로 되돌린다(견적 삭제 요청이면 '취소요청' 에서 풀어 준다).
    await runRevert(doc, caller.engineer_id)
    await notify([{
      engineer_id: doc.requester_id,
      title: '결재가 반려되었습니다',
      message: `${doc.title} — ${comment}`,
      type: 'approval_rejected',
      link: approvalDocPath(documentId),
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
  await runRevert(doc, caller.engineer_id)
  return NextResponse.json({ ok: true, documentId, status: '회수' })
}

// ── 폐기 ────────────────────────────────────────────────────────────────────
// 반려·회수된 문서를 상신자가 치운다. 다시 올리지 않기로 한 건이 상신함 미결문서에 쌓이는 것을 막는다.
//
// 지우지 않고 상태로 두는 이유 — 반려한 사람의 판단이 기결함에서 사라지면 안 된다.
// 결재선(approval_lines)도 그대로 둔다. 기결함은 「내가 처리한 줄」로 문서를 찾으므로,
// 줄을 지우면 남의 기결함에서 문서가 통째로 사라진다.
//
// 승인 절차를 두지 않는다 — 효력이 없는 문서라 상신자 본인이 자율로 정리한다.
async function discard(caller: Caller, body: Record<string, unknown>) {
  const documentId = docIdOf(body.documentId)
  if (!documentId) return bad('문서를 지정해주세요.')

  const doc = await loadDocument(documentId)
  if (!doc) return bad('문서를 찾을 수 없습니다.', 404)
  if (doc.requester_id !== caller.engineer_id) return bad('상신한 사람만 폐기할 수 있습니다.', 403)
  if (!(DISCARDABLE_STATUSES as string[]).includes(doc.status)) {
    return bad('반려·회수된 문서만 폐기할 수 있습니다.', 409)
  }

  // 조건부 UPDATE — 그 사이에 재상신되었다면(진행중) 0행이 되어 아무 일도 일어나지 않는다.
  const { data: dropped, error } = await supabaseAdmin
    .from('approval_documents')
    .update({ status: '폐기', updated_at: new Date().toISOString() })
    .eq('document_id', documentId)
    .in('status', DISCARDABLE_STATUSES)
    .select('document_id')
  if (error) {
    console.error('[approval] discard failed', { documentId, error })
    return bad('폐기하지 못했습니다.', 500)
  }
  if (!dropped || dropped.length === 0) return bad('이미 처리되어 폐기할 수 없습니다.', 409)

  await addHistory(documentId, '폐기', caller.engineer_id, null, null)
  // 반려·회수 때 이미 한 번 불렸지만 다시 부른다 — 훅은 여러 번 불려도 안전하게 짠다.
  // 되돌리기가 그때 실패했더라도 여기서 만회된다.
  await runRevert(doc, caller.engineer_id)
  console.log('[approval] 폐기', { documentId, by: caller.engineer_id })
  return NextResponse.json({ ok: true, documentId, status: '폐기' })
}

// ── 재상신 ──────────────────────────────────────────────────────────────────
async function resubmit(caller: Caller, body: Record<string, unknown>) {
  const documentId = docIdOf(body.documentId)
  if (!documentId) return bad('문서를 지정해주세요.')

  const doc = await loadDocument(documentId)
  if (!doc) return bad('문서를 찾을 수 없습니다.', 404)
  if (doc.requester_id !== caller.engineer_id) return bad('상신한 사람만 다시 올릴 수 있습니다.', 403)
  // 유형이 재상신을 허용하는지 — 분기를 두지 않고 등록표의 칸으로만 본다(docTypes.ts).
  // 견적서는 내용을 고쳐야 다시 올릴 수 있어 같은 문서를 되돌리는 길을 막아 둔다.
  const resubDef = docTypeOf(doc.doc_type)
  if (resubDef && !canResubmitDocument(resubDef)) {
    return bad('견적서는 재상신할 수 없습니다. 고쳐 쓰기로 새로 작성해 주세요.')
  }
  // 폐기한 문서도 여기서 걸린다 — 치운 문서를 되살리려면 새로 상신한다.
  if (doc.status !== '반려' && doc.status !== '회수') return bad('반려·회수된 문서만 다시 올릴 수 있습니다.', 409)

  // 결재선을 새로 주면 통째로 갈아끼우고, 주지 않으면 있던 결재선을 처음 상태로 되돌린다.
  //
  // 종류별 결재선 규칙(lib/approval/lineRules.ts)은 **갈아끼우는 쪽에만** 걸린다. 결재선을 그대로
  // 다시 돌리는 쪽은 이미 상신된 문서의 결재선이라, 규칙이 뒤에 생겼다는 이유로 재상신을 막으면
  // 반려된 문서가 상신함에 갇힌다(「이미 진행 중이거나 완료된 문서에는 적용하지 않는다」).
  let replaced = false
  if (body.lines !== undefined) {
    const { lines, error: lineErr } = await readLines(body.lines, caller.engineer_id, doc.doc_type)
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
  // 결재 화면 자체는 전원 공개다(4단계). 남의 문서까지 보는 「전체」만 approvals 권한으로 잠근다.
  if (box === 'all' && !canViewMenu(caller, 'approvals')) return bad('Forbidden', 403)

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
