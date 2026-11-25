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
const hideRoots = [
  ['app/page.tsx', HOME], ['app/quote/page.tsx', QUOTE],
  ['components/customer/CustomerDetailBody.tsx', BODY], ['app/globals.css', CSS],
].flatMap(([name, src]) => (src.match(/overflow-x:\s*hidden/g) ?? []).map(() => name))
eq('overflow-x: hidden 을 쓰는 자리', hideRoots, ['app/page.tsx'])

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

console.log('\n── ⑥ 사업장 상세(폰) ──')
ok('앱바 아래 12px 뒤 카드', /\.site-page \{ padding: 12px !important; \}/.test(BODY))
ok('담당자는 세로 목록', /\.chip-list \{[\s\S]{0,120}flex-direction: column !important/.test(BAND))
ok('칩이 가로로 넘치지 않는다 — 한 칸이 한 줄을 쓴다', /\.chip-c \{[\s\S]{0,160}width: 100%/.test(BAND))
ok('아랫줄에 전화·이메일', /\.chip-c \.chip-contact \{ flex-basis: 100%/.test(BAND)
  && /\.chip-mail \{ display: inline-block !important \}/.test(BAND))
ok('「＋ 담당자」가 목록 아래 늘 보인다',
  /className="contact-add-wide"/.test(BAND) && /\.contact-add-wide \{ display: flex !important \}/.test(BAND))
ok('폰에서는 더보기·＋ 아이콘을 쓰지 않는다', /\.chip-more, \.pane-band \.chip-add \{ display: none !important \}/.test(BAND))
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
ok('윗변 6vh 그대로', /\.ems-modal-overlay \{\s*padding: 6vh 0 env\(safe-area-inset-bottom\) !important;/.test(CSS))
ok('입력칸 40px 이상', /\.ems-modal-card input[\s\S]{0,180}min-height: 40px;/.test(CSS))
ok('전체 화면 시트로 늘리지 않는다', !/min-height: 100dvh;/.test(CSS))
ok('고정 하단 바는 홈바만큼 띄운다',
  CSS.includes('.ems-bulk-bar {') && /padding-bottom: calc\(9px \+ env\(safe-area-inset-bottom/.test(CSS))

// ── --live : 실제로 390 에서 재 본다(서버 3100 + .env.local 이 있을 때만) ──
if (process.argv.includes('--live')) {
  console.log('\n── (--live) 390px 실측 ──')
  console.log('   이 하네스는 글자만 본다 — 실제 측정은 scripts 밖의 측정 스크립트가 한다.')
  console.log('   (운영 자료 로그인이 필요해 CI 에 둘 수 없다. 방법은 보고에 적어 둔다.)')
}

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
