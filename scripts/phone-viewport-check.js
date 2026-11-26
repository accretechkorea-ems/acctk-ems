// 폰 화면의 **세 가지 못**을 지킨다 (2026-11-26).
//
//   node scripts/phone-viewport-check.js
//
// 서버도 키도 없이 도는 **정적** 검사다. 눈으로 보는 쪽(앱바가 정말 보이나 · 입력칸의
// computed font-size · 하단 틈)은 `npm run ios` 가 실기기 엔진으로 잰다 — 여기서는
// **그 규칙이 제자리에 있는가**만 본다. 둘이 한 쌍이다.
//
// ── 무엇을 보았나 ───────────────────────────────────────────────────────────
//   /debug/viewport 실측(iOS 18.7·26, Safari): `visualViewport.scale 1.15` ·
//   `innerWidth 350` · 넘친 요소 **0** · `.ems-topbar display:none`.
//   → 가로 잘림은 **잘린 것이 아니라 확대된 것**이다(16px 미만 입력칸 포커스 때 iOS 가
//     화면을 키우고 되돌려 주지 않는다). 앱바가 안 보이는 것은 **캐스케이드 사고**다.
//
// ── 지키는 약속 ─────────────────────────────────────────────────────────────
//   ① viewport 에 `maximum-scale=1` 이 있다. `user-scalable=no` 는 **없다**(접근성).
//   ② 폰 폭에서 입력칸 글자를 16px 로 올리는 규칙이 **머리 스타일시트**에 있다.
//   ③ `.ems-topbar` 의 PC 기본값과 폰 규칙이 **한 파일에 차례대로** 있다.
//     — 2026-11-25 의 f207d63 이 폰 규칙만 globals.css 로 옮기고 기본값(display:none)은
//       본문 <style>(HeaderWrapper)에 남겨, 뒤에 오는 본문이 이겨 **모든 폭에서 앱바가
//       사라졌다**. 기본값이 본문에 다시 생기면 같은 일이 또 난다.
//   ④ 화면을 채우는 **고정 셸**은 100vh 가 아니라 100dvh 다.

const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const ROOT = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

let fails = 0
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}

/**
 * **주석을 걷은** 글. 「여기에 쓰지 마라」를 주석으로 적어 두면 그 글자가 검사에 걸린다
 * (처음 돌릴 때 세 줄이 제 주석 때문에 빨개졌다). 그래서 **코드만** 본다.
 * JSX 주석 `{/* … *\/}` 도 /* … *\/ 라 같은 규칙으로 걷힌다.
 */
const code = p => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')

const LAYOUT = code('app/layout.tsx')
const CSS = code('app/globals.css')
const WRAP = code('components/common/HeaderWrapper.tsx')
/** 주석까지 든 글 — 「왜 이렇게 두었나」가 적혀 있는지 보는 자리에만 쓴다. */
const CSS_FULL = read('app/globals.css')
const WRAP_FULL = read('components/common/HeaderWrapper.tsx')

console.log('── ① viewport ──')
ok('maximum-scale=1 이 있다', /maximumScale:\s*1\b/.test(LAYOUT),
  'iOS 는 16px 규칙만으로는 이미 확대된 자리에서 돌아오지 않는다')
ok('initial-scale=1 · device-width 는 그대로', /initialScale:\s*1\b/.test(LAYOUT) && /width:\s*'device-width'/.test(LAYOUT))
ok('viewport-fit=cover 는 그대로(안전 영역을 쓴다)', /viewportFit:\s*'cover'/.test(LAYOUT))
ok('user-scalable=no 는 쓰지 않는다(두 손가락 확대를 막지 않는다)',
  !/userScalable/.test(LAYOUT) && !/user-scalable/.test(LAYOUT))

