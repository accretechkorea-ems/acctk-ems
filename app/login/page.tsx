'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      setError('아이디 또는 비밀번호가 올바르지 않습니다.')
      return
    }

    router.push('/dashboard')
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