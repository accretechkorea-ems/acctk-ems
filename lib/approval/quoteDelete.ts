// 견적 삭제의 실행 로직. 두 갈래가 이 파일 하나를 함께 쓴다.
//
//   · 본인 삭제 — 아직 실적에 잡히지 않은 견적('견적중'·'실패')을 결재 없이 바로 지운다.
//                 app/api/quote-delete 의 action='self' 가 executeQuoteDelete 를 직접 부른다.
//   · 결재 삭제 — 수주 이후 상태는 결재를 거친다. lib/approval/handlers.ts 가 onCompleteQuoteDelete 를
//                 묶어 결재 라우트에 넘기고, 완료 시점에 같은 executeQuoteDelete 가 실행된다.
//
// 지우는 절차는 한 벌뿐이다(executeQuoteDelete). 갈리는 것은 「어느 상태에서 허용하는가」와
// 「감사 기록에 어떤 action 을 남기는가」 둘뿐이고, 둘 다 인자로 받는다.
//
// 서버 전용이다 — service role 로 쓴다. 화면에서 import 하지 마라
// (docTypes.ts 머리말에 이유가 적혀 있다: 화면이 읽는 등록표에 서버 전용 코드를 두면 번들이 깨진다).
//
// 실행 로직은 옛 통합 요청함의 견적 삭제 처리에서 그대로 옮겨 왔다(그 화면·라우트는 8단계에서 지웠다).
//   · 삭제 — quotes 행을 지우고(자식은 CASCADE 로 함께 사라진다) 그 뒤에 스토리지 PDF.
//     자세한 근거는 executeQuoteDelete 주석에 적었다.
//   · 복원 — 이전 상태는 quotes 어디에도 남지 않아 audit_log 의 '취소요청으로 전환된 마지막 UPDATE'
//     기록에서 old_data.status 를 꺼내 쓴다.
//
// 되돌리기(onRevert)는 반려·회수·폐기 세 경우에 모두 불린다. 결재가 어떻게 끝났든 견적이
// '취소요청' 에 갇히면 안 되기 때문이다. 그래서 조건부 UPDATE 로 짜서 여러 번 불려도 안전하다.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { OnCompleteContext } from './docTypes'

const TAG = 'approval/quoteDelete'

export const QUOTE_DELETE_TYPE = 'quote_delete'
export const QUOTE_DELETE_TARGET_TABLE = 'quotes'

/** 삭제를 기다리는 동안의 견적 상태. 목록에서 구분되어야 해서 그대로 둔다. */
export const DELETE_REQUEST_STATUS = '취소요청'

// 결재 없이 지울 수 있는 기준은 lib/quoteDeletePolicy.ts 하나다(화면도 같은 것을 읽는다).
// 여기서는 다시 내보내기만 한다 — 부르는 쪽이 어느 파일을 읽을지 고민하지 않게.
export {
  SELF_DELETABLE_STATUSES, CLOSED_DELETABLE_STATUSES, isSelfDeletable,
  docHistoryOf, requestDeleteVerdict, selfDeleteVerdict,
} from '@/lib/quoteDeletePolicy'

/** 감사 기록이 없을 때 되돌릴 기본 상태. 트리거는 fail-open 이라 기록이 빌 수 있다. */
const DEFAULT_RESTORE_STATUS = '견적중'
const FAIL_STATUS = '실패'

/** 견적 PDF 스토리지 버킷. quotes.pdf_url 은 '<버킷>/<파일명>' 꼴로 저장된다. */
const PDF_BUCKET = 'quote-pdfs'

const TYPE_COMPLETED = 'quote_deleted'

const admin = (): SupabaseClient => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/**
 * 견적 삭제 요청 문서의 summary.
 * 엔진은 원 테이블을 읽지 않는다 — 결재자가 판단할 재료를 상신 때 여기 복사해 둔다.
 * restoreStatus 는 반려·회수·폐기 때 되돌아갈 상태다. 결재자에게 미리 보여 준다.
 */
