'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isPublicPath } from '@/lib/publicPaths'

export default function SessionManager() {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  // 공개 페이지는 로그인 세션이 없다. 감시를 걸어두면 외부 방문자가 폼을 오래 붙들고 있을 때
  // 자동 로그아웃 안내가 뜨고 /login 으로 튕긴다. 훅 순서는 유지한 채 동작만 건너뛴다.
  const isPublic = isPublicPath(pathname)

  useEffect(() => {
    if (isPublic) return
    const updateLastActivity = () => {
      localStorage.setItem('lastActivity', Date.now().toString())
    }

    let lastMouseMove = 0
    const updateLastActivityThrottled = () => {
      const now = Date.now()
      if (now - lastMouseMove < 10000) return
      lastMouseMove = now
      updateLastActivity()
    }

    localStorage.setItem('lastActivity', Date.now().toString())

    window.addEventListener('click', updateLastActivity)
    window.addEventListener('keydown', updateLastActivity)
    window.addEventListener('mousemove', updateLastActivityThrottled)

    return () => {
      window.removeEventListener('click', updateLastActivity)
      window.removeEventListener('keydown', updateLastActivity)
      window.removeEventListener('mousemove', updateLastActivityThrottled)
    }
  }, [isPublic])

  useEffect(() => {
    if (isPublic) return
    const interval = setInterval(async () => {
      const last = localStorage.getItem('lastActivity')
      if (!last) return

      const diff = Date.now() - Number(last)

      if (diff > 1800000) {
        await supabase.auth.signOut()
        alert('30분 동안 활동이 없어 자동 로그아웃 됩니다.')
        router.push('/login')
      }
    }, 60000)

    return () => clearInterval(interval)
  }, [router, supabase, isPublic])

  return null
}