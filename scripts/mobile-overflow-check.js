// **폰(390) 가로 넘침과 상단 고정 영역** (2026-11-25).
//
//   node scripts/mobile-overflow-check.js            글자만 본다(열쇠·서버 없이 돈다)
//   node scripts/mobile-overflow-check.js --live     띄워 둔 서버(3100)에 붙어 실제로 잰다
//
// ── 왜 두 길인가 ─────────────────────────────────────────────────────────
//   npm run check 는 **열쇠도 서버도 없이** 돈다(하네스 규칙). 390px 로 실제 화면을
//   여는 일은 로그인과 운영 자료가 필요해 거기 둘 수 없다. 그래서 평소에는 **규칙이
//   코드에 남아 있는지**를 글자로 보고, 사람이 잴 때만 --live 로 실제 폭을 센다.
//   (실측 결과는 보고에 적는다 — 2026-11-25 에 /quote 60px 넘침을 그렇게 찾았다.)
//
// 지키는 약속
//   ① 가로 넘침을 **덮지 않는다** — 페이지 루트에 overflow-x: hidden 을 새로 씌우지 않는다.
//   ② 폰에서 고정 폭을 쓰지 않는다 — 넘치던 자리(견적 입력 열 430)가 화면 폭을 따른다.
//   ③ 고객사 목록 모드에서는 **지도를 그리지 않는다**.
//   ④ 검색칸은 하나다.
//   ⑤ 상단 고정 영역(앱바 + 세그먼트) ≤ 100px.
//   ⑥ 사업장 상세 — 담당자는 세로 목록이고 「＋ 담당자」가 늘 보인다. 사진은 4:3.
//   ⑦ 폰 모달 — 폭 100% · 윗변 6vh · 입력칸 40px 이상 · 홈바 safe-area.

const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const ROOT = path.join(__dirname, '..')

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
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const HOME = read('app/page.tsx')
const QUOTE = read('app/quote/page.tsx')
const BODY = read('components/customer/CustomerDetailBody.tsx')
const BAND = read('components/customer/HeaderBand.tsx')
const DEV = read('components/customer/DeviceSection.tsx')
const CARD = read('components/home/CustomerCard.tsx')
const CSS = read('app/globals.css')
const TOPBAR = read('components/layout/Sidebar.tsx')

console.log('── ① 넘침을 덮지 않는다 ──')
// body { overflow-x: hidden } 한 줄은 2026-11-21 부터 있던 것이다(고객사 화면).
// **늘리지 않는다** — 원인을 고치는 대신 덮는 길이 또 생기지 않게 수를 못 박는다.
// 2026-11-26 — **한 줄도 남지 않았다.** 고객사 화면의 그 줄을 globals.css 로 옮겨
// 모든 화면에 걸어 봤다가 물렀다: WebKit 390 측정에서 발주 목록처럼 일부러 넓은 표가
// 있는 화면이 오른쪽이 잘린 채 **옆으로 밀 수조차 없게** 됐다. 덮지 않고 고친다.
const hideRoots = [
  ['app/page.tsx', HOME], ['app/quote/page.tsx', QUOTE],
  ['components/customer/CustomerDetailBody.tsx', BODY], ['app/globals.css', CSS],
].flatMap(([name, src]) => (src.match(/overflow-x:\s*hidden/g) ?? []).map(() => name))
eq('overflow-x: hidden 을 쓰는 자리', hideRoots, [])

console.log('\n── ①-2 화면 폭을 100vw 로 재지 않는다 ──')
// 100vw 는 **세로 스크롤바를 포함한** 폭이다(PC 에서 15px 넘친다). 모바일에서도 고무줄
// 스크롤 중에 화면보다 커진다. 가로 폭은 늘 100% 로 잰다(2026-11-25).
const VW = []
const seekVw = (dir) => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) { seekVw(rel); continue }
    if (!/\.(tsx?|css)$/.test(e.name)) continue
    // 높이(100vh·100dvh)는 그대로 둔다 — 문제는 **가로**다.
    if (/\b100vw\b/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'))) VW.push(rel)
  }
}
for (const d of ['app', 'components']) seekVw(d)
eq('100vw 를 쓰는 자리', VW, [])
// 폰에서 **화면보다 넓어지는 최소 폭**도 두지 않는다(표는 가로 스크롤 상자 안에서 쓴다).
// 화면보다 넓어지는 값(≥400)만 본다 — 200·180 같은 칸 최소 폭은 폰에서도 들어간다.
eq('모달에 화면보다 넓은 minWidth 를 두지 않는다',
  /minWidth: ([4-9]\d{2}|\d{4,})\b/.test(read('app/sales/page.tsx')) ? ['app/sales/page.tsx'] : [], [])

