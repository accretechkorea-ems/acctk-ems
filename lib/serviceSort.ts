// 서비스 기록을 **어떤 순서로 보여 주는가** — 한 곳에만 둔다.
//
// 왜 꺼내 두었나(2026-11-20)
//   장비 카드의 기록이 11-19 → 11-06 → 11-18 로 나왔다. 조회가 `service_id` 내림차순
//   하나로만 정렬돼 있어서다 — id 는 **적은 순서**이지 **방문한 순서**가 아니다.
//   11-06 에 다녀온 일을 11-18 건보다 나중에 적으면 그 줄이 위로 올라온다.
//   기록이 나오는 자리가 여럿(장비 카드·회사 활동 이력)이라, 각자 정렬하면 또 갈라진다.
//
// ── 무엇으로 정렬하는가 ────────────────────────────────────────────────────
//   ① 방문일(`visit_date`) 내림차순 — 최근에 다녀온 것이 위다.
//   ② 같은 날이면 `service_id` 내림차순 — 나중에 적은 것이 위다.
//
//   ⚠ 요청은 「같은 날이면 created_at 내림차순」이었지만 **`service_history` 에는
//     `created_at` 칸이 없다**(2026-11-20 읽기로 확인: `42703 column
//     service_history.created_at does not exist`). 기록이 만들어진 시각을 담는 칸이
//     아예 없어서, 적은 순서를 알 수 있는 것은 **id 뿐**이다. id 는 시퀀스라
//     나중에 넣은 줄이 늘 더 크므로 같은 날 안에서는 같은 뜻이 된다.
//     (칸이 생기면 여기 한 줄만 고치면 된다.)
//
//   날짜가 **없는 줄**은 맨 아래로 보낸다 — 옛 자료 이관에서 방문일이 비어 들어온 줄이
//   남아 있다. 사이에 끼우면 「언제」를 알 수 없는 줄이 최근 기록 사이에 섞인다.

/** 정렬에 필요한 것만. ServiceHistory 가 이 꼴을 만족한다. */
export type SortableService = {
  service_id: number
  visit_date: string | null
}

/** 비교 함수 — `Array.prototype.sort` 에 그대로 넘긴다. */
export function compareServiceHistory(a: SortableService, b: SortableService): number {
  const ad = a.visit_date ?? ''
  const bd = b.visit_date ?? ''
  if (ad !== bd) {
    if (!ad) return 1          // 날짜 없는 줄은 아래로
    if (!bd) return -1
    return ad < bd ? 1 : -1    // 날짜 내림차순
  }
  return b.service_id - a.service_id
}

/** 새 배열로 정렬해 돌려준다(받은 배열은 건드리지 않는다). */
export function sortServiceHistory<T extends SortableService>(rows: T[]): T[] {
  return [...rows].sort(compareServiceHistory)
}
