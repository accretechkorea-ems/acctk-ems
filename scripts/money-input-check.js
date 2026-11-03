// 금액 입력 칸의 글자 ↔ 숫자 규칙 시험 — 쉼표·커서·붙여넣기.
//
//   node scripts/money-input-check.js
//
// 왜 따로 두는가 — 이 칸들에는 **견적 금액이 들어간다.** 쉼표를 넣다가 한 자리를 먹거나
// 커서가 튀어 「3,000,000」이 「300,000」이 되면, 그 견적은 확정까지 아무도 못 잡는다.
// 화면 없이 규칙 함수만 돌린다(lib/moneyInput.ts 는 순수 모듈이다).

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
  sanitizeMoney, parseMoney, formatMoney, groupDigits, moneyEdit,
} = load(path.join(ROOT, 'lib/moneyInput.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

console.log('── 쉼표 넣기 ──')
eq('세 자리마다', groupDigits('3000000'), '3,000,000')
eq('세 자리 이하는 그대로', groupDigits('999'), '999')
eq('네 자리', groupDigits('1234'), '1,234')
eq('소수부에는 넣지 않는다', groupDigits('1234.56'), '1,234.56')

console.log('\n── 사람이 친 글자 거르기 ──')
eq('쉼표가 섞여 들어와도 숫자만', sanitizeMoney('1,234,567'), '1234567')
eq('글자·기호는 버린다', sanitizeMoney('₩1,2a3 4원'), '1234')
eq('정수 칸에서는 소수점을 받지 않는다', sanitizeMoney('12.34'), '1234')
eq('달러 칸(소수 2)', sanitizeMoney('12.34', { decimals: 2 }), '12.34')
eq('소수점은 한 번만', sanitizeMoney('1.2.3', { decimals: 2 }), '1.23')
eq('소수 자리는 두 자리까지', sanitizeMoney('1.2345', { decimals: 2 }), '1.23')
eq('맨 앞 0 은 하나만', sanitizeMoney('007'), '7')
eq('0 자체는 남는다', sanitizeMoney('0'), '0')
eq('0.5 도 남는다', sanitizeMoney('0.5', { decimals: 2 }), '0.5')
eq('맨 앞 점은 버린다(수가 아니다)', sanitizeMoney('.5', { decimals: 2 }), '5')
eq('빈 글자', sanitizeMoney(''), '')

console.log('\n── 글자 → 숫자 ──')
eq('쉼표 붙은 글자', parseMoney('1,234,567'), 1234567)
eq('빈 칸은 null(= 비어 있다)', parseMoney(''), null)
eq('0 은 0 이다(비어 있는 것이 아니다)', parseMoney('0'), 0)
eq('달러 소수', parseMoney('1,200.50', { decimals: 2 }), 1200.5)
eq('정수 칸에서 소수점은 글자로 안 본다', parseMoney('1.5'), 15)

console.log('\n── 숫자 → 글자 ──')
eq('정수', formatMoney(3000000), '3,000,000')
eq('0 은 빈 글자(placeholder 가 보이게)', formatMoney(0), '')
eq('null·undefined', [formatMoney(null), formatMoney(undefined)], ['', ''])
eq('달러 소수 두 자리', formatMoney(1200.5, { decimals: 2 }), '1,200.5')
eq('정수 칸은 반올림', formatMoney(1200.6), '1,201')

console.log('\n── 왕복(숫자 → 글자 → 숫자) ──')
for (const n of [1, 999, 1000, 13900, 450000, 1350000, 999999999]) {
  eq(`${n} 은 돌아와도 그대로`, parseMoney(formatMoney(n)), n)
}
eq('달러 1,200.25 왕복', parseMoney(formatMoney(1200.25, { decimals: 2 }), { decimals: 2 }), 1200.25)

console.log('\n── 커서 보정 ──')
// 「1234」 를 끝까지 친 순간 — 쉼표가 하나 생기고 커서는 **끝**에 남아야 한다.
eq('끝에 치는 중', moneyEdit('1234', 4), { text: '1,234', caret: 5, value: 1234 })
// 「1,234」 가운데(2 뒤, caret 3)에 5 를 넣어 「1,2534」 가 된 순간 → 「12,534」 의 5 뒤.
eq('가운데에 한 자 끼워 넣기', moneyEdit('1,2534', 4), { text: '12,534', caret: 4, value: 12534 })
// 맨 앞에 한 자 — 커서는 그 한 자 뒤다.
eq('맨 앞에 끼워 넣기', moneyEdit('91,234', 1), { text: '91,234', caret: 1, value: 91234 })
// 지우기 — 「1,234」 에서 4 를 지워 「1,23」 → 「123」, 커서는 끝.
eq('끝에서 지우기', moneyEdit('1,23', 4), { text: '123', caret: 3, value: 123 })
// 쉼표 자체를 지워도(「1234,567」 → 「1234567」) 숫자는 그대로다.
eq('쉼표를 지워도 수는 그대로', moneyEdit('1234567', 4), { text: '1,234,567', caret: 5, value: 1234567 })
// 붙여넣기 — 커서가 끝에 온 채로 들어온다.
eq('「1,234,567」 붙여넣기', moneyEdit('1,234,567', 9), { text: '1,234,567', caret: 9, value: 1234567 })
eq('「₩1,234,567원」 붙여넣기', moneyEdit('₩1,234,567원', 11), { text: '1,234,567', caret: 9, value: 1234567 })
// 전부 지우기
eq('전부 지우면 빈 칸·커서 0', moneyEdit('', 0), { text: '', caret: 0, value: null })
// 숫자 아닌 글자만 치면 아무것도 들어가지 않는다.
eq('글자만 치면 빈 칸', moneyEdit('abc', 3), { text: '', caret: 0, value: null })
// 달러 — 소수점을 치는 중(「1200.」)에도 글자가 살아 있어야 한다.
eq('달러 소수점 치는 중', moneyEdit('1200.', 5, { decimals: 2 }), { text: '1,200.', caret: 6, value: 1200 })
eq('달러 소수 두 자리', moneyEdit('1200.25', 7, { decimals: 2 }), { text: '1,200.25', caret: 8, value: 1200.25 })

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
