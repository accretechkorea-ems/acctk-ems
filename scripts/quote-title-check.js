// 제목줄(row_kind='title') 규칙 시험 — 번호·합계·견적서 줄.
//
//   node scripts/quote-title-check.js
//
// 왜 따로 두는가 — 제목줄은 **금액이 없는 줄**이라, 금액을 세는 자리마다 「이 줄은 빼야
// 한다」를 따로 지켜야 한다. 한 곳만 빠져도 조용히 틀린다.
//   번호   제목줄이 번호를 먹으면 그 아래 품목 번호가 하나씩 밀린다(견적서와 화면이 어긋난다).
//   합계   공급가·원가·이익에 0 이 아닌 값이 끼면 견적 금액이 달라진다.
//   견적서 글자가 비면 줄 자체를 내지 않는다 — 표 한가운데 까닭 없는 빈 칸이 남는다.
// PDF 를 그리지 않고 규칙 함수만 돌린다.

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

const { itemNumbers, isTitleRowKind, ROW_KIND_LABEL, ROW_KIND_ORDER } = load(path.join(ROOT, 'lib/quoteRowKinds.ts'))
const calc = load(path.join(ROOT, 'app/quote/calc.ts'))
const { buildFlatRows, buildEquipRows } = load(path.join(ROOT, 'app/quote/QuotePDFDoc.ts' + 'x'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

const RATE = { JPY: 9.2, USD: 1600 }
/** 금액이 있는 보통 품목 한 줄. */
const itemRow = (cost = 10000) => calc.calcRow({ ...calc.createManualJpyRow(), manual_cost_jpy: cost }, RATE)
const titleRow = (text) => calc.calcRow(calc.createTitleRow(text), RATE)

console.log('── 종류 ──')
eq('제목줄 이름', ROW_KIND_LABEL.title, '제목줄')
eq('추가 버튼 차례의 마지막', ROW_KIND_ORDER[ROW_KIND_ORDER.length - 1], 'title')
eq('판정', [isTitleRowKind('title'), isTitleRowKind('price_list'), isTitleRowKind(null)], [true, false, false])

console.log('\n── 번호는 품목만 센다 ──')
eq('제목줄은 번호를 먹지 않는다',
  itemNumbers([{ row_kind: 'price_list' }, { row_kind: 'title' }, { row_kind: 'manual_jpy' }, { row_kind: 'discount' }]),
  [1, null, 2, 3])
eq('맨 앞 제목줄', itemNumbers([{ row_kind: 'title' }, { row_kind: 'price_list' }]), [null, 1])
eq('제목줄이 둘 이상이어도 번호는 이어진다',
  itemNumbers([{ row_kind: 'title' }, { row_kind: 'price_list' }, { row_kind: 'title' }, { row_kind: 'price_list' }]),
  [null, 1, null, 2])
eq('제목줄만 있으면 번호가 없다', itemNumbers([{ row_kind: 'title' }]), [null])
eq('빈 목록', itemNumbers([]), [])

console.log('\n── 셈에 들지 않는다 ──')
const t = titleRow('예비품 견적서')
eq('금액 칸은 전부 0',
  [t.supply_price, t.product_price, t.profit, t.tax, t.unit_price, t.cost_price_jpy, t.quantity, t.profit_rate],
  [0, 0, 0, 0, 0, 0, 0, 0])
eq('글자는 그대로 남는다', t.itemText, '예비품 견적서')
const base = calc.calcTotals([itemRow(), itemRow(5000)])
const withTitle = calc.calcTotals([titleRow('구성품'), itemRow(), itemRow(5000)])
eq('제목줄을 끼워도 합계가 한 원도 움직이지 않는다', withTitle, base)
eq('제목줄만 있는 견적의 합계는 0',
  [calc.calcTotals([titleRow('제목')]).totalSupply, calc.calcTotals([titleRow('제목')]).totalProfit], [0, 0])

console.log('\n── 견적서 줄(파츠·20) ──')
const drawn = buildFlatRows([itemRow(), titleRow('옵션'), itemRow(5000)])
eq('제목줄은 가로 제목으로 나간다', drawn.map(d => d.kind), ['item', 'subtitle', 'item'])
eq('번호는 밀리지 않는다', drawn.filter(d => d.kind === 'item').map(d => d.no), ['1', '2'])
eq('제목 글자', drawn.find(d => d.kind === 'subtitle').label, '옵션')
eq('글자가 비면 줄 자체를 내지 않는다',
  buildFlatRows([titleRow(''), itemRow()]).map(d => d.kind), ['item'])
eq('공백만 적어도 내지 않는다',
  buildFlatRows([titleRow('   '), itemRow()]).map(d => d.kind), ['item'])

console.log('\n── 견적서 줄(장비 양식) ──')
// 제목줄은 묶음을 고를 수 없어 **묶음 없는 줄**로 들어간다. 거기서도 번호를 먹지 않는다.
const equipDrawn = buildEquipRows([
  { ...itemRow(), group_kind: 'base' },
  titleRow('별도 품목'),
  itemRow(5000),
])
eq('묶음 제목 → 품목 → 제목줄 → 품목', equipDrawn.map(d => d.kind), ['group', 'item', 'subtitle', 'item'])
eq('묶음 없는 줄의 번호도 제목줄을 건너뛴다',
  equipDrawn.filter(d => d.kind === 'item').map(d => d.no), ['1-1', '1'])

console.log('\n── 20 양식 자동 삽입의 판정(품목이 비었나) ──')
eq('새 견적은 비어 있다', calc.rowsAreEmpty([calc.createRow()]), true)
eq('품명을 적으면 비어 있지 않다',
  calc.rowsAreEmpty([{ ...calc.createRow(), itemText: '스타일러스' }]), false)
eq('구입가를 적으면 비어 있지 않다',
  calc.rowsAreEmpty([{ ...calc.createRow(), manual_cost_jpy: 1 }]), false)
eq('제목줄이 이미 있으면 비어 있지 않다',
  calc.rowsAreEmpty([calc.createTitleRow('예비품 견적서'), calc.createRow()]), false)
eq('빈 제목줄만 있으면 아직 비어 있다',
  calc.rowsAreEmpty([calc.createTitleRow(''), calc.createRow()]), true)

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
