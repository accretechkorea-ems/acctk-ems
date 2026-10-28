// Sentry 설정 — **보내는 것과 보내지 않는 것**을 한곳에서 정한다.
//
// 지금 운영에서 오류가 나면 아무도 모른다(console.error 658곳이 전부 브라우저 콘솔이나
// Vercel 함수 로그로만 간다 — docs/audit-2026-10.md B4). 그 구멍만 메운다.
//
// ── 잡는 범위는 둘뿐이다 ────────────────────────────────────────────────────
//   · 서버 라우트의 **미처리 예외·500** (instrumentation.ts 의 onRequestError)
//   · 브라우저의 **미처리 예외** (instrumentation-client.ts + app/global-error.tsx)
// console.error 658곳은 건드리지 않는다 — 그걸 다 보내면 무료 쿼터(월 5,000)가 금방 찬다.
//
// ── 보내지 않는 것 ──────────────────────────────────────────────────────────
//   요청 본문 · 헤더 · 쿠키 · 질의 문자열 — 견적 금액·고객 정보·메일이 섞인다.
//   사용자는 **engineer_id 만** 적는다(이름·메일을 넣지 않는다).
// 아래 scrubEvent 가 그 일을 하고 하네스(scripts/sentry-scrub-check.js)가 못 박는다.
//
// ── DSN 이 없으면 아무것도 하지 않는다 ──────────────────────────────────────
//   로컬·CI 는 키 없이 돌아야 한다. sentryDsn() 이 빈 값이면 init 을 부르지 않는다.

/** 그 자리에서 쓸 DSN. 없으면 빈 글자 — 부르는 쪽이 보고 끈다. */
export function sentryDsn(side: 'server' | 'browser'): string {
  const raw = side === 'server'
    // 서버는 서버 전용 키를 먼저 본다. 둘 다 같은 값을 넣어도 되고, 브라우저 것만 넣어도 돈다.
    ? (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)
    : process.env.NEXT_PUBLIC_SENTRY_DSN
  return (raw ?? '').trim()
}

/** 켜져 있는가. */
export const sentryEnabled = (side: 'server' | 'browser'): boolean => sentryDsn(side).length > 0

/** 이벤트에서 우리가 손대는 부분만 추린 모양. Sentry 타입에 묶이지 않게 느슨하게 둔다. */
export type ScrubbableEvent = {
  request?: {
    url?: string
    method?: string
    data?: unknown
    headers?: unknown
    cookies?: unknown
    query_string?: unknown
    [k: string]: unknown
  }
  user?: { id?: string | number; [k: string]: unknown }
  server_name?: string
  [k: string]: unknown
}

/**
 * 보내기 전에 지운다.
 *
 *   요청 — 본문·헤더·쿠키·질의 문자열을 **지우고**, 주소는 **물음표 앞까지만** 남긴다.
 *          어느 라우트에서 터졌는지는 알아야 하고, 그 뒤에 붙는 값은 알 필요가 없다.
 *   사용자 — id(= engineer_id)만 남긴다. 이름·메일·ip 는 지운다.
 *   서버 이름 — 지운다(어느 함수 인스턴스인지는 쓸모가 없다).
 *
 * 되돌려 준 객체를 그대로 보낸다. null 을 돌려주면 그 이벤트는 보내지 않는다 —
 * 지금은 그렇게 버리는 경우가 없다(에러는 100% 보낸다).
 */
// 제네릭을 느슨하게 둔다 — Sentry 의 ErrorEvent·TransactionEvent 를 그대로 받아 **같은 타입으로**
// 돌려주려면 그 타입에 묶이지 않아야 한다. 손대는 칸만 안에서 좁혀 쓴다.
export function scrubEvent<T extends object>(event: T): T {
  const e = event as ScrubbableEvent
  if (e.request) {
    const url = typeof e.request.url === 'string' ? e.request.url.split('?')[0] : undefined
    const method = typeof e.request.method === 'string' ? e.request.method : undefined
    // 통째로 새로 만든다 — 남겨 둘 칸을 고르는 쪽이, 지울 칸을 고르는 쪽보다 안전하다
    // (Sentry 가 새 칸을 더해도 조용히 따라 나가지 않는다).
    e.request = { ...(url ? { url } : {}), ...(method ? { method } : {}) }
  }
  if (e.user) {
    const id = e.user.id
    e.user = id === undefined || id === null ? {} : { id: String(id) }
  }
  if (e.server_name) delete e.server_name
  return event
}

/** 두 쪽이 함께 쓰는 값. */
export const SENTRY_COMMON = {
  /** 에러는 전부 보낸다. */
  sampleRate: 1,
  /** 성능 추적은 끈다 — 무료 쿼터(월 5,000)를 에러에만 쓴다. */
  tracesSampleRate: 0,
  /** 몸값에 ip·쿠키·헤더를 자동으로 붙이지 않는다. */
  sendDefaultPii: false,
  debug: false,
} as const
