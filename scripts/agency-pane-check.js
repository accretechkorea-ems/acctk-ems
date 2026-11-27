/**
 * 대리점 화면의 **거래 사업장 표**와 회사 화면의 **필터 기억** (2026-11-21).
 *
 * 지키는 약속
 *   ① 거래 사업장 = `agency_customer_id` 가 그 대리점인 줄 **전부**. 좌 패널의 필터는
 *     걸지 않는다(이 표는 「이 대리점이 어디와 거래하나」를 다 보여 주는 자리다).
 *   ② 「회사 » 사업장」의 앞말은 **부모 회사의 이름**이고, 사업장명은 그 이름을 뗀 나머지다.
 *   ③ 표 안 검색은 낱말을 **모두** 포함해야 남는다(「일진 제천」으로 찾을 수 있게).
 *   ④ 어느 정렬이든 마지막 가름은 **이름**이다 — 같은 값끼리 자리가 흔들리면 187줄에서
 *     찾던 줄을 다시 잃는다. 접점이 없는 줄은 최근 활동순에서 맨 아래다.
 *   ⑤ 제목 줄의 배지는 **그 대리점을 거친 견적**(dealer_id) 전체·진행이다.
 *   ⑥ 활동 이력 필터는 **떠날 때 상태 그대로** 되살아난다. 좁히지 않은 상태는 기억하지
 *     않고, 그 사이 없어진 사업장은 떨어낸다.
 */
const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const Module = load('module')
const ts = load('typescript')
const ROOT = path.resolve(__dirname, '..')

const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) request = path.join(ROOT, request.slice(2))
  return origResolve.call(this, request, ...rest)
}
require.extensions['.ts'] = (mod, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText
  mod._compile(out, filename)
}

const {
  buildAgencySites, filterAgencySites, sortAgencySites, agencyQuoteCounts, AGENCY_SORT_LABEL,
} = load(path.join(ROOT, 'lib', 'agencyPane.ts'))
const {
  TIMELINE_KINDS, allSelected, rememberFilter, recallFilter, clearFilterMemory,
} = load(path.join(ROOT, 'lib', 'timelineFilter.ts'))
const { PENDING_STATUS } = load(path.join(ROOT, 'lib', 'quoteStatus.ts'))

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const PANE = read(path.join('components', 'home', 'list', 'AgencyPane.tsx'))
const HOME = read(path.join('app', 'page.tsx'))
const PANEL = read(path.join('components', 'home', 'list', 'CustomerListPanel.tsx'))
const BAND = read(path.join('components', 'customer', 'HeaderBand.tsx'))
const TIMELINE = read(path.join('components', 'customer', 'ActivityTimeline.tsx'))

let fail = 0
const eq = (name, got, want) => {
  const okk = JSON.stringify(got) === JSON.stringify(want)
  if (okk) console.log(`OK   ${name}  got=${JSON.stringify(got)}`)
  else { fail++; console.error(`FAIL ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`) }
}
const ok = (name, cond, hint) => {
  if (cond) console.log(`OK   ${name}`)
  else { fail++; console.error(`FAIL ${name}${hint ? `  — ${hint}` : ''}`) }
}

