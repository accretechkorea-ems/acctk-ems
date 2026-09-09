// 팀 권한 캐시 무효화. 관리자 화면에서 팀 권한을 바꾼 직후 부른다.
//
// 서버(lib/teamPermsServer.ts)는 teams 플래그를 30초 들고 있는다. 관리자가 체크박스를 만지면
// 다음 요청부터 바로 반영돼야 하는데, 팀 저장은 화면에서 Supabase 로 직접 나가 서버를 거치지 않는다.
// 그래서 "캐시만 버려 달라" 는 신호를 받을 자리가 따로 필요하다.
//
// 읽는 것도 쓰는 것도 없다 — 서버 메모리의 캐시를 비우는 것이 전부다.
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/permissions'
import { invalidateTeamPerms } from '@/lib/teamPermsServer'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('engineers')
    .select('permission_level')
    .eq('email', user.email!)
    .single()
  if (!caller || !isSuperAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  invalidateTeamPerms()
  return NextResponse.json({ ok: true })
}
