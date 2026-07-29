'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type Engineer = {
  engineer_id: number
  name: string
  teams: string | null
  permission_level: string | null
}

/**
 * 20 수리 페이지 접근 권한 확인 공용 훅.
 * 허용: permission_level 'superadmin' | 'manager' 이거나 teams === '20'.
 * - authorized: null(확인중) | true | false
 * - currentEngineer: 인증된 직원 정보 (미인증/미허가면 null)
 * 로그인 안 돼 있으면 '/'로 replace (기존 page.tsx init 동작과 동일).
 */
export function useRepairAuth() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [currentEngineer, setCurrentEngineer] = useState<Engineer | null>(null)
  const [authorized, setAuthorized] = useState<boolean | null>(null) // null=확인중

  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getUser()
      if (!data.user?.email) { router.replace('/'); return }

      const { data: eng } = await supabase
        .from('engineers')
        .select('engineer_id, name, teams, permission_level')
        .eq('email', data.user.email)
        .single()

      const ok = !!eng && (
        eng.permission_level === 'superadmin' ||
        eng.permission_level === 'manager' ||
        eng.teams === '20'
      )
      if (!ok) { setAuthorized(false); return }

      setCurrentEngineer(eng as Engineer)
      setAuthorized(true)
    }
    check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { authorized, currentEngineer }
}
