// 결재함 「기결문서」 — 세 항목을 한 라우트가 돌려준다. scope 로 갈린다.
//
//   scope=all / open   — **내가 처리한 문서**(옛 규칙 그대로). 내 줄에 도장이 찍혀 있어야 한다.
//   scope=closed       — **종결된 내 문서**. 기안자이거나 결재선(결재·합의)에 든 문서 중 '완료'·'반려'.
//                        내 차례가 오기 전에 반려돼 내 줄이 '대기' 인 채 끝난 문서도 포함한다.
//                        판정은 lib/approval/doneBox.ts (순수 함수 — 스크립트로 검증한다).
//
// 왜 service role 인가 — 대결(위임받아 대신 처리한 건)은 approval_lines.approver_id 가 위임자이고
// acted_by 만 나다. RLS 는 approver_id 본인 기준이라 화면에서 직접 읽으면 대결한 건이 빠진다.
// 그래서 service role 로 acted_by 까지 함께 본다. **호출자 본인의 문서만 판정한다** —
// 아래 모든 질의가 내 번호(requester_id · 내 결재선 줄의 문서 id)로 좁혀져 있다.
//
// scope=closed 의 기간·종류·페이지
//   기간과 종류를 **limit 보다 먼저** 적용한다. 예전에는 줄 50개를 먼저 자르고(LIMIT) 기간은
//   화면에서 걸어서, 기간을 좁히면 「50건 안에 우연히 든 것」만 남았다.
//   종결 시각은 DB 에 한 칸으로 없다('완료'는 completed_at, '반려'는 반려 줄의 acted_at)
//   — 그래서 후보를 작은 칸만 읽어 와 서버에서 계산해 걸고 세운 뒤, 그 페이지의 문서만 통째로 읽는다.
//
// 왼쪽 함 목록의 건수(counts)는 **기간·종류·페이지와 무관하게** 세 항목 전부를 돌려준다
// — 상한 때문에 숫자가 틀리지 않게 하려면 세는 일을 자르는 일과 떼어 놓아야 한다.
//
// 읽기 전용이다. 상태를 바꾸지 않으므로 조건부 UPDATE 도 캐시도 없다.

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { nextPendingLine } from '@/lib/approval/engine'
import { CLOSED_STATUSES, closedBoxRows, type DoneDoc } from '@/lib/approval/doneBox'
import { clampPageNo, clampSize, pageSlice, PAGE_SIZE } from '@/lib/paging'
import { docTypeOf } from '@/lib/approval/docTypes'
import type { ApprovalDocument, ApprovalLine } from '@/lib/approval/types'

const TAG = 'approval/done'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** scope=all·open 이 한 번에 보여주는 최대 건수(옛 동작 그대로). */
const LIMIT = 50

/** `.in()` 한 번에 넣는 id 수 — 질의 문자열이 길어지지 않게 끊는다(이 저장소의 다른 라우트와 같다). */
const CHUNK = 200

/**
 * scope=closed 의 후보 상한. 종결 시각을 서버에서 계산해야 해서 후보는 한 번 가져와야 한다.
 * 작은 칸만 읽으므로(CANDIDATE_SELECT) 가볍고, 기간의 시작으로 이미 좁혀져 있다.
 */
const CANDIDATE_MAX = 2000

/** 후보 단계에서 읽는 칸 — 종결 시각 계산과 종류·기간 판정에 필요한 것만. */
const CANDIDATE_SELECT = 'document_id, doc_type, status, completed_at, updated_at'

/** 종결 상태 — `.in()` 에 넘기는 문자열 배열로 한 번만 만들어 둔다. */
const CLOSED: string[] = [...CLOSED_STATUSES]

type DocWithLines = ApprovalDocument & { approval_lines: ApprovalLine[] }
type Counts = { all: number | null; open: number | null; closed: number | null }
type Candidate = DoneDoc & { document_id: number; doc_type: string }

