'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { loadKakaoMap } from '@/lib/loadKakaoMap'
import { createClient } from '@/lib/supabase/client'
import type { RouteStop } from '@/lib/routeMap'
import { useOffices, findOffice } from '@/lib/offices'
import { Z } from '@/lib/zIndex'

// 엔지니어 동선 지도(전체 화면 오버레이). 방문지 마커 + 연결선 + 사무실 마커.
// 연결선 모드는 지도 안 토글로 전환한다(기본 visits, 열 때마다 초기화):
//   visits — 같은 날 방문지끼리만 실선. 날짜가 바뀌는 구간은 실제 경로를 알 수 없어 선 없음.
//   office — 날짜별로 사무실→방문지들→사무실. 사무실 구간은 점선(가정), 방문지 간은 실선.
// [주변 업체] 토글: 각 방문지 반경 5km 이내 customers 를 회색 점으로 표시(방문지 제외, 첫 켤 때만 조회·캐시).
type Props = {
  stops: RouteStop[]
  onClose: () => void
  engineerName?: string
  startDate?: string
  endDate?: string
  officeCode?: string | null // engineers.office. getOffice() 로 조회, 없으면 사무실 마커 미표시.
  excludedCount?: number     // 비방문(유선기술지원·전화상담)으로 제외된 기록 수(하단 안내용)
}

// 이 level 이하(확대)에서만 마커를 부채꼴/원형으로 분산한다. 그 이상(축소)이면
// 48px 오프셋이 실거리로 수 km가 되어 위치가 왜곡되므로 원래 좌표에 하나로 모은다.
// 실측하며 조정할 수 있게 상수로 분리(카카오 level 은 작을수록 확대).
const SPREAD_MAX_LEVEL = 5

const NEARBY_RADIUS_KM = 5 // 주변 업체 표시 반경

// 두 좌표 사이 거리(km) — 하버사인. 주변 업체 5km 필터용.
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

type NearbyCustomer = { lat: number; lng: number; name: string }

