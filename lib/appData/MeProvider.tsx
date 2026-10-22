'use client'

// 본인 정보를 앱 전체에 내려 주는 Provider — 레이아웃에서 한 번 감싼다.
//
//   const { me, loading } = useMe()
//
// 조회는 lib/appData/me.ts 가 모듈 캐시로 한 번만 한다. 이 파일은 그 값을 React 로
// 나르고, **언제 다시 읽는가**만 정한다 — 로그인 · 로그아웃 · refresh() 를 부를 때다.
//
// 공개 경로(로그인·리드 등록)에서는 아무것도 읽지 않는다. 세션이 없는 자리에서
// `/auth/v1/user` 를 부르면 요청만 하나 늘고 돌아오는 것은 없다.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isPublicPath } from '@/lib/publicPaths'
import { invalidateMe, loadMe, type Me } from './me'
import { invalidateEngineers } from './engineers'
import { resetNotifications } from './notifications'
import { resetApprovalInbox } from './approvalInbox'

export type MeState = {
  /** 로그인한 본인. 미로그인·조회 실패면 null. */
  me: Me | null
  /** 세션의 메일. me 가 null 인데 이 값이 있으면 「세션은 있는데 직원 행이 없다」다. */
  email: string | null
  /** 판정 전. 이 동안 화면은 본문을 그리지 않는다(권한 없는 내용이 잠깐 보이지 않게). */
  loading: boolean
  error: string | null
  /** 권한·소속이 바뀐 뒤 다시 읽는다(관리 화면에서 부른다). */
  refresh: () => Promise<void>
}

type Loaded = Pick<MeState, 'me' | 'email' | 'loading' | 'error'>

const MeCtx = createContext<MeState | null>(null)

export function MeProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const isPublic = isPublicPath(usePathname())
  const [data, setData] = useState<Loaded>({ me: null, email: null, loading: true, error: null })

  const read = useCallback(async () => {
    const { me, email, error } = await loadMe()
    setData({ me, email, error, loading: false })
  }, [])

  const refresh = useCallback(async () => {
    invalidateMe()
    invalidateEngineers()
    resetNotifications()
    resetApprovalInbox()
    setData(d => ({ ...d, loading: true }))
    await read()
  }, [read])

  useEffect(() => {
    if (isPublic) return
    let cancelled = false
    const run = async () => {
      const { me, email, error } = await loadMe()
      if (!cancelled) setData({ me, email, error, loading: false })
    }
    run()
    return () => { cancelled = true }
  }, [isPublic])

  // 로그인·로그아웃 때만 다시 읽는다. INITIAL_SESSION·TOKEN_REFRESHED 는 무시한다 —
  // 토큰 갱신은 사람이 바뀐 일이 아니고, 그때마다 읽으면 조용히 조회가 늘어난다.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT' && event !== 'USER_UPDATED') return
      invalidateMe()
      invalidateEngineers()
      // 알림·미결함도 사람이 바뀌면 남의 것이 된다 — 함께 버린다.
      resetNotifications()
      resetApprovalInbox()
      if (isPublicPath(window.location.pathname)) setData({ me: null, email: null, error: null, loading: false })
      else void read()
    })
    return () => { listener.subscription.unsubscribe() }
  }, [supabase, read])

  // 공개 경로에서는 조회하지 않으므로 「확인 끝, 본인 없음」으로 내려 준다
  // (effect 에서 setState 하지 않고 여기서 가른다 — 쓸데없는 렌더를 만들지 않는다).
  const value = useMemo<MeState>(() => ({
    me: isPublic ? null : data.me,
    email: isPublic ? null : data.email,
    loading: isPublic ? false : data.loading,
    error: isPublic ? null : data.error,
    refresh,
  }), [isPublic, data, refresh])

  return <MeCtx.Provider value={value}>{children}</MeCtx.Provider>
}

/**
 * 로그인한 본인. Provider 는 app/layout.tsx 가 감싸므로 어느 화면·훅에서나 쓸 수 있다.
 * 서버 코드(app/api/**·lib/*Server.ts)는 쓸 수 없다 — 그쪽은 각 라우트의 loadCaller() 다.
 */
export function useMe(): MeState {
  const ctx = useContext(MeCtx)
  if (!ctx) throw new Error('useMe() 는 MeProvider 안에서만 쓸 수 있다 (app/layout.tsx 를 보라)')
  return ctx
}
