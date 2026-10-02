// 결재 위임 등록·조회·해제.
//
// 엔진은 위임을 이미 전부 반영한다 — 대신 처리할 자격(engine.ts 의 actorFor), 대결·전결 기록,
// 미결함에 위임 건 포함(app/api/approval/route.ts), 첫 차례 알림(lib/approval/submit.ts),
// 승인서 도장의 대리인 이름(lib/approval/showroomUsage.ts). 없던 것은 **표에 행을 넣는 길**뿐이고
// 이 라우트가 그 하나를 맡는다. 판정 로직은 건드리지 않는다.
//
// 인증·응답은 개인 결재선(app/api/approval/presets/route.ts)과 같은 모양이다 —
// 세션 클라이언트로 로그인·재직을 확인하고, 쓰기는 service role 로 한다
// (approval_delegations 에는 읽기 정책만 있다).
//
// 행위자는 세션에서 정한다. 본문의 owner_id 는 superadmin 일 때만 읽고, 그 밖에는 본인으로 강제한다.
//
// 검증(기간 겹침·사슬)은 DB 를 모르는 순수 함수에 두었다(lib/approval/delegation.ts) —
// 화면이 같은 함수를 쓸 수 있고, 스크립트로 그대로 돌려 볼 수 있다.

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/permissions'
import { todayKST } from '@/lib/date'
import { APPROVAL_PATH } from '@/lib/approval/types'
import {
  delegationStatus, periodLabel, scopeLabel, validateDelegationInput,
  type DelegationInput, type DelegationRow,
} from '@/lib/approval/delegation'

const TAG = 'approval/delegations'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

const ROW_COLUMNS = 'delegation_id, owner_id, delegate_id, start_date, end_date, doc_type, reason, created_at'

type Caller = { engineer_id: number; permission_level: string | null }

/** 세션 → engineers. 퇴사자는 막는다. superadmin 판정에 permission_level 을 함께 읽는다. */
async function loadCaller(): Promise<{ caller: Caller; error: null } | { caller: null; error: NextResponse }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { caller: null, error: bad('Unauthorized', 401) }
  const { data: row } = await supabase
    .from('engineers')
    .select('engineer_id, permission_level, resigned_date')
    .eq('email', user.email)
    .single()
  const me = row as Caller & { resigned_date: string | null } | null
  if (!me || me.resigned_date) return { caller: null, error: bad('Forbidden', 403) }
  return { caller: { engineer_id: me.engineer_id, permission_level: me.permission_level }, error: null }
}

type Person = { engineer_id: number; name: string | null; position: string | null }

/** 번호 → 「이름 직급」. 없는 번호는 #번호로 둔다(지워진 계정이 섞여도 화면이 비지 않게). */
function namer(people: Person[]): (id: number) => string {
  const map = new Map(people.map(p => [p.engineer_id, p]))
  return (id: number) => {
    const p = map.get(id)
    if (!p) return `#${id}`
    return [p.name ?? `#${id}`, p.position ?? ''].filter(Boolean).join(' ')
  }
}

/** 이름을 붙이고 상태를 계산한 행 — 화면이 그대로 그린다. */
function decorate(rows: DelegationRow[], people: Person[], today: string) {
  const nameOf = namer(people)
  const map = new Map(people.map(p => [p.engineer_id, p]))
  return rows.map(r => ({
    ...r,
    owner_name: map.get(r.owner_id)?.name ?? null,
    owner_position: map.get(r.owner_id)?.position ?? null,
    owner_label: nameOf(r.owner_id),
    delegate_name: map.get(r.delegate_id)?.name ?? null,
    delegate_position: map.get(r.delegate_id)?.position ?? null,
    delegate_label: nameOf(r.delegate_id),
    scope_label: scopeLabel(r.doc_type),
    status: delegationStatus(r, today),
  }))
}

