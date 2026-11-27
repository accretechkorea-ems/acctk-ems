// **자동 로그아웃** — 쓰고 있는데 튕기지 않게 (2026-11-27, 묶음5 8).
//
//   node scripts/session-idle-check.js
//
// ── 신고 ──────────────────────────────────────────────────────────────────
//   「사용 중에도 로그아웃된다.」 조사에서 두 갈래가 나왔다:
//
//   ① **활동으로 안 세던 일들** — 듣는 일이 click·keydown·mousemove 셋뿐이었다.
//      긴 표를 **굴려** 읽거나 폰에서 **쓸어 넘기는** 동안에는 30분이 꼬박 흘렀다.
//      게다가 **거품 단계**로 들어서, 가는 길에 stopPropagation 을 부르는 자리를
//      (체크칸·트리 화살표·줄 안의 링크) 눌러 일하는 동안 타이머가 멈추지 않았다.
//
//   ② **미들웨어가 한 번 묻고 쫓아냈다** — `getUser()` 는 Auth 서버에 묻는 망 요청이다.
//      그 한 번이 끊기거나 늦으면 user 가 null 로 오고 바로 /login 으로 보냈다.
//      토큰은 멀쩡한데 **화면을 옮기다** 튕긴다. 화면 전환마다 이 요청이 한 번씩 나간다.
//
// 키 없이 서버 없이 돈다 — 글자만 읽는다.

const load = module.require.bind(module)
const fs = load('fs')
const path = load('path')
const ROOT = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
/** 주석을 뺀 몸통 — 「없어야 한다」가 제 설명에 걸리지 않게. CRLF 도 받는다. */
const code = src => src
  .split(/\r?\n/)
  .map(l => l.replace(/(^|[^:])\/\/.*$/, '$1'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')

let fails = 0
const ok = (name, good, extra) => {
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
}

const SM = read('components/common/SessionManager.tsx')
const SMC = code(SM)
const MW = read('middleware.ts')

console.log('── ① 무엇을 활동으로 세나 ──')
ok('누름 — pointerdown(마우스·펜·손가락 한 길)', /'pointerdown'/.test(SMC))
ok('키 입력 — keydown', /'keydown'/.test(SMC))
ok('터치 — touchstart', /'touchstart'/.test(SMC))
// 굴려 읽는 것도 쓰는 것이다. 이것이 빠져 있던 것이 신고의 한 몫이다.
ok('**굴리기 — scroll**', /'scroll'/.test(SMC))
ok('마우스 이동', /'mousemove'/.test(SMC))
ok('탭으로 돌아오기 — visibilitychange', /visibilitychange/.test(SMC))
ok('돌아오면 판정부터 하고 그 뒤에 시계를 되돌린다',
  /check\(\)\s*\r?\n\s*if \(!leavingRef\.current && idleFor\(\) < IDLE_MS\) touch\(\)/.test(SM))

console.log('\n── ②. 가려지지 않게 듣는다 ──')
// 거품 단계로 들으면 stopPropagation 한 번에 활동이 사라진다.
ok('**잡는 단계**(capture)로 듣는다', /capture: true/.test(SMC))
ok('굴리기를 막지 않는다(passive)', /passive: true/.test(SMC))
ok('붙일 때도 뗄 때도 같은 옵션을 준다 — 안 떼어지면 효과가 쌓인다',
  (SMC.match(/addEventListener\(ev, \w+, CAPTURE\)/g) || []).length === 2
  && (SMC.match(/removeEventListener\(ev, \w+, CAPTURE\)/g) || []).length === 2)
ok('쏟아지는 일은 10초에 한 번만 적는다', /THROTTLE_MS = 10 \* 1000/.test(SM))

console.log('\n── ③ 여러 탭 ──')
// 한 탭에서 일하면 다른 탭의 타이머도 함께 연장돼야 한다.
ok('활동 시각을 localStorage 로 나눠 쓴다', /const ACTIVITY_KEY = 'lastActivity'/.test(SM)
  && /localStorage\.setItem\(ACTIVITY_KEY/.test(SMC))
ok('경과도 그 칸에서 읽는다(탭마다 따로 세지 않는다)', /localStorage\.getItem\(ACTIVITY_KEY\)/.test(SMC))
ok('한 탭이 끊기면 다른 탭도 같은 곳으로 간다', /SIGNED_OUT/.test(SMC) && /IDLE_FLAG/.test(SMC))
ok('손으로 한 로그아웃과 가른다(표식 수명)', /IDLE_FLAG_TTL = 15 \* 1000/.test(SM))

console.log('\n── ④ 경고 모달 ──')
ok('로그아웃 30분 · 경고 29분', /IDLE_MS = 30 \* 60 \* 1000/.test(SM) && /WARN_MS = 29 \* 60 \* 1000/.test(SM))
// 60초마다 보면 29~30분 사이 한 칸을 통째로 건너뛸 수 있다 — 경고가 안 뜨고 끊긴다.
ok('10초마다 본다(경고가 제 시각에 걸리게)', /TICK_MS = 10 \* 1000/.test(SM))
ok('공용 카드로 띄운다', /<ModalCard/.test(SM) && /<ModalOverlay/.test(SM))
ok('확인 창과 같은 층', /zIndex: Z\.confirm/.test(SM))
ok('글은 「1분 뒤 자동 로그아웃됩니다」', /1분 뒤 자동 로그아웃됩니다/.test(SM))
ok('단추는 「계속 사용」 하나', /계속 사용/.test(SM))
ok('바깥을 눌러도 이어 쓴다(누른 것 자체가 활동이다)', /<ModalOverlay onClose=\{touch\}/.test(SM))
// 숨은 탭에서는 모달을 띄워도 아무도 못 본다 — 돌아온 순간에 판정한다.
ok('숨은 탭에서는 판정하지 않는다', /if \(document\.visibilityState !== 'visible'\) return/.test(SMC))

console.log('\n── ⑤ 토큰을 못 물어봤을 때 ──')
ok('미들웨어가 **한 번 더** 묻는다', /let user = await askUser\(\)/.test(MW) && /user = await askUser\(\)/.test(MW))
ok('곧바로 묻지 않고 쉬었다 묻는다', /AUTH_RETRY_MS = 250/.test(MW) && /setTimeout\(r, AUTH_RETRY_MS\)/.test(MW))
ok('망이 끊긴 것은 「없는 사람」이 아니다(throw 를 삼킨다)', /\} catch \{\s*\r?\n[\s\S]{0,120}return null/.test(MW))
ok('두 번 다 없을 때만 로그인으로 보낸다',
  MW.indexOf('user = await askUser()') < MW.indexOf('if (!user && !isPublicPath(pathname)'))

console.log(fails === 0 ? '\n전부 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