const chunks = <T>(arr: T[], size = CHUNK): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** 진행률 — 목록이 쓰는 모양 그대로다(결재함 GET 의 withProgress 와 같은 계산). */
function withProgress(docs: DocWithLines[]) {
  return docs.map(d => {
    const lines = [...(d.approval_lines ?? [])].sort(
      (a, b) => (a.step ?? 99) - (b.step ?? 99) || a.line_id - b.line_id,
    )
    const next = nextPendingLine(lines)
    const ordered = lines.filter(l => l.kind !== 'cc')
    return {
      ...d,
      approval_lines: lines,
      progress: {
        total: ordered.length,
        done: ordered.filter(l => l.state !== '대기').length,
        currentStep: next?.step ?? null,
        currentApproverId: next?.approver_id ?? null,
      },
    }
  })
}

/** 내 줄이 **도장 찍힌** 문서 id — 옛 「기결문서」(내가 처리한 문서)의 모집단. */
async function actedDocIds(myId: number): Promise<number[] | null> {
  const { data, error } = await supabaseAdmin
    .from('approval_lines')
    .select('document_id')
    .or(`approver_id.eq.${myId},acted_by.eq.${myId}`)
    .neq('state', '대기')
  if (error) {
    console.error(`[${TAG}] acted line lookup failed`, { myId, error })
    return null
  }
  return [...new Set((data ?? []).map((l: { document_id: number }) => l.document_id))]
}

/**
 * 내 결재선 줄이 있는 문서 id — **줄 상태를 보지 않는다**('대기' 포함). 참조(cc)는 제외.
 * acted_by 도 함께 본다(대결 건 — doneBox.ts 의 hasMyLine 설명과 같은 이유).
 */
async function myLineDocIds(myId: number): Promise<number[] | null> {
  const { data, error } = await supabaseAdmin
    .from('approval_lines')
    .select('document_id')
    .or(`and(approver_id.eq.${myId},kind.neq.cc),acted_by.eq.${myId}`)
  if (error) {
    console.error(`[${TAG}] my line lookup failed`, { myId, error })
    return null
  }
  return [...new Set((data ?? []).map((l: { document_id: number }) => l.document_id))]
}

/**
 * 왼쪽 함 목록에 붙는 세 숫자. 기간·종류·페이지와 무관한 「그 함에 들어 있는 전부」다
 * (boxes.ts 의 itemCount 가 뜻하던 것과 같다). 못 센 항목은 null — 화면이 숫자를 비운다.
 */
async function loadCounts(myId: number): Promise<Counts> {
  const [acted, mine] = await Promise.all([actedDocIds(myId), myLineDocIds(myId)])

  // ── 기결문서 · 기결문서(진행) — 내가 처리한 문서 ──
  // 행은 읽지 않고 센다(head: true). 조각의 id 집합이 서로 겹치지 않으므로 합이 곧 전체 건수다.
  let all: number | null = acted === null ? null : 0
  let open: number | null = acted === null ? null : 0
  for (const part of chunks(acted ?? [])) {
    const [a, o] = await Promise.all([
      supabaseAdmin.from('approval_documents')
        .select('document_id', { count: 'exact', head: true }).in('document_id', part),
      supabaseAdmin.from('approval_documents')
        .select('document_id', { count: 'exact', head: true }).in('document_id', part).eq('status', '진행중'),
    ])
    if (a.error || o.error) {
      console.error(`[${TAG}] acted count failed`, { error: a.error ?? o.error })
      all = null
      open = null
      break
    }
    if (all !== null) all += a.count ?? 0
    if (open !== null) open += o.count ?? 0
  }

  return { all, open, closed: await countClosed(myId, mine) }
}

/**
 * 기결문서(종결) 건수. 기안한 문서와 내 결재선 문서는 겹칠 수 있어(대결로 acted_by 만 나인 건 등)
 * 세는 대신 **id 를 모아 집합 크기**를 센다 — 중복이 두 번 세어지지 않는다.
 */
