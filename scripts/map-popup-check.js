// 지도 핀 팝업 · 좌측 카드 — **제목과 가는 길** (2026-11-28, 야간4 6).
//
//   node scripts/map-popup-check.js
//
// 지키는 약속
//   ① 제목은 「**회사명** » 사업장명」이고 **두 자리가 같은 규칙**이다(lib/mapPopup.ts).
//   ② 회사명은 점선 밑줄 링크다 — 회사를 모르면 그냥 글자다.
//   ③ 단추 둘 — 「회사 보기」(흰) / 「사업장 상세」(파랑). 거리(출발지) 줄은 그대로다.
//   ④ 사업장이 **한 곳뿐이면** 「회사 보기」를 내지 않는다 — 같은 화면이다.
//      그 수는 **거르기 전** 전체에서 센다.
//   ⑤ 장비는 **한 줄**이다 — 「… 외 N대」(lib/deviceName.ts 의 deviceNameSummary).
//   ⑥ 가는 곳은 **분할 보기**다 — 단독 상세 페이지로 보내지 않는다.
//
// 키도 서버도 없이 돈다.

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
        esModuleInterop: true, jsx: ts.JsxEmit.React,
      }, fileName: filename,
    }).outputText, filename)
  }
}
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(ROOT, req.slice(2))
  return origResolve.call(this, req, ...rest)
}

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const M = load(path.join(ROOT, 'lib/mapPopup.ts'))
const { deviceNameSummary } = load(path.join(ROOT, 'lib/deviceName.ts'))

const fails = []
let total = 0
const ok = (name, got, want = true) => {
  total += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${same ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
  if (!same) fails.push(name)
}

console.log('── ① 제목 두 토막 ──')
ok('회사명과 사업장명을 따로 알 때',
  M.popupTitle({ customer_id: 1, company_name: '(주)현대자동차 감마세타엔진공장', company_only: '(주)현대자동차', site_name: '감마세타엔진공장' }),
  { company: '(주)현대자동차', site: '감마세타엔진공장' })
// 이관 중인 줄은 company_only 가 비어 있다 — 합친 이름에서 사업장명을 떼어 쓴다.
ok('회사명을 따로 모르면 합친 이름에서 뗀다',
  M.popupTitle({ customer_id: 2, company_name: '네오오토 예산4공장', site_name: '예산4공장' }),
  { company: '네오오토', site: '예산4공장' })
ok('사업장명이 없으면 회사명만',
  M.popupTitle({ customer_id: 3, company_name: '하나무역', site_name: null }),
  { company: '하나무역', site: null })
ok('뗄 수 없으면 합친 이름 그대로',
  M.popupTitle({ customer_id: 4, company_name: '본사', site_name: '본사' }),
  { company: '본사', site: '본사' })

console.log('── ② 가는 길 — 분할 보기 ──')
ok('회사', M.companyHref({ customer_id: 5, company_name: 'A', parent_customer_id: 1525 }), '/?view=list&company=1525')
ok('회사를 모르면 null', M.companyHref({ customer_id: 5, company_name: 'A' }), null)
ok('사업장 — 회사를 알면 함께 적는다',
  M.siteHref({ customer_id: 776, company_name: 'A', parent_customer_id: 1525 }), '/?view=list&company=1525&site=776')
ok('사업장 — 회사를 모르면 site 만', M.siteHref({ customer_id: 776, company_name: 'A' }), '/?view=list&site=776')
ok('단독 상세 페이지로 보내지 않는다',
  /\/customer\//.test(M.siteHref({ customer_id: 776, company_name: 'A', parent_customer_id: 1 })), false)

console.log('── ③ 「회사 보기」를 낼까 ──')
const withParent = { customer_id: 776, company_name: 'A', parent_customer_id: 1525 }
ok('사업장이 둘이면 낸다', M.showCompanyButton(withParent, 2))
ok('한 곳뿐이면 내지 않는다(같은 화면이다)', M.showCompanyButton(withParent, 1), false)
ok('수를 모르면 내지 않는다', M.showCompanyButton(withParent, undefined), false)
ok('회사를 모르면 내지 않는다', M.showCompanyButton({ customer_id: 9, company_name: 'A' }, 5), false)

console.log('── ④ 장비 한 줄 ──')
ok('한 대면 그 이름', deviceNameSummary([{ device_name: 'SURFCOM NEX030' }]), 'SURFCOM NEX030')
ok('여러 대면 「… 외 N대」',
  deviceNameSummary([{ device_name: 'A' }, { device_name: 'B' }, { device_name: 'C' }]), 'A 외 2대')
ok('없으면 -', deviceNameSummary([]), '-')

console.log('── ⑤ 지도 팝업 ──')
const MAP = read('components/home/MapView.tsx')
ok('제목이 공용 함수를 쓴다', /const title = popupTitle\(c\)/.test(MAP))
ok('회사 링크도', /const companyUrl = companyHref\(c\)/.test(MAP))
ok('「회사 보기」 여부도', /showCompanyButton\(c, siteCountByCompany\?\.get\(/.test(MAP))
ok('점선 밑줄은 한 곳에서 정한다', /COMPANY_LINK_CSS/.test(MAP) && /text-decoration-style:dotted/.test(read('lib/mapPopup.ts')))
ok('단추 둘', /makeButton\('회사 보기', companyUrl, false\)/.test(MAP) && /makeButton\('사업장 상세', detailUrl, true\)/.test(MAP))
ok('「회사 보기」는 조건부다', /if \(withCompany && companyUrl\)/.test(MAP))
ok('장비는 한 줄 요약', /const deviceSummary = deviceNameSummary\(devices\)/.test(MAP))
ok('네 줄 쌓던 것이 없다', /deviceLines\.slice\(0, 4\)/.test(MAP), false)
ok('거리(출발지) 줄은 그대로다', /navRow\.appendChild\(makeHomeButton\(\)\)/.test(MAP) && /activeOffices\(officesRef\.current\)/.test(MAP))
ok('사업장 수는 **거르기 전** 것을 받는다', /siteCountByCompany\?: Map<number, number>/.test(MAP))
const PAGE = read('app/page.tsx')
ok('그 수를 전체에서 센다', /const siteCountByCompany = useMemo\(\(\) => \{[\s\S]{0,300}for \(const c of customers\)/.test(PAGE))
ok('거른 목록으로 세지 않는다', /for \(const c of filteredCustomers\)/.test(PAGE), false)
ok('지도에 넘긴다', /siteCountByCompany=\{siteCountByCompany\}/.test(PAGE))

console.log('── ⑥ 좌측 카드 ──')
const CARD = read('components/home/CustomerCard.tsx')
ok('같은 함수로 제목을 만든다', /const title = popupTitle\(customer\)/.test(CARD) && /const companyUrl = companyHref\(customer\)/.test(CARD))
ok('회사명이 점선 밑줄 링크', /textDecorationStyle: 'dotted'/.test(CARD))
ok('사업장명은 보조 글자', /\{' » '\}\{title\.site\}/.test(CARD))
ok('우하단은 「사업장 상세 ›」 하나', /사업장 상세/.test(CARD) && !/>\s*상세보기/.test(CARD))
ok('그 링크도 분할 보기다', /href=\{siteHref\(customer\)\}/.test(CARD))
ok('단독 상세 페이지 주소가 없다', /\/customer\/\$\{customer\.customer_id\}/.test(CARD), false)

if (fails.length > 0) {
  console.error('\n실패:')
  for (const f of fails) console.error('  · ' + f)
  process.exit(1)
}
console.log(`\n통과 — 지도 팝업·좌측 카드(검사 ${total}개 · 실패 0)`)
