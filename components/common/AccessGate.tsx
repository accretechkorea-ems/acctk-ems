'use client'

import { useRouter } from 'next/navigation'

/**
 * 페이지 진입 가드 공용 화면.
 * usePageGuard 와 함께 쓴다: `if (!authorized) return <AccessGate loading={loading} />`
 * - loading true  → '확인 중...'
 * - loading false → '접근 권한이 없습니다' (리다이렉트 대신 렌더)
 */
export default function AccessGate({ loading }: { loading: boolean }) {
  const router = useRouter()

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', fontSize: 16, color: '#6b7280' }}>
        확인 중...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center', alignItems: 'center', height: '60vh', color: '#6b7280' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#111827' }}>접근 권한이 없습니다</div>
      <div style={{ fontSize: 14 }}>이 페이지에 접근할 권한이 없습니다.</div>
      <button
        onClick={() => router.back()}
        style={{ marginTop: 8, padding: '8px 18px', border: 'none', borderRadius: 8, background: '#234ea2', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
      >
        이전으로
      </button>
    </div>
  )
}
