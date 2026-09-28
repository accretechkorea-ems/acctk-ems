// 승인서 PDF 열기 — GET ?id=<request_id> 또는 ?doc=<document_id> → 1시간짜리 서명 URL.
// 버킷(showroom-approvals)이 비공개라 서명 URL 로만 연다(견적서 /api/quote-pdf 와 같은 방식).
//
// id  — 옛 요청함 신청(approval_requests). 열 수 있는 사람: 신청자 본인 · superadmin · approvals 권한.
//       승인된 신청은 쇼룸을 볼 수 있는 사람 누구나 — 전체기록의 신청으로 만든 기록에서 연다.
// doc — 전자결재로 올린 신청(approval_documents, 4단계). 경로는 summary.pdf_url 에 있다.
//       열 수 있는 사람: 상신자 · 결재선에 있는 사람 · superadmin · approvals 권한,
//       그리고 완료된 건은 쇼룸을 볼 수 있는 사람 누구나(기록이 이미 모두에게 보이므로 같은 범위).
//
// 판정은 service role 로 행을 직접 읽어 코드에서 한다(RLS 에 기대지 않는다).
import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu, isSuperAdmin } from '@/lib/permissions'
import { APPROVAL_BUCKET, DEMO_REQUEST_TYPE, REQUEST_APPROVED } from '@/lib/showroom'
import { admin, bad, loadCaller, approvalPdfName } from '../shared'

const TAG = 'showroom/requests/pdf'

export async function GET(req: NextRequest) {
  const auth = await loadCaller(TAG)
  if (auth.error) return auth.error
  const caller = auth.caller

  const sb = admin()

  // ── 전자결재로 올린 신청 ──
  const docId = Number(req.nextUrl.searchParams.get('doc'))
  if (Number.isInteger(docId) && docId > 0) {
    const { data: row, error } = await sb
      .from('approval_documents')
      .select('document_id, doc_type, status, requester_id, summary, approval_lines(approver_id)')
      .eq('document_id', docId)
      .maybeSingle()
    if (error) {
      console.error(`[${TAG}] document lookup failed`, { docId, error })
      return bad('신청을 불러오지 못했습니다.', 500)
    }
    const d = row as {
      doc_type: string
      status: string
      requester_id: number
      summary: { pdf_url?: string | null } | null
      approval_lines: { approver_id: number }[]
    } | null
    if (!d || d.doc_type !== 'showroom_usage') return bad('신청을 찾을 수 없습니다.', 404)
    const inLine = (d.approval_lines ?? []).some(l => l.approver_id === caller.engineer_id)
    const allowed = d.requester_id === caller.engineer_id || inLine || isSuperAdmin(caller)
      || canViewMenu(caller, 'approvals')
      || (d.status === '완료' && canViewMenu(caller, 'showroom'))
    if (!allowed) return bad('Forbidden', 403)
    return signed(sb, d.summary?.pdf_url ?? null, auth.email, docId)
  }

  // ── 옛 요청함 신청 ──
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) return bad('신청을 지정해주세요.')

  const { data: row, error } = await sb
    .from('approval_requests').select('request_id, request_type, status, requester_id, pdf_url').eq('request_id', id).maybeSingle()
  if (error) {
    console.error(`[${TAG}] row lookup failed`, { id, error })
    return bad('신청을 불러오지 못했습니다.', 500)
  }
  const r = row as { request_id: number; request_type: string; status: string; requester_id: number; pdf_url: string | null } | null
  if (!r || r.request_type !== DEMO_REQUEST_TYPE) return bad('신청을 찾을 수 없습니다.', 404)
  const allowed = r.requester_id === caller.engineer_id || isSuperAdmin(caller) || canViewMenu(caller, 'approvals')
    || (r.status === REQUEST_APPROVED && canViewMenu(caller, 'showroom'))
  if (!allowed) return bad('Forbidden', 403)

  return signed(sb, r.pdf_url, auth.email, id)
}

/** 저장 경로 → 서명 URL. 감사 로그도 여기서 남긴다(옛 신청·결재 문서 공통). */
async function signed(sb: ReturnType<typeof admin>, pdfUrl: string | null, email: string | null, id: number) {
  const name = approvalPdfName(pdfUrl)
  if (!name) return bad('승인서가 없습니다.', 404)

  const { data, error } = await sb.storage.from(APPROVAL_BUCKET).createSignedUrl(name, 60 * 60)
  if (error || !data) {
    console.error(`[${TAG}] signed url failed`, { id, name, error })
    return bad('승인서를 불러오지 못했습니다.', 500)
  }

  // 감사 로그(열람) — 응답을 붙잡지 않는다(견적서 열람과 같은 방식).
  sb.from('audit_log').insert({ actor_email: email, action: 'READ', table_name: APPROVAL_BUCKET, row_id: name })
    .then(({ error: logErr }) => { if (logErr) console.error(`[${TAG}] audit log failed`, logErr) },
      (e: unknown) => console.error(`[${TAG}] audit log failed`, e))

  return NextResponse.json({ signedUrl: data.signedUrl })
}
