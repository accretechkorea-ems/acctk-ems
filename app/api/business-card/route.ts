// 명함 — 담고 · 고치고 · 확인하고 · 지운다 (2026-11-23).
//
// ── 누가 ─────────────────────────────────────────────────────────────────
//   담기·고치기·확인 — **로그인한 사람이면 된다.** 남이 등록한 명함도 고칠 수 있다.
//     받은 명함은 회사의 것이지 등록한 사람의 것이 아니다. 대신 **누가 무엇을 고쳤는지**
//     사건으로 남긴다(아래 logChange).
//   지우기 — **슈퍼관리자만**, 그리고 소프트다(deleted_at). 고객사와 같은 규칙이다.
//
// ── 쓰기는 여기서만 ──────────────────────────────────────────────────────
//   business_cards 에는 authenticated 쓰기 정책이 없다(db/business_cards_20261123.sql).
//   브라우저 열쇠로는 읽기만 된다 — 쓰는 길은 이 라우트 하나다.
//
// ── 사진은 받지 않는다 ───────────────────────────────────────────────────
//   이 라우트에 **파일을 받는 자리가 없다.** 명함 사진은 브라우저 메모리에서 글자만 뽑고
//   버린다. 개인정보를 모아 두지 않기 위해서다 — 남는 것은 사람이 확인한 글자뿐이다.
//   (scripts/business-card-check.js 가 그 사실을 계속 지킨다)
//
// ── 등록자 스냅샷 ────────────────────────────────────────────────────────
//   engineer_id 와 **그때의 이름·팀·사업부**를 함께 담는다. 전부 세션에서 만든다 —
//   화면이 보낸 값을 믿지 않는다.

import { NextResponse } from 'next/server'
import { adminClient, loadCaller } from '@/lib/apiCaller'
import { isDivision } from '@/lib/division'
import {
  CARD_FIELDS, EN_FIELDS, FIELD_MAX, MEMO_MAX, cardBlockedReason, isInputMethod, snapshotOf,
  type CardField,
} from '@/lib/businessCard'

const supabaseAdmin = adminClient()
const TAG = 'business-card'
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 표의 칸 — 화면이 보낸 것 중 이 이름만 담는다. */
const WRITABLE = new Set<string>(CARD_FIELDS)

/** 글자 칸을 다듬는다 — 빈 글자는 null 로(「빈 칸」이 ''와 null 둘로 갈리지 않게). */
function pickFields(patch: unknown): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  if (!patch || typeof patch !== 'object') return out
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!WRITABLE.has(k)) continue
    const max = k === 'memo' ? MEMO_MAX : FIELD_MAX
    const s = String(v ?? '').trim().slice(0, max)
    out[k] = s || null
  }
  return out
}

/**
 * 표에 **아직 없는 칸은 빼고** 담는다 (2026-11-23).
 *
 * 영문 둘(`name_en`·`company_en`)은 db/business_cards_en_20261123.sql 로 더하는데,
 * 그 SQL 은 사람이 돌린다. 돌리기 전에 그 칸을 같이 보내면 PostgREST 가
 * `PGRST204`(칸을 못 찾음)로 **담기 전체를 거절한다** — 영문 때문에 명함을 못 담는 일은
 * 없어야 한다. 그래서 한 번 물어보고(아래) 없으면 조용히 뺀다.
 *
 * 한 번만 물어본다 — 과정이 사는 동안 기억한다. SQL 을 돌린 뒤에는 배포(또는 재시작)로
 * 다시 물어본다. 틀려도 손해가 없는 쪽으로 기운다(모르면 **있다**고 보고, 실패하면 뺀다).
 */
