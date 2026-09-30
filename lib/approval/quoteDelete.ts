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
// 실행 로직은 옛 요청함(app/api/requests/quote-delete)에서 그대로 옮겨 왔다. 다시 짜지 않았다.
//   · 삭제 — quote_expenses → quote_items → quotes 순서, 그 뒤에 스토리지 PDF.
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

// 결재 없이 지울 수 있는 상태의 기준은 lib/quoteDeletePolicy.ts 하나다(화면도 같은 것을 읽는다).
// 여기서는 다시 내보내기만 한다 — 부르는 쪽이 어느 파일을 읽을지 고민하지 않게.
export { SELF_DELETABLE_STATUSES, isSelfDeletable } from '@/lib/quoteDeletePolicy'

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
 *   2. 자식부터 지운다(quote_expenses → quote_items). 매 단계 error 를 확인하고 실패하면 멈춘다.
 *      ※ 레포 기록(quote_schema_snapshot.sql:44-49)은 두 FK 가 ON DELETE CASCADE 라고 적고 있어
 *        이 두 단계가 없어도 지워진다. 기존 코드 주석은 NO ACTION 이라고 적혀 있어 서로 어긋난다.
 *        어느 쪽이 맞든 탈이 없도록 지금은 그대로 지운다(CASCADE 면 0행이 될 뿐이다).
 *   3. quotes 행을 조건부로 지운다. 0행이면 그사이 누가 먼저 손댄 것이다.
 *   4. 행이 사라진 뒤에 스토리지 PDF 를 지운다. 순서를 뒤집으면 행 삭제가 실패했을 때
 *      PDF 만 사라진다.
 *
 * 클라이언트를 둘로 나눠 받는다
 *   sb      — service role. 조회·자식 삭제·스토리지에 쓴다. quote_expenses 의 DELETE 정책이
 *             superadmin 전용이라(quote_schema_snapshot.sql:89-90) 세션 클라이언트로는 자식을 못 지운다.
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

  const { error: expErr } = await sb.from('quote_expenses').delete().eq('quote_id', quoteId)
  if (expErr) {
    console.error(`[${TAG}:${via}] delete quote_expenses failed`, { quoteId, error: expErr })
    return { ok: false, error: '부대비용을 지우지 못했습니다.', status: 500 }
  }
  const { error: itemErr } = await sb.from('quote_items').delete().eq('quote_id', quoteId)
  if (itemErr) {
    console.error(`[${TAG}:${via}] delete quote_items failed — 부대비용은 이미 지워졌다`, { quoteId, error: itemErr })
    return { ok: false, error: '견적 품목을 지우지 못했습니다.', status: 500 }
  }

  // 조건부 DELETE — 그사이 상태가 바뀌었으면 0행이 되어 지우지 않는다.
  const { data: gone, error: delErr } = await sbQuote
    .from('quotes')
    .delete()
    .eq('quote_id', quoteId)
    .in('status', allowedStatuses as string[])
    .select('quote_id')
  if (delErr) {
    console.error(`[${TAG}:${via}] delete quote failed — 품목·부대비용은 이미 지워졌다`, { quoteId, error: delErr })
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
