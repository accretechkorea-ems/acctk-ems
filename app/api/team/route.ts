// 팀 추가·수정·삭제 — **서버에서만** (2026-11-23).
//
// 왜 옮겼나
//   종전에는 관리 화면이 브라우저 열쇠로 teams 에 직접 insert/update/delete 했다. RLS 는
//   superadmin 으로 조여 있었지만(teams_rls_policy.sql) 그 앞단의 **표 권한**이 빠져 있어
//   2026-11-23 운영에서 팀 추가가 「permission denied for table teams」로 멈췄다. 급한 대로
//   authenticated 에게 표 권한을 열어 두었고, 그 자리를 이 라우트가 대신한다 —
//   쓰기는 service role 로 하고, 자격은 여기서 본다(「쓰기는 service role 라우트에서만」).
//   열어 둔 표 권한을 걷는 SQL 은 db/team_division_switch_20261123.sql 끝에 있다.
//
// 무엇을 다루나
//   name · display_order · in_sales_stats · can_switch_division · division.
//   **메뉴 권한은 다루지 않는다** — team_permissions 와 teams.can_view_* 를 파생 규칙으로
//   함께 맞춰야 해서 /api/team-permissions 가 따로 맡는다. 화면은 팀을 만든 뒤 그 라우트를 부른다.
//
// 지우기
//   팀 삭제는 **되돌릴 수 없다**(행이 사라진다). 그래서 재직 중인 소속 직원이 있으면 막는다 —
//   engineers.teams 가 이름 문자열이라 FK 가 없고, 지우면 그 사람들의 팀 권한이 통째로 날아간다.
//   퇴사자는 과거 실적 집계 때문에 팀 이름을 들고 있으므로 세지 않는다(화면과 같은 규칙).

import { NextResponse } from 'next/server'
import { adminClient, loadCaller } from '@/lib/apiCaller'
import { writeAdminEvent } from '@/lib/adminEvents'
import { invalidateTeamPerms } from '@/lib/teamPermsServer'
import { isDivision, isMissingSwitchColumn } from '@/lib/division'

const supabaseAdmin = adminClient()

const TEAM_NAME_MAX = 40

type Body = {
  teamId?: unknown
  name?: unknown
  in_sales_stats?: unknown
  can_switch_division?: unknown
  division?: unknown
}

const readBody = async (req: Request): Promise<Body | null> =>
  (await req.json().catch(() => null)) as Body | null

/** 몸통에서 팀 번호를 읽는다. 없거나 이상하면 null. */
function teamIdOf(body: Body | null): number | null {
  const id = Number(body?.teamId)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** 참/거짓 칸만 추려 담는다 — 안 보낸 칸은 건드리지 않는다. */
function flagsOf(body: Body | null): Record<string, boolean | string> {
  const patch: Record<string, boolean | string> = {}
  if (typeof body?.in_sales_stats === 'boolean') patch.in_sales_stats = body.in_sales_stats
  if (typeof body?.can_switch_division === 'boolean') patch.can_switch_division = body.can_switch_division
  if (isDivision(body?.division)) patch.division = body.division
  return patch
}

/** teams.can_switch_division 칸이 아직 없을 때(판정은 lib/division.ts 의 isMissingSwitchColumn). */
const MISSING_COLUMN_MESSAGE =
  '사업부 전환 권한을 쓰려면 db/team_division_switch_20261123.sql 을 먼저 적용해야 합니다'

/** 팀 추가. 순서(display_order)는 서버가 정한다 — 화면이 센 값은 다른 사람이 만든 팀을 모른다. */
export async function POST(req: Request) {
  const { error: authErr, caller } = await loadCaller({ kind: 'superadmin' }, { tag: 'team', method: 'POST' })
  if (authErr) return authErr

  const body = await readBody(req)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: '팀 이름을 입력해주세요.' }, { status: 400 })
  if (name.length > TEAM_NAME_MAX) {
    return NextResponse.json({ error: `팀 이름은 ${TEAM_NAME_MAX}자까지 쓸 수 있습니다.` }, { status: 400 })
  }

  const { data: dup } = await supabaseAdmin.from('teams').select('id').eq('name', name).maybeSingle()
  if (dup) return NextResponse.json({ error: `'${name}' 팀이 이미 있습니다.` }, { status: 409 })

  const { data: last } = await supabaseAdmin
    .from('teams').select('display_order').order('display_order', { ascending: false }).limit(1).maybeSingle()
  const nextOrder = Number(last?.display_order ?? 0) + 1

  const { data: created, error } = await supabaseAdmin
    .from('teams')
    .insert({ name, display_order: nextOrder, ...flagsOf(body) })
    .select('id, name, display_order, division, in_sales_stats, can_switch_division')
    .single()
  if (error || !created) {
    if (isMissingSwitchColumn(error)) {
      return NextResponse.json({ error: MISSING_COLUMN_MESSAGE }, { status: 503 })
    }
    console.error('[team] insert failed', error)
    return NextResponse.json({ error: '팀을 만들지 못했습니다.' }, { status: 500 })
  }

  // 관리자 기록표에 한 줄 (2026-11-27 야간3 4). 사업부 전환 플래그도 여기 담긴다.
  await writeAdminEvent(supabaseAdmin, {
    actorId: caller.engineer_id, action: 'team_created',
    targetType: 'team', targetId: created.name,
    detail: { division: created.division, in_sales_stats: created.in_sales_stats, can_switch_division: created.can_switch_division },
  })
  invalidateTeamPerms()
  return NextResponse.json({ ok: true, team: created })
}

