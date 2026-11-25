// 명함 **검토 대기**를 다룬다 — 승인·건너뛰기·버리기 (2026-11-25).
//
// ── 왜 ───────────────────────────────────────────────────────────────────
//   여러 장 등록이 읽은 줄은 `status='draft'` 로 담긴다. 목록·검색·엑셀에 나오지 않고,
//   담당자가 쪽 이미지와 대조해 **승인**해야 `active` 가 된다.
//
// ── 무엇을 하나 ──────────────────────────────────────────────────────────
//   list     — 그 묶음(또는 본인)의 대기 줄을 읽는다. 검토 화면이 연다.
//   approve  — 고친 값을 저장하고 status 를 active 로. 사건 card_approved.
//   skip     — 그 draft 를 **지운다**(사건 card_skipped 를 먼저 남긴다).
//   discard  — 그 묶음의 대기 줄을 통째로 버린다(목록 띠의 「버리기」).
//
// ── 누가 ─────────────────────────────────────────────────────────────────
//   **제가 읽은 줄만** 만진다(engineer_id). 남의 검토 대기에는 손대지 않는다 —
//   화면이 보낸 id 를 믿지 않고 라우트가 다시 읽어 확인한다.
//
// ── 표가 아직 없을 때 ────────────────────────────────────────────────────
//   status 칸이 없으면(db/business_cards_draft_20261125.sql 전) 503 으로
//   **무엇을 돌려야 하는지** 말해 준다. 화면이 그 문구를 그대로 띄운다.

import { NextResponse } from 'next/server'
import { adminClient, loadCaller } from '@/lib/apiCaller'
import { isDivision } from '@/lib/division'
import { CARD_FIELDS, EN_FIELDS, FIELD_MAX, MEMO_MAX, cardBlockedReason } from '@/lib/businessCard'
import { isBatchId } from '@/lib/businessCardBulk'
import { EVENT_APPROVED, EVENT_SKIPPED, STATUS_ACTIVE, STATUS_DRAFT } from '@/lib/cardReview'

const supabaseAdmin = adminClient()
const TAG = 'cards-import'
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

export const SCHEMA_MESSAGE =
  '검토 대기를 쓰려면 db/business_cards_draft_20261125.sql 을 먼저 적용해야 합니다'

/** 그 오류가 「status 칸이 아직 없다」인가. */
const missingStatus = (err: { code?: string | null } | null) =>
  err != null && (err.code === '42703' || err.code === 'PGRST204' || err.code === 'PGRST205')

/** 영문 칸이 표에 있나 — 없으면 빼고 쓴다. */
let enKnown: boolean | null = null
async function hasEn(): Promise<boolean> {
  if (enKnown != null) return enKnown
  const { error } = await supabaseAdmin.from('business_cards').select('name_en').limit(1)
  enKnown = !missingStatus(error)
  return enKnown
}

/** 화면이 보낸 값 중 **표의 칸만**, 길이를 맞춰서. */
async function pickFields(patch: unknown): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  if (!patch || typeof patch !== 'object') return out
  const en = await hasEn()
  for (const f of CARD_FIELDS) {
    if (!en && (EN_FIELDS as readonly string[]).includes(f)) continue
    const raw = (patch as Record<string, unknown>)[f]
    if (raw === undefined) continue
    const max = f === 'memo' ? MEMO_MAX : FIELD_MAX
    const s = String(raw ?? '').trim().slice(0, max)
    out[f] = s || null
  }
  return out
}

