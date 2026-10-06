// 견적서 결재의 실행 로직 — 전자결재 6단계 A.
//
// 모양은 lib/approval/quoteDelete.ts 와 같다.
//   · 서버 전용이다 — service role 로 쓴다. **화면에서 import 하지 마라**
//     (docTypes.ts 머리말: 화면이 읽는 등록표에 서버 전용 코드가 끌려오면 번들이 깨진다).
//   · 상태 전이는 전부 조건부 UPDATE 다 — 여러 번 불려도, 그사이 남이 손대도 탈이 없어야 한다.
//   · 던지지 않는다. 후처리 훅이 실패해도 결재 자체는 이미 끝났고, 라우트는 기록만 남긴다
//     (app/api/approval/route.ts 의 onComplete·runRevert 주석).
//
// 「결재중」을 거쳐 어디로 돌아가는가
//   결재가 끝나면 **상신 직전 상태로 되돌린다**. 완료 뒤에 '승인' 같은 새 값에 머무르면
//   발주서 등록 버튼(status === '견적중')·자동 실주·유효기간 경고·80 대시보드가 모두 멈춘다.
//   되돌릴 값은 상신 때 summary.restore_status 에 담아 둔다 — 엔진은 원 테이블을 읽지 않으므로
//   후처리가 읽을 수 있는 곳은 summary 뿐이다. 국내수리 견적이면 '수리중' 으로 돌아간다.
//
// 결재 연결을 떼어 낼 때는 handlers.ts 의 quote 항목을 `{}` 로 비우고 상신 라우트만 닫으면 된다 —
// 이 파일 밖으로 견적↔결재 지식이 새어 나가지 않게 두었다.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { OnCompleteContext } from './docTypes'
import {
  gateOf, restoreStatusOf, SUBMITTED_STATUS, QUOTE_TARGET_TABLE, QUOTE_TYPE,
  type QuoteGate,
} from './quoteApprovalKeys'

const TAG = 'approval/quoteApproval'

// 식별자·순수 판정은 lib/approval/quoteApprovalKeys.ts 하나다(화면도 그 파일을 읽는다).
// 여기서는 다시 내보내기만 한다 — 부르는 쪽이 어느 파일을 읽을지 고민하지 않게.
export {
  QUOTE_TYPE, QUOTE_TARGET_TABLE, SUBMITTED_STATUS, restoreStatusOf,
  gateOf, gateAllows, GATE_BLOCK_MESSAGE, GATE_PDF_MESSAGE,
} from './quoteApprovalKeys'
export type { QuoteGate } from './quoteApprovalKeys'

const admin = (): SupabaseClient => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/**
 * 견적서 결재 문서의 summary.
 *
 * 화면 표시 칸(customer·amount·engineer)은 components/approval/summary.ts 의 quote 등록표와
 * 1:1 이다 — 거기에 없는 이름을 쓰면 「모르는 칸」으로 열쇠 이름이 날것으로 노출된다.
 * restore_status·quote_type 은 후처리용이라 화면에 보이지 않아야 한다(summary.ts 의 HIDDEN).
 */
export type QuoteSummary = {
  /** 고객사 이름. 대리점 건이면 청구처(dealer_id)가 아니라 수요처(customer_id)다. */
  customer: string | null
  /** 공급가(total_supply) — 실적 현황이 「매출액」으로 보여 주는 칸과 같다. */
  amount: number | null
  /** 작성자(created_by) 이름. 대필이면 실적 담당자가 아니라 쓴 사람이다. */
  engineer: string | null
  /** 상신 직전 상태. 완료·반려·회수·폐기에서 모두 이 값으로 되돌린다. */
  restore_status: string
  /** 국내수리 여부 판단 근거. 화면에는 보이지 않는다. */
  quote_type: string | null
  /** 견적번호 — 알림 문구에 쓴다(문서번호와 같은 값이지만 후처리가 문서를 다시 읽지 않게 담아 둔다). */
  quote_number: string | null
}