export type QuoteDeleteSummary = {
  quoteNumber: string | null
  customer: string | null
  /** 공급가(total_supply). */
  amount: number | null
  /** 실적 담당자(quotes.engineer_id) 이름. */
  engineer: string | null
  reason: string | null
  restoreStatus: string
  /** '실패' 로 되돌아갈 때만 살릴 미수주 사유. 화면에는 보이지 않는다. */
  restoreFailReason?: string | null
}

type RestoreTarget = { status: string; failReason: string | null }

/**
 * '취소요청으로 전환된 가장 최근 기록' 에서 되돌릴 상태를 읽는다.
 *
 * old_data.status 가 이미 '취소요청' 인 기록은 전환이 아니라 같은 상태로 다시 저장한 것이므로
 * 건너뛰고 그다음(더 오래된) 기록을 본다 — SQL 의 `is distinct from` 과 같은 결과다.
 * 읽지 못하면 기본값('견적중')으로 간다. 복원을 아예 못 하는 것보다 낫다.
 */
export async function loadRestoreTarget(sb: SupabaseClient, quoteId: number): Promise<RestoreTarget> {
  const fallback: RestoreTarget = { status: DEFAULT_RESTORE_STATUS, failReason: null }
  const { data, error } = await sb
    .from('audit_log')
    .select('old_data')
    .eq('table_name', 'quotes')
    .eq('action', 'UPDATE')
    .eq('new_data->>status', DELETE_REQUEST_STATUS)
    .eq('row_id', String(quoteId))
    .order('occurred_at', { ascending: false })
    .limit(20)
  if (error) {
    console.error(`[${TAG}] audit lookup failed`, { quoteId, error })
    return fallback
  }
  for (const r of (data ?? []) as { old_data: Record<string, unknown> | null }[]) {
    const old = r.old_data ?? {}
    const prev = typeof old.status === 'string' ? old.status : null
    if (!prev || prev === DELETE_REQUEST_STATUS) continue
    return {
      status: prev,
      // fail_reason 은 '실패' 로 되돌아갈 때만 살린다. 그 밖의 상태에서는 남아 있으면 안 되는 값이다.
      failReason: prev === FAIL_STATUS && typeof old.fail_reason === 'string' ? old.fail_reason : null,
    }
  }
  return fallback
}

/**
 * 스토리지에 있는 견적 PDF 를 지운다. 견적 행이 지워진 뒤에 부른다.
 *
 * 경로 파싱은 /api/delete-quote-pdf 와 똑같이 한다 — 별도 규칙을 만들지 않는다.
 * 버킷 이름을 떼고 trim → '..' 제거 → 앞쪽 '/' 제거. 남은 값이 비었거나 폴더 구분자가 있으면
 * 잘못된 경로로 보고 지우지 않는다(경로 순회 방지).
 */
async function removeQuotePdf(sb: SupabaseClient, pdfUrl: string | null, quoteNumber: string | null) {
  if (!pdfUrl?.trim()) return
  const safePath = pdfUrl.replace(`${PDF_BUCKET}/`, '').trim().replace(/\.\./g, '').replace(/^\/+/, '')
  if (!safePath || safePath.includes('/')) {
    console.error(`[${TAG}] invalid pdf path, skipped`, { quoteNumber, pdfUrl })
    return
  }
  const { error } = await sb.storage.from(PDF_BUCKET).remove([safePath])
  if (error) console.error(`[${TAG}] pdf remove failed`, { quoteNumber, safePath, error })
}

/** 감사 기록의 action. 트리거가 남기는 'DELETE' 와도, 서로와도 구분된다. */
export const AUDIT_ACTION_APPROVAL = 'APPROVAL_DELETE'
export const AUDIT_ACTION_SELF = 'SELF_DELETE'

/**
 * 누가 왜 지웠는지를 감사 기록에 한 줄 남긴다.
 *
 * quotes 의 감사 트리거도 DELETE 한 줄을 남기지만, 그것만으로는 부족하다.
 *   · 결재 삭제는 service role 로 돌아 트리거가 auth.jwt() 에서 읽는 actor_email 이 비어 버린다.
 *   · 본인 삭제는 세션 클라이언트로 지워 행위자가 남지만, 삭제 사유와 「결재를 거치지 않았다」는
 *     사실이 트리거 기록에는 없다.
 * 견적 삭제는 되돌릴 수 없으므로 두 경우 모두 근거를 따로 남긴다.
 *
 * 모양은 앱이 직접 쓰는 다른 감사 기록과 같다(actor_email·action·table_name·row_id 를 채우고
 * actor_uid 는 두지 않는다 — /api/quote-pdf 등이 'READ' 를 남기는 방식).
 * best-effort 다 — 실패해도 삭제는 이미 끝났다.
 */
