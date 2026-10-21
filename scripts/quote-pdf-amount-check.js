// 견적서(PDF) **금액 칸** 규칙 시험 — 줄 하나에 무엇이 찍히는가.
//
//   node scripts/quote-pdf-amount-check.js
//
// 왜 따로 두는가 — 이 규칙은 셋이 섞여 있어서 한쪽을 고치면 다른 쪽이 조용히 틀어진다.
//   할인 줄        음수 금액(「− ₩ 30,000」)
//   포함사항·원가 줄 「-」
//   그 밖          단가·공급가액 그대로
// 실제로 그렇게 틀어진 적이 있다 — 할인은 단가가 0 이라서 「단가 0 이면 금액 없음」 규칙에
// 같이 걸려 공급가액이 「-」로만 찍혔다(합계에는 −30,000 이 들어가 있는데 줄에는 안 보였다).
//
// PDF 를 그리지 않고 규칙 함수(rowAmountCells)만 돌린다 — 세 양식이 그 함수를 함께 쓴다.

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

// .ts/.tsx 를 그대로 require 한다(규칙 함수가 PDF 컴포넌트 파일에 있다).
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    const src = load('fs').readFileSync(filename, 'utf8')
    const out = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        esModuleInterop: true, jsx: ts.JsxEmit.React,
      },
      fileName: filename,
    }).outputText
    mod._compile(out, filename)
  }
}
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(ROOT, req.slice(2))
  return origResolve.call(this, req, ...rest)
}

const { rowAmountCells, won } = load(path.join(ROOT, 'app/quote/QuotePDFDoc.ts' + 'x'))
const calc = load(path.join(ROOT, 'app/quote/calc.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

const RATE = 9.2

// ── 할인 줄 ────────────────────────────────────────────────────────────────
console.log('── 할인 줄은 음수 금액을 찍는다 ──')
const discount = calc.calcRow({ ...calc.createDiscountRow(), manual_unit_price: 30000 }, RATE)
eq('할인 줄의 공급가는 음수다', discount.supply_price, -30000)
eq('단가는 0 이다(그래서 「-」 규칙에 걸리던 것)', discount.unit_price, 0)
eq('공급가액 칸 — 음수 금액', rowAmountCells(discount, false).supply, won(-30000))
eq('음수 표기 모양', won(-30000), '− ₩ 30,000')
eq('단가 칸은 비운다', rowAmountCells(discount, false).unit, '')
eq('「-」가 아니다', rowAmountCells(discount, false).supply === '-', false)
eq('수량은 0 이라 칸이 빈다(줄 그리기 규칙)', discount.quantity, 0)

// ── 포함사항 ──────────────────────────────────────────────────────────────
console.log('\n── 포함사항은 「-」 ──')
const incFree = calc.calcRow({ ...calc.createRow(), itemText: 'PC세트', price_mode: 'price', manual_unit_price: 0, quantity: 2 }, RATE)
eq('가격 없는 구성품 — 「-」', rowAmountCells(incFree, true).supply, '-')
eq('단가 칸은 비운다', rowAmountCells(incFree, true).unit, '')

// 원화 원가 줄(포함사항 묶음) — 단가가 0 이 아니어도 「-」여야 한다.
const incCost = calc.calcRow({ ...calc.createDomesticRow(), itemText: '측정 테이블', manual_unit_price: 1500000, quantity: 1, group_kind: 'include' }, RATE)
eq('원가 줄의 단가는 0 이 아니다', incCost.unit_price, 1500000)
eq('그래도 공급가액은 「-」', rowAmountCells(incCost, true).supply, '-')
eq('단가 칸도 비운다', rowAmountCells(incCost, true).unit, '')

// ── 보통 줄 ───────────────────────────────────────────────────────────────
console.log('\n── 보통 줄은 금액을 그대로 ──')
const normal = calc.calcRow({ ...calc.createRow(), price_mode: 'price', manual_unit_price: 250000, quantity: 3 }, RATE)
eq('단가', rowAmountCells(normal, false).unit, won(250000))
eq('공급가액', rowAmountCells(normal, false).supply, won(750000))

const empty = calc.calcRow({ ...calc.createRow() }, RATE)
eq('아직 품목을 고르지 않은 줄 — 「-」', rowAmountCells(empty, false).supply, '-')

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
