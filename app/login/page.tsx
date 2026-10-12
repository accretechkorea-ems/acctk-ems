'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isMobileViewport } from '@/lib/viewport'
import { withTeamPerm } from '@/lib/teamPerms'
import { canViewCustomers, isSuperAdmin, type EngineerLike } from '@/lib/permissions'
import { DIVISION_HOME, readSavedDivision } from '@/lib/division'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
    //            superadmin 은 사이드바에서 마지막으로 고른 사업부, 고른 적이 없으면 본인 팀의 사업부를 본다.
    //   계측   — 종전 그대로. 모바일은 현장 서비스 인원만 쓰므로 첫 화면을 고객사 현황으로 연다.
    //            단, 고객사 열람 권한이 없는 팀(영업관리 등)이 모바일로 들어오면 막힌 화면을
    //            마주치게 되므로 그때는 기존대로 본인 페이지로 보낸다.
    let target = '/dashboard'
    if (data.user?.email) {
      const { data: eng } = await supabase
        .from('engineers')
        .select('engineer_id, permission_level, teams')
        .eq('email', data.user.email)
        .single()
      const me = await withTeamPerm(eng as (EngineerLike & { engineer_id: number }) | null)
      const teamDivision = me?.perm?.division ?? '계측'
      const division = me && isSuperAdmin(me)
        ? (readSavedDivision(me.engineer_id) ?? teamDivision)
        : teamDivision
      if (division === '반도체') target = DIVISION_HOME['반도체']
      else if (isMobileViewport() && canViewCustomers(me)) target = '/'
    }

    setLoading(false)
    router.push(target)
    router.refresh()
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