// ── 재료 ──────────────────────────────────────────────────────────────────
const AGENCY = 1779          // 젠트
const OTHER = 387            // 이룸지텍
const COMPANY = { 11: '일진글로벌', 12: '오토인더스트리' }
const customers = [
  // 같은 회사의 두 사업장 — 번호는 값으로 센다(1·2·10공장)
  { customer_id: 1, company_name: '일진글로벌 제천10공장', site_name: '제천10공장', parent_customer_id: 11, agency_customer_id: AGENCY, status: '활성', address: '충북 제천시 어디', region1: '충북', region2: '제천시' },
  { customer_id: 2, company_name: '일진글로벌 제천2공장', site_name: '제천2공장', parent_customer_id: 11, agency_customer_id: AGENCY, status: '활성', address: '충북 제천시 어디', region1: '충북', region2: '제천시' },
  { customer_id: 3, company_name: '오토인더스트리 경주공장', site_name: '경주공장', parent_customer_id: 12, agency_customer_id: AGENCY, status: '잠재', address: '경북 경주시 어디', region1: '경북', region2: '경주시' },
  // 이름 없는 사업장 — 빨간 「입력 필요」로 알린다
  { customer_id: 4, company_name: '일진글로벌', site_name: null, parent_customer_id: 11, agency_customer_id: AGENCY, status: '활성', address: null, region1: null, region2: null },
  // 다른 대리점 · 직판 — 이 표에 들어오면 안 된다
  { customer_id: 5, company_name: '하나 사업장', site_name: '본사', parent_customer_id: 12, agency_customer_id: OTHER, status: '활성', address: '서울', region1: '서울', region2: null },
  { customer_id: 6, company_name: '직판 사업장', site_name: '본사', parent_customer_id: 12, agency_customer_id: null, status: '활성', address: '서울', region1: '서울', region2: null },
]
const touches = new Map([
  [1, { date: '2026-11-17', source: '서비스', actorId: 7 }],
  [2, { date: '2026-11-20', source: '견적', actorId: 7 }],
  [3, { date: '2026-11-17', source: '영업', actorId: 9 }],
  // 4 번은 접점이 없다
])
const devices = new Map([[1, 5], [2, 2], [3, 8], [4, 0]])
const quotes = new Map([[1, 2], [2, 0], [3, 2], [4, 0]])
const build = () => buildAgencySites({
  customers,
  agencyId: AGENCY,
  companyName: id => COMPANY[id] ?? null,
  deviceCount: id => devices.get(id) ?? 0,
  openQuotes: id => quotes.get(id) ?? 0,
  touchOf: id => touches.get(id) ?? null,
  today: '2026-11-21',
})

console.log('── ① 그 대리점의 사업장만 ──')
const rows = build()
eq('네 줄만 남는다(다른 대리점·직판 제외)', rows.map(r => r.customer.customer_id), [1, 2, 3, 4])
eq('② 회사명은 부모 이름', rows.map(r => r.companyName), ['일진글로벌', '일진글로벌', '오토인더스트리', '일진글로벌'])
eq('② 사업장명은 회사명을 뗀 나머지', rows.map(r => r.siteName), ['제천10공장', '제천2공장', '경주공장', ''])
eq('이름 없는 줄을 알린다', rows.map(r => r.needsName), [false, false, false, true])
// 지역이 없는 줄은 lib/customerList.ts 의 regionLabel2 가 「없음」을 돌려준다(회사 표와 같다).
eq('지역은 두 단계 · 없으면 「없음」', rows.map(r => r.region), ['충북 제천시', '충북 제천시', '경북 경주시', '없음'])
eq('장비·진행 견적은 받아 온 셈법 그대로', rows.map(r => [r.deviceCount, r.openQuotes]), [[5, 2], [2, 0], [8, 2], [0, 0]])
eq('며칠 전인지', rows.map(r => r.days), [4, 1, 4, null])

console.log('\n── ③ 표 안 검색 ──')
eq('회사명으로', filterAgencySites(rows, '오토').map(r => r.customer.customer_id), [3])
eq('사업장명으로', filterAgencySites(rows, '제천2').map(r => r.customer.customer_id), [2])
eq('낱말을 모두 포함해야 한다', filterAgencySites(rows, '일진 제천2').map(r => r.customer.customer_id), [2])
eq('지역으로', filterAgencySites(rows, '경북').map(r => r.customer.customer_id), [3])
eq('상태로', filterAgencySites(rows, '잠재').map(r => r.customer.customer_id), [3])
eq('맞는 것이 없으면 0줄', filterAgencySites(rows, '없는이름').length, 0)
eq('빈 검색어는 전부', filterAgencySites(rows, '   ').length, 4)

console.log('\n── ④ 세우기 ──')
eq('기준 넷', Object.keys(AGENCY_SORT_LABEL), ['touch', 'name', 'quotes', 'devices'])
eq('최근 활동순 — 접점 없는 줄은 맨 아래',
  sortAgencySites(rows, 'touch').map(r => r.customer.customer_id), [2, 3, 1, 4])
