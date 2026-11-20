// 카카오 지도 SDK 를 **한 번만** 싣는다.
//
// ── 타입에 대하여 ────────────────────────────────────────────────────────
//   카카오는 타입 정의를 주지 않는다(@types 도 없다). 그래서 지도 관련 값은 모두
//   any 였고, 화면 두 곳(MapView·RouteMapView)에 그 any 가 22개 흩어져 있었다.
//   이제 **이름을 붙여 여기 한 곳에** 둔다 — 화면은 any 를 쓰지 않고 이 이름을 쓴다.
//   무엇을 부르는지가 이름으로 보이고, 나중에 정식 타입이 나오면 이 파일만 고친다.

/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오 SDK 는 타입 정의가 없다. any 를 이 파일에 모은다. */

/** 카카오 지도 전역(window.kakao). maps 아래의 생성자들을 꺼내 쓴다. */
export type KakaoNamespace = any
/** 지도 인스턴스(new kakao.maps.Map). */
export type KakaoMap = any
/** 마커·커스텀오버레이·정보창·선 — SDK 객체. setMap(null) 로 치운다. */
export type KakaoOverlay = any
/** 클러스터러(libraries=clusterer). */
export type KakaoClusterer = any
/** 좌표(LatLng)·경계(LatLngBounds). */
export type KakaoLatLng = any
/**
 * window 에 끼워 두는 두 값 — 지도 인스턴스(실측·디버깅용)와 SDK 전역.
 * 화면에서 (window as any) 로 집던 자리를 이 이름으로 바꾼다.
 */
export type KakaoWindow = Window & {
  kakao: KakaoNamespace
  __kakaoMapInstance?: KakaoMap
}
declare global {
  interface Window {
    kakao: KakaoNamespace
  }
}

let kakaoPromise: Promise<KakaoNamespace> | null = null

export function loadKakaoMap() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('window is undefined'))
  }

  if (window.kakao?.maps?.Map && window.kakao?.maps?.services) {
    return Promise.resolve(window.kakao)
  }

  if (kakaoPromise) return kakaoPromise

  kakaoPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById('kakao-map-script') as HTMLScriptElement | null

    const onLoadKakao = () => {
      if (!window.kakao?.maps) {
        reject(new Error('카카오 지도 SDK 로드 실패'))
        return
      }

      window.kakao.maps.load(() => resolve(window.kakao))
    }

    if (existingScript) {
      if (window.kakao?.maps) {
        onLoadKakao()
      } else {
        existingScript.addEventListener('load', onLoadKakao)
        existingScript.addEventListener('error', () =>
          reject(new Error('카카오 지도 SDK 로드 실패'))
        )
      }
      return
    }

    const script = document.createElement('script')
    script.id = 'kakao-map-script'
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${process.env.NEXT_PUBLIC_KAKAO_JS_KEY}&autoload=false&libraries=services,clusterer`
    script.async = true

    script.onload = onLoadKakao
    script.onerror = () => reject(new Error('카카오 지도 SDK 로드 실패'))

    document.head.appendChild(script)
  })

  return kakaoPromise
}