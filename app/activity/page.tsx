'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isActiveInPeriod } from '@/lib/engineers'
import { SERVICE_TYPE_COLORS, getCategoryColor } from '@/lib/categoryColors'

const BLUE = '#234ea2'
const PAGE_BG = '#fafafa'
const CARD_BG = '#ffffff'
const BORDER = '#ebebeb'
const TEXT = '#111827'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'

const SERVICE_TYPES = ['신규설치', '이전설치', 'A/S', 'B/S', '교육', '유선기술지원']
const TEAM_OPTIONS = ['전체', '80영업', '80CS', '20', 'Apps.']

type Engineer = {
  engineer_id: number
  name: string
  position: string | null
  teams: string | null
  email: string | null
  resigned_date: string | null
}

type ActivityRow = {
  engineer: Engineer
  counts: Record<string, number>
  total: number
}

type ServiceDetail = {
  service_id: number
  visit_date: string
  service_type: string
  is_paid: boolean | null
  customer_name: string
  service_notes: string | null
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
      {SERVICE_TYPES.map(t => (
        <div key={t} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 9 }}>
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

function SegmentedControl({ items, activeKey }: {
  items: { label: string; key: string; onClick: () => void; suffix?: number }[]
  activeKey: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null)

  useEffect(() => {
    const measure = () => {
      const track = trackRef.current
      if (!track) return
      const btn = track.querySelector(`[data-seg="${activeKey}"]`) as HTMLElement | null
      const next = btn ? { left: btn.offsetLeft, width: btn.offsetWidth } : null
      setInd(prev => {
        if (!prev && !next) return prev
        if (prev && next && prev.left === next.left && prev.width === next.width) return prev
        return next
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [activeKey, items])

  return (
    <div ref={trackRef} style={{ position: 'relative', display: 'flex', background: '#f3f4f6', borderRadius: 8, padding: 3, gap: 1 }}>
      {ind && (
        <div style={{
          position: 'absolute', top: 3, bottom: 3, left: ind.left, width: ind.width,
          background: '#fff', borderRadius: 6, pointerEvents: 'none',
          transition: 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1), width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        }} />
      )}
      {items.map(it => (
        <button key={it.key} data-seg={it.key} onClick={it.onClick}
          style={{
            position: 'relative', zIndex: 1,
            padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontWeight: 700, fontSize: 12, background: 'transparent', whiteSpace: 'nowrap',
            color: it.key === activeKey ? TEXT : MUTED,
            transition: 'color 0.15s ease',
          }}>
          {it.label}{it.suffix != null && <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.75 }}>{it.suffix}</span>}
        </button>
      ))}
    </div>
  )
}

export default function ActivityPage() {
  const supabase = createClient()

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
  const [details, setDetails] = useState<ServiceDetail[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [filterType, setFilterType] = useState<string>('전체')
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false })
  const listRef = useRef<HTMLDivElement>(null)

  const fetchActivity = async (start: string, end: string) => {
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()

    const { data: engineers } = await supabase
      .from('engineers')
      .select('*')
      .order('engineer_id', { ascending: true })

    if (user && engineers) {
      const me = (engineers as Engineer[]).find(e => e.email === user.email)
      if (me && !currentUser) {
        setCurrentUser(me)
        if (me.teams && !['임원', '영업관리'].includes(me.teams)) {
          setSelectedTeam(me.teams)
        } else {
          setSelectedTeam('전체')
        }
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

    const shMap: Record<number, { service_type: string; visit_date: string }> = {}
    ;(shData ?? []).forEach((sh: any) => {
      shMap[sh.service_id] = { service_type: sh.service_type, visit_date: sh.visit_date }
    })

    const positionOrder: Record<string, number> = { '수석': 0, '책임': 1, '선임': 2, '사원': 3 }
    const sortedEngineers = (engineers ?? [])
      .filter((e: any) => !['임원', '영업관리'].includes(e.teams ?? ''))
      // 퇴사자는 조회 기간 시작일까지 재직했을 때만 표시 (7/10 퇴사 → 8월 조회 시 숨김)
      .filter((e: any) => isActiveInPeriod(e.resigned_date, start))
      .sort((a, b) => {
        const aOrder = positionOrder[a.position ?? ''] ?? 99
        const bOrder = positionOrder[b.position ?? ''] ?? 99
        return aOrder - bOrder
      })

    const result: ActivityRow[] = sortedEngineers.map((eng) => {
      const counts: Record<string, number> = {}
      SERVICE_TYPES.forEach((t) => { counts[t] = 0 })

      ;(seData ?? [])
        .filter((se: any) => se.engineer_id === eng.engineer_id)
        .forEach((se: any) => {
          const sh = shMap[se.service_id]
          if (sh && sh.service_type && counts[sh.service_type] !== undefined) {
            counts[sh.service_type]++
          }
        })

      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      return { engineer: eng, counts, total }
    })

    setRows(result)
    setLoading(false)
  }

  const fetchDetails = async (engineer: Engineer) => {
    setSelectedEngineer(engineer)
    setDetailLoading(true)
    setDetails([])
    setFilterType('전체')

    const { data: seData } = await supabase
      .from('service_engineers')
      .select('service_id')
      .eq('engineer_id', engineer.engineer_id)

    const serviceIds = (seData ?? []).map((se: any) => se.service_id)

    if (serviceIds.length === 0) {
      setDetailLoading(false)
      return
    }

    const { data: shData } = await supabase
      .from('service_history')
      .select('service_id, visit_date, service_type, is_paid, service_notes, customer_id, customers(company_name)')
      .in('service_id', serviceIds)
      .gte('visit_date', startDate)
      .lte('visit_date', endDate)
      .order('visit_date', { ascending: false })

    const result: ServiceDetail[] = (shData ?? []).map((sh: any) => ({
      service_id: sh.service_id,
      visit_date: sh.visit_date,
      service_type: sh.service_type,
      is_paid: sh.is_paid,
      customer_name: sh.customers?.company_name ?? '-',
      service_notes: sh.service_notes,
    }))

    setDetails(result)
    setDetailLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchActivity(defaultStart, defaultEnd)
  }, [])

  // 스크롤 위치에 따라 상/하단 스크롤 힌트 표시 여부 갱신
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const top = el.scrollTop > 0
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setScrollEdges(prev => (prev.top === top && prev.bottom === bottom) ? prev : { top, bottom })
  }, [detailLoading, selectedEngineer, filterType])

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

  const filteredDetails = filterType === '전체'
    ? details
    : details.filter(d => d.service_type === filterType)

  const inp: React.CSSProperties = {
    padding: '8px 11px', border: `1px solid ${BORDER}`, borderRadius: 6,
    background: CARD_BG, color: TEXT, fontSize: 13, outline: 'none',
    fontFamily: 'inherit', colorScheme: 'light' as const,
  }

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
              activeKey={activeBtn}
              items={[
                { label: '금일', key: '금일', onClick: handleToday },
                { label: '작일', key: '작일', onClick: handleYesterday },
                { label: '당월', key: '당월', onClick: handleThisMonth },
                { label: '전월', key: '전월', onClick: handleLastMonth },
              ]}
            />

            <div style={{ flex: 1 }} />

            {/* 팀 필터 */}
            <SegmentedControl
              activeKey={selectedTeam}
              items={TEAM_OPTIONS.map(team => ({ label: team, key: team, onClick: () => setSelectedTeam(team) }))}
            />
          </div>
        </div>

        {/* 카드 그리드 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
            : filteredRows.map((row) => {
                return (
                  <div key={row.engineer.engineer_id}
                    onClick={() => fetchDetails(row.engineer)}
                    style={{
                      background: CARD_BG, borderRadius: 8, padding: '14px 16px',
                      border: `1px solid ${BORDER}`, cursor: 'pointer',
                      transition: 'transform 0.15s ease, border-color 0.15s ease',
                    }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLDivElement
                      el.style.transform = 'translateY(-2px)'
                      el.style.borderColor = '#c7d7f8'
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLDivElement
                      el.style.transform = ''
                      el.style.borderColor = BORDER
                    }}
                  >
                    {/* 이름 + 팀 뱃지 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${BORDER}` }}>
                      <div>
                        <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px', lineHeight: 1.2, marginBottom: 3 }}>
                          {row.engineer.name}
                        </div>
                        <div style={{ fontSize: 11, color: MUTED, fontWeight: 500 }}>
                          {row.engineer.position ?? ''}
                        </div>
                      </div>
                      {row.engineer.teams && (
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, flexShrink: 0,
                          background: '#f3f4f6',
                          color: '#6b7280',
                        }}>
                          {row.engineer.teams}
                        </span>
                      )}
                    </div>

                    {/* 서비스 타입별 건수 */}
                    <div style={{ display: 'grid', gap: 7, marginBottom: 12 }}>
                      {SERVICE_TYPES.map((type) => {
                        const sc = getCategoryColor(SERVICE_TYPE_COLORS, type)
                        const cnt = row.counts[type] ?? 0
                        return (
                          <div key={type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 9, height: 9, borderRadius: '50%', background: cnt > 0 ? (sc.dot ?? sc.text) : '#d1d5db', flexShrink: 0 }} />
                              <span style={{ fontSize: 12, color: cnt > 0 ? '#111827' : '#d1d5db', fontWeight: cnt > 0 ? 500 : 400 }}>{type}</span>
                            </div>
                            <span style={{
                              fontSize: 12, fontWeight: 600,
                              color: cnt > 0 ? '#111827' : '#d1d5db',
                              background: cnt > 0 ? '#f3f4f6' : 'transparent',
                              borderRadius: cnt > 0 ? 6 : 0,
                              padding: cnt > 0 ? '2px 8px' : '2px 0',
                            }}>
                              {cnt}<span style={{ color: cnt > 0 ? '#9ca3af' : '#d1d5db' }}>건</span>
                            </span>
                          </div>
                        )
                      })}
                    </div>

                    {/* 합계 */}
                    <div style={{
                      padding: '5px 0', borderTop: `1px solid ${BORDER}`,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>합계</span>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                        <span style={{ fontSize: 20, fontWeight: 600, color: BLUE, letterSpacing: '-0.5px' }}>
                          {row.total}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>건</span>
                      </div>
                    </div>
                  </div>
                )
              })
          }
        </div>
      </div>

      {/* 상세 모달 */}
      {selectedEngineer && (
        <div onClick={() => setSelectedEngineer(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()}
            style={{
              background: CARD_BG, borderRadius: 8, width: '100%', maxWidth: 700,
              maxHeight: '88vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: `1px solid ${BORDER}`,
              animation: 'modal-in 0.18s ease',
            }}>

            {/* 모달 헤더 */}
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>{selectedEngineer.name}</span>
                    <span style={{ fontSize: 12, color: GRAY, fontWeight: 500 }}>{selectedEngineer.position}</span>
                    {selectedEngineer.teams && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: '#f3f4f6', color: '#6b7280' }}>
                        {selectedEngineer.teams}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: MUTED }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    <span>{startDate.replace(/-/g, '.')} ~ {endDate.replace(/-/g, '.')}</span>
                    {!detailLoading && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 99, background: '#f3f4f6', color: BLUE }}>
                        총 {details.length}건
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => setSelectedEngineer(null)}
                  style={{
                    width: 30, height: 30, borderRadius: '50%', background: '#f3f4f6', border: 'none',
                    cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: GRAY, flexShrink: 0, transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6'}>
                  ✕
                </button>
              </div>
            </div>

            {/* 서비스 타입 필터 */}
            <div style={{ padding: '10px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex' }}>
              <SegmentedControl
                activeKey={filterType}
                items={(['전체', ...SERVICE_TYPES] as string[]).map(type => ({
                  label: type,
                  key: type,
                  onClick: () => setFilterType(type),
                  suffix: type === '전체' ? details.length : details.filter(d => d.service_type === type).length,
                }))}
              />
            </div>

            {/* 서비스 목록 */}
            <div
              ref={listRef}
              onScroll={e => {
                const el = e.currentTarget
                const top = el.scrollTop > 0
                const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
                setScrollEdges(prev => (prev.top === top && prev.bottom === bottom) ? prev : { top, bottom })
              }}
              className="no-scrollbar"
              style={{
                overflowY: 'auto', height: 567, flexShrink: 0,
                transition: 'box-shadow 0.15s ease',
                boxShadow: [
                  scrollEdges.top ? 'inset 0 9px 7px -8px rgba(0,0,0,0.12)' : '',
                  scrollEdges.bottom ? 'inset 0 -9px 7px -8px rgba(0,0,0,0.12)' : '',
                ].filter(Boolean).join(', ') || undefined,
              }}>
              {detailLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0, paddingTop: 8 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${BORDER}` }}>
                      <div>
                        <div style={{ width: 130, height: 14, background: '#e5e7eb', borderRadius: 6, marginBottom: 8, animation: 'pulse 1.5s ease-in-out infinite' }} />
                        <div style={{ width: 200, height: 11, background: '#e5e7eb', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7 }}>
                        <div style={{ width: 58, height: 20, background: '#e5e7eb', borderRadius: 99, animation: 'pulse 1.5s ease-in-out infinite' }} />
                        <div style={{ width: 72, height: 11, background: '#e5e7eb', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredDetails.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '52px 0', color: MUTED, gap: 10 }}>
                  <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.5">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
                    <rect x="9" y="3" width="6" height="4" rx="1"/>
                    <line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>
                  </svg>
                  <span style={{ fontSize: 14, fontWeight: 600, color: GRAY }}>서비스 기록이 없습니다</span>
                  <span style={{ fontSize: 12, color: MUTED }}>해당 기간에 등록된 서비스가 없어요</span>
                </div>
              ) : (
                filteredDetails.map((d, idx) => {
                  const sc = getCategoryColor(SERVICE_TYPE_COLORS, d.service_type)
                  return (
                    <div key={d.service_id}
                      style={{
                        display: 'flex', alignItems: 'flex-start', padding: '11px 12px', gap: 12,
                        borderBottom: `1px solid ${BORDER}`,
                      }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', lineHeight: '22px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {d.customer_name}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 400, color: '#9ca3af', lineHeight: '16px', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {d.service_notes || ' '}
                        </div>
                      </div>
                      <div style={{ width: 110, flexShrink: 0, textAlign: 'left' }}>
                        <div style={{ lineHeight: '22px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#111827' }}>
                            <span style={{ width: 9, height: 9, borderRadius: '50%', background: sc.dot ?? sc.text, flexShrink: 0 }} />
                            {d.service_type}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, lineHeight: '16px', marginTop: 3 }}>
                          {d.is_paid !== null && (
                            <>
                              <span style={{ color: '#6b7280' }}>{d.is_paid ? '유상' : '무상'}</span>
                              <span style={{ color: '#d1d5db' }}> · </span>
                            </>
                          )}
                          <span style={{ color: '#9ca3af' }}>{d.visit_date.replace(/-/g, '.')}</span>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
