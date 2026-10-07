// 견적서 결재 상신 라우트 — 전자결재 6단계 A.
//
// 왜 전용 라우트인가 — 범용 상신(/api/approval 의 action 'submit')은 막혀 있다. 그 액션은 원 문서가
// 부르는 사람의 것인지 보지 않아, 결재가 전원 공개인 상태에서 남의 견적으로 문서를 만들 수 있다
// (app/api/approval/route.ts 의 GENERIC_SUBMIT_DISABLED 설명). 그래서 업무별 라우트가 원 문서를
// 검증한 뒤 lib/approval/submit.ts 의 함수를 **같은 프로세스 안에서** 직접 부른다 —
// 쇼룸 사용 신청(app/api/showroom/requests)·견적 삭제 요청(app/api/quote-delete)과 같은 방식이다.
//
// action 둘
//   check  — 결재선만 검사한다. **부작용이 없다.** 확정 전에 결재선 오류를 걸러 내,
//            결재선이 틀린 건에 견적번호가 발급되지 않게 하는 것이 목적이다
//            (번호는 create_quote 가 채번하고 되돌릴 수 없다).
//   submit — 결재선 검사 → 견적 검증 → 상태를 '결재중' 으로 → 결재 문서 생성.
//            문서 생성이 실패하면 상태를 직전 값으로 되돌린다(그러지 않으면 결재도 수정도 못 하는
//            '결재중' 에 갇힌다 — 견적 삭제 요청 화면이 쓰는 되돌리기와 같은 이유다).
//
// quotes.status 를 여기서(service role 로) 바꾼다
//   견적 삭제 요청은 상태 변경을 화면에 남겨 두었다 — quotes 의 감사 트리거가 행위자를 auth.jwt()
//   에서 읽고, 반려 시 되돌릴 이전 상태도 그 기록에서 꺼내기 때문이다(그 라우트 머리말).
//   견적서 상신은 사정이 다르다. 되돌릴 상태를 audit_log 가 아니라 **문서 summary 에 담아 두므로**
//   감사 기록에 의존하지 않고, 상태 변경과 문서 생성이 한 요청 안에서 붙어 있어야 중간 상태
//   ('결재중' 인데 문서가 없는 견적)가 남지 않는다. 행위자는 아래 audit_log 한 줄로 따로 남긴다.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu, canViewSalesMgmt, isSuperAdmin } from '@/lib/permissions'
import { attachTeamPerm, loadTeamPerms } from '@/lib/teamPermsServer'
import type { TeamPerm } from '@/lib/permissions'
import { todayKST } from '@/lib/date'
import { checkLines, createApprovalDocument } from '@/lib/approval/submit'
import {
  buildQuoteSummary, loadQuoteGates, QUOTE_TARGET_TABLE, QUOTE_TYPE, SUBMITTED_STATUS,
  type QuoteRowForSummary,
} from '@/lib/approval/quoteApproval'
import {
  buildQuoteReview,
  type PartyName, type RawExpense, type RawItem, type RawQuote,
} from '@/lib/approval/quoteReview'
import { APPROVABLE_STATUSES, isApprovalTarget } from '@/lib/quoteStatus'
import { euDisplayName } from '@/lib/quoteEuName'
import type { PdfQuoteRow } from '@/lib/quotePdfData'
import type { LineInput } from '@/lib/approval/types'

const TAG = 'quote-approval'

/** 감사 기록의 action. 트리거가 남기는 UPDATE 와 구분된다. */
const AUDIT_ACTION_SUBMIT = 'QUOTE_APPROVAL_SUBMIT'

type Caller = { engineer_id: number; name: string | null; permission_level: string | null; teams: string | null }

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

// ── 단계별 소요 시간 ────────────────────────────────────────────────
//
// 「검토표가 회색 자리표시로 오래 머문다」를 눈대중이 아니라 숫자로 보기 위한 것이다.
// 브라우저 Network 탭의 해당 요청 → Timing 에 단계가 그대로 뜬다(Server-Timing 표준).
//
// **값은 ms 뿐이다** — 문서 내용·id·사람·행 수 같은 것은 절대 담지 않는다. 헤더는 권한 판정을
// 통과한 응답에만 붙인다(막힌 요청에 시간을 돌려주면 그것도 알려 주는 정보가 된다).
//
// 겹쳐 실행되는 단계(Promise.all 안의 items·parties·engineers)도 각자의 시간이 따로 잡힌다 —
// 그래서 합이 total 보다 클 수 있고, 그 차이가 곧 「동시에 돌았다」는 뜻이다.
type Timer = {
  /** PromiseLike 를 받는다 — supabase 질의 빌더는 Promise 가 아니라 then 만 가진 객체다. */
  step<T>(name: string, fn: () => PromiseLike<T>): Promise<T>
  header(): string
}

