// 서비스 방문일(service_history.visit_date) 을 다룰 때의 공통 규칙.
//
// 방문 기록은 「다녀온 일」과 「가기로 한 일」이 한 표에 섞여 있다 — 날짜만 미래일 뿐
// 컬럼이 따로 없다. 신규 설치 준비 체크리스트가 들어오면서 예정 건을 미리 등록하는 일이
// 늘어나므로, 두 가지를 가르는 기준을 여기 한 곳에 둔다.

import { todayKST } from '@/lib/date'

/** 아직 오지 않은 방문인가. 오늘 건은 「예정」이 아니다(오늘 가는 일은 오늘 한 일로 센다). */
export function isFutureVisit(visitDate: string | null | undefined, today: string = todayKST()): boolean {
  return !!visitDate && visitDate > today
}

/**
 * 활동 집계에 넣을 수 있는 마지막 방문일 — 기간의 끝과 오늘 중 이른 쪽.
 *
 * 예정으로 미리 써 둔 기록은 아직 한 일이 아니다. 상한이 없으면 이달 말 방문 예정을
 * 오늘 등록하는 순간 이번 달 C/S 활동 건수가 부풀어 오른다.
 * 쓰는 곳: 80 대시보드 · 활동 현황 · 개인 대시보드 — 세 곳이 같은 기준을 쓴다.
 */
export function countedVisitEnd(end: string, today: string = todayKST()): string {
  return end < today ? end : today
}
