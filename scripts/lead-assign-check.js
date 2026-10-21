// 리드 배정 = 전환 규칙 시험 — 고객사 찾기와 포캐스트 기본값.
//
//   node scripts/lead-assign-check.js
//
// 왜 따로 두는가 — 배정 한 번이 **고객사 행과 포캐스트 행을 만든다.** 이름 비교가 느슨하면
// 같은 회사가 둘로 늘고, 빡빡하면 있는 고객사를 못 찾아 또 만든다. 둘 다 사람이 나중에
// 손으로 치워야 하는 사고다. 화면을 띄우지 않고 규칙 함수만 돌린다.

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    mod._compile(ts.transpileModule(load('fs').readFileSync(filename, 'utf8'), {
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

const {
  normalizeCompanyName, findCustomerCandidates, nextMonthEnd, leadForecastTitle, leadSourceLine,
} = load(path.join(ROOT, 'lib/leadCustomer.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

// ── 회사 이름 열쇠 ────────────────────────────────────────────────────────
console.log('── 회사 이름 비교 열쇠 ──')
eq('법인 표기를 지운다', normalizeCompanyName('㈜한국정밀'), '한국정밀')
eq('(주)도 같다', normalizeCompanyName('(주) 한국정밀'), '한국정밀')
eq('뒤에 붙어도 지운다', normalizeCompanyName('한국정밀(주)'), '한국정밀')
eq('주식회사도 지운다', normalizeCompanyName('주식회사 한국정밀'), '한국정밀')
eq('유한회사·(유)도 지운다',
  [normalizeCompanyName('유한회사 한국정밀'), normalizeCompanyName('(유)한국정밀')], ['한국정밀', '한국정밀'])
eq('공백은 전부 지운다(전각 공백 포함)', normalizeCompanyName('한국　정밀 기계'), '한국정밀기계')
eq('영문은 소문자로', normalizeCompanyName('Korea ACCRETECH'), 'koreaaccretech')
eq('섞여 있어도 같은 열쇠',
  normalizeCompanyName('㈜ 한국 ACCRETECH') === normalizeCompanyName('주식회사 한국accretech'), true)
eq('빈 값은 빈 열쇠', [normalizeCompanyName(''), normalizeCompanyName(null)], ['', ''])
// 사업장 표기는 **지우지 않는다** — 천안 공장과 대구 공장은 다른 고객사다.
eq('괄호 안 사업장은 남긴다', normalizeCompanyName('한국정밀(천안)'), '한국정밀(천안)')
eq('그래서 사업장이 다르면 다른 회사',
  normalizeCompanyName('한국정밀(천안)') === normalizeCompanyName('한국정밀(대구)'), false)

// ── 후보 찾기 ─────────────────────────────────────────────────────────────
console.log('\n── 기존 고객사 후보 ──')
const CUSTOMERS = [
  { customer_id: 1, company_name: '㈜한국정밀', address: '경기' },
  { customer_id: 2, company_name: '한국 정밀', address: '충남' },
  { customer_id: 3, company_name: '한국정밀기계', address: '대구' },
  { customer_id: 4, company_name: '대한테크', address: '부산', deleted_at: '2026-01-01' },
  { customer_id: 5, company_name: null },
]
eq('표기가 달라도 같은 회사는 전부 후보',
  findCustomerCandidates('주식회사 한국정밀', CUSTOMERS).map(c => c.customer_id), [1, 2])
eq('비슷한 이름은 후보가 아니다(부분 일치를 쓰지 않는다)',
  findCustomerCandidates('한국정밀기계', CUSTOMERS).map(c => c.customer_id), [3])
eq('지운 업체는 빼고 센다', findCustomerCandidates('대한테크', CUSTOMERS).map(c => c.customer_id), [])
eq('이름 없는 행에 걸리지 않는다', findCustomerCandidates('', CUSTOMERS), [])
eq('없는 회사는 0건 — 새로 등록하는 길로 간다',
  findCustomerCandidates('새로운회사', CUSTOMERS).length, 0)

// ── 포캐스트 기본값 ───────────────────────────────────────────────────────
console.log('\n── 포캐스트 기본값 ──')
eq('예상월은 다음 달 말일', nextMonthEnd('2026-10-21'), '2026-11-30')
eq('해를 넘긴다', nextMonthEnd('2026-12-05'), '2027-01-31')
eq('2월은 28일', nextMonthEnd('2026-01-31'), '2026-02-28')
eq('윤년 2월은 29일', nextMonthEnd('2024-01-15'), '2024-02-29')
eq('모양이 아니면 빈 글자', nextMonthEnd('어제'), '')

eq('제목 — 회사명 + 관심제품', leadForecastTitle('한국정밀', '표면조도측정기'), '한국정밀 표면조도측정기')
eq('관심제품이 없으면 「문의」', leadForecastTitle('한국정밀', ''), '한국정밀 문의')
eq('공백만 있어도 「문의」', leadForecastTitle('한국정밀', '   '), '한국정밀 문의')
eq('회사명이 없으면 관심제품만', leadForecastTitle('', '표면조도측정기'), '표면조도측정기')
eq('둘 다 없으면 빈 글자(부르는 쪽이 막는다)', leadForecastTitle('', ''), '')

eq('출처 줄', leadSourceLine('LD-26-001'), '[리드 LD-26-001]')
eq('리드 번호가 없어도 출처는 남긴다', leadSourceLine(null), '[리드]')

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
