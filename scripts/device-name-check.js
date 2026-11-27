// 장비 이름 한 줄 · 회사/대리점 이름 겹침 (2026-11-27, 묶음5 3-7 · 3-8).
//
//   node scripts/device-name-check.js
//
// 둘 다 **순수 함수**라 돌려 본다. 키 없이 서버 없이 돈다.

const load = module.require.bind(module)
const fs = load('fs')
const path = load('path')
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

const D = load(path.join(ROOT, 'lib/deviceName.ts'))
const K = load(path.join(ROOT, 'lib/companyNameKey.ts'))
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

let fails = 0
const eq = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want)
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}`)
  if (!good) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const ok = (name, good, extra) => {
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
}

console.log('── ① 장비 이름 — 세 칸을 **붙여** 쓴다 ──')
const S = { device_name: 'SURFCOM', device_name2: 'TOUCH550', option: '-13' }
eq('라인업 + 모델 + 구성', D.deviceModelName(S), 'SURFCOM TOUCH550-13'.replace(/ /g, ''))
eq('프로그램이 있으면 괄호로 붙인다', D.deviceName({ ...S, program: 'ACCTee' }), 'SURFCOMTOUCH550-13 (ACCTee)')

console.log('\n── ②「없음」은 값이 아니다 ──')
// 고르는 칸의 기본값이 글자로 저장돼 들어온 자리가 있다 — 지우지 못하므로 읽을 때 거른다.
for (const v of ['없음', '(없음)', '-', '', '  ', 'none', 'N/A']) {
  eq(`프로그램 「${v}」 → 꼬리 없음`, D.deviceName({ ...S, program: v }), 'SURFCOMTOUCH550-13')
}
eq('구성이 「없음」이어도 이름에 안 들어간다', D.deviceModelName({ ...S, option: '없음' }), 'SURFCOMTOUCH550')
eq('이름이 아예 없으면 빈 글자 — 「(없음)」 하나만 남지 않는다', D.deviceName({ program: 'ACCTee' }), '')
eq('그럴 때 쓰는 대신 값', D.deviceNameOr({}, '장비 7'), '장비 7')

console.log('\n── ③ 여러 대 ──')
const list = [S, { device_name: 'RONDCOM', device_name2: '73A' }]
eq('한 줄로', D.deviceNameLine(list), 'SURFCOMTOUCH550-13 / RONDCOM73A')
eq('없으면 -', D.deviceNameLine([]), '-')
// 지도 팝업·카드는 한 줄만 쓴다.
eq('… 외 N대', D.deviceNameSummary(list), 'SURFCOMTOUCH550-13 외 1대')
eq('한 대면 그 이름만', D.deviceNameSummary([S]), 'SURFCOMTOUCH550-13')
eq('없으면 -', D.deviceNameSummary(null), '-')

console.log('\n── ④ 쓰는 자리 ──')
const HOME = read('lib/home.ts')
ok('홈·고객사 목록이 공용 함수를 쓴다', /deviceNames\(devices\)/.test(HOME) && /deviceNameLine\(devices\)/.test(HOME))
// 이 자리가 「…(없음)」 꼬리를 만들던 곳이다.
ok('손으로 이어 붙이던 줄이 없다', !/\$\{d\.device_name \?\? ''\}\$\{d\.device_name2/.test(HOME))

console.log('\n── ⑤ 회사/대리점 이름 겹침 ──')
eq('법인 꼬리표를 뗀다', K.companyNameKey('(주)하나무역'), '하나무역')
eq('앞에 붙어도 뗀다', K.companyNameKey('주식회사 하나무역'), '하나무역')
eq('겹쳐 붙어도 뗀다', K.companyNameKey('(주)하나무역주식회사'), '하나무역')
eq('영문은 소문자', K.companyNameKey('HANA Trading Co., Ltd.'), 'hanatrading')
eq('공백·점·하이픈을 뗀다', K.companyNameKey(' 대한 정밀 · 공업 '), '대한정밀공업')
ok('「(주)하나무역」과 「하나무역」은 같다', K.sameCompanyName('(주)하나무역', '하나무역'))
ok('다른 회사는 다르다', !K.sameCompanyName('하나무역', '하나상사'))
// 빈 이름끼리 같다고 하면 **아무 회사나** 막히게 된다.
ok('빈 이름은 아무와도 같지 않다', !K.sameCompanyName('', '') && !K.sameCompanyName(null, '하나무역'))

console.log('\n── ⑥ 등록을 막는다 ──')
const ADD = read('lib/addCustomer.ts')
ok('대리점을 만들 때 같은 이름의 **회사**를 본다', /findByNameOnOtherSide\(supabase, name, 'company'\)/.test(ADD))
ok('회사를 만들 때 같은 이름의 **대리점**을 본다', /findByNameOnOtherSide\(supabase, name, 'agency'\)/.test(ADD))
ok('안내문은 한 곳에서 온다', /AGENCY_EXISTS_MSG/.test(ADD) && /COMPANY_EXISTS_MSG/.test(ADD))
eq('대리점이 있을 때의 말', K.AGENCY_EXISTS_MSG, '이미 대리점으로 등록된 이름입니다. 대리점 탭에서 찾으세요')
// 판정은 **열쇠**로 한다 — 글자 그대로 견주면 「(주)」 하나에 뚫린다.
ok('판정은 열쇠로 한다', /sameCompanyName\(r\.company_name, name\)/.test(ADD))

console.log(fails === 0 ? '\n전부 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
