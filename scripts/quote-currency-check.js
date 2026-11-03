// 통화 판정 시험 — lib/quoteCurrency.ts.
//
//   node scripts/quote-currency-check.js
//
// 왜 따로 두는가 — 통화를 잘못 읽으면 **원가가 150배 틀어진다**(원/달러 1,337 ÷ 원/엔 8.48).
// 그리고 틀려도 화면은 멀쩡해 보인다(숫자가 크든 작든 금액은 나온다). 그래서 판정의
// 바닥을 여기서 못 박는다.
//   · 모르는 값은 **엔**이다 — DB 칸 기본값과 같아야 한다(옛 줄에는 칸이 없다).
//   · 환율이 없으면 **0** 이다 — 1 로 바꿔 주면 구입가가 그대로 원화가 되어 조용히 틀린다.
//   · 수출입은행은 **엔만 100단위**로 준다.

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

const C = load(path.join(ROOT, 'lib/quoteCurrency.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

console.log('── 등록표 ──')
eq('통화 둘', [...C.CURRENCIES], ['JPY', 'USD'])
eq('기본값은 엔(DB 칸 기본값과 같다)', C.DEFAULT_CURRENCY, 'JPY')
eq('기호', [C.CURRENCY_SYMBOL.JPY, C.CURRENCY_SYMBOL.USD], ['¥', '$'])
eq('이름', [C.CURRENCY_LABEL.JPY, C.CURRENCY_LABEL.USD], ['엔 (JPY)', '달러 (USD)'])
eq('달러 환율 출발값', C.USD_DEFAULT_RATE, 1600)
eq('수출입은행 이름', [C.EXIM_UNIT.JPY, C.EXIM_UNIT.USD], ['JPY(100)', 'USD'])

console.log('\n── 통화 읽기 ──')
eq('아는 코드', [C.isCurrency('JPY'), C.isCurrency('USD')], [true, true])
eq('모르는 코드', [C.isCurrency('EUR'), C.isCurrency('jpy'), C.isCurrency(''), C.isCurrency(null)],
  [false, false, false, false])
eq('toCurrency — 아는 코드는 그대로', [C.toCurrency('JPY'), C.toCurrency('USD')], ['JPY', 'USD'])
eq('toCurrency — 소문자·공백도 받는다', [C.toCurrency('usd'), C.toCurrency(' Usd ')], ['USD', 'USD'])
eq('**모르면 엔**(옛 줄에는 칸이 없다)',
  [C.toCurrency(null), C.toCurrency(undefined), C.toCurrency(''), C.toCurrency('EUR'), C.toCurrency(7)],
  ['JPY', 'JPY', 'JPY', 'JPY', 'JPY'])

console.log('\n── 환율 고르기 ──')
const R = { JPY: 8.4821, USD: 1600 }
eq('엔 줄', C.pickRate('JPY', R), 8.4821)
eq('달러 줄', C.pickRate('USD', R), 1600)
eq('통화를 모르는 줄은 엔으로 본다', C.pickRate(null, R), 8.4821)
eq('**없는 환율은 0**(1 로 바꿔 주지 않는다)', [
  C.pickRate('USD', { JPY: 8.4821 }), C.pickRate('USD', { JPY: 8.4821, USD: 0 }),
  C.pickRate('JPY', {}), C.pickRate('JPY', null), C.pickRate('JPY', undefined),
], [0, 0, 0, 0, 0])
eq('음수·NaN 도 0', [
  C.pickRate('USD', { JPY: 1, USD: -5 }), C.pickRate('USD', { JPY: 1, USD: Number.NaN }),
], [0, 0])
eq('엔만 아는 묶음', [C.jpyOnly(9.5).JPY, C.jpyOnly(9.5).USD], [9.5, 0])

console.log('\n── 수출입은행 응답 ──')
eq("'1,337.2' → 1337.2", C.parseEximNumber('1,337.2'), 1337.2)
eq('숫자도 그대로', C.parseEximNumber(848.21), 848.21)
eq('못 읽는 값은 null', [
  C.parseEximNumber(''), C.parseEximNumber('-'), C.parseEximNumber(null), C.parseEximNumber('0'),
  C.parseEximNumber('없음'),
], [null, null, null, null, null])
eq('**엔은 100으로 나눈다**', C.rateFromExim('JPY', '848.21'), 8.4821)
eq('달러는 그대로', C.rateFromExim('USD', '1,337.2'), 1337.2)
eq('소수 네 자리로 맞춘다(종전 엔 환율 자리수)', C.rateFromExim('JPY', '848.2157'), 8.4822)
eq('못 읽으면 null', [C.rateFromExim('JPY', '-'), C.rateFromExim('USD', null)], [null, null])

const AP01 = [
  { cur_unit: 'AED', cur_nm: '아랍에미리트 디르함', deal_bas_r: '364.1' },
  { cur_unit: 'JPY(100)', cur_nm: '일본 옌', deal_bas_r: '848.21' },
  { cur_unit: 'KRW', cur_nm: '한국 원', deal_bas_r: '1' },
  { cur_unit: 'USD', cur_nm: '미국 달러', deal_bas_r: '1,337.2' },
]
eq('배열에서 통화 한 줄 집기', [
  C.findEximRow(AP01, 'JPY').cur_nm, C.findEximRow(AP01, 'USD').cur_nm,
], ['일본 옌', '미국 달러'])
eq('없는 통화·배열이 아니면 null', [
  C.findEximRow([], 'USD'), C.findEximRow(null, 'USD'), C.findEximRow('x', 'JPY'),
  C.findEximRow([{ cur_unit: 'EUR', deal_bas_r: '1' }], 'USD'),
], [null, null, null, null])
eq('**둘을 한 번에**', C.ratesFromExim(AP01), { JPY: 8.4821, USD: 1337.2 })
eq('한쪽만 있으면 한쪽만', C.ratesFromExim([AP01[1]]), { JPY: 8.4821 })
eq('빈 응답', [C.ratesFromExim([]), C.ratesFromExim(null)], [{}, {}])
eq('값이 깨진 줄은 빠진다', C.ratesFromExim([{ cur_unit: 'USD', deal_bas_r: '-' }, AP01[1]]), { JPY: 8.4821 })

console.log('\n── 옛 코드와 같은 답인가(엔) ──')
// 종전 라우트·화면은 `Number(deal_bas_r) / 100` 로 엔 환율을 만들었다. 그 식과 맞춘다.
{
  const old = (raw) => Number(String(raw).replace(/,/g, '')) / 100
  const samples = ['848.21', '864.41', '950.00', '1,000.5']
  eq('네 표본에서 옛 식과 같다',
    samples.map(s => C.rateFromExim('JPY', s) === Math.round(old(s) * 10000) / 10000),
    [true, true, true, true])
}

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
