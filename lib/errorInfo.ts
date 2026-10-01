// 콘솔에 남길 오류 정보를 열거 가능한 평범한 객체로 펴 준다.
//
// 왜 필요한가 — supabase-js 오류나 fetch 예외를 console.error 에 그대로 넘기면 {} 로 보인다.
// Error(그리고 이를 상속한 PostgrestError·StorageApiError·AuthError)는 message·name·stack 을
// **열거 불가** 속성으로 들고 있다. 그래서 열거 가능한 키만 훑는 직렬화 — JSON.stringify,
// 개발 서버(Next dev)가 브라우저 콘솔을 터미널로 넘길 때 쓰는 직렬화, postMessage 계열 —
// 에서는 남는 키가 하나도 없어 빈 객체가 된다.
//   JSON.stringify(new TypeError('Failed to fetch'))  // → '{}'
//
// 네 칸(message·code·details·hint)을 이름 붙여 꺼내 두면 어느 경로로 찍혀도 사유가 보인다.
// 값이 없어도 키는 남긴다 — 「없다」와 「직렬화에서 빠졌다」를 구분할 수 있어야 한다.

/** 문자열·숫자만 그대로, 그 밖은 null. 객체를 중첩해 넣지 않는다(다시 {} 가 된다). */
const pick = (v: unknown): string | number | null => {
  if (typeof v === 'string') return v || null
  if (typeof v === 'number') return v
  return null
}

export function errorInfo(e: unknown): {
  name: string | number | null
  message: string | number | null
  code: string | number | null
  details: string | number | null
  hint: string | number | null
} {
  const o = (typeof e === 'string' ? { message: e } : (e ?? {})) as {
    name?: unknown; message?: unknown; code?: unknown; details?: unknown; hint?: unknown
  }
  return {
    name: pick(o.name),
    message: pick(o.message),
    code: pick(o.code),
    details: pick(o.details),
    hint: pick(o.hint),
  }
}
