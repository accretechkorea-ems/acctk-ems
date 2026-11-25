// 명함 **여러 장 지우기** — 고른 줄, 또는 가져오기 묶음 통째로 (2026-11-25).
//
// ── 두 가지 지우기 ───────────────────────────────────────────────────────
//   ① 고른 줄(action 'cards')  — **소프트**다(deleted_at). 사건 'card_deleted' 가 남는다.
//      목록에서 사라지지만 줄과 자국은 그대로라, 잘못 지워도 되살릴 수 있다.
//   ② 묶음 되돌리기(action 'batch') — **진짜 지운다.** 방금 들어온 가져오기를 통째로
//      무르는 자리라 흔적을 남기지 않는 쪽이 맞다. 그 줄의 사건도 함께 사라진다
//      (FK 가 on delete cascade — db/business_cards_20261123.sql:127).
//      **이번 가져오기로 새로 담긴 줄만** 지운다 — 합쳐진 뒷면과 이미 있던 명함은
//      묶음 id 를 갖지 않으므로 손대지 않는다.
//
// ── 누가 ─────────────────────────────────────────────────────────────────
//   본인이 등록한 줄은 누구나, admin 이상은 전체(lib/businessCardBulk.ts canDeleteCard).
//   **화면이 보낸 목록을 믿지 않는다** — 받은 id 를 다시 읽어 한 줄씩 판정하고,
//   권한 밖인 줄은 조용히 빼고 그 수를 돌려준다(skipped).
//
// ── 왜 라우트인가 ────────────────────────────────────────────────────────
//   business_cards 에는 authenticated 쓰기 정책이 없다. 쓰는 길은 service role 뿐이다.

import { NextResponse } from 'next/server'
import { adminClient, loadCaller } from '@/lib/apiCaller'
import { EVENT_DELETED, canDeleteCard, isBatchId } from '@/lib/businessCardBulk'

const supabaseAdmin = adminClient()
const TAG = 'cards-delete'
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 한 번에 받는 수 — 화면의 전체 선택이 이보다 많으면 나눠 보낸다. */
const MAX_IDS = 500

export async function POST(req: Request) {
  const { error: authErr, caller } = await loadCaller({ kind: 'login' }, { tag: TAG, req, method: 'POST' })
  if (authErr) return authErr

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('요청을 읽지 못했습니다')
  const action = String(body.action ?? 'cards')

  // ── ② 묶음 되돌리기 ───────────────────────────────────────────────────
  if (action === 'batch') {
    const batchId = String(body.import_batch_id ?? '')
    if (!isBatchId(batchId)) return bad('가져오기 묶음을 찾지 못했습니다')

    const { data: rows, error: readErr } = await supabaseAdmin
      .from('business_cards')
      .select('card_id, name, engineer_id')
      .eq('import_batch_id', batchId)
      .is('deleted_at', null)
    if (readErr) {
      if (readErr.code === '42703') return bad('묶음 칸이 아직 없습니다 — db/business_cards_batch_20261125.sql 을 먼저 적용해 주세요', 503)
      console.error(`[${TAG}] batch read failed`, readErr)
      return NextResponse.json({ error: '묶음을 읽지 못했습니다' }, { status: 500 })
    }

    const mine = (rows ?? []).filter(r => canDeleteCard(caller, r))
    const skipped = (rows ?? []).length - mine.length
    const ids = mine.map(r => r.card_id)
    if (ids.length > 0) {
      const { error } = await supabaseAdmin.from('business_cards').delete().in('card_id', ids)
      if (error) {
        console.error(`[${TAG}] batch delete failed`, { code: error.code })
        return NextResponse.json({ error: '지우지 못했습니다' }, { status: 500 })
      }
    }
    console.log(`[${TAG}] batch`, { 지움: ids.length, 제외: skipped, by: caller.email })
    return NextResponse.json({ ok: true, deleted: ids.length, skipped })
  }

  // ── ① 고른 줄 ─────────────────────────────────────────────────────────
  const raw = Array.isArray(body.card_ids) ? body.card_ids : []
  const asked = [...new Set(raw.map(Number).filter(n => Number.isInteger(n) && n > 0))]
  if (asked.length === 0) return bad('지울 명함을 고르지 않았습니다')
  if (asked.length > MAX_IDS) return bad(`한 번에 ${MAX_IDS}건까지 지울 수 있습니다`)

  const { data: rows, error: readErr } = await supabaseAdmin
    .from('business_cards')
    .select('card_id, name, engineer_id')
    .in('card_id', asked)
    .is('deleted_at', null)
  if (readErr) {
    console.error(`[${TAG}] read failed`, readErr)
    return NextResponse.json({ error: '명함을 읽지 못했습니다' }, { status: 500 })
  }

  const mine = (rows ?? []).filter(r => canDeleteCard(caller, r))
  // 권한 밖 + 이미 지워졌거나 없는 줄 — 둘 다 「제외」로 센다.
  const skipped = asked.length - mine.length
  if (mine.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0, skipped })
  }

  const now = new Date().toISOString()
  const ids = mine.map(r => r.card_id)
  const { error } = await supabaseAdmin
    .from('business_cards').update({ deleted_at: now }).in('card_id', ids)
  if (error) {
    console.error(`[${TAG}] delete failed`, { code: error.code })
    return NextResponse.json({ error: '지우지 못했습니다' }, { status: 500 })
  }

  // 자국. 실패해도 지우기를 되돌리지 않는다.
  const events = mine.map(r => ({
    card_id: r.card_id, event_type: EVENT_DELETED, occurred_at: now,
    actor_engineer_id: caller.engineer_id, payload: { name: r.name, how: 'selected' },
  }))
  const { error: evErr } = await supabaseAdmin.from('business_card_events').insert(events)
  if (evErr && evErr.code !== '42P01' && evErr.code !== 'PGRST205') {
    console.error(`[${TAG}] 자국을 남기지 못했다`, { code: evErr.code })
  }

  console.log(`[${TAG}] delete`, { 지움: ids.length, 제외: skipped, by: caller.email })
  return NextResponse.json({ ok: true, deleted: ids.length, skipped })
}