/**
 * 감사 기록 한 줄. 방식은 writeLeadAudit(app/api/lead-manage/route.ts) ·
 * writeInquiryAudit(app/api/inquiry/route.ts) 과 같다 — 기록 실패는 처리 결과를 막지 않는다.
 */
async function writeDelegationAudit(opts: {
  action: 'APPROVAL_DELEGATION_CREATE' | 'APPROVAL_DELEGATION_DELETE'
  actorId: number
  delegationId: number
  oldData?: Record<string, unknown> | null
  newData?: Record<string, unknown> | null
}) {
  const { data: actor, error: actorErr } = await supabaseAdmin
    .from('engineers').select('email, name').eq('engineer_id', opts.actorId).maybeSingle()
  if (actorErr) console.error(`[${TAG}] actor lookup failed`, { actorId: opts.actorId, error: actorErr })
  const who = (actor ?? null) as { email: string | null; name: string | null } | null

  const { error } = await supabaseAdmin.from('audit_log').insert({
    actor_email: who?.email ?? null,
    action: opts.action,
    table_name: 'approval_delegations',
    row_id: String(opts.delegationId),
    old_data: opts.oldData ?? null,
    new_data: opts.newData
      ? { ...opts.newData, by: opts.actorId, by_name: who?.name ?? null }
      : { by: opts.actorId, by_name: who?.name ?? null },
  })
  if (error) console.error(`[${TAG}] audit insert failed`, { action: opts.action, delegationId: opts.delegationId, error })
}

/** 알림 한 줄. 실패해도 처리 결과를 막지 않는다(결재 알림과 같은 규칙). */
async function notify(engineerId: number, title: string, message: string, type: string) {
  const { error } = await supabaseAdmin.from('notifications').insert({
    engineer_id: engineerId,
    title,
    message,
    type,
    link: APPROVAL_PATH,
    is_read: false,
  })
  if (error) console.error(`[${TAG}] notification insert failed`, { engineerId, type, error })
}

// ── GET — 내가 맡긴 위임 · 내가 대리 결재를 맡은 위임 ────────────────────────
export async function GET(req: Request) {
  const { caller, error: authErr } = await loadCaller()
  if (authErr) return authErr

  // superadmin 은 남의 위임도 본다(?owner=). 그 밖에는 본인 것만이다.
  const rawOwner = new URL(req.url).searchParams.get('owner')
  let ownerId = caller.engineer_id
  if (rawOwner !== null && rawOwner !== '') {
    const n = Number(rawOwner)
    if (!Number.isInteger(n) || n <= 0) return bad('위임자가 올바르지 않습니다.')
    if (n !== caller.engineer_id && !isSuperAdmin(caller)) return bad('Forbidden', 403)
    ownerId = n
  }

  // 맡긴 것과 맡은 것을 한 번에 읽고 코드에서 가른다 — 왕복을 둘로 늘리지 않는다.
  const { data, error } = await supabaseAdmin
    .from('approval_delegations')
    .select(ROW_COLUMNS)
    .or(`owner_id.eq.${ownerId},delegate_id.eq.${ownerId}`)
    .order('start_date', { ascending: false })
  if (error) {
    console.error(`[${TAG}] list failed`, { ownerId, error })
    return bad('위임 목록을 불러오지 못했습니다.', 500)
  }
  const rows = (data ?? []) as DelegationRow[]

  // 이름·직급은 engineers 를 따로 읽어 붙인다. approval_delegations → engineers 는 FK 가 두 개
  // (owner_id·delegate_id)라 임베딩하면 PostgREST 가 어느 쪽인지 묻는다(PGRST201) —
  // 제약 이름을 적는 대신 한 번 더 읽는다. 행 수가 적어 비용 차이가 없다.
  const ids = [...new Set(rows.flatMap(r => [r.owner_id, r.delegate_id]))]
  let people: Person[] = []
  if (ids.length > 0) {
    const { data: engs, error: engErr } = await supabaseAdmin
      .from('engineers').select('engineer_id, name, position').in('engineer_id', ids)
    if (engErr) console.error(`[${TAG}] engineer lookup failed`, { ownerId, error: engErr })
    people = (engs ?? []) as Person[]
  }

  const today = todayKST()
  const decorated = decorate(rows, people, today)
  return NextResponse.json({
    ownerId,
    today,
    /** 내가(또는 고른 사람이) 남에게 맡긴 위임. */
    given: decorated.filter(r => r.owner_id === ownerId),
    /** 내가 대리 결재를 맡은 위임 — 읽기 전용이다(해제는 맡긴 사람이 한다). */
    received: decorated.filter(r => r.delegate_id === ownerId),
  })
}

