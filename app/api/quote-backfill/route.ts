// 사후 실적 입력 — **EMS 밖에서 끝난 건을 한 줄로 적어 넣는다** (2026-11-23).
//
// ── 왜 ───────────────────────────────────────────────────────────────────
// 옛 견적서로 나갔거나 수기 품의로 처리한 건이 실적에 잡히지 않아, 담당자별 숫자가
// 실제와 어긋난다. 그 차이를 메우는 길이다.
//
// ── 누가 ─────────────────────────────────────────────────────────────────
// **슈퍼관리자만.** 남의 실적을 만드는 일이라 문턱이 가장 높다. 담당자(engineer_id)는
// 화면이 고른 사람이 되지만, **적은 사람(backfilled_by)은 세션에서 넣는다** — 화면이
// 보낸 값을 믿지 않는다.
//
// ── 무엇을 담나 ──────────────────────────────────────────────────────────
//   quotes 한 줄 — 집계가 보는 칸(quote_date · status · 상태별 날짜 · total_supply)을 채운다.
//   quote_items 한 줄 — 금액·통화·환율을 남긴다. 「얼마를 어떤 환율로 원화 얼마로 봤는가」를
//     나중에 되짚을 수 있어야 한다(quotes 에는 통화 칸이 없다).
//   PDF — 첨부가 **필수**다. 근거 없는 실적을 만들지 않는다. quote-pdfs 버킷에 올리고
//     pdf_url 에 '<버킷>/<파일명>' 꼴로 적는다(다른 견적과 같은 규칙).
//
// ── 번호 ─────────────────────────────────────────────────────────────────
//   자동 — next_quote_seq(DB 함수)로 순번을 받아 create_quote 와 **같은 글자**를 만든다.
//   수기 — 옛 견적서에 찍힌 번호를 그대로 적는다. 겹치면 23505 로 막는다.
//
// ⚠ db/quote_backfill_20261123.sql 을 적용하기 전에는 **503** 으로 그 파일 이름을 알려 준다.

import { NextResponse } from 'next/server'
import { adminClient, loadCaller } from '@/lib/apiCaller'
import {
  BACKFILL_SCHEMA_MESSAGE, NOTE_MAX, amountKrw, backfillBlockedReason,
  isMissingBackfillColumn, quoteNumberOf, statusDateField, ymdCompact,
  type BackfillForm,
} from '@/lib/quoteBackfill'
import { isFormKind } from '@/lib/quoteForms'

const supabaseAdmin = adminClient()
const TAG = 'quote-backfill'
const PDF_BUCKET = 'quote-pdfs'

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 올릴 수 있는 파일 — PDF 하나, 20MB 까지. */
const PDF_MAX = 20 * 1024 * 1024