eq('같은 날은 이름으로 가른다(오토 < 일진)',
  sortAgencySites(rows, 'touch').slice(1, 3).map(r => r.companyName), ['오토인더스트리', '일진글로벌'])
eq('이름순 — 번호는 값으로 센다(2공장이 10공장보다 앞)',
  sortAgencySites(rows, 'name').map(r => r.customer.customer_id), [3, 4, 2, 1])
eq('진행 견적순 — 같으면 이름',
  sortAgencySites(rows, 'quotes').map(r => r.customer.customer_id), [3, 1, 4, 2])
eq('장비순', sortAgencySites(rows, 'devices').map(r => r.customer.customer_id), [3, 1, 2, 4])
eq('받은 배열을 바꾸지 않는다',
  (() => { const a = build(); sortAgencySites(a, 'name'); return a.map(r => r.customer.customer_id) })(), [1, 2, 3, 4])

console.log('\n── ⑤ 제목 줄의 배지 ──')
eq('진행 판정은 「견적중」', PENDING_STATUS, '견적중')
eq('전체·진행을 함께 센다',
  agencyQuoteCounts([{ status: '견적중' }, { status: '매출완료' }, { status: '견적중' }, { status: '실패' }], PENDING_STATUS),
  { all: 4, pending: 2 })
eq('한 건도 없으면 0·0', agencyQuoteCounts([], PENDING_STATUS), { all: 0, pending: 0 })

console.log('\n── 화면이 그 규칙을 쓰는가 ──')
// 고르는 길은 7차에서 openAgency 한 자리로 모았다(위 「배타」 묶음이 그 안을 본다).
ok('대리점을 누르면 화면이 열린다(거르지 않는다)', /onPickAgency=\{id => openAgency\(id\)\}/.test(HOME))
ok('옛 「대리점으로 거르기」는 없다 — 상태도, 걸린 줄 안내도',
  !/setAgencyFilterId/.test(HOME) && !/clearAgencyFilter/.test(HOME) && !/agencyFilterId/.test(PANEL),
  '거르기는 필터 모달의 대리점 조건이 맡는다(없앴다는 설명은 주석으로 남겨 둔다)')
ok('주소는 ?view=list&agency=ID', /url\.searchParams\.set\('agency', String\(selectedAgencyId\)\)/.test(HOME)
  && /const ag = Number\(q\.get\('agency'\)\)/.test(HOME))