export async function writeDeleteAudit(
  sb: SupabaseClient,
  quote: { quote_id: number; quote_number: string | null },
  opts: { action: string; actorId: number; detail: Record<string, unknown> },
) {
  const { data: actor, error: actorErr } = await sb
    .from('engineers')
    .select('email, name')
    .eq('engineer_id', opts.actorId)
    .maybeSingle()
  if (actorErr) console.error(`[${TAG}] actor lookup failed`, { actorId: opts.actorId, error: actorErr })
  const who = (actor ?? null) as { email: string | null; name: string | null } | null

  const { error } = await sb.from('audit_log').insert({
    actor_email: who?.email ?? null,
    action: opts.action,
    table_name: QUOTE_DELETE_TARGET_TABLE,
    row_id: String(quote.quote_id),
    // 무엇이 지워졌는지. 행 전체는 트리거가 남긴 DELETE 기록에 있으므로 여기는 식별자만 둔다.
    old_data: { quote_id: quote.quote_id, quote_number: quote.quote_number },
    // 근거 — 누가, 어떤 절차로 지웠는가.
    new_data: { ...opts.detail, deleted_by: opts.actorId, deleted_by_name: who?.name ?? null },
  })
  if (error) console.error(`[${TAG}] delete audit insert failed`, { quoteId: quote.quote_id, error })
}

/** 지운 견적. 부르는 쪽이 감사·알림에 쓴다. */
export type DeletedQuote = {
  quote_id: number
  quote_number: string | null
  status: string
  pdf_url: string | null
  engineer_id: number | null
  created_by: number | null
}

export type DeleteResult =
  | { ok: true; quote: DeletedQuote }
  | { ok: false; error: string; status: number }

/**
 * 견적을 지운다 — 본인 삭제와 결재 삭제가 함께 쓰는 단 하나의 실행 절차다.
 *
 * 절차
 *   1. 지금 상태를 다시 읽는다. allowedStatuses 밖이면 지우지 않는다 — 결재가 도는 사이,
 *      또는 화면을 띄워 둔 사이에 상태가 바뀌었을 수 있다.
 *   2. quotes 행을 조건부로 지운다. 0행이면 그사이 누가 먼저 손댄 것이다.
 *      자식(quote_items · quote_expenses)은 건드리지 않는다 — 아래 「자식은 CASCADE」 참고.
 *   3. 행이 사라진 뒤에 스토리지 PDF 를 지운다. 순서를 뒤집으면 행 삭제가 실패했을 때
 *      PDF 만 사라진다. 스토리지는 FK 가 없어 DB 가 치워 주지 않는다 — 이 단계는 꼭 있어야 한다.
 *
 * 자식은 CASCADE 다 (2026-10-02 실측 확인)
 *   quote_items.quote_id · quote_expenses.quote_id 가 ON DELETE CASCADE 라, quotes 행을 지우면
 *   DB 가 함께 지운다. 예전에는 이 함수가 그 둘을 먼저 수동으로 지웠다 — 레포 기록과 코드 주석이
 *   CASCADE / NO ACTION 으로 엇갈려 있어 「어느 쪽이든 탈이 없게」 둔 코드였다. 확인이 끝났으므로
 *   걷어냈다. 수동 삭제가 하던 일을 DB 가 하므로 결과는 같고, 실패할 수 있는 단계가 둘 줄었다.
 *   ※ 참조 무결성 동작(CASCADE)은 자식 표의 RLS 를 거치지 않는다 — 세션 클라이언트로 부모를
 *     지워도 자식이 함께 지워진다. 그래서 quote_expenses 의 superadmin 전용 DELETE 정책
 *     (quote_schema_snapshot.sql:89-90)이 본인 삭제를 막지 않는다.
 *   ※ download_logs.quote_id · showroom_usage.quote_id 는 SET NULL 이다 — 기록은 남고 번호만
 *     비워진다. 이 함수는 그 둘을 건드리지 않으며, 건드려서도 안 된다.
 *
 * 클라이언트를 둘로 나눠 받는다
 *   sb      — service role. 조회·감사·알림·스토리지에 쓴다.
 *   sbQuote — quotes 행을 지울 클라이언트. 본인 삭제는 세션 클라이언트를 넘긴다 —
 *             그래야 quotes 의 감사 트리거가 auth.jwt() 에서 행위자를 읽어 남긴다.
 *             생략하면 sb 를 그대로 쓴다(결재 삭제는 서버 훅이라 세션이 없다).
 */
