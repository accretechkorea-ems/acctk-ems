// 목록 페이지 나누기 — 화면과 무관한 순수 계산만 둔다.
//
// 의뢰서 목록(lib/inquirySearch.ts)에 있던 것을 그대로 옮겼다. 결재함 기결문서(종결)가 같은 방식의
// 페이지 나누기를 쓰게 되어, 두 벌로 베끼지 않도록 중립 모듈로 뺐다.
// inquirySearch.ts 는 이 파일을 **재수출**한다 — 의뢰서 화면의 import 는 한 글자도 바뀌지 않는다.
//
// size 를 인자로 받고 기본값은 PAGE_SIZE 다. 그래서 의뢰서의 기존 호출(`totalPages(total)`)은
// 그대로 돌고, 다른 화면은 자기 크기를 넘길 수 있다.

/** 목록 한 페이지의 기본 건수. 의뢰서 목록이 쓰던 값이고, 결재함도 같은 값을 쓴다. */
export const PAGE_SIZE = 50

/** 서버가 받아 줄 수 있는 size 상한. 이보다 큰 값은 잘라서 쓴다. */
export const PAGE_SIZE_MAX = 100

/** 요청으로 들어온 size 를 쓸 수 있는 값으로 다듬는다. 숫자가 아니면 기본값. */
export function clampSize(raw: unknown, fallback = PAGE_SIZE): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(1, Math.floor(n)), PAGE_SIZE_MAX)
}

/** 요청으로 들어온 page 를 다듬는다(1 이상). 총 건수를 모를 때 쓴다. */
export function clampPageNo(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.floor(n))
}

export const totalPages = (total: number, size = PAGE_SIZE): number =>
  Math.max(1, Math.ceil(total / size))

/** 건수가 확정된 뒤 범위를 넘은 페이지를 끌어내린다(조용히 마지막 페이지로). */
export const clampPage = (page: number, total: number, size = PAGE_SIZE): number =>
  Math.min(Math.max(1, page), totalPages(total, size))

/** 지금 페이지가 보여 주는 번째 범위. 0건이면 null. */
export function pageRange(page: number, total: number, size = PAGE_SIZE): { from: number; to: number } | null {
  if (total <= 0) return null
  const p = clampPage(page, total, size)
  const from = (p - 1) * size + 1
  return { from, to: Math.min(p * size, total) }
}

/** 페이지 버튼에 쓸 번호. 사이가 끊기는 자리에는 '…' 를 넣는다. */
export type PageItem = number | '…'

/**
 * 처음·끝과 현재 주변만 보여 준다.
 * 가장자리(1~4, 끝에서 4개)에서는 '…' 가 한쪽에만 생겨 버튼 수가 들쭉날쭉하지 않게 한다.
 */
export function pageWindow(page: number, total: number, around = 1, size = PAGE_SIZE): PageItem[] {
  const last = totalPages(total, size)
  const cur = clampPage(page, total, size)
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1)

  const set = new Set<number>([1, last, cur])
  for (let d = 1; d <= around; d++) { set.add(cur - d); set.add(cur + d) }
  // 가장자리에서는 반대쪽을 한 칸 더 보여 준다(버튼 수를 비슷하게 유지).
  if (cur <= 3) { set.add(2); set.add(3); set.add(4) }
  if (cur >= last - 2) { set.add(last - 1); set.add(last - 2); set.add(last - 3) }

  const nums = [...set].filter(n => n >= 1 && n <= last).sort((a, b) => a - b)
  const out: PageItem[] = []
  let prev = 0
  for (const n of nums) {
    if (prev && n - prev > 1) out.push('…')
    out.push(n)
    prev = n
  }
  return out
}

/** 한 페이지만큼 잘라 낸다(서버가 이미 끊어 준 목록에는 쓰지 않는다). */
export function pageSlice<T>(rows: T[], page: number, size = PAGE_SIZE): T[] {
  const p = clampPage(page, rows.length, size)
  return rows.slice((p - 1) * size, p * size)
}