function makeTimer(): Timer {
  const t0 = performance.now()
  const marks: [string, number][] = []
  return {
    async step<T>(name: string, fn: () => PromiseLike<T>): Promise<T> {
      const s = performance.now()
      try {
        return await fn()
      } finally {
        marks.push([name, performance.now() - s])
      }
    },
    header() {
      const all: [string, number][] = [...marks, ['total', performance.now() - t0]]
      return all.map(([n, ms]) => `${n};dur=${ms.toFixed(1)}`).join(', ')
    },
  }
}

/** 화면이 보낸 결재선을 읽는다. 모양만 맞추고 내용 검증은 checkLines 가 한다(쇼룸·견적 삭제와 같다). */
function readLines(raw: unknown): LineInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  return raw.map(r => ({
    step: Number((r as LineInput)?.step),
    kind: (r as LineInput)?.kind,
    approverId: Number((r as LineInput)?.approverId),
    isDelegatedAuthority: (r as LineInput)?.isDelegatedAuthority === true,
  })) as LineInput[]
}

/**
 * 견적 검증에 필요한 칸 — summary 가 읽는 칸을 모두 포함한다.
 * `deleted_at` 은 넣지 않는다 — quotes 에는 그 칸이 **없다**(견적은 소프트 삭제가 아니라 행을 지운다.
 * lib/approval/quoteDelete.ts 의 executeQuoteDelete). 없는 견적은 아래에서 404 로 걸린다.
 */
const QUOTE_SELECT = 'quote_id, quote_number, quote_date, created_at, status, quote_type, total_supply, customer_id, created_by, engineer_id'

type QuoteRow = QuoteRowForSummary & { quote_date: string | null; created_at: string | null }

/** 'gates' 가 한 번에 받는 견적 id 수 상한. 화면은 200개씩 끊어 부른다. */
const GATES_MAX = 300

/**
 * 본문에서 견적 id 목록을 읽는다. 중복을 지우고 상한까지만 받는다.
 * 숫자 모양(/^\d+$/)과 안전 정수를 함께 본다 — '1e3'·'01'·소수·공백이 섞여 들어오면 버린다.
 */
function readQuoteIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null
  const out = new Set<number>()
  for (const v of raw) {
    const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
    if (!/^\d+$/.test(s)) continue
    const n = Number(s)
    if (!Number.isSafeInteger(n) || n <= 0) continue
    out.add(n)
    if (out.size >= GATES_MAX) break
  }
  return [...out]
}

// ── 결재 문서 열람 권한 ─────────────────────────────────────────────
//
// 재사용할 helper 가 없어 여기서 만든다 — 지금 이 판정은 두 곳에 흩어져 있다.
//   ① RLS 정책 `ad_select` (approval_schema.sql:122-128)
//        requester_id = 나  또는  superadmin  또는  그 문서의 approval_lines 에 내가 있다
//   ② 결재함 GET 의 「전체」함 (app/api/approval/route.ts:569)
//        box='all' 은 approvals 메뉴 권한자에게만 열린다 — 남의 문서까지 보는 자리다
// 둘을 합친 것이 「그 문서를 볼 수 있는 사람」이다. lib/approval/engine.ts 는 건드리지 않는다
// (그 파일은 문서를 모르는 순수 판정만 둔다).
//
// 결재선은 **종류를 가리지 않는다** — 참조(cc)로 들어간 사람도 문서를 본다(팀 참조 포함).

type DocRef = { document_id: number; requester_id: number }

async function canViewApprovalDocument(
  sb: SupabaseClient,
  doc: DocRef,
  caller: Caller,
): Promise<boolean> {
  if (doc.requester_id === caller.engineer_id) return true
  if (isSuperAdmin(caller)) return true
  if (canViewMenu(caller, 'approvals')) return true
  const { data, error } = await sb
    .from('approval_lines')
    .select('line_id')
    .eq('document_id', doc.document_id)
    .eq('approver_id', caller.engineer_id)
    .limit(1)
  if (error) {
    // 못 읽었으면 막는다 — 열람 판정이 실패를 허용으로 떨어뜨리면 남의 문서가 새어 나간다.
    console.error(`[${TAG}] line lookup failed`, { documentId: doc.document_id, error })
    return false
  }
  return !!data && data.length > 0
}

/** 검토표가 읽는 칸. 저장값을 그대로 돌려준다 — 다시 계산하지 않는다. */
const REVIEW_QUOTE_SELECT = `
  quote_id, quote_number, quote_date, status, quote_type, recipient, note, delivery_info,
  total_supply, total_tax, total_amount, total_cost, total_profit, profit_rate,
  customer_id, dealer_id, engineer_id, created_by
`

