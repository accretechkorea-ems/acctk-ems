'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ACTIVITY_TYPE_COLORS, getCategoryColor } from '@/lib/categoryColors'
import SegmentedControl from '@/components/common/SegmentedControl'
import HorizontalScroller from '@/components/common/HorizontalScroller'
import { buildRoute, type RouteStop } from '@/lib/routeMap'
import RouteMapView from '@/components/activity/RouteMapView'
import { ACTIVITY_TYPES, byDateDesc, entryKey, type ActivityEntry } from '@/lib/activity'

// 활동 서비스 기록 상세 '본문'(헤더 + 타입 필터 + 목록 + 동선 지도). 상세 조회를 스스로 관리한다.
// 두 곳에서 공유한다:
//   - 활동 현황 페이지: ActivityDetailModal 이 오버레이/카드로 감싸 모달로 사용(variant="modal")
//   - 개인 대시보드: 카드 안에 직접 인라인 렌더(variant="inline", 오버레이/닫기 없음)
// 오버레이·닫기 버튼·카드 래퍼는 이 컴포넌트 밖(호출부)에 있다.

const BLUE = '#234ea2'
const BORDER = '#ebebeb'
const TEXT = '#111827'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'

// 조회 응답 모양(필요한 필드만). ActivityEntry 로 옮겨 담고 나면 쓰지 않는다.
type Company = { company_name: string | null; latitude: number | null; longitude: number | null } | null
type ServiceLink = { service_id: number }
type ServiceRow = {
  service_id: number; visit_date: string | null; service_type: string | null
  is_paid: boolean | null; service_notes: string | null; customer_id: number | null; customers: Company
}
type SalesRow = {
  activity_id: number; activity_date: string; activity_type: string
  content: string | null; customer_id: number; customers: Company
}

export type DetailEngineer = {
  engineer_id: number
  name: string | null
  position: string | null
  teams: string | null
  office: string | null
}

type Props = {
  engineer: DetailEngineer
  startDate: string
  endDate: string
  variant: 'modal' | 'inline'
  onClose?: () => void      // 모달 전용: 우상단 닫기 버튼. inline 이면 렌더 안 함.
  headerRight?: ReactNode   // 헤더 우측 슬롯(동선 보기 왼쪽). 대시보드 월 스테퍼용.
}

