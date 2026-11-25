// **쪽 나누기**의 규칙 한 벌 (2026-11-26).
//
// 순수 모듈이다(import 가 없다) — 화면·부품·하네스가 함께 읽는다.
// 쪽은 **1부터** 센다(주소의 ?page= 와 같은 수다. 0부터 세면 사람이 읽는 수와 어긋난다).
//
// 서버에서 끊어 온다는 뜻 — 목록을 전부 받아 놓고 잘라 보여 주는 것이 아니라,
// `range(from, to)` 로 그 쪽만 받아 온다. 그래야 줄이 수천이어도 첫 화면이 가볍다.

/** 한 쪽에 몇 줄 — 발주 목록의 값이자 기본값이다. */
export const PAGE_SIZE = 50

/** 전체 줄 수로 **몇 쪽**인가. 0건이면 1쪽이다(빈 목록도 한 쪽은 있다). */
export function pageCount(total: number, size: number = PAGE_SIZE): number {
  if (!Number.isFinite(total) || total <= 0) return 1
  return Math.max(1, Math.ceil(total / Math.max(1, size)))
}

/** 쪽 번호를 1..pages 안으로 끌어 들인다(주소로 아무 수나 들어올 수 있다). */
export function clampPage(page: unknown, total: number, size: number = PAGE_SIZE): number {
  const n = Math.floor(Number(page))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, pageCount(total, size))
}

/** 그 쪽이 받아 올 자리 — supabase 의 `.range(from, to)` 에 그대로 넘긴다(둘 다 포함). */
export function pageRange(page: number, size: number = PAGE_SIZE): { from: number; to: number } {
  const p = Math.max(1, Math.floor(page) || 1)
  const from = (p - 1) * size
  return { from, to: from + size - 1 }
}

/**
 * 「전체 1,234건 · 51–100」 — 지금 보고 있는 자리를 한 줄로.
 * 0건이면 건수만 적는다(「51–100」이 없다).
 */
export function pageLabel(page: number, size: number, total: number): string {
  const n = Math.max(0, Math.floor(total) || 0)
  const head = `전체 ${n.toLocaleString('ko-KR')}건`
  if (n === 0) return head
  const { from } = pageRange(page, size)
  const first = Math.min(from + 1, n)
  const last = Math.min(from + size, n)
  return `${head} · ${first.toLocaleString('ko-KR')}–${last.toLocaleString('ko-KR')}`
}

/** 쪽 번호 줄에 들어가는 것 — 수이거나 줄임표다. */
export type PageItem = number | '…'

/** 이 수 이하면 줄임표 없이 **전부** 보여 준다. */
export const SHOW_ALL_MAX = 7

/**
 * 「‹ 1 … 4 5 6 … 20 ›」의 가운데 목록을 만든다.
 *
 *   span  지금 쪽 **양옆**으로 몇 개를 보일까(기본 1 → 가운데가 셋이다).
 * 첫 쪽과 끝 쪽은 늘 보인다 — 어디로든 한 번에 갈 수 있어야 한다.
 * 줄임표는 **건너뛴 쪽이 둘 이상일 때만** 넣는다(한 개를 숨기고 … 를 두면 더 길다).
 */
export function pageItems(page: number, pages: number, span = 1): PageItem[] {
  const last = Math.max(1, Math.floor(pages) || 1)
  const cur = Math.min(Math.max(1, Math.floor(page) || 1), last)
  // 몇 쪽 안 되면 **전부** 보여 준다 — 「1 2 … 5」는 줄임표가 아끼는 것보다 읽기 불편하다.
  if (last <= SHOW_ALL_MAX) return Array.from({ length: last }, (_, i) => i + 1)
  const want = new Set<number>([1, last])
  for (let i = cur - span; i <= cur + span; i++) if (i >= 1 && i <= last) want.add(i)
  const nums = [...want].sort((a, b) => a - b)

  const out: PageItem[] = []
  let prev = 0
  for (const n of nums) {
    if (prev && n - prev === 2) out.push(prev + 1)   // 한 개만 비면 그 수를 그대로 둔다
    else if (prev && n - prev > 2) out.push('…')
    out.push(n)
    prev = n
  }
  return out
}
