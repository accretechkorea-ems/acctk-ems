'use client'

import { useEffect, useRef, useState } from 'react'
import { loadKakaoMap } from '@/lib/loadKakaoMap'
import { geocodeAddress } from '@/lib/geocode'
import {
  CARD_BG,
  PANEL_BG,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  WHITE_BUTTON_BG,
  WHITE_BUTTON_TEXT,
  getDeviceLines,
  type Customer,
  type Device,
} from '@/lib/home'
import { OFFICES } from '@/lib/offices'
import { CATEGORY_OPTIONS } from '@/lib/constants'

type Props = {
  customers: Customer[]
  deviceMap: Map<number, Device[]>
  focusedCustomerId: number | null
  selectedStatuses: string[]
  toggleStatus: (status: string) => void
  selectedCategories: string[]
  toggleCategory: (category: string) => void
  onAddClick: () => void
  restoredMapCenter: { lat: number; lng: number } | null
  restoredMapLevel: number | null
  restoredOpenOverlayCustomerId: number | null
  onMapStateChange: (center: { lat: number; lng: number }, level: number) => void
  onOpenOverlayChange: (customerId: number | null) => void
}

export default function MapView({
  customers,
  deviceMap,
  focusedCustomerId,
  selectedStatuses,
  toggleStatus,
  selectedCategories,
  toggleCategory,
  onAddClick,
  restoredMapCenter,
  restoredMapLevel,
  restoredOpenOverlayCustomerId,
  onMapStateChange,
  onOpenOverlayChange,
}: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const kakaoMapRef = useRef<any>(null)
  const markerMapRef = useRef<Map<number, any>>(new Map())
  const openInfoWindowRef = useRef<{ id: number; iw: any } | null>(null)
  const clustererRef = useRef<any>(null)
  const customerMapRef = useRef<Map<number, Customer>>(new Map())
  const [isMapReady, setIsMapReady] = useState(false)
  const restoredMapStateAppliedRef = useRef(false)

  // 길찾기 출발지 — 사무실 공용 상수(lib/offices)에서 로드. name 은 주소(=출발지 이름).
  // 동탄 좌표는 고정, 울산·구미는 init에서 주소를 지오코딩해 채운다(아래 로직 유지).
  const originsRef = useRef<Record<string, { lat: number; lng: number; name: string }>>(
    Object.fromEntries(
      OFFICES.map(o => [o.code, { lat: o.lat, lng: o.lng, name: o.address }])
    ) as Record<string, { lat: number; lng: number; name: string }>
  )

  // HTML 특수문자 이스케이프 — innerHTML에 DB 데이터 삽입 시 XSS 방지
  const esc = (s: string | null | undefined): string =>
    (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  // 오버레이 동적 생성 함수
  const createOverlay = (c: Customer, map: any, kakao: any) => {
    const devices = deviceMap.get(Number(c.customer_id)) || []
    const deviceLines = getDeviceLines(devices)
    const makeNavUrl = (o: { lat: number; lng: number; name: string }) =>
      `https://map.naver.com/p/directions/${o.lng},${o.lat},${encodeURIComponent(o.name)}/${c.longitude},${c.latitude},${encodeURIComponent(c.company_name)}/-/car`
    const overlayContent = document.createElement('div')
    overlayContent.addEventListener('click', (e) => e.stopPropagation())
    overlayContent.addEventListener('mousedown', (e) => e.stopPropagation())
    overlayContent.addEventListener('touchstart', (e) => e.stopPropagation())
    overlayContent.addEventListener('touchend', (e) => e.stopPropagation())
    overlayContent.addEventListener('touchmove', (e) => e.stopPropagation())

    const statusColor = c.status === '활성' ? '#22c55e' : c.status === '잠재' ? '#f59e0b' : c.status === '이탈' ? '#f43f5e' : '#9ca3af'
    overlayContent.innerHTML = `
      <div style="
        width:296px;
        background:#ffffff;
        color:#111827;
        border-radius:8px;
        border:1px solid #ebebeb;
        box-sizing:border-box;
        word-break:break-word;
        box-shadow:0 16px 40px rgba(0,0,0,0.18);
        overflow:hidden;
      ">
        <div style="padding:14px 16px;">

          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:5px;">
            <div style="font-weight:800; font-size:17px; color:#111827; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0;">
              ${esc(c.company_name)}
            </div>
            <span style="display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; color:#6b7280; flex-shrink:0; white-space:nowrap;">
              <span style="width:7px; height:7px; border-radius:50%; background:${statusColor}; flex-shrink:0;"></span>
              ${esc(c.status) || '-'}
            </span>
          </div>

          <div style="font-size:12px; color:${c.address ? '#6b7280' : '#ef4444'}; font-weight:${c.address ? '400' : '600'}; line-height:1.45; margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${c.address ? esc(c.address) : '주소 정보 없음 — 등록 필요'}
          </div>

          <div style="font-size:11px; color:#9ca3af; margin-bottom:8px;">대리점 ${esc(c.agency) || '-'}</div>

          <div style="display:flex; flex-direction:column; gap:3px;">
            ${deviceLines.length === 1 && deviceLines[0] === '-'
              ? `<span style="font-size:11px; color:#d1d5db; font-style:italic;">장비 없음</span>`
              : `${deviceLines.slice(0, 4).map(l => `<span style="font-size:11px; color:#234ea2; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(l)}</span>`).join('')}${deviceLines.length > 4 ? `<span style="font-size:11px; font-weight:500; color:#9ca3af;">외 ${deviceLines.length - 4}대 더</span>` : ''}`}
          </div>

          <div style="margin-top:12px; padding-top:12px; border-top:1px solid #ebebeb; display:flex; flex-direction:column; gap:7px;">
            <div class="overlay-detail"></div>
            <div class="overlay-nav" style="display:flex; align-items:center; gap:7px;"></div>
          </div>

        </div>
      </div>
    `

    // 버튼을 DOM API로 직접 생성 — innerHTML querySelector 방식 대신 직접 참조 보장
    const detailSlot = overlayContent.querySelector('.overlay-detail') as HTMLElement
    const navRow = overlayContent.querySelector('.overlay-nav') as HTMLElement
    if (detailSlot && navRow) {
      const detailUrl = `/customer/${c.customer_id}`
      let navigated = false
      const goDetail = () => {
        if (navigated) return
        navigated = true
        window.location.href = detailUrl
      }

      const detailBtn = document.createElement('button')
      detailBtn.textContent = '상세보기'
      detailBtn.style.cssText = 'width:100%;text-align:center;padding:8px 14px;background:#234ea2;color:#ffffff;border-radius:6px;font-size:13px;font-weight:700;border:none;cursor:pointer;'
      // touchstart에서 stopPropagation — 카카오맵이 터치 시퀀스 자체를 가로채지 못하도록
      detailBtn.addEventListener('touchstart', (e) => { e.stopPropagation() }, { passive: true })
      detailBtn.addEventListener('touchend', (e) => { e.stopPropagation(); e.preventDefault(); goDetail() })
      detailBtn.addEventListener('pointerup', (e) => { e.stopPropagation(); goDetail() })
      detailBtn.addEventListener('click', (e) => { e.stopPropagation(); goDetail() })

      const makeNavLink = (href: string, label: string) => {
        const a = document.createElement('a')
        a.href = href
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.textContent = label
        a.style.cssText = 'flex:1 1 0;text-align:center;padding:7px 0;background:#ffffff;color:#6b7280;border:1px solid #ebebeb;border-radius:6px;font-size:12px;text-decoration:none;font-weight:700;'
        a.addEventListener('touchstart', (e) => { e.stopPropagation() }, { passive: true })
        a.addEventListener('click', (e) => { e.stopPropagation() })
        return a
      }

      const O = originsRef.current
      detailSlot.appendChild(detailBtn)
      navRow.appendChild(makeNavLink(makeNavUrl(O.ulsan), '울산 출발'))
      navRow.appendChild(makeNavLink(makeNavUrl(O.gumi), '구미 출발'))
      navRow.appendChild(makeNavLink(makeNavUrl(O.dongtan), '동탄 출발'))
    }

    return new kakao.maps.CustomOverlay({
      content: overlayContent,
      position: new kakao.maps.LatLng(Number(c.latitude), Number(c.longitude)),
      yAnchor: 1.25,
      zIndex: 3,
    })
  }

  // 지도 초기화
useEffect(() => {
    let mounted = true

    async function initMap() {
      if (!mapRef.current) return
      const kakao = await loadKakaoMap()
      if (!mounted) return

      // 출발지(울산·구미) 주소를 좌표로 변환해 캐시 — 길찾기 출발 좌표 정확도 확보
      void Promise.all(
        (['ulsan', 'gumi'] as const).map(async (key) => {
          try {
            const { latitude, longitude } = await geocodeAddress(originsRef.current[key].name)
            originsRef.current[key] = { ...originsRef.current[key], lat: latitude, lng: longitude }
          } catch {
            /* 지오코딩 실패 시 초기 좌표 유지 */
          }
        })
      )

      if (!kakaoMapRef.current) {
       const isMobile = window.innerWidth <= 768
        kakaoMapRef.current = new kakao.maps.Map(mapRef.current, {
          center: new kakao.maps.LatLng(isMobile ? 38.6 : 36.5, isMobile ? 128.0 : 127.8),
          level: isMobile ? 12 : 12,
        })

         ;(window as any).__kakaoMapInstance = kakaoMapRef.current

        const resizeObserver = new ResizeObserver(() => {
          kakaoMapRef.current?.relayout()
        })
        resizeObserver.observe(mapRef.current!)

        kakao.maps.event.addListener(kakaoMapRef.current, 'click', () => {
          if (openInfoWindowRef.current) {
            openInfoWindowRef.current.iw.setMap(null)
            openInfoWindowRef.current = null
            onOpenOverlayChange(null)
          }
        })

        kakao.maps.event.addListener(kakaoMapRef.current, 'idle', () => {
          const center = kakaoMapRef.current.getCenter()
          const level = kakaoMapRef.current.getLevel()
          onMapStateChange({ lat: center.getLat(), lng: center.getLng() }, level)
        })
      }

      setIsMapReady(true)
    }

    initMap()
    return () => { mounted = false }
  }, [])

  // 마커 렌더링 - 변경분만 처리
  useEffect(() => {
    if (!isMapReady || !kakaoMapRef.current) return

    let cancelled = false

    async function renderMarkers() {
      const kakao = await loadKakaoMap()
      if (cancelled) return

      const map = kakaoMapRef.current
      if (!map) return

      const newCustomerMap = new Map<number, Customer>()
      customers.forEach((c) => newCustomerMap.set(c.customer_id, c))

      // 삭제: 현재 마커 중 새 목록에 없는 것
      const toDelete: number[] = []
      markerMapRef.current.forEach((_, id) => {
        if (!newCustomerMap.has(id)) toDelete.push(id)
      })

      toDelete.forEach((id) => {
        const marker = markerMapRef.current.get(id)
        if (marker) marker.setMap(null)
        markerMapRef.current.delete(id)

        if (openInfoWindowRef.current?.id === id) {
          openInfoWindowRef.current.iw.setMap(null)
          openInfoWindowRef.current = null
          onOpenOverlayChange(null)
        }
      })

      // 추가: 새 목록 중 현재 마커에 없는 것만
      const toAdd: Customer[] = []
      customers.forEach((c) => {
        if (!markerMapRef.current.has(c.customer_id)) toAdd.push(c)
      })

      const newMarkers: any[] = []

      toAdd.forEach((c) => {
        if (c.latitude == null || c.longitude == null) return
        const lat = Number(c.latitude)
        const lng = Number(c.longitude)
        if (Number.isNaN(lat) || Number.isNaN(lng)) return

        const marker = new kakao.maps.Marker({
          position: new kakao.maps.LatLng(lat, lng),
        })

        kakao.maps.event.addListener(marker, 'click', () => {
          // 오버레이를 클릭 시점에 동적 생성
          if (openInfoWindowRef.current?.id === c.customer_id) {
            openInfoWindowRef.current.iw.setMap(null)
            openInfoWindowRef.current = null
            onOpenOverlayChange(null)
            return
          }

          if (openInfoWindowRef.current) {
            openInfoWindowRef.current.iw.setMap(null)
          }

          const overlay = createOverlay(c, map, kakao)
          overlay.setMap(map)
          openInfoWindowRef.current = { id: c.customer_id, iw: overlay }
          onOpenOverlayChange(c.customer_id)
        })

        markerMapRef.current.set(c.customer_id, marker)
        newMarkers.push(marker)
      })

      customerMapRef.current = newCustomerMap

      // 클러스터러에 새 마커만 추가
      if ((window as any).kakao?.maps?.MarkerClusterer) {
        if (!clustererRef.current) {
          clustererRef.current = new kakao.maps.MarkerClusterer({
            map,
            averageCenter: true,
            minLevel: 7,
            disableClickZoom: false,
            markers: [],
            styles: [
              {
                width: '48px', height: '48px',
                background: 'rgba(255,255,255,0.82)', color: '#111113',
                textAlign: 'center', lineHeight: '48px', borderRadius: '8px',
                fontSize: '14px', fontWeight: '700',
                border: '1px solid rgba(255,255,255,0.95)',
                boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
              },
              {
                width: '56px', height: '56px',
                background: 'rgba(245,245,245,0.88)', color: '#111113',
                textAlign: 'center', lineHeight: '56px', borderRadius: '8px',
                fontSize: '15px', fontWeight: '700',
                border: '1px solid rgba(255,255,255,0.95)',
                boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
              },
              {
                width: '64px', height: '64px',
                background: 'rgba(230,230,230,0.9)', color: '#111113',
                textAlign: 'center', lineHeight: '64px', borderRadius: '8px',
                fontSize: '16px', fontWeight: '700',
                border: '1px solid rgba(255,255,255,0.95)',
                boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
              },
            ],
          })
        }

        if (toDelete.length > 0) {
          // 삭제된 마커 클러스터에서 제거
          clustererRef.current.clear()
          const allMarkers: any[] = []
          markerMapRef.current.forEach((marker) => allMarkers.push(marker))
          clustererRef.current.addMarkers(allMarkers)
        } else if (newMarkers.length > 0) {
          clustererRef.current.addMarkers(newMarkers)
        }
      } else {
        newMarkers.forEach((marker) => marker.setMap(map))
      }
    }

    renderMarkers()
    return () => { cancelled = true }
  }, [isMapReady, customers, deviceMap])

  // 지도 상태 복원
  useEffect(() => {
    if (!isMapReady || !kakaoMapRef.current) return
    if (restoredMapStateAppliedRef.current) return
    if (customers.length === 0) return

    const kakao = (window as any).kakao
    if (!kakao?.maps) return

    const map = kakaoMapRef.current

    if (restoredMapCenter && restoredMapLevel !== null) {
      map.setLevel(restoredMapLevel)
      map.setCenter(new kakao.maps.LatLng(restoredMapCenter.lat, restoredMapCenter.lng))
    }

    if (restoredOpenOverlayCustomerId != null) {
      const customer = customerMapRef.current.get(restoredOpenOverlayCustomerId)
      if (customer) {
        setTimeout(async () => {
          const kakao = await loadKakaoMap()
          const overlay = createOverlay(customer, map, kakao)
          overlay.setMap(map)
          openInfoWindowRef.current = { id: restoredOpenOverlayCustomerId, iw: overlay }
        }, 300)
      }
    }

    restoredMapStateAppliedRef.current = true
  }, [isMapReady, customers, restoredMapCenter, restoredMapLevel, restoredOpenOverlayCustomerId])

  // 업체 포커스
  useEffect(() => {
    if (!focusedCustomerId || !kakaoMapRef.current) return
    if (!isMapReady) return

    const kakaoMap = kakaoMapRef.current
    const targetCustomer = customers.find(
      (c) => Number(c.customer_id) === Number(focusedCustomerId)
    )

    if (!targetCustomer || targetCustomer.latitude == null || targetCustomer.longitude == null) return

    const lat = Number(targetCustomer.latitude)
    const lng = Number(targetCustomer.longitude)
    if (Number.isNaN(lat) || Number.isNaN(lng)) return

    if (openInfoWindowRef.current) {
      openInfoWindowRef.current.iw.setMap(null)
      openInfoWindowRef.current = null
    }

    kakaoMap.setLevel(4)

    // 마커를 화면 정중앙이 아니라 "중앙보다 살짝 아래"에 두어, 위쪽에 뜨는
    // 설명 카드가 잘리지 않도록 지도 중심을 마커보다 위(북쪽)로 픽셀만큼 이동
    const kakaoNS = (window as any).kakao.maps
    const targetLatLng = new kakaoNS.LatLng(lat, lng)
    try {
      const OFFSET_Y = 100 // px — 클수록 마커가 더 아래로 내려감
      const proj = kakaoMap.getProjection()
      const markerPt = proj.pointFromCoords(targetLatLng)
      const centerCoords = proj.coordsFromPoint(new kakaoNS.Point(markerPt.x, markerPt.y - OFFSET_Y))
      kakaoMap.panTo(centerCoords)
    } catch {
      kakaoMap.panTo(targetLatLng)
    }

    setTimeout(async () => {
      const kakao = await loadKakaoMap()
      const overlay = createOverlay(targetCustomer, kakaoMap, kakao)
      overlay.setMap(kakaoMap)
      openInfoWindowRef.current = { id: targetCustomer.customer_id, iw: overlay }
      onOpenOverlayChange(targetCustomer.customer_id)
    }, 350)
  }, [focusedCustomerId, isMapReady, customers])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* 좌측 상단 필터 */}
      <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
        {/* 1행: 상태 필터 */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {([
            { label: '활성', color: '#22c55e', shadow: 'rgba(22,163,74,0.30)' },
            { label: '잠재', color: '#f59e0b', shadow: 'rgba(245,158,11,0.30)' },
            { label: '이탈', color: '#f43f5e', shadow: 'rgba(239,68,68,0.30)' },
          ] as const).map(({ label, color }) => {
            const active = selectedStatuses.includes(label)
            return (
              <button key={label} onClick={() => toggleStatus(label)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 12px', borderRadius: 6,
                  border: `1px solid ${active ? '#d1d5db' : 'rgba(235,235,235,0.8)'}`,
                  background: active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.65)',
                  color: active ? '#111827' : '#9ca3af',
                  fontWeight: 700, fontSize: 12, cursor: 'pointer',
                  backdropFilter: 'blur(4px)',
                  transition: 'all 0.15s ease',
                }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: color,
                  opacity: active ? 1 : 0.35,
                  transition: 'opacity 0.15s ease',
                }} />
                {label}
              </button>
            )
          })}
        </div>

        {/* 2행: 계열 필터 */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {CATEGORY_OPTIONS.map(cat => {
            const active = selectedCategories.includes(cat)
            return (
              <button key={cat} onClick={() => toggleCategory(cat)}
                style={{
                  padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                  border: `1px solid ${active ? '#d1d5db' : 'rgba(235,235,235,0.8)'}`,
                  background: active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.65)',
                  color: active ? '#111827' : '#9ca3af',
                  fontWeight: 700,
                  backdropFilter: 'blur(4px)',
                  transition: 'all 0.15s ease',
                }}>
                {cat}
              </button>
            )
          })}
        </div>
      </div>

      {/* 우측 상단 업체 등록 */}
      <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 1000 }}>
        <button
          onClick={onAddClick}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 6, border: 'none',
            background: '#234ea2', color: '#ffffff',
            fontWeight: 700, fontSize: 13, cursor: 'pointer',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          업체 등록
        </button>
      </div>

      {/* 지도 */}
     <div
        ref={mapRef}
        className="kakao-map-container"
        style={{
          width: '100%', height: '100%', minHeight: 0,
          borderRadius: 8, overflow: 'hidden',
          border: `1px solid #ebebeb`,
          boxSizing: 'border-box', background: PANEL_BG,
        }}
      />
    </div>
  )
}