// 대리점 리드 등록(/lead) 접수 라우트.
//
// 이 라우트는 인증을 요구하지 않는다 — 폼이 로그인 없는 공개 페이지이기 때문이다.
// 따라서 화면의 검증은 편의일 뿐이고, 여기서 하는 재검증이 유일한 방어선이다.
// 저장은 service role 로 한다(anon 정책에 기대지 않는다). 알림도 여기서만 만든다 —
// 익명 사용자가 notifications 를 직접 건드릴 수 있으면 안 되기 때문이다.
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { canViewPipeline } from '@/lib/permissions'
import { loadTeamPerms, attachTeamPerm } from '@/lib/teamPermsServer'
import {
  INDUSTRIES, INTEREST_PRODUCTS, COMPETITORS, BUDGET_STATUSES, PURCHASE_PERIODS,
  MAX_LEN, MEETING_NOTE_MIN, HONEYPOT_FIELD, EMAIL_RE, DEFAULT_COUNTRY,
} from '@/lib/leadOptions'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Body = Record<string, unknown>

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const bad = (message: string) => NextResponse.json({ error: message }, { status: 400 })

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
  const required = {
    partner_company: '파트너사 회사명',
    partner_name: '등록자 성함',
    customer_company: '고객사 회사명',
    products: '생산품',
    city: '시',
    contact_name: '이름',
    contact_email: '이메일',
    contact_mobile: '휴대폰 번호',
    meeting_note: '회의록',
  } as const
  const value: Record<string, string> = {}
  for (const [key, label] of Object.entries(required)) {
    const v = str(body[key])
    if (!v) return bad(`${label}을(를) 입력해주세요.`)
    value[key] = v
  }

  // 국가는 필수이지만 기본값이 있어 비어 오면 기본값으로 채운다.
  value.country = str(body.country) || DEFAULT_COUNTRY

  // ── 선택 텍스트 ──
  for (const key of ['partner_contact', 'address', 'request_note', 'contact_dept', 'contact_title', 'contact_office_tel'] as const) {
    value[key] = str(body[key])
  }

  // ── 길이 제한 — 컬럼이 text 라 서버에서 막지 않으면 무제한으로 들어온다 ──
  for (const [key, max] of Object.entries(MAX_LEN)) {
    if ((value[key] ?? '').length > max) return bad(`${key} 은(는) ${max}자를 넘을 수 없습니다.`)
  }

  // ── 형식·길이 규칙 ──
  if (!EMAIL_RE.test(value.contact_email)) return bad('이메일 형식이 올바르지 않습니다.')
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
  if (purchasePeriod && !(PURCHASE_PERIODS as readonly string[]).includes(purchasePeriod)) {
    return bad('예상 구매 기간 값이 올바르지 않습니다.')
  }

  const rawCompetitor = Array.isArray(body.competitor) ? body.competitor : []
  const competitor = rawCompetitor.map(str).filter(Boolean)
  if (competitor.some(c => !(COMPETITORS as readonly string[]).includes(c))) {
    return bad('경쟁사 값이 올바르지 않습니다.')
  }
  if (new Set(competitor).size !== competitor.length) return bad('경쟁사가 중복되었습니다.')

  const competitorOther = str(body.competitor_other)
  if (competitorOther.length > MAX_LEN.competitor_other) {
    return bad(`competitor_other 은(는) ${MAX_LEN.competitor_other}자를 넘을 수 없습니다.`)
  }

  // 날짜는 date 컬럼이라 'YYYY-MM-DD' 문자열을 그대로 넣는다(Date 객체를 거치지 않는다).
  const expectedPurchase = str(body.expected_purchase)
  if (expectedPurchase && !isValidDate(expectedPurchase)) {
    return bad('예상 구매 시기가 올바른 날짜가 아닙니다.')
  }

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
    contact_email: value.contact_email,
    contact_office_tel: value.contact_office_tel || null,
    contact_mobile: value.contact_mobile,
    meeting_note: value.meeting_note,
  }

  const { data: saved, error: insErr } = await supabaseAdmin
    .from('leads')
    .insert(row)
    .select('lead_id')
    .single()
  if (insErr || !saved) {
    console.error('[lead] insert failed', insErr)
    return NextResponse.json({ error: '등록에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }

  // 알림은 부가 작업이다 — 실패해도 리드 저장을 되돌리지 않고 성공으로 응답한다.
  try {
    const teamPerms = await loadTeamPerms()
    const { data: engineers, error: engErr } = await supabaseAdmin
      .from('engineers')
      .select('engineer_id, name, permission_level, teams, resigned_date')
    if (engErr) throw engErr

    type Row = { engineer_id: number; name: string | null; permission_level: string | null; teams: string | null; resigned_date: string | null }
    const targets = ((engineers ?? []) as Row[]).filter(
      e => !e.resigned_date && canViewPipeline(attachTeamPerm(teamPerms, e))
    )

    if (targets.length) {
      const { error: notiErr } = await supabaseAdmin.from('notifications').insert(
        targets.map(e => ({
          engineer_id: e.engineer_id,
          title: '신규 리드 등록',
          message: `[${value.partner_company}] 이(가) [${value.customer_company}] 리드를 등록했습니다.`,
          type: 'lead_created',
          link: '/leads',
          is_read: false,
        }))
      )
      if (notiErr) throw notiErr
    } else {
      console.error('[lead] 알림 대상이 없습니다 — 영업 현황 권한을 가진 재직 직원 없음')
    }
  } catch (e) {
    console.error('[lead] notification failed', { leadId: saved.lead_id, error: e })
  }

  return NextResponse.json({ success: true })
}
