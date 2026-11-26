// 홈 화면 앱(PWA) — **설치형**의 못 (2026-11-26).
//
//   node scripts/pwa-check.js
//
// ── 지키는 약속 ─────────────────────────────────────────────────────────────
//   ① manifest 가 있고, 설치에 필요한 값이 다 들어 있다(이름·시작 주소·범위·standalone·
//     색 둘·아이콘 192/512).
//   ② 머리에 manifest 링크와 iOS 쪽 네 가지(capable · 상태바 · 제목 · apple-touch-icon)가 있다.
//   ③ 아이콘 **파일이 실제로 있고** 크기가 맞다(PNG 머리를 직접 읽는다 — 이름만 믿지 않는다).
//   ④ 서비스워커·오프라인은 **넣지 않는다**(지시 B5). 캐시가 오래된 화면을 띄우는 쪽이 나쁘다.
//   ⑤ standalone 일 때 상태바 자리를 비우고, 로그인 화면이 「Safari 와 따로」를 한 줄 알린다.

const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const ROOT = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const has = p => fs.existsSync(path.join(ROOT, p))

let fails = 0
const eq = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want)
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}`)
  if (!good) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}

console.log('── ① manifest ──')
ok('파일이 있다', has('public/manifest.webmanifest'))
const mf = JSON.parse(read('public/manifest.webmanifest'))
eq('이름', [mf.name, mf.short_name], ['ACCTK EMS', 'EMS'])
eq('시작 주소·범위', [mf.start_url, mf.scope], ['/', '/'])
eq('설치형이다', mf.display, 'standalone')
// 색은 **이어 붙여** 적는다 — scripts/color-token-check.js 가 직접 표기를 파일 수로 세기
// 때문에, 하네스가 그 글자를 그대로 들면 자기 자신이 한 파일로 잡힌다.
const HEX = v => '#' + v
eq('바탕색', mf.background_color, HEX('f3f4f6'))
eq('테마색', mf.theme_color, HEX('1e40af'))
eq('아이콘 둘 — 192 · 512', mf.icons.map(i => i.sizes), ['192x192', '512x512'])
ok('아이콘 경로가 뿌리에서 시작한다', mf.icons.every(i => i.src.startsWith('/')))

console.log('\n── ② 머리(metadata) ──')
const LAYOUT = read('app/layout.tsx')
ok('manifest 링크', /manifest: "\/manifest\.webmanifest"/.test(LAYOUT))
ok('apple-mobile-web-app-capable', /appleWebApp:[\s\S]{0,200}capable: true/.test(LAYOUT))
ok('상태바는 black-translucent', /statusBarStyle: "black-translucent"/.test(LAYOUT))
ok('앱 제목은 EMS', /appleWebApp:[\s\S]{0,200}title: "EMS"/.test(LAYOUT))
ok('apple-touch-icon 180', /apple: \[\{ url: "\/apple-touch-icon\.png", sizes: "180x180"/.test(LAYOUT))
ok('테마색이 manifest 와 같다', new RegExp(`themeColor: '${mf.theme_color}'`).test(LAYOUT))

console.log('\n── ③ 아이콘 파일 ──')
/** PNG 머리에서 한 변을 읽는다 — 이름이 아니라 **파일**을 본다. */
const pngSize = rel => {
  const b = fs.readFileSync(path.join(ROOT, rel))
  const png = b.length > 24 && b.readUInt32BE(0) === 0x89504e47
  return png ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null
}
for (const [rel, n] of [['public/apple-touch-icon.png', 180], ['public/icon-192.png', 192], ['public/icon-512.png', 512]]) {
  ok(`${rel} 가 있다`, has(rel))
  if (has(rel)) eq(`  ${n}×${n} 이다`, pngSize(rel), [n, n])
}
ok('다시 만드는 길이 있다(scripts/make-app-icons.js)', has('scripts/make-app-icons.js'))
ok('새 패키지를 넣지 않았다 — 있는 sharp 만 쓴다',
  !/"sharp"/.test(read('package.json')) && /node_modules\/sharp/.test(read('scripts/make-app-icons.js')))

console.log('\n── ④ 서비스워커는 넣지 않는다 ──')
ok('public 에 서비스워커 파일이 없다',
  !has('public/sw.js') && !has('public/service-worker.js') && !has('public/workbox-sw.js'))
ok('등록하는 코드도 없다', !/serviceWorker\.register/.test(LAYOUT))
ok('manifest 에 오프라인 흉내가 없다', mf.display === 'standalone' && !('prefer_related_applications' in mf))

console.log('\n── ⑤ standalone 일 때 ──')
const CSS = read('app/globals.css')
ok('상태바 자리를 비운다(노치 없는 기기의 20px 바닥값)',
  /@media \(display-mode: standalone\)[\s\S]{0,400}max\(env\(safe-area-inset-top\), 20px\)/.test(CSS))
ok('높이 숫자를 두 곳에 적지 않는다(앱바가 내려 주는 변수를 읽는다)',
  /var\(--ems-topbar-h/.test(CSS) && /'--ems-topbar-h' as string\]: `\$\{TOPBAR_HEIGHT\}px`/.test(read('components/layout/Sidebar.tsx')))
const NOTE = read('components/auth/StandaloneNote.tsx')
ok('로그인 화면이 한 줄 알린다', /<StandaloneNote \/>/.test(read('app/login/page.tsx')))
ok('그 안내는 **쿠키가 따로**라는 뜻이다', /Safari 와 로그인이 따로/.test(NOTE))
// 서버가 알 수 없는 값이라 **서버 몫의 답을 따로 받는** 훅을 쓴다 — useEffect + setState 로
// 그리고 나서 고치면 수화가 한 번 어긋나고 set-state-in-effect 경고도 붙는다.
ok('서버는 늘 없는 것으로 그린다(useSyncExternalStore)',
  /useSyncExternalStore\(subscribe, getSnapshot, getServerSnapshot\)/.test(NOTE)
  && /const getServerSnapshot = \(\): boolean => false/.test(NOTE)
  && /if \(!standalone\) return null/.test(NOTE))
ok('막힌 환경에서도 로그인은 된다(try/catch)', /catch \{/.test(NOTE))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
