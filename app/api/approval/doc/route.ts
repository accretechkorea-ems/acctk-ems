// 결재 문서 **한 건** 조회 — 문서 양식 화면(app/approval/doc/[id])이 쓴다.
//
// 왜 목록 라우트를 쓰지 않는가 — 그쪽은 함(box)을 받아 여러 건을 돌려주고, 「내 차례인가」를
// 함에 들어왔는지로만 알려 준다. 주소로 바로 들어오는 화면은 함이 없으므로, 문서 하나를 놓고
// 열람 권한과 동작 가능 여부를 스스로 판정해야 한다.
//
// 판정은 **베끼지 않는다**
//   · 열람  — lib/approval/docAccess.ts 의 canViewApprovalDocument (검토표·이력 라우트와 같은 함수)
//   · 동작  — lib/approval/docActions.ts 의 turnOf·ownerActions
//             (그 안에서 engine 의 actorFor·nextPendingLine·untouched 와 docTypes 의
//              canResubmitDocument 를 그대로 불러 쓴다 — 목록 라우트와 같은 조각이다)
//   최종 권한은 그대로 처리 라우트(/api/approval)에 있다. 여기 플래그는 **버튼을 그릴지**를 정한다.
//
// 이력은 담지 않는다 — 기존 /api/approval/history 를 화면이 따로 부른다(그쪽이 정본이다).
//
// 읽기 전용이다. 상태를 바꾸지 않으므로 조건부 UPDATE 도 캐시도 없다.

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { canViewApprovalDocument } from '@/lib/approval/docAccess'
import { ownerActions, turnOf } from '@/lib/approval/docActions'
import { todayKST } from '@/lib/date'
import type { ApprovalDocument, ApprovalLine, Delegation } from '@/lib/approval/types'

const TAG = 'approval/doc'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

type Caller = {
  engineer_id: number
  permission_level: string | null
  teams: string | null
  resigned_date: string | null
}