ok('표는 조회를 더 하지 않는다(목록이 들고 있는 것을 쓴다)',
  /customers=\{customers\}/.test(HOME) && !/from\('customers'\)[\s\S]{0,40}\.select\(/.test(PANE),
  '대리점 한 줄을 고치는 update 는 있어도 된다 — 표를 읽는 select 가 없어야 한다')
ok('고른 대리점 줄을 켜 둔다', /background: on \? '#eff4ff' : 'transparent'/.test(PANEL))
ok('카드는 사업장 화면과 같은 틀', /<HeaderBand/.test(PANE))
ok('상단 카드는 줄지 않는다(큰 표 아래에서도)', /flex-shrink: 0/.test(BAND))
ok('표 안에서 구른다 · 스크롤 힌트', /<ScrollHints/.test(PANE) && /stable-scroll/.test(PANE))
ok('「담당 영역」 줄은 없다(DB 에 칸이 없다)', !/>담당 영역</.test(PANE),
  '칸이 생기면 그때 줄을 더한다(없다는 설명은 주석으로 남겨 둔다)')

console.log('\n── ⑥ 활동 이력 필터의 기억 ──')
clearFilterMemory()
const available = { kinds: TIMELINE_KINDS, siteIds: [1, 2, 3] }
const base = allSelected(TIMELINE_KINDS, [1, 2, 3])
eq('기억이 없으면 null', recallFilter(11, available), null)
rememberFilter(11, base, available)
eq('좁히지 않은 상태는 기억하지 않는다', recallFilter(11, available), null)
rememberFilter(11, { ...base, siteIds: [2] }, available)
eq('좁힌 것은 기억한다', recallFilter(11, available).siteIds, [2])
eq('다른 회사의 기억과 섞이지 않는다', recallFilter(12, available), null)
rememberFilter(11, { ...base, siteIds: [2], kinds: ['견적'] }, available)
eq('종류도 함께', [recallFilter(11, available).kinds, recallFilter(11, available).siteIds], [['견적'], [2]])
eq('그 사이 없어진 사업장은 떨어낸다 — 하나도 안 남으면 전부 고른 상태',
  recallFilter(11, { kinds: TIMELINE_KINDS, siteIds: [1, 3] }).siteIds, [1, 3])
rememberFilter(11, { ...base, from: '2026-01-01', to: '' }, available)
eq('기간도 기억한다', [recallFilter(11, available).from, recallFilter(11, available).to], ['2026-01-01', ''])
rememberFilter(11, base, available)
eq('다시 전부 고르면 기억을 지운다', recallFilter(11, available), null)
ok('화면이 그 기억을 쓴다',
  /recallFilter\(customerId, \{ kinds: TIMELINE_KINDS, siteIds \}\) \?\? base/.test(TIMELINE)
  && /rememberFilter\(customerId, filter, available\)/.test(TIMELINE))
// 2026-11-28(야간4 7-2) — ← 는 **들어온 곳**으로 간다(지도·다른 메뉴). 들어온 곳이
// 없으면 종전처럼 회사 pane 으로 올라간다. 어느 길에서도 칩은 걸지 않는다.
ok('사업장에서 돌아올 때 칩을 자동으로 걸지 않는다',
  /setSelectedSiteId\(null\)/.test(HOME) && !/setTimelineFocusSiteId\(selectedSiteId\)/.test(HOME),
  'setTimelineFocusSiteId 를 다시 넣지 말 것 — 돌아오면 한 사업장으로 좁혀진다')
ok('← 가 들어온 곳으로 간다', /if \(origin === 'map'\)/.test(HOME) && /origin\.startsWith\('\/'\)/.test(HOME))
ok('활동 현황에서 넘어온 길(?site=)은 그대로다',
  /setPendingFocusSiteId\(site\)/.test(HOME) && /setTimelineFocusSiteId\(site\)/.test(HOME))

console.log('\n── 회사·대리점·사업장 선택은 서로 배타다(2026-11-21 7차 버그) ──')
ok('고르는 길이 한 자리에 모여 있다',
  /const openCompany = \(id: number \| null\) => \{/.test(HOME)
  && /const openAgency = \(id: number \| null\) => \{/.test(HOME)
  && /const openSiteUnderCompany = \(companyId: number, siteId: number\) => \{/.test(HOME))
ok('회사를 고르면 대리점이 풀린다',
  /const openCompany[\s\S]{0,120}setSelectedAgencyId\(null\)/.test(HOME),
  '이 줄이 없으면 대리점 pane 이 그대로 남는다 — 그것이 그 버그였다')
ok('대리점을 고르면 회사가 풀린다',
  /const openAgency[\s\S]{0,120}setSelectedCompanyId\(null\)/.test(HOME))
ok('트리에서 사업장을 고르면 그 사업장의 회사가 뒤에 선다',
  /const openSiteUnderCompany[\s\S]{0,160}setSelectedAgencyId\(null\)[\s\S]{0,80}setSelectedCompanyId\(companyId\)/.test(HOME))
ok('pane 안에서 사업장을 열 때는 뒤를 건드리지 않는다(← 가 돌아갈 자리다)',
  /const openSite = \(siteId: number\) => setSelectedSiteId\(siteId\)/.test(HOME))
ok('트리·탭이 그 길만 쓴다',
  /onSelectCompany=\{id => openCompany\(id\)\}/.test(HOME)
  && /onSelectSite=\{\(cid, sid\) => openSiteUnderCompany\(cid, sid\)\}/.test(HOME)
  && /onPickAgency=\{id => openAgency\(id\)\}/.test(HOME))
ok('주소에는 하나만 남는다',
  /url\.searchParams\.delete\('company'\)\s*\n\s*url\.searchParams\.delete\('agency'\)\s*\n\s*if \(view === 'list' && selectedAgencyId != null\)[\s\S]{0,120}else if \(view === 'list' && selectedCompanyId != null\)/.test(HOME))
ok('주소에 둘이 함께 와도 하나만 받는다',
  /\} else if \(Number\.isInteger\(company\) && company > 0\) \{/.test(HOME))

// ── 상단 카드의 작은 규칙 셋(2026-11-21 6차) ──────────────────────────────
const SITE = read(path.join('components', 'customer', 'SiteHeaderBand.tsx'))
const PANE_CO = read(path.join('components', 'home', 'list', 'CompanyPane.tsx'))
const MEMO = read(path.join('components', 'common', 'MemoHoverText.tsx'))

console.log('\n── 상태 뱃지는 좌 칸 우상단에 붙어 있다 ──')
ok('흐름에서 빼 둔다(absolute)', /position: 'absolute', top: 0,/.test(BAND))
ok('세로선과의 여백은 12 — 칸 밖으로 6 만큼 내민다',
  /const COL_GAP = 18/.test(BAND) && /const STATUS_RULE_GAP = 12/.test(BAND)
  && /right: -\(COL_GAP - STATUS_RULE_GAP\)/.test(BAND))
// 2026-11-25 — 오른쪽 끝(0)은 우상단 ✎ 와 겹쳐 「활성」 글자가 잘렸다(390 실측). 연필 왼쪽으로 뺀다.
ok('폰에서는 ✎ 를 피해 그 왼쪽에 선다', /\.band-status \{ right: 40px !important \}/.test(BAND))
ok('두 화면이 상태를 넘겨 준다',
  /status=\{customer\?\.status\}/.test(SITE) && /status=\{agency\.status\}/.test(PANE))
ok('제목 줄은 뱃지 자리만큼 비워 둔다(경고 태그가 길어도 글자가 밑으로 흐르지 않게)',
  /paddingRight: STATUS_RESERVE/.test(SITE) && /paddingRight: STATUS_RESERVE/.test(PANE))
ok('제목 줄 흐름에 상태 dot 를 다시 넣지 않았다',
  !/background: dot \}/.test(SITE), 'HeaderBand 가 한 곳에서 그린다')

console.log('\n── 사업장 표 머리줄에는 숫자가 없다 ──')
// 2026-11-26 — 머리줄(「사업장」)을 아예 걷었다. 바로 위 타일에 「사업장 N곳」이 있고
// 표의 첫 열 이름도 「사업장명」이라 같은 말이 세 번이었다(더하는 길은 회사 카드의 ＋).
ok('머리줄을 걷었다', !/>사업장<\/b>/.test(PANE_CO),
  '제목을 다시 두려면 이 줄도 함께 고친다')
ok('「활동 이력」의 건수는 그대로(필터 적용 건수라 타일과 다르다)',
  /title="활동 이력"/.test(PANE_CO))

console.log('\n── 메모는 남는 높이만큼 줄바꿈한다 ──')
ok('담당자 줄을 재서 줄 수를 셈한다',
  /const avail = TOP_CARD_HEIGHT - 14 - 12 - row\.getBoundingClientRect\(\)\.height - 10/.test(BAND)
  && /setMemoLines\(Math\.max\(1, Math\.floor\(\(avail \+ 1\) \/ lh\)\)\)/.test(BAND))
ok('줄 높이는 재서 쓴다(글꼴이 바뀌어도 어긋나지 않게)',
  /parseFloat\(getComputedStyle\(memo\)\.lineHeight\)/.test(BAND))
ok('line-clamp 로 자른다', /WebkitLineClamp: memoLines > 0 \? memoLines : undefined/.test(BAND))
ok('폰에서는 전부 펼친다', /-webkit-line-clamp: unset !important/.test(BAND))
ok('넘칠 때만 호버로 전체를 본다',
  /setMemoOver\(memo\.scrollHeight > memo\.clientHeight \+ 1\)/.test(BAND)
  && /hover=\{memoOver\}/.test(BAND))
ok('판을 쓰지 않을 때는 손을 받지 않는다', /if \(!hover\) \{/.test(MEMO))
ok('재는 ref 는 함수로 받는다(prop 의 .current 를 고치지 않는다)',
  /textRef\?: \(el: HTMLSpanElement \| null\) => void/.test(MEMO))

console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`)
process.exit(fail === 0 ? 0 : 1)