/**
 * 업체 **여럿**의 이름 — 사업장명과 그것을 묶는 회사명. 못 읽은 id 는 맵에 없다(= null 로 본다).
 *
 * 왜 한 번에 읽는가 — 고객사와 대리점을 따로 부르면 각자 「자기 행 → 부모 행」 두 겹이라 왕복이
 * 최대 4번이었다. 여기서는 **두 번**이다: ① 넘어온 id 전부를 `.in` 으로 한 번 ② 그 결과에서 나온
 * 부모 id 전부를 `.in` 으로 한 번. 부모가 없으면 ②는 아예 보내지 않는다.
 *
 * 규칙과 결과는 한 곳씩 읽던 때와 같다:
 *   · id 가 null 이면 부르는 쪽이 애초에 넣지 않는다 → 맵에 없다 → null
 *   · 행이 없으면 맵에 없다 → null
 *   · 조회 실패는 **빈 맵**(fail-closed 가 아니라 「이름을 모른다」다 — 검토표는 '-' 를 그린다)
 *   · 부모 조회만 실패하면 사업장명은 그대로 두고 parent 만 null 이다(종전과 같다)
 */
async function partyNamesOf(sb: SupabaseClient, ids: (number | null)[]): Promise<Map<number, PartyName>> {
  const out = new Map<number, PartyName>()
  const want = [...new Set(ids.filter((n): n is number => n != null))]
  if (want.length === 0) return out

  const { data, error } = await sb
    .from('customers')
    .select('customer_id, company_name, parent_customer_id')
    .in('customer_id', want)
  if (error) {
    console.error(`[${TAG}] customer lookup failed`, { customerIds: want, error })
    return out
  }
  const rows = (data ?? []) as { customer_id: number; company_name: string | null; parent_customer_id: number | null }[]

  const parentIds = [...new Set(rows.map(r => r.parent_customer_id).filter((n): n is number => n != null))]
  const parentName = new Map<number, string | null>()
  if (parentIds.length > 0) {
    const { data: ps, error: pErr } = await sb
      .from('customers')
      .select('customer_id, company_name')
      .in('customer_id', parentIds)
    if (pErr) console.error(`[${TAG}] parent lookup failed`, { parentIds, error: pErr })
    for (const p of (ps ?? []) as { customer_id: number; company_name: string | null }[]) {
      parentName.set(p.customer_id, p.company_name)
    }
  }

  for (const r of rows) {
    out.set(r.customer_id, {
      site: r.company_name,
      parent: r.parent_customer_id == null ? null : (parentName.get(r.parent_customer_id) ?? null),
    })
  }
  return out
}

/** 맵에서 한 곳을 꺼낸다 — id 가 없거나 못 읽었으면 null(종전 partyNameOf 와 같은 값). */
const partyOf = (m: Map<number, PartyName>, id: number | null): PartyName | null =>
  id == null ? null : (m.get(id) ?? null)

/**
 * 견적 검토표 — 결재자가 금액뿐 아니라 품목·원가·이익까지 보고 판단하게 한다.
 *
 * 가리는 것이 없다. 이 문서를 볼 수 있는 사람이면 원가·이익까지 전부 본다(설계 결정).
 * 쓰기는 없다 — DB 를 바꾸지 않는다.
 */
