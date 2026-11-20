'use client'

import { useEffect, useRef, useState } from 'react'
import { loadKakaoMap, type KakaoClusterer, type KakaoMap, type KakaoNamespace, type KakaoOverlay, type KakaoWindow } from '@/lib/loadKakaoMap'
import {
  PANEL_BG,
  getDeviceLines,
  type Customer,
  type Device,
} from '@/lib/home'
import { loadOffices, activeOffices, type Office } from '@/lib/offices'
import { DIRECT_SALE_LABEL } from '@/lib/customerAgency'
import { useMe } from '@/lib/appData/MeProvider'
import { useToast } from '@/components/common/Toast'
import { R } from '@/lib/radius'

/** 클러스터 숫자 박스의 세 크기(px). 건수가 많을수록 큰 상자를 쓴다. */
const CLUSTER_SIZES = [36, 44, 52] as const

type Props = {
  customers: Customer[]
  deviceMap: Map<number, Device[]>
  focusedCustomerId: number | null
  restoredMapCenter: { lat: number; lng: number } | null
  restoredMapLevel: number | null
  restoredOpenOverlayCustomerId: number | null
  /**
   * **돌아왔을 때 볼 자리.** 목록에서 보던 사업장(하나) 또는 회사의 사업장 전부다.
   * 빈 배열·null 이면 전국 보기로 되돌린다. 값이 같아도 `focusNonce` 가 바뀌면 다시 맞춘다.
   */
  focusSiteIds?: number[] | null
  focusNonce?: number
  onMapStateChange: (center: { lat: number; lng: number }, level: number) => void
  onOpenOverlayChange: (customerId: number | null) => void
}

/** 창에 올라온 kakao 네임스페이스. 타입이 없는 전역이라 한 곳에서만 꺼낸다. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const kakaoGlobal = (): any => (window as KakaoWindow).kakao

/** 전국 보기 — 처음 들어왔을 때와 「볼 곳이 없을 때」가 같은 자리다. */
const NATIONAL_LEVEL = 12
const nationalCenter = (): [number, number] =>
  (typeof window !== 'undefined' && window.innerWidth <= 768 ? [38.6, 128.0] : [36.5, 127.8])

