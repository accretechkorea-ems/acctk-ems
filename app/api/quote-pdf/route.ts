import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { canOpenAnyQuotePdf } from '@/lib/approval/quotePdfAccess'

// 견적서 PDF 서명 URL 발급.
//
// 찾는 길이 둘이다 — 어느 쪽이든 **같은 파일**(확정 때 만들어 올린 그 문서)을 내준다.
//   · ?path=…     — 저장된 경로를 아는 화면(목록·고객사 상세·영업기회)이 쓴다. 종전 그대로다.
//   · ?quoteId=…  — 견적 id 만 아는 화면(결재 문서의 품의서 본문·검토표)이 쓴다.
//
// **승인 게이트로 막지 않는다.** 확정 PDF 에는 확정일이 찍혀 있어 그 자체로 고객 발송용
// 문서다(app/quote/page.tsx 의 handleDownloadPDF — dateDisplay 가 확정일이다). 결재 중·반려·
// 승인 뒤 모두 같은 파일을 연다. 결재는 발주·계산서·상태 변경을 막을 뿐 문서 열람을 막지 않는다.
//
// 열람 범위는 lib/approval/quotePdfAccess.ts 한 곳이다 — 견적 열람 권한(작성자·영업관리)
// **또는** 그 견적의 결재 문서 열람 권한(결재자·참조자·관리자). 판정이 실패하면 거절한다.
//
// 응답에 **견적번호·업체명을 함께 담는다**(quoteNumber·companyName). 화면이 열람 기록을
// 남길 때 쓴다(lib/openQuotePdf.tsx) — 예전에는 그 두 칸을 null 로 넣어, 열람 로그만
// 「어느 견적인지」가 비어 있었다(2026-10-28 고침, 다운로드 로그는 처음부터 채웠다).
// 여기서 주는 이유: 결재자처럼 **견적 행을 RLS 로 못 읽는 사람도** 결재 문서 권한으로 PDF 를
// 열 수 있다. 그 사람의 브라우저가 quotes 를 다시 조회하면 0행이라 또 비게 된다. 이 라우트는
// 이미 service role 로 그 행을 읽고 있으므로 조회가 늘지 않는다.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** 이 라우트가 quotes 에서 읽는 칸. 업체명은 customer_id 쪽 관계다(대리점이 아니다). */
type QuoteRow = {
  quote_id: number
  engineer_id: number | null
  pdf_url?: string | null
  quote_number: string | null
  // 임베딩된 관계 — 이 FK 는 다대일이라 **객체 하나**가 온다. 생성 타입이 없는 프로젝트라
  // 클라이언트 쪽 추론은 배열로 보는데(quoteExcel.ts 도 같은 이유로 unknown 을 거친다),
  // 두 모양 다 받아 두고 companyOf 가 하나로 눕힌다.
  customers: { company_name: string | null } | { company_name: string | null }[] | null
}

/** 임베딩된 업체명 한 칸. 객체로 와도 배열로 와도 같은 값을 돌려준다. */
function companyOf(row: QuoteRow | null): string | null {
  const c = row?.customers
  if (!c) return null
  const one = Array.isArray(c) ? c[0] : c
  return one?.company_name ?? null
}

/** 저장값에서 버킷 안의 파일명만 뽑는다. 경로 순회·하위 폴더는 받지 않는다. */
function safeNameOf(raw: string): string | null {
  const stripped = raw.startsWith('quote-pdfs/') ? raw.slice('quote-pdfs/'.length) : raw
  const name = stripped.replace(/\.\./g, '').replace(/^\/+/, '')
  if (!name || name.includes('/')) return null
  return name
}

