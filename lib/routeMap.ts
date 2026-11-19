// 엔지니어 동선 데이터 변환. 이 단계에서는 지도를 만들지 않고 데이터만 확보한다.
// 활동 기록(서비스 + 영업)은 장비별·건별로 나뉘어 한 업체에서 여러 행이 나오므로,
// (날짜, 업체) 단위로 묶어 지도 마커 1개에 대응하는 RouteStop 으로 변환한다.

import { byDateAsc, type ActivityEntry } from '@/lib/activity'

export type RouteStop = {
  date: string                // 'YYYY-MM-DD'
  customerId: number
  companyName: string
  lat: number
  lng: number
  serviceCount: number        // 그 날 그 업체에서 남긴 기록 수
  entries: ActivityEntry[]    // 마커 클릭 시 보여줄 원본 목록
}

// 좌표가 없어 지도에 못 찍는 (날짜, 업체) 그룹. 조용히 누락시키지 않고 함께 반환한다.
export type SkippedStop = Omit<RouteStop, 'lat' | 'lng'>

export type BuildRouteResult = {
  stops: RouteStop[]
  skipped: SkippedStop[]
  excluded: ActivityEntry[]   // 비방문(원격·전화)으로 제외한 기록
}

/**
 * 실제 방문이 아닌 **서비스** 유형 — 지도 마커에서 제외한다. 서비스 유형은 코드에
 * 고정돼 있으므로(components/activity/ActivityCard.tsx) 여기 둔다.
 *
 * 영업 종류는 표가 정한다 — `activity_types.is_remote`. 전에는 여기에 '전화상담' 을
 * 함께 적어 두었는데, 종류를 관리 화면에서 더할 수 있게 되면서 새 종류가 원격인지를
 * 코드가 알 길이 없어졌다. 그래서 buildRoute 가 그 목록을 **받는다**.
 */
export const REMOTE_SERVICE_TYPES: readonly string[] = ['유선기술지원']

/**
 * @param remoteSalesTypes 비방문 영업 종류의 label. lib/activityTypes.ts 의
 *   remoteActivityTypes(표) 를 그대로 넘긴다. 빼먹으면 원격 활동이 지도에 찍히므로
 *   기본값을 두지 않는다(타입이 부르는 쪽을 막는다).
 */
export function buildRoute(
  entries: ActivityEntry[],
  remoteSalesTypes: readonly string[],
): BuildRouteResult {
  const REMOTE_TYPES = new Set<string>([...REMOTE_SERVICE_TYPES, ...remoteSalesTypes])
  // 1) (날짜, 업체) 로 그룹핑 — 같은 날 같은 업체는 마커 1개.
  //    업체가 없는 기록(customerId null)은 지도에 올릴 자리가 없어 건너뛴다.
  const groups = new Map<string, ActivityEntry[]>()
  const excluded: ActivityEntry[] = []

  for (const e of entries) {
    if (REMOTE_TYPES.has(e.type)) { excluded.push(e); continue }
    if (e.customerId == null) continue
    const key = `${e.date}__${e.customerId}`
    const arr = groups.get(key)
    if (arr) arr.push(e)
    else groups.set(key, [e])
  }

  const stops: RouteStop[] = []
  const skipped: SkippedStop[] = []

  for (const group of groups.values()) {
    // 그룹 내부 순서를 고정해 첫 기록이 항상 같게 나오도록 한다.
    const sorted = [...group].sort(byDateAsc)
    const first = sorted[0]
    // 좌표는 같은 (날짜,업체) 그룹이면 동일하므로 유효한 첫 좌표를 사용한다.
    const withCoord = sorted.find(s => s.lat != null && s.lng != null)
    const base = {
      date: first.date,
      customerId: first.customerId as number,
      companyName: first.customerName,
      serviceCount: sorted.length,
      entries: sorted,
    }
    if (withCoord && withCoord.lat != null && withCoord.lng != null) {
      stops.push({ ...base, lat: withCoord.lat, lng: withCoord.lng })
    } else {
      skipped.push(base) // 좌표 null → 지도에 못 찍음
    }
  }

  // 2) 정렬: 날짜 오름차순 → 같은 날은 그룹 첫 기록 기준.
  //    ※ 날짜에 시각 정보가 없어 하루 내 실제 방문 순서는 알 수 없다.
  //      두 테이블(service_history·sales_activities)의 id 는 서로 비교할 의미가 없으므로,
  //      byDateAsc 가 (날짜 → source → id) 순으로 '안정적인 임의 순서'를 만든다.
  const sortFn = (a: RouteStop | SkippedStop, b: RouteStop | SkippedStop) =>
    a.date === b.date ? byDateAsc(a.entries[0], b.entries[0]) : (a.date < b.date ? -1 : 1)
  stops.sort(sortFn)
  skipped.sort(sortFn)

  return { stops, skipped, excluded }
}