// ── POST — 등록 ──────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const { caller, error: authErr } = await loadCaller()
  if (authErr) return authErr

  const body = await req.json().catch(() => null) as Record<string, unknown> | null

  // 위임자 — 본인이 기본이고, 다른 사람을 지정하는 것은 superadmin 만 할 수 있다.
  let ownerId = caller.engineer_id
  if (body?.owner_id != null && body.owner_id !== '') {
    const n = Number(body.owner_id)
    if (!Number.isInteger(n) || n <= 0) return bad('위임자가 올바르지 않습니다.')
    if (n !== caller.engineer_id && !isSuperAdmin(caller)) return bad('남의 위임은 지정할 수 없습니다.', 403)
    ownerId = n
  }

  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  const input: DelegationInput = {
    ownerId,
    delegateId: Number(body?.delegate_id),
    startDate: typeof body?.start_date === 'string' ? body.start_date : '',
    endDate: typeof body?.end_date === 'string' ? body.end_date : '',
    docType: body?.doc_type == null || body.doc_type === '' ? null : String(body.doc_type),
    reason: reason || null,
  }

  const today = todayKST()

  // 재직자 명단 — 대리인 자격과 거절 메시지의 이름에 함께 쓴다.
  const { data: engs, error: engErr } = await supabaseAdmin
    .from('engineers').select('engineer_id, name, position, resigned_date')
  if (engErr) {
    console.error(`[${TAG}] engineers lookup failed`, engErr)
    return bad('직원 목록을 확인하지 못했습니다.', 500)
  }
  type Row = Person & { resigned_date: string | null }
  const all = (engs ?? []) as Row[]
  const activeIds = new Set(all.filter(e => !e.resigned_date).map(e => e.engineer_id))

  // 겹칠 수 있는 기존 위임만 읽는다 — 새 기간이 시작하기 전에 끝난 위임은 겹칠 수 없다
  // (겹침의 필요조건이 r.end_date >= 새 시작일이다). 반대쪽 조건은 순수 함수가 다시 본다.
  const since = input.startDate && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ? input.startDate : today
  const { data: existing, error: exErr } = await supabaseAdmin
    .from('approval_delegations')
    .select(ROW_COLUMNS)
    .gte('end_date', since)
  if (exErr) {
    console.error(`[${TAG}] existing lookup failed`, { ownerId, error: exErr })
    return bad('기존 위임을 확인하지 못했습니다.', 500)
  }

  const problem = validateDelegationInput(input, {
    today,
    activeIds,
    existing: (existing ?? []) as DelegationRow[],
    nameOf: namer(all),
  })
  if (problem) return bad(problem)

  const { data: created, error } = await supabaseAdmin
    .from('approval_delegations')
    .insert({
      owner_id: input.ownerId,
      delegate_id: input.delegateId,
      start_date: input.startDate,
      end_date: input.endDate,
      doc_type: input.docType,
      reason: input.reason,
    })
    .select(ROW_COLUMNS)
    .single()
  if (error || !created) {
    console.error(`[${TAG}] insert failed`, { input, error })
    return bad('위임을 등록하지 못했습니다.', 500)
  }
  const row = created as DelegationRow

  const nameOf = namer(all)
  const period = periodLabel(row.start_date, row.end_date)
  const scope = scopeLabel(row.doc_type)

  await writeDelegationAudit({
    action: 'APPROVAL_DELEGATION_CREATE',
    actorId: caller.engineer_id,
    delegationId: row.delegation_id,
    newData: {
      owner_id: row.owner_id, owner_name: nameOf(row.owner_id),
      delegate_id: row.delegate_id, delegate_name: nameOf(row.delegate_id),
      period, scope, doc_type: row.doc_type, reason: row.reason,
    },
  })

  await notify(
    row.delegate_id,
    '결재를 위임받았습니다',
    `${nameOf(row.owner_id)}님이 ${period}에 결재를 위임했습니다 (${scope})`,
    'approval_delegated',
  )

  const [decorated] = decorate([row], all, today)
  return NextResponse.json({ ok: true, delegation: decorated })
}

