// 고객사 목록 보기(분할 보기)의 셈법 시험 — 묶기·거르기·세우기·경과일.
//
//   node scripts/customer-list-check.js
//
// 왜 따로 두는가 — 좌 패널의 「조건 일치 N곳 · 회사 N」과 우측 표의 줄은 **같은 셈법**
// 이어야 한다. 둘이 각자 세면 조용히 어긋나고, 그 어긋남은 화면을 한참 본 뒤에야 보인다.
// 그래서 셈법을 순수 함수로 떼어 두고(lib/customerList.ts) 그 규칙을 여기 못 박는다.

// eslint 의 no-require-imports 는 맨 require() 를 센다. node 로 직접 돌리는 CJS 라
// 그렇게 부를 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
      }, fileName: filename,
    }).outputText, filename)
  }
}
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(ROOT, req.slice(2))
  return origResolve.call(this, req, ...rest)
}

const L = load(path.join(ROOT, 'lib/customerList.ts'))
const { CATEGORY_OPTIONS } = load(path.join(ROOT, 'lib/constants.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

const TODAY = '2026-11-19'

console.log('── 경과일 ──')
eq('같은 날이면 0', L.daysSince('2026-11-19', TODAY), 0)
eq('사흘 전', L.daysSince('2026-11-16', TODAY), 3)
eq('백일 전', L.daysSince('2026-08-11', TODAY), 100)
eq('날짜가 없으면 null', L.daysSince(null, TODAY), null)
eq('기준은 90일', L.STALE_DAYS, 90)
eq('89일은 아직 아니다', L.isStale(89), false)
eq('90일부터 오래된 것', L.isStale(90), true)
eq('한 번도 접점이 없으면 오래된 것으로 본다', L.isStale(null), true)
eq('경과일 글자', [L.daysLabel(6), L.daysLabel(null)], ['6일', '-'])

console.log('\n── 사업장 짧은 이름 ──')
eq('site_name 이 있으면 그것',
  L.shortSiteName({ company_name: '네오오토 화성공장', site_name: '화성공장' }, '네오오토'), '화성공장')
eq('없으면 회사명을 떼고 남는 글자',
  L.shortSiteName({ company_name: '네오오토 아산공장', site_name: null }, '네오오토'), '아산공장')
// 「본사」로 적어 두던 것을 걷었다(2026-11-20) — 정말 본사인지, 이름을 안 적은 것인지
// 구별할 수 없었다. 빈 값은 빈 채로 두고 화면이 빨간 「입력 필요」로 알린다.
eq('떼고 나면 남는 게 없으면 빈 값',
  L.shortSiteName({ company_name: '쏠라딘', site_name: null }, '쏠라딘'), '')
eq('회사명과 아예 다르면 그 줄 이름을 쓴다(이관 전 표기)',
  L.shortSiteName({ company_name: '하이드로텍', site_name: null }, '㈜나노믹'), '하이드로텍')

console.log('\n── 이름이 겹치는 사업장 가려 주기 ──')
// 실측(2026-11-19): 사업장명이 겹치는 회사 227곳 · 사업장 742곳. 대개 site_name 이 비어
// 전부 「본사」로 떨어진다 — 그대로 두면 같은 줄이 나란히 서서 고를 수가 없다.
eq('주소 꼬리는 시도를 떼고 두 토막',
  L.addressHint('경남 진주시 정촌면 산업로 30'), '진주시 정촌면')
eq('주소가 한 토막이면 그대로', L.addressHint('서울'), '서울')
eq('주소가 없으면 빈 값', L.addressHint('  '), '')
{
  const row = (id, name, address) => ({ siteName: name, customer: { customer_id: id, address }, touch: null, days: null, deviceCount: 0, openQuotes: 0 })
  eq('겹치지 않으면 손대지 않는다',
    L.disambiguateSites([row(1, '화성공장', 'a'), row(2, '아산공장', 'b')]).map(s => s.siteName),
    ['화성공장', '아산공장'])
  eq('겹치면 주소 꼬리를 붙인다',
    L.disambiguateSites([
      row(1, '', '경남 진주시 정촌면 산업로 30'),
      row(2, '', '경기 화성시 동탄 1'),
    ]).map(s => s.siteName),
    // 이름이 비었으면 주소만 적는다 — 「 · 화성시」처럼 앞이 비지 않게.
    ['진주시 정촌면', '화성시 동탄'])
  // id 꼬리(#3014)는 뗐다 — 화면에서 아무 뜻도 없는 번호였다(2026-11-19).
  // 주소까지 같은 두 줄은 **합칠 후보**이고, 그 일은 사업장 병합이 맡는다.
  eq('주소까지 같으면 같은 글자로 둔다(합칠 후보다)',
    L.disambiguateSites([
      row(1, '울산공장', '경남 진주시 산업로 30'),
      row(2, '울산공장', '경남 진주시 산업로 30'),
    ]).map(s => s.siteName),
    ['울산공장 · 진주시 산업로', '울산공장 · 진주시 산업로'])
  eq('주소가 없는 줄도 번호를 붙이지 않는다',
    L.disambiguateSites([row(1, '', ''), row(2, '', '')]).map(s => s.siteName),
    ['', ''])
}

console.log('\n── 지역 ──')
// 거르는 값·보이는 값은 **정본 17 + 「없음」** 어휘만 쓴다(lib/region.ts).
eq('region1 이 있으면 그것', L.regionOf({ region1: '경기', address: '경기도 화성시 1' }), '경기')
eq('비면 주소에서 뽑는다', L.regionOf({ region1: '', address: '충남 아산시 둔포면' }), '충남')
eq('긴 이름도 약칭으로', L.regionOf({ region1: '경기도', address: null }), '경기')
eq('정본에 없는 값은 주소를 본다', L.regionOf({ region1: '남부', address: '울산광역시 북구 1' }), '울산')
eq('둘 다 없으면 「없음」', L.regionOf({ region1: null, address: null }), '없음')
// 화면에 찍는 값은 두 단계다(거르기는 여전히 시도 하나로 한다).
eq('화면 표시는 시·군·구까지', L.regionTextOf({ region1: '경기', region2: null, address: '경기도 화성시 동탄기흥로 590' }), '경기 화성시')

// ── 묶기 ─────────────────────────────────────────────────────────────────
const site = (id, name, extra = {}) => ({
  customer_id: id, company_name: name, site_name: null, address: '경기도 화성시 1',
  status: '활성', agency_name: null, category: null, region1: '경기',
  latitude: null, longitude: null, parent_customer_id: null, ...extra,
})
const companies = new Map([
  [100, { company_name: '네오오토', industry: '자동차 부품' }],
  [200, { company_name: '원익큐엔씨', industry: '반도체' }],
])
const base = {
  companies,
  deviceCount: () => 1,
  deviceCategories: () => ['83'],
  openQuotes: () => 0,
  touchOf: () => null,
  today: TODAY,
  allCategories: CATEGORY_OPTIONS,
  sort: 'touch',
  filter: { ...L.EMPTY_FILTER, statuses: ['활성', '잠재'], categories: [...CATEGORY_OPTIONS] },
}

console.log('\n── 회사로 묶기 ──')
{
  const r = L.buildCompanyTree({
    ...base,
    customers: [
      site(1, '네오오토 화성공장', { parent_customer_id: 100, site_name: '화성공장' }),
      site(2, '네오오토 아산공장', { parent_customer_id: 100, site_name: '아산공장' }),
      site(3, '원익큐엔씨 S캠퍼스', { parent_customer_id: 200, site_name: 'S캠퍼스' }),
      site(4, '부모 없는 곳'),
    ],
  })
  eq('회사 2곳', r.groups.map(g => g.companyName).sort(), ['네오오토', '원익큐엔씨'])
  eq('조건 일치 사업장 3곳', r.siteCount, 3)
  eq('부모 없는 줄은 미연결로 센다', r.unlinkedCount, 1)
  eq('미연결 줄은 회사 묶음에 들어가지 않는다',
    r.groups.flatMap(g => g.sites).map(s => s.customer.customer_id).sort(), [1, 2, 3])
  const neo = r.groups.find(g => g.companyName === '네오오토')
  eq('회사의 분류 태그', neo.industry, '자동차 부품')
  eq('회사의 장비 수는 사업장 합계', neo.deviceCount, 2)
}

console.log('\n── 거르기 ──')
{
  const rows = [
    site(1, '네오오토 화성공장', { parent_customer_id: 100, site_name: '화성공장', status: '활성' }),
    site(2, '네오오토 아산공장', { parent_customer_id: 100, site_name: '아산공장', status: '이탈', region1: '충남' }),
    site(3, '원익큐엔씨 S캠퍼스', { parent_customer_id: 200, site_name: 'S캠퍼스', status: '잠재', agency_name: '젠트' }),
  ]
  const run = (filter, extra = {}) => L.buildCompanyTree({ ...base, ...extra, customers: rows, filter: { ...base.filter, ...filter } })

  eq('상태 — 이탈을 빼면 2곳', run({}).siteCount, 2)
  eq('상태를 하나도 안 고르면 한 줄도 없다(지도 보기와 같은 규칙)',
    run({ statuses: [] }).siteCount, 0)
  eq('이탈만 고르면 1곳', run({ statuses: ['이탈'] }).siteCount, 1)
  eq('지역 — 경기만', run({ regions: ['경기'] }).siteCount, 2)
  eq('검색 — 사업장명', run({ query: '화성공장' }).siteCount, 1)
  // 주소에도 걸린다 — 세 줄이 같은 주소라 「화성」은 두 곳이 맞다(사업장명만 보는 것이 아니다).
  eq('검색 — 주소에도 걸린다', run({ query: '화성시' }).siteCount, 2)
  eq('검색 — 대리점 이름으로도 걸린다', run({ query: '젠트' }).siteCount, 1)
  eq('검색 — 회사명으로 그 회사의 사업장이 다 걸린다', run({ query: '네오오토' }).siteCount, 1)
  eq('조건에 맞는 사업장이 없는 회사는 트리에서 빠진다',
    run({ query: '원익' }).groups.map(g => g.companyName), ['원익큐엔씨'])

  // 분류 — 칩에 없는 분류만 가진 사업장은 거르지 않는다(지도 보기와 같다).
  eq('83 칩을 끄면 83 장비만 있는 곳이 빠진다',
    run({ categories: ['81'] }).siteCount, 0)
  eq('칩에 없는 분류(공백)만 가진 곳은 늘 남는다',
    run({ categories: ['81'] }, { deviceCategories: () => [' '] }).siteCount, 2)
  eq('20 도 이제 칩이다 — 끄면 빠진다',
    run({ categories: ['81', '83', '84'] }, { deviceCategories: () => ['20'] }).siteCount, 0)
  eq('20 칩을 켜면 보인다',
    run({ categories: ['20'] }, { deviceCategories: () => ['20'] }).siteCount, 2)

  // 90일·진행 견적
  const touchOf = id => (id === 1 ? { date: '2026-11-13', source: '영업활동', actorId: 7 } : null)
  eq('90일 활동 없음 — 접점이 있는 최근 줄은 빠진다',
    run({ staleOnly: true }, { touchOf }).siteCount, 1)
  eq('진행 견적 — 0건인 곳은 빠진다',
    run({ openQuotesOnly: true }, { openQuotes: id => (id === 3 ? 2 : 0) }).siteCount, 1)
}

console.log('\n── 분류 없음 칩(회사를 보는 조건) ──')
{
  const rows = [
    site(1, '네오오토 화성공장', { parent_customer_id: 100, site_name: '화성공장' }),
    site(2, '원익큐엔씨 S캠퍼스', { parent_customer_id: 200, site_name: 'S캠퍼스' }),
  ]
  const blank = new Map([
    [100, { company_name: '네오오토', industry: null }],
    [200, { company_name: '원익큐엔씨', industry: '반도체' }],
  ])
  const r = L.buildCompanyTree({ ...base, companies: blank, customers: rows, filter: { ...base.filter, noIndustryOnly: true } })
  eq('분류가 빈 회사만 남는다', r.groups.map(g => g.companyName), ['네오오토'])
  eq('건수도 그 회사의 사업장만 센다', r.siteCount, 1)
  const off = L.buildCompanyTree({ ...base, companies: blank, customers: rows, filter: base.filter })
  eq('칩을 끄면 둘 다', off.groups.length, 2)
}

console.log('\n── 세우기 ──')
{
  const g = (name, date) => ({ companyName: name, touch: date ? { date, source: '영업활동', actorId: null } : null })
  const sorted = L.sortGroups([g('나', '2026-01-01'), g('가', null), g('다', '2026-05-05')], 'touch')
  eq('최근 접점이 위, 접점 없는 곳은 맨 아래',
    sorted.map(x => x.companyName), ['다', '나', '가'])
  eq('이름순은 가나다', L.sortGroups([g('다', null), g('가', null), g('나', null)], 'name').map(x => x.companyName), ['가', '나', '다'])
  const s = (name, date) => ({ siteName: name, touch: date ? { date, source: '견적', actorId: null } : null })
  // 사업장은 **늘 이름 순**이다(2026-11-20) — 바깥 목록이 최근 활동순이어도 그렇다.
  // 한 회사의 사업장은 이름에 번호만 다른 줄이 많아, 활동순으로 세우면 매번 자리가 바뀐다.
  eq('사업장은 접점과 무관하게 이름 순',
    L.sortSites([s('나', '2026-09-09'), s('가', '2026-02-02')]).map(x => x.siteName), ['가', '나'])
  // 숫자는 값으로 센다 — 글자 비교면 10공장이 1공장 바로 뒤에 붙는다.
  eq('번호는 자연 순서',
    L.sortSites([s('예산10공장', null), s('예산2공장', null), s('예산1공장', null), s('예산4공장', null)]).map(x => x.siteName),
    ['예산1공장', '예산2공장', '예산4공장', '예산10공장'])
}

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