export default function MapView({
  customers,
  deviceMap,
  focusedCustomerId,
  restoredMapCenter,
  restoredMapLevel,
  restoredOpenOverlayCustomerId,
  focusSiteIds,
  focusNonce,
  onMapStateChange,
  onOpenOverlayChange,
}: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const kakaoMapRef = useRef<KakaoMap>(null)
  const markerMapRef = useRef<Map<number, KakaoOverlay>>(new Map())
  const openInfoWindowRef = useRef<{ id: number; iw: KakaoOverlay } | null>(null)
  const clustererRef = useRef<KakaoClusterer>(null)
  const customerMapRef = useRef<Map<number, Customer>>(new Map())
  const [isMapReady, setIsMapReady] = useState(false)
  const restoredMapStateAppliedRef = useRef(false)

  /**
   * 「자택 출발」의 출발지 — **본인 자택 좌표**다. MeProvider 가 앱 당 한 번 읽어 둔 값을
   * 그대로 쓴다(조회 0회. lib/appData/me.ts 의 home_lat·home_lng).
   *
   * 오버레이 버튼은 카카오 지도 안에 DOM 으로 직접 만든다 — React 렌더 밖이라 그때의 값을
   * 가둬 두면 나중에 자택을 등록해도 그 버튼은 영영 흐리다. 그래서 ref 로 들고 **누르는
   * 순간**에 읽는다. 토스트도 같은 이유로 ref 에 둔다.
   */
  const { me } = useMe()
  const toast = useToast()
  const homeRef = useRef<{ lat: number; lng: number; address: string } | null>(null)
  const toastRef = useRef(toast)
  // 렌더 중에 ref 를 쓰지 않는다(React 규칙) — 값이 바뀔 때 효과에서 채운다.
  useEffect(() => {
    homeRef.current = (me?.home_lat != null && me?.home_lng != null)
      ? { lat: Number(me.home_lat), lng: Number(me.home_lng), address: me.home_address ?? '자택' }
      : null
    toastRef.current = toast
  }, [me, toast])

  // 길찾기 출발지 — offices 테이블이 정본이다. 지도를 만들 때 한 번 읽어 담아 둔다.
  // 예전에는 여기서 울산·구미만 주소를 다시 지오코딩해 좌표를 덮어썼는데,
  // 그 결과 같은 사무실인데 동선 지도와 길찾기가 다른 위치를 가리켰다. 이제 DB 좌표를 그대로 쓴다
  // (좌표는 관리자 화면에서 주소를 저장할 때 지오코딩해 함께 저장한다).
  const officesRef = useRef<Office[]>([])

  // HTML 특수문자 이스케이프 — innerHTML에 DB 데이터 삽입 시 XSS 방지
  const esc = (s: string | null | undefined): string =>
    (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  // 오버레이 동적 생성 함수
  const createOverlay = (c: Customer, map: KakaoMap, kakao: KakaoNamespace) => {
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
        border-radius:${R.control}px;
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

          <div style="font-size:11px; color:#9ca3af; margin-bottom:8px;">대리점 ${esc(c.agency_name ?? DIRECT_SALE_LABEL)}</div>

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
      detailBtn.style.cssText = `width:100%;text-align:center;padding:8px 14px;background:#234ea2;color:#ffffff;border-radius:${R.icon}px;font-size:13px;font-weight:700;border:none;cursor:pointer;`
      // touchstart에서 stopPropagation — 카카오맵이 터치 시퀀스 자체를 가로채지 못하도록
      detailBtn.addEventListener('touchstart', (e) => { e.stopPropagation() }, { passive: true })
      detailBtn.addEventListener('touchend', (e) => { e.stopPropagation(); e.preventDefault(); goDetail() })
      detailBtn.addEventListener('pointerup', (e) => { e.stopPropagation(); goDetail() })
      detailBtn.addEventListener('click', (e) => { e.stopPropagation(); goDetail() })

      // 출발지 버튼 하나 — 한 줄을 n 등분한다(flex:1). 자택까지 넷이면 4분할이다.
      const NAV_CSS = `flex:1 1 0;min-width:0;text-align:center;padding:7px 0;background:#ffffff;border:1px solid #ebebeb;border-radius:${R.icon}px;font-size:12px;text-decoration:none;font-weight:700;`
      const makeNavLink = (href: string, label: string) => {
        const a = document.createElement('a')
        a.href = href
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.textContent = label
        a.style.cssText = NAV_CSS + 'color:#6b7280;'
        a.addEventListener('touchstart', (e) => { e.stopPropagation() }, { passive: true })
        a.addEventListener('click', (e) => { e.stopPropagation() })
        return a
      }

      /**
       * 자택 출발 — 좌표가 **없으면 흐린 단추**로 두고, 누르면 어디서 등록하는지 알린다.
       * 자리를 비우지 않는 이유: 넷이 한 줄에 고정돼 있어야 누를 자리가 사람마다 달라지지
       * 않는다. 숨기면 「원래 없는 기능」으로 보여 등록할 생각을 못 한다.
       */
      const makeHomeButton = () => {
        const home = homeRef.current
        if (home) {
          return makeNavLink(makeNavUrl({ lat: home.lat, lng: home.lng, name: home.address }), '자택')
        }
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = '자택'
        b.title = '내 정보에서 자택 주소를 등록하면 쓸 수 있습니다'
        b.style.cssText = NAV_CSS + 'color:#d1d5db;cursor:pointer;font-family:inherit;'
        const warn = (e: Event) => {
          e.stopPropagation()
          toastRef.current.error('내 정보에서 자택 주소를 등록하세요')
        }
        b.addEventListener('touchstart', (e) => { e.stopPropagation() }, { passive: true })
        b.addEventListener('click', warn)
        return b
      }

      detailSlot.appendChild(detailBtn)
      // 자택이 맨 왼쪽 — 내 출발지가 먼저다. 그 뒤로 활성 사무실 전부를 sort_order 순으로.
      navRow.appendChild(makeHomeButton())
      // 좌표가 없는 사무실은 길을 못 찾으므로 건너뛴다.
      for (const o of activeOffices(officesRef.current)) {
        if (o.latitude == null || o.longitude == null) continue
        navRow.appendChild(makeNavLink(
          makeNavUrl({ lat: o.latitude, lng: o.longitude, name: o.address }),
          // 「동탄 출발」 → 「동탄」. 넷이 한 줄에 들어가야 해서 글자를 줄였다
          // (「출발」은 줄 전체가 출발지 고르는 자리라는 것으로 충분히 읽힌다).
          o.label,
        ))
      }
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

      // 길찾기 출발지 — DB 값을 그대로 담는다(지오코딩하지 않는다).
      officesRef.current = await loadOffices()

      if (!kakaoMapRef.current) {
        kakaoMapRef.current = new kakao.maps.Map(mapRef.current, {
          center: new kakao.maps.LatLng(...nationalCenter()),
          level: NATIONAL_LEVEL,
        })

         ;(window as KakaoWindow).__kakaoMapInstance = kakaoMapRef.current

        /**
         * 칸 크기가 바뀌면 relayout 한다. **그 뒤에 중심을 다시 잡아야 한다** —
         * kakao 는 relayout 에서 「왼쪽 위」를 붙잡으므로, 0×0 으로 만들어졌다가
         * 커지는 순간(보기를 바꿔 돌아올 때가 그렇다) 보던 자리가 북서쪽으로 밀린다.
         * 목록에서 지도로 돌아올 때 베이징 근처가 나오던 원인이 이것이다(2026-11-20).
         */
        const resizeObserver = new ResizeObserver(() => {
          const m = kakaoMapRef.current
          if (!m) return
          const keep = m.getCenter()
          m.relayout()
          m.setCenter(keep)
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

      const newMarkers: KakaoOverlay[] = []

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
      if ((window as KakaoWindow).kakao?.maps?.MarkerClusterer) {
        if (!clustererRef.current) {
          clustererRef.current = new kakao.maps.MarkerClusterer({
            map,
            averageCenter: true,
            minLevel: 7,
            disableClickZoom: false,
            markers: [],
            // 숫자 박스 — 건수에 따라 36 / 44 / 52. 크기가 곧 「얼마나 모였나」다.
            // 카카오에는 **객체**로 넘기므로 토큰을 글자로 끼운다(lib/radius.ts 가 정본이다).
            styles: CLUSTER_SIZES.map(size => ({
              width: `${size}px`, height: `${size}px`,
              background: 'rgba(255,255,255,0.95)', color: '#111113',
              textAlign: 'center', lineHeight: `${size}px`, borderRadius: `${R.tile}px`,
              fontSize: size >= 52 ? '16px' : size >= 44 ? '15px' : '14px', fontWeight: '700',
              border: '1px solid #ebebeb',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            })),
          })
        }

        if (toDelete.length > 0) {
          // 삭제된 마커 클러스터에서 제거
          clustererRef.current.clear()
          const allMarkers: KakaoOverlay[] = []
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

    const kakao = (window as KakaoWindow).kakao
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

  /**
   * **돌아왔을 때 볼 자리.** 목록에서 보던 사업장이 있으면 그 핀으로, 회사면 그 회사의
   * 사업장이 전부 들어오게, 아무것도 없으면 전국 보기로 되돌린다.
   * 핀 좌표는 customers 에서 찾는다 — 지오코딩하지 않는다.
   */
  useEffect(() => {
    if (!isMapReady || focusNonce === undefined) return
    const kakao = kakaoGlobal()
    const map = kakaoMapRef.current
    if (!kakao?.maps || !map) return

    const pts = (focusSiteIds ?? [])
      .map(id => customers.find(c => Number(c.customer_id) === id))
      .filter(c => c && c.latitude != null && c.longitude != null)
      .map(c => new kakao.maps.LatLng(Number(c!.latitude), Number(c!.longitude)))

    if (pts.length === 0) {
      map.setLevel(NATIONAL_LEVEL)
      map.setCenter(new kakao.maps.LatLng(...nationalCenter()))
      return
    }
    if (pts.length === 1) {
      map.setLevel(5)
      map.setCenter(pts[0])
      return
    }
    const bounds = new kakao.maps.LatLngBounds()
    for (const pt of pts) bounds.extend(pt)
    map.setBounds(bounds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, isMapReady])

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
    const kakaoNS = (window as KakaoWindow).kakao.maps
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
      {/* 지도 위 오버레이 칩(상태·계열)은 걷었다(2026-11-20) — 고르는 자리는 좌 패널의
          [필터] 하나다. 지도에 떠 있던 두 줄은 같은 조건을 **두 번째로** 고르는 자리였고,
          지도에서 켠 것이 목록으로 넘어가지도 않았다(상태가 따로였다). */}

      {/* 「업체 등록」 버튼은 **화면 맨 위 헤더**로 옮겼다(2026-11-19). 지도 보기·목록 보기가
          같은 자리에서 같은 폼을 연다 — components/home/ListHeader.tsx. 지도 안에는 등록 진입이 없다. */}

      {/* 지도 */}
     <div
        ref={mapRef}
        className="kakao-map-container"
        style={{
          width: '100%', height: '100%', minHeight: 0,
          // 테두리·둥근 모서리를 뺐다 — 지도는 칸을 **가득** 쓴다(2026-11-20).
          overflow: 'hidden',
          boxSizing: 'border-box', background: PANEL_BG,
        }}
      />
    </div>
  )
}