// 활동(서비스 기록 + 영업 활동) 공용 타입·상수.
//
// 활동 현황은 두 테이블을 함께 집계한다.
//   - service_history × service_engineers : 한 기록에 참여자가 여럿(다대다)
//   - sales_activities                    : engineer_id 단일
// 둘 다 "(기록, 사람) 한 줄" 로 펴면 모양이 같아지므로, 그 한 줄을 ActivityEntry 로 둔다.
// (기존 카드 집계가 참여자 기준이라 2명이 함께 간 1건은 두 사람에게 각각 1건으로 잡힌다 — 그대로 유지)

import { SERVICE_TYPES } from '@/components/activity/ActivityCard'
import { ACTIVITY_TYPES as SALES_TYPES } from '@/components/customer/modals/SalesActivityModal'

export { SALES_TYPES }

/** 카드에 세로로 나열하는 순서 — 서비스 6종 다음에 영업 4종. */
export const ACTIVITY_TYPES: string[] = [...SERVICE_TYPES, ...SALES_TYPES]

export type ActivitySource = 'service' | 'sales'

/**
 * 활동 한 줄. 집계·상세 목록·동선 지도가 같은 모양을 쓴다.
 * id 는 원본 테이블의 PK 라 source 없이는 유일하지 않다(두 테이블에서 겹칠 수 있다).
 */
export type ActivityEntry = {
  source: ActivitySource
  id: number                 // service_id | activity_id
  engineerId: number
  date: string               // 'YYYY-MM-DD'
  type: string               // service_type | activity_type
  customerId: number | null
  customerName: string
  notes: string | null
  isPaid: boolean | null     // 영업 활동에는 없는 값이라 항상 null
  lat: number | null
  lng: number | null
}

/** 목록·키에 쓰는 유일 키. 두 테이블의 id 가 겹쳐도 충돌하지 않는다. */
export const entryKey = (e: Pick<ActivityEntry, 'source' | 'id'>) => `${e.source}-${e.id}`

// 날짜에 시각이 없어 하루 안의 실제 순서는 알 수 없고, 두 테이블의 id 는 서로 비교할 의미가 없다.
// 그래서 2차 기준은 (source, id) 로 못 박아 '뜻은 없지만 항상 같은' 순서를 만든다.
// 이 기준이 없으면 서비스와 영업이 섞일 때 목록·동선 순서가 조회할 때마다 달라진다.
const tieBreak = (a: ActivityEntry, b: ActivityEntry) =>
  a.source !== b.source ? (a.source < b.source ? -1 : 1) : a.id - b.id

/** 날짜 오름차순 → (source, id) 오름차순. 동선 순서용. */
export const byDateAsc = (a: ActivityEntry, b: ActivityEntry) =>
  a.date === b.date ? tieBreak(a, b) : (a.date < b.date ? -1 : 1)

/** 날짜 내림차순 → (source, id) 내림차순(최근 등록이 위). 상세 목록용. */
export const byDateDesc = (a: ActivityEntry, b: ActivityEntry) =>
  a.date === b.date ? -tieBreak(a, b) : (a.date < b.date ? 1 : -1)
