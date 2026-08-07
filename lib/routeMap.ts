// 엔지니어 동선 데이터 변환. 이 단계에서는 지도를 만들지 않고 데이터만 확보한다.
// service_history 는 장비별 기록이라 한 업체에서 여러 행이 나오므로,
// (날짜, 업체) 단위로 묶어 지도 마커 1개에 대응하는 RouteStop 으로 변환한다.

export type ServiceDetail = {
  service_id: number
  visit_date: string          // 'YYYY-MM-DD'
  service_type: string
  is_paid: boolean | null
  customer_id: number
  customer_name: string
  service_notes: string | null
  lat: number | null
  lng: number | null
}

export type RouteStop = {
  date: string                // 'YYYY-MM-DD'
  customerId: number
  companyName: string
  lat: number
  lng: number
  serviceCount: number        // 그 날 그 업체에서 작업한 기록 수
  services: ServiceDetail[]   // 마커 클릭 시 보여줄 원본 목록
}

// 좌표가 없어 지도에 못 찍는 (날짜, 업체) 그룹. 조용히 누락시키지 않고 함께 반환한다.
export type SkippedStop = {
  date: string
  customerId: number
  companyName: string
  serviceCount: number
  services: ServiceDetail[]
}

export type BuildRouteResult = {
  stops: RouteStop[]
  skipped: SkippedStop[]
  excluded: ServiceDetail[]   // 유선기술지원(실제 방문 아님)으로 제외한 기록
}

// 실제 방문이 아닌 서비스 유형(원격/전화 지원). 동선 마커에서 제외한다.
const REMOTE_TYPE = '유선기술지원'

export function buildRoute(details: ServiceDetail[]): BuildRouteResult {
  // 1) (visit_date, customer_id) 로 그룹핑 — 같은 날 같은 업체는 마커 1개.
  const groups = new Map<string, ServiceDetail[]>()
  for (const d of details) {
    const key = `${d.visit_date}__${d.customer_id}`
    const arr = groups.get(key)
    if (arr) arr.push(d)
    else groups.set(key, [d])
  }

  const stops: RouteStop[] = []
  const skipped: SkippedStop[] = []
  const excluded: ServiceDetail[] = []

  for (const group of groups.values()) {
    // 유선기술지원은 실제 방문이 아니므로 분리(제외). service_type null 은 유형 미기재일 뿐
    // 방문 기록이므로 유지한다. 그룹 전체가 유선이면 stop 자체를 만들지 않는다.
    excluded.push(...group.filter(s => s.service_type === REMOTE_TYPE))
    const actual = group.filter(s => s.service_type !== REMOTE_TYPE)
    if (actual.length === 0) continue

    // 그룹 내부는 service_id 오름차순으로 고정(결정적 순서 확보).
    const services = [...actual].sort((a, b) => a.service_id - b.service_id)
    const first = services[0]
    // 좌표는 같은 (날짜,업체) 그룹이면 동일하므로 유효한 첫 좌표를 사용한다.
    const withCoord = services.find(s => s.lat != null && s.lng != null)
    const base = {
      date: first.visit_date,
      customerId: first.customer_id,
      companyName: first.customer_name,
      serviceCount: services.length,
      services,
    }
    if (withCoord && withCoord.lat != null && withCoord.lng != null) {
      stops.push({ ...base, lat: withCoord.lat, lng: withCoord.lng })
    } else {
      skipped.push(base) // 좌표 null → 지도에 못 찍음
    }
  }

  // 2) 정렬: 날짜 오름차순 → 같은 날은 그룹 첫 기록의 service_id 오름차순.
  //    ※ visit_date 에 시각 정보가 없어 하루 내 실제 방문 순서는 알 수 없다.
  //      같은 날 여러 업체의 순서는 "service_id 오름차순"이라는 임의 기준이다.
  const order = (s: RouteStop | SkippedStop) => s.services[0].service_id
  const sortFn = (a: RouteStop | SkippedStop, b: RouteStop | SkippedStop) =>
    a.date === b.date ? order(a) - order(b) : (a.date < b.date ? -1 : 1)
  stops.sort(sortFn)
  skipped.sort(sortFn)

  return { stops, skipped, excluded }
}
