'use client'

/**
 * 로그아웃 — **한 길**로 모은다 (2026-11-26).
 *
 * ── 무엇이 잘못돼 있었나 ───────────────────────────────────────────────────
 *   사이드바의 로그아웃은 이랬다(2026-09-23 부터 그대로):
 *
 *       const handleLogout = async () => {
 *         await supabase.auth.signOut()
 *         window.location.href = '/login'
 *       }
 *
 *   `signOut()` 은 기본이 **global** 이라 서버에 토큰을 거두러 **망을 탄다**. 그 요청이
 *   거절되거나(이미 만료된 토큰이면 403) 끊기면 promise 가 거부되고 — 다음 줄이 **아예
 *   실행되지 않는다**. 화면은 그대로, 오류도 없다. 「눌러도 로그아웃이 안 된다」가 이것이다.
 *   재현: 로그아웃 요청만 막고 누르면 주소가 /dashboard 그대로다(2026-11-26 측정).
 *
 *   같은 일을 하는 다른 자리(components/common/SessionManager.tsx 의 자동 로그아웃)는
 *   try/catch 뒤에 반드시 화면을 옮겼다 — **두 자리가 달랐던 것**이 사고의 모양이다.
 *
 * ── 이제 지키는 것 ─────────────────────────────────────────────────────────
 *   ① **무슨 일이 있어도 로그인 화면으로 간다.** 토큰을 못 거뒀어도 간다.
 *   ② 서버 쪽 토큰 거두기는 **기다리되 오래 기다리지 않는다**(LOGOUT_TIMEOUT_MS).
 *     실패하면 **이 기기에서만** 지운다(scope: 'local' — 망을 타지 않는다).
 *   ③ 앱이 들고 있던 자료(본인·알림·결재함)를 버린다. 전체 새로고침이 어차피 버리지만,
 *     옮기기 전에 버려 두면 그 사이에 그려지는 화면이 남의 이름을 들고 있지 않다.
 *   ④ `replace` 로 옮긴다 — **뒤로 가기**가 방금 보던 보호 화면으로 돌아가지 않는다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { invalidateMe } from '@/lib/appData/me'
import { resetNotifications } from '@/lib/appData/notifications'
import { resetApprovalInbox } from '@/lib/appData/approvalInbox'

/** 로그인 화면. 사유를 붙이는 자리(자동 로그아웃·퇴사)는 부르는 쪽이 넘긴다. */
export const LOGIN_PATH = '/login'

/**
 * 서버에 토큰을 거두러 가는 요청을 기다리는 시간.
 * 길게 잡으면 「눌렀는데 아무 일도 안 난다」가 되고, 짧게 잡으면 거둘 수 있는 것도 못 거둔다.
 * 폰의 느린 망에서도 보통 1초 안에 끝난다 — 2.5초면 넉넉하다.
 */
export const LOGOUT_TIMEOUT_MS = 2500

/** 약속한 시간 안에 안 끝나면 거부한다. 원래 요청은 그대로 가게 둔다(거둬지면 좋은 일이다). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

/** 앱이 들고 있던 자료를 버린다. 하나가 실패해도 나머지는 버린다. */
function dropCaches(): void {
  for (const drop of [invalidateMe, resetNotifications, resetApprovalInbox]) {
    try { drop() } catch { /* 버리지 못해도 전체 새로고침이 버린다 */ }
  }
}

/**
 * **세션 쿠키·저장소를 이 기기에서 직접 지운다.** 망을 타지 않고, 기다릴 것이 없다.
 *
 * 왜 필요한가 — `supabase.auth.signOut()` 이 끝나지 않을 수 있다. 그 호출은 서버에 토큰을
 * 거두러 가는데, 그 요청이 멈춰 있으면 **auth 잠금**(supabase-js 가 인증 조작을 한 줄로
 * 세우는 자물쇠)이 풀리지 않아 **그 다음 signOut 도 함께 멈춘다**. 2026-11-26 측정에서
 * 로그아웃 요청을 막자 정확히 그 일이 났다 — 폴백으로 둔 `scope: 'local'` 까지 멈췄다.
 * 그래서 폴백은 SDK 를 거치지 않는다.
 *
 * ⚠ 쿠키를 **그냥 두고 떠나면 더 나쁘다**: /login 에 도착해도 미들웨어가 세션을 보고
 *   대시보드로 되돌려 보낸다(「눌렀더니 제자리」). 떠나기 전에 반드시 지운다.
 *
 * 이름 규칙 — @supabase/ssr 은 `sb-<프로젝트>-auth-token`(길면 `.0` `.1` 로 쪼갠다)에 담는다.
 * 어느 프로젝트인지 따지지 않고 **`sb-` 로 시작하고 `auth-token` 이 든 것 전부**를 지운다.
 */