export async function POST(req: Request) {
  const { error: authErr, caller } = await loadCaller({ kind: 'login' }, { tag: TAG, req, method: 'POST' })
  if (authErr) return authErr

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('요청을 읽지 못했습니다')
  const action = String(body.action ?? '')

  /** 그 줄이 **내 검토 대기**인가 — 아니면 손대지 않는다. */
  const myDraft = async (cardId: number) => {
    const { data, error } = await supabaseAdmin
      .from('business_cards')
      .select('card_id, name, engineer_id, status, import_batch_id')
      .eq('card_id', cardId).maybeSingle()
    if (error) return { row: null, schema: missingStatus(error) }
    if (!data) return { row: null, schema: false }
    if (data.status !== STATUS_DRAFT) return { row: null, schema: false }
    if (Number(data.engineer_id ?? 0) !== Number(caller.engineer_id)) return { row: null, schema: false }
    return { row: data, schema: false }
  }

  /** 자국 한 줄. 실패해도 일을 되돌리지 않는다. */
  const logEvent = async (cardId: number, type: string, payload: Record<string, unknown>) => {
    const { error } = await supabaseAdmin.from('business_card_events').insert({
      card_id: cardId, event_type: type, occurred_at: new Date().toISOString(),
      actor_engineer_id: caller.engineer_id, payload,
    })
    if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
      console.error(`[${TAG}] 자국을 남기지 못했다`, { cardId, type, code: error.code })
    }
  }

  // ── 대기 줄 읽기 ───────────────────────────────────────────────────────
  if (action === 'list') {
    const batchId = String(body.import_batch_id ?? '')
    let q = supabaseAdmin
      .from('business_cards')
      .select('*')
      .eq('status', STATUS_DRAFT)
      .eq('engineer_id', caller.engineer_id)
      .is('deleted_at', null)
      .order('import_page', { ascending: true })
    if (isBatchId(batchId)) q = q.eq('import_batch_id', batchId)
    const { data, error } = await q
    if (error) {
      if (missingStatus(error)) return NextResponse.json({ error: SCHEMA_MESSAGE }, { status: 503 })
      console.error(`[${TAG}] list failed`, error)
      return NextResponse.json({ error: '검토 대기를 읽지 못했습니다' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, rows: data ?? [] })
  }

  // ── 승인 — 고친 값 + status=active ────────────────────────────────────
  if (action === 'approve') {
    const cardId = Number(body.card_id)
    if (!Number.isInteger(cardId) || cardId <= 0) return bad('명함을 찾지 못했습니다')
    const { row, schema } = await myDraft(cardId)
    if (schema) return NextResponse.json({ error: SCHEMA_MESSAGE }, { status: 503 })
    if (!row) return bad('내 검토 대기가 아닙니다', 403)

    const fields = await pickFields(body.patch)
    const name = fields.name ?? String(row.name ?? '')
    const blocked = cardBlockedReason({ name, memo: fields.memo ?? '' })
    if (blocked) return bad(blocked)

    const patch: Record<string, unknown> = { ...fields, status: STATUS_ACTIVE }
    if (isDivision(body.division)) patch.division = body.division
    const { error } = await supabaseAdmin.from('business_cards').update(patch).eq('card_id', cardId)
    if (error) {
      console.error(`[${TAG}] approve failed`, { cardId, code: error.code })
      return NextResponse.json({ error: '등록하지 못했습니다' }, { status: 500 })
    }
    await logEvent(cardId, EVENT_APPROVED, { name })
    return NextResponse.json({ ok: true, card_id: cardId })
  }

  // ── 남은 대기 전부 승인 — 읽힌 값 그대로 ──────────────────────────────
  if (action === 'approve_all') {
    const batchId = String(body.import_batch_id ?? '')
    if (!isBatchId(batchId)) return bad('가져오기 묶음을 찾지 못했습니다')
    const { data, error } = await supabaseAdmin
      .from('business_cards')
      .select('card_id, name')
      .eq('status', STATUS_DRAFT)
      .eq('import_batch_id', batchId)
      .eq('engineer_id', caller.engineer_id)
      .is('deleted_at', null)
    if (error) {
      if (missingStatus(error)) return NextResponse.json({ error: SCHEMA_MESSAGE }, { status: 503 })
      return NextResponse.json({ error: '검토 대기를 읽지 못했습니다' }, { status: 500 })
    }
    const ids = (data ?? []).map(r => r.card_id)
    if (ids.length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from('business_cards').update({ status: STATUS_ACTIVE }).in('card_id', ids)
      if (upErr) {
        console.error(`[${TAG}] approve_all failed`, { code: upErr.code })
        return NextResponse.json({ error: '등록하지 못했습니다' }, { status: 500 })
      }
      for (const r of data ?? []) await logEvent(r.card_id, EVENT_APPROVED, { name: r.name, how: 'all' })
    }
    console.log(`[${TAG}] approve_all`, { 건수: ids.length, by: caller.email })
    return NextResponse.json({ ok: true, approved: ids.length, card_ids: ids })
  }

  // ── 건너뛰기 — 그 draft 를 지운다 ─────────────────────────────────────
  if (action === 'skip') {
    const cardId = Number(body.card_id)
    if (!Number.isInteger(cardId) || cardId <= 0) return bad('명함을 찾지 못했습니다')
    const { row, schema } = await myDraft(cardId)
    if (schema) return NextResponse.json({ error: SCHEMA_MESSAGE }, { status: 503 })
    if (!row) return bad('내 검토 대기가 아닙니다', 403)

    // 자국을 **먼저** 남긴다 — 줄을 지우면 사건도 함께 사라진다(FK cascade).
    await logEvent(cardId, EVENT_SKIPPED, { name: row.name })
    const { error } = await supabaseAdmin.from('business_cards').delete().eq('card_id', cardId)
    if (error) {
      console.error(`[${TAG}] skip failed`, { cardId, code: error.code })
      return NextResponse.json({ error: '건너뛰지 못했습니다' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, card_id: cardId })
  }

  // ── 버리기 — 그 묶음의 대기 줄을 통째로 ───────────────────────────────
  if (action === 'discard') {
    const batchId = String(body.import_batch_id ?? '')
    if (!isBatchId(batchId)) return bad('가져오기 묶음을 찾지 못했습니다')
    const { data, error } = await supabaseAdmin
      .from('business_cards')
      .select('card_id')
      .eq('status', STATUS_DRAFT)
      .eq('import_batch_id', batchId)
      .eq('engineer_id', caller.engineer_id)
    if (error) {
      if (missingStatus(error)) return NextResponse.json({ error: SCHEMA_MESSAGE }, { status: 503 })
      return NextResponse.json({ error: '검토 대기를 읽지 못했습니다' }, { status: 500 })
    }
    const ids = (data ?? []).map(r => r.card_id)
    if (ids.length > 0) {
      const { error: delErr } = await supabaseAdmin.from('business_cards').delete().in('card_id', ids)
      if (delErr) {
        console.error(`[${TAG}] discard failed`, { code: delErr.code })
        return NextResponse.json({ error: '버리지 못했습니다' }, { status: 500 })
      }
    }
    console.log(`[${TAG}] discard`, { 건수: ids.length, by: caller.email })
    return NextResponse.json({ ok: true, discarded: ids.length })
  }

  return bad('무엇을 할지 알 수 없습니다')
}
