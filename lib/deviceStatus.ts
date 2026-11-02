// 고객 장비의 **상태** — 쓰고 있나, 폐기했나.
//
// devices.status (text, 기본 '사용중') · devices.disposed_at (date).
//
// ── 삭제와 무엇이 다른가 ────────────────────────────────────────────────────
//   · **삭제**(deleted_at) — 잘못 넣은 줄을 치우는 것이다. 목록에서 사라지고 아무 데도
//     안 나온다. 서비스 레포트가 그 장비를 가리키고 있어도 이름이 비어 버린다.
//   · **폐기**(status '폐기') — 실제로 쓰던 장비가 수명을 다한 것이다. 목록에서는 숨기지만
//     **지난 기록은 그대로 그 장비를 가리킨다**(레포트·홀딩·쇼룸 사용 기록). 그래서
//     이름이 비지 않고, 대신 「폐기」 뱃지가 붙는다.
//   둘은 서로 독립이다 — 폐기한 장비를 나중에 삭제할 수도 있다(권하지 않는다).
//
// ── 왜 status 가 null 인 줄도 살려 두는가 ───────────────────────────────────
//   컬럼에 기본값('사용중')이 있어 새 줄은 늘 채워지지만, **null 을 「모른다」가 아니라
//   「사용중」으로 본다**. 상태 칸을 뒤늦게 더한 표에서 null 이 섞이면 장비가 조용히
//   사라지는 쪽이 훨씬 나쁘다 — 숨기는 것은 '폐기' 라고 **적혀 있을 때만** 한다.
//   (2026-11-02 확인: 1,450줄 전부 '사용중', null 0줄.)
//
// 순수 함수만 둔다 — 하네스(scripts/device-status-check.js)가 그대로 돌린다.

/** 기본값 — 새 장비는 이 상태로 들어간다(DB 기본값과 같은 값이다). */
export const DEVICE_IN_USE = '사용중'
/** 폐기한 장비. 이 글자가 **적혀 있을 때만** 숨긴다. */
export const DEVICE_DISPOSED = '폐기'

/** 상태 칸만 있으면 판정할 수 있다 — 어느 표에서 읽어 왔든 상관없다. */
export type DeviceStatusLike = { status?: string | null; disposed_at?: string | null }

/** 폐기된 장비인가. 앞뒤 공백은 무시한다. */
export const isDisposed = (d: DeviceStatusLike | null | undefined): boolean =>
  (d?.status ?? '').trim() === DEVICE_DISPOSED

/** 목록에 보일 장비인가 — 폐기가 아닌 전부(null·빈 값·옛 값 포함). */
export const isInUse = (d: DeviceStatusLike | null | undefined): boolean => !isDisposed(d)

/** 폐기를 걸러낸 목록. 순서는 그대로 둔다. */
export function inUseOnly<T extends DeviceStatusLike>(list: readonly T[]): T[] {
  return list.filter(isInUse)
}

/** 폐기만. 「폐기 포함」 토글의 건수에 쓴다. */
export function disposedOnly<T extends DeviceStatusLike>(list: readonly T[]): T[] {
  return list.filter(isDisposed)
}

/**
 * PostgREST 조회에서 폐기를 빼는 조건 — `.or(IN_USE_FILTER)` 로 쓴다.
 *
 * 왜 `.neq('status', '폐기')` 가 아닌가 — SQL 에서 `null <> '폐기'` 는 참이 아니라 **null**
 * 이라 상태 칸이 빈 줄이 함께 떨어져 나간다(위 머리말). `or` 로 「비었거나 폐기가 아닌」을
 * 적어야 null 이 살아남는다.
 */
export const IN_USE_FILTER = `status.is.null,status.neq.${DEVICE_DISPOSED}`

/**
 * 뱃지 글자 — 「폐기 2026-11-02」. 날짜가 없으면 「폐기」만.
 * (옛 줄이나 손으로 고친 줄에는 disposed_at 이 없을 수 있다.)
 */
export function disposedLabel(d: DeviceStatusLike): string {
  const day = (d.disposed_at ?? '').slice(0, 10)
  return day ? `${DEVICE_DISPOSED} ${day}` : DEVICE_DISPOSED
}

/** 폐기 처리로 쓸 값. 오늘 날짜는 부르는 쪽이 넘긴다(한국 날짜를 쓰는 곳이 따로 있다). */
export const disposePatch = (today: string) => ({ status: DEVICE_DISPOSED, disposed_at: today })

/** 폐기 취소로 쓸 값 — 상태를 되돌리고 날짜를 비운다. */
export const restorePatch = () => ({ status: DEVICE_IN_USE, disposed_at: null })
