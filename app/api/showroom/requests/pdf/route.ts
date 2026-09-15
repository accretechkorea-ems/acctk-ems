// 승인서 PDF 열기 — GET ?id=<request_id> → 1시간짜리 서명 URL.
// 버킷(showroom-approvals)이 비공개라 서명 URL 로만 연다(견적서 /api/quote-pdf 와 같은 방식).
// 열 수 있는 사람: 신청자 본인 · superadmin · 요청함을 보는 관리자 팀(canViewAdmin).
// 승인된 신청은 쇼룸을 볼 수 있는 사람(canViewCustomers) 누구나 — 전체기록의 신청으로 만든 기록에서
// [승인서 보기]로 연다. 그 기록의 내용은 이미 모두에게 보이므로 승인서도 같은 범위로 연다.
// 대기중·반려 건은 지금처럼 신청자·관리자만.
// 판정은 service role 로 신청 행을 직접 읽어 코드에서 한다(RLS 에 기대지 않는다).
import { NextRequest, NextResponse } from 'next/server'
import { canViewAdmin, canViewCustomers, isSuperAdmin } from '@/lib/permissions'
import { APPROVAL_BUCKET, DEMO_REQUEST_TYPE, REQUEST_APPROVED } from '@/lib/showroom'
import { admin, bad, loadCaller, approvalPdfName } from '../shared'

const TAG = 'showroom/requests/pdf'

export async function GET(req: NextRequest) {
  const auth = await loadCaller(TAG)
  if (auth.error) return auth.error
  const caller = auth.caller

  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) return bad('신청을 지정해주세요.')

  const sb = admin()
  const { data: row, error } = await sb
    .from('approval_requests').select('request_id, request_type, status, requester_id, pdf_url').eq('request_id', id).maybeSingle()
  if (error) {
    console.error(`[${TAG}] row lookup failed`, { id, error })
    return bad('신청을 불러오지 못했습니다.', 500)
  }
  const r = row as { request_id: number; request_type: string; status: string; requester_id: number; pdf_url: string | null } | null
  if (!r || r.request_type !== DEMO_REQUEST_TYPE) return bad('신청을 찾을 수 없습니다.', 404)
  const allowed = r.requester_id === caller.engineer_id || isSuperAdmin(caller) || canViewAdmin(caller)
    || (r.status === REQUEST_APPROVED && canViewCustomers(caller))
  if (!allowed) return bad('Forbidden', 403)

  const name = approvalPdfName(r.pdf_url)
  if (!name) return bad('승인서가 없습니다.', 404)

  const { data, error: signErr } = await sb.storage.from(APPROVAL_BUCKET).createSignedUrl(name, 60 * 60)
  if (signErr || !data) {
    console.error(`[${TAG}] signed url failed`, { id, name, error: signErr })
    return bad('승인서를 불러오지 못했습니다.', 500)
  }

  // 감사 로그(열람) — 응답을 붙잡지 않는다(견적서 열람과 같은 방식).
  sb.from('audit_log').insert({ actor_email: auth.email, action: 'READ', table_name: APPROVAL_BUCKET, row_id: name })
    .then(({ error: logErr }) => { if (logErr) console.error(`[${TAG}] audit log failed`, logErr) },
      (e: unknown) => console.error(`[${TAG}] audit log failed`, e))

  return NextResponse.json({ signedUrl: data.signedUrl })
}