export async function executeQuoteDelete(opts: {
  sb: SupabaseClient
  sbQuote?: SupabaseClient
  quoteId: number
  allowedStatuses: readonly string[]
  /** 로그 앞에 붙일 이름. 어느 갈래가 지웠는지 구분하려고 받는다. */
  via: string
}): Promise<DeleteResult> {
  const { sb, quoteId, allowedStatuses, via } = opts
  const sbQuote = opts.sbQuote ?? sb

  const { data: found, error: readErr } = await sb
    .from('quotes')
    .select('quote_id, quote_number, status, pdf_url, engineer_id, created_by')
    .eq('quote_id', quoteId)
    .maybeSingle()
  if (readErr) {
    console.error(`[${TAG}:${via}] quote lookup failed`, { quoteId, error: readErr })
    return { ok: false, error: '견적을 불러오지 못했습니다.', status: 500 }
  }
  const quote = (found ?? null) as DeletedQuote | null
  if (!quote) return { ok: false, error: '견적을 찾을 수 없습니다.', status: 404 }
  if (!allowedStatuses.includes(quote.status)) {
    console.error(`[${TAG}:${via}] 지울 수 있는 상태가 아니다`, { quoteId, status: quote.status })
    return { ok: false, error: `지금은 삭제할 수 없는 상태입니다 (${quote.status})`, status: 409 }
  }

  // 자식(quote_items · quote_expenses)을 수동으로 지우지 않는다 — 둘 다 ON DELETE CASCADE 라
  // quotes 행을 지우면 DB 가 함께 지운다(실측 확인, 2026-10-02).
  // 조건부 DELETE — 그사이 상태가 바뀌었으면 0행이 되어 지우지 않는다.
  const { data: gone, error: delErr } = await sbQuote
    .from('quotes')
    .delete()
    .eq('quote_id', quoteId)
    .in('status', allowedStatuses as string[])
    .select('quote_id')
  if (delErr) {
    console.error(`[${TAG}:${via}] delete quote failed`, { quoteId, error: delErr })
    return { ok: false, error: '견적을 지우지 못했습니다.', status: 500 }
  }
  if (!gone || gone.length === 0) {
    // RLS 로 막혀도 0행이 된다(에러가 아니다) — 본인 삭제의 권한 판정이 틀렸을 때 여기로 온다.
    console.error(`[${TAG}:${via}] 견적이 지워지지 않았다(상태가 바뀌었거나 권한이 없다)`, { quoteId })
    return { ok: false, error: '이미 처리되었거나 지울 권한이 없습니다.', status: 409 }
  }

  await removeQuotePdf(sb, quote.pdf_url, quote.quote_number)
  console.log(`[${TAG}:${via}] 삭제 완료`, { quoteId, quoteNumber: quote.quote_number })
  return { ok: true, quote }
}

/** 지운 견적의 실적 담당자에게 알린다. 지운 사람 본인이면 알리지 않는다. */
export async function notifyQuoteDeleted(sb: SupabaseClient, quote: DeletedQuote, exclude: (number | null)[]) {
  const target = quote.engineer_id
  if (!target || exclude.includes(target)) return
  const { error } = await sb.from('notifications').insert({
    engineer_id: target,
    title: '견적 삭제 완료',
    message: `[${quote.quote_number}] 견적이 삭제되었습니다.`,
    type: TYPE_COMPLETED,
    link: null,   // 견적이 사라져 이동할 곳이 없다
    is_read: false,
  })
  if (error) console.error(`[${TAG}] completed notification insert failed`, { quoteId: quote.quote_id, error })
}

