import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canAccess20 } from '@/lib/permissions'

// 20팀 수리 업무용 견적 조회 API.
// quotes RLS 는 개인 소유 모델이라, 동료·superadmin·타팀이 20팀 수리 건의 견적을 대신 작성하면 20팀이 못 읽는다.
// 그래서 여기서 service role 로 좁게 연다.
// 원칙:
//   - caller 는 canAccess20 이어야 한다(20팀 아니면 전부 403).
//   - 조회/PDF/매출집계는 'repairs.quote_id 에 연결된 견적' 만 허용한다. 작성자 팀은 보지 않는다(대리 작성 견적 포함).
//     연결 안 된 임의 견적은 403 또는 제외.
//   - 예외: ?q= 검색만 작성자 teams='20' 기준 유지(수리 모달 미사용, 범위 확대 금지).
//   - 반환 필드는 최소(quote_id, quote_number, total_supply, company_name). total_profit·quote_items 등 상세 금지.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// service role 조회 대상(내부용). engineer_id 는 필터에만 쓰고 응답엔 넣지 않는다.
const SELECT = 'quote_id, quote_number, total_supply, customer_id, engineer_id'
type RawQuote = { quote_id: number; quote_number: string; total_supply: number | null; customer_id: number | null; engineer_id: number }
type QuoteSummary = { quote_id: number; quote_number: string; total_supply: number | null; company_name: string | null }

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabaseAdmin
    .from('engineers')
    .select('engineer_id, permission_level, teams')
    .eq('email', user.email!)
    .single()
  if (!canAccess20(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const pdfParam = sp.get('pdf')
  const quoteIdParam = sp.get('quote_id')
  const quoteIdsParam = sp.get('quote_ids')
  const q = sp.get('q')

  // ── 월별 매출 집계 (?revenue=monthly) — repairs.shipped_date 기준 최근 6개월(이번 달 포함) ──
  // 매출 = 연결된 견적의 total_supply 합. 제외 대상: quote_id 없음(금액 미상), special_type='수리불가'/'수리진행안함'.
  // 포함 대상: special_type=null(일반), '본사수리'. (작성자 팀 무관 — 대리 작성 견적 포함)
  // 반환은 최소: months[{month, amount}] + 견적 미연결 출고 건수(unlinkedCount). 개별 견적 금액은 반환 안 함.
  if (sp.get('revenue') === 'monthly') {
    const now = new Date()
    const ry = now.getFullYear(), rm = now.getMonth() + 1
    const months: string[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(ry, rm - 1 - i, 1))
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
    }
    const startDate = `${months[0]}-01`
    const [ly, lm] = months[5].split('-').map(Number)
    const endDate = `${months[5]}-${String(new Date(Date.UTC(ly, lm, 0)).getUTCDate()).padStart(2, '0')}`

    const { data: reps } = await supabaseAdmin.from('repairs')
      .select('quote_id, shipped_date, special_type')
      .not('shipped_date', 'is', null)
      .gte('shipped_date', startDate)
      .lte('shipped_date', endDate)
    const rows = (reps ?? []) as { quote_id: number | null; shipped_date: string; special_type: string | null }[]
    // 매출은 '실제로 일어난 사실' — 본사수리·일반(null)은 포함하고, 수리 종료 특이사항(수리불가·수리진행안함)만 제외.
    const eligible = rows.filter(r => r.special_type !== '수리불가' && r.special_type !== '수리진행안함')
    const linked = eligible.filter(r => r.quote_id != null)
    const unlinkedCount = eligible.length - linked.length        // 견적 미연결 출고 건(금액 미상 → 매출 제외분)

    const amountById: Record<number, number> = {}
    const qids = [...new Set(linked.map(r => r.quote_id as number))]
    if (qids.length) {
      const { data: qs } = await supabaseAdmin.from('quotes').select('quote_id, total_supply').in('quote_id', qids)
      for (const q2 of (qs ?? []) as { quote_id: number; total_supply: number | null }[]) amountById[q2.quote_id] = q2.total_supply ?? 0
    }
    const sumByMonth: Record<string, number> = {}
    for (const m of months) sumByMonth[m] = 0
    for (const r of linked) {
      const m = r.shipped_date.slice(0, 7)
      if (m in sumByMonth) sumByMonth[m] += (amountById[r.quote_id as number] ?? 0)
    }
    return NextResponse.json({ months: months.map(m => ({ month: m, amount: sumByMonth[m] })), unlinkedCount })
  }

  // 최소 필드 + 고객사명(customers.company_name)만 붙여 반환.
  const attach = async (rows: RawQuote[]): Promise<QuoteSummary[]> => {
    const cids = [...new Set(rows.map(r => r.customer_id).filter((v): v is number => v != null))]
    const cmap: Record<number, string> = {}
    if (cids.length) {
      const { data: cs } = await supabaseAdmin.from('customers').select('customer_id, company_name').in('customer_id', cids)
      for (const c of (cs ?? []) as { customer_id: number; company_name: string }[]) cmap[c.customer_id] = c.company_name
    }
    return rows.map(r => ({
      quote_id: r.quote_id,
      quote_number: r.quote_number,
      total_supply: r.total_supply,
      company_name: r.customer_id != null ? (cmap[r.customer_id] ?? null) : null,
    }))
  }

  // ── PDF 발급: repairs 에 연결된 견적만. (작성자 팀 무관, 임의/미연결 견적 차단) ──
  if (pdfParam) {
    const qid = Number(pdfParam)
    if (!qid) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    // 반드시 repairs.quote_id 에 연결돼 있어야 발급(작성자 팀 무관).
    const { count } = await supabaseAdmin.from('repairs').select('repair_id', { count: 'exact', head: true }).eq('quote_id', qid)
    if (!count || count === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { data: quote } = await supabaseAdmin
      .from('quotes').select('quote_id, pdf_url').eq('quote_id', qid).single()
    if (!quote) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!quote.pdf_url) return NextResponse.json({ error: 'No PDF' }, { status: 404 })
    // 외부(synology 등) URL 은 그대로, 스토리지 경로는 서명 URL 발급.
    if (quote.pdf_url.startsWith('http') || quote.pdf_url.includes('synology'))
      return NextResponse.json({ url: quote.pdf_url })
    const fileName = quote.pdf_url.startsWith('quote-pdfs/') ? quote.pdf_url.slice('quote-pdfs/'.length) : quote.pdf_url
    if (!fileName || fileName.includes('/')) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
    const { data: signed, error } = await supabaseAdmin.storage.from('quote-pdfs').createSignedUrl(fileName, 60 * 60)
    if (error || !signed) return NextResponse.json({ error: '파일을 불러오지 못했습니다.' }, { status: 500 })
    try {
      await supabaseAdmin.from('audit_log').insert({ actor_email: user.email, action: 'READ', table_name: 'quote-pdfs', row_id: fileName })
    } catch { /* best-effort */ }
    return NextResponse.json({ url: signed.signedUrl })
  }

  // ── 단건 요약 (?quote_id=) ──
  if (quoteIdParam) {
    const qid = Number(quoteIdParam)
    if (!qid) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    // repairs 에 연결된 견적만 허용(작성자 팀 무관).
    const { count } = await supabaseAdmin.from('repairs').select('repair_id', { count: 'exact', head: true }).eq('quote_id', qid)
    if (!count || count === 0) return NextResponse.json({ quote: null })
    const { data } = await supabaseAdmin.from('quotes').select(SELECT).eq('quote_id', qid).maybeSingle()
    if (!data) return NextResponse.json({ quote: null })
    const [quote] = await attach([data as RawQuote])
    return NextResponse.json({ quote })
  }

  // ── 다건 요약 (?quote_ids=csv) — 목록 표시용 배치(상한 200) ──
  if (quoteIdsParam) {
    const ids = quoteIdsParam.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0).slice(0, 200)
    if (ids.length === 0) return NextResponse.json({ quotes: [] })
    // repairs 에 연결된 id 만 통과(작성자 팀 무관, 미연결 임의 견적 제외).
    const { data: linkedRows } = await supabaseAdmin.from('repairs').select('quote_id').in('quote_id', ids)
    const linkedSet = new Set((linkedRows ?? []).map((r: { quote_id: number }) => r.quote_id))
    const allowed = ids.filter(id => linkedSet.has(id))
    if (allowed.length === 0) return NextResponse.json({ quotes: [] })
    const { data } = await supabaseAdmin.from('quotes').select(SELECT).in('quote_id', allowed)
    return NextResponse.json({ quotes: await attach((data ?? []) as RawQuote[]) })
  }

  // ── 검색 (?q=) — 견적번호 부분일치, 작성자 teams='20' 만, 최신순 상한 20 ──
  // 이 모드만 '작성자 팀' 기준을 유지한다(수리 모달 미사용, 연결 여부와 무관하게 20팀 작성 견적을 훑는 용도). 범위 확대 금지.
  const { data: t20 } = await supabaseAdmin.from('engineers').select('engineer_id').eq('teams', '20')
  const authorIds = (t20 ?? []).map((e: { engineer_id: number }) => e.engineer_id)
  if (authorIds.length === 0) return NextResponse.json({ quotes: [] })
  const term = (q ?? '').trim()
  let query = supabaseAdmin.from('quotes').select(SELECT).in('engineer_id', authorIds).order('quote_date', { ascending: false }).limit(20)
  if (term) query = query.ilike('quote_number', `%${term}%`)
  const { data } = await query
  return NextResponse.json({ quotes: await attach((data ?? []) as RawQuote[]) })
}