export type QuoteRowForSummary = {
  quote_id: number
  quote_number: string | null
  status: string
  quote_type: string | null
  /** 공급가. 실적 현황·엑셀이 쓰는 칸과 같다. */
  total_supply: number | null
  customer_id: number | null
  created_by: number | null
  engineer_id: number | null
}

/**
 * 상신용 요약을 만든다. 상신 라우트가 쓴다(엔진은 이 함수를 부르지 않는다).
 * 고객사·작성자 이름은 각각 한 번씩만 읽는다 — 결재자가 볼 값이라 id 만으로는 뜻이 통하지 않는다.
 */
export async function buildQuoteSummary(
  sb: SupabaseClient,
  quote: QuoteRowForSummary,
): Promise<QuoteSummary> {
  let customer: string | null = null
  if (quote.customer_id != null) {
    const { data, error } = await sb
      .from('customers').select('company_name').eq('customer_id', quote.customer_id).maybeSingle()
    if (error) console.error(`[${TAG}] customer lookup failed`, { quoteId: quote.quote_id, error })
    customer = (data as { company_name: string | null } | null)?.company_name ?? null
  }

  let engineer: string | null = null
  if (quote.created_by != null) {
    const { data, error } = await sb
      .from('engineers').select('name').eq('engineer_id', quote.created_by).maybeSingle()
    if (error) console.error(`[${TAG}] engineer lookup failed`, { quoteId: quote.quote_id, error })
    engineer = (data as { name: string | null } | null)?.name ?? null
  }

  return {
    customer,
    amount: quote.total_supply,
    engineer,
    restore_status: restoreStatusOf(quote.status),
    quote_type: quote.quote_type,
    quote_number: quote.quote_number,
  }
}

// ── 승인 게이트 조회 ────────────────────────────────────────────────
//
// 왜 서버가 계산하는가 — approval_documents 의 읽기 정책(ad_select)은 「상신자 본인 · 결재선에
// 있는 사람 · superadmin」에게만 열려 있다(approval_schema.sql). 실적 현황은 남의 견적을 보여
// 주므로 **브라우저가 그 견적의 결재 문서를 읽을 수 없다.** 그래서 service role 로 여기서 재고,
// 화면에는 게이트 값 하나만 내보낸다(문서 내용·결재선·반려 사유는 내보내지 않는다).

/** 한 번에 묻는 견적 id 수. `.in()` 은 쿼리 문자열로 나가 길면 URL 이 막힌다. */
const GATE_CHUNK = 100

/** 게이트와, 그 판정에 쓰인 지금 상태. 부르는 쪽이 상태별 분기를 함께 해야 한다. */
export type QuoteGateRow = { gate: QuoteGate; status: string; createdAt: string | null }

export type GateResult =
  | { ok: true; gates: Map<number, QuoteGateRow> }
  | { ok: false; error: string }

/**
 * 견적들의 승인 게이트. 없는 견적은 결과 Map 에 **담기지 않는다**(부르는 쪽이 404 로 가른다).
 *
 * 조회가 실패하면 ok:false 다 — 못 읽은 것을 「허용」으로 떨어뜨리면 잠금이 뚫린다(fail-closed).
 */
