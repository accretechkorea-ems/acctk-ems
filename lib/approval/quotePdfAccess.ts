// 「그 견적의 PDF 를 열 수 있는 사람인가」 — 서버 전용 공용 판정.
//
// 왜 모았는가. 이 판정은 /api/quote-approval 의 'pdf-data' 안에 있었다. 저장 PDF 를 여는
// 길(/api/quote-pdf)과 그 자리에서 만드는 길이 **열람 범위가 달랐다** — 결재선에 들어온
// 다른 팀 결재자·참조자는 견적 메뉴가 없어 저장 파일을 열 수 없었다. 확정 PDF 를 바로
// 발급하는 체계로 돌아오면서 길이 하나로 합쳐졌으므로, 판정도 한 곳에 둔다.
//
// 서버 전용이다 — service role 클라이언트를 받아 쓴다. 화면에서 import 하지 마라.
// `canViewMenu` 가 제대로 돌려면 **부르는 쪽이 팀 권한을 붙여 넘겨야 한다**
// (lib/teamPermsServer.ts 의 withTeamPerm). 붙이지 않으면 superadmin 만 그 줄을 통과한다.

import type { SupabaseClient } from '@supabase/supabase-js'
import { canViewMenu, canViewSalesMgmt, type EngineerLike } from '@/lib/permissions'
import { canViewApprovalDocument } from '@/lib/approval/docAccess'
import { QUOTE_TARGET_TABLE, QUOTE_TYPE } from '@/lib/approval/quoteApprovalKeys'

const TAG = 'approval/quotePdfAccess'

/** 판정에 필요한 사람 값만. withTeamPerm 을 거친 engineer 를 그대로 넘기면 된다. */
export type PdfAccessCaller = EngineerLike & { engineer_id: number }

/** 판정에 필요한 견적 값만. */
export type PdfAccessQuote = { quote_id: number; engineer_id: number | null }

/**
 * 그 견적의 PDF 를 열 수 있는가 — **두 길 가운데 하나**면 된다.
 *   ① 견적 열람 권한 — 견적 메뉴가 있고, 영업관리이거나 실적 담당자 본인.
 *   ② 결재 문서 열람 권한 — 그 견적의 결재 문서를 볼 수 있는 사람(상신자·결재선 전원·관리자).
 *
 * ② 가 필요한 이유: 결재선에 들어온 다른 팀 사람은 ① 을 통과하지 못하는데, 자기가 결재할
 * 견적서는 봐야 한다(결재 화면의 PDF 버튼).
 *
 * 조회가 실패하면 **거짓**(fail-closed) — 못 읽은 것을 허용으로 떨어뜨리면 남의 견적서가 새어 나간다.
 */
export async function canOpenQuotePdf(
  sb: SupabaseClient,
  caller: PdfAccessCaller,
  quote: PdfAccessQuote,
): Promise<boolean> {
  // ① 견적 열람 권한.
  if (canViewMenu(caller, 'quote') && (canViewSalesMgmt(caller) || quote.engineer_id === caller.engineer_id)) {
    return true
  }
  // ② 그 견적의 결재 문서를 볼 수 있는가.
  const { data, error } = await sb
    .from('approval_documents')
    .select('document_id, requester_id')
    .eq('doc_type', QUOTE_TYPE)
    .eq('target_table', QUOTE_TARGET_TABLE)
    .eq('target_id', quote.quote_id)
  if (error) {
    console.error(`[${TAG}] 문서 조회 실패`, { quoteId: quote.quote_id, error })
    return false
  }
  for (const d of (data ?? []) as { document_id: number; requester_id: number }[]) {
    if (await canViewApprovalDocument(sb, d, caller)) return true
  }
  return false
}

/**
 * 여러 견적이 한 파일을 가리킬 때 — **하나라도 열 수 있으면** 허용이다.
 *
 * 저장 파일은 경로(pdf_url)로 찾는다. 파일 이름이 견적번호라 보통 1:1 이지만 유니크가 아니다
 * (lib/approval/quoteDelete.ts 의 업로드 재시도가 접미사를 붙인다). 그중 내가 볼 수 있는
 * 견적이 있으면 그 파일은 내가 볼 수 있는 문서다.
 */
export async function canOpenAnyQuotePdf(
  sb: SupabaseClient,
  caller: PdfAccessCaller,
  quotes: PdfAccessQuote[],
): Promise<boolean> {
  for (const q of quotes) {
    if (await canOpenQuotePdf(sb, caller, q)) return true
  }
  return false
}
