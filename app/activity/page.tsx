'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isActiveInPeriod } from '@/lib/engineers'
import SegmentedControl from '@/components/common/SegmentedControl'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { canViewDashboard, isFieldEngineerTeam, type TeamPerm } from '@/lib/permissions'
import { withTeamPerms } from '@/lib/teamPerms'
import ActivityCard from '@/components/activity/ActivityCard'
import { ACTIVITY_TYPES } from '@/lib/activity'
import ActivityDetailModal from '@/components/activity/ActivityDetailModal'

const BLUE = '#234ea2'
const PAGE_BG = '#fafafa'
const CARD_BG = '#ffffff'
const BORDER = '#ebebeb'
const TEXT = '#111827'
const MUTED = '#9ca3af'

type Engineer = {
  engineer_id: number
  name: string
  position: string | null
  teams: string | null
  email: string | null
  resigned_date: string | null
  office: string | null
  perm?: TeamPerm | null
}

// 활동 현황 집계에 필요한 최소 필드(sales_activities).
type SalesActivityRow = {
  activity_id: number
  engineer_id: number
  activity_date: string
  activity_type: string
}

type ActivityRow = {
  engineer: Engineer
  counts: Record<string, number>
  total: number
}

function SkeletonCard() {
  return (
    <div style={{ background: CARD_BG, borderRadius: 8, padding: '14px 16px', border: `1px solid ${BORDER}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <div style={{ width: 68, height: 16, background: '#e5e7eb', borderRadius: 6, marginBottom: 7, animation: 'pulse 1.5s ease-in-out infinite' }} />
          <div style={{ width: 36, height: 11, background: '#e5e7eb', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
        </div>
        <div style={{ width: 34, height: 20, background: '#e5e7eb', borderRadius: 99, animation: 'pulse 1.5s ease-in-out infinite' }} />
      </div>
      {/* 유형 6줄 자리 — 카드 목록 영역이 6줄 높이로 고정돼 있다 */}
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 9 }}>
          <div style={{ width: 52, height: 11, background: '#e5e7eb', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
          <div style={{ width: 30, height: 11, background: '#e5e7eb', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
        </div>
      ))}
      <div style={{ marginTop: 12, padding: '5px 0', display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ width: 24, height: 13, background: '#e5e7eb', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ width: 44, height: 18, background: '#e5e7eb', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
      </div>
    </div>
  )
}

export default function ActivityPage() {
  const supabase = createClient()
  const { loading: guardLoading, authorized } = usePageGuard(canViewDashboard)

  const now = new Date()
  const thisYear = now.getFullYear()
  const thisMonth = now.getMonth() + 1

  const formatDate = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate()

  const defaultStart = formatDate(thisYear, thisMonth, 1)
  const defaultEnd = formatDate(thisYear, thisMonth, lastDay(thisYear, thisMonth))

  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(defaultEnd)
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(false)
  const [activeBtn, setActiveBtn] = useState<string>('당월')
  const [selectedTeam, setSelectedTeam] = useState<string>('전체')
  const [currentUser, setCurrentUser] = useState<Engineer | null>(null)

  const [selectedEngineer, setSelectedEngineer] = useState<Engineer | null>(null)

  const fetchActivity = async (start: string, end: string) => {
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()

    const { data: engineerRows } = await supabase
      .from('engineers')
      .select('*')
      .order('engineer_id', { ascending: true })

    // 집계 대상(현장 팀) 판정에 팀 플래그가 필요하므로 목록에 붙여둔다.
    const engineers = await withTeamPerms(engineerRows as Engineer[] | null)

    if (user) {
      const me = engineers.find(e => e.email === user.email)
      if (me && !currentUser) {
        setCurrentUser(me)
        // 본인 팀이 집계 대상이면 그 팀으로 시작하고, 아니면(임원·영업관리 등) 전체로 시작한다.
        setSelectedTeam(me.teams && isFieldEngineerTeam(me) ? me.teams : '전체')
      }
    }

    const { data: seData } = await supabase
      .from('service_engineers')
      .select('engineer_id, service_id')

    const { data: shData } = await supabase
      .from('service_history')
      .select('service_id, service_type, visit_date')
      .gte('visit_date', start)
      .lte('visit_date', end)

    // 영업 활동 — engineer_id 가 단일이라 이 한 줄이 곧 (기록, 사람) 이다.
    // 서비스처럼 다대다 표를 거칠 필요가 없어 그대로 사람별로 센다.
    const { data: saData } = await supabase
      .from('sales_activities')
      .select('activity_id, engineer_id, activity_date, activity_type')
      .gte('activity_date', start)
      .lte('activity_date', end)

    const shMap: Record<number, { service_type: string; visit_date: string }> = {}
    ;(shData ?? []).forEach((sh: any) => {
      shMap[sh.service_id] = { service_type: sh.service_type, visit_date: sh.visit_date }
    })

    const positionOrder: Record<string, number> = { '수석': 0, '책임': 1, '선임': 2, '사원': 3 }
    const sortedEngineers = (engineers ?? [])
      .filter((e: any) => isFieldEngineerTeam(e))
      // 퇴사자는 조회 기간 시작일까지 재직했을 때만 표시 (7/10 퇴사 → 8월 조회 시 숨김)
      .filter((e: any) => isActiveInPeriod(e.resigned_date, start))
      .sort((a, b) => {
        const aOrder = positionOrder[a.position ?? ''] ?? 99
        const bOrder = positionOrder[b.position ?? ''] ?? 99
        return aOrder - bOrder
      })

    const result: ActivityRow[] = sortedEngineers.map((eng) => {
      const counts: Record<string, number> = {}
      ACTIVITY_TYPES.forEach((t) => { counts[t] = 0 })

      // 서비스 — 참여자 표(service_engineers)를 거쳐 사람별로 센다.
      ;(seData ?? [])
        .filter((se: any) => se.engineer_id === eng.engineer_id)
        .forEach((se: any) => {
          const sh = shMap[se.service_id]
          if (sh && sh.service_type && counts[sh.service_type] !== undefined) {
            counts[sh.service_type]++
          }
        })

      // 영업 활동 — 목록에 없는 유형은 서비스와 같은 규칙으로 무시한다.
      ;((saData ?? []) as SalesActivityRow[])
        .filter(a => a.engineer_id === eng.engineer_id)
        .forEach(a => {
          if (a.activity_type && counts[a.activity_type] !== undefined) {
            counts[a.activity_type]++
          }
        })

      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      return { engineer: eng, counts, total }
    })

    setRows(result)
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchActivity(defaultStart, defaultEnd)
  }, [])

  const handleThisMonth = () => {
    const s = formatDate(thisYear, thisMonth, 1)
    const e = formatDate(thisYear, thisMonth, lastDay(thisYear, thisMonth))
    setStartDate(s); setEndDate(e); setActiveBtn('당월')
    fetchActivity(s, e)
  }

  const handleLastMonth = () => {
    const d = new Date(thisYear, thisMonth - 2, 1)
    const y = d.getFullYear(); const m = d.getMonth() + 1
    const s = formatDate(y, m, 1)
    const e = formatDate(y, m, lastDay(y, m))
    setStartDate(s); setEndDate(e); setActiveBtn('전월')
    fetchActivity(s, e)
  }

  const handleToday = () => {
    const t = formatDate(thisYear, thisMonth, now.getDate())
    setStartDate(t); setEndDate(t); setActiveBtn('금일')
    fetchActivity(t, t)
  }

  const handleYesterday = () => {
    const d = new Date(now); d.setDate(d.getDate() - 1)
    const t = formatDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
    setStartDate(t); setEndDate(t); setActiveBtn('작일')
    fetchActivity(t, t)
  }

  const handleSearch = () => {
    setActiveBtn('')
    fetchActivity(startDate, endDate)
  }

  const filteredRows = selectedTeam === '전체'
    ? rows
    : rows.filter(row => row.engineer.teams === selectedTeam)

  // 팀 필터 목록은 조회 결과에 실제로 있는 팀에서 만든다(팀 이름 하드코딩 금지).
  const teamOptions = ['전체', ...[...new Set(rows.map(r => r.engineer.teams).filter(Boolean))].sort() as string[]]

  const inp: React.CSSProperties = {
    padding: '8px 11px', border: `1px solid ${BORDER}`, borderRadius: 6,
    background: CARD_BG, color: TEXT, fontSize: 13, outline: 'none',
    fontFamily: 'inherit', colorScheme: 'light' as const,
  }

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
        @keyframes modal-in {
          from { opacity: 0; transform: scale(0.97) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>

      <div style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* 필터 카드 */}
        <div style={{
          background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8,
          padding: '14px 16px', marginBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>

            {/* 날짜 입력 */}
            <input type="date" value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setActiveBtn('') }}
              style={inp} />
            <span style={{ color: MUTED, fontWeight: 600, fontSize: 13 }}>~</span>
            <input type="date" value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setActiveBtn('') }}
              style={inp} />

            {/* 조회 버튼 */}
            <button onClick={handleSearch}
              style={{
                padding: '7px 16px', background: BLUE, color: '#fff', border: 'none',
                borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5, transition: 'background 0.15s ease',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#1c3e87'}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = BLUE}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              조회
            </button>

            {/* 빠른 날짜 선택 */}
            <SegmentedControl
              value={activeBtn}
              options={['금일', '작일', '당월', '전월']}
              onChange={v => {
                if (v === '금일') handleToday()
                else if (v === '작일') handleYesterday()
                else if (v === '당월') handleThisMonth()
                else if (v === '전월') handleLastMonth()
              }}
            />

            <div style={{ flex: 1 }} />

            {/* 팀 필터 */}
            <SegmentedControl
              value={selectedTeam}
              options={teamOptions}
              onChange={setSelectedTeam}
            />
          </div>
        </div>

        {/* 카드 그리드 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
            : filteredRows.map((row) => (
                <ActivityCard
                  key={row.engineer.engineer_id}
                  engineer={row.engineer}
                  counts={row.counts}
                  total={row.total}
                  types={ACTIVITY_TYPES}
                  onClick={() => setSelectedEngineer(row.engineer)}
                />
              ))
          }
        </div>
      </div>

      {/* 상세 모달 (동선 보기 포함, 대시보드와 공유) */}
      {selectedEngineer && (
        <ActivityDetailModal
          engineer={selectedEngineer}
          startDate={startDate}
          endDate={endDate}
          onClose={() => setSelectedEngineer(null)}
        />
      )}
    </main>
  )
}
