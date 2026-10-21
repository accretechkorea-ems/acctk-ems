// 장비 구성 「견적에 추가 → 예」가 **무엇을 지우는가** 시험.
//
//   node scripts/equip-replace-check.js
//
// 왜 따로 두는가 — 「예」는 사람이 적어 둔 줄을 **지우는** 길이다. 규칙이 한 칸만 넓어져도
// 할인·서비스비·국내조달품 수동 줄이 조용히 사라지고, 그걸 알아채는 건 견적서를 보낸 뒤다.
//   지운다  품목 줄(price_list·manual_jpy), 구성 묶음에 든 원화 원가 줄(domestic+group_kind)
//   남긴다  할인·서비스비, 묶음 없는 국내조달품 수동 줄
// 화면을 그리지 않고 규칙 함수(isEquipReplaceable)와 줄 합치기만 돌린다.

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

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

const { isEquipReplaceable } = load(path.join(ROOT, 'components/quote/equip/equipLines.ts'))
const calc = load(path.join(ROOT, 'app/quote/calc.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

const RATE = 9.2
const mk = (row, over) => calc.calcRow({ ...row, ...over }, RATE)

// ── 지우는 줄 ──────────────────────────────────────────────────────────────
console.log('── 「예」가 지우는 줄 ──')
eq('가격표 품목 줄', isEquipReplaceable(mk(calc.createRow(), { itemText: 'E-DT-SS12A' })), true)
eq('직접 적은 엔화 줄', isEquipReplaceable(mk(calc.createManualJpyRow(), { manual_cost_jpy: 120000 })), true)
eq('구성 묶음에 든 원화 원가 줄(포함사항)',
  isEquipReplaceable(mk(calc.createDomesticRow(), { manual_unit_price: 1500000, group_kind: 'include' })), true)
eq('본체 묶음의 원화 원가 줄',
  isEquipReplaceable(mk(calc.createDomesticRow(), { manual_unit_price: 300000, group_kind: 'base' })), true)

// ── 남기는 줄 ──────────────────────────────────────────────────────────────
console.log('\n── 「예」가 남기는 줄 ──')
eq('할인 줄', isEquipReplaceable(mk(calc.createDiscountRow(), { manual_unit_price: 30000 })), false)
eq('서비스비 줄', isEquipReplaceable(mk(calc.createServiceRow(), { manual_unit_price: 500000 })), false)
eq('묶음 없는 국내조달품 수동 줄',
  isEquipReplaceable(mk(calc.createDomesticRow(), { manual_unit_price: 800000 })), false)
eq('묶음값이 엉뚱한 국내조달품 줄은 남긴다(base/option/include 만 본다)',
  isEquipReplaceable(mk(calc.createDomesticRow(), { manual_unit_price: 800000, group_kind: 'domestic' })), false)

// ── 줄 합치기 — 런처의 규칙을 같은 모양으로 돌려 본다 ──────────────────────
console.log('\n── 줄 합치기 ──')
const merge = (prev, added, discount, mode) => {
  const kept = mode === 'replace' ? prev.filter(r => !isEquipReplaceable(r)) : prev
  const next = [...kept, ...added]
  return discount && !kept.some(r => r.row_kind === 'discount') ? [...next, discount] : next
}
const prev = [
  mk(calc.createRow(), { itemText: '기존 품목' }),
  mk(calc.createManualJpyRow(), { manual_cost_jpy: 1000 }),
  mk(calc.createDomesticRow(), { manual_unit_price: 1, group_kind: 'include' }),
  mk(calc.createDomesticRow(), { manual_unit_price: 2 }),
  mk(calc.createServiceRow(), { manual_unit_price: 3 }),
  mk(calc.createDiscountRow(), { manual_unit_price: 4 }),
]
const added = [mk(calc.createRow(), { itemText: '새 구성 1' }), mk(calc.createRow(), { itemText: '새 구성 2' })]

const kinds = rows => rows.map(r => r.row_kind)
eq('아니오 — 기존 6줄 뒤에 2줄', kinds(merge(prev, added, null, 'append')).length, 8)
eq('예 — 남는 줄은 국내조달품 수동·서비스비·할인 + 새 2줄',
  kinds(merge(prev, added, null, 'replace')), ['domestic', 'service', 'discount', 'price_list', 'price_list'])
eq('예 — 할인은 그대로 남는다', merge(prev, added, null, 'replace').filter(r => r.row_kind === 'discount').length, 1)
eq('예 — 모달 할인은 기존 할인 줄이 있으면 붙지 않는다',
  merge(prev, added, mk(calc.createDiscountRow(), { manual_unit_price: 9 }), 'replace')
    .filter(r => r.row_kind === 'discount').length, 1)
eq('예 — 기존 할인이 없으면 모달 할인이 붙는다',
  merge(prev.filter(r => r.row_kind !== 'discount'), added, mk(calc.createDiscountRow(), { manual_unit_price: 9 }), 'replace')
    .filter(r => r.row_kind === 'discount').length, 1)
eq('지울 품목 줄 수 — 확인창의 N', prev.filter(isEquipReplaceable).length, 3)

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