let enColumnsKnown: boolean | null = null
async function hasEnColumns(): Promise<boolean> {
  if (enColumnsKnown != null) return enColumnsKnown
  const { error } = await supabaseAdmin.from('business_cards').select('name_en').limit(1)
  const missing = error != null && (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205')
  enColumnsKnown = !missing
  if (missing) {
    console.warn(`[${TAG}] 영문 칸이 아직 없다 — db/business_cards_en_20261123.sql 을 돌리기 전까지 빼고 담는다`)
  }
  return enColumnsKnown
}

/** 없는 칸을 뺀 사본. */
async function dropMissingColumns(fields: Record<string, string | null>) {
  if (await hasEnColumns()) return fields
  const out = { ...fields }
  for (const f of EN_FIELDS) delete out[f]
  return out
}

/** 무엇이 바뀌었나 — 사건에 담을 한 줄짜리 목록. */
function changesOf(before: Record<string, unknown>, patch: Record<string, string | null>) {
  const out: { field: string; before: string | null; after: string | null }[] = []
  for (const [k, after] of Object.entries(patch)) {
    const b = before[k] == null ? null : String(before[k])
    if ((b ?? '') === (after ?? '')) continue
    out.push({ field: k, before: b, after })
  }
  return out
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('요청을 읽지 못했습니다')
  const action = String(body.action ?? '')

  // 지우기·되돌리기만 슈퍼관리자다. 나머지는 로그인이면 된다.
  const needsAdmin = action === 'delete' || action === 'restore'
  const { error: authErr, caller } = needsAdmin
    ? await loadCaller({ kind: 'superadmin' }, { tag: TAG, req, method: 'POST' })
    : await loadCaller({ kind: 'login' }, { tag: TAG, req, method: 'POST' })
  if (authErr) return authErr

  const now = new Date().toISOString()

  /** 고친 자국 한 줄. 실패해도 일을 되돌리지 않는다 — 기록은 일을 막지 않는다. */
  const logChange = async (cardId: number, kind: string, payload: Record<string, unknown>) => {
    const { error } = await supabaseAdmin.from('business_card_events').insert({
      card_id: cardId, event_type: kind, occurred_at: now,
      actor_engineer_id: caller.engineer_id, payload,
    })
    // 사건 표가 아직 없을 수 있다(SQL 적용 전) — 그때는 조용히 넘어간다.
    if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
      console.error(`[${TAG}] 자국을 남기지 못했다`, { cardId, kind, error })
    }
  }

  // ── 담기 ───────────────────────────────────────────────────────────────
  if (action === 'create') {
    const fields = pickFields(body.patch)
    const blocked = cardBlockedReason({ name: fields.name ?? '', memo: fields.memo ?? '' })
    if (blocked) return bad(blocked)

    const division = isDivision(body.division) ? body.division : '계측'
    const method = isInputMethod(body.input_method) ? body.input_method : 'manual'
    const snap = snapshotOf(caller, division)

    const columns = await dropMissingColumns(fields)
    const put = (m: string) => supabaseAdmin
      .from('business_cards')
      .insert({ ...columns, division, input_method: m, registered_at: now, ...snap })
      .select('card_id')
      .single()

    let { data: made, error } = await put(method)
    /**
     * 방식 꼬리표가 표의 CHECK 에 아직 없을 수 있다 — 'contact' 를 더하는 SQL
     * (db/contacts_fields_20261125.sql)이 적용되기 전이다. 그때는 **담기는 쪽**을 고른다:
     * 'manual' 로 한 번 더 넣는다(명함은 담기고 꼬리표만 다르다).
     */
    if (error?.code === '23514' && method !== 'manual') {
      console.warn(`[${TAG}] input_method CHECK 에 '${method}' 가 없다 — manual 로 담는다`)
      const retry = await put('manual')
      made = retry.data
      error = retry.error
    }
    if (error || !made) {
      if (error?.code === '42P01' || error?.code === 'PGRST205') {
        return NextResponse.json({ error: SCHEMA_MESSAGE }, { status: 503 })
      }
      console.error(`[${TAG}] insert failed`, error)
      return NextResponse.json({ error: '명함을 담지 못했습니다' }, { status: 500 })
    }
    await logChange(Number(made.card_id), 'card_created', { name: fields.name, method })
    console.log(`[${TAG}] create`, { cardId: made.card_id, by: caller.email })
    return NextResponse.json({ ok: true, card_id: Number(made.card_id) })
  }

  const cardId = Number(body.card_id)
  if (!Number.isInteger(cardId) || cardId <= 0) return bad('명함을 찾지 못했습니다')

  const { data: before, error: readErr } = await supabaseAdmin
    .from('business_cards').select('*').eq('card_id', cardId).maybeSingle()
  if (readErr) {
    if (readErr.code === '42P01' || readErr.code === 'PGRST205') {
      return NextResponse.json({ error: SCHEMA_MESSAGE }, { status: 503 })
    }
    return NextResponse.json({ error: readErr.message }, { status: 500 })
  }
  if (!before) return bad('명함을 찾지 못했습니다')

  // ── 고치기 ─────────────────────────────────────────────────────────────
  if (action === 'update') {
    const fields = pickFields(body.patch)
    const name = fields.name ?? String(before.name ?? '')
    const memo = fields.memo ?? String(before.memo ?? '')
    const blocked = cardBlockedReason({ name, memo })
    if (blocked) return bad(blocked)

    const patch: Record<string, unknown> = { ...(await dropMissingColumns(fields)) }
    // 사업부는 폼에서 바꿀 수 있다. 등록일은 **보내도 무시한다**(트리거도 막는다).
    if (isDivision(body.division)) patch.division = body.division
    if (Object.keys(patch).length === 0) return bad('바꿀 값이 없습니다')

    const { error } = await supabaseAdmin.from('business_cards').update(patch).eq('card_id', cardId)
    if (error) {
      console.error(`[${TAG}] update failed`, { cardId, error })
      return NextResponse.json({ error: '명함을 고치지 못했습니다' }, { status: 500 })
    }
    const changes = changesOf(before as Record<string, unknown>, fields)
    await logChange(cardId, 'card_edited', { name, changes })
    return NextResponse.json({ ok: true, changed: changes.length })
  }

  // ── 지우기·되돌리기 — 슈퍼관리자. 소프트다 ────────────────────────────
  if (action === 'delete' || action === 'restore') {
    const del = action === 'delete'
    if (del && before.deleted_at) return bad('이미 지워진 명함입니다')
    if (!del && !before.deleted_at) return bad('지워진 명함이 아닙니다')
    const reason = String(body.reason ?? '').trim()
    if (del && !reason) return bad('지우는 까닭을 적어주세요')

    const { error } = await supabaseAdmin
      .from('business_cards').update({ deleted_at: del ? now : null }).eq('card_id', cardId)
    if (error) {
      console.error(`[${TAG}] ${action} failed`, { cardId, error })
      return NextResponse.json({ error: del ? '명함을 지우지 못했습니다' : '되돌리지 못했습니다' }, { status: 500 })
    }
    await logChange(cardId, del ? 'card_deleted' : 'card_restored', { name: before.name ?? null, reason: reason || null })
    console.log(`[${TAG}] ${action}`, { cardId, by: caller.email })
    return NextResponse.json({ ok: true })
  }

  return bad('모르는 작업입니다')
}

/** 표가 아직 없을 때. */
const SCHEMA_MESSAGE = '명함을 쓰려면 db/business_cards_20261123.sql 을 먼저 적용해야 합니다'

/** 칸 이름을 사람 말로 — 화면이 변경 기록을 그릴 때 쓴다. */
export type CardChange = { field: CardField; before: string | null; after: string | null }
