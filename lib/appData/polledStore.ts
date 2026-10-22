'use client'

// **앱 당 하나**인 자료를 주기적으로 다시 읽는 작은 스토어.
//
// 알림과 결재 미결함이 그런 자료다. 예전에는 사이드바 배지와 홈 카드가 각자 읽어 같은 것을
// 두 번 가져왔고(docs/perf-baseline.md ②), 배지 쪽 폴링은 10초였다 — 화면을 켜 두면
// 하루에 수천 번이다. 여기 한 벌만 두고 모두가 그것을 본다.
//
// ── 규칙 ────────────────────────────────────────────────────────────────────
//   · 보는 사람(구독자)이 **하나 이상일 때만** 타이머가 돈다.
//   · 탭이 숨으면 멈춘다. 다시 보이면 **즉시 한 번** 읽고 타이머를 다시 켠다 —
//     폴링의 목적은 「보고 있는 사람에게 최신을 보여 주는 것」이다.
//   · 열쇠(engineerId)가 바뀌면 처음부터 다시 읽는다. null 이면 비운다(로그아웃).
//   · 쓰기(읽음 처리·결재 처리)는 update()·refresh() 로 **즉시** 반영한다. 폴링을 기다리지 않는다.
//
// React 밖의 평범한 모듈이다 — useSyncExternalStore 로 화면에 붙인다(각 스토어가 훅을 하나 낸다).

/** 폴링 주기 — 배지가 1분 안에 따라온다. 10초는 과했다(사람이 기다리는 값이 아니다). */
export const POLL_MS = 60000

export type PolledState<T> = { data: T; loading: boolean; error: string | null }

export type PolledStore<T> = {
  /** useSyncExternalStore 용. 첫 구독자가 붙을 때 타이머·탭 감시를 켠다. */
  subscribe: (cb: () => void) => () => void
  getSnapshot: () => PolledState<T>
  /** 보는 사람이 정해 주는 조회 열쇠(보통 engineerId). 바뀌면 다시 읽는다. */
  setKey: (key: number | null) => void
  /** 지금 다시 읽는다(처리 직후에 부른다). */
  refresh: () => Promise<void>
  /** 받아 둔 자료를 그 자리에서 고친다(읽음 표시처럼 결과가 뻔한 변화). */
  update: (fn: (data: T) => T) => void
  /** 로그아웃 — 열쇠와 자료를 버리고 타이머를 끈다. */
  reset: () => void
}

export function createPolledStore<T>(
  name: string,
  empty: T,
  load: (key: number) => Promise<T>,
  intervalMs: number = POLL_MS,
): PolledStore<T> {
  let state: PolledState<T> = { data: empty, loading: true, error: null }
  let key: number | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let watchers = 0
  const listeners = new Set<() => void>()

  const emit = () => { for (const l of [...listeners]) l() }
  const set = (next: PolledState<T>) => { state = next; emit() }

  const read = async (): Promise<void> => {
    const mine = key
    if (mine == null) return
    try {
      const data = await load(mine)
      if (key !== mine) return     // 그 사이 열쇠가 바뀌었으면 버린다
      set({ data, loading: false, error: null })
    } catch (e) {
      if (key !== mine) return
      console.error(`[${name}] 조회 실패`, e)
      set({ data: state.data, loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  const startTimer = () => {
    if (timer != null || typeof document === 'undefined') return
    timer = setInterval(() => { if (!document.hidden) void read() }, intervalMs)
  }
  const stopTimer = () => { if (timer != null) { clearInterval(timer); timer = null } }

  const onVisibility = () => {
    if (document.hidden) { stopTimer(); return }
    startTimer()
    void read()   // 돌아오자마자 한 번 — 1분을 기다리게 하지 않는다
  }

  return {
    subscribe(cb) {
      listeners.add(cb)
      watchers += 1
      if (watchers === 1 && typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibility)
        if (!document.hidden) startTimer()
      }
      return () => {
        listeners.delete(cb)
        watchers -= 1
        if (watchers === 0 && typeof document !== 'undefined') {
          stopTimer()
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }
    },
    getSnapshot: () => state,
    setKey(next) {
      if (next === key) return
      key = next
      if (next == null) { set({ data: empty, loading: true, error: null }); return }
      set({ data: state.data, loading: true, error: null })
      void read()
    },
    refresh: read,
    update(fn) { set({ data: fn(state.data), loading: state.loading, error: state.error }) },
    reset() {
      key = null
      stopTimer()
      set({ data: empty, loading: true, error: null })
    },
  }
}
