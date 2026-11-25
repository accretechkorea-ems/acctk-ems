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
// ── 담지 않는 네 경우 (2026-11-25 3차) ───────────────────────────────────
//   · 'dup'       — 이미 **등록된(active)** 명함과 같은 사람이다. 기존 card_id 를 함께 준다.
//   · 'merged'    — **이번 묶음의 draft** 와 같은 사람이거나, 바로 앞 draft 의 다른 면이다.
//                   그 줄에 얹는다(쪽이 떨어져 있어도).
//   · 'no_person' — 연락처가 없는 면인데 앞 draft 와 회사명이 겹치지 않는다.
//   · 'empty'     — 이름도 회사도 못 읽었다. 빈 줄을 쌓지 않는다.
//
// ── 같은 사람인지 어떻게 아나 ────────────────────────────────────────────
//   **휴대폰**이 둘 다 있으면 휴대폰, 하나라도 없으면 **이메일**(lib/businessCardBulk 의
//   samePerson). 회사명은 보지 않는다 — 한글면과 영문면의 회사명이 글자가 달라
//   「다른 회사」로 보이면서 같은 사람이 두 장으로 쪼개졌다(실제 20쪽에서 4쌍).
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
import { STATUS_ACTIVE, STATUS_DRAFT } from '@/lib/cardReview'
import {
  BULK_METHOD, EVENT_HANGUL, EVENT_MERGED, MAX_PER_REQUEST,
  canMergeBack, fillBlanks, hasContact, isBatchId, isNoPerson, priorityPatch, samePerson,
  type BulkLine,
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

/** 검토 대기 칸이 표에 있나 — db/business_cards_draft_20261125.sql 전일 수 있다. */
let draftKnown: boolean | null = null
async function hasDraftColumns(): Promise<boolean> {
  if (draftKnown != null) return draftKnown
  const { error } = await supabaseAdmin.from('business_cards').select('status, import_page').limit(1)
  draftKnown = !missing(error)
  if (!draftKnown) {
    console.warn(`[${TAG}] 검토 대기 칸이 아직 없다 — 그때까지는 읽은 줄을 바로 등록한다`)
  }
  return draftKnown
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

  /**
   * 읽은 줄을 **검토 대기**로 담을까 (2026-11-25).
   * 칸이 있으면 draft 로 담아 사람이 승인하게 하고, 아직 없으면 종전처럼 바로 등록한다.
   */
  const asDraft = await hasDraftColumns()

  /**
   * 같은 사람을 가려낼 **열쇠 한 줄** — 휴대폰·이메일만 본다(회사명은 보지 않는다).
   * 판정은 samePerson 한 곳에서 한다: 휴대폰이 둘 다 있으면 휴대폰, 하나라도 없으면 이메일.
   */
  type Key = { card_id: number; name: string | null; mobile: string | null; email: string | null }
  const findPerson = (list: readonly Key[], row: { mobile?: string | null; email?: string | null }) =>
    list.find(c => samePerson(c, row)) ?? null

  // ── ⓒ 중복을 보려고 **등록된(active)** 줄을 한 번만 읽는다 ──
  // 검토 대기(draft)는 여기 넣지 않는다 — 아직 명함첩에 없는 줄이다.
  let existingQuery = supabaseAdmin
    .from('business_cards').select('card_id, name, mobile, email')
    .is('deleted_at', null)
  if (asDraft) existingQuery = existingQuery.eq('status', STATUS_ACTIVE)
  const { data: existing } = await existingQuery
  const actives: Key[] = (existing ?? []).map(r => ({
    card_id: r.card_id, name: r.name, mobile: r.mobile, email: r.email,
  }))

  /**
   * ── ⓑ **이번 묶음에서 내가 담은 줄** — 같은 사람이면 바로 앞 쪽이 아니어도 그 줄에 합친다 ──
   *
   * 한 묶음은 세 쪽씩 여러 요청으로 나뉘어 온다. 앞 요청에서 담은 줄과도 맞물려야 하므로
   * 표에서 읽어 온다(2026-11-25 3차 — 떨어진 쪽의 같은 사람이 중복으로 쌓였다).
   * 검토 대기 칸이 아직 없는 DB 에서는 이 목록이 **이번 요청에서 담은 줄**만 담는다 —
   * 그래도 한 요청 안(세 쪽)의 같은 사람은 합쳐진다.
   */
  const batchDrafts: Key[] = []
  if (asDraft && batchId) {
    const { data: mine } = await supabaseAdmin
      .from('business_cards').select('card_id, name, mobile, email')
      .eq('status', STATUS_DRAFT)
      .eq('import_batch_id', batchId)
      .eq('engineer_id', caller.engineer_id)
      .is('deleted_at', null)
    for (const r of mine ?? []) {
      batchDrafts.push({ card_id: r.card_id, name: r.name, mobile: r.mobile, email: r.email })
    }
  }

  const lines: Line[] = []
  let usedIn = 0
  let usedOut = 0

  /** 직전 명함 — 같은 요청의 앞 쪽, 없으면 지난 요청이 넘겨준 prev_card_id. */
  let prevId: number | null = Number(form.get('prev_card_id')) || null
  /**
   * 그 명함이 **몇 쪽**이었나 — 응답으로 돌려주어 다음 요청이 이어 쓴다.
   * 2026-11-25 3차부터 **쪽이 붙어 있는지는 보지 않는다** — 합칠지는 열쇠(휴대폰·이메일)와
   * 회사명이 정한다. 떨어진 쪽의 같은 사람을 중복으로 쌓던 것을 고친 자리다.
   */
  let prevPage: number | null = Number.isFinite(Number(form.get('prev_page'))) && String(form.get('prev_page') ?? '') !== ''
    ? Number(form.get('prev_page')) : null
  /** 이 묶음의 첫 파일이 전체에서 **몇 쪽**인가(0부터). */
  const pageBase = Number(form.get('page_base')) || 0
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
   * 그 줄에 이번 면을 **얹는다**.
   *
   *   · `fillBlanks` — 빈 칸을 채운다(어느 경우에나).
   *   · `priorityPatch` — 한글 > 한자·가나 > 로마자 순으로 **이미 든 값도 교체한다**.
   *     밀려난 로마자는 영문 칸이 비어 있으면 그리로 간다.
   *
   * 교체는 **이번 묶음의 draft** 에만 한다(`priority: true`). 이미 등록된(active) 명함은
   * 빈 칸만 채운다 — 사람이 쓰고 있는 줄의 값을 가져오기가 바꾸지 않는다(2026-11-25).
   * 바뀐 것이 없으면 쓰지 않는다.
   */
  const mergeInto = async (
    target: number, targetRow: Record<string, unknown>, row: Record<string, string | null>,
    opts: { priority: boolean },
  ): Promise<Record<string, unknown>> => {
    const fill = fillBlanks(targetRow, row, WRITE_FIELDS)
    const { patch: fix, replaced } = opts.priority
      ? priorityPatch(targetRow, row)
      : { patch: {} as Record<string, string>, replaced: [] }
    // 표에 없는 칸(영문 칸이 아직 없는 DB)은 빼고 쓴다.
    const allow = (p: Record<string, string>) => Object.fromEntries(
      Object.entries(p).filter(([k]) => (WRITE_FIELDS as readonly string[]).includes(k)),
    )
    const patch = { ...fill, ...allow(fix) }
    if (Object.keys(patch).length === 0) return targetRow
    const { error } = await supabaseAdmin.from('business_cards').update(patch).eq('card_id', target)
    if (error) {
      console.error(`[${TAG}] 합치지 못했다`, { target, code: error.code })
      return targetRow
    }
    // 합친 자국 — **교체 전 값**을 함께 남긴다(되짚어 볼 수 있게).
    if (Object.keys(fill).length > 0 || replaced.length > 0) {
      await logEvent(target, EVENT_MERGED, { filled: Object.keys(fill), replaced })
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
    const page = pageBase + i

    /**
     * ── ⓐ 연락처가 없는 면(뒷면·이름 없음·휴대폰·이메일 둘 다 없음) ──
     * **바로 앞 draft** 와 회사명이 겹치면 그 명함의 다른 면으로 보고 붙인다.
     * 겹치지 않으면 남의 면이다 — 담지 않고 목록에 남긴다(2026-11-25 3차).
     */
    if (isNoPerson(row, got.back)) {
      if (prevId != null && prevRow
        && canMergeBack(prevRow as Parameters<typeof canMergeBack>[0], row)) {
        prevRow = await mergeInto(prevId, prevRow, row, { priority: true })
        lines.push({ index: i, ok: false, reason: 'merged', card_id: prevId, merged_into: prevId, usage, page })
      } else {
        lines.push({
          index: i, ok: false, reason: 'no_person',
          name: row.company ?? row.name, usage, upside_down: got.upsideDown, page,
        })
      }
      continue
    }

    // 돌려서 **다시 읽은** 요청이면 문턱을 올린다 — 이름만 덩그러니 나온 쪽을 담지 않는다.
    if (isRetry && !hasContact(row)) {
      lines.push({ index: i, ok: false, reason: 'no_person', name: row.name ?? row.company, usage })
      continue
    }

    /**
     * ── ⓑ **이번 묶음의 draft** 와 같은 사람 — 그 줄에 합친다 ──
     * 쪽이 떨어져 있어도 합친다(한글면과 영문면이 몇 쪽 건너 떨어져 있는 PDF 가 흔하다).
     * 회사명은 보지 않는다 — 번역 관계인 회사명을 「다른 회사」로 보던 2차의 잘못을 지웠다.
     */
    const draftHit = findPerson(batchDrafts, row)
    if (draftHit) {
      const { data: target } = await supabaseAdmin
        .from('business_cards').select('*').eq('card_id', draftHit.card_id).maybeSingle()
      if (target) {
        const merged = await mergeInto(draftHit.card_id, target as Record<string, unknown>, row, { priority: true })
        // 이 면에만 있던 열쇠도 더해 둔다 — 다음 면이 그 번호·메일로도 걸리게.
        draftHit.mobile = draftHit.mobile || row.mobile
        draftHit.email = draftHit.email || row.email
        // 합쳐 들어간 명함이 이제 **바로 앞 draft** 다(뒷면이 이 줄에 붙는다).
        prevId = draftHit.card_id
        prevRow = merged
        prevPage = page
        lines.push({
          index: i, ok: false, reason: 'merged',
          card_id: draftHit.card_id, merged_into: draftHit.card_id, usage, page,
        })
        continue
      }
    }

    /**
     * ── ⓒ 이미 **등록된(active)** 명함과 같은 사람 — 중복이다 ──
     * 담지 않고 기존 id 를 알려 준다. 그 줄의 **빈 칸만** 채운다(든 값은 건드리지 않는다).
     */
    const hit = findPerson(actives, row)
    if (hit) {
      const { data: old } = await supabaseAdmin
        .from('business_cards').select('*').eq('card_id', hit.card_id).maybeSingle()
      if (old) await mergeInto(hit.card_id, old as Record<string, unknown>, row, { priority: false })
      lines.push({ index: i, ok: false, reason: 'dup', card_id: hit.card_id, name: hit.name, usage, page })
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
        // 검토 대기로 담는다 — 사람이 승인해야 명함첩에 나온다.
        ...(asDraft ? { status: STATUS_DRAFT, import_page: page } : {}),
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
    lines.push({ index: i, ok: true, card_id: cardId, usage, page })
    /**
     * 같은 묶음의 다음 면이 같은 사람이면 **이 줄에 합쳐지게** 열쇠를 넣어 둔다.
     * 검토 대기 칸이 없는 DB 에서도 똑같이 합친다 — 방금 **내가 담은 줄**이라
     * 중복으로 돌려보내면 한 사람이 두 장으로 쪼개진다(그 자리를 고치는 회차다).
     */
    if (phone || mail) {
      batchDrafts.push({ card_id: cardId, name: row.name, mobile: row.mobile, email: row.email })
    }
    // 이 쪽이 다음 쪽의 「바로 앞 draft」가 된다 — 연락처 없는 면이 여기에 붙는다.
    prevId = cardId
    prevPage = page
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
    // 다음 요청이 prev_card_id·prev_page 로 되돌려 보낸다 — 묶음을 넘어가는 뒷면이 붙게.
    last_card_id: prevId,
    last_page: prevPage,
  })
}
