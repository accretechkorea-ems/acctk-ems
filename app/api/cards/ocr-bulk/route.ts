// 명함 **여러 장**을 한꺼번에 — 읽고 바로 담는다 (2026-11-24).
//
// ── 왜 ───────────────────────────────────────────────────────────────────
//   명함 스캐너가 **페이지당 한 장**인 PDF 를 만든다. 몇백 장을 한 번에 넣어야 한다.
//   화면이 페이지를 떼어 **세 개씩** 보내고, 이 라우트가 읽어서 바로 담는다.
//
// ── 왜 세 개인가 ─────────────────────────────────────────────────────────
//   Vercel 함수의 제한 시간 때문이다. 한 장에 3~6초가 걸리므로 셋을 **동시에**(Promise.all)
//   읽어도 한 요청이 그 범위 안에서 끝난다. 더 묶으면 한 요청이 통째로 죽고, 그 안의
//   성공분까지 함께 잃는다. 나눠 보내면 앞의 묶음은 이미 **담긴 뒤**다.
//
// ── 담을 때 ──────────────────────────────────────────────────────────────
//   input_method 는 'bulk'. 등록자는 **세션에서** 만든다 — 화면이 보낸 값을 믿지 않는다.
//
// ── 담지 않는 두 경우 ────────────────────────────────────────────────────
//   · 'dup'   — 읽힌 휴대폰 또는 이메일이 **살아 있는 줄**과 같다. 기존 card_id 를 함께 준다.
//   · 'empty' — 이름도 회사도 못 읽었다. 빈 줄을 쌓지 않는다.
//
// ── 사진·PDF 는 남기지 않는다 ────────────────────────────────────────────
//   메모리에서만 쓰고 버린다(lib/cardOcrServer.ts). 남기는 것은 토큰 수뿐이다.

import { NextResponse } from 'next/server'
import { adminClient, loadCaller } from '@/lib/apiCaller'
import { isDivision } from '@/lib/division'
import {
  CARD_FIELDS, EN_FIELDS, FIELD_MAX, digitsOf, snapshotOf,
} from '@/lib/businessCard'
import type { OcrKey } from '@/lib/businessCardOcr'
import { readCard } from '@/lib/cardOcrServer'
import {
  BULK_METHOD, EVENT_HANGUL, EVENT_MERGED, MAX_PER_REQUEST,
  canMergeBack, fillBlanks, hangulPatch, hasContact, isBatchId, isNoPerson, type BulkLine,
} from '@/lib/businessCardBulk'

const supabaseAdmin = adminClient()
const TAG = 'cards-ocr-bulk'

/** 담은 방식 — 이 라우트가 담는 줄은 늘 이렇다. */
const INPUT_METHOD = BULK_METHOD

type Line = BulkLine

/** 표에 담을 수 있는 칸만, 글자 길이를 맞춰서. */
function toRow(fields: Record<OcrKey, string>, enabled: boolean): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const f of CARD_FIELDS) {
    if (!enabled && (EN_FIELDS as readonly string[]).includes(f)) continue
    const v = String(fields[f as unknown as OcrKey] ?? '').trim().slice(0, FIELD_MAX)
    out[f] = v || null
  }
  return out
}

/** 그 칸이 아직 없다는 뜻인가. */
const missing = (err: { code?: string | null } | null) =>
  err != null && (err.code === '42703' || err.code === 'PGRST204' || err.code === 'PGRST205')

/** 영문 칸이 표에 있나 — db/business_cards_en_20261123.sql 을 아직 안 돌렸을 수 있다. */
let enColumnsKnown: boolean | null = null
async function hasEnColumns(): Promise<boolean> {
  if (enColumnsKnown != null) return enColumnsKnown
  const { error } = await supabaseAdmin.from('business_cards').select('name_en').limit(1)
  enColumnsKnown = !missing(error)
  return enColumnsKnown
}

/** 묶음 칸이 표에 있나 — db/business_cards_batch_20261125.sql 을 아직 안 돌렸을 수 있다. */
let batchColumnKnown: boolean | null = null
async function hasBatchColumn(): Promise<boolean> {
  if (batchColumnKnown != null) return batchColumnKnown
  const { error } = await supabaseAdmin.from('business_cards').select('import_batch_id').limit(1)
  batchColumnKnown = !missing(error)
  if (!batchColumnKnown) {
    console.warn(`[${TAG}] 묶음 칸이 아직 없다 — db/business_cards_batch_20261125.sql 전까지 되돌리기를 쓸 수 없다`)
  }
  return batchColumnKnown
}

