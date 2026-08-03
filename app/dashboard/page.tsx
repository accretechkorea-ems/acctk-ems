'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  canAccess80, canAccess20, canAccessQuote, canAccessSales,
  canAccessAdmin, canAccessMaintenance, type EngineerLike,
} from '@/lib/permissions'

type Me = {
  name: string | null
  position: string | null
  teams: string | null
  permission_level: string | null
}

// 접근 가능한 메뉴만 카드로 노출한다. 판정은 lib/permissions.ts 로 일원화.
const LINKS: { label: string; path: string; can: (e: EngineerLike | null) => boolean }[] = [
  { label: '고객사 현황', path: '/', can: canAccess80 },
  { label: '입고 등록', path: '/repair', can: canAccess20 },
  { label: '수리 현황 대시보드', path: '/repair/dashboard', can: canAccess20 },
  { label: '견적서', path: '/quote', can: canAccessQuote },
  { label: '발주관리', path: '/purchase', can: canAccessSales },
  { label: '재고관리', path: '/inventory', can: canAccessSales },
  { label: '실적 현황', path: '/sales', can: canAccessAdmin },
  { label: '활동 현황', path: '/activity', can: canAccessAdmin },
  { label: '유지보수', path: '/admin', can: canAccessMaintenance },
]

const cardStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 16px', background: '#fff', border: '1px solid #ebebeb', borderRadius: 8,
  cursor: 'pointer', transition: 'transform 0.15s ease, border-color 0.15s ease',
}

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data } = await supabase.auth.getUser()
      if (data.user?.email) {
        const { data: eng } = await supabase
          .from('engineers')
          .select('name, position, teams, permission_level')
          .eq('email', data.user.email)
          .single()
        if (!cancelled) setMe((eng as Me | null) ?? null)
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const greeting = me
    ? `${me.name ?? ''}${me.position ? ` ${me.position}` : ''}님, 안녕하세요`
    : '안녕하세요'
  const links = LINKS.filter(l => l.can(me))

  return (
    <div style={{ background: '#fafafa', minHeight: '100vh', padding: '32px 28px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#111827', letterSpacing: '-0.3px', margin: 0 }}>
          {loading ? ' ' : greeting}
        </h1>
        <p style={{ fontSize: 14, color: '#6b7280', marginTop: 8 }}>
          개인 대시보드는 준비 중입니다.
        </p>

        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#9ca3af', marginBottom: 10 }}>바로가기</div>
          {loading ? (
            <div style={{ fontSize: 14, color: '#9ca3af' }}>불러오는 중...</div>
          ) : links.length === 0 ? (
            <div style={{ fontSize: 14, color: '#9ca3af' }}>접근 가능한 메뉴가 없습니다.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {links.map(l => (
                <div
                  key={l.path}
                  onClick={() => router.push(l.path)}
                  style={cardStyle}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = '#c7d7f8' }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = '#ebebeb' }}
                >
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{l.label}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#234ea2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
