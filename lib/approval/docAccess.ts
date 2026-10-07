// 「그 결재 문서를 볼 수 있는 사람인가」 — 서버 전용 공용 판정.
//
// 왜 모았는가. 이 판정은 원래 app/api/quote-approval/route.ts 안에 있었다. 그 라우트의 검토표
// ('review')·PDF 저장값('pdf-data')만 쓰던 판정인데, 결재 이력 조회(app/api/approval/history)가
// 같은 판정을 필요로 해서 한 곳으로 옮겼다. 두 벌로 베끼면 한쪽만 고쳐져 열람 범위가 갈린다.
//
// 이 판정이 무엇을 합친 것인가 — 지금 「그 문서를 볼 수 있는 사람」은 두 곳에 흩어져 있다.
//   ① RLS 정책 `ad_select` (approval_schema.sql:122-128)
//        requester_id = 나  또는  superadmin  또는  그 문서의 approval_lines 에 내가 있다
//   ② 결재함 GET 의 「전체」함 (app/api/approval/route.ts:569)
//        box='all' 은 approvals 메뉴 권한자에게만 열린다 — 남의 문서까지 보는 자리다
// 둘을 합친 것이 「그 문서를 볼 수 있는 사람」이다. lib/approval/engine.ts 는 건드리지 않는다
// (그 파일은 문서를 모르는 순수 판정만 둔다).
//
// 결재선은 **종류를 가리지 않는다** — 참조(cc)로 들어간 사람도 문서를 본다(팀 참조 포함).
//
// 서버 전용이다 — service role 클라이언트를 받아 쓴다. 화면에서 import 하지 마라.
// `canViewMenu(caller, 'approvals')` 가 제대로 돌려면 **부르는 쪽이 팀 권한을 붙여 넘겨야 한다**
// (lib/teamPermsServer.ts 의 withTeamPerm). 붙이지 않으면 superadmin 만 그 줄을 통과한다.

import type { SupabaseClient } from '@supabase/supabase-js'
import { canViewMenu, isSuperAdmin, type EngineerLike } from '@/lib/permissions'

const TAG = 'approval/docAccess'

/** 판정에 필요한 문서 값만. 문서 전체를 넘기지 않아도 된다. */
export type DocAccessRef = { document_id: number; requester_id: number }

/** 판정에 필요한 사람 값만. withTeamPerm 을 거친 engineer 를 그대로 넘기면 된다. */
export type DocAccessCaller = EngineerLike & { engineer_id: number }

/**
 * 그 문서를 볼 수 있는가. 조회가 실패하면 **거짓**(fail-closed) —
 * 열람 판정이 실패를 허용으로 떨어뜨리면 남의 문서가 새어 나간다.
 */
export async function canViewApprovalDocument(
  sb: SupabaseClient,
  doc: DocAccessRef,
  caller: DocAccessCaller,
): Promise<boolean> {
  if (doc.requester_id === caller.engineer_id) return true
  if (isSuperAdmin(caller)) return true
  if (canViewMenu(caller, 'approvals')) return true
  const { data, error } = await sb
    .from('approval_lines')
    .select('line_id')
    .eq('document_id', doc.document_id)
    .eq('approver_id', caller.engineer_id)
    .limit(1)
  if (error) {
    console.error(`[${TAG}] line lookup failed`, { documentId: doc.document_id, error })
    return false
  }
  return !!data && data.length > 0
}