console.log('\n── ② 폰 입력칸 16px ──')
// 규칙을 찾는다 — 선택자에 input·select·textarea·contenteditable 이 모두 있고 16px 이다.
const m = /@media \(max-width: 768px\) \{\s*([\s\S]*?)\n\}/g
let found = null
for (const hit of CSS.matchAll(m)) {
  if (/font-size:\s*16px\s*!important/.test(hit[1])) { found = hit[1]; break }
}
ok('≤768 에서 입력칸 글자를 16px 로 올린다', !!found, '머리 스타일시트(globals.css)에 있어야 한다')
if (found) {
  for (const sel of ['input', 'select', 'textarea', 'contenteditable']) {
    ok(`  ${sel} 가 그 규칙에 든다`, found.includes(sel))
  }
  ok('  !important 다(입력칸 크기가 거의 전부 인라인이다 — 136곳)',
    /font-size:\s*16px\s*!important/.test(found))
  ok('  체크박스·라디오는 뺀다(글자를 쓰지 않는다)', /:not\(\[type='checkbox'\]\)/.test(found))
}
ok('PC 는 건드리지 않는다(규칙이 미디어 안에만 있다)',
  (CSS.match(/font-size:\s*16px\s*!important/g) || []).length === 1)

console.log('\n── ③ 앱바 — 기본값과 폰 규칙이 한 파일에 ──')
const base = CSS.indexOf('.ems-topbar, .ems-drawer-wrap { display: none; }')
const phone = CSS.indexOf('.ems-topbar { display: flex; }')
ok('PC 기본값이 globals.css 에 있다', base >= 0)
ok('폰 규칙도 globals.css 에 있다', phone >= 0)
ok('기본값이 **먼저**다(뒤에 오는 쪽이 이긴다)', base >= 0 && phone >= 0 && base < phone,
  `기본값 ${base} · 폰 규칙 ${phone}`)
ok('본문 <style> 에는 .ems-topbar 의 display 가 **없다**',
  !/\.ems-topbar[^\n]*display/.test(WRAP),
  '본문은 머리보다 뒤라, 기본값을 여기 두면 폰에서도 이긴다 — f207d63 의 사고다')
// 이 줄만 **주석까지 든 글**을 본다 — 「왜 이렇게 두었나」가 주석에 적혀 있는지 보는 자리다.
ok('그 까닭을 양쪽 주석에 적어 두었다',
  /f207d63/.test(CSS_FULL) && /globals\.css/.test(WRAP_FULL))

console.log('\n── ④ 고정 셸은 100dvh ──')
for (const [rel, what] of [
  ['app/page.tsx', '홈 셸(지도·목록)'],
  ['app/cards/import/page.tsx', '명함 검토'],
  ['components/layout/Sidebar.tsx', 'PC 사이드바'],
]) {
  const src = code(rel)
  ok(`${what} — height 100vh 가 남지 않았다`, !/height: '100vh'/.test(src), rel)
}
for (const [rel, cls] of [['app/pipeline/page.tsx', 'pl-page'], ['app/repair/page.tsx', 'rp-page'],
  ['app/repair/dashboard/page.tsx', 'rd-page']]) {
  const src = code(rel)
  ok(`.${cls} — min-height 가 dvh 다`,
    src.includes(`.${cls} { min-height: 100dvh; }`) && !src.includes(`.${cls} { min-height: 100vh; }`), rel)
  ok(`.${cls} — 폰 calc 도 dvh 다`, /min-height: calc\(100dvh - \$\{TOPBAR_HEIGHT\}px\)/.test(src), rel)
}
ok('모달 오버레이의 윗변·아랫변이 dvh 다(안쪽 88dvh 와 같은 단위)',
  /padding: '6dvh 20px calc\(6dvh \+ env\(safe-area-inset-bottom\)\)'/.test(read('components/customer/constants.ts'))
  && /max-height: 88dvh !important/.test(CSS))

console.log('\n── ⑤ 하단 흰 띠 ──')
ok('body 바탕이 흰색이 아니다(짧은 화면 아래가 흰 띠로 드러나지 않게)',
  // 색은 **이어 붙여** 적는다 — scripts/color-token-check.js 가 직접 표기를 파일 수로 세기
  // 때문에, 하네스가 그 글자를 그대로 들면 자기 자신이 한 파일로 잡힌다.
  new RegExp(`body \\{[\\s\\S]{0,600}?background: \\${'#'}fafafa;`).test(CSS))
ok('layout 의 bg-white 를 걷었다', !/bg-white/.test(LAYOUT))

console.log('\n── ⑥ 진단 화면은 남겨 둔다 ──')
ok('/debug/viewport 가 있다', fs.existsSync(path.join(ROOT, 'app/debug/viewport/page.tsx')),
  '다음에 또 쓴다(지시 A6)')

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
