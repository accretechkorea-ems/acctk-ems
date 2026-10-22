// 알림 묶음 — notifications.type 의 접두어로 가른다.
//
// 알림 화면(app/notifications/page.tsx)의 탭이 쓰던 규칙을 그대로 뽑은 것이다. 홈의 알림
// 카드가 종류별 건수를 세려면 같은 규칙이어야 한다 — 카드와 화면이 다르게 묶으면
// 「견적 3건」이라 적힌 카드를 눌러 들어간 화면에서 견적 탭이 2건이 된다.
//
// 어디에도 걸리지 않는 것은 「기타」로 모인다(발주·세금계산서·일정 등).
// 새 type 이 생겨도 화면이 깨지지 않고 기타로 떨어진다.

export const NOTI_TYPE_GROUPS: { label: string; prefixes: string[] }[] = [
  { label: '견적', prefixes: ['quote_'] },
  { label: '리드', prefixes: ['lead_'] },
  { label: '요청/결재', prefixes: ['approval_', 'showroom_', 'request', 'stock_'] },
  { label: '건의사항', prefixes: ['suggestion_'] },
]

/** 묶음 이름 전부 — 마지막이 「기타」다. 카드의 줄 순서와 화면의 탭 순서가 이 배열이다. */
export const NOTI_GROUPS: string[] = [...NOTI_TYPE_GROUPS.map(g => g.label), '기타']

/** 알림 하나가 어느 묶음인지. */
export function notiGroupOf(type: string): string {
  const hit = NOTI_TYPE_GROUPS.find(g => g.prefixes.some(p => type.startsWith(p)))
  return hit ? hit.label : '기타'
}