/**
 * 결재 완료 — 견적을 실제로 지운다.
 *
 * 결재가 도는 동안 견적이 '취소요청' 에서 벗어났다면 요청이 사실상 취소된 것이라 지우지 않는다.
 * 실패해도 결재 자체는 이미 끝났으므로 되돌리지 않고 기록만 남긴다(라우트가 그렇게 부른다).
 */
export async function onCompleteQuoteDelete(ctx: OnCompleteContext): Promise<void> {
  const quoteId = ctx.targetId
  if (quoteId == null) {
    console.error(`[${TAG}] targetId 가 없다 — 지울 견적을 알 수 없다`, { documentId: ctx.documentId })
    return
  }
  const sb = admin()
  const done = await executeQuoteDelete({
    sb, quoteId, allowedStatuses: [DELETE_REQUEST_STATUS], via: '결재',
  })
  if (!done.ok) return

  await writeDeleteAudit(sb, done.quote, {
    action: AUDIT_ACTION_APPROVAL,
    actorId: ctx.actorId,
    detail: { approval_document_id: ctx.documentId, approval_doc_no: ctx.docNo },
  })
  // 결재 완료 알림은 엔진이 상신자·참조에게 따로 보낸다. 여기서는 실적 담당자만 챙긴다.
  await notifyQuoteDeleted(sb, done.quote, [ctx.actorId, ctx.requesterId])
}

/**
 * 되돌리기 — 반려·회수·폐기 어느 쪽이든 견적을 이전 상태로 돌려놓는다.
 *
 * 조건부 UPDATE 라 이미 돌아간 견적에는 아무 일도 일어나지 않는다. 폐기는 반려·회수된 문서에만
 * 할 수 있어 이미 한 번 불린 뒤인데, 그래도 안전하게 다시 부를 수 있어야 한다.
 */
export async function onRevertQuoteDelete(ctx: OnCompleteContext): Promise<void> {
  const quoteId = ctx.targetId
  if (quoteId == null) {
    console.error(`[${TAG}] targetId 가 없다 — 되돌릴 견적을 알 수 없다`, { documentId: ctx.documentId })
    return
  }
  const sb = admin()

  // audit_log 가 정본이다. 못 읽으면 상신 때 담아 둔 summary 값으로, 그것도 없으면 기본값으로 간다.
  const fromAudit = await loadRestoreTarget(sb, quoteId)
  const s = ctx.summary as Partial<QuoteDeleteSummary>
  const target: RestoreTarget = fromAudit.status !== DEFAULT_RESTORE_STATUS
    ? fromAudit
    : {
      status: typeof s.restoreStatus === 'string' && s.restoreStatus ? s.restoreStatus : fromAudit.status,
      failReason: typeof s.restoreFailReason === 'string' ? s.restoreFailReason : fromAudit.failReason,
    }

  const { data: back, error } = await sb
    .from('quotes')
    .update({
      status: target.status,
      delete_reason: null,
      fail_reason: target.status === FAIL_STATUS ? target.failReason : null,
    })
    .eq('quote_id', quoteId)
    .eq('status', DELETE_REQUEST_STATUS)
    .select('quote_id')
  if (error) {
    console.error(`[${TAG}] restore failed`, { quoteId, documentId: ctx.documentId, error })
    return
  }
  if (!back || back.length === 0) {
    // 이미 되돌아갔거나(폐기가 반려 뒤에 왔다) 견적이 없어졌다. 정상이다.
    return
  }
  console.log(`[${TAG}] 되돌림`, { quoteId, documentId: ctx.documentId, status: target.status })
}

/**
 * 상신용 요약을 만든다. 견적을 읽어 결재자가 볼 값과 되돌아갈 상태를 한 번에 담는다.
 * 상신 라우트가 쓴다(엔진은 이 함수를 부르지 않는다).
 */
