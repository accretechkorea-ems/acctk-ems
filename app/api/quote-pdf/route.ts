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

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

  if (quoteIdParam) {
    const quoteId = Number(quoteIdParam)
    if (!Number.isSafeInteger(quoteId) || quoteId <= 0) {
      return NextResponse.json({ error: 'Invalid quoteId' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin
      .from('quotes')
      .select('quote_id, engineer_id, pdf_url')
      .eq('quote_id', quoteId)
      .maybeSingle()
    if (error) {
      console.error('[quote-pdf] 견적 조회 실패', { quoteId, error })
      return NextResponse.json({ error: '견적을 불러오지 못했습니다.' }, { status: 500 })
    }
    const row = (data ?? null) as { quote_id: number; engineer_id: number | null; pdf_url: string | null } | null
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    quotes = [{ quote_id: row.quote_id, engineer_id: row.engineer_id }]
    // 권한을 먼저 보고, 파일이 없는 것은 그 뒤에 알린다 — 없는 파일로 남의 견적 존재를 알리지 않는다.
    if (!(await canOpenAnyQuotePdf(supabaseAdmin, caller, quotes))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // 외부(synology 등) URL 은 그대로 돌려준다 — 옛 데이터에 그 꼴이 있다.
    if (row.pdf_url && (row.pdf_url.startsWith('http') || row.pdf_url.includes('synology'))) {
      return NextResponse.json({ signedUrl: row.pdf_url })
    }
    if (!row.pdf_url?.trim()) return NextResponse.json({ error: '견적서 PDF가 없습니다' }, { status: 404 })
    safePath = safeNameOf(row.pdf_url)
    if (!safePath) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  } else {
    safePath = safeNameOf(pathParam!)
    if (!safePath) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
    const { data: quoteRows } = await supabaseAdmin
      .from('quotes')
      .select('quote_id, engineer_id')
      .eq('pdf_url', `quote-pdfs/${safePath}`)
    if (!quoteRows || quoteRows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    quotes = quoteRows as { quote_id: number; engineer_id: number | null }[]
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

  return NextResponse.json({ signedUrl: data.signedUrl })
}
