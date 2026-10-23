// 국내조달품 줄 시험 — 일반 품목이 된 뒤의 계산과, 옛 줄을 건드리지 않는다는 약속.
//
//   node scripts/quote-domestic-check.js
//
// 왜 따로 두는가 — 이 줄의 뜻이 2026-10-23 에 바뀌었다(숨는 자사 부담 비용 → 일반 품목).
// 바뀐 쪽은 매출·부가세·이익에 들어가므로 **금액이 틀리면 고객에게 나가는 견적서가 틀린다**.
// 그리고 옛 줄(묶음도 판매단가도 없는 줄)은 여전히 숨어야 한다 — 지난 견적을 다시 그릴 때
// 없던 금액이 생기면 되돌릴 수 없다.

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

const { domesticRole, showsOnQuote, isBillableRow } = load(path.join(ROOT, 'lib/quoteDomestic.ts'))
const { calcRow, calcTotals, createDomesticRow } = load(path.join(ROOT, 'app/quote/calc.ts'))
const { profitBreakdown } = load(path.join(ROOT, 'lib/quoteProfit.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

const dom = (over = {}) => ({ ...createDomesticRow(), ...over })

console.log('── 역할 판정 ──')
eq('묶음 include → 포함사항', domesticRole({ row_kind: 'domestic', group_kind: 'include', unit_price: 0 }), 'include')
eq('포함사항은 값이 적혀 있어도 포함사항', domesticRole({ row_kind: 'domestic', group_kind: 'include', unit_price: 50000 }), 'include')
eq('묶음 없음 + 판매단가 0 → 옛 규칙(숨김)', domesticRole({ row_kind: 'domestic', group_kind: null, unit_price: 0 }), 'hidden')
eq('묶음 없음 + 판매단가 있음 → 일반 품목', domesticRole({ row_kind: 'domestic', group_kind: null, unit_price: 120000 }), 'item')
eq('묶음 base → 일반 품목', domesticRole({ row_kind: 'domestic', group_kind: 'base', unit_price: 0 }), 'item')
eq('묶음 option → 일반 품목', domesticRole({ row_kind: 'domestic', group_kind: 'option', unit_price: 0 }), 'item')
eq('domestic 이 아닌 줄은 늘 일반 품목', domesticRole({ row_kind: 'price_list', group_kind: null, unit_price: 0 }), 'item')
eq('빈 값도 일반 품목(부르는 쪽이 또 묻지 않게)', [domesticRole(null), domesticRole(undefined)], ['item', 'item'])

console.log('\n── 견적서에 나오는가 ──')
eq('일반 품목은 나온다', showsOnQuote({ row_kind: 'domestic', group_kind: null, unit_price: 1 }), true)
eq('포함사항도 나온다(금액은 「-」)', showsOnQuote({ row_kind: 'domestic', group_kind: 'include', unit_price: 0 }), true)
eq('옛 줄만 안 나온다', showsOnQuote({ row_kind: 'domestic', group_kind: null, unit_price: 0 }), false)
eq('가격표 품목은 당연히 나온다', showsOnQuote({ row_kind: 'price_list', unit_price: 0 }), true)

console.log('\n── 매출에 더하는가 ──')
eq('일반 품목은 더한다', isBillableRow({ row_kind: 'domestic', group_kind: null, unit_price: 1 }), true)
eq('포함사항은 안 더한다', isBillableRow({ row_kind: 'domestic', group_kind: 'include', unit_price: 50000 }), false)
eq('옛 줄도 안 더한다', isBillableRow({ row_kind: 'domestic', group_kind: null, unit_price: 0 }), false)
eq('할인은 더한다(음수로 깎인다)', isBillableRow({ row_kind: 'discount', unit_price: 0 }), true)

console.log('\n── 계산: 이익률로 역산 + 천원 올림 ──')
{
  // 원가 100,000원 · 이익률 40% → 166,666.67 → 천원 올림 167,000
  const r = calcRow(dom({ manual_cost_jpy: 100000, profit_rate: 40, quantity: 2, price_mode: 'rate' }), 9.5)
  eq('단가(천원 올림)', r.unit_price, 167000)
  eq('공급가', r.supply_price, 334000)
  eq('부가세 10%', r.tax, 33400)
  eq('원가(환율·관세 없음)', r.product_price, 200000)
  eq('이익', r.profit, 134000)
  eq('실현 이익률', Number(r.realized_profit_rate.toFixed(4)), 40.1198)
  eq('관세율은 1 로 둔다', r.tariff_rate, 1)
  eq('환율은 원가에 쓰이지 않는다', r.product_price, 200000)
}

console.log('\n── 계산: 판매단가 직접 입력은 올리지 않는다 ──')
{
  const r = calcRow(dom({ manual_cost_jpy: 100000, manual_unit_price: 123456, quantity: 1, price_mode: 'price' }), 9.5)
  eq('단가 그대로', r.unit_price, 123456)
  eq('공급가', r.supply_price, 123456)
  eq('부가세', r.tax, 12346)
  eq('원가', r.product_price, 100000)
  eq('이익', r.profit, 23456)
}

console.log('\n── 계산: 원가가 없으면 금액도 없다 ──')
{
  const r = calcRow(dom({ manual_cost_jpy: 0, profit_rate: 40, quantity: 1, price_mode: 'rate' }), 9.5)
  eq('단가 0', r.unit_price, 0)
  eq('공급가 0', r.supply_price, 0)
  eq('이익 0', r.profit, 0)
}

console.log('\n── 합계: 일반 품목으로 들어간다 ──')
{
  const normal = calcRow(dom({ manual_cost_jpy: 100000, manual_unit_price: 200000, quantity: 1, price_mode: 'price' }), 9.5)
  const t = calcTotals([normal])
  eq('매출에 든다', t.totalSupply, 200000)
  eq('부가세에 든다', t.totalTax, 20000)
  eq('원가에 든다', t.totalCost, 100000)
  eq('이익 = 매출 − 원가', t.totalProfit, 100000)
  eq('국내조달품 원가 표시값', t.domesticCost, 100000)
}

console.log('\n── 합계: 포함사항은 원가만 ──')
{
  const inc = calcRow(dom({ manual_cost_jpy: 300000, manual_unit_price: 0, quantity: 1, price_mode: 'price', group_kind: 'include' }), 9.5)
  const t = calcTotals([inc])
  eq('매출 0', t.totalSupply, 0)
  eq('부가세 0', t.totalTax, 0)
  eq('원가에는 든다', t.totalCost, 300000)
  eq('이익은 음수(원가만 얹혔다)', t.totalProfit, -300000)
}

console.log('\n── 합계: 옛 줄도 원가만(지난 견적이 바뀌지 않는다) ──')
{
  // 옛 줄 모양 — 묶음 없음 · 판매단가 0 · 원가만 있다.
  const old = calcRow(dom({ manual_cost_jpy: 250000, manual_unit_price: 0, quantity: 1, price_mode: 'price', group_kind: null }), 9.5)
  eq('역할은 숨김', domesticRole(old), 'hidden')
  const t = calcTotals([old])
  eq('매출 0', t.totalSupply, 0)
  eq('원가에만 든다', t.totalCost, 250000)
}

console.log('\n── 판관비·영업이익은 매출 기준이라 함께 움직인다 ──')
{
  const normal = calcRow(dom({ manual_cost_jpy: 1000000, manual_unit_price: 2000000, quantity: 1, price_mode: 'price' }), 9.5)
  const t = calcTotals([normal])
  const b = profitBreakdown(t.totalSupply, t.totalCost, 'TSE')
  eq('매출 200만', b.revenue, 2000000)
  eq('매출이익 100만', b.grossProfit, 1000000)
  eq('판관비 30% = 60만', b.sga, 600000)
  eq('영업이익 40만', b.operatingProfit, 400000)
  eq('영업이익률 20%', b.operatingRate, 20)
}

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