export async function POST(req: Request) {
  const { error: authErr, caller } = await loadCaller({ kind: 'login' }, { tag: TAG, req, method: 'POST' })
  if (authErr) return authErr

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    console.error(`[${TAG}] ANTHROPIC_API_KEY 가 없다`)
    return NextResponse.json({ ok: false, reason: 'no_key' as const })
  }

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ ok: false, reason: 'no_file' as const }, { status: 400 })

  const files = form.getAll('files')
  if (files.length === 0) return NextResponse.json({ ok: false, reason: 'no_file' as const }, { status: 400 })
  if (files.length > MAX_PER_REQUEST) {
    return NextResponse.json(
      { ok: false, reason: 'too_many' as const, max: MAX_PER_REQUEST },
      { status: 413 },
    )
  }

  const division = isDivision(form.get('division')) ? String(form.get('division')) : '계측'
  const snap = snapshotOf(caller, division)
  const now = new Date().toISOString()
  const enabled = await hasEnColumns()

  /**
   * 이번 가져오기 묶음 — **새로 담는 줄에만** 적는다.
   * 합친 뒷면·이미 있던 명함에는 적지 않는다(되돌리기가 남의 줄을 지우지 않게).
   */
  /** 돌려서 다시 읽는 요청인가 — 담는 문턱이 한 단계 높다. */
  const isRetry = String(form.get('retry') ?? '') === '1'

  const rawBatch = String(form.get('import_batch_id') ?? '')
  const batchId = isBatchId(rawBatch) && await hasBatchColumn() ? rawBatch : null

  // ── 셋을 **동시에** 읽는다 ──
  const read = await Promise.all(files.map(f => readCard(f, key)))

  // ── 중복을 보려고 살아 있는 줄의 번호·메일을 한 번만 읽는다 ──
  const { data: existing } = await supabaseAdmin
    .from('business_cards').select('card_id, name, mobile, email').is('deleted_at', null)
  const byPhone = new Map<string, { card_id: number; name: string | null }>()
  const byMail = new Map<string, { card_id: number; name: string | null }>()
  for (const r of existing ?? []) {
    const d = digitsOf(r.mobile)
    if (d) byPhone.set(d, { card_id: r.card_id, name: r.name })
    const m = String(r.email ?? '').trim().toLowerCase()
    if (m) byMail.set(m, { card_id: r.card_id, name: r.name })
  }

  const lines: Line[] = []
  let usedIn = 0
  let usedOut = 0

  /** 직전 명함 — 같은 요청의 앞 쪽, 없으면 지난 요청이 넘겨준 prev_card_id. */
  let prevId: number | null = Number(form.get('prev_card_id')) || null
  /** 그 명함의 지금 값(합칠 때 빈 칸을 보려면 필요하다). */
  let prevRow: Record<string, unknown> | null = null
  if (prevId) {
    const { data } = await supabaseAdmin.from('business_cards').select('*').eq('card_id', prevId).maybeSingle()
    prevRow = data ?? null
    if (!prevRow) prevId = null
  }

  /** 담을 수 있는 칸 이름 — 영문 칸이 없는 DB 에서는 뺀다. */
  const WRITE_FIELDS = CARD_FIELDS.filter(f => enabled || !(EN_FIELDS as readonly string[]).includes(f))

  /** 사건 한 줄. 실패해도 일을 되돌리지 않는다. */
  const logEvent = async (cardId: number, type: string, payload: Record<string, unknown>) => {
    const { error } = await supabaseAdmin.from('business_card_events').insert({
      card_id: cardId, event_type: type, occurred_at: now,
      actor_engineer_id: caller.engineer_id, payload,
    })
    if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
      console.error(`[${TAG}] 자국을 남기지 못했다`, { cardId, type, code: error.code })
    }
  }

  /**
   * 기존 줄에 **빈 칸 채우기 + 한글 우선 교정**을 얹는다.
   * 바뀐 것이 없으면 쓰지 않는다 — 건드리지 않아도 될 줄을 쓰지 않는다.
   */
  const mergeInto = async (
    target: number, targetRow: Record<string, unknown>, row: Record<string, string | null>,
  ): Promise<Record<string, unknown>> => {
    const fill = fillBlanks(targetRow, row, WRITE_FIELDS)
    const fix = hangulPatch(targetRow as Parameters<typeof hangulPatch>[0], row)
    const patch = { ...fill, ...fix }
    if (Object.keys(patch).length === 0) return targetRow
    const { error } = await supabaseAdmin.from('business_cards').update(patch).eq('card_id', target)
    if (error) {
      console.error(`[${TAG}] 합치지 못했다`, { target, code: error.code })
      return targetRow
    }
    if (Object.keys(fill).length > 0) {
      await logEvent(target, EVENT_MERGED, { filled: Object.keys(fill) })
    }
    if (Object.keys(fix).length > 0) {
      await logEvent(target, EVENT_HANGUL, { fixed: Object.keys(fix) })
    }
    return { ...targetRow, ...patch }
  }

  // 담기는 **차례대로** 한다 — 쪽 순서가 곧 앞면·뒷면의 순서다.
  for (let i = 0; i < read.length; i++) {
    const got = read[i]
    usedIn += got.usage.input
    usedOut += got.usage.output
    const usage = got.usage
    // 쪽마다 얼마나 들었는지 — 값은 남기지 않고 숫자만.
    console.log(`[${TAG}] page`, { index: i, input: usage.input, output: usage.output })
    if (!got.ok) { lines.push({ index: i, ok: false, reason: got.reason, usage }); continue }

    const row = toRow(got.fields, enabled)
    if (!row.name && !row.company) {
      lines.push({ index: i, ok: false, reason: 'empty', usage, upside_down: got.upsideDown })
      continue
    }

    const phone = digitsOf(row.mobile)
    const mail = String(row.email ?? '').trim().toLowerCase()

    // ── ⓐ 사람이 없는 면(뒷면·이름 없음·이름이 회사명) ──
    if (isNoPerson(row, got.back)) {
      // 앞 명함의 뒷면일 때만 붙인다 — 사람 이름 없는 **남의 명함**이 붙으면
      // 전화·주소가 덮인다(2026-11-24 실측에서 부동산 사무실 면이 그렇게 붙었다).
      if (prevId && prevRow && canMergeBack(prevRow as Parameters<typeof canMergeBack>[0], row)) {
        prevRow = await mergeInto(prevId, prevRow, row)
        lines.push({ index: i, ok: false, reason: 'merged', card_id: prevId, merged_into: prevId, usage })
      } else {
        lines.push({
          index: i, ok: false, reason: 'no_person',
          name: row.company ?? row.name, usage, upside_down: got.upsideDown,
        })
      }
      continue
    }

    // 돌려서 **다시 읽은** 요청이면 문턱을 올린다 — 이름만 덩그러니 나온 쪽을 담지 않는다.
    if (isRetry && !hasContact(row)) {
      lines.push({ index: i, ok: false, reason: 'no_person', name: row.name ?? row.company, usage })
      continue
    }

    const hit = (phone && byPhone.get(phone)) || (mail && byMail.get(mail)) || null

    // ── ⓑ 직전 명함의 **다른 면** — 합치고 한글을 앞으로 ──
    if (hit && prevId && hit.card_id === prevId && prevRow) {
      prevRow = await mergeInto(prevId, prevRow, row)
      lines.push({ index: i, ok: false, reason: 'merged', card_id: prevId, merged_into: prevId, usage })
      continue
    }

    // ── ⓒ 직전이 아닌 기존 명함과 같다 — 중복. 한글 교정만 해 준다 ──
    if (hit) {
      const { data: old } = await supabaseAdmin
        .from('business_cards').select('*').eq('card_id', hit.card_id).maybeSingle()
      if (old) await mergeInto(hit.card_id, old as Record<string, unknown>, row)
      lines.push({ index: i, ok: false, reason: 'dup', card_id: hit.card_id, name: hit.name, usage })
      continue
    }

    // ── ⓓ 새 명함 ──
    const { data: made, error } = await supabaseAdmin
      .from('business_cards')
      .insert({
        ...row,
        division,
        input_method: INPUT_METHOD,
        registered_at: now,
        ...(batchId ? { import_batch_id: batchId } : {}),
        ...snap,
      })
      .select('card_id')
      .single()
    if (error || !made) {
      // 23514 = CHECK 제약. 표가 아직 'bulk' 를 모른다 — 무엇을 돌려야 하는지 따로 말해 준다.
      const why = error?.code === '23514' ? 'schema' : 'save'
      console.error(`[${TAG}] insert failed`, { index: i, code: error?.code, why })
      lines.push({ index: i, ok: false, reason: why, usage })
      continue
    }

    const cardId = Number(made.card_id)
    lines.push({ index: i, ok: true, card_id: cardId, usage })
    // 같은 묶음 안의 다음 장이 같은 명함이면 중복으로 걸리게 바로 넣는다.
    if (phone) byPhone.set(phone, { card_id: cardId, name: row.name })
    if (mail) byMail.set(mail, { card_id: cardId, name: row.name })
    // 이 쪽이 다음 쪽의 「직전 명함」이 된다 — 뒷면은 여기에 붙는다.
    prevId = cardId
    prevRow = { card_id: cardId, ...row }

    await logEvent(cardId, 'card_created', { name: row.name, method: INPUT_METHOD })
  }

  const count = (r: string) => lines.filter(l => !l.ok && l.reason === r).length
  // 남기는 것은 숫자뿐이다 — 파일도, 읽은 값도 적지 않는다.
  console.log(`[${TAG}] done`, {
    받음: files.length, 담음: lines.filter(l => l.ok).length,
    중복: count('dup'), 뒷면합침: count('merged'), 사람없음: count('no_person'),
    input: usedIn, output: usedOut,
  })

  return NextResponse.json({
    ok: true,
    lines,
    usage: { input: usedIn, output: usedOut },
    // 다음 요청이 prev_card_id 로 되돌려 보낸다 — 묶음을 넘어가는 뒷면이 붙게.
    last_card_id: prevId,
  })
}
