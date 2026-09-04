// 대리점 리드 등록(/lead) 접수 라우트.
//
// 이 라우트는 인증을 요구하지 않는다 — 폼이 로그인 없는 공개 페이지이기 때문이다.
// 따라서 화면의 검증은 편의일 뿐이고, 여기서 하는 재검증이 유일한 방어선이다.
// 저장은 service role 로 한다(anon 정책에 기대지 않는다). 알림도 여기서만 만든다 —
// 익명 사용자가 notifications 를 직접 건드릴 수 있으면 안 되기 때문이다.
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { adminEngineerIds, notifyLead } from '@/lib/leadNotify'
import {
  INDUSTRIES, INTEREST_PRODUCTS, COMPETITORS, BUDGET_STATUSES, PURCHASE_PERIODS,
  MAX_LEN, FIELD_LABELS, MEETING_NOTE_MIN, HONEYPOT_FIELD, EMAIL_RE, DEFAULT_COUNTRY,
  LEAD_NO_PREFIX, leadNoTag, CARD_MAX_BYTES, CARD_BUCKET,
} from '@/lib/leadOptions'
import { josa } from '@/lib/josa'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Body = Record<string, unknown>

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const bad = (message: string) => NextResponse.json({ error: message }, { status: 400 })

/**
 * 그 해의 리드 번호 접두. 서버가 어느 시간대에 떠 있든 한국 기준 연도를 쓴다
 * (UTC 서버라면 1월 1일 오전에 전년도 번호가 나갈 수 있어서 명시한다).
 */
function leadNoPrefix(): string {
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date())
  return `${LEAD_NO_PREFIX}-${year.slice(2)}-`
}

/**
 * 그 해의 다음 번호. 뒷자리를 숫자로 파싱해 최댓값을 찾는다
 * (문자열 max 로는 'LD-26-9' 가 'LD-26-10' 보다 커진다).
 * 세 자리로 채우되 999 를 넘으면 자릿수가 자연히 늘어난다.
 */
async function nextLeadNo(prefix: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('lead_no')
    .like('lead_no', `${prefix}%`)
  if (error) console.error('[lead] 번호 조회 실패', error)
  const max = ((data ?? []) as { lead_no: string | null }[]).reduce((m, r) => {
    const n = Number(String(r.lead_no ?? '').slice(prefix.length))
    return Number.isInteger(n) && n > m ? n : m
  }, 0)
  return prefix + String(max + 1).padStart(3, '0')
}

/**
 * 명함 이미지 검증. 화면이 canvas 로 줄여 data URL 로 보내지만, 공개 라우트라
 * 화면을 거치지 않는 호출을 가정하고 여기서 다시 본다.
 *   · 선언된 MIME 만 믿지 않고 앞머리 바이트로 실제 형식을 확인한다
 *   · 크기 상한 (CARD_MAX_BYTES)
 * 파일명은 서버가 정한다 — 클라이언트가 보낸 이름은 쓰지 않는다(경로 조작·덮어쓰기 방지).
 */
type CardImage = { bytes: Buffer; ext: 'jpg' | 'png' | 'webp'; contentType: string }

function parseCard(raw: unknown): { ok: true; card: CardImage | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, card: null }
  if (typeof raw !== 'string') return { ok: false, error: '명함 이미지를 읽을 수 없습니다.' }

  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(raw)
  if (!m) return { ok: false, error: '명함은 이미지 파일만 첨부할 수 있습니다.' }

  let bytes: Buffer
  try {
    bytes = Buffer.from(m[2], 'base64')
  } catch {
    return { ok: false, error: '명함 이미지를 읽을 수 없습니다.' }
  }
  if (bytes.length === 0) return { ok: false, error: '명함 이미지를 읽을 수 없습니다.' }
  if (bytes.length > CARD_MAX_BYTES) {
    return { ok: false, error: `명함 이미지는 ${Math.floor(CARD_MAX_BYTES / (1024 * 1024))}MB 를 넘을 수 없습니다.` }
  }

  // 앞머리 바이트로 실제 형식을 본다. 선언된 MIME 과 다르면 거부한다.
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const isWebp = bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  const actual = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : isWebp ? 'image/webp' : null
  if (!actual || actual !== m[1]) return { ok: false, error: '명함은 이미지 파일만 첨부할 수 있습니다.' }

  const ext = isJpeg ? 'jpg' : isPng ? 'png' : 'webp'
  return { ok: true, card: { bytes, ext, contentType: actual } }
}

/** 'YYYY-MM-DD' 인지, 그리고 실재하는 날짜인지(2026-02-30 같은 값 차단) 본다. */
function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  // UTC 로만 만들고 UTC 로만 읽어 시간대에 따라 날짜가 밀리지 않게 한다.
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d
}

