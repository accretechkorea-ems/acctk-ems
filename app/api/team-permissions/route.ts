// 팀의 메뉴 권한 저장. 유지보수 화면의 팀 탭이 이 라우트만 부른다.
//
// 한 번의 저장에서 두 곳을 맞춘다 —
//   1) team_permissions : 화면 판정(사이드바·페이지 가드)이 보는 자료
//   2) teams.can_view_* : DB 의 RLS 함수 has_team_perm() 이 보는 컬럼
// 2번은 1번에서 파생 규칙(lib/menuPerms.ts 의 DERIVED_PERMS)으로 계산한다. 사람이 두 벌을
// 관리하지 않으며, 규칙이 바뀌면 그 표 한 곳만 고치면 된다.
//
// 순서 — 메뉴 권한을 먼저 바꾸고 teams 를 나중에 바꾼다.
//   되돌리기가 실패해 어중간한 상태가 남는다면, 「메뉴는 새 값 · 데이터 권한은 옛 값」 쪽이
//   그 반대보다 안전하다(메뉴는 보이는데 데이터가 안 보일 뿐, 없던 데이터 권한이 생기지 않는다).
//
// service role 로 쓴다 — 팀 권한은 관리자만 바꾸며, 판정 자료 자체가 RLS 에 막히면 안 된다.

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/permissions'
import { invalidateTeamPerms } from '@/lib/teamPermsServer'
import { MENU_BY_KEY, deriveTeamColumns } from '@/lib/menuPerms'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/** 그 팀의 메뉴 권한을 통째로 next 로 바꾼다(지우고 다시 넣는다). 실패하면 에러 메시지. */
async function replaceKeys(teamId: number, next: string[]): Promise<string | null> {
  const del = await supabaseAdmin.from('team_permissions').delete().eq('team_id', teamId)
  if (del.error) return del.error.message
  if (next.length === 0) return null
  const ins = await supabaseAdmin
    .from('team_permissions')
    .insert(next.map(perm_key => ({ team_id: teamId, perm_key })))
  return ins.error ? ins.error.message : null
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 팀 권한을 바꾸는 일은 superadmin 만 한다(팀 플래그와 무관한 계정 등급 판정이다).
  const { data: caller } = await supabase
    .from('engineers')
    .select('permission_level')
    .eq('email', user.email!)
    .single()
  if (!caller || !isSuperAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as { teamId?: unknown; permKeys?: unknown } | null
  const teamId = Number(body?.teamId)
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return NextResponse.json({ error: '팀이 지정되지 않았습니다.' }, { status: 400 })
  }
  if (!Array.isArray(body?.permKeys) || body.permKeys.some(k => typeof k !== 'string')) {
    return NextResponse.json({ error: '권한 목록이 올바르지 않습니다.' }, { status: 400 })
  }

  // 화이트리스트 검증 — 목록에 없는 키와 전원 공개 메뉴는 저장하지 않는다.
  const keys = [...new Set(body.permKeys as string[])]
  const unknown = keys.filter(k => !MENU_BY_KEY[k])
  if (unknown.length > 0) {
    return NextResponse.json({ error: `알 수 없는 권한입니다: ${unknown.join(', ')}` }, { status: 400 })
  }
  const publicKeys = keys.filter(k => MENU_BY_KEY[k].public)
  if (publicKeys.length > 0) {
    return NextResponse.json({ error: `전원 공개 메뉴는 저장 대상이 아닙니다: ${publicKeys.join(', ')}` }, { status: 400 })
  }

  const { data: team, error: teamErr } = await supabaseAdmin
    .from('teams').select('id, name').eq('id', teamId).single()
  if (teamErr || !team) return NextResponse.json({ error: '팀을 찾을 수 없습니다.' }, { status: 404 })

  // 되돌리기용 현재 값. 이것을 못 읽으면 되돌릴 수 없으므로 시작하지 않는다.
  const { data: before, error: beforeErr } = await supabaseAdmin
    .from('team_permissions').select('perm_key').eq('team_id', teamId)
  if (beforeErr) {
    console.error('[team-permissions] snapshot failed', beforeErr)
    return NextResponse.json({ error: '현재 권한을 읽지 못했습니다.' }, { status: 500 })
  }
  const beforeKeys = (before ?? []).map(r => r.perm_key as string)

  // 1) 메뉴 권한 교체
  const err1 = await replaceKeys(teamId, keys)
  if (err1) {
    // 지우기까지만 됐을 수 있으므로 옛 값으로 되돌린다.
    const back = await replaceKeys(teamId, beforeKeys)
    console.error('[team-permissions] replace failed', { teamId, err1, back })
    return NextResponse.json({
      error: back ? '권한 저장에 실패했고 되돌리기도 실패했습니다. 화면을 새로고침해 현재 상태를 확인해주세요.' : '권한 저장에 실패했습니다.',
    }, { status: 500 })
  }

  // 2) RLS 가 읽는 teams 컬럼을 파생 규칙으로 맞춘다(is_special 등 다른 컬럼은 건드리지 않는다).
  const flags = deriveTeamColumns(new Set(keys))
  const { error: err2 } = await supabaseAdmin.from('teams').update(flags).eq('id', teamId)
  if (err2) {
    const back = await replaceKeys(teamId, beforeKeys)
    console.error('[team-permissions] flags update failed', { teamId, err2, back })
    return NextResponse.json({
      error: back ? '권한 저장에 실패했고 되돌리기도 실패했습니다. 화면을 새로고침해 현재 상태를 확인해주세요.' : '권한 저장에 실패했습니다.',
    }, { status: 500 })
  }

  // 서버 캐시(30초)를 즉시 버린다. 브라우저 캐시는 화면이 /api/team-perms 로 따로 버린다.
  invalidateTeamPerms()
  return NextResponse.json({ ok: true, teamId, permKeys: keys, flags })
}