async function countClosed(myId: number, mine: number[] | null): Promise<number | null> {
  if (mine === null) return null
  const { data: own, error: ownErr } = await supabaseAdmin
    .from('approval_documents')
    .select('document_id')
    .eq('requester_id', myId)
    .in('status', CLOSED)
  if (ownErr) {
    console.error(`[${TAG}] own closed count failed`, { myId, error: ownErr })
    return null
  }
  const ids = new Set((own ?? []).map((d: { document_id: number }) => d.document_id))
  for (const part of chunks(mine)) {
    const { data, error } = await supabaseAdmin
      .from('approval_documents')
      .select('document_id')
      .in('document_id', part)
      .in('status', CLOSED)
    if (error) {
      console.error(`[${TAG}] line closed count failed`, { error })
      return null
    }
    for (const d of (data ?? []) as { document_id: number }[]) ids.add(d.document_id)
  }
  return ids.size
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const scope = sp.get('scope') ?? 'all'
  if (!['all', 'open', 'closed'].includes(scope)) return bad('scope 가 올바르지 않습니다.')

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return bad('Unauthorized', 401)
  const { data: row } = await supabase
    .from('engineers')
    .select('engineer_id, resigned_date')
    .eq('email', user.email)
    .single()
  const me = row as { engineer_id: number; resigned_date: string | null } | null
  if (!me || me.resigned_date) return bad('Forbidden', 403)
  const myId = me.engineer_id

  const counts = await loadCounts(myId)

  if (scope === 'closed') return closedBox(sp, myId, counts)

  // ── scope=all · open — 옛 동작 그대로(내가 처리한 문서, 최근 50건) ──
  const ids = await actedDocIds(myId)
  if (ids === null) return bad('처리한 문서를 불러오지 못했습니다.', 500)
  if (ids.length === 0) return NextResponse.json({ box: 'done', scope, documents: [], total: 0, counts })

  const { data, error } = await supabaseAdmin
    .from('approval_documents')
    .select('*, approval_lines(*)')
    .in('document_id', ids)
    .order('updated_at', { ascending: false })
    .limit(LIMIT)
  if (error) {
    console.error(`[${TAG}] document lookup failed`, error)
    return bad('처리한 문서를 불러오지 못했습니다.', 500)
  }
  const documents = withProgress((data ?? []) as DocWithLines[])
  return NextResponse.json({ box: 'done', scope, documents, total: documents.length, counts })
}

