// 미수주(실패) 견적을 **「견적중」으로 되돌린다** (2026-11-25).
//
// ── 누가 ─────────────────────────────────────────────────────────────────
//   **관리 메뉴를 가진 사람(+ superadmin)만.** 화면이 단추를 숨기는 것과 같은 판정을
//   여기서 **다시** 센다(lib/quoteRevive 의 canReviveQuote 한 함수다).
//   이 저장소에 'admin' 등급은 없다 — 「admin 이상」은 관리 메뉴 권한으로 읽는다.
//
// ── 무엇을 쓰나 ──────────────────────────────────────────────────────────
//   status='견적중' · fail_reason=null · revived_at=now() · revived_by · revive_reason
//   그리고 note 끝에 「[되돌림 yy-mm-dd 이름: 사유]」 한 줄(견적 사건 표가 없다).
//
// ── 왜 날짜를 적나 ───────────────────────────────────────────────────────
//   만료 기준일이 coalesce(revived_at, quote_date) 로 바뀐다 — 되돌린 날부터 다시
//   1개월이다. 적지 않으면 자동 실주가 **다음 날 또** 실패로 돌린다.
//
// ── 표에 칸이 없을 때 ────────────────────────────────────────────────────
//   503 으로 무엇을 돌려야 하는지 말해 준다. 상태만 바꿔 두면 다시 실패가 되므로
//   **아무것도 쓰지 않는다**(반쪽짜리 되돌리기를 만들지 않는다).

import { NextResponse } from 'next/server'
import { adminClient, loadCaller } from '@/lib/apiCaller'
import { writeAdminEvent } from '@/lib/adminEvents'
import { FAIL_STATUS } from '@/lib/quoteStatus'
import {
  REVIVED_STATUS, REASON_MAX, SCHEMA_MESSAGE, appendNote, canReviveQuote,
  reviveBlockedReason, reviveNoteLine,
} from '@/lib/quoteRevive'

const supabaseAdmin = adminClient()
const TAG = 'quote-revive'
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 그 오류가 「칸이 아직 없다」인가. */
const missing = (err: { code?: string | null } | null) =>
  err != null && (err.code === '42703' || err.code === 'PGRST204' || err.code === 'PGRST205')

export async function POST(req: Request) {
  // 관리 메뉴 — canViewMenu(caller, 'admin') 과 같은 판정이다(superadmin 은 늘 통과).
  const { error: authErr, caller } = await loadCaller(
    { kind: 'menu', keys: ['admin'] }, { tag: TAG, req, method: 'POST' },
  )
  if (authErr) return authErr

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('요청을 읽지 못했습니다')

  const quoteId = Number(body.quote_id)
  if (!Number.isInteger(quoteId) || quoteId <= 0) return bad('견적을 찾지 못했습니다')

  const reason = String(body.reason ?? '').trim().slice(0, REASON_MAX)
  const blocked = reviveBlockedReason(reason)
  if (blocked) return bad(blocked)

  // 지금 값을 읽어 **다시 판정한다** — 화면이 보낸 상태를 믿지 않는다.
  // 되돌리기 칸이 아직 없는 DB 에서는 여기서 42703 이 난다(select 가 그 칸을 읽는다).
  const { data: quote, error: readErr } = await supabaseAdmin
    .from('quotes')
    .select('quote_id, quote_number, status, fail_reason, quote_date, note, backfilled_at, revived_at')
    .eq('quote_id', quoteId)
    .maybeSingle()
  if (readErr) {
    if (missing(readErr)) return NextResponse.json({ error: SCHEMA_MESSAGE }, { status: 503 })
    console.error(`[${TAG}] read failed`, readErr)
    return NextResponse.json({ error: '견적을 읽지 못했습니다' }, { status: 500 })
  }
  if (!quote) return bad('견적을 찾지 못했습니다', 404)

  if (!canReviveQuote(caller, quote)) {
    console.warn(`[${TAG}] 되돌릴 수 없는 요청`, {
      quoteId, status: quote.status, backfilled: !!quote.backfilled_at, by: caller.email,
    })
    // 상태가 아니라 **권한**이 막은 경우를 가려 403 을 준다(화면이 글을 달리 띄운다).
    const mine = quote.status === FAIL_STATUS && !quote.backfilled_at
    return mine
      ? NextResponse.json({ error: '견적을 되돌릴 권한이 없습니다' }, { status: 403 })
      : bad('이 견적은 되돌릴 수 없습니다')
  }

  const now = new Date().toISOString()
  const { error: upErr } = await supabaseAdmin
    .from('quotes')
    .update({
      status: REVIVED_STATUS,
      fail_reason: null,
      revived_at: now,
      revived_by: caller.engineer_id,
      revive_reason: reason,
      // 사건 표가 없어 사람이 읽는 칸에도 한 줄 남긴다.
      note: appendNote(quote.note, reviveNoteLine(now, caller.name, reason)),
    })
    .eq('quote_id', quoteId)
    // 그사이 누군가 상태를 바꿨으면 건드리지 않는다(조건부 UPDATE).
    .eq('status', FAIL_STATUS)
  if (upErr) {
    if (missing(upErr)) return NextResponse.json({ error: SCHEMA_MESSAGE }, { status: 503 })
    console.error(`[${TAG}] update failed`, { quoteId, code: upErr.code })
    return NextResponse.json({ error: '되돌리지 못했습니다' }, { status: 500 })
  }

  // 관리자 기록표에 한 줄 (2026-11-27 야간3 4).
  await writeAdminEvent(supabaseAdmin, {
    actorId: caller.engineer_id, action: 'quote_revived',
    targetType: 'quote', targetId: quoteId,
    detail: { number: quote.quote_number, revived_at: now },
  })
  console.log(`[${TAG}] revived`, { quoteId, number: quote.quote_number, by: caller.email })
  return NextResponse.json({ ok: true, quote_id: quoteId, revived_at: now })
}
