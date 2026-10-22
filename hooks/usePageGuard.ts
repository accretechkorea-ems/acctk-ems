'use client'

import { usePathname } from 'next/navigation'
import { useMe } from '@/lib/appData/MeProvider'
import { canViewAll, canViewMenu, type EngineerLike, type TeamPerm } from '@/lib/permissions'
import { menuKeyForPath, PUBLIC_MENU } from '@/lib/menuPerms'
import { canAccessSemiContact, SEMI_CONTACT_KEY } from '@/lib/division'

export type GuardEngineer = {
  engineer_id: number
  name: string | null
  teams: string | null
  permission_level: string | null
  /** 사업부 전환 권한(superadmin 과 함께일 때만 뜻이 있다). 못 읽었으면 비어 있다 = false. */
  can_switch_division?: boolean | null
  perm?: TeamPerm | null      // 소속 팀이 켜 둔 메뉴 키 (team_permissions 에서 붙여준다)
}

/**
 * 지금 경로에 걸린 메뉴 권한으로 판정한다. 목록에 없는 경로는 막는다.
 * 접촉 보고서만 사업부도 본다 — 서버 라우트(/api/semi-contact/*)와 같은 함수(canAccessSemiContact)로 판정한다.
 */
function allowsPath(pathname: string, engineer: (EngineerLike & { can_switch_division?: boolean | null }) | null): boolean {
  const key = menuKeyForPath(pathname)
  if (key === null) return false
  if (key === PUBLIC_MENU) return canViewAll(engineer)
  if (key === SEMI_CONTACT_KEY) return canAccessSemiContact(engineer)
  return canViewMenu(engineer, key)
}

/**
 * 페이지 진입 권한 확인 공용 훅.
 * 판정 기준은 경로다 — lib/menuPerms.ts 가 경로 → 메뉴 키를 알고 있으므로
 * 화면은 자기 권한이 무엇인지 적지 않는다(적으면 메뉴와 어긋날 수 있다).
 *
 *   const { engineer, loading, authorized } = usePageGuard()
 *   if (!authorized) return <AccessGate loading={loading} />
 *
 * - loading      : 판정 전(true). 이 동안 페이지 본문을 그리지 않아 잠깐 노출되는 일이 없다.
 * - authorized   : 진입 가능 여부. loading 중에는 항상 false.
 * - engineer     : 로그인 직원 정보(미로그인/미조회면 null).
 *
 * 리다이렉트는 하지 않는다. '/' 가 80 전용이 될 예정이라 무한 리다이렉트를 피하려
 * 미허가 시에는 호출부에서 '접근 권한이 없습니다' 화면(AccessGate)을 렌더한다.
 *
 * **조회하지 않는다.** 본인 정보는 MeProvider 가 앱 당 한 번 읽어 둔 것을 받는다
 * (docs/perf-rules.md 1). 예전에는 이 훅이 화면마다 getUser → engineers → teamPerms
 * 세 단계를 다시 불러, 사이드바가 읽은 것과 똑같은 조회가 한 벌 더 나갔다.
 * 미로그인은 me 가 null 이므로 종전처럼 미허가로 떨어진다(미들웨어가 /login 으로 보낸다).
 */
export function usePageGuard() {
  const pathname = usePathname()
  const { me, loading } = useMe()
  return {
    engineer: me as GuardEngineer | null,
    loading,
    // 판정 전에는 항상 false — 그 동안 화면이 본문을 그리지 않는다.
    authorized: loading ? false : allowsPath(pathname, me),
  }
}