export async function buildQuoteDeleteSummary(
  sb: SupabaseClient,
  quote: {
    quote_id: number
    quote_number: string | null
    total_supply: number | null
    customer_id: number | null
    delete_reason: string | null
    engineer_id: number | null
  },
): Promise<QuoteDeleteSummary> {
  let customer: string | null = null
  if (quote.customer_id != null) {
    const { data, error } = await sb
      .from('customers').select('company_name').eq('customer_id', quote.customer_id).maybeSingle()
    if (error) console.error(`[${TAG}] customer lookup failed`, { quoteId: quote.quote_id, error })
    customer = (data as { company_name: string | null } | null)?.company_name ?? null
  }

  let engineer: string | null = null
  if (quote.engineer_id != null) {
    const { data, error } = await sb
      .from('engineers').select('name').eq('engineer_id', quote.engineer_id).maybeSingle()
    if (error) console.error(`[${TAG}] engineer lookup failed`, { quoteId: quote.quote_id, error })
    engineer = (data as { name: string | null } | null)?.name ?? null
  }

  const restore = await loadRestoreTarget(sb, quote.quote_id)
  return {
    quoteNumber: quote.quote_number,
    customer,
    amount: quote.total_supply,
    engineer,
    reason: quote.delete_reason,
    restoreStatus: restore.status,
    restoreFailReason: restore.failReason,
  }
}


// ════════════════════════════════════════════════════════════════════
// 회수·폐기된 결재 문서와 견적을 함께 지우는 길
//
// **결재 문서는 지우지 않는 설계다.** 반려한 사람의 판단이 기결함에서 사라지면 안 되고,
// 결재선을 지우면 남의 기결함에서 문서가 통째로 사라진다(app/api/approval/route.ts 의 discard).
// 여기 하나만 예외다 — 회수·폐기된 문서는 **효력이 없고 아무 판단도 담고 있지 않다.**
// 그 문서만 남기고 견적을 지우면 결재함에 가리킬 곳 없는 문서가 쌓인다.
// 반려·완료 문서는 **절대 지우지 않는다**(부르는 쪽이 selfDeleteVerdict 로 먼저 막는다).
// ════════════════════════════════════════════════════════════════════

/** 지울 대상이 되는 결재 문서 한 건. */
export type ClosedDoc = { documentId: number; docNo: string; status: string }

/** 감사 기록에 남길 이력 한 줄. 본문은 길이를 제한한다(기록이 비대해지지 않게). */
type HistoryNote = { action: string; actorId: number; at: string | null; comment: string | null }

/** 감사 기록에 담는 이력 줄 수와 의견 길이 상한. */
const AUDIT_HISTORY_MAX = 50
const AUDIT_COMMENT_MAX = 200

/** 감사 기록의 action — 견적과 결재 문서를 함께 지운 경우. */
export const AUDIT_ACTION_SELF_WITH_DOC = 'SELF_DELETE_WITH_DOC'
/** 문서는 지워졌는데 견적이 남은 경우(사람이 손봐야 한다). */
export const AUDIT_ACTION_RESIDUE = 'SELF_DELETE_RESIDUE'

/**
 * 그 견적의 결재 문서(doc_type 'quote') 전부. 상태를 가리지 않는다.
 *
 * 읽기가 실패하면 **ok: false** 다 — 못 읽은 것을 「문서가 없다」로 보면 반려·완료 문서가
 * 있는 견적이 그냥 지워진다(fail-closed).
 */
export async function loadQuoteDocs(
  sb: SupabaseClient, quoteId: number,
): Promise<{ ok: true; docs: ClosedDoc[]; requesterIds: number[] } | { ok: false }> {
  const { data, error } = await sb
    .from('approval_documents')
    .select('document_id, doc_no, status, requester_id')
    .eq('doc_type', 'quote')
    .eq('target_table', QUOTE_DELETE_TARGET_TABLE)
    .eq('target_id', quoteId)
  if (error) {
    console.error(`[${TAG}] quote document lookup failed`, { quoteId, error })
    return { ok: false }
  }
  const rows = (data ?? []) as { document_id: number; doc_no: string | null; status: string | null; requester_id: number | null }[]
  return {
    ok: true,
    docs: rows.map(r => ({ documentId: r.document_id, docNo: r.doc_no ?? '', status: r.status ?? '' })),
    requesterIds: rows.map(r => r.requester_id).filter((n): n is number => n != null),
  }
}