/** 화면이 사람 번호를 이름으로 바꾸는 데 쓰는 값 — 목록 화면의 people 맵과 같은 모양이다. */
type Person = { name: string | null; position: string | null; teams: string | null }

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('document_id')
  const documentId = Number(raw)
  if (!raw || !Number.isSafeInteger(documentId) || documentId <= 0) {
    return bad('문서를 지정해주세요.')
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return bad('Unauthorized', 401)

  // 세션 → engineers. 퇴사자는 막는다(결재 라우트의 loadCaller 와 같은 기준).
  const { data: callerRow, error: callerErr } = await supabase
    .from('engineers')
    .select('engineer_id, permission_level, teams, resigned_date')
    .eq('email', user.email)
    .single()
  if (callerErr) console.error(`[${TAG}] caller lookup failed`, { email: user.email, error: callerErr })
  const row = (callerRow ?? null) as Caller | null
  if (!row || row.resigned_date) return bad('Forbidden', 403)

  // 팀 권한을 붙인다 — 「approvals 메뉴 권한자」 줄이 그것 없이는 돌지 않는다(docAccess.ts).
  const caller = await withTeamPerm(row)
  if (!caller) return bad('Forbidden', 403)

  const { data: docRow, error: docErr } = await supabaseAdmin
    .from('approval_documents')
    .select('*, approval_lines(*)')
    .eq('document_id', documentId)
    .maybeSingle()
  if (docErr) {
    console.error(`[${TAG}] document lookup failed`, { documentId, error: docErr })
    return bad('문서를 불러오지 못했습니다.', 500)
  }
  const doc = (docRow ?? null) as (ApprovalDocument & { approval_lines: ApprovalLine[] }) | null
  if (!doc) return bad('문서를 찾을 수 없습니다.', 404)

  // 권한을 **나머지보다 먼저** 본다 — 볼 수 없는 사람의 요청에는 사람 이름·위임 조회가 나가지 않는다.
  // 판정이 실패하면 거짓이다(fail-closed, docAccess.ts).
  if (!(await canViewApprovalDocument(supabaseAdmin, doc, caller))) {
    console.warn(`[${TAG}] 권한 없음`, { documentId, callerId: caller.engineer_id })
    return bad('이 문서를 볼 권한이 없습니다.', 403)
  }

  const lines = [...(doc.approval_lines ?? [])].sort(
    (a, b) => (a.step ?? 99) - (b.step ?? 99) || a.line_id - b.line_id,
  )
  const actionDoc = {
    doc_type: doc.doc_type,
    status: doc.status,
    requester_id: doc.requester_id,
    approval_lines: lines,
  }

  // 지금 차례인 줄에 걸린 위임만 읽는다(목록 라우트가 미결함에서 하는 것과 같다).
  const today = todayKST()
  const pending = lines.find(l => l.kind !== 'cc' && l.state === '대기') ?? null
  const delegations = pending ? await loadDelegations(pending.approver_id, doc.doc_type, today) : []

  const turn = turnOf(actionDoc, caller.engineer_id, delegations, today)
  const isOwner = doc.requester_id === caller.engineer_id
  const owner = ownerActions(actionDoc)

  // 이름이 필요한 사람만 — 기안자 + 결재선 전원(참조 포함) + 실제 처리자(대결이면 대리인).
  const people = await loadPeople([
    doc.requester_id,
    ...lines.map(l => l.approver_id),
    ...lines.map(l => l.acted_by).filter((n): n is number => n != null),
  ])

  return NextResponse.json({
    doc: {
      document_id: doc.document_id,
      doc_type: doc.doc_type,
      doc_no: doc.doc_no,
      title: doc.title,
      status: doc.status,
      requester_id: doc.requester_id,
      division: doc.division,
      summary: doc.summary ?? {},
      target_table: doc.target_table,
      target_id: doc.target_id,
      submitted_at: doc.submitted_at,
      completed_at: doc.completed_at,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      approval_lines: lines,
    },
    people,
    /**
     * 버튼을 그릴지 — 목록 화면과 **같은 규칙**이다(lib/approval/docActions.ts).
     *   approve  — 지금 내 차례다(승인·반려). delegated 면 대결로 남는다.
     *   owner.*  — 상신자 자격. isOwner 가 거짓이면 전부 거짓으로 내린다.
     */
    can: {
      approve: turn.canAct,
      delegated: turn.asDelegate,
      currentApproverId: turn.line?.approver_id ?? null,
      isOwner,
      withdraw: isOwner && owner.withdraw,
      resubmit: isOwner && owner.resubmit,
      discard: isOwner && owner.discard,
    },
  })
}

/** 그 사람에게 걸린, 오늘 유효한 위임. 못 읽어도 본인 결재는 막지 않는다(대리 처리만 못 한다). */
async function loadDelegations(ownerId: number, docType: string, today: string): Promise<Delegation[]> {
  const { data, error } = await supabaseAdmin
    .from('approval_delegations')
    .select('owner_id, delegate_id, start_date, end_date, doc_type')
    .eq('owner_id', ownerId)
    .lte('start_date', today)
    .gte('end_date', today)
  if (error) {
    console.error(`[${TAG}] delegation lookup failed`, { ownerId, error })
    return []
  }
  return ((data ?? []) as Delegation[]).filter(d => d.doc_type === null || d.doc_type === docType)
}

/** 번호 → 이름·직급·팀. 못 읽으면 빈 표 — 화면이 「#12」로 그린다(문서를 막지 않는다). */
async function loadPeople(ids: number[]): Promise<Record<number, Person>> {
  const want = [...new Set(ids.filter(n => Number.isFinite(n)))]
  if (want.length === 0) return {}
  const { data, error } = await supabaseAdmin
    .from('engineers')
    .select('engineer_id, name, position, teams')
    .in('engineer_id', want)
  if (error) {
    console.error(`[${TAG}] people lookup failed`, { error })
    return {}
  }
  const out: Record<number, Person> = {}
  for (const e of (data ?? []) as (Person & { engineer_id: number })[]) {
    out[e.engineer_id] = { name: e.name, position: e.position, teams: e.teams }
  }
  return out
}
