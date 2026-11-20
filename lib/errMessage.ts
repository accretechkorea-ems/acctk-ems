/**
 * 던져진 것에서 **보여 줄 한 줄**을 꺼낸다.
 *
 * ── 왜 ───────────────────────────────────────────────────────────────────
 *   `catch (error: any)` 로 받아 `error?.message` 를 읽는 자리가 여러 곳이었다(2026-11-21
 *   조사에서 9곳). any 를 쓰면 그 자리에서 무엇이든 꺼낼 수 있어, 메시지가 없는 값을
 *   던졌을 때 `undefined` 가 그대로 토스트에 올라간다.
 *
 *   catch 의 값은 **무엇이든 올 수 있다**(Error · 문자열 · supabase 의 객체 · 숫자).
 *   그래서 unknown 으로 받고 이 함수 한 곳에서 가른다.
 *
 *     } catch (e) {
 *       toast.error(errMessage(e, '장비 추가 중 오류가 발생했습니다'))
 *     }
 */
export function errMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.trim()) return e.message
  if (typeof e === 'string' && e.trim()) return e
  // supabase 는 Error 가 아닌 객체({ message, code })를 돌려주기도 한다.
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m.trim()) return m
  }
  return fallback
}