/** 팀 수정 — 이름과 참/거짓 칸. 보낸 칸만 바꾼다. */
export async function PATCH(req: Request) {
  const { error: authErr } = await loadCaller({ kind: 'superadmin' }, { tag: 'team', method: 'PATCH' })
  if (authErr) return authErr

  const body = await readBody(req)
  const teamId = teamIdOf(body)
  if (teamId === null) return NextResponse.json({ error: '팀이 지정되지 않았습니다.' }, { status: 400 })

  const patch: Record<string, boolean | string> = flagsOf(body)
  if (typeof body?.name === 'string') {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: '팀 이름을 입력해주세요.' }, { status: 400 })
    if (name.length > TEAM_NAME_MAX) {
      return NextResponse.json({ error: `팀 이름은 ${TEAM_NAME_MAX}자까지 쓸 수 있습니다.` }, { status: 400 })
    }
    patch.name = name
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '바꿀 내용이 없습니다.' }, { status: 400 })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('teams').update(patch).eq('id', teamId)
    .select('id, name, display_order, division, in_sales_stats, can_switch_division')
    .single()
  if (error || !updated) {
    if (isMissingSwitchColumn(error)) {
      return NextResponse.json({ error: MISSING_COLUMN_MESSAGE }, { status: 503 })
    }
    console.error('[team] update failed', { teamId, error })
    return NextResponse.json({ error: '팀을 고치지 못했습니다.' }, { status: 500 })
  }

  invalidateTeamPerms()
  return NextResponse.json({ ok: true, team: updated })
}

/** 팀 삭제. 재직 중인 소속 직원이 있으면 막는다. */
export async function DELETE(req: Request) {
  const { error: authErr, caller } = await loadCaller({ kind: 'superadmin' }, { tag: 'team', method: 'DELETE' })
  if (authErr) return authErr

  const body = await readBody(req)
  const teamId = teamIdOf(body)
  if (teamId === null) return NextResponse.json({ error: '팀이 지정되지 않았습니다.' }, { status: 400 })

  const { data: team, error: teamErr } = await supabaseAdmin
    .from('teams').select('id, name').eq('id', teamId).maybeSingle()
  if (teamErr || !team) return NextResponse.json({ error: '팀을 찾을 수 없습니다.' }, { status: 404 })

  const { count, error: countErr } = await supabaseAdmin
    .from('engineers').select('engineer_id', { count: 'exact', head: true })
    .eq('teams', team.name).is('resigned_date', null)
  if (countErr) {
    console.error('[team] member count failed', { teamId, countErr })
    return NextResponse.json({ error: '소속 인원을 세지 못했습니다.' }, { status: 500 })
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json({
      error: `이 팀에 재직 중인 직원이 ${count}명 있습니다. 먼저 직원 팀을 변경해주세요.`,
    }, { status: 409 })
  }

  // 메뉴 권한 행을 먼저 치운다 — 팀이 사라진 뒤에 남으면 아무도 지울 수 없는 줄이 된다.
  const permDel = await supabaseAdmin.from('team_permissions').delete().eq('team_id', teamId)
  if (permDel.error) {
    console.error('[team] perm delete failed', { teamId, error: permDel.error })
    return NextResponse.json({ error: '팀 권한을 지우지 못했습니다.' }, { status: 500 })
  }

  const { error } = await supabaseAdmin.from('teams').delete().eq('id', teamId)
  if (error) {
    console.error('[team] delete failed', { teamId, error })
    return NextResponse.json({ error: '팀을 지우지 못했습니다.' }, { status: 500 })
  }

  await writeAdminEvent(supabaseAdmin, {
    actorId: caller.engineer_id, action: 'team_deleted',
    targetType: 'team', targetId: team.name, detail: { teamId },
  })
  invalidateTeamPerms()
  return NextResponse.json({ ok: true, teamId, name: team.name })
}