export default function RouteMapView({ stops, onClose, engineerName, startDate, endDate, officeCode, excludedCount = 0 }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const mapRef = useRef<HTMLDivElement>(null)
  const infoRef = useRef<any>(null) // 현재 열린 정보창(하나만 유지)
  const polylinesRef = useRef<any[]>([]) // 구간별 연결선(모드 전환·언마운트 시 정리)
  const markerOverlaysRef = useRef<any[]>([]) // 클러스터 마커(줌 변경 시 다시 그림)
  const officeOverlayRef = useRef<any>(null) // 사무실 마커(1회 생성, 언마운트 시 정리)
  const mapObjRef = useRef<any>(null) // 카카오 지도 인스턴스(토글 효과에서 사용)
  const drawPolylinesRef = useRef<((m: 'visits' | 'office') => void) | null>(null)
  const drawNearbyRef = useRef<(() => void) | null>(null)
  const clearNearbyRef = useRef<(() => void) | null>(null)
  const nearbyOverlaysRef = useRef<any[]>([]) // 주변 업체 회색 점
  const nearbyCacheRef = useRef<NearbyCustomer[] | null>(null) // null = 아직 미조회(첫 켤 때만 조회)

  // 지도 안 토글 상태. 기본값은 둘 다 켜짐(office 모드 + 주변 업체). 사무실 미지정이면 office 는 시각상 visits 로 처리된다.
  // 지도를 닫았다 열면 컴포넌트가 새로 마운트되므로 이 기본값으로 다시 초기화된다.
  const [mode, setMode] = useState<'visits' | 'office'>('office')
  const [showNearby, setShowNearby] = useState(true)
  const [nearbyFailed, setNearbyFailed] = useState(false) // customers 조회 실패 시 토글 비활성화
  const [mapReady, setMapReady] = useState(false)

  // 사무실은 offices 테이블이 정본이다. 비활성 사무실도 findOffice 로 찾아 마커를 그린다
  // (지난 활동이 그 사무실 소속일 수 있으므로).
  const { offices, loading: officesLoading } = useOffices()
  const officeInfo = findOffice(offices, officeCode) // 소속 사무실(없으면 undefined)

  /**
   * 사무실을 지도에 쓸 수 있는지, 못 쓴다면 왜인지.
   * 예전에는 이 넷이 모두 "선이 안 그려짐" 하나로 뭉개져 원인을 알 수 없었다.
   *   loading  조회 중 — 지도 생성을 미룬다(이때 만든 지도는 사무실을 모른 채 굳는다)
   *   failed   조회 실패. offices 는 늘 몇 행 있으므로 다 읽고도 0행이면 실패로 본다
   *   none     engineers.office 가 비어 있음
   *   missing  코드는 있는데 offices 에 그 code 가 없음
   *   nocoord  사무실은 찾았는데 위경도가 비어 있음
   *   ok       쓸 수 있다
   */
  const officeState: 'loading' | 'failed' | 'none' | 'missing' | 'nocoord' | 'ok' =
    officesLoading ? 'loading'
    : offices.length === 0 ? 'failed'
    : !officeCode ? 'none'
    : !officeInfo ? 'missing'
    : officeInfo.latitude == null || officeInfo.longitude == null ? 'nocoord'
    : 'ok'

  // 좌표까지 확인된 사무실만 지도에 쓴다. 없는 좌표를 0 으로 메우면 (0,0) 바다에 마커와 선이 그려진다.
  const officePoint = officeState === 'ok' && officeInfo
    ? { lat: officeInfo.latitude as number, lng: officeInfo.longitude as number }
    : null

  /** 사무실을 못 쓰는 이유. 토글 옆 안내와 버튼 title 에 같은 문구를 쓴다. */
  const officeHint =
    officeState === 'none' ? '소속 사무실이 지정되지 않았습니다'
    : officeState === 'missing' ? `사무실 정보를 찾을 수 없습니다 (코드: ${officeCode})`
    : officeState === 'nocoord' ? '사무실 좌표가 등록되지 않았습니다'
    : officeState === 'failed' ? '사무실 정보를 불러오지 못했습니다'
    : null

  const isOffice = mode === 'office' && !!officePoint
  // 같은 날 인접 구간이 하나라도 있으면 실선이 그려지므로 범례를 노출(visits 모드 전용).
  const hasSameDaySegment = stops.some((s, i) => i > 0 && stops[i - 1].date === s.date)

  // 조회 실패는 화면 문구만으로는 원인을 좁히기 어려우므로 콘솔에도 남긴다.
  useEffect(() => {
    if (officeState === 'failed') console.error('[RouteMapView] 사무실 정보를 불러오지 못했습니다 (offices 조회 결과 0행)')
  }, [officeState])

  // ESC 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 지도 초기화 — useEffect 는 페인트 이후 실행되므로 오버레이 컨테이너 크기가
  // 확정된 뒤에 지도를 만든다. 추가로 relayout() 1회 + ResizeObserver 로 보정.
  // 모드/주변업체 토글은 재초기화 없이 별도 effect 에서 다시 그린다(지도 시점 유지).
  useEffect(() => {
    if (stops.length === 0) return // 빈 경우 지도 미생성(아래 렌더에서 안내)
    // 사무실 조회가 끝나기 전에 지도를 만들면, 이 아래 코드가 officeInfo 를 undefined 인 채로
    // 클로저에 가둬 사무실 마커·경로선이 영영 그려지지 않는다(조회를 DB 로 옮기며 생긴 문제).
    if (officesLoading) return

    let mounted = true
    let ro: ResizeObserver | null = null
    setMapReady(false)

    const initMap = async () => {
      const kakao = await loadKakaoMap()
      if (!mounted || !mapRef.current) return

      const map = new kakao.maps.Map(mapRef.current, {
        center: new kakao.maps.LatLng(stops[0].lat, stops[0].lng),
        level: 6,
      })
      mapObjRef.current = map

      // 모달 안에서 0 크기로 초기화되면 회색만 나오는 문제 대비: 생성 직후 한 번 relayout.
      map.relayout()

      // 초기 범위: 방문지 + 사무실(있으면) 을 모두 포함. 지점이 하나면 센터만 잡고 확대.
      const boundsPoints = stops.map(s => ({ lat: s.lat, lng: s.lng }))
      if (officePoint) boundsPoints.push(officePoint)
      if (boundsPoints.length === 1) {
        map.setCenter(new kakao.maps.LatLng(boundsPoints[0].lat, boundsPoints[0].lng))
        map.setLevel(5)
      } else {
        const bounds = new kakao.maps.LatLngBounds()
        boundsPoints.forEach(p => bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)))
        map.setBounds(bounds)
      }

      const openInfo = (pos: any, s: RouteStop) => {
        if (infoRef.current) infoRef.current.setMap(null)
        // 정보창은 문자열 대신 DOM 으로 만들어 업체명을 textContent 로 안전하게 삽입.
        const box = document.createElement('div')
        box.style.cssText =
          'padding:10px 12px;background:#fff;border:1px solid #ebebeb;border-radius:8px;box-shadow:0 16px 40px rgba(0,0,0,0.18);white-space:nowrap'
        const name = document.createElement('div')
        name.textContent = s.companyName
        name.style.cssText = 'font-size:13px;font-weight:700;color:#111827'
        const cnt = document.createElement('div')
        cnt.textContent = `작업 ${s.serviceCount}건`
        cnt.style.cssText = 'font-size:11px;font-weight:500;color:#6b7280;margin-top:3px'
        box.append(name, cnt)
        const info = new kakao.maps.CustomOverlay({ position: pos, yAnchor: 1.4, zIndex: 5, content: box })
        info.setMap(map)
        infoRef.current = info
      }

      // 방문지 마커 dot — 반전 색(흰 내부 + #234ea2 3px 테두리)으로 흰 배경 지도에서 대비 확보.
      // 날짜 라벨(파란 배경 + 흰 글씨)은 그대로. dx/dy(px)로 원래 좌표에서 흩뜨릴 수 있다.
      const NS = 'http://www.w3.org/2000/svg'
      const mmdd = (date: string) => { const [, mm, dd] = date.split('-'); return `${Number(mm)}/${Number(dd)}` }
      // moreCount>0 이면 날짜 뒤에 '+N건' 강조 배지(흰 배경 + #234ea2 글자, pill 과 반전)를 붙인다.
      const makeDot = (label: string, dx: number, dy: number, onClick: () => void, moreCount = 0) => {
        const g = document.createElement('div')
        g.style.cssText = `position:absolute;left:0;top:0;transform:translate(${dx}px,${dy}px)`
        const dot = document.createElement('div')
        dot.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,-50%);width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid #234ea2;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer'
        const pill = document.createElement('div')
        pill.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,calc(-100% - 13px));padding:2px 7px;background:#234ea2;color:#fff;border-radius:6px;font-size:11px;font-weight:600;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;display:inline-flex;align-items:center'
        const dateSpan = document.createElement('span')
        dateSpan.textContent = label
        pill.appendChild(dateSpan)
        if (moreCount > 0) {
          const badge = document.createElement('span')
          badge.textContent = `+${moreCount}건`
          badge.style.cssText = 'margin-left:5px;padding:0 4px;background:#fff;color:#234ea2;border-radius:5px;font-weight:700'
          pill.appendChild(badge)
        }
        const handler = (e: Event) => { e.stopPropagation(); onClick() }
        dot.addEventListener('click', handler)
        pill.addEventListener('click', handler)
        g.append(dot, pill)
        return g
      }

      // 여러 방문이 한 좌표에 모였을 때(축소 상태) 전체를 목록으로 보여주는 정보창.
      const openClusterInfo = (pos: any, items: RouteStop[]) => {
        if (infoRef.current) infoRef.current.setMap(null)
        const box = document.createElement('div')
        box.style.cssText = 'background:#fff;border:1px solid #ebebeb;border-radius:8px;box-shadow:0 16px 40px rgba(0,0,0,0.18);max-height:240px;overflow:auto;min-width:180px'
        items.forEach((s, i) => {
          const row = document.createElement('div')
          row.style.cssText = `padding:8px 12px;white-space:nowrap;${i > 0 ? 'border-top:1px solid #f3f4f6;' : ''}`
          const name = document.createElement('div')
          name.textContent = s.companyName
          name.style.cssText = 'font-size:13px;font-weight:700;color:#111827'
          const meta = document.createElement('div')
          meta.textContent = `${mmdd(s.date)} · 작업 ${s.serviceCount}건`
          meta.style.cssText = 'font-size:11px;font-weight:500;color:#6b7280;margin-top:2px'
          row.append(name, meta)
          box.appendChild(row)
        })
        const info = new kakao.maps.CustomOverlay({ position: pos, yAnchor: 1.4, zIndex: 5, content: box })
        info.setMap(map)
        infoRef.current = info
      }

      // 좌표가 동일/근접(0.0003도 이내)한 stop 을 클러스터로 묶는다.
      type Cluster = { lat: number; lng: number; items: RouteStop[] }
      const clusters: Cluster[] = []
      for (const s of stops) {
        const c = clusters.find(c => Math.abs(c.lat - s.lat) <= 0.0003 && Math.abs(c.lng - s.lng) <= 0.0003)
        if (c) c.items.push(s)
        else clusters.push({ lat: s.lat, lng: s.lng, items: [s] })
      }

      // 흩뜨림 오프셋(px) 계산 — 날짜 라벨('M/D' 대략 40px) 겹침 방지가 목적.
      //  · 2개: 위쪽 중심 부채꼴, 반경 48, 55° 간격
      //  · 3개 이상: 원형 360° 균등(위쪽 반원에 몰지 않음)
      //  · 한 겹(반경 48)에 라벨이 겹칠 만큼 많으면 두 겹으로 분산(안 48 / 바깥 80)
      const LABEL_W = 44
      const polar = (r: number, deg: number) => {
        const rad = deg * Math.PI / 180
        return { dx: r * Math.cos(rad), dy: r * Math.sin(rad) }
      }
      const fanOffsets = (n: number): { dx: number; dy: number }[] => {
        if (n === 2) {
          const R = 48, step = 55
          return [0, 1].map(i => polar(R, -90 + (i - 0.5) * step))
        }
        const R1 = 48, R2 = 80
        const cap1 = Math.max(3, Math.floor((2 * Math.PI * R1) / LABEL_W)) // 반경 48 한 겹 수용치(≈6)
        if (n <= cap1) {
          return Array.from({ length: n }, (_, i) => polar(R1, -90 + (360 / n) * i))
        }
        const innerN = cap1
        const outerN = n - innerN
        const inner = Array.from({ length: innerN }, (_, i) => polar(R1, -90 + (360 / innerN) * i))
        // 바깥 겹은 안쪽과 반 칸 어긋나게 배치해 반경 방향 정렬을 피한다.
        const outer = Array.from({ length: outerN }, (_, i) => polar(R2, -90 + (360 / outerN) * i + (360 / outerN) / 2))
        return [...inner, ...outer]
      }

      // 마커 그리기 — 확대 수준에 따라 분산 여부가 달라지므로 함수로 빼고 zoom_changed 에 재호출.
      const drawMarkers = () => {
        if (infoRef.current) { infoRef.current.setMap(null); infoRef.current = null }
        markerOverlaysRef.current.forEach(o => o.setMap(null))
        markerOverlaysRef.current = []
        const spread = map.getLevel() <= SPREAD_MAX_LEVEL
        clusters.forEach(cl => {
          const base = new kakao.maps.LatLng(cl.lat, cl.lng)
          const container = document.createElement('div')
          container.style.cssText = 'position:relative;width:0;height:0'
          if (!spread || cl.items.length === 1) {
            // 축소 상태 또는 단일 → 원래 좌표에 마커 하나. 여러 개면 '+N건' 강조.
            const n = cl.items.length
            const onClick = n === 1 ? () => openInfo(base, cl.items[0]) : () => openClusterInfo(base, cl.items)
            container.appendChild(makeDot(mmdd(cl.items[0].date), 0, 0, onClick, n - 1))
          } else {
            // 확대 상태 & 2개 이상 → 부채꼴/원형 분산 + 원점 점 + 연결선
            const svg = document.createElementNS(NS, 'svg')
            svg.setAttribute('width', '0'); svg.setAttribute('height', '0')
            svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none'
            container.appendChild(svg)
            const offsets = fanOffsets(cl.items.length)
            cl.items.forEach((s, i) => {
              const { dx, dy } = offsets[i]
              const line = document.createElementNS(NS, 'line')
              line.setAttribute('x1', '0'); line.setAttribute('y1', '0')
              line.setAttribute('x2', String(dx)); line.setAttribute('y2', String(dy))
              line.setAttribute('stroke', '#9ca3af'); line.setAttribute('stroke-width', '1')
              svg.appendChild(line)
              container.appendChild(makeDot(mmdd(s.date), dx, dy, () => openInfo(base, s)))
            })
            const baseDot = document.createElement('div')
            baseDot.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,-50%);width:4px;height:4px;border-radius:50%;background:#9ca3af'
            container.appendChild(baseDot)
          }
          const ov = new kakao.maps.CustomOverlay({ position: base, xAnchor: 0.5, yAnchor: 0.5, zIndex: 3, content: container })
          ov.setMap(map)
          markerOverlaysRef.current.push(ov)
        })
      }
      drawMarkers()
      kakao.maps.event.addListener(map, 'zoom_changed', drawMarkers)

      // 사무실 마커 — 진한 회색(#374151) 집 아이콘 배지로 방문지(파란 dot)와 색·형태 구분.
      // (visits 모드에선 마커만 표시하고 선은 잇지 않는다. office 모드에선 아래에서 점선으로 연결.)
      if (officeInfo && officePoint) {
        const wrap = document.createElement('div')
        wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center'
        const pill = document.createElement('div')
        pill.textContent = `${officeInfo.label} 사무실`
        pill.style.cssText = 'padding:2px 8px;background:#fff;border:1px solid #d1d5db;color:#374151;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3);margin-bottom:2px'
        const badge = document.createElement('div')
        badge.style.cssText = 'width:22px;height:22px;border-radius:6px;background:#374151;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center'
        badge.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
        wrap.append(pill, badge)
        const officeOv = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(officePoint.lat, officePoint.lng), yAnchor: 1, zIndex: 4, content: wrap })
        officeOv.setMap(map)
        officeOverlayRef.current = officeOv
      }

      // 연결선(Polyline) — stops 순서대로 직선으로 잇는다(도로 경로 아님).
      // stops 는 날짜 오름차순 + 같은 날은 service_id 순 정렬 상태.
      // 방문지↔방문지 실선: 배경 분리용 흰 테두리(weight 7) 위에 파란 선(weight 4).
      const drawSolid = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
        const path = [new kakao.maps.LatLng(a.lat, a.lng), new kakao.maps.LatLng(b.lat, b.lng)]
        const halo = new kakao.maps.Polyline({ path, strokeWeight: 7, strokeColor: '#ffffff', strokeOpacity: 0.7, strokeStyle: 'solid' })
        halo.setMap(map)
        polylinesRef.current.push(halo)
        const line = new kakao.maps.Polyline({ path, strokeWeight: 4, strokeColor: '#234ea2', strokeOpacity: 0.9, strokeStyle: 'solid' })
        line.setMap(map)
        polylinesRef.current.push(line)
      }
      // 사무실↔방문지 점선(office 모드 전용): 실제 출발 여부를 모르는 '가정' 구간이라 style·투명도로 구분.
      const drawDashed = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
        const path = [new kakao.maps.LatLng(a.lat, a.lng), new kakao.maps.LatLng(b.lat, b.lng)]
        const line = new kakao.maps.Polyline({ path, strokeWeight: 3, strokeColor: '#234ea2', strokeOpacity: 0.65, strokeStyle: 'shortdash' })
        line.setMap(map)
        polylinesRef.current.push(line)
      }

      // 모드별 연결선 그리기(기존 선 제거 후 재작성). 토글 시 지도 재생성 없이 이 함수만 다시 호출.
      const drawPolylines = (m: 'visits' | 'office') => {
        polylinesRef.current.forEach(p => p.setMap(null))
        polylinesRef.current = []
        if (m === 'office' && officePoint) {
          // office 모드: 날짜별로 사무실 → 그날 방문지들(순서대로) → 사무실. 날짜가 다르면 독립 경로.
          const office = officePoint
          const byDate = new Map<string, RouteStop[]>()
          for (const s of stops) {
            const arr = byDate.get(s.date)
            if (arr) arr.push(s)
            else byDate.set(s.date, [s])
          }
          for (const dayStops of byDate.values()) {
            drawDashed(office, dayStops[0])                     // 사무실 → 첫 방문지 (가정)
            for (let i = 0; i < dayStops.length - 1; i++) drawSolid(dayStops[i], dayStops[i + 1]) // 방문지 간
            drawDashed(dayStops[dayStops.length - 1], office)   // 마지막 방문지 → 사무실 (가정)
          }
        } else if (stops.length >= 2) {
          // visits 모드: 같은 날 인접 구간만 실선. date 가 바뀌는 구간은 경로 불명이라 선 없음.
          for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i], b = stops[i + 1]
            if (a.date !== b.date) continue
            drawSolid(a, b)
          }
        }
      }
      drawPolylinesRef.current = drawPolylines
      drawPolylines(mode)

      // 주변 업체(회색 점) — 라벨 없이 8px 회색 점. 클릭 시 업체명 툴팁. 분산 없이 원좌표에 그대로.
      const openNearbyTooltip = (pos: any, name: string) => {
        if (infoRef.current) infoRef.current.setMap(null)
        const box = document.createElement('div')
        box.style.cssText = 'padding:6px 10px;background:#fff;border:1px solid #ebebeb;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.15);white-space:nowrap;font-size:12px;font-weight:700;color:#374151'
        box.textContent = name
        const info = new kakao.maps.CustomOverlay({ position: pos, yAnchor: 1.6, zIndex: 6, content: box })
        info.setMap(map)
        infoRef.current = info
      }
      const clearNearby = () => {
        nearbyOverlaysRef.current.forEach(o => o.setMap(null))
        nearbyOverlaysRef.current = []
      }
      const drawNearby = () => {
        clearNearby()
        const data = nearbyCacheRef.current
        if (!data) return
        for (const c of data) {
          const pos = new kakao.maps.LatLng(c.lat, c.lng)
          const el = document.createElement('div')
          // 방문지(파란 원 16px + 날짜 라벨)와 확실히 구분: 작은 회색 점 8px, 라벨 없음, zIndex 낮음.
          el.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#9ca3af;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.35);cursor:pointer'
          el.addEventListener('click', (e) => { e.stopPropagation(); openNearbyTooltip(pos, c.name) })
          const ov = new kakao.maps.CustomOverlay({ position: pos, xAnchor: 0.5, yAnchor: 0.5, zIndex: 2, content: el })
          ov.setMap(map)
          nearbyOverlaysRef.current.push(ov)
        }
      }
      clearNearbyRef.current = clearNearby
      drawNearbyRef.current = drawNearby
      if (showNearby && nearbyCacheRef.current) drawNearby() // 재초기화 시 이미 켜져 있으면 즉시 복원

      // 지도 빈 곳 클릭 시 정보창 닫기
      kakao.maps.event.addListener(map, 'click', () => {
        if (infoRef.current) { infoRef.current.setMap(null); infoRef.current = null }
      })

      // ResizeObserver 로 컨테이너 크기 변화 대응
      ro = new ResizeObserver(() => map.relayout())
      ro.observe(mapRef.current)

      setMapReady(true)
    }

    initMap()
    return () => {
      mounted = false
      if (ro) ro.disconnect()
      if (infoRef.current) { infoRef.current.setMap(null); infoRef.current = null }
      polylinesRef.current.forEach(p => p.setMap(null))
      polylinesRef.current = []
      markerOverlaysRef.current.forEach(o => o.setMap(null))
      markerOverlaysRef.current = []
      nearbyOverlaysRef.current.forEach(o => o.setMap(null))
      nearbyOverlaysRef.current = []
      if (officeOverlayRef.current) { officeOverlayRef.current.setMap(null); officeOverlayRef.current = null }
      drawPolylinesRef.current = null; drawNearbyRef.current = null; clearNearbyRef.current = null
      mapObjRef.current = null
    }
    // mode·showNearby 는 일부러 의존성에서 뺀다 — 토글할 때마다 지도를 다시 만들면
    // 사용자가 맞춰 둔 줌·중심이 초기화된다. 둘은 아래 별도 effect 에서 다시 그린다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, officeCode, officeInfo?.code, officesLoading])

  // 모드 토글 → 지도 재생성 없이 연결선만 다시 그린다.
  useEffect(() => {
    drawPolylinesRef.current?.(mode)
  }, [mode])

  // 주변 업체 토글 → 첫 켤 때만 customers 조회(캐시). 끄면 점 제거.
  // RLS 상 고객사 열람 권한이 있는 팀만 customers 를 읽으므로, 조회 실패 시 조용히 토글 비활성화.
  useEffect(() => {
    if (!mapReady) return
    if (!showNearby) { clearNearbyRef.current?.(); return }
    let cancelled = false
    ;(async () => {
      if (nearbyCacheRef.current === null) {
        try {
          const { data, error } = await supabase
            .from('customers')
            .select('customer_id, company_name, latitude, longitude')
            .is('deleted_at', null)
            .eq('is_parent', false)   // 부모 행(회사 묶음)은 지도에 찍지 않는다
            .not('latitude', 'is', null)
            .not('longitude', 'is', null)
          if (error) throw error
          const visited = new Set(stops.map(s => s.customerId))
          const list: NearbyCustomer[] = []
          for (const c of data ?? []) {
            if (visited.has(c.customer_id)) continue // 방문한 업체는 제외(이미 마커 있음)
            const lat = Number(c.latitude), lng = Number(c.longitude)
            if (!isFinite(lat) || !isFinite(lng)) continue
            if (stops.some(s => haversineKm(s.lat, s.lng, lat, lng) <= NEARBY_RADIUS_KM)) {
              list.push({ lat, lng, name: c.company_name })
            }
          }
          if (cancelled) return
          nearbyCacheRef.current = list
        } catch {
          if (!cancelled) { setNearbyFailed(true); setShowNearby(false) }
          return
        }
      }
      if (!cancelled) drawNearbyRef.current?.()
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNearby, mapReady])

  const period = startDate && endDate
    ? `${startDate.replace(/-/g, '.')} ~ ${endDate.replace(/-/g, '.')}`
    : ''

  // 지도 안 토글(pill) 공통 스타일
  const pillStyle = (active: boolean, disabled: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 99,
    fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
    border: `1px solid ${disabled ? '#ebebeb' : active ? '#234ea2' : '#d1d5db'}`,
    background: disabled ? '#f3f4f6' : active ? '#234ea2' : '#fff',
    color: disabled ? '#9ca3af' : active ? '#fff' : '#374151',
    cursor: disabled ? 'not-allowed' : 'pointer',
    boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
    transition: 'all 0.12s ease',
  })

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: Z.fullscreen,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative', width: '95vw', height: '92vh',
          background: '#fff', borderRadius: 8, overflow: 'hidden',
          border: '1px solid #ebebeb', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
        }}
      >
        {/* 상단: 엔지니어 이름 + 기간 (작게) */}
        <div style={{
          position: 'absolute', top: 12, left: 16, zIndex: 2,
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(255,255,255,0.95)', border: '1px solid #ebebeb',
          borderRadius: 8, padding: '7px 12px',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
            {engineerName ? `${engineerName} 동선` : '동선'}
          </span>
          {period && <span style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{period}</span>}
        </div>

        {/* office 모드 가정 안내 (상단 중앙) — 데이터에 없는 가정임을 회색 작은 글씨로 명확히. */}
        {isOffice && stops.length > 0 && (
          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
            background: 'rgba(255,255,255,0.95)', border: '1px solid #ebebeb', borderRadius: 8,
            padding: '7px 12px', fontSize: 12, fontWeight: 600, color: '#9ca3af', whiteSpace: 'nowrap',
            boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
          }}>
            사무실에서 출발·복귀했다고 가정한 경로입니다
          </div>
        )}

        {/* 닫기 버튼 */}
        <button
          onClick={onClose}
          title="닫기"
          style={{
            position: 'absolute', top: 12, right: 16, zIndex: 2,
            width: 32, height: 32, borderRadius: '50%',
            background: '#fff', border: '1px solid #ebebeb', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {stops.length === 0 ? (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 14, fontWeight: 600 }}>
            표시할 방문 기록이 없습니다
          </div>
        ) : (
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        )}

        {/* 지도 안 토글 (우하단 — 좌하단 범례와 겹치지 않게). 사무실 기준 연결선 / 주변 업체 */}
        {stops.length > 0 && (
          <div style={{ position: 'absolute', bottom: 16, right: 16, zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { if (officePoint) setMode(m => (m === 'office' ? 'visits' : 'office')) }}
                disabled={!officePoint}
                title={officePoint ? '사무실 기준 왕복 연결선' : (officeHint ?? '사무실 정보를 불러오는 중입니다')}
                style={pillStyle(isOffice, !officePoint)}>
                사무실 기준 연결선
              </button>
              <button
                onClick={() => { if (!nearbyFailed) setShowNearby(v => !v) }}
                disabled={nearbyFailed}
                title={nearbyFailed ? '주변 업체를 불러올 수 없습니다' : '방문지 반경 5km 이내 고객사'}
                style={pillStyle(showNearby, nearbyFailed)}>
                주변 업체
              </button>
            </div>
            {officeHint && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', background: 'rgba(255,255,255,0.92)', border: '1px solid #ebebeb', borderRadius: 6, padding: '2px 7px' }}>
                {officeHint}
              </span>
            )}
          </div>
        )}

        {/* 범례 (좌하단) */}
        {isOffice ? (
          // office 모드: 실선 = 방문지 간 이동, 점선 = 사무실 출발·복귀(가정)
          stops.length > 0 && (
            <div style={{
              position: 'absolute', bottom: 16, left: 16, zIndex: 2,
              background: '#fff', border: '1px solid #ebebeb', borderRadius: 8,
              padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'inline-block', width: 22, borderTop: '3px solid #234ea2', opacity: 0.9 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280' }}>방문지 간 이동</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'inline-block', width: 22, borderTop: '2px dashed #234ea2', opacity: 0.65 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280' }}>사무실 출발·복귀 (가정)</span>
              </div>
            </div>
          )
        ) : (
          // visits 모드(기존): 같은 날 실선이 실제로 그려질 때만 표시
          hasSameDaySegment && (
            <div style={{
              position: 'absolute', bottom: 16, left: 16, zIndex: 2,
              background: '#fff', border: '1px solid #ebebeb', borderRadius: 8,
              padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ display: 'inline-block', width: 22, borderTop: '3px solid #234ea2', opacity: 0.7 }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280' }}>같은 날 이동</span>
            </div>
          )
        )}

        {/* 비방문 기록 제외 안내 (하단 중앙) */}
        {excludedCount > 0 && (
          <div style={{
            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
            background: '#fff', border: '1px solid #ebebeb', borderRadius: 8, padding: '6px 12px',
            fontSize: 11, fontWeight: 600, color: '#9ca3af', boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
          }}>
            비방문 {excludedCount}건 제외
          </div>
        )}
      </div>
    </div>
  )
}
