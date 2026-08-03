'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { EngineerLike } from '@/lib/permissions'

export type GuardEngineer = {
  engineer_id: number
  name: string | null
  teams: string | null
  permission_level: string | null
}

/**
 * 페이지 진입 권한 확인 공용 훅.
 * lib/permissions.ts 의 판정 함수(canAccess80 등)를 checkFn 으로 받는다.
 *
 *   const { engineer, loading, authorized } = usePageGuard(canAccess80)
 *   if (!authorized) return <AccessGate loading={loading} />
 *
 * - loading      : 판정 전(true). 이 동안 페이지 본문을 그리지 않아 잠깐 노출되는 일이 없다.
 * - authorized   : checkFn 통과 여부. loading 중에는 항상 false.
 * - engineer     : 로그인 직원 정보(미로그인/미조회면 null).
 *
 * 리다이렉트는 하지 않는다. '/' 가 80 전용이 될 예정이라 무한 리다이렉트를 피하려
 * 미허가 시에는 호출부에서 '접근 권한이 없습니다' 화면(AccessGate)을 렌더한다.
 */
export function usePageGuard(checkFn: (e: EngineerLike | null) => boolean) {
  const supabase = useMemo(() => createClient(), [])
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
      if (cancelled) return
      const e = (eng as GuardEngineer | null) ?? null
      setEngineer(e)
      setAuthorized(checkFn(e))
      setLoading(false)
    }
    check()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { engineer, loading, authorized }
}