// ── DELETE — 해제 ────────────────────────────────────────────────────────────
// 행을 지운다. 결재 이력은 approval_history·approval_lines 에 행위자 번호(acted_by)로 남아 있어
// 위임 행을 지워도 「누가 대신 처리했는지」는 그대로다 — 그래서 상태 컬럼을 두지 않고 지운다.
export async function DELETE(req: Request) {
  const { caller, error: authErr } = await loadCaller()
  if (authErr) return authErr

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const id = Number(body?.id)
  if (!Number.isInteger(id) || id <= 0) return bad('해제할 위임을 지정해주세요.')

  const { data: row, error: rowErr } = await supabaseAdmin
    .from('approval_delegations')
    .select(ROW_COLUMNS)
    .eq('delegation_id', id)
    .maybeSingle()
  if (rowErr) {
    console.error(`[${TAG}] lookup failed`, { id, error: rowErr })
    return bad('위임을 불러오지 못했습니다.', 500)
  }
  const target = (row ?? null) as DelegationRow | null
  if (!target) return bad('위임을 찾을 수 없습니다.', 404)
  // 맡긴 사람 본인 또는 superadmin 만 해제한다 — 대리인이 스스로 떼어낼 수는 없다.
  if (target.owner_id !== caller.engineer_id && !isSuperAdmin(caller)) {
    return bad('본인이 맡긴 위임만 해제할 수 있습니다.', 403)
  }

  const { data: gone, error } = await supabaseAdmin
    .from('approval_delegations')
    .delete()
    .eq('delegation_id', id)
    .select('delegation_id')
  if (error) {
    console.error(`[${TAG}] delete failed`, { id, error })
    return bad('해제하지 못했습니다.', 500)
  }
  if (!gone || gone.length === 0) return bad('이미 해제된 위임입니다.', 409)

  const { data: engs, error: engErr } = await supabaseAdmin
    .from('engineers').select('engineer_id, name, position')
    .in('engineer_id', [target.owner_id, target.delegate_id])
  if (engErr) console.error(`[${TAG}] engineer lookup failed`, { id, error: engErr })
  const nameOf = namer((engs ?? []) as Person[])
  const period = periodLabel(target.start_date, target.end_date)
  const scope = scopeLabel(target.doc_type)

  await writeDelegationAudit({
    action: 'APPROVAL_DELEGATION_DELETE',
    actorId: caller.engineer_id,
    delegationId: target.delegation_id,
    oldData: {
      owner_id: target.owner_id, owner_name: nameOf(target.owner_id),
      delegate_id: target.delegate_id, delegate_name: nameOf(target.delegate_id),
      period, scope, doc_type: target.doc_type, reason: target.reason,
    },
  })

  await notify(
    target.delegate_id,
    '위임이 해제되었습니다',
    `${nameOf(target.owner_id)}님의 결재 위임(${period} · ${scope})이 해제되었습니다`,
    'approval_delegation_ended',
  )

  return NextResponse.json({ ok: true, id })
}
