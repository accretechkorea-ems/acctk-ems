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
//   input_method 는 'bulk', **verified_at 은 비운다**(= 확인 전). 아무도 눈으로 보지
//   않았기 때문이다. 등록자는 **세션에서** 만든다 — 화면이 보낸 값을 믿지 않는다.
//   (한 장씩 담는 /api/business-card 는 verified_at 을 등록일로 채운다)
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
import { BULK_METHOD, MAX_PER_REQUEST, type BulkLine } from '@/lib/businessCardBulk'

const supabaseAdmin = adminClient()
const TAG = 'cards-ocr-bulk'

/** 담은 방식·확인일 — 이 라우트가 담는 줄은 늘 이렇다. */
const INPUT_METHOD = BULK_METHOD
/** **비운다** = 확인 전. 아무도 눈으로 보지 않았다. */
const VERIFIED_AT = null

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

/** 영문 칸이 표에 있나 — db/business_cards_en_20261123.sql 을 아직 안 돌렸을 수 있다. */
let enColumnsKnown: boolean | null = null
async function hasEnColumns(): Promise<boolean> {
  if (enColumnsKnown != null) return enColumnsKnown
  const { error } = await supabaseAdmin.from('business_cards').select('name_en').limit(1)
  enColumnsKnown = !(error != null && (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205'))
  return enColumnsKnown
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

  // 담기는 **차례대로** 한다 — 같은 묶음 안에 같은 명함이 둘 있으면 뒤가 중복으로 걸린다.
  for (let i = 0; i < read.length; i++) {
    const got = read[i]
    usedIn += got.usage.input
    usedOut += got.usage.output
    if (!got.ok) { lines.push({ index: i, ok: false, reason: got.reason }); continue }

    const row = toRow(got.fields, enabled)
    if (!row.name && !row.company) { lines.push({ index: i, ok: false, reason: 'empty' }); continue }

    const phone = digitsOf(row.mobile)
    const mail = String(row.email ?? '').trim().toLowerCase()
    const hit = (phone && byPhone.get(phone)) || (mail && byMail.get(mail)) || null
    if (hit) {
      lines.push({ index: i, ok: false, reason: 'dup', card_id: hit.card_id, name: hit.name })
      continue
    }

    // 이름이 비면 표의 CHECK 에 걸린다 — 회사만 읽혔으면 회사명을 이름 자리에 둔다.
    if (!row.name) row.name = row.company

    const { data: made, error } = await supabaseAdmin
      .from('business_cards')
      .insert({
        ...row,
        division,
        input_method: INPUT_METHOD,
        registered_at: now,
        verified_at: VERIFIED_AT,
        ...snap,
      })
      .select('card_id')
      .single()
    if (error || !made) {
      // 23514 = CHECK 제약. 표가 아직 'bulk' 를 모른다 — 무엇을 돌려야 하는지 따로 말해 준다.
      const why = error?.code === '23514' ? 'schema' : 'save'
      console.error(`[${TAG}] insert failed`, { index: i, code: error?.code, why })
      lines.push({ index: i, ok: false, reason: why })
      continue
    }

    const cardId = Number(made.card_id)
    lines.push({ index: i, ok: true, card_id: cardId })
    // 같은 묶음 안의 다음 장이 같은 명함이면 중복으로 걸리게 바로 넣는다.
    if (phone) byPhone.set(phone, { card_id: cardId, name: row.name })
    if (mail) byMail.set(mail, { card_id: cardId, name: row.name })

    // 자국 한 줄. 실패해도 담기를 되돌리지 않는다.
    const { error: evErr } = await supabaseAdmin.from('business_card_events').insert({
      card_id: cardId, event_type: 'card_created', occurred_at: now,
      actor_engineer_id: caller.engineer_id, payload: { name: row.name, method: INPUT_METHOD },
    })
    if (evErr && evErr.code !== '42P01' && evErr.code !== 'PGRST205') {
      console.error(`[${TAG}] 자국을 남기지 못했다`, { cardId, code: evErr.code })
    }
  }

  const saved = lines.filter(l => l.ok).length
  const dup = lines.filter(l => !l.ok && l.reason === 'dup').length
  // 남기는 것은 숫자뿐이다 — 파일도, 읽은 값도 적지 않는다.
  console.log(`[${TAG}] done`, { 받음: files.length, 담음: saved, 중복: dup, input: usedIn, output: usedOut })

  return NextResponse.json({
    ok: true,
    lines,
    usage: { input: usedIn, output: usedOut },
  })
}
