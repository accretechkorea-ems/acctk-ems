// 업체 이름 한 줄 규칙 시험 — 「회사명 사업장명」.
//
//   node scripts/customer-label-check.js
//
// 왜 따로 두는가 — 이 글자는 화면·거래명세서·수리내역서·엑셀이 함께 쓴다. 규칙이 한 번
// 흔들리면 같은 업체가 화면마다 다른 이름으로 불린다. 이관 중(사업장명이 아직 빈 줄,
// 부모가 아직 없는 줄)에도 **글자가 사라지지 않아야** 하는 것이 핵심이다.

// eslint 의 no-require-imports 는 맨 require() 를 센다. node 로 직접 돌리는 CJS 라
// 그렇게 부를 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

Module._extensions['.ts'] = (mod, filename) => {
  mod._compile(ts.transpileModule(load('fs').readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename)
}

const L = load(path.join(ROOT, 'lib/customerLabel.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

console.log('── 합치기 ──')
eq('회사 + 사업장', L.customerLabel('(주)현대자동차', '감마세타엔진공장'), '(주)현대자동차 감마세타엔진공장')
eq('사업장이 비면 회사만', L.customerLabel('(주)현대자동차', ''), '(주)현대자동차')
eq('사업장이 null 이어도 회사만', L.customerLabel('(주)현대자동차', null), '(주)현대자동차')
eq('앞뒤 공백은 떼고 한 칸으로', L.customerLabel('  현대위아 ', '  창원2공장  '), '현대위아 창원2공장')
eq('공백뿐인 사업장은 없는 것', L.customerLabel('현대위아', '   '), '현대위아')
eq('회사가 비면 사업장만', L.customerLabel('', '창원2공장'), '창원2공장')
eq('둘 다 비면 빈 글자', L.customerLabel(null, null), '')

console.log('\n── 줄 하나에서 이름 만들기 ──')
eq('부모 + 사업장명',
  L.customerLabelOf({ company_name: '현대위아 창원2공장', site_name: '창원2공장' }, '현대위아'),
  '현대위아 창원2공장')
eq('사업장명이 비면 그 줄의 이름 그대로',
  L.customerLabelOf({ company_name: '현대자동차㈜', site_name: null }, '현대자동차'),
  '현대자동차㈜')
// 이관 전 — 자식 이름이 부모와 달라도 글자가 사라지면 안 된다(하이드로텍 ↔ ㈜나노믹).
eq('이관 전: 부모와 이름이 달라도 그 줄 이름을 지키다',
  L.customerLabelOf({ company_name: '하이드로텍', site_name: null }, '㈜나노믹'),
  '하이드로텍')
eq('부모가 없으면 자기 이름이 회사명',
  L.customerLabelOf({ company_name: '가나공업', site_name: null }, null),
  '가나공업')
eq('부모가 없고 사업장명만 있으면 자기 이름을 회사명으로',
  L.customerLabelOf({ company_name: '연암테크', site_name: '김해공장' }, null),
  '연암테크 김해공장')
eq('칸이 비어 있어도 터지지 않는다', L.customerLabelOf({}, null), '')

console.log('\n── 조회해 온 줄에서 이름 뽑기 ──')
eq('select 에 붙이는 글자',
  L.CUSTOMER_NAME_SELECT, 'company_name, site_name, parent:parent_customer_id(company_name)')
const joined = { company_name: '현대위아 창원2공장', site_name: '창원2공장', parent: { company_name: '현대위아' } }
eq('한 줄 이름', L.customerDisplayName(joined), '현대위아 창원2공장')
eq('부모가 배열로 와도 같다',
  L.customerDisplayName({ ...joined, parent: [{ company_name: '현대위아' }] }), '현대위아 창원2공장')
eq('회사명만(견적서 귀하·E.U)', L.customerCompanyName(joined), '현대위아')
eq('부모가 없으면 그 줄 이름이 회사명',
  L.customerCompanyName({ company_name: '가나공업', site_name: null, parent: null }), '가나공업')
eq('회사 줄은 자기 이름 그대로',
  L.customerDisplayName({ company_name: '현대위아', site_name: null, parent: null }), '현대위아')
eq('줄이 없으면 빈 글자', [L.customerDisplayName(null), L.customerCompanyName(undefined)], ['', ''])

console.log('\n── 같은 이름을 가리는 주소 꼬리 ──')
eq('주소 앞부분을 붙인다',
  L.customerLabelWithAddress('현대자동차㈜', '울산 북구 염포로 700'),
  '현대자동차㈜ — 울산 북구 염포로 700')
eq('길면 자른다',
  L.customerLabelWithAddress('현대자동차㈜', '경기도 화성시 동탄대로24길 31-8, IMS빌딩 205호'),
  '현대자동차㈜ — 경기도 화성시 동탄대로24길 31…')
eq('주소가 없으면 이름만', L.customerLabelWithAddress('가나공업', null), '가나공업')

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
