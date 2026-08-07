'use client'

import { useEffect, useRef } from 'react'
import { loadKakaoMap } from '@/lib/loadKakaoMap'
import type { RouteStop } from '@/lib/routeMap'
import { getOffice } from '@/lib/offices'

// 엔지니어 동선 지도(전체 화면 오버레이). 방문지 마커 + 같은 날 실선 + 사무실 마커.
// 날짜가 바뀌는 구간은 실제 이동 경로를 알 수 없어(사무실/자택 경유 추정) 선을 긋지 않는다.
// NOTE: props 스펙은 { stops, onClose } 이지만 §2(상단 이름·기간)·사무실 표시를 위해
//       engineerName/startDate/endDate/officeCode 를 추가로 받는다.
type Props = {
  stops: RouteStop[]
  onClose: () => void
  engineerName?: string
  startDate?: string
  endDate?: string
  officeCode?: string | null // engineers.office. getOffice() 로 조회, 없으면 사무실 마커 미표시.
  excludedCount?: number     // 유선기술지원으로 제외된 기록 수(하단 안내용)
}

// 이 level 이하(확대)에서만 마커를 부채꼴/원형으로 분산한다. 그 이상(축소)이면
// 48px 오프셋이 실거리로 수 km가 되어 위치가 왜곡되므로 원래 좌표에 하나로 모은다.
// 실측하며 조정할 수 있게 상수로 분리(카카오 level 은 작을수록 확대).
const SPREAD_MAX_LEVEL = 5

export default function RouteMapView({ stops, onClose, engineerName, startDate, endDate, officeCode, excludedCount = 0 }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const infoRef = useRef<any>(null) // 현재 열린 정보창(하나만 유지)
  const polylinesRef = useRef<any[]>([]) // 구간별 연결선(언마운트 시 정리)
  const markerOverlaysRef = useRef<any[]>([]) // 클러스터 마커(줌 변경 시 다시 그림)
  const officeOverlayRef = useRef<any>(null) // 사무실 마커(1회 생성, 언마운트 시 정리)

  const officeInfo = getOffice(officeCode) // 소속 사무실(없으면 undefined)
  // 같은 날 인접 구간이 하나라도 있으면 실선이 그려지므로 범례를 노출.
  const hasSameDaySegment = stops.some((s, i) => i > 0 && stops[i - 1].date === s.date)

  // ESC 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 지도 초기화 — useEffect 는 페인트 이후 실행되므로 오버레이 컨테이너 크기가
  // 확정된 뒤에 지도를 만든다. 추가로 relayout() 1회 + ResizeObserver 로 보정.
  useEffect(() => {
    if (stops.length === 0) return // 빈 경우 지도 미생성(아래 렌더에서 안내)

    let mounted = true
    let ro: ResizeObserver | null = null

    const initMap = async () => {
      const kakao = await loadKakaoMap()
      if (!mounted || !mapRef.current) return

      const map = new kakao.maps.Map(mapRef.current, {
        center: new kakao.maps.LatLng(stops[0].lat, stops[0].lng),
        level: 6,
      })

      // 모달 안에서 0 크기로 초기화되면 회색만 나오는 문제 대비: 생성 직후 한 번 relayout.
      map.relayout()

      // 초기 범위: 방문지 + 사무실(있으면) 을 모두 포함. 지점이 하나면 센터만 잡고 확대.
      const boundsPoints = stops.map(s => ({ lat: s.lat, lng: s.lng }))
      if (officeInfo) boundsPoints.push({ lat: officeInfo.lat, lng: officeInfo.lng })
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
      // 사무실에서 방문지로 선은 잇지 않는다(실제 출발 여부를 알 수 없음).
      if (officeInfo) {
        const wrap = document.createElement('div')
        wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center'
        const pill = document.createElement('div')
        pill.textContent = `${officeInfo.label} 사무실`
        pill.style.cssText = 'padding:2px 8px;background:#fff;border:1px solid #d1d5db;color:#374151;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3);margin-bottom:2px'
        const badge = document.createElement('div')
        badge.style.cssText = 'width:22px;height:22px;border-radius:6px;background:#374151;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center'
        badge.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
        wrap.append(pill, badge)
        const officeOv = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(officeInfo.lat, officeInfo.lng), yAnchor: 1, zIndex: 4, content: wrap })
        officeOv.setMap(map)
        officeOverlayRef.current = officeOv
      }

      // 연결선(Polyline) — stops 순서대로 직선으로 잇되(도로 경로 아님), 같은 날 구간만 그린다.
      // stops 는 날짜 오름차순 + 같은 날은 service_id 순 정렬 상태.
      // date 가 다르면 그 사이 사무실/자택을 거쳤을 것이라 실제 이동이 아니므로 선을 긋지 않는다.
      if (stops.length >= 2) {
        for (let i = 0; i < stops.length - 1; i++) {
          const a = stops[i]
          const b = stops[i + 1]
          if (a.date !== b.date) continue // 날짜 바뀌는 구간은 선 없음
          const path = [new kakao.maps.LatLng(a.lat, a.lng), new kakao.maps.LatLng(b.lat, b.lng)]
          // 배경 분리용 흰 테두리 선을 먼저 깔고(weight 7), 그 위에 파란 선을 얹는다(weight 4).
          const halo = new kakao.maps.Polyline({ path, strokeWeight: 7, strokeColor: '#ffffff', strokeOpacity: 0.7, strokeStyle: 'solid' })
          halo.setMap(map)
          polylinesRef.current.push(halo)
          const line = new kakao.maps.Polyline({ path, strokeWeight: 4, strokeColor: '#234ea2', strokeOpacity: 0.9, strokeStyle: 'solid' })
          line.setMap(map)
          polylinesRef.current.push(line)
        }
      }

      // 지도 빈 곳 클릭 시 정보창 닫기
      kakao.maps.event.addListener(map, 'click', () => {
        if (infoRef.current) { infoRef.current.setMap(null); infoRef.current = null }
      })

      // ResizeObserver 로 컨테이너 크기 변화 대응
      ro = new ResizeObserver(() => map.relayout())
      ro.observe(mapRef.current)
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
      if (officeOverlayRef.current) { officeOverlayRef.current.setMap(null); officeOverlayRef.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, officeCode])

  const period = startDate && endDate
    ? `${startDate.replace(/-/g, '.')} ~ ${endDate.replace(/-/g, '.')}`
    : ''

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10080,
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

        {/* 범례 (좌하단) — 같은 날 실선이 실제로 그려질 때만 표시 */}
        {hasSameDaySegment && (
          <div style={{
            position: 'absolute', bottom: 16, left: 16, zIndex: 2,
            background: '#fff', border: '1px solid #ebebeb', borderRadius: 8,
            padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ display: 'inline-block', width: 22, borderTop: '3px solid #234ea2', opacity: 0.7 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280' }}>같은 날 이동</span>
          </div>
        )}

        {/* 유선기술지원 제외 안내 (하단 중앙) */}
        {excludedCount > 0 && (
          <div style={{
            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
            background: '#fff', border: '1px solid #ebebeb', borderRadius: 8, padding: '6px 12px',
            fontSize: 11, fontWeight: 600, color: '#9ca3af', boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
          }}>
            유선 지원 {excludedCount}건 제외
          </div>
        )}
      </div>
    </div>
  )
}
