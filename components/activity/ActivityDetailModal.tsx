'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SERVICE_TYPE_COLORS, getCategoryColor } from '@/lib/categoryColors'
import ModalOverlay from '@/components/common/ModalOverlay'
import SegmentedControl from '@/components/common/SegmentedControl'
import { buildRoute, type ServiceDetail, type RouteStop } from '@/lib/routeMap'
import RouteMapView from '@/components/activity/RouteMapView'
import { SERVICE_TYPES } from '@/components/activity/ActivityCard'

// 활동 서비스 기록 상세 모달(동선 보기 포함). 활동 현황 페이지·개인 대시보드가 공유한다.
// 상세 조회(fetchDetails)와 내부 상태를 스스로 관리한다. 부모는 engineer/기간/onClose 만 넘긴다.

const BLUE = '#234ea2'
const CARD_BG = '#ffffff'
const BORDER = '#ebebeb'
const TEXT = '#111827'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'

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
  onClose: () => void
}

export default function ActivityDetailModal({ engineer, startDate, endDate, onClose }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [details, setDetails] = useState<ServiceDetail[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [filterType, setFilterType] = useState<string>('전체')
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false })
  const listRef = useRef<HTMLDivElement>(null)

  const [routeStops, setRouteStops] = useState<RouteStop[]>([])
  const [routeExcluded, setRouteExcluded] = useState(0)
  const [showRouteMap, setShowRouteMap] = useState(false)

  useEffect(() => {
    let cancelled = false
    const fetchDetails = async () => {
      setDetailLoading(true)
      setDetails([])
      setFilterType('전체')

      const { data: seData } = await supabase
        .from('service_engineers')
        .select('service_id')
        .eq('engineer_id', engineer.engineer_id)

      const serviceIds = (seData ?? []).map((se: any) => se.service_id)
      if (serviceIds.length === 0) { if (!cancelled) setDetailLoading(false); return }

      const { data: shData } = await supabase
        .from('service_history')
        .select('service_id, visit_date, service_type, is_paid, service_notes, customer_id, customers(company_name, latitude, longitude)')
        .in('service_id', serviceIds)
        .gte('visit_date', startDate)
        .lte('visit_date', endDate)
        .order('visit_date', { ascending: false })

      if (cancelled) return
      const result: ServiceDetail[] = (shData ?? []).map((sh: any) => ({
        service_id: sh.service_id,
        visit_date: sh.visit_date,
        service_type: sh.service_type,
        is_paid: sh.is_paid,
        customer_id: sh.customer_id,
        customer_name: sh.customers?.company_name ?? '-',
        service_notes: sh.service_notes,
        lat: sh.customers?.latitude ?? null,
        lng: sh.customers?.longitude ?? null,
      }))
      setDetails(result)
      setDetailLoading(false)
    }
    fetchDetails()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineer.engineer_id, startDate, endDate])

  // 스크롤 위치에 따라 상/하단 스크롤 힌트 표시 여부 갱신
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const top = el.scrollTop > 0
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setScrollEdges(prev => (prev.top === top && prev.bottom === bottom) ? prev : { top, bottom })
  }, [detailLoading, filterType])

  const filteredDetails = filterType === '전체' ? details : details.filter(d => d.service_type === filterType)
  // 동선 지도용 stops(유선기술지원 제외). 지도에 찍을 게 없으면 '동선 보기' 버튼 비활성화.
  const routeResult = buildRoute(details)

  return (
    <>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
        @keyframes modal-in { from { opacity: 0; transform: scale(0.97) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        .adm-no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .adm-no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>

      <ModalOverlay onClose={onClose}
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
                  <span style={{ fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>{engineer.name}</span>
                  <span style={{ fontSize: 12, color: GRAY, fontWeight: 500 }}>{engineer.position}</span>
                  {engineer.teams && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: '#f3f4f6', color: '#6b7280' }}>
                      {engineer.teams}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {(() => {
                  const disabled = detailLoading || routeResult.stops.length === 0
                  return (
                    <button
                      onClick={() => { if (disabled) return; setRouteStops(routeResult.stops); setRouteExcluded(routeResult.excluded.length); setShowRouteMap(true) }}
                      disabled={disabled}
                      title={routeResult.stops.length === 0 ? '표시할 방문 기록이 없습니다' : '동선 지도 보기'}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '6px 12px', borderRadius: 6, border: 'none',
                        fontSize: 13, fontWeight: 700,
                        background: disabled ? '#f3f4f6' : BLUE,
                        color: disabled ? '#9ca3af' : '#fff',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = '#1c3e87' }}
                      onMouseLeave={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = BLUE }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
                      </svg>
                      동선 보기
                    </button>
                  )
                })()}
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
              </div>
            </div>
          </div>

          {/* 서비스 타입 필터 */}
          <div style={{ padding: '10px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex' }}>
            <SegmentedControl
              value={filterType}
              options={(['전체', ...SERVICE_TYPES] as string[]).map(type => ({
                label: type,
                value: type,
                suffix: String(type === '전체' ? details.length : details.filter(d => d.service_type === type).length),
              }))}
              onChange={setFilterType}
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
            className="adm-no-scrollbar"
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
              filteredDetails.map((d) => {
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
                        {d.service_notes || ' '}
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
      </ModalOverlay>

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