export async function loadQuoteGates(sb: SupabaseClient, quoteIds: number[]): Promise<GateResult> {
  const ids = [...new Set(quoteIds.filter(n => Number.isSafeInteger(n) && n > 0))]
  const gates = new Map<number, QuoteGateRow>()
  if (ids.length === 0) return { ok: true, gates }

  for (let i = 0; i < ids.length; i += GATE_CHUNK) {
    const slice = ids.slice(i, i + GATE_CHUNK)

    const { data: rows, error: qErr } = await sb
      .from('quotes')
      .select('quote_id, created_at, status')
      .in('quote_id', slice)
    if (qErr) {
      console.error(`[${TAG}] gate quote lookup failed`, { count: slice.length, error: qErr })
      return { ok: false, error: '견적을 불러오지 못했습니다.' }
    }

    // 완료된 결재 문서가 있는 견적 id. '완료' 만 본다 — 진행중·반려·회수·폐기는 승인이 아니다.
    const { data: docs, error: dErr } = await sb
      .from('approval_documents')
      .select('target_id')
      .eq('doc_type', QUOTE_TYPE)
      .eq('target_table', QUOTE_TARGET_TABLE)
      .eq('status', '완료')
      .in('target_id', slice)
    if (dErr) {
      console.error(`[${TAG}] gate document lookup failed`, { count: slice.length, error: dErr })
      return { ok: false, error: '결재 상태를 확인하지 못했습니다.' }
    }
    const approved = new Set<number>()
    for (const d of (docs ?? []) as { target_id: number | null }[]) {
      if (d.target_id != null) approved.add(d.target_id)
    }

    for (const r of (rows ?? []) as { quote_id: number; created_at: string | null; status: string | null }[]) {
      const status = r.status ?? ''
      gates.set(r.quote_id, {
        gate: gateOf({ createdAt: r.created_at, status, hasCompletedDoc: approved.has(r.quote_id) }),
        status,
        createdAt: r.created_at,
      })
    }
  }
  return { ok: true, gates }
}

/** summary 에서 되돌릴 상태를 꺼낸다. 모양이 깨져 있어도 '견적중' 으로 떨어진다. */
const restoreFrom = (summary: Record<string, unknown>): string =>
  restoreStatusOf((summary as Partial<QuoteSummary>).restore_status)

const quoteNumberFrom = (summary: Record<string, unknown>): string | null => {
  const v = (summary as Partial<QuoteSummary>).quote_number
  return typeof v === 'string' && v.trim() ? v : null
}

/**
 * '결재중' 에서 풀어 준다. 조건부 UPDATE 라 이미 풀린 견적에는 아무 일도 일어나지 않는다.
 * 돌려주는 값 — true 면 이번 호출이 실제로 바꿨다, false 면 바꿀 것이 없었다(또는 실패).
 */
async function releaseQuote(
  sb: SupabaseClient, quoteId: number, status: string, why: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from('quotes')
    .update({ status })
    .eq('quote_id', quoteId)
    .eq('status', SUBMITTED_STATUS)
    .select('quote_id')
  if (error) {
    console.error(`[${TAG}] status release failed`, { quoteId, status, why, error })
    return false
  }
  return !!data && data.length > 0
}

/** 상신자에게 알린다. 후처리가 실패했을 때 손으로 풀게 하기 위한 것이다(쇼룸 선례와 같은 모양). */
async function notifyRequester(
  sb: SupabaseClient, engineerId: number, title: string, message: string,
): Promise<void> {
  const { error } = await sb.from('notifications').insert({
    engineer_id: engineerId, title, message, type: 'approval_completed',
    link: '/dashboard', is_read: false,
  })
  if (error) console.error(`[${TAG}] notification insert failed`, { engineerId, error })
}

/**
 * 결재 완료 — 견적을 상신 직전 상태로 되돌린다.
 *
 * 되돌리기가 실패하면 견적이 '결재중' 에 갇힌다(그 상태에서는 발주도 삭제도 못 한다).
 * 결재를 되돌릴 수는 없으므로 기록을 남기고 상신자에게 알려 손으로 풀게 한다
 * — 쇼룸 사용 기록 생성 실패와 같은 처리다(lib/approval/showroomUsage.ts).
 *
 * 그리고 실적 담당자가 작성자와 다르면(대필 견적) 그 사람에게도 알린다 —
 * 자기 실적에 잡히는 견적이 이제 쓸 수 있게 됐다는 사실을 본인이 알아야 한다.
 */