async function review(sb: SupabaseClient, caller: Caller, body: Record<string, unknown>, timer: Timer) {
  const documentId = Number(body?.document_id)
  if (!Number.isSafeInteger(documentId) || documentId <= 0) return bad('문서를 지정해주세요.')

  const { data: docRow, error: docErr } = await timer.step('doc', () => sb
    .from('approval_documents')
    .select('document_id, doc_type, target_table, target_id, requester_id')
    .eq('document_id', documentId)
    .maybeSingle())
  if (docErr) {
    console.error(`[${TAG}] document lookup failed`, { documentId, error: docErr })
    return bad('문서를 불러오지 못했습니다.', 500)
  }
  const doc = (docRow ?? null) as (DocRef & { doc_type: string; target_table: string; target_id: number | null }) | null
  if (!doc) return bad('문서를 찾을 수 없습니다.', 404)

  // 권한을 **종류보다 먼저** 본다 — 볼 수 없는 사람에게 「그 문서는 견적서가 아니다」를 알려
  // 주지 않는다(문서 종류도 정보다).
  //
  // 이 판정은 **아래 조회들과 겹쳐 돌리지 않는다.** 겹치면 볼 권한이 없는 사람의 요청에도 견적·품목
  // 조회가 한 번은 나간다(응답에 담지는 않더라도). 읽을 자격을 확인한 다음 읽는다.
  const allowed = await timer.step('access', () => canViewApprovalDocument(sb, doc, caller))
  if (!allowed) {
    console.warn(`[${TAG}] review 권한 없음`, { documentId, callerId: caller.engineer_id })
    return bad('이 문서를 볼 권한이 없습니다.', 403)
  }

  if (doc.doc_type !== QUOTE_TYPE || doc.target_table !== QUOTE_TARGET_TABLE) {
    return bad('견적서 문서가 아닙니다.')
  }
  if (doc.target_id == null) return bad('견적을 찾을 수 없습니다.', 404)

  const { data: qRow, error: qErr } = await timer.step('quote', () => sb
    .from('quotes').select(REVIEW_QUOTE_SELECT).eq('quote_id', doc.target_id).maybeSingle())
  if (qErr) {
    console.error(`[${TAG}] quote lookup failed`, { documentId, quoteId: doc.target_id, error: qErr })
    return bad('견적을 불러오지 못했습니다.', 500)
  }
  const quote = (qRow ?? null) as (RawQuote & { engineer_id: number | null; created_by: number | null }) | null
  if (!quote) return bad('견적을 찾을 수 없습니다.', 404)

  // 품목·부대비용·업체 이름·사람 이름을 나란히 읽는다(서로의 결과가 필요 없다).
  // 업체는 고객사·대리점을 **한 번의 .in 조회**로 묶어 읽는다(partyNamesOf) — 따로 부르면
  // 「자기 행 → 부모 행」이 두 벌이라 왕복이 그만큼 늘어난다.
  const [itemsRes, expRes, parties, people] = await Promise.all([
    timer.step('items', () => sb.from('quote_items')
      .select('item_id, row_kind, part_code, product_name, quantity, unit_price_jpy, unit_price_krw, supply_amount, cost_amount, profit_amount, profit_rate, exchange_rate, tariff_rate')
      .eq('quote_id', quote.quote_id)),
    timer.step('expenses', () => sb.from('quote_expenses')
      .select('expense_id, item_name, unit_price, headcount, days, amount')
      .eq('quote_id', quote.quote_id)),
    timer.step('parties', () => partyNamesOf(sb, [quote.customer_id, quote.dealer_id])),
    timer.step('engineers', async () => {
      const ids = [quote.engineer_id, quote.created_by].filter((n): n is number => n != null)
      if (ids.length === 0) return new Map<number, string | null>()
      const { data, error } = await sb.from('engineers').select('engineer_id, name').in('engineer_id', ids)
      if (error) console.error(`[${TAG}] engineer lookup failed`, { quoteId: quote.quote_id, error })
      const m = new Map<number, string | null>()
      for (const e of (data ?? []) as { engineer_id: number; name: string | null }[]) m.set(e.engineer_id, e.name)
      return m
    }),
  ])
  const custName = partyOf(parties, quote.customer_id)
  const dealerName = partyOf(parties, quote.dealer_id)
  if (itemsRes.error) console.error(`[${TAG}] items lookup failed`, { quoteId: quote.quote_id, error: itemsRes.error })
  if (expRes.error) console.error(`[${TAG}] expenses lookup failed`, { quoteId: quote.quote_id, error: expRes.error })

  const reviewData = buildQuoteReview({
    quote,
    items: (itemsRes.data ?? []) as RawItem[],
    expenses: (expRes.data ?? []) as RawExpense[],
    customer: custName,
    dealer: dealerName,
    engineer: quote.engineer_id != null ? (people.get(quote.engineer_id) ?? null) : null,
    createdBy: quote.created_by != null ? (people.get(quote.created_by) ?? null) : null,
    // 조회가 실패했으면 화면이 「빈 표」가 아니라 「못 읽었다」를 그리게 알린다.
    // 검토 전체를 500 으로 막지 않는 이유 — 합계·거래 구분만으로도 판단에 쓸 값이 있고,
    // 품목만 다시 불러오면 되므로 그 자리에 「다시 시도」를 둔다.
    itemsOk: !itemsRes.error,
    expensesOk: !expRes.error,
  })

  // quoteId 를 함께 준다 — 검토표의 「견적서 PDF 보기」가 그 견적으로 PDF 를 만든다.
  // Server-Timing 은 **본문을 바꾸지 않는다** — 헤더에만 단계별 ms 가 실린다.
  return NextResponse.json(
    { review: reviewData, quoteId: quote.quote_id },
    { headers: { 'Server-Timing': timer.header() } },
  )
}

// ── 견적서 PDF 생성용 저장값 ────────────────────────────────────────
//
// 결재 대상 견적서는 **저장된 파일을 열지 않는다**(확정 때 만든 파일에는 승인일이 없다).
// 화면이 이 액션으로 저장값을 받아 그 자리에서 PDF 를 만든다(lib/quotePdfData.ts).
//
// 돌려주는 것은 **PDF 에 찍히는 값만**이다 — 원가·이익은 PDF 에 나가지 않으므로 담지 않는다
// (검토표 'review' 와 다른 점이다. 그쪽은 결재자가 판단할 재료라 원가·이익을 담는다).