export async function POST(req: Request) {
  const { error: authErr, caller } = await loadCaller({ kind: 'superadmin' }, { tag: TAG, method: 'POST' })
  if (authErr) return authErr

  // 파일이 함께 오므로 FormData 다. 값은 form 이라는 칸에 JSON 으로 들어온다.
  let fd: FormData
  try { fd = await req.formData() } catch { return bad('요청을 읽지 못했습니다') }

  let form: BackfillForm
  try { form = JSON.parse(String(fd.get('form') ?? '')) as BackfillForm } catch { return bad('입력을 읽지 못했습니다') }

  const pdf = fd.get('pdf')
  const hasPdf = pdf instanceof File && pdf.size > 0
  // 화면이 보낸 hasPdf 를 믿지 않는다 — 실제로 온 파일을 본다.
  const blocked = backfillBlockedReason({ ...form, hasPdf })
  if (blocked) return bad(blocked)
  if (!(pdf instanceof File)) return bad('PDF 를 첨부해주세요')
  if (pdf.size > PDF_MAX) return bad('PDF 는 20MB까지 올릴 수 있습니다')
  if (!/\.pdf$/i.test(pdf.name)) return bad('PDF 파일만 올릴 수 있습니다')
  if (!isFormKind(form.formKind)) return bad('양식을 골라주세요')

  // ── 사업장·담당자가 실제로 있는 줄인가 ────────────────────────────────
  const [{ data: site }, { data: owner }] = await Promise.all([
    supabaseAdmin.from('customers')
      .select('customer_id, company_name, is_parent, deleted_at').eq('customer_id', form.customerId).maybeSingle(),
    supabaseAdmin.from('engineers')
      .select('engineer_id, name, initials, resigned_date').eq('engineer_id', form.engineerId).maybeSingle(),
  ])
  if (!site || site.deleted_at) return bad('사업장을 찾지 못했습니다')
  if (site.is_parent) return bad('회사 줄에는 실적을 달 수 없습니다 — 사업장을 고르세요')
  if (!owner) return bad('담당자를 찾지 못했습니다')

  // ── 번호 ──────────────────────────────────────────────────────────────
  let quoteNumber = form.quoteNumber.trim()
  if (form.autoNumber) {
    const initials = (owner.initials ?? '').trim()
    if (!initials) return bad(`${owner.name ?? '담당자'} 의 이니셜이 없어 번호를 자동으로 받을 수 없습니다 — 직접 적어주세요`)
    const ymd = ymdCompact(form.quoteDate)
    if (!ymd) return bad('견적일이 올바르지 않습니다')
    const { data: seq, error: seqErr } = await supabaseAdmin
      .rpc('next_quote_seq', { p_date: ymd, p_engineer_id: owner.engineer_id })
    if (seqErr || typeof seq !== 'number') {
      console.error(`[${TAG}] 순번을 받지 못했다`, seqErr)
      return NextResponse.json({ error: '견적번호를 받지 못했습니다' }, { status: 500 })
    }
    quoteNumber = quoteNumberOf(initials, ymd, seq)
  }

  // ── 담을 값 ───────────────────────────────────────────────────────────
  const supply = amountKrw(form.amount, form.currency, form.exchangeRate)
  if (supply <= 0) return bad('금액을 적어주세요')
  const dateField = statusDateField(form.status)
  const now = new Date().toISOString()

  const row: Record<string, unknown> = {
    quote_number: quoteNumber,
    quote_date: form.quoteDate,
    customer_id: site.customer_id,
    engineer_id: owner.engineer_id,
    created_by: caller.engineer_id,
    status: form.status,
    form_kind: form.formKind,
    total_supply: supply,
    total_tax: 0,
    total_amount: supply,
    total_cost: 0,
    total_profit: 0,
    profit_rate: 0,
    note: form.note.trim().slice(0, NOTE_MAX) || null,
    backfilled_at: now,
    backfilled_by: caller.engineer_id,
  }
  // 상태가 쓰는 날짜 — 이 칸이 비면 그 지표의 어느 기간에도 잡히지 않는다(lib/salesStats.ts).
  if (dateField) row[dateField] = form.statusDate

  const { data: made, error: insErr } = await supabaseAdmin
    .from('quotes').insert(row).select('quote_id, quote_number').single()
  if (insErr || !made) {
    if (isMissingBackfillColumn(insErr)) {
      return NextResponse.json({ error: BACKFILL_SCHEMA_MESSAGE }, { status: 503 })
    }
    if (insErr?.code === '23505') return bad('같은 견적번호가 이미 있습니다', 409)
    console.error(`[${TAG}] insert failed`, insErr)
    return NextResponse.json({ error: '실적을 담지 못했습니다' }, { status: 500 })
  }
  const quoteId = Number(made.quote_id)

  // ── 품목 한 줄 — 금액·통화·환율을 남긴다 ──────────────────────────────
  const { error: itemErr } = await supabaseAdmin.from('quote_items').insert({
    quote_id: quoteId,
    product_name: '사후 입력',
    quantity: 1,
    unit_price_krw: supply,
    supply_amount: supply,
    tax_amount: 0,
    currency: form.currency,
    exchange_rate: form.currency === 'KRW' ? null : form.exchangeRate,
  })
  if (itemErr) console.error(`[${TAG}] 품목 줄을 넣지 못했다`, { quoteId, itemErr })

  // ── PDF ───────────────────────────────────────────────────────────────
  const fileName = `${quoteNumber}.pdf`
  const { error: upErr } = await supabaseAdmin.storage
    .from(PDF_BUCKET)
    .upload(fileName, pdf, { contentType: 'application/pdf', upsert: true })
  if (upErr) {
    console.error(`[${TAG}] PDF 를 올리지 못했다`, { quoteId, upErr })
    // 줄은 남는다 — 숫자가 들어간 것이 더 중요하고, PDF 는 상세에서 다시 올릴 수 있다.
    return NextResponse.json({
      ok: true, quote_id: quoteId, quote_number: quoteNumber,
      warning: '실적은 담았지만 PDF 를 올리지 못했습니다 — 견적 상세에서 다시 올려주세요',
    })
  }
  const { error: pdfErr } = await supabaseAdmin
    .from('quotes').update({ pdf_url: `${PDF_BUCKET}/${fileName}` }).eq('quote_id', quoteId)
  if (pdfErr) console.error(`[${TAG}] pdf_url 을 적지 못했다`, { quoteId, pdfErr })

  console.log(`[${TAG}] created`, { quoteId, quoteNumber, owner: owner.engineer_id, by: caller.email })
  return NextResponse.json({ ok: true, quote_id: quoteId, quote_number: quoteNumber })
}
