'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { withTeamPerm } from '@/lib/teamPerms'
import { canViewAll, canViewMenu, type EngineerLike, type TeamPerm } from '@/lib/permissions'
import { menuKeyForPath, PUBLIC_MENU } from '@/lib/menuPerms'

export type GuardEngineer = {
  engineer_id: number
  name: string | null
  teams: string | null
  permission_level: string | null
  perm?: TeamPerm | null      // 소속 팀이 켜 둔 메뉴 키 (team_permissions 에서 붙여준다)
}

/** 지금 경로에 걸린 메뉴 권한으로 판정한다. 목록에 없는 경로는 막는다. */
function allowsPath(pathname: string, engineer: EngineerLike | null): boolean {
  const key = menuKeyForPath(pathname)
  if (key === null) return false
  if (key === PUBLIC_MENU) return canViewAll(engineer)
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
 */
export function usePageGuard() {
  const supabase = useMemo(() => createClient(), [])
  const pathname = usePathname()
  const [engineer, setEngineer] = useState<GuardEngineer | null>(null)
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const { data } = await supabase.auth.getUser()
      // 미로그인은 미들웨어가 이미 /login 으로 보낸다. 여기선 방어적으로 미허가 처리.
      if (!data.user?.email) {
        if (!cancelled) { setAuthorized(false); setLoading(false) }
        return
      }
      const { data: eng } = await supabase
        .from('engineers')
        .select('engineer_id, name, teams, permission_level')
        .eq('email', data.user.email)
        .single()
      // 권한 판정에 팀의 메뉴 목록이 필요하므로 붙인 뒤에 판정한다.
      const e = await withTeamPerm((eng as GuardEngineer | null) ?? null)
      if (cancelled) return
      setEngineer(e)
      setAuthorized(allowsPath(pathname, e))
      setLoading(false)
    }
    check()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { engineer, loading, authorized }
}