export default function ActivityDetail({ engineer, startDate, endDate, variant, onClose, headerRight }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [details, setDetails] = useState<ActivityEntry[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [filterType, setFilterType] = useState<string>('전체')
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false })
  const listRef = useRef<HTMLDivElement>(null)
  const isModal = variant === 'modal'

  const [routeStops, setRouteStops] = useState<RouteStop[]>([])
  const [routeExcluded, setRouteExcluded] = useState(0)
  const [showRouteMap, setShowRouteMap] = useState(false)

  useEffect(() => {
    let cancelled = false
    const fetchDetails = async () => {
      setDetailLoading(true)
      setDetails([])
      setFilterType('전체')

      // 1) 서비스 기록 — 참여자 표를 거쳐 내 service_id 를 먼저 모은다(다대다).
      const { data: seData } = await supabase
        .from('service_engineers')
        .select('service_id')
        .eq('engineer_id', engineer.engineer_id)

      const serviceIds = (seData ?? []).map((se: ServiceLink) => se.service_id)

      const [shRes, saRes] = await Promise.all([
        serviceIds.length === 0
          ? Promise.resolve({ data: [] as ServiceRow[] })
          : supabase
              .from('service_history')
              .select('service_id, visit_date, service_type, is_paid, service_notes, customer_id, customers(company_name, latitude, longitude)')
              .in('service_id', serviceIds)
              .gte('visit_date', startDate)
              .lte('visit_date', endDate)
        // 2) 영업 활동 — engineer_id 가 단일이라 참여자 표 없이 바로 걸러진다.
        ,supabase
          .from('sales_activities')
          .select('activity_id, activity_date, activity_type, content, customer_id, customers(company_name, latitude, longitude)')
          .eq('engineer_id', engineer.engineer_id)
          .gte('activity_date', startDate)
          .lte('activity_date', endDate)
      ])

      if (cancelled) return
      const serviceEntries: ActivityEntry[] = ((shRes.data ?? []) as unknown as ServiceRow[]).map(sh => ({
        source: 'service',
        id: sh.service_id,
        engineerId: engineer.engineer_id,
        date: sh.visit_date ?? '',
        type: sh.service_type ?? '',
        customerId: sh.customer_id,
        customerName: sh.customers?.company_name ?? '-',
        notes: sh.service_notes,
        isPaid: sh.is_paid,
        lat: sh.customers?.latitude ?? null,
        lng: sh.customers?.longitude ?? null,
      }))
      const salesEntries: ActivityEntry[] = ((saRes.data ?? []) as unknown as SalesRow[]).map(a => ({
        source: 'sales',
        id: a.activity_id,
        engineerId: engineer.engineer_id,
        date: a.activity_date,
        type: a.activity_type,
        customerId: a.customer_id,
        customerName: a.customers?.company_name ?? '-',
        notes: a.content,
        isPaid: null,          // 영업 활동에는 유·무상 구분이 없다
        lat: a.customers?.latitude ?? null,
        lng: a.customers?.longitude ?? null,
      }))

      setDetails([...serviceEntries, ...salesEntries].sort(byDateDesc))
      setDetailLoading(false)
    }
    fetchDetails()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineer.engineer_id, startDate, endDate])

  // 스크롤 위치에 따라 상/하단 스크롤 힌트 표시 여부 갱신(모달 전용 inset shadow)
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const top = el.scrollTop > 0
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setScrollEdges(prev => (prev.top === top && prev.bottom === bottom) ? prev : { top, bottom })
  }, [detailLoading, filterType])

  const filteredDetails = filterType === '전체' ? details : details.filter(d => d.type === filterType)

  // 유형 칩은 실제로 기록이 있는 유형만 만든다(활동 카드와 같은 규칙).
  // 순서는 ACTIVITY_TYPES(서비스 6종 → 영업 4종) 를 따르고, 목록에 없는 값은 마지막에 붙인다.
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of details) if (d.type) m.set(d.type, (m.get(d.type) ?? 0) + 1)
    return m
  }, [details])
  const shownTypes = useMemo(() => {
    const known = ACTIVITY_TYPES.filter(t => typeCounts.has(t))
    const unknown = [...typeCounts.keys()].filter(t => !ACTIVITY_TYPES.includes(t)).sort()
    return [...known, ...unknown]
  }, [typeCounts])

  // 동선 지도용 stops(비방문 유형 제외). 지도에 찍을 게 없으면 '동선 보기' 버튼 비활성화.
  const routeResult = buildRoute(details)

  // 목록 컨테이너: 모달은 고정 높이 + 숨은 스크롤바 + inset 힌트. 인라인은 남는 높이 채우고 얇은 스크롤바.
  // 목록은 남는 높이만큼만 차지하고 그 안에서 스크롤한다.
  // 예전에는 모달일 때 height: 567 로 못 박아, 화면이 낮으면(노트북) 모달의 최대 높이를 넘겨
  // 목록이 카드 밖으로 삐져나왔다. 기본 flex(0 1 auto)라 내용이 짧으면 그만큼만 차지한다.
  const listStyle: CSSProperties = isModal
    ? {
        overflowY: 'auto', minHeight: 0,
        transition: 'box-shadow 0.15s ease',
        boxShadow: [
          scrollEdges.top ? 'inset 0 9px 7px -8px rgba(0,0,0,0.12)' : '',
          scrollEdges.bottom ? 'inset 0 -9px 7px -8px rgba(0,0,0,0.12)' : '',
        ].filter(Boolean).join(', ') || undefined,
      }
    : { overflowY: 'auto', flex: 1, minHeight: 0 }

  return (
    <>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
        .adm-no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .adm-no-scrollbar::-webkit-scrollbar { display: none; }
        .adm-thin-scroll { scrollbar-width: thin; scrollbar-color: #d1d5db transparent; }
        .adm-thin-scroll::-webkit-scrollbar { width: 6px; }
        .adm-thin-scroll::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
        .adm-thin-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      {/* 헤더 */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          {/* 오른쪽 버튼 묶음이 flexShrink: 0 이므로, 좁아질 때 줄어드는 쪽은 여기다.
              minWidth: 0 + 줄바꿈 허용으로 글자가 상자 밖으로 삐져나가지 않게 한다. */}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>{engineer.name}</span>
              <span style={{ fontSize: 12, color: GRAY, fontWeight: 500 }}>{engineer.position}</span>
              {engineer.teams && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: '#f3f4f6', color: '#6b7280' }}>
                  {engineer.teams}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: MUTED, flexWrap: 'wrap' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {headerRight}
            {/* 동선 보기 — 활동 현황(모달)에서만 노출. 대시보드(인라인)에선 숨김.
                모드 전환(visits/office)·주변 업체는 지도 안 토글로 처리한다. */}
            {isModal && (() => {
              const noStops = detailLoading || routeResult.stops.length === 0
              return (
                <button
                  onClick={() => { if (noStops) return; setRouteStops(routeResult.stops); setRouteExcluded(routeResult.excluded.length); setShowRouteMap(true) }}
                  disabled={noStops}
                  title={routeResult.stops.length === 0 ? '표시할 방문 기록이 없습니다' : '동선 지도 보기'}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px', borderRadius: 6, border: 'none',
                    fontSize: 13, fontWeight: 700,
                    background: noStops ? '#f3f4f6' : BLUE,
                    color: noStops ? '#9ca3af' : '#fff',
                    cursor: noStops ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={e => { if (!noStops) (e.currentTarget as HTMLButtonElement).style.background = '#1c3e87' }}
                  onMouseLeave={e => { if (!noStops) (e.currentTarget as HTMLButtonElement).style.background = BLUE }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
                  </svg>
                  동선 보기
                </button>
              )
            })()}
            {isModal && onClose && (
              <button onClick={onClose}
                style={{
                  width: 30, height: 30, borderRadius: '50%', background: '#f3f4f6', border: 'none',
                  cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: GRAY, flexShrink: 0, transition: 'background 0.15s ease',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb'}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6'}>
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 서비스 타입 필터.
          SegmentedControl 은 이 줄의 flex 아이템이라 기본값(flex-shrink: 1)대로 두면
          폭이 모자랄 때 스크롤되지 않고 자기 자신이 눌려서, 안의 버튼 글자가 잘려 보인다.
          → flexShrink: 0 으로 제 폭을 지키게 하고, 넘치는 만큼은 이 줄이 가로로 흐르게 한다.
          스크롤바는 감춰 뒀으므로 HorizontalScroller 로 좌우 이동 버튼을 붙여 넘친다는 것을 알린다. */}
      <HorizontalScroller step={200}>
        <div className="adm-no-scrollbar" style={{ padding: '10px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', overflowX: 'auto' }}>
          <div style={{ flexShrink: 0 }}>
            <SegmentedControl
              value={filterType}
              options={['전체', ...shownTypes].map(type => ({
                label: type,
                value: type,
                suffix: String(type === '전체' ? details.length : typeCounts.get(type) ?? 0),
              }))}
              onChange={setFilterType}
            />
          </div>
        </div>
      </HorizontalScroller>

      {/* 서비스 목록 */}
      <div
        ref={listRef}
        onScroll={e => {
          const el = e.currentTarget
          const top = el.scrollTop > 0
          const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
          setScrollEdges(prev => (prev.top === top && prev.bottom === bottom) ? prev : { top, bottom })
        }}
        className={isModal ? 'adm-no-scrollbar' : 'adm-thin-scroll'}
        style={listStyle}>
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
          filteredDetails.map((d) => {
            const sc = getCategoryColor(ACTIVITY_TYPE_COLORS, d.type)
            return (
              <div key={entryKey(d)}
                style={{
                  display: 'flex', alignItems: 'flex-start', padding: '11px 12px', gap: 12,
                  borderBottom: `1px solid ${BORDER}`,
                }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', lineHeight: '22px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.customerName}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 400, color: '#9ca3af', lineHeight: '16px', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.notes || ' '}
                  </div>
                </div>
                <div style={{ width: 110, flexShrink: 0, textAlign: 'left' }}>
                  <div style={{ lineHeight: '22px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#111827' }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: sc.dot ?? sc.text, flexShrink: 0 }} />
                      {d.type || '-'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, lineHeight: '16px', marginTop: 3 }}>
                    {/* 유·무상은 서비스 기록에만 있다. 영업 활동이면 이 자리가 비고 날짜만 남는다. */}
                    {d.isPaid !== null && (
                      <>
                        <span style={{ color: '#6b7280' }}>{d.isPaid ? '유상' : '무상'}</span>
                        <span style={{ color: '#d1d5db' }}> · </span>
                      </>
                    )}
                    <span style={{ color: '#9ca3af' }}>{d.date ? d.date.replace(/-/g, '.') : '-'}</span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 동선 지도 오버레이 */}
      {showRouteMap && (
        <RouteMapView
          stops={routeStops}
          engineerName={engineer.name ?? undefined}
          startDate={startDate}
          endDate={endDate}
          officeCode={engineer.office}
          excludedCount={routeExcluded}
          onClose={() => setShowRouteMap(false)}
        />
      )}
    </>
  )
}