function clearAuthStorage(): void {
  const mine = (k: string) => k.startsWith('sb-') && k.includes('auth-token')
  try {
    for (const raw of document.cookie.split(';')) {
      const name = raw.split('=')[0]?.trim()
      if (!name || !mine(name)) continue
      // 지우는 길은 「같은 이름으로 지난 날짜」다. 경로를 모르면 지워지지 않으므로
      // 쓰는 경로(/)와 지금 경로를 함께 친다.
      for (const p of ['/', window.location.pathname]) {
        document.cookie = `${name}=; Max-Age=0; path=${p}`
      }
    }
  } catch (e) {
    console.error('[logout] 쿠키를 지우지 못했다', e)
  }
  for (const store of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const s = store()
      for (const k of Object.keys(s)) if (mine(k)) s.removeItem(k)
    } catch { /* 비공개 모드·막힌 저장소 — 쿠키만으로도 세션은 끊긴다 */ }
  }
}

/**
 * 세션을 끊고 로그인 화면으로 간다. **돌아오지 않는다**(주소를 바꾸고 끝난다).
 *
 * @param supabase 브라우저 클라이언트
 * @param to       갈 곳. 사유를 붙이려면 `/login?reason=…` 처럼 넘긴다.
 */
export async function signOutAndLeave(
  supabase: Pick<SupabaseClient, 'auth'>,
  to: string = LOGIN_PATH,
): Promise<void> {
  try {
    await withTimeout(supabase.auth.signOut(), LOGOUT_TIMEOUT_MS)
  } catch (e) {
    // 서버에서 못 거뒀다 — 끊긴 망이거나 이미 만료된 토큰이다. 그래도 로그아웃은 된다.
    // 여기서 **SDK 를 다시 부르지 않는다**: 멈춰 있는 요청이 auth 잠금을 쥐고 있어
    // 다음 호출도 함께 멈춘다(2026-11-26 재현). 쿠키는 아래에서 우리가 직접 지운다.
    console.warn('[logout] 서버에서 토큰을 거두지 못했다 — 이 기기에서 지우고 나간다', e)
  }
  // 거뒀든 못 거뒀든 **반드시** 지운다. signOut 이 성공했으면 지울 것이 남아 있지 않다.
  clearAuthStorage()
  dropCaches()
  // href 가 아니라 replace 다 — 방금 보던 보호 화면을 **뒤로 가기 자리에 남기지 않는다**.
  // 전체 새로고침이라 메모리에 남은 자료도 함께 사라진다(router.push 와 다른 점).
  window.location.replace(to)
}

/**
 * **뒤로 가기로 되살아난 화면**을 막는다.
 *
 * 로그아웃 뒤 뒤로 가기를 누르면 브라우저가 보호 화면을 **되살려** 보여 줄 수 있다
 * (bfcache — 그림을 통째로 얼려 두었다가 그대로 되돌린다. 자바스크립트도 미들웨어도
 * 다시 돌지 않으므로 옛 화면이 그대로 보인다. iOS Safari 가 특히 적극적이다).
 * 되살아난 순간에만 세션을 다시 보고, 없으면 로그인 화면으로 보낸다.
 *
 * @returns 떼는 함수
 */
export function guardRestoredPage(
  supabase: Pick<SupabaseClient, 'auth'>,
  isPublic: () => boolean,
): () => void {
  const onPageShow = (e: PageTransitionEvent) => {
    // 되살아난 것이 아니면 평소대로 미들웨어가 이미 걸렀다.
    if (!e.persisted) return
    if (isPublic()) return
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) window.location.replace(LOGIN_PATH)
    }).catch(() => { /* 못 물어봤으면 그대로 둔다 — 쫓아내는 쪽이 더 나쁘다 */ })
  }
  window.addEventListener('pageshow', onPageShow)
  return () => window.removeEventListener('pageshow', onPageShow)
}