/** PDF 가 읽는 칸만. 원가·이익(total_cost·total_profit·cost_amount …)은 넣지 않는다. */
const PDF_QUOTE_SELECT = `
  quote_id, quote_number, quote_date, created_at, status, recipient, note, delivery_info,
  total_supply, total_tax, total_amount,
  customer_id, dealer_id, engineer_id, created_by
`

/**
 * 그 견적의 PDF 를 열 수 있는가 — **두 길 가운데 하나**면 된다.
 *   ① 견적 열람 권한 — /api/quote-pdf 와 같은 기준(견적 메뉴 + 영업관리이거나 실적 담당자 본인)
 *   ② 결재 문서 열람 권한 — 그 견적의 결재 문서를 볼 수 있는 사람(상신자·결재선 전원·관리자)
 * 결재선에 들어온 다른 팀 사람은 ① 을 통과하지 못하므로 ② 가 필요하다.
 * 조회가 실패하면 **거짓**(fail-closed).
 */
async function canOpenQuotePdf(
  sb: SupabaseClient,
  caller: Caller,
  quote: { quote_id: number; engineer_id: number | null },
): Promise<boolean> {
  // ① 견적 열람 권한. canViewSalesMgmt 는 /api/quote-pdf 와 같은 함수를 쓴다.
  if (canViewMenu(caller, 'quote') && (canViewSalesMgmt(caller) || quote.engineer_id === caller.engineer_id)) {
    return true
  }
  // ② 그 견적의 결재 문서를 볼 수 있는가.
  const { data, error } = await sb
    .from('approval_documents')
    .select('document_id, requester_id')
    .eq('doc_type', QUOTE_TYPE)
    .eq('target_table', QUOTE_TARGET_TABLE)
    .eq('target_id', quote.quote_id)
  if (error) {
    console.error(`[${TAG}] pdf 권한용 문서 조회 실패`, { quoteId: quote.quote_id, error })
    return false
  }
  for (const d of (data ?? []) as { document_id: number; requester_id: number }[]) {
    if (await canViewApprovalDocument(sb, d, caller)) return true
  }
  return false
}

