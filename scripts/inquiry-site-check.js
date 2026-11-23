// 의뢰서 — **회사 → 사업장 → 장비** (2026-11-23).
//
//   node scripts/inquiry-site-check.js
//
// 지키는 약속
//   ① 사업장을 고르지 않으면 번호가 나가지 않는다. 장비는 고르지 않아도 된다.
//   ② 자유 입력 업체명 칸은 없다 — 서류에 적히는 이름은 **고른 사업장의 이름**이다.
//   ③ 사업장 목록은 그 회사의 것만. 자식이 없는 회사도 막다른 길이 아니다(그 줄 자체가 사업장).
//   ④ 고를 것이 하나뿐이면 저절로 골라진다.
//   ⑤ 고르는 칸 셋은 공용 콤보박스를 쓰고, 라벨에 (필수)/(선택) 을 적지 않는다.
//   ⑥ 사업장이 비어 있는 **옛 건**은 띠로 알린다 — 채워 넣지는 않는다.

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

const S = load(path.join(ROOT, 'lib/inquirySite.ts'))

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

console.log('\n── ① 사업장은 필수, 장비는 선택 ──')
eq('사업장을 안 골랐으면 까닭이 있다', S.sitePickBlockedReason(null), S.SITE_REQUIRED_MESSAGE)
eq('골랐으면 막지 않는다', S.sitePickBlockedReason(853), null)
eq('없는 값도 안 고른 것으로 본다', S.sitePickBlockedReason(undefined), S.SITE_REQUIRED_MESSAGE)
ok('장비를 막는 함수는 없다(선택이다)', typeof S.devicePickBlockedReason === 'undefined')

const PAGE = read('app/inquiries/page.tsx')
ok('발급 조건이 사업장을 본다', /canIssue\(v: \{ type: InquiryType; series: string; customerId: number \| null \}\)/.test(PAGE))
ok('사업장이 없으면 거짓', /return seriesOk && v\.customerId != null/.test(PAGE))
ok('버튼 옆에 까닭을 적는다', PAGE.includes('SITE_REQUIRED_MESSAGE'))

console.log('\n── ② 자유 입력 업체명 칸이 없다 ──')
ok('발급 모달에 업체명 입력칸이 없다', !/htmlFor="iq-title"/.test(PAGE) && !/id="iq-title"/.test(PAGE))
ok('업체명은 고른 사업장에서 나온다', /const title = site\?\.name \?\? ''/.test(PAGE))

console.log('\n── ③ 사업장 목록 ──')
const company = { customer_id: 1744, company_name: '현대트랜시스', name_en: 'HYUNDAI TRANSYS', is_parent: true }
const kids = [
  { customer_id: 853, company_name: '현대트랜시스 지곡공장', site_name: '지곡공장', address: '충남 서산시' },
  { customer_id: 1358, company_name: '현대트랜시스 서산공장', site_name: '서산공장', address: '충남 서산시' },
]
eq('자식이 있으면 그 자식들', S.sitesOfCompany(company, kids).map(r => r.customer_id), [853, 1358])
eq('자식이 없으면 그 줄 자체(막다른 길을 만들지 않는다)',
  S.sitesOfCompany(company, []).map(r => r.customer_id), [1744])
eq('그 줄 자체일 때 이름도 제대로', S.siteLabel(S.sitesOfCompany(company, [])[0]), '현대트랜시스')

console.log('\n── ④ 하나뿐이면 저절로 ──')
eq('하나면 그것', S.onlyOne([kids[0]]).customer_id, 853)
eq('둘이면 null', S.onlyOne(kids), null)
eq('없으면 null', S.onlyOne([]), null)

console.log('\n── ⑤ 이름 짓기 ──')
eq('회사명에 사업장명이 이미 들어 있으면 덧붙이지 않는다',
  S.siteLabel({ customer_id: 1, company_name: '일진글로벌 경주공장', site_name: '경주공장' }), '일진글로벌 경주공장')
eq('안 들어 있으면 붙인다',
  S.siteLabel({ customer_id: 1, company_name: '일진글로벌', site_name: '경주공장' }), '일진글로벌 경주공장')
eq('회사명이 없으면 사업장명', S.siteLabel({ customer_id: 7, company_name: null, site_name: '경주공장' }), '경주공장')
eq('둘 다 없으면 번호', S.siteLabel({ customer_id: 7, company_name: null, site_name: null }), '사업장 7')
eq('장비 이름', S.deviceLabel({ device_id: 3, device_name: 'SURFCOM', device_name2: '1800', serial_number: 'A1' }), 'SURFCOM 1800 · A1')
eq('장비 이름이 비면 번호', S.deviceLabel({ device_id: 3, device_name: null, device_name2: null, serial_number: null }), '장비 3')
eq('회사 이름', S.companyLabel(company), '현대트랜시스')

console.log('\n── ⑥ 고르는 칸 셋 ──')
const PICKER = read('components/inquiry/SitePicker.tsx')
ok('공용 콤보박스를 쓴다', PICKER.includes("from '@/components/common/SearchSelect'"))
eq('칸이 셋이다', (PICKER.match(/<SearchSelect</g) ?? []).length, 3)
for (const [id, label] of [['iq-company', '회사'], ['iq-site', '사업장'], ['iq-device', '장비']]) {
  ok(`${label} 칸`, PICKER.includes(`htmlFor="${id}"`) && PICKER.includes(`>${label}</label>`))
}
ok('라벨에 (필수)·(선택)을 적지 않는다', !/\(필수\)|\(선택\)/.test(PICKER))
ok('사업장·장비는 눌러서 펼친다(검색창이 아니다)',
  (PICKER.match(/openWhenEmpty/g) ?? []).length === 3)
ok('회사를 고르기 전에는 사업장 칸이 잠긴다', /disabled=\{!company\}/.test(PICKER))
ok('사업장을 고르기 전에는 장비 칸이 잠긴다', /disabled=\{!site\}/.test(PICKER))
ok('회사 검색은 이름 둘만(ⓑ)', PICKER.includes('matchesCompanyPick'))
ok('「없음」 항목을 두지 않는다 — 비워 두면 그만이다', !/>없음</.test(PICKER))

console.log('\n── ⑦ 옛 건 ──')
const DETAIL = read('app/inquiries/[id]/page.tsx')
ok('사업장이 비면 띠로 알린다', DETAIL.includes('SITE_MISSING_BANNER'))
eq('띠 글자', S.SITE_MISSING_BANNER, '사업장 미연결 — 저장하려면 선택')
ok('채워 넣는 코드는 없다(백필 금지)', !/backfill|백필/i.test(DETAIL))
ok('안내문은 한 곳에서 온다', DETAIL.includes('SITE_PICK_NOTE') && PAGE.includes('SITE_PICK_NOTE'))
ok('상세 화면에도 자유 입력 업체명 칸이 없다', !/value={title} maxLength/.test(DETAIL))
ok('사업장을 고르면 업체명이 따라온다', DETAIL.includes("setTitle(v ? v.name : '')"))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