export async function onCompleteQuote(ctx: OnCompleteContext): Promise<void> {
  const quoteId = ctx.targetId
  if (quoteId == null) {
    console.error(`[${TAG}] targetId 가 없다 — 되돌릴 견적을 알 수 없다`, { documentId: ctx.documentId })
    return
  }
  const sb = admin()
  const target = restoreFrom(ctx.summary)
  const quoteNo = quoteNumberFrom(ctx.summary) ?? ctx.docNo

  const changed = await releaseQuote(sb, quoteId, target, '완료')
  if (!changed) {
    // 이미 풀려 있었을 수도 있다(그 경우는 정상). 어느 쪽인지 다시 읽어 가른다.
    const { data, error } = await sb
      .from('quotes').select('status').eq('quote_id', quoteId).maybeSingle()
    const now = (data as { status: string } | null)?.status ?? null
    if (error || now === SUBMITTED_STATUS || now == null) {
      console.error(`[${TAG}] 완료 후 상태를 되돌리지 못했다`, { quoteId, documentId: ctx.documentId, now, error })
      await notifyRequester(
        sb, ctx.requesterId, '견적 상태를 되돌리지 못했습니다',
        `[${quoteNo}] 결재는 완료됐지만 견적이 「결재중」에 남아 있습니다. 관리자에게 알려주세요.`,
      )
      return
    }
  } else {
    console.log(`[${TAG}] 완료 — 상태 복원`, { quoteId, documentId: ctx.documentId, status: target })
  }

  // 대필 견적의 실적 담당자 알림. 작성자(상신자)와 같으면 보내지 않는다.
  const { data: row, error: readErr } = await sb
    .from('quotes').select('engineer_id').eq('quote_id', quoteId).maybeSingle()
  if (readErr) {
    console.error(`[${TAG}] engineer_id lookup failed`, { quoteId, error: readErr })
    return
  }
  const ownerId = (row as { engineer_id: number | null } | null)?.engineer_id ?? null
  if (ownerId == null || ownerId === ctx.requesterId) return
  const { error } = await sb.from('notifications').insert({
    engineer_id: ownerId,
    title: '견적서 결재가 완료되었습니다',
    message: `[${quoteNo}] 결재가 완료되어 견적서를 쓸 수 있습니다.`,
    type: 'approval_completed',
    // 「내 견적」 목록에서 그 건이 바로 보이도록 견적번호를 검색어로 넘긴다(대필 알림과 같은 방식).
    link: `/dashboard?quote=${encodeURIComponent(quoteNo)}`,
    is_read: false,
  })
  if (error) console.error(`[${TAG}] owner notification insert failed`, { quoteId, ownerId, error })
}

/**
 * 결재가 완료되지 않고 끝났을 때 — 반려·회수·폐기 세 경우에 모두 불린다.
 *
 * 하는 일은 완료와 같다(견적을 '결재중' 에서 풀어 준다). 폐기는 반려·회수된 문서에만 할 수 있어
 * 이 훅이 두 번 불리는데, 조건부 UPDATE 라 두 번째 호출은 0행이 되어 조용히 지나간다.
 * 그래서 「바꿀 것이 없었다」를 오류로 보지 않는다.
 */
export async function onRevertQuote(ctx: OnCompleteContext): Promise<void> {
  const quoteId = ctx.targetId
  if (quoteId == null) {
    console.error(`[${TAG}] targetId 가 없다 — 되돌릴 견적을 알 수 없다`, { documentId: ctx.documentId })
    return
  }
  const sb = admin()
  const target = restoreFrom(ctx.summary)
  const changed = await releaseQuote(sb, quoteId, target, '되돌리기')
  if (changed) {
    console.log(`[${TAG}] 되돌림`, { quoteId, documentId: ctx.documentId, status: target })
  }
  // 0행이면 이미 풀렸다(두 번째 호출이거나 완료 훅이 먼저 돌았다). 정상이라 알리지 않는다.
}
