'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isMobileViewport } from '@/lib/viewport'
import { invalidateMe, loadMe } from '@/lib/appData/me'
import { canViewCustomers } from '@/lib/permissions'
import { DIVISION_HOME, canSwitchDivision, readSavedDivision, teamDivisionOf } from '@/lib/division'
import { IDLE_REASON } from '@/components/common/SessionManager'

function LoginPageInner() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  /**
   * 왜 이 화면에 왔는가 — ?reason=idle 이면 30분 무활동으로 끊긴 것이다
   * (components/common/SessionManager.tsx 가 그 주소로 보낸다).
   *
   * 토스트가 아니라 **폼 위 고정 문구**다. 돌아와서 화면을 보는 시점이 몇 분 뒤일 수도
   * 있어 잠깐 뜨고 사라지는 안내는 못 본다. 로그인에 성공하면 이 화면을 떠나므로
   * 따로 지울 일이 없다.
   */
  const idleLogout = useSearchParams().get('reason') === IDLE_REASON

  const handleLogin = async () => {
    setError('')
    setLoading(true)

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setLoading(false)
      setError('아이디 또는 비밀번호가 올바르지 않습니다.')
      return
    }

    // 첫 화면은 사업부로 먼저 가른다(lib/division.ts).
    //   반도체 — 반도체 시작 화면(/contact/semi). 계측 홈(/dashboard)은 반도체 메뉴가 아니다.
    //            전환 권한자(superadmin + can_switch_division)는 사이드바에서 마지막으로 고른 사업부,
    //            고른 적이 없으면 본인 팀의 사업부를 본다. 그 밖의 사람은 본인 팀의 사업부.
    //   계측   — 종전 그대로. 모바일은 현장 서비스 인원만 쓰므로 첫 화면을 고객사 현황으로 연다.
    //            단, 고객사 열람 권한이 없는 팀(영업관리 등)이 모바일로 들어오면 막힌 화면을
    //            마주치게 되므로 그때는 기존대로 본인 페이지로 보낸다.
    // 본인 정보는 **공통 층**에서 읽는다(lib/appData/me.ts). 여기서 따로 조회하지 않는
    // 이유 — 다음 화면의 MeProvider 가 같은 약속(Promise)을 받아 **조회를 한 번도 하지
    // 않는다**. 예전에는 이 화면이 engineers·teams 를 읽고, 홈에 가서 MeProvider 가
    // auth/user·engineers 를 또 읽어 사슬이 두 벌이었다(docs/perf/login-flow.md).
    //
    // invalidateMe() 가 먼저다 — 캐시를 버리는 때 셋 중 하나가 「로그인」이다.
    invalidateMe()
    let target = '/dashboard'
    if (data.user?.email) {
      const { me } = await loadMe()
      const teamDivision = teamDivisionOf(me)
      const division = me && canSwitchDivision(me)
        ? (readSavedDivision(me.engineer_id) ?? teamDivision)
        : teamDivision
      if (division === '반도체') target = DIVISION_HOME['반도체']
      else if (isMobileViewport() && canViewCustomers(me)) target = '/'
    }

    setLoading(false)
    // router.refresh() 는 부르지 않는다 — push 가 이미 새 쿠키로 그 경로의 RSC 를 받아
    // 오는데, refresh 가 같은 것을 한 번 더 받아 왔다(측정에서 /dashboard?_rsc 두 번).
    // 화면들은 모두 'use client' 이고 자료는 브라우저가 읽으므로 다시 받을 것이 없다.
    router.push(target)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#111',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          padding: 32,
          background: '#1c1c1c',
          borderRadius: 16,
          border: '0.5px solid #2a2a2a',
        }}
      >
        <div style={{ marginBottom: 28, textAlign: 'center' }}>
          <div
            style={{
              fontSize: 11,
              color: '#555',
              letterSpacing: '0.08em',
              marginBottom: 6,
            }}
          >
            ACCRETECH KOREA
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, color: '#f0f0f0' }}>
            로그인
          </div>
        </div>

        {idleLogout && (
          <div
            style={{
              marginBottom: 16, padding: '10px 12px', background: '#111',
              border: '0.5px solid #2a2a2a', borderRadius: 10,
              fontSize: 12, lineHeight: 1.6, color: '#9ca3af', textAlign: 'center',
            }}
          >
            30분 동안 활동이 없어 자동 로그아웃되었습니다.
          </div>
        )}

        <div style={{ display: 'grid', gap: 12 }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="아이디"
            style={{
              width: '100%',
              padding: '12px 14px',
              background: '#111',
              border: '0.5px solid #2a2a2a',
              borderRadius: 10,
              color: '#f0f0f0',
              fontSize: 14,
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            style={{
              width: '100%',
              padding: '12px 14px',
              background: '#111',
              border: '0.5px solid #2a2a2a',
              borderRadius: 10,
              color: '#f0f0f0',
              fontSize: 14,
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />

          {error && (
            <div style={{ fontSize: 12, color: '#ef4444', textAlign: 'center' }}>
              {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              background: '#fff',
              color: '#111',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              opacity: loading ? 0.7 : 1,
              marginTop: 4,
            }}
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </div>
      </div>
    </div>
  )
}
// useSearchParams 는 Suspense 경계 안에서만 쓸 수 있다(견적·리드 화면과 같은 방식).
// 이 화면은 ?reason=idle 로 「왜 로그아웃됐는지」를 받는다.
export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#111' }} />}>
      <LoginPageInner />
    </Suspense>
  )
}
