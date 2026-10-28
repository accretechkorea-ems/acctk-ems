// 「내 설정 기억」의 최빈값 규칙 시험 — 어느 줄을 세고, 같은 횟수면 무엇을 고르는가.
//
//   node scripts/quote-defaults-check.js
//
// 왜 따로 두는가 — 이 숫자는 **다음 견적의 출발값**이다. 틀리면 다음 견적이 엉뚱한 관세·
// 이익률로 시작하고, 사람은 「원래 그런 값이었나」 하고 그대로 확정한다. 금액이 조용히
// 틀어지는 길이라 규칙을 글이 아니라 시험으로 못 박는다.

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

const { countsForDefaults, defaultsFromRows } = load(path.join(ROOT, 'lib/quoteUserDefaults.ts'))
const { createRow, createManualJpyRow, createDomesticRow, createServiceRow, createDiscountRow } =
  load(path.join(ROOT, 'app/quote/calc.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

/** 품목 줄 하나 — 세는 칸만 채운다. */
const row = (o) => ({ row_kind: 'price_list', price_mode: 'rate', tariff_rate: 1.13, profit_rate: 60, ...o })

console.log('── 1. 어느 줄을 세는가 ──')
eq('가격표·이익률 모드는 센다', countsForDefaults(row({})), true)
eq('수동입력도 센다', countsForDefaults(row({ row_kind: 'manual_jpy' })), true)
eq('판매가 모드는 세지 않는다', countsForDefaults(row({ price_mode: 'price' })), false)
eq('국내조달품은 세지 않는다', countsForDefaults(row({ row_kind: 'domestic' })), false)
eq('서비스비는 세지 않는다', countsForDefaults(row({ row_kind: 'service' })), false)
eq('할인은 세지 않는다', countsForDefaults(row({ row_kind: 'discount' })), false)
eq('price_mode 가 없으면 이익률 모드로 본다', countsForDefaults({ row_kind: 'price_list' }), true)

console.log('\n── 2. 실제 줄 만들기 함수와 맞는가 ──')
eq('createRow 는 센다', countsForDefaults(createRow('TSE')), true)
eq('createManualJpyRow 는 센다', countsForDefaults(createManualJpyRow('TSE')), true)
eq('createDomesticRow 는 세지 않는다', countsForDefaults(createDomesticRow('TSE')), false)
eq('createServiceRow 는 세지 않는다', countsForDefaults(createServiceRow()), false)
eq('createDiscountRow 는 세지 않는다', countsForDefaults(createDiscountRow()), false)

console.log('\n── 3. 최빈값 ──')
eq('한 줄이면 그 값', defaultsFromRows([row({ tariff_rate: 1.13, profit_rate: 60 })]),
  { tariffRate: 1.13, marginRate: 60 })
eq('가장 많은 값을 고른다', defaultsFromRows([
  row({ tariff_rate: 1.13, profit_rate: 55 }),
  row({ tariff_rate: 1.08, profit_rate: 55 }),
  row({ tariff_rate: 1.08, profit_rate: 60 }),
  row({ tariff_rate: 1.08, profit_rate: 50 }),
]), { tariffRate: 1.08, marginRate: 55 })
eq('같은 횟수면 먼저 나온 값', defaultsFromRows([
  row({ tariff_rate: 1.2, profit_rate: 45 }),
  row({ tariff_rate: 1.1, profit_rate: 50 }),
]), { tariffRate: 1.2, marginRate: 45 })
eq('관세와 이익률은 따로 센다', defaultsFromRows([
  row({ tariff_rate: 1.13, profit_rate: 40 }),
  row({ tariff_rate: 1.13, profit_rate: 60 }),
  row({ tariff_rate: 1.05, profit_rate: 60 }),
]), { tariffRate: 1.13, marginRate: 60 })

console.log('\n── 4. 세지 않는 줄은 최빈값에 끼지 않는다 ──')
eq('국내조달·할인이 섞여도 가격표 줄만 센다', defaultsFromRows([
  row({ tariff_rate: 1.13, profit_rate: 60 }),
  { row_kind: 'domestic', price_mode: 'rate', tariff_rate: 1, profit_rate: 30 },
  { row_kind: 'domestic', price_mode: 'rate', tariff_rate: 1, profit_rate: 30 },
  { row_kind: 'discount', price_mode: 'rate', tariff_rate: 0, profit_rate: 0 },
]), { tariffRate: 1.13, marginRate: 60 })
eq('판매가 모드 줄이 더 많아도 이익률 모드만 센다', defaultsFromRows([
  row({ price_mode: 'price', tariff_rate: 1.3, profit_rate: 90 }),
  row({ price_mode: 'price', tariff_rate: 1.3, profit_rate: 90 }),
  row({ tariff_rate: 1.13, profit_rate: 60 }),
]), { tariffRate: 1.13, marginRate: 60 })

console.log('\n── 5. 셀 것이 없으면 null (쓰지 않는다) ──')
eq('줄이 없다', defaultsFromRows([]), { tariffRate: null, marginRate: null })
eq('전부 판매가 모드', defaultsFromRows([row({ price_mode: 'price' })]), { tariffRate: null, marginRate: null })
eq('서비스비만 있는 견적', defaultsFromRows([createServiceRow()]), { tariffRate: null, marginRate: null })
eq('이익률 0 은 기억하지 않는다', defaultsFromRows([row({ profit_rate: 0 })]),
  { tariffRate: 1.13, marginRate: null })
eq('관세 0 도 기억하지 않는다', defaultsFromRows([row({ tariff_rate: 0 })]),
  { tariffRate: null, marginRate: 60 })
eq('음수·NaN 도 빠진다', defaultsFromRows([row({ tariff_rate: -1, profit_rate: NaN })]),
  { tariffRate: null, marginRate: null })

console.log('\n── 6. 새 줄 기본값이 저장된 설정을 따른다(calc.ts) ──')
{
  const d = { tariffRate: 1.05, marginRate: 52 }
  eq('품목 줄', [createRow('TSE', d).tariff_rate, createRow('TSE', d).profit_rate], [1.05, 52])
  eq('수동입력 줄', [createManualJpyRow('TSE', d).tariff_rate, createManualJpyRow('TSE', d).profit_rate], [1.05, 52])
  // 국내조달품은 관세를 쓰지 않는다 — 저장된 값이 있어도 1 이다.
  eq('국내조달품은 관세 1 유지', [createDomesticRow('TSE', d).tariff_rate, createDomesticRow('TSE', d).profit_rate], [1, 52])
  eq('설정이 없으면 종전 기본값', [createRow('TSE').tariff_rate, createRow('TSE').profit_rate], [1.13, 60])
  eq('분류가 없으면 40', [createRow().tariff_rate, createRow().profit_rate], [1.13, 40])
  eq('빈 설정은 종전 기본값', [createRow('SBS', { tariffRate: null, marginRate: null }).tariff_rate,
    createRow('SBS', { tariffRate: null, marginRate: null }).profit_rate], [1.13, 26])
}

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
