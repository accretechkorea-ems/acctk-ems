// 팀 권한 캐시 무효화. 관리자 화면에서 팀 권한을 바꾼 직후 부른다.
//
// 서버(lib/teamPermsServer.ts)는 teams 플래그를 30초 들고 있는다. 관리자가 체크박스를 만지면
// 다음 요청부터 바로 반영돼야 하는데, 팀 저장은 화면에서 Supabase 로 직접 나가 서버를 거치지 않는다.
// 그래서 "캐시만 버려 달라" 는 신호를 받을 자리가 따로 필요하다.
//
// 읽는 것도 쓰는 것도 없다 — 서버 메모리의 캐시를 비우는 것이 전부다.
import { loadCaller } from '@/lib/apiCaller'
import { NextResponse } from 'next/server'
import { invalidateTeamPerms } from '@/lib/teamPermsServer'

export async function POST() {
  // 인증·권한 — 관리자 전용. **이 라우트는 DB 를 읽지도 쓰지도 않는다**(서버 메모리의
  // 팀 권한 캐시만 비운다). 그래서 service role 클라이언트(sb)를 받지 않는다.
  const { error: authErr } = await loadCaller({ kind: 'superadmin' }, { tag: 'team-perms', method: 'POST' })
  if (authErr) return authErr

  invalidateTeamPerms()
  return NextResponse.json({ ok: true })
}
