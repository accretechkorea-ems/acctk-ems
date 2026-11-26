// 임시 비밀번호 — **서버에서만** 만든다 (2026-11-26).
//
// 순수 모듈이다(라우트와 하네스가 함께 읽는다). 브라우저에서 부르지 않는다 —
// 만드는 자리가 둘이 되면 「어디서 난 값인가」를 알 수 없다.
//
// ── 글자를 고른 규칙 ───────────────────────────────────────────────────────
//   영문 대소문자 + 숫자에서 **헷갈리는 넷을 뺐다**: 0 · O · 1 · l.
//   받는 사람은 이 값을 **읽어서 옮겨 적는다**(화면에 한 번 뜨고 사라진다). 0 과 O 를
//   잘못 읽으면 로그인이 안 되고, 그 사람은 왜 안 되는지 알 수 없다.
//   기호는 넣지 않았다 — 전화로 불러 주는 자리가 있고, 「느낌표」·「언더바」가 더 헷갈린다.
//   길이 10 은 그 글자 집합에서 약 58비트다(58^10 ≈ 4.3×10^17). 한 번 쓰고 바꿀 값으로 넉넉하다.

/** 쓸 수 있는 글자 — 0 · O · 1 · l 을 뺀 영문 대소문자와 숫자(58자). */
export const TEMP_PASSWORD_ALPHABET =
  'ABCDEFGHIJKLMNPQRSTUVWXYZ' +   // O 없음
  'abcdefghijkmnopqrstuvwxyz' +   // l 없음
  '23456789'                       // 0 · 1 없음

/** 임시 비밀번호 길이. */
export const TEMP_PASSWORD_LENGTH = 10

/** 헷갈려서 뺀 글자들 — 하네스가 「정말 빠졌는가」를 이 목록으로 본다. */
export const TEMP_PASSWORD_BANNED = ['0', 'O', '1', 'l'] as const

/**
 * 임시 비밀번호 한 개.
 *
 * ⚠ **치우치지 않게 뽑는다.** `random % 58` 로 하면 256 이 58 로 나누어떨어지지 않아
 *   앞쪽 글자가 더 자주 나온다(modulo bias). 그래서 58 의 배수를 넘는 값은 **버리고
 *   다시 뽑는다**. 버리는 비율은 256 − 232 = 24/256 ≈ 9% 뿐이다.
 *
 * @param randomBytes 바이트를 주는 함수(테스트에서 바꿔 끼운다). 기본은 안전한 난수다.
 */
export function makeTempPassword(
  randomBytes: (n: number) => Uint8Array = secureBytes,
  length: number = TEMP_PASSWORD_LENGTH,
): string {
  const n = TEMP_PASSWORD_ALPHABET.length
  const limit = Math.floor(256 / n) * n     // 232
  let out = ''
  let guard = 0
  while (out.length < length) {
    if (++guard > length * 50) throw new Error('임시 비밀번호를 만들지 못했습니다')
    for (const b of randomBytes(length)) {
      if (b >= limit) continue              // 치우침을 만드는 값은 버린다
      out += TEMP_PASSWORD_ALPHABET[b % n]
      if (out.length === length) break
    }
  }
  return out
}

/** 안전한 난수 — Node 18+ · 브라우저 모두 webcrypto 를 쓴다. */
function secureBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  globalThis.crypto.getRandomValues(buf)
  return buf
}
