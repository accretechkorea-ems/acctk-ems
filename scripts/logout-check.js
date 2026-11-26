// 로그아웃 — **반드시 끊기고, 반드시 나간다** (2026-11-26).
//
//   node scripts/logout-check.js
//
// ── 무엇이 잘못돼 있었나 (둘이다) ──────────────────────────────────────────
//   ① **포털 팝오버가 제 안의 클릭에 닫혔다** — 「로그아웃이 안 된다」의 진짜 원인.
//     2026-11-25(772c96e)에 아바타 메뉴를 Popover 로 바꾸면서 패널이 document.body 로
//     포털됐는데, 옛 `useOutsideClick(meRef, …)` 가 그대로 남았다. meRef 는 아바타를 감싼
//     div 라 패널은 그 **밖**이다 → 패널 안을 눌러도 「바깥」으로 보고 mousedown 에서 닫혔다.
//     click 은 mousedown 과 mouseup 이 같은 요소에서 나야 생기므로 **click 이 아예 나지
//     않았다**(측정: pointerdown·mousedown 1건, click 0건). 「정보 수정」도 같이 안 눌렸다.
//   ② **못 거두면 나가지도 않았다** — `await signOut()` 뒤에 주소를 바꿨는데, 그 호출은
//     망을 탄다. 끊기거나 만료된 토큰이면(403) 거부되어 다음 줄이 실행되지 않았다.
//     게다가 멈춘 요청이 supabase 의 auth 잠금을 쥐어 **두 번째 signOut 도 함께 멈춘다** —
//     그래서 폴백은 SDK 를 거치지 않고 쿠키를 직접 지운다.
//
// ── 지키는 약속 ─────────────────────────────────────────────────────────────
//   ① 사이드바에 `useOutsideClick(meRef, …)` 가 **없다**. 바깥 클릭은 Popover 만 맡는다.
//   ② 로그아웃은 **한 함수**다(lib/auth/logout.ts). 두 자리가 다르면 한쪽만 고쳐진다.
//   ③ 그 함수는 기다리되 오래 기다리지 않고, 쿠키를 **직접** 지우고, **replace** 로 나간다.
//   ④ 뒤로 가기로 되살아난 화면을 막는다(bfcache).

const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const ROOT = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
/** 주석을 걷은 글 — 「여기 쓰지 마라」를 적어 둔 주석이 검사에 걸리지 않게. */
const code = p => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')

let fails = 0
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}

const SIDE = code('components/layout/Sidebar.tsx')
const SIDE_FULL = read('components/layout/Sidebar.tsx')
const OUT = code('lib/auth/logout.ts')
const SESS = code('components/common/SessionManager.tsx')
const POP = code('components/common/Popover.tsx')

console.log('── ① 팝오버는 제 안의 클릭에 닫히지 않는다 ──')
ok('사이드바에 useOutsideClick 이 **없다**', !/useOutsideClick/.test(SIDE),
  '포털된 패널은 meRef 밖이라, 그 훅이 패널 안의 클릭을 바깥으로 본다')
ok('그 까닭을 주석에 남겼다', /772c96e/.test(SIDE_FULL) && /포털/.test(SIDE_FULL))
ok('Popover 는 **패널 자신**을 보고 닫는다', /panelRef\.current\?\.contains\(t\)/.test(POP))
ok('앵커 위 클릭도 닫지 않는다(토글이 다시 연다)', /anchorRef\.current\?\.contains\(t\)/.test(POP))

console.log('\n── ② 로그아웃은 한 함수다 ──')
ok('공용 함수가 있다', /export async function signOutAndLeave/.test(OUT))
ok('사이드바가 그것을 쓴다', /signOutAndLeave\(supabase\)/.test(SIDE))
ok('사이드바에 제 signOut 이 남아 있지 않다', !/auth\.signOut/.test(SIDE))
ok('자동 로그아웃도 같은 함수다', /signOutAndLeave\(supabase, IDLE_LOGIN_PATH\)/.test(SESS))
ok('자동 로그아웃에도 제 signOut 이 없다', !/auth\.signOut/.test(SESS))
// 두 단추(PC 팝오버·폰 드로어)가 같은 함수를 쓴다.
ok('로그아웃 단추 둘이 같은 함수를 부른다',
  (SIDE.match(/onClick=\{handleLogout\}/g) || []).length === 2)

console.log('\n── ③ 못 거둬도 나간다 ──')
ok('기다리는 시간에 뚜껑이 있다', /LOGOUT_TIMEOUT_MS/.test(OUT) && /function withTimeout/.test(OUT))
ok('실패해도 다음 줄로 간다(try/catch)', /catch \(e\) \{/.test(OUT))
ok('폴백에서 SDK 를 다시 부르지 않는다(auth 잠금이 안 풀린다)',
  (OUT.match(/auth\.signOut/g) || []).length === 1)
ok('쿠키를 **직접** 지운다', /function clearAuthStorage/.test(OUT) && /Max-Age=0/.test(OUT))
ok('sb-…auth-token 을 찾아 지운다', /startsWith\('sb-'\) && k\.includes\('auth-token'\)/.test(OUT))
ok('저장소도 비운다', /localStorage/.test(OUT) && /sessionStorage/.test(OUT))
ok('그 뒤 앱이 들고 있던 자료를 버린다', /dropCaches\(\)/.test(OUT)
  && /invalidateMe/.test(OUT) && /resetNotifications/.test(OUT) && /resetApprovalInbox/.test(OUT))
ok('**replace** 로 나간다(뒤로 가기 자리를 남기지 않는다)',
  /window\.location\.replace\(to\)/.test(OUT) && !/window\.location\.href/.test(OUT))

console.log('\n── ④ 되살아난 화면 ──')
ok('bfcache 를 막는 길이 있다', /export function guardRestoredPage/.test(OUT))
ok('되살아난 때만 본다', /if \(!e\.persisted\) return/.test(OUT))
ok('공개 화면은 건드리지 않는다', /if \(isPublic\(\)\) return/.test(OUT))
ok('세션이 없을 때만 보낸다', /if \(!data\.session\) window\.location\.replace\(LOGIN_PATH\)/.test(OUT))
ok('못 물어보면 그대로 둔다(쫓아내지 않는다)', /\.catch\(\(\) => \{/.test(OUT))
ok('앱 전체에 걸려 있다', /guardRestoredPage\(supabase, \(\) => isPublic\)/.test(SESS))

console.log('\n── ⑤ 미로그인은 서버가 막는다(그대로다) ──')
const MW = code('middleware.ts')
ok('보호 경로는 /login 으로 돌려보낸다',
  /if \(!user && !isPublicPath\(pathname\) && !isPublicAsset\(pathname\)\)/.test(MW))
ok('로그인한 채 /login 에 오면 대시보드로', /if \(user && pathname === '\/login'\)/.test(MW))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