/** scope=closed — 기간·종류를 먼저 걸고, 종결 시각 최신순으로 한 페이지만 돌려준다. */
async function closedBox(sp: URLSearchParams, myId: number, counts: Counts) {
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  const ymd = /^\d{4}-\d{2}-\d{2}$/
  if ((from && !ymd.test(from)) || (to && !ymd.test(to))) return bad('기간이 올바르지 않습니다.')
  if (from && to && from > to) return bad('기간이 올바르지 않습니다.')

  // 종류는 **등록표에 있는 값만** 받는다(docTypes.ts). 'all' 과 빈 값은 전체를 뜻한다.
  const raw = sp.get('doc_type')
  const docType = raw && raw !== 'all' ? raw : null
  if (docType && !docTypeOf(docType)) return bad('문서 종류가 올바르지 않습니다.')

  const size = clampSize(sp.get('size'), PAGE_SIZE)
  const page = clampPageNo(sp.get('page'))

  const mine = await myLineDocIds(myId)
  if (mine === null) return bad('처리한 문서를 불러오지 못했습니다.', 500)

  // 후보를 모은다 — 작은 칸만. 기간의 **시작**만 SQL 로 좁힌다:
  // updated_at 은 종결 시각보다 늦거나 같으므로(종결 뒤에만 더 올라간다) 이 하한은 빠뜨리는 것이 없다.
  // 끝(to)은 updated_at 으로 자르면 안 된다 — 반려 뒤 summary 가 고쳐진 건이 잘려 나간다
  // (쇼룸 사후 신청의 onRevert 가 그렇게 한다).
  const fromIso = from ? from + 'T00:00:00' : null
  const pool: Candidate[] = []

  // ① 내가 기안한 종결 문서
  {
    let q = supabaseAdmin.from('approval_documents').select(CANDIDATE_SELECT)
      .eq('requester_id', myId)
      .in('status', CLOSED)
    if (docType) q = q.eq('doc_type', docType)
    if (fromIso) q = q.gte('updated_at', fromIso)
    const { data, error } = await q.order('updated_at', { ascending: false }).limit(CANDIDATE_MAX)
    if (error) {
      console.error(`[${TAG}] own candidate lookup failed`, { myId, error })
      return bad('처리한 문서를 불러오지 못했습니다.', 500)
    }
    for (const d of (data ?? []) as unknown as Candidate[]) pool.push({ ...d, requester_id: myId })
  }

  // ② 내 결재선에 든 종결 문서 — 내 줄이 '대기' 인 채 끝난 건(내 차례 전에 반려)도 여기 들어온다.
  for (const part of chunks(mine)) {
    let q = supabaseAdmin.from('approval_documents').select(CANDIDATE_SELECT)
      .in('document_id', part)
      .in('status', CLOSED)
    if (docType) q = q.eq('doc_type', docType)
    if (fromIso) q = q.gte('updated_at', fromIso)
    const { data, error } = await q.order('updated_at', { ascending: false }).limit(CANDIDATE_MAX)
    if (error) {
      console.error(`[${TAG}] line candidate lookup failed`, { error })
      return bad('처리한 문서를 불러오지 못했습니다.', 500)
    }
    // 이 조각은 「내 결재선에 든 문서」다 — 판정 함수가 그 사실을 다시 볼 수 있게 내 줄 하나를 달아 준다.
    for (const d of (data ?? []) as unknown as Candidate[]) {
      pool.push({ ...d, approval_lines: [{ kind: 'approve', approver_id: myId } as ApprovalLine] })
    }
  }

  if (pool.length >= CANDIDATE_MAX) {
    console.warn(`[${TAG}] 후보 상한에 닿았다 — 기간을 좁혀야 한다`, { myId, max: CANDIDATE_MAX })
  }

  // '반려' 건의 종결 시각은 반려 줄의 acted_at 이다. 후보 가운데 반려 건만 그 값을 읽어 붙인다.
  const rejectedAt = await loadRejectedAt(pool)
  const withAt = pool.map(d => (d.status === '반려' && rejectedAt.has(d.document_id)
    ? { ...d, approval_lines: [{ state: '반려', acted_at: rejectedAt.get(d.document_id) } as ApprovalLine] }
    : d))

  // 판정·중복 제거·기간·종류·정렬 — 전부 순수 함수가 한다(스크립트로 검증한다).
  const kept = closedBoxRows(withAt, { myId, from: from || undefined, to: to || undefined, docType })
  const total = kept.length
  const ids = pageSlice(kept, page, size).map(d => d.document_id)
  if (ids.length === 0) {
    return NextResponse.json({ box: 'done', scope: 'closed', documents: [], total, page, size, counts })
  }

  // 그 페이지의 문서만 통째로 읽는다(결재선 포함 — 목록이 진행률을 그린다).
  const { data, error } = await supabaseAdmin
    .from('approval_documents')
    .select('*, approval_lines(*)')
    .in('document_id', ids)
  if (error) {
    console.error(`[${TAG}] closed document lookup failed`, { error })
    return bad('처리한 문서를 불러오지 못했습니다.', 500)
  }
  // 다시 읽어 온 순서는 보장되지 않는다 — 방금 정한 순서대로 세운다.
  const byId = new Map(withProgress((data ?? []) as DocWithLines[]).map(d => [d.document_id, d]))
  const documents = ids.map(id => byId.get(id)).filter((d): d is NonNullable<typeof d> => !!d)

  return NextResponse.json({ box: 'done', scope: 'closed', documents, total, page, size, counts })
}

/**
 * 반려 건의 반려 시각 — 문서마다 가장 늦은 것. 못 읽으면 거기까지만 돌려주고,
 * 그 문서는 closedAtOf 가 updated_at 으로 떨어진다(목록을 막지 않는다).
 */
async function loadRejectedAt(pool: Candidate[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const ids = [...new Set(pool.filter(d => d.status === '반려').map(d => d.document_id))]
  for (const part of chunks(ids)) {
    const { data, error } = await supabaseAdmin
      .from('approval_lines')
      .select('document_id, acted_at')
      .in('document_id', part)
      .eq('state', '반려')
    if (error) {
      console.error(`[${TAG}] rejected line lookup failed`, { error })
      return out
    }
    for (const l of (data ?? []) as { document_id: number; acted_at: string | null }[]) {
      if (!l.acted_at) continue
      const prev = out.get(l.document_id)
      if (!prev || l.acted_at > prev) out.set(l.document_id, l.acted_at)
    }
  }
  return out
}