/** 그 문서들의 이력 — 감사 기록에 요약으로 옮긴다(지우기 전에 읽는다). */
async function loadHistoryNotes(sb: SupabaseClient, documentIds: number[]): Promise<HistoryNote[]> {
  if (documentIds.length === 0) return []
  const { data, error } = await sb
    .from('approval_history')
    .select('action, actor_id, created_at, comment')
    .in('document_id', documentIds)
    .order('history_id', { ascending: true })
    .limit(AUDIT_HISTORY_MAX)
  if (error) {
    console.error(`[${TAG}] history lookup failed`, { documentIds, error })
    return []
  }
  return ((data ?? []) as { action: string | null; actor_id: number | null; created_at: string | null; comment: string | null }[])
    .map(h => ({
      action: h.action ?? '',
      actorId: h.actor_id ?? 0,
      at: h.created_at,
      comment: h.comment == null ? null : h.comment.slice(0, AUDIT_COMMENT_MAX),
    }))
}

/**
 * 지우기 **전에** 감사 기록을 남긴다. 이 한 줄이 지워진 결재 문서의 유일한 기록이다.
 *
 * **best-effort 가 아니다** — 실패하면 아무것도 지우지 않는다(돌려주는 false 로 부르는 쪽이 멈춘다).
 * 다른 삭제 기록(writeDeleteAudit)은 삭제가 끝난 뒤에 남겨도 행 전체가 트리거 기록에 남아 있지만,
 * 결재 문서에는 그런 트리거가 없다.
 */
export async function writeClosedDeleteAudit(
  sb: SupabaseClient,
  quote: { quote_id: number; quote_number: string | null; status: string },
  opts: { docs: ClosedDoc[]; actorId: number; reason: string },
): Promise<boolean> {
  const history = await loadHistoryNotes(sb, opts.docs.map(d => d.documentId))
  const { data: actor } = await sb
    .from('engineers').select('email, name').eq('engineer_id', opts.actorId).maybeSingle()
  const who = (actor ?? null) as { email: string | null; name: string | null } | null

  const { error } = await sb.from('audit_log').insert({
    actor_email: who?.email ?? null,
    action: AUDIT_ACTION_SELF_WITH_DOC,
    table_name: QUOTE_DELETE_TARGET_TABLE,
    row_id: String(quote.quote_id),
    old_data: {
      quote_id: quote.quote_id,
      quote_number: quote.quote_number,
      quote_status: quote.status,
      // 지워질 결재 문서 — 번호와 상태. 본문(summary)은 담지 않는다(견적번호·금액은 견적 쪽 기록에 있다).
      documents: opts.docs.map(d => ({ document_id: d.documentId, doc_no: d.docNo, status: d.status })),
      history,
    },
    new_data: {
      // 'withdrawn' — 회수·폐기된 결재 문서만 있어서 작성자가 직접 지웠다는 뜻이다.
      reason: 'withdrawn',
      note: opts.reason,
      approval: false,
      deleted_by: opts.actorId,
      deleted_by_name: who?.name ?? null,
    },
  })
  if (error) {
    console.error(`[${TAG}] closed-delete audit insert failed — 아무것도 지우지 않는다`, { quoteId: quote.quote_id, error })
    return false
  }
  return true
}

/**
 * 결재 문서를 지운다 — **이력 먼저, 문서 다음.**
 *
 * approval_history.document_id 에는 ON DELETE 절이 없어(approval_schema.sql) 이력이 남아 있으면
 * 문서 삭제가 FK 로 막힌다. 결재선(approval_lines)은 ON DELETE CASCADE 라 DB 가 함께 지운다.
 * 순서는 상신 되돌리기(lib/approval/submit.ts 의 rollbackApprovalDocument)와 같다.
 */