export async function GET(req: NextRequest) {
  // 인증 확인 — 로그인한 직원만 견적 PDF 서명 URL 발급 가능
  // (middleware는 /api/* 를 통과시키므로 여기서 반드시 세션을 검증한다)
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pathParam = req.nextUrl.searchParams.get('path')
  const quoteIdParam = req.nextUrl.searchParams.get('quoteId')
  if (!pathParam && !quoteIdParam) {
    return NextResponse.json({ error: 'path required' }, { status: 400 })
  }

  const { data: callerRow } = await supabaseAdmin
    .from('engineers')
    .select('engineer_id, permission_level, teams')
    .eq('email', user.email!)
    .single()
  const caller = await withTeamPerm(callerRow)
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 대상 견적과 파일명을 찾는다. 두 입구가 여기서 하나로 합쳐진다.
  let quotes: { quote_id: number; engineer_id: number | null }[] = []
  let safePath: string | null = null
  // 열람 기록에 넣을 값 — 찾은 견적의 것. 못 찾으면 null 로 남는다(종전과 같다).
  let quoteNumber: string | null = null
  let companyName: string | null = null

  if (quoteIdParam) {
    const quoteId = Number(quoteIdParam)
    if (!Number.isSafeInteger(quoteId) || quoteId <= 0) {
      return NextResponse.json({ error: 'Invalid quoteId' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin
      .from('quotes')
      .select('quote_id, engineer_id, pdf_url, quote_number, customers:customer_id ( company_name )')
      .eq('quote_id', quoteId)
      .maybeSingle()
    if (error) {
      console.error('[quote-pdf] 견적 조회 실패', { quoteId, error })
      return NextResponse.json({ error: '견적을 불러오지 못했습니다.' }, { status: 500 })
    }
    const row = (data ?? null) as unknown as QuoteRow | null
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    quotes = [{ quote_id: row.quote_id, engineer_id: row.engineer_id }]
    quoteNumber = row.quote_number ?? null
    companyName = companyOf(row)
    // 권한을 먼저 보고, 파일이 없는 것은 그 뒤에 알린다 — 없는 파일로 남의 견적 존재를 알리지 않는다.
    if (!(await canOpenAnyQuotePdf(supabaseAdmin, caller, quotes))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // 외부(synology 등) URL 은 그대로 돌려준다 — 옛 데이터에 그 꼴이 있다.
    if (row.pdf_url && (row.pdf_url.startsWith('http') || row.pdf_url.includes('synology'))) {
      return NextResponse.json({ signedUrl: row.pdf_url, quoteNumber, companyName })
    }
    if (!row.pdf_url?.trim()) return NextResponse.json({ error: '견적서 PDF가 없습니다' }, { status: 404 })
    safePath = safeNameOf(row.pdf_url)
    if (!safePath) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  } else {
    safePath = safeNameOf(pathParam!)
    if (!safePath) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
    const { data: quoteRows } = await supabaseAdmin
      .from('quotes')
      .select('quote_id, engineer_id, quote_number, customers:customer_id ( company_name )')
      .eq('pdf_url', `quote-pdfs/${safePath}`)
    if (!quoteRows || quoteRows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const rows = quoteRows as unknown as QuoteRow[]
    quotes = rows.map(r => ({ quote_id: r.quote_id, engineer_id: r.engineer_id }))
    // 한 파일에 여러 견적이 걸려 있으면 **첫 줄**의 번호·업체명을 쓴다. 화면이 들고 있는
    // quote_id 가 그중 어느 것인지 여기서는 알 수 없고(경로로 들어왔다), 같은 파일이면
    // 같은 문서다. 그런 행은 삭제·재확정으로 생기는 드문 경우다.
    quoteNumber = rows[0].quote_number ?? null
    companyName = companyOf(rows[0])
    // 한 파일이 여러 견적에 걸려 있으면 **하나라도** 볼 수 있으면 내준다(quotePdfAccess 설명).
    if (!(await canOpenAnyQuotePdf(supabaseAdmin, caller, quotes))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { data, error } = await supabaseAdmin.storage
    .from('quote-pdfs')
    .createSignedUrl(safePath, 60 * 60)

  if (error || !data) {
    console.error('[quote-pdf] signed url 발급 실패', error)
    return NextResponse.json({ error: '파일을 불러오지 못했습니다.' }, { status: 500 })
  }

  // 감사 로그(열람) — 응답을 붙잡지 않는다. 기록이 늦거나 실패해도 서명 URL 발급과는 무관하고,
  // 기다리면 그만큼 사용자가 PDF 를 늦게 본다(왕복 1회분).
  supabaseAdmin.from('audit_log').insert({
    actor_email: user.email, action: 'READ', table_name: 'quote-pdfs', row_id: safePath,
  }).then(({ error: logErr }) => {
    if (logErr) console.error('[quote-pdf] 감사 로그 기록 실패', logErr)
  }, (e: unknown) => console.error('[quote-pdf] 감사 로그 기록 실패', e))

  return NextResponse.json({ signedUrl: data.signedUrl, quoteNumber, companyName })
}