async function pdfData(sb: SupabaseClient, caller: Caller, body: Record<string, unknown>) {
  const quoteId = Number(body?.quote_id)
  if (!Number.isSafeInteger(quoteId) || quoteId <= 0) return bad('견적을 지정해주세요.')

  const { data: qRow, error: qErr } = await sb
    .from('quotes').select(PDF_QUOTE_SELECT).eq('quote_id', quoteId).maybeSingle()
  if (qErr) {
    console.error(`[${TAG}] pdf quote lookup failed`, { quoteId, error: qErr })
    return bad('견적을 불러오지 못했습니다.', 500)
  }
  const quote = (qRow ?? null) as (PdfQuoteRow & {
    quote_id: number; created_at: string | null; status: string | null
    customer_id: number | null; dealer_id: number | null
    engineer_id: number | null; created_by: number | null
    delivery_info: string | null
  }) | null
  if (!quote) return bad('견적을 찾을 수 없습니다.', 404)

  if (!(await canOpenQuotePdf(sb, caller, quote))) {
    console.warn(`[${TAG}] pdf-data 권한 없음`, { quoteId, callerId: caller.engineer_id })
    return bad('이 견적서를 볼 권한이 없습니다.', 403)
  }

  // 결재 도입 전 견적은 **저장된 파일이 정본**이다 — 여기서 만들지 않는다.
  // 화면은 이 400 을 보고 저장 PDF 경로로 간다(gate 를 이미 알면 애초에 부르지 않는다).
  if (!isApprovalTarget(quote.created_at)) {
    return bad('결재 도입 전 견적은 저장된 PDF 를 사용합니다')
  }

  // 완료 시각·품목·수신처·담당자. 서로의 결과가 필요 없어 **전부** 나란히 보낸다.
  // 업체는 'review' 와 같은 함수로 고객사·대리점을 한 번의 .in 조회에 묶는다(partyNamesOf).
  const [doneRes, itemsRes, parties, people] = await Promise.all([
    // 완료된 결재 문서의 완료 시각. 없으면 null → 날짜 자리에 「결재 완료 시 …」가 들어간다.
    // completed_at 은 '완료' 인 문서에 반드시 있다(approval_schema.sql 의 ad_completed_fields).
    sb.from('approval_documents')
      .select('completed_at')
      .eq('doc_type', QUOTE_TYPE)
      .eq('target_table', QUOTE_TARGET_TABLE)
      .eq('target_id', quoteId)
      .eq('status', '완료')
      .order('completed_at', { ascending: false })
      .limit(1),
    sb.from('quote_items')
      .select('item_id, row_kind, part_code, product_name, quantity, unit_price_krw, supply_amount, tax_amount')
      .eq('quote_id', quoteId),
    partyNamesOf(sb, [quote.customer_id, quote.dealer_id]),
    (async () => {
      const ids = [quote.engineer_id].filter((n): n is number => n != null)
      if (ids.length === 0) return null
      const { data, error } = await sb
        .from('engineers').select('engineer_id, name, position, tel').in('engineer_id', ids)
      if (error) console.error(`[${TAG}] pdf engineer lookup failed`, { quoteId, error })
      return ((data ?? [])[0] ?? null) as { name: string | null; position: string | null; tel: string | null } | null
    })(),
  ])
  // 오류를 보는 순서는 종전과 같다 — 결재 상태를 못 읽은 쪽이 먼저다.
  if (doneRes.error) {
    console.error(`[${TAG}] pdf 완료 문서 조회 실패`, { quoteId, error: doneRes.error })
    return bad('결재 상태를 확인하지 못했습니다.', 500)
  }
  const approvedAt = (doneRes.data?.[0] as { completed_at: string | null } | undefined)?.completed_at ?? null
  const custName = partyOf(parties, quote.customer_id)
  const dealerName = partyOf(parties, quote.dealer_id)
  if (itemsRes.error) {
    // 품목이 빠진 견적서를 내보내지 않는다 — 금액은 맞는데 품목이 비면 문서가 틀린 것이다.
    console.error(`[${TAG}] pdf items lookup failed`, { quoteId, error: itemsRes.error })
    return bad('품목을 불러오지 못했습니다.', 500)
  }

  // 수신처 「○○ 귀하」 — 확정 때와 같은 규칙이다. 대리점 건이면 대리점(청구처)이 수신처이고,
  // 회사 아래 사업장이면 회사 이름이 찍힌다(lib/quoteEuName.ts).
  const billTo = quote.dealer_id != null ? dealerName : custName
  const company = euDisplayName({ siteName: billTo?.site ?? null, parentName: billTo?.parent ?? null })

  // 담당자 줄 — 실적 담당자의 「이름 직급」과 전화번호(확정 흐름의 engineerName·engineerTel 과 같다).
  const engineerName = [people?.name, people?.position].filter(Boolean).join(' ')

  return NextResponse.json({
    pdf: {
      quote: {
        quote_number: quote.quote_number,
        recipient: quote.recipient,
        note: quote.note,
        total_supply: quote.total_supply,
        total_tax: quote.total_tax,
        total_amount: quote.total_amount,
      },
      items: itemsRes.data ?? [],
      company,
      engineerName,
      engineerTel: people?.tel ?? null,
      approvedAt,
    },
    // 열람 기록·파일 이름에 쓰는 값(화면이 download_logs 에 남긴다).
    meta: {
      quoteId: quote.quote_id,
      quoteNumber: quote.quote_number,
      customerName: euDisplayName({ siteName: custName?.site ?? null, parentName: custName?.parent ?? null }) || null,
      deliveryInfo: quote.delivery_info,
    },
  })
}

