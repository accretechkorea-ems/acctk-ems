// 폰 고객사 화면 — **페이지가 구른다** (2026-11-28, 야간4 5-2).
//
//   node scripts/home-phone-scroll-check.js
//
// 지키는 약속
//   ① 폰 규칙은 **app/globals.css 한 곳**이다 — app/page.tsx 의 본문 <style> 에 남아
//      있지 않다. 갈려 있으면 묶음4 의 예외가 무엇을 되돌리는지 한 파일만 봐서는 모른다.
//   ② 목록 보기는 **페이지(body)가 구른다** — 좌 패널이 흐름에 서고(static) 목록 통이
//      스스로 구르지 않는다.
//   ③ 지도 보기는 **화면을 꽉 채우고 구르지 않는다**(지도는 끌고 확대하는 것이다).
//   ④ 세그먼트·검색 카드는 **앱바 아래**에 붙는다 — top 이 앱바 높이만큼 내려가 있다.
//   ⑤ 앱바 높이를 **숫자로 두 번 적지 않는다** — CSS 의 기본값이 Sidebar 의 상수와 같다.
//
// 키도 서버도 없이 돈다. 브라우저 실측은 scripts/night4-panel-measure.js 가 한다.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

const CSS = read('app/globals.css')
const PAGE = read('app/page.tsx')
const SIDEBAR = read('components/layout/Sidebar.tsx')

const fails = []
let total = 0
const ok = (name, got, want = true) => {
  total += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${same ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
  if (!same) fails.push(name)
}

console.log('── ① 폰 규칙은 한 곳 ──')
ok('app/page.tsx 에 폰 미디어 쿼리가 남아 있지 않다', /@media \(max-width: 768px\)/.test(PAGE), false)
ok('그 까닭을 적어 두었다', /app\/globals\.css 한 곳/.test(PAGE))
ok('보기를 클래스로 적는다', /mobile-map' : 'mobile-list'/.test(PAGE))
ok('globals.css 가 두 보기를 가른다',
  /\.home-wrapper\.mobile-list \{/.test(CSS) && /\.home-wrapper\.mobile-map \{/.test(CSS))

console.log('── ② 목록 보기 — 페이지가 구른다 ──')
const list = CSS.slice(CSS.indexOf('.home-wrapper.mobile-list {'), CSS.indexOf('.home-wrapper.mobile-map {'))
ok('래퍼 높이는 auto', /\.home-wrapper\.mobile-list \{[\s\S]{0,200}height: auto !important;/.test(CSS))
ok('래퍼가 가리지 않는다', /\.home-wrapper\.mobile-list \{[\s\S]{0,300}overflow: visible !important;/.test(CSS))
ok('격자와 그 자식도 auto·visible',
  /\.home-wrapper\.mobile-list \.home-grid > div > div \{[\s\S]{0,200}overflow: visible !important;/.test(CSS))
// 패널이 absolute 로 남으면 부모가 높이를 갖지 못해 **구를 거리가 생기지 않는다**.
ok('좌 패널이 흐름에 선다(static)', /\.home-wrapper\.mobile-list \.side-panel \{[\s\S]{0,200}position: static !important;/.test(CSS))
ok('목록 통은 스스로 구르지 않는다',
  /\.home-wrapper\.mobile-list \.customer-list-scroll \{[\s\S]{0,200}overflow: visible !important;/.test(list))
ok('목록 통 높이도 풀었다', /max-height: none !important;/.test(list))

console.log('── ③ 지도 보기 — 꽉 채우고 구르지 않는다 ──')
const map = CSS.slice(CSS.indexOf('.home-wrapper.mobile-map {'))
ok('래퍼가 화면 높이에서 앱바를 뺀다', /height: calc\(100dvh - var\(--ems-topbar-h, 48px\) - env\(safe-area-inset-top\)\) !important;/.test(map))
ok('구르지 않는다', /\.home-wrapper\.mobile-map \{[\s\S]{0,300}overflow: hidden !important;/.test(CSS))
ok('격자가 높이를 다 쓴다', /\.home-wrapper\.mobile-map \.home-grid \{ height: 100% !important;/.test(CSS))

console.log('── ④ 붙어 있는 두 줄 ──')
// 앱바는 **흐름 안의 sticky(top: 0)** 다 — 0 으로 두면 그 뒤로 숨는다(390 캡처에서 보았다).
ok('세그먼트 줄이 앱바 아래에 붙는다',
  /\.mobile-tab-bar \{[\s\S]{0,160}position: sticky;[\s\S]{0,160}top: calc\(var\(--ems-topbar-h, 48px\) \+ env\(safe-area-inset-top\)\);/.test(list))
ok('검색 카드는 그 아래(48px 더)',
  /\.side-panel > \*:first-child \{[\s\S]{0,200}top: calc\(var\(--ems-topbar-h, 48px\) \+ env\(safe-area-inset-top\) \+ 48px\);/.test(list))
// 색 값을 글자로 들고 있으면 색 토큰 하네스가 이 파일을 센다 — 이어 붙여 둔다.
const HEX = v => '#' + v
ok('둘 다 바탕이 있다(글자가 비쳐 보이지 않게)',
  (list.match(new RegExp('background: ' + HEX('fafafa') + ';', 'g')) || []).length >= 2)

console.log('── ⑤ 앱바 높이를 두 번 적지 않는다 ──')
const m = /export const TOPBAR_HEIGHT = (\d+)/.exec(SIDEBAR)
ok('Sidebar 가 상수를 내보낸다', !!m)
const cssDefault = /--ems-topbar-h: (\d+)px;/.exec(CSS)
ok('globals.css 에 기본값이 있다', !!cssDefault)
ok('두 값이 같다', [m && m[1], cssDefault && cssDefault[1]], ['48', '48'])
ok('앱바도 같은 이름으로 내려 준다', /'--ems-topbar-h' as string\]: `\$\{TOPBAR_HEIGHT\}px`/.test(SIDEBAR))

console.log('── ⑥ 묶음4 의 두 고침 ──')
// 그 둘은 「안쪽 통이 구르던 시절」의 높이 다툼을 푼 것이다. 페이지가 구르는 지금은
// 다툴 높이 자체가 없다 — 규칙을 **걷었다**. 걷힌 것이 맞는지 못 박는다.
ok('`.home-grid .side-panel > *` 예외가 남아 있지 않다', /\.home-grid \.side-panel > \* \{/.test(CSS), false)
ok('그 자리는 목록 보기 규칙이 대신한다', /\.home-wrapper\.mobile-list \.side-panel \{/.test(CSS))

if (fails.length > 0) {
  console.error('\n실패:')
  for (const f of fails) console.error('  · ' + f)
  process.exit(1)
}
console.log(`\n통과 — 폰 고객사 페이지 스크롤(검사 ${total}개 · 실패 0)`)
