'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useRepairAuth } from '@/hooks/useRepairAuth'
import { useRepairs } from '@/hooks/useRepairs'

const BLUE = '#234ea2'
const PAGE_BG = '#f4f5f7'
const TEXT = '#111113'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'

export default function RepairDashboardPage() {
  const router = useRouter()
  const { authorized } = useRepairAuth()
  const { repairs, loading } = useRepairs()

  if (authorized === null) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', fontSize: 16, color: GRAY }}>확인 중...</div>
  }
  if (authorized === false) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center', alignItems: 'center', height: '60vh', color: GRAY }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>접근 권한이 없습니다</div>
        <div style={{ fontSize: 14 }}>이 페이지는 20팀 담당자와 관리자만 열람할 수 있습니다.</div>
        <button onClick={() => router.push('/')} style={{ marginTop: 8, padding: '8px 18px', border: 'none', borderRadius: 8, background: BLUE, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>홈으로</button>
      </div>
    )
  }

  return (
    <div style={{ background: PAGE_BG, minHeight: 'calc(100vh - 44px)', padding: 20, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: TEXT }}>수리 대시보드</h1>
          <Link href="/repair" style={{ fontSize: 13, fontWeight: 700, color: BLUE, textDecoration: 'none' }}>← 목록으로</Link>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e4e9', borderRadius: 14, padding: 40, textAlign: 'center', color: MUTED, fontSize: 15 }}>
          {loading ? '불러오는 중...' : `데이터 ${repairs.length}건 로드됨`}
        </div>
      </div>
    </div>
  )
}