export async function POST(req: NextRequest) {
  const timer = makeTimer()
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return bad('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const action: string = typeof body?.action === 'string' ? body.action : ''
  if (action !== 'check' && action !== 'submit' && action !== 'gates'
    && action !== 'review' && action !== 'pdf-data') {
    return bad('Invalid action')
  }

  // 팀 권한은 engineers 조회와 **서로의 결과가 필요하지 않다**(팀 × 메뉴 표를 통째로 읽는다).
  // 그래서 engineers 를 기다리지 않고 먼저 띄워 둔다 — 왕복 한 겹이 줄어든다.
  // 'gates' 는 팀 권한을 보지 않으므로 그 액션에서는 띄우지 않는다(그 액션이 괜히 느려지지 않게).
  // 실패는 loadTeamPerms 가 이미 「빈 맵」으로 돌려준다(= 전원 권한 없음). catch 는 그 자리에서
  // 띄워 둔 promise 가 처리되지 않은 거부로 남지 않게 하는 것이고, 값은 같다.
  const permsPromise = action === 'gates'
    ? null
    : timer.step('perm', () => loadTeamPerms({ fresh: true }).catch(e => {
      console.error(`[${TAG}] team perms load failed`, e)
      return new Map<string, TeamPerm>()
    }))

  // 세션 → engineers. 퇴사자는 막는다(결재 라우트의 loadCaller 와 같은 기준).
  const { data: callerRow, error: callerErr } = await timer.step('auth', () => supabase
    .from('engineers')
    .select('engineer_id, name, permission_level, teams, resigned_date')
    .eq('email', user.email!)
    .single())
  if (callerErr) console.error(`[${TAG}] caller lookup failed`, { email: user.email, error: callerErr })
  const row = (callerRow ?? null) as (Caller & { resigned_date: string | null }) | null
  if (!row || row.resigned_date) return bad('Forbidden', 403)

  const sb = admin()

  // ── 승인 게이트 조회 — 부작용 없음 ──
  // 목록 화면이 행마다 「발주서 등록·계산서 요청·PDF 열기」를 보여 줄지 정하는 데 쓴다.
  // **견적 작성 권한을 요구하지 않는다** — 실적 현황·발주 화면처럼 견적 메뉴가 없는 팀도
  // 목록을 보고, 그 화면에서 버튼이 어긋나면 눌러서 409 를 받는다. 내보내는 것은 게이트 값
  // 하나뿐이라(문서 내용·결재선·반려 사유 없음) 로그인한 재직자면 충분하다.
  if (action === 'gates') {
    const ids = readQuoteIds(body?.quote_ids)
    if (ids === null) return bad('견적 목록을 보내주세요.')
    if (ids.length === 0) return NextResponse.json({ gates: {} })
    const res = await loadQuoteGates(sb, ids)
    if (!res.ok) return bad(res.error, 500)
    // 상태·생성 시각은 내보내지 않는다 — 화면이 쓸 것은 게이트 하나다.
    const gates: Record<string, string> = {}
    for (const [id, row] of res.gates) gates[String(id)] = row.gate
    return NextResponse.json({ gates })
  }

  // 견적을 상신하는 라우트다. 권한을 거둔 직후에도 통과하면 곤란해 캐시를 건너뛴다
  // (견적 삭제 요청 라우트와 같은 판단 — 위에서 fresh: true 로 띄워 둔 그 promise 다).
  const caller = permsPromise ? attachTeamPerm(await permsPromise, row as Caller) : null
  if (!caller) return bad('Forbidden', 403)

  // ── 견적 검토표 — 읽기 전용 ──
  // **견적 작성 권한을 요구하지 않는다.** 다른 팀 결재자·참조자가 결재선에 들어올 수 있고,
  // 그 사람에게 견적 메뉴가 없어도 자기가 결재할 문서는 봐야 한다. 대신 **그 문서를 볼 수 있는
  // 사람인지**를 아래에서 따로 본다(canViewApprovalDocument).
  if (action === 'review') {
    return review(sb, caller, body, timer)
  }

  // ── 견적서 PDF 생성용 저장값 — 읽기 전용 ──
  // 여기도 견적 작성 권한을 요구하지 않는다. 권한은 pdfData 안에서 **두 길 가운데 하나**로 본다
  // (견적 열람 권한 또는 그 견적의 결재 문서 열람 권한 — canOpenQuotePdf).
  if (action === 'pdf-data') {
    return pdfData(sb, caller, body)
  }

  if (!canViewMenu(caller, 'quote')) return bad('견적 작성 권한이 없습니다.', 403)

  const lines = readLines(body?.lines)
  if (!lines) return bad('결재선을 지정해주세요.')

  // ── 결재선만 검사 — 부작용 없음 ──
  // 확정(번호 발급) 전에 부른다. 종류별 규칙(관리자 결재자 1명 이상)까지 여기서 걸린다.
  const lineProblem = await checkLines(sb, lines, caller.engineer_id, QUOTE_TYPE)
  if (lineProblem) return bad(lineProblem)
  if (action === 'check') return NextResponse.json({ ok: true })

  // ── 상신 ──
  const quoteId = Number(body?.quote_id)
  if (!Number.isInteger(quoteId) || quoteId <= 0) return bad('견적을 지정해주세요.')

  const { data: found, error: readErr } = await sb
    .from('quotes').select(QUOTE_SELECT).eq('quote_id', quoteId).maybeSingle()
  if (readErr) {
    console.error(`[${TAG}] quote lookup failed`, { quoteId, error: readErr })
    return bad('견적을 불러오지 못했습니다.', 500)
  }
  const quote = (found ?? null) as QuoteRow | null
  if (!quote) return bad('견적을 찾을 수 없습니다.', 404)

  // 상신은 **쓴 사람**만 한다. 대필 견적이면 실적 담당자(engineer_id)가 아니라 작성자다 —
  // 실적을 받은 쪽은 견적서를 만들지 않았으므로 무엇을 올리는지 판단할 수 없다.
  // created_by 가 빈 옛 데이터는 결재 도입 전 견적이라 아래 isApprovalTarget 에서 걸린다.
  if (quote.created_by == null || quote.created_by !== caller.engineer_id) {
    return bad('견적을 작성한 사람만 결재를 올릴 수 있습니다.', 403)
  }

  // 도입 경계는 **생성 시각**으로 본다(견적일은 사람이 과거로 정할 수 있다 — quoteStatus.ts 설명).
  if (!isApprovalTarget(quote.created_at)) {
    return bad('결재 도입 전에 만든 견적은 결재 대상이 아닙니다.')
  }

  const before = quote.status
  if (!(APPROVABLE_STATUSES as readonly string[]).includes(before)) {
    return bad(`지금은 결재를 올릴 수 없는 상태입니다 (${before})`, 409)
  }

  // 같은 견적으로 만들어진 문서가 **어떤 상태로든** 있으면 올리지 않는다.
  // 진행중만 보면 반려·회수·폐기된 문서가 있는 견적을 다시 올릴 수 있게 되는데, 견적서는
  // 재상신을 막아 둔 유형이라(docTypes.ts 의 canResubmit) 내용을 고쳐 새로 쓰는 것이 정해진 길이다.
  const { data: existing, error: docErr } = await sb
    .from('approval_documents')
    .select('document_id, status')
    .eq('doc_type', QUOTE_TYPE)
    .eq('target_table', QUOTE_TARGET_TABLE)
    .eq('target_id', quoteId)
    .limit(1)
  if (docErr) {
    console.error(`[${TAG}] document lookup failed`, { quoteId, error: docErr })
    return bad('진행 중인 결재를 확인하지 못했습니다.', 500)
  }
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: '이미 결재 문서가 있는 견적입니다. 고쳐 쓰기로 새로 작성해 주세요', documentId: existing[0].document_id },
      { status: 409 },
    )
  }

  // 요약은 상태를 바꾸기 **전에** 만든다 — restore_status 가 상신 직전 상태여야 한다.
  const summary = await buildQuoteSummary(sb, quote)

  // 상태를 '결재중' 으로. 조건부 UPDATE 라 그사이 남이 손댔으면 0행이 된다.
  const { data: locked, error: lockErr } = await sb
    .from('quotes')
    .update({ status: SUBMITTED_STATUS })
    .eq('quote_id', quoteId)
    .eq('status', before)
    .select('quote_id')
  if (lockErr) {
    console.error(`[${TAG}] status lock failed`, { quoteId, before, error: lockErr })
    return bad('견적 상태를 바꾸지 못했습니다.', 500)
  }
  if (!locked || locked.length === 0) {
    return bad('견적 상태가 바뀌어 결재를 올리지 못했습니다. 목록을 새로 읽어 주세요.', 409)
  }

  const made = await createApprovalDocument(sb, {
    docType: QUOTE_TYPE,
    // 문서번호는 원 문서 번호를 따른다(설계서 — 견적은 견적번호).
    docNo: quote.quote_number ?? String(quoteId),
    title: `견적서 — ${quote.quote_number ?? quoteId}`,
    summary: summary as unknown as Record<string, unknown>,
    targetTable: QUOTE_TARGET_TABLE,
    targetId: quoteId,
    lines,
    // 상신자는 작성자다. 위에서 caller 와 같다는 것을 확인했다.
    requesterId: quote.created_by,
    today: todayKST(),
  })

  if (!made.ok) {
    // 문서가 없으면 견적이 '결재중' 에 갇힌다 — 직전 상태로 되돌린다.
    const { data: back, error: undoErr } = await sb
      .from('quotes')
      .update({ status: before })
      .eq('quote_id', quoteId)
      .eq('status', SUBMITTED_STATUS)
      .select('quote_id')
    if (undoErr || !back || back.length === 0) {
      console.error(`[${TAG}] 상신 실패 후 상태 복원 실패 — 견적이 '결재중' 에 남았다`, { quoteId, before, error: undoErr })
      return NextResponse.json(
        { error: `${made.error} 견적이 「결재중」에 남았습니다. 관리자에게 알려주세요.` },
        { status: made.status },
      )
    }
    return NextResponse.json({ error: made.error }, { status: made.status })
  }

  // 누가 올렸는지 한 줄. service role 로 상태를 바꿨으므로 quotes 의 감사 트리거에는
  // 행위자가 남지 않는다(이 파일 머리말). best-effort 다 — 기록이 실패해도 상신은 이미 끝났다.
  const { error: auditErr } = await sb.from('audit_log').insert({
    actor_email: user.email ?? null,
    action: AUDIT_ACTION_SUBMIT,
    table_name: QUOTE_TARGET_TABLE,
    row_id: String(quoteId),
    old_data: { status: before },
    new_data: {
      status: SUBMITTED_STATUS,
      approval_document_id: made.documentId,
      quote_number: quote.quote_number,
      submitted_by: caller.engineer_id,
    },
  })
  if (auditErr) console.error(`[${TAG}] audit insert failed`, { quoteId, error: auditErr })

  console.log(`[${TAG}] 상신 완료`, { quoteId, documentId: made.documentId, before })
  return NextResponse.json({ ok: true, documentId: made.documentId, notified: made.notified })
}
