import { loadKakaoMap } from '@/lib/loadKakaoMap'

export type Coords = { latitude: number; longitude: number }

/**
 * 주소(또는 건물명/상호 포함 주소)를 좌표로 변환한다.
 *
 * 카카오 Geocoder.addressSearch 는 행정 주소 DB와 정확히 일치하는
 * 주소만 변환되어 실패율이 높다. 그래서 아래 순서로 폴백한다.
 *   1) addressSearch (입력 그대로)
 *   2) addressSearch (상세주소/괄호 제거, 띄어쓰기 정리)
 *   3) keywordSearch  (장소검색 — 건물명/느슨한 주소도 매칭)
 */
export async function geocodeAddress(address: string): Promise<Coords> {
  const kakao = await loadKakaoMap()

  if (!kakao.maps.services) {
    throw new Error('Kakao Maps services 라이브러리가 로드되지 않았습니다.')
  }

  const raw = address.trim()
  if (!raw) throw new Error('주소를 입력해주세요.')

  const geocoder = new kakao.maps.services.Geocoder()

  /** 카카오 검색이 돌려주는 줄 — 쓰는 칸은 좌표 둘뿐이다(x: 경도, y: 위도). */
  type GeocodeHit = { x: string; y: string }
  // 카카오 콜백이 (도메인 제한/네트워크 오류 등으로) 영영 호출되지 않아
  // 저장이 무한 대기에 빠지는 것을 막기 위해 각 검색에 타임아웃을 둔다.
  const withTimeout = (
    fn: (cb: (result: GeocodeHit[], status: string) => void) => void
  ) =>
    new Promise<Coords | null>((resolve) => {
      let settled = false
      const done = (coords: Coords | null) => {
        if (settled) return
        settled = true
        resolve(coords)
      }
      const timer = setTimeout(() => done(null), 7000)
      fn((result: GeocodeHit[], status: string) => {
        clearTimeout(timer)
        if (status === kakao.maps.services.Status.OK && result[0]) {
          done({ latitude: Number(result[0].y), longitude: Number(result[0].x) })
        } else {
          done(null)
        }
      })
    })

  const addressSearch = (query: string) =>
    withTimeout((cb) => geocoder.addressSearch(query, cb))

  const places = new kakao.maps.services.Places()

  const keywordSearch = (query: string) =>
    withTimeout((cb) => places.keywordSearch(query, cb))

  // 상세주소(쉼표 뒤), 괄호 내용 제거 후 공백 정리한 약식 주소
  const simplified = raw
    .replace(/\(.*?\)/g, ' ')
    .split(',')[0]
    .replace(/\s+/g, ' ')
    .trim()

  const candidates = [raw]
  if (simplified && simplified !== raw) candidates.push(simplified)

  for (const query of candidates) {
    const coords = await addressSearch(query)
    if (coords) return coords
  }

  // 주소검색 전부 실패 → 키워드(장소) 검색으로 폴백
  for (const query of [raw, simplified].filter(Boolean)) {
    const coords = await keywordSearch(query)
    if (coords) return coords
  }

  throw new Error(
    '주소 좌표 변환에 실패했습니다. 도로명 또는 지번 주소를 다시 확인해주세요.'
  )
}