export async function deleteApprovalDocuments(
  sb: SupabaseClient, documentIds: number[],
): Promise<{ ok: true } | { ok: false; error: string; stage: 'history' | 'document' }> {
  if (documentIds.length === 0) return { ok: true }
  const { error: hErr } = await sb.from('approval_history').delete().in('document_id', documentIds)
  if (hErr) {
    console.error(`[${TAG}] history delete failed`, { documentIds, error: hErr })
    return { ok: false, error: '결재 이력을 지우지 못했습니다.', stage: 'history' }
  }
  const { error: dErr } = await sb.from('approval_documents').delete().in('document_id', documentIds)
  if (dErr) {
    console.error(`[${TAG}] document delete failed`, { documentIds, error: dErr })
    return { ok: false, error: '결재 문서를 지우지 못했습니다.', stage: 'document' }
  }
  return { ok: true }
}

/**
 * 「문서는 지워졌는데 견적이 남았다」를 기록해 둔다.
 *
 * 이 상태는 **다시 눌러 보면 사라진다** — 문서가 없어졌으므로 다음 시도는 결재 문서가 없는
 * 평범한 본인 삭제가 되고, 막혔던 이유(상태·권한)를 고치면 그대로 지워진다. 그래도 왜
 * 결재 문서가 없어졌는지는 남아 있어야 하므로 한 줄 적는다. best-effort 다.
 */
export async function writeResidueAudit(
  sb: SupabaseClient,
  quote: { quote_id: number; quote_number: string | null },
  opts: { docs: ClosedDoc[]; actorId: number; detail: string },
): Promise<void> {
  const { error } = await sb.from('audit_log').insert({
    actor_email: null,
    action: AUDIT_ACTION_RESIDUE,
    table_name: QUOTE_DELETE_TARGET_TABLE,
    row_id: String(quote.quote_id),
    old_data: {
      quote_id: quote.quote_id,
      quote_number: quote.quote_number,
      documents: opts.docs.map(d => ({ document_id: d.documentId, doc_no: d.docNo, status: d.status })),
    },
    new_data: { detail: opts.detail, deleted_by: opts.actorId },
  })
  if (error) console.error(`[${TAG}] residue audit insert failed`, { quoteId: quote.quote_id, error })
}


/**
 * 수리 건과의 연결을 끊는다 — **견적을 지우기 바로 전에** 부른다.
 *
 * repairs.quote_id 는 create_quote 가 채운다(quotes_terms_schema.sql 의 10단계). 그런데
 * **그 칸의 FK 규칙이 저장소 기록에 없다** — quote_schema_snapshot.sql 의 「quotes 를 참조하는 FK」
 * 목록(quote_items·quote_expenses·download_logs·showroom_usage)에 repairs 가 들어 있지 않다.
 * 둘 중 하나인데 어느 쪽이든 그냥 지우면 곤란하다.
 *   · FK 가 없다        → 견적이 사라진 뒤 repairs.quote_id 가 **없는 견적을 가리킨다.**
 *                         수리 화면이 「연결된 견적서」를 그리고(app/repair/page.tsx) PDF 발급
 *                         권한도 그 칸으로 판정한다(app/api/repair-quotes) — 깨진 연결이 남는다.
 *   · FK 가 NO ACTION 이다 → quotes 삭제가 **FK 오류로 실패한다.**
 * 먼저 null 로 풀어 두면 두 경우 모두 안전하다(SET NULL·CASCADE 라면 한 번 더 비우는 것뿐이다).
 *
 * **기존 삭제 경로(executeQuoteDelete)는 건드리지 않았다.** 결재 삭제와 옛 본인 삭제는 지금까지
 * 그대로 돈다 — 그 동작을 바꾸지 않는 것이 이번 작업의 전제다. 이 단계는 회수 문서와 견적을
 * 함께 지우는 **새 경로에서만** 부른다(그 경로는 '수리중' 견적까지 지울 수 있어 연결이 있을 확률이 높다).
 *
 * best-effort 가 아니다 — 실패하면 false 를 돌려 부르는 쪽이 멈춘다(견적을 지우지 않는다).
 */
export async function unlinkRepairs(sb: SupabaseClient, quoteId: number): Promise<boolean> {
  const { error } = await sb.from('repairs').update({ quote_id: null }).eq('quote_id', quoteId)
  if (error) {
    console.error(`[${TAG}] 수리 연결 해제 실패`, { quoteId, error })
    return false
  }
  return true
}