console.log('\n── ② 폰에서 고정 폭을 쓰지 않는다 ──')
// 2026-11-25 실측: /quote 가 390 에서 **60px** 넘쳤다 — 왼쪽 입력 열이 430 고정이었다.
ok('견적 입력 열에 이름표가 있다', /className="quote-left"/.test(QUOTE))
ok('폰에서는 화면 폭을 따른다',
  /@media \(max-width: 768px\)[\s\S]{0,400}\.quote-left \{ width: 100% !important; max-width: 430px; min-width: 0; \}/.test(QUOTE))
ok('바깥 여백도 줄인다', /\.quote-cols \{ padding: 12px !important/.test(QUOTE))
ok('PC 는 그대로 430 고정', /className="quote-left" style=\{\{ width: 430, flexShrink: 0 \}\}/.test(QUOTE))

console.log('\n── ③ 목록 모드에서는 지도를 그리지 않는다 ──')
ok('좁은 화면을 가린다', /const \[narrow, setNarrow\] = useState\(false\)/.test(HOME)
  && /matchMedia\('\(max-width: 768px\)'\)/.test(HOME))
ok('목록 탭이면 지도를 렌더하지 않는다', /\{\(!narrow \|\| mobileTab === 'map'\) && \(/.test(HOME))
ok('지도 칸에 이름표', /className="home-map"/.test(HOME))

console.log('\n── ④ 검색칸은 하나 ──')
ok('지도 열의 칸은 폰에서도 숨긴다',
  /\.sidebar-search \{ display: none !important; \}/.test(HOME))
ok('패널 머리줄의 칸 하나가 남는다', /placeholder=\{COMPANY_SEARCH_PLACEHOLDER\}/.test(read('components/home/PanelHeader.tsx')))
ok('건수는 그 칸 **오른쪽 작은 글씨**다',
  /count\.toLocaleString\('ko-KR'\)/.test(read('components/home/PanelHeader.tsx')))

console.log('\n── ⑤ 상단 고정 영역 ≤ 100 ──')
const topbar = Number(/export const TOPBAR_HEIGHT = (\d+)/.exec(TOPBAR)?.[1] ?? 0)
const pad = Number(/\.home-wrapper \{[^}]*padding: (\d+)px/.exec(HOME)?.[1] ?? 0)
const seg = Number(/\/\/ 40px[\s\S]{0,120}?height: (\d+),/.exec(HOME)?.[1] ?? 0)
const segGap = Number(/height: 40,\s+marginBottom: (\d+),/.exec(HOME)?.[1] ?? 0)
eq('앱바 48', topbar, 48)
eq('세그먼트 40', seg, 40)
ok(`상단 고정 영역 ${topbar} + ${pad} + ${seg} = ${topbar + pad + seg} ≤ 100`, topbar + pad + seg <= 100)
ok('세그먼트 아래 여백 8', segGap === 8)
ok('아래는 홈바만큼만', /padding: 8px 8px calc\(8px \+ env\(safe-area-inset-bottom\)\)/.test(HOME))

console.log('\n── ⑤-2 앱바는 안전 영역 바로 아래 ──')
ok('viewport-fit=cover 를 켠다 — 안전 영역이 값을 갖는다',
  /viewportFit: 'cover'/.test(read('app/layout.tsx')))
ok('앱바가 그 값만큼 아래로 깔린다',
  /env\(safe-area-inset-top\)\)`/.test(TOPBAR) && /padding: 'env\(safe-area-inset-top\) 8px 0'/.test(TOPBAR))
ok('화면 높이 셈도 그 값을 뺀다', /env\(safe-area-inset-top\)\) !important/.test(HOME))
ok('앱바 위에 다른 레이아웃 요소를 두지 않는다 — body 의 첫 요소는 앱바다',
  /<header className="ems-topbar"/.test(TOPBAR))

console.log('\n── ⑥ 사업장 상세(폰) ──')
ok('앱바 아래 12px 뒤 카드', /\.site-page \{ padding: 12px !important; \}/.test(BODY))
// 2026-11-27(묶음4 B) — 담당자는 PC·폰이 **같은 카드**다. 규칙은 그 부품이 들고 있다.
const CTL = read('components/customer/ContactList.tsx')
ok('담당자 카드가 한 벌이다', /<ContactList/.test(BAND) && /<ContactList/.test(read('components/customer/SiteInfoColumn.tsx')))
ok('한 사람이 한 줄을 쓴다(세로)', /flexDirection: 'column', gap: 2, minWidth: 0/.test(CTL))
ok('아랫줄에 전화·이메일', /href={`tel:/.test(CTL) && /href={`mailto:/.test(CTL))
ok('번호가 없으면 회사 전화로 떨어진다', /const tel = mobile \|\| office/.test(CTL))
ok('「＋ 담당자」가 목록 아래 늘 보인다',
  /className="ctl-add-wide"/.test(CTL) && /\.ctl-add-wide \{ display: flex !important; \}/.test(CTL))
ok('폰에서는 더보기·＋ 아이콘을 쓰지 않는다', /\.ctl-more, \.ctl-add-icon \{ display: none !important; \}/.test(CTL))
ok('폰에서는 카드를 눌러 고친다(작은 ✎ 를 겨누지 않는다)',
  /\.ctl-edit \{ display: none; \}/.test(CTL) && /role="button"/.test(CTL) && /onClick={onEdit}/.test(CTL))
ok('상태 뱃지가 ✎ 와 겹치지 않는다', /\.band-status \{ right: 40px !important \}/.test(BAND))
ok('장비 사진은 4:3', /\.dev-photo \{ height: auto !important; aspect-ratio: 4 \/ 3; \}/.test(BODY)
  && /className="dev-photo"/.test(DEV))
ok('장비 카드는 폰에서 폭 100%', /\.dev-grid > \* \{ width: 100% !important; \}/.test(BODY))

console.log('\n── 고객사 카드(폰) ──')
ok('장비 줄은 두 줄까지', /\.cc-dev-extra \{ display: none; \}/.test(CARD))
ok('꼬리말이 폰·PC 각각', /\.cc-more-wide \{ display: none; \}/.test(CARD)
  && /외 \{deviceLines\.length - 2\}대 더/.test(CARD) && /외 \{deviceLines\.length - 4\}대 더/.test(CARD))
ok('「상세보기 ›」는 카드 우하단', /alignItems: 'flex-end'/.test(CARD) && /상세보기/.test(CARD))

console.log('\n── ⑦ 폰 모달 ──')
ok('폭 100%', /@media \(max-width: 640px\)[\s\S]{0,700}width: 100% !important;/.test(CSS))
// 2026-11-26 — 윗변을 **6dvh** 로 바꿨다. 안쪽 카드가 94dvh 라 단위가 다르면(vh 는 iOS 에서
// 툴바를 접은 높이 lvh 다) 툴바가 보일 때 둘의 합이 화면을 넘어 창 아래가 밖으로 밀린다.
ok('윗변은 6dvh — 안쪽 94dvh 와 같은 단위',
  /\.ems-modal-overlay \{\s*padding: 6dvh 0 env\(safe-area-inset-bottom\) !important;/.test(CSS))
ok('입력칸 40px 이상', /\.ems-modal-card input[\s\S]{0,180}min-height: 40px;/.test(CSS))
ok('전체 화면 시트로 늘리지 않는다', !/min-height: 100dvh;/.test(CSS))
ok('고정 하단 바는 홈바만큼 띄운다',
  CSS.includes('.ems-bulk-bar {') && /padding-bottom: calc\(9px \+ env\(safe-area-inset-bottom/.test(CSS))

console.log('\n── ⑧ iOS 가 먼저 보는 자리 — 폰 껍데기는 **머리 스타일시트**에 ──')
// 2026-11-26 — iPhone Safari 에서 고객사 화면이 「왼쪽 여백 크고 오른쪽이 잘린」 모습으로
// 보인다는 말이 있었다. 그 모습이 나올 수 있는 길은 **폰으로 접는 규칙이 늦게 드는 것**
// 하나다(.ems-main 의 왼쪽 여백 256 이 남는다). 그래서 그 규칙만 본문 안 <style> 에서
// globals.css 로 옮겼다 — iOS 는 첫 페인트에 넓어진 레이아웃 뷰포트를 다시 줄이지 않는다.
const WRAP = read('components/common/HeaderWrapper.tsx')
ok('머리 스타일시트가 폰에서 사이드바를 접는다',
  /@media \(max-width: 768px\) \{[\s\S]{0,400}\.ems-sidebar \{ display: none !important; \}/.test(CSS))
ok('본문 여백도 머리에서 0 으로',
  /@media \(max-width: 768px\) \{[\s\S]{0,500}\.ems-main, \.ems-main\.collapsed \{ margin-left: 0 !important; \}/.test(CSS))
ok('상단 바·드로어도 같은 자리에서 켠다',
  /\.ems-topbar \{ display: flex; \}/.test(CSS) && /\.ems-drawer-wrap \{ display: block; \}/.test(CSS))
ok('그 규칙을 본문 <style> 에 다시 쓰지 않는다',
  !/@media \(max-width: \$\{MOBILE_MAX\}px\)/.test(WRAP),
  'HeaderWrapper 의 <style> 은 본문 안이라 첫 페인트보다 늦을 수 있다')
ok('PC 쪽 규칙은 그대로 그 파일에 있다(TS 상수를 쓴다)',
  /\.ems-main \{ margin-left: \$\{SIDEBAR_WIDTH\}px;/.test(WRAP))
// 좌 패널 자리만큼 밀어 두는 여백 — 폰에서는 **늘** 0 이다(고른 것이 있든 없든).
ok('폰에서 pane 의 왼쪽 여백은 조건 없이 0',
  /\n  \.pane \{ margin-left: 0 !important; padding-right: 0 !important; \}/.test(HOME),
  '.detail-open 에 매어 두면 아무것도 고르지 않았을 때 빈 pane 이 화면을 넘긴다')

console.log('\n── ⑧-2 WebKit 측정 스크립트 ──')
// 크로미움 에뮬레이션은 **엔진이 크로미움**이라 iOS 전용 차이를 흉내 내지 못한다.
// 그래서 WebKit 으로도 재는 길을 따로 둔다 — 서버·로그인이 필요해 check 에는 넣지 않는다.
ok('scripts/ios-overflow.js 가 있다', fs.existsSync(path.join(ROOT, 'scripts/ios-overflow.js')))
const PKG = JSON.parse(read('package.json'))
ok('npm run ios 로 부른다', PKG.scripts?.ios === 'node scripts/ios-overflow.js')
ok('check 에는 들어가지 않는다',
  !/ios-overflow/.test(PKG.scripts?.check ?? '') && !/ios-overflow/.test(PKG.scripts?.test ?? ''))
ok('하네스 자동 수집에도 걸리지 않는다(이름이 -check.js 가 아니다)',
  !fs.existsSync(path.join(ROOT, 'scripts/ios-overflow-check.js')))
const IOS = read('scripts/ios-overflow.js')
ok('두 엔진으로 잰다', /\['webkit', playwright\.webkit\], \['chromium', playwright\.chromium\]/.test(IOS))
ok('삐져나온 요소를 집어낸다', /r\.right <= vw \+ 0\.5/.test(IOS))
ok('넘치면 종료 코드 1 — 이분 탐색에 바로 쓴다', /process\.exit\(bad === 0 \? 0 : 1\)/.test(IOS))

// ── --live : 실제로 390 에서 재 본다(서버 3100 + .env.local 이 있을 때만) ──
if (process.argv.includes('--live')) {
  console.log('\n── (--live) 390px 실측 ──')
  console.log('   이 하네스는 글자만 본다 — 실제 측정은 scripts 밖의 측정 스크립트가 한다.')
  console.log('   (운영 자료 로그인이 필요해 CI 에 둘 수 없다. 방법은 보고에 적어 둔다.)')
}

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