export async function POST(req: Request) {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return bad('요청을 읽을 수 없습니다.')
  }

  // 허니팟 — 사람 눈에 보이지 않는 칸이 채워져 있으면 봇이다.
  // 봇에게 실패를 알리면 우회를 시도하므로, 저장하지 않고 성공처럼 응답한다.
  if (str(body[HONEYPOT_FIELD])) {
    console.error('[lead] honeypot triggered — 저장하지 않고 성공 응답')
    return NextResponse.json({ success: true })
  }

  // ── 필수 텍스트 ──
  // 항목 이름은 FIELD_LABELS 한 곳에서만 온다(길이 초과 문구도 같은 것을 쓴다).
  const required = [
    'partner_company', 'partner_name', 'customer_company', 'products', 'city',
    'contact_name', 'contact_dept', 'contact_mobile', 'meeting_note',
  ] as const
  const value: Record<string, string> = {}
  for (const key of required) {
    const v = str(body[key])
    if (!v) return bad(`${FIELD_LABELS[key]}${josa(FIELD_LABELS[key], '을')} 입력해주세요.`)
    value[key] = v
  }

  // 국가는 필수이지만 기본값이 있어 비어 오면 기본값으로 채운다.
  value.country = str(body.country) || DEFAULT_COUNTRY

  // ── 선택 텍스트 ──
  for (const key of ['partner_contact', 'address', 'request_note', 'contact_title', 'contact_office_tel', 'contact_email'] as const) {
    value[key] = str(body[key])
  }

  // ── 길이 제한 — 컬럼이 text 라 서버에서 막지 않으면 무제한으로 들어온다 ──
  for (const [key, max] of Object.entries(MAX_LEN)) {
    if ((value[key] ?? '').length > max) {
      const label = FIELD_LABELS[key as keyof typeof MAX_LEN]
      return bad(`${label}${josa(label, '은')} ${max}자를 넘을 수 없습니다.`)
    }
  }

  // ── 형식·길이 규칙 ──
  // 이메일은 선택 항목이다 — 적어 보냈을 때만 형식을 본다.
  if (value.contact_email && !EMAIL_RE.test(value.contact_email)) return bad('이메일 형식이 올바르지 않습니다.')
  if (value.meeting_note.length < MEETING_NOTE_MIN) {
    return bad(`회의록은 ${MEETING_NOTE_MIN}자 이상 입력해주세요.`)
  }

  // ── 화이트리스트 — 폼을 우회한 임의 값을 막는다 ──
  const industry = str(body.industry)
  if (!INDUSTRIES.includes(industry)) return bad('산업군 값이 올바르지 않습니다.')

  const interestProduct = str(body.interest_product)
  if (!(INTEREST_PRODUCTS as readonly string[]).includes(interestProduct)) {
    return bad('관심 제품 값이 올바르지 않습니다.')
  }

  const budgetStatus = str(body.budget_status)
  if (!(BUDGET_STATUSES as readonly string[]).includes(budgetStatus)) {
    return bad('예산 값이 올바르지 않습니다.')
  }

  const purchasePeriod = str(body.purchase_period)
  if (!(PURCHASE_PERIODS as readonly string[]).includes(purchasePeriod)) {
    return bad('예상 구매 기간을 선택해주세요.')
  }

  const rawCompetitor = Array.isArray(body.competitor) ? body.competitor : []
  const competitor = rawCompetitor.map(str).filter(Boolean)
  if (competitor.some(c => !(COMPETITORS as readonly string[]).includes(c))) {
    return bad('경쟁사 값이 올바르지 않습니다.')
  }
  if (new Set(competitor).size !== competitor.length) return bad('경쟁사가 중복되었습니다.')

  const competitorOther = str(body.competitor_other)
  if (competitorOther.length > MAX_LEN.competitor_other) {
    return bad(`${FIELD_LABELS.competitor_other}${josa(FIELD_LABELS.competitor_other, '은')} ${MAX_LEN.competitor_other}자를 넘을 수 없습니다.`)
  }

  // 날짜는 date 컬럼이라 'YYYY-MM-DD' 문자열을 그대로 넣는다(Date 객체를 거치지 않는다).
  const expectedPurchase = str(body.expected_purchase)
  if (expectedPurchase && !isValidDate(expectedPurchase)) {
    return bad('예상 구매 시기가 올바른 날짜가 아닙니다.')
  }

  // 명함(선택). 형식이 틀리면 여기서 거절한다 — 리드를 저장한 뒤 실패하는 것보다 낫다.
  const parsed = parseCard(body.business_card)
  if (!parsed.ok) return bad(parsed.error)
  const card = parsed.card

  const row = {
    partner_company: value.partner_company,
    partner_name: value.partner_name,
    partner_contact: value.partner_contact || null,
    customer_company: value.customer_company,
    industry,
    products: value.products,
    address: value.address || null,
    city: value.city,
    country: value.country,
    interest_product: interestProduct,
    request_note: value.request_note || null,
    competitor: competitor.length ? competitor : null,
    competitor_other: competitorOther || null,
    budget_status: budgetStatus,
    purchase_period: purchasePeriod || null,
    expected_purchase: expectedPurchase || null,
    // 화면은 이름을 한 칸으로 받고 contact_name 에 그대로 담는다.
    // 옛 contact_first_name / contact_last_name 은 NOT NULL 이 풀렸으므로 건드리지 않는다(NULL 로 남는다).
    contact_name: value.contact_name,
    contact_dept: value.contact_dept || null,
    contact_title: value.contact_title || null,
    // 이메일은 선택 항목이 됐지만 leads.contact_email 은 NOT NULL 이다(스키마는 건드리지 않는다).
    // 빈 문자열로 저장한다 — 화면·PDF 의 Row 는 빈 값을 '-' 로 그리므로 표시는 달라지지 않는다.
    contact_email: value.contact_email,
    contact_office_tel: value.contact_office_tel || null,
    contact_mobile: value.contact_mobile,
    meeting_note: value.meeting_note,
  }

  // 번호를 붙여 넣는다. 동시에 들어온 두 요청이 같은 번호를 계산해도 unique 인덱스가
  // 한쪽을 튕겨내므로, 튕긴 쪽은 다시 읽어 다음 번호를 받는다. 인덱스가 최종 방어선이다.
  const prefix = leadNoPrefix()
  type Saved = { lead_id: number; lead_no: string | null }
  let saved: Saved | null = null
  let conflicted = false
  for (let attempt = 0; attempt < 5; attempt++) {
    const leadNo = await nextLeadNo(prefix)
    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert({ ...row, lead_no: leadNo })
      .select('lead_id, lead_no')
      .single<Saved>()
    if (!error && data) { saved = data; break }
    if (error?.code === '23505') {   // 번호가 겹쳤다 — 다시 계산해서 재시도
      conflicted = true
      console.error('[lead] 번호 충돌, 재시도', { attempt: attempt + 1, leadNo })
      continue
    }
    console.error('[lead] insert failed', error)
    return NextResponse.json({ error: '등록에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }

  // 다섯 번 모두 번호가 겹쳤다면 번호 없이 저장한다 — 리드 자체를 잃는 것보다 낫다.
  if (!saved && conflicted) {
    console.error('[lead] 번호 발급 5회 실패 — 번호 없이 저장한다', { prefix })
    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert(row)
      .select('lead_id, lead_no')
      .single<Saved>()
    if (error || !data) {
      console.error('[lead] insert failed', error)
      return NextResponse.json({ error: '등록에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 })
    }
    saved = data
  }
  if (!saved) {
    return NextResponse.json({ error: '등록에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }

  // ── 명함 업로드 ──
  // 리드를 저장한 뒤에 올린다. 파일명에 lead_id 를 넣어야 어느 리드의 명함인지 파일만 봐도 알 수 있고,
  // 이름을 서버가 정하므로 클라이언트가 경로를 조작하거나 남의 파일을 덮어쓸 수 없다.
  //
  // 업로드가 실패해도 리드 저장은 되돌리지 않는다 — 명함은 부가 정보이고,
  // 여기서 리드를 지우면 파트너사가 애써 적은 내용이 통째로 사라진다.
  // 대신 그 사실을 응답에 담아 완료 화면이 알리도록 한다.
  let cardWarning: string | null = null
  if (card) {
    const fileName = `lead-${saved.lead_id}-${Date.now()}.${card.ext}`
    const { error: upErr } = await supabaseAdmin.storage
      .from(CARD_BUCKET)
      .upload(fileName, card.bytes, { contentType: card.contentType, upsert: false })
    if (upErr) {
      console.error('[lead] 명함 업로드 실패', { leadId: saved.lead_id, fileName, error: upErr })
      cardWarning = '명함 이미지를 저장하지 못했습니다. 담당자에게 따로 전달해주세요.'
    } else {
      const { error: linkErr } = await supabaseAdmin
        .from('leads')
        .update({ business_card_url: fileName })
        .eq('lead_id', saved.lead_id)
      if (linkErr) {
        // 파일은 올라갔는데 연결에 실패했다 — 아무도 찾을 수 없는 파일이 남으므로 되돌린다.
        console.error('[lead] 명함 연결 실패, 올린 파일을 지운다', { leadId: saved.lead_id, fileName, error: linkErr })
        const { error: rmErr } = await supabaseAdmin.storage.from(CARD_BUCKET).remove([fileName])
        if (rmErr) console.error('[lead] 고아 명함 파일 삭제 실패', { fileName, error: rmErr })
        cardWarning = '명함 이미지를 저장하지 못했습니다. 담당자에게 따로 전달해주세요.'
      }
    }
  }

  // 알림은 부가 작업이다 — 실패해도 리드 저장을 되돌리지 않고 성공으로 응답한다.
  // 등록 알림은 리드 관리자(재직 superadmin)에게만 간다. 담당자는 배정될 때 따로 받는다.
  await notifyLead({
    engineerIds: await adminEngineerIds(),
    title: '신규 리드 등록',
    message: `${leadNoTag(saved.lead_no)}신규 리드가 등록되었습니다.`,
    type: 'lead_created',
    leadId: saved.lead_id,
  })

  return NextResponse.json({ success: true, ...(cardWarning ? { cardWarning } : null) })
}
