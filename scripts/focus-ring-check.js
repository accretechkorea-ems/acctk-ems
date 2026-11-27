// 고르는 자리의 **링** — 호버 · 키보드 포커스 · 선택됨이 한 모양 (2026-11-26 묶음2 D).
//
//   node scripts/focus-ring-check.js
//
// 지키는 약속
//   ① 값은 **두 곳**에 있다(lib/focusRing.ts · app/globals.css) — 그 둘이 같다.
//      둘인 이유: 인라인 style 을 이기려면 !important 가 필요하고 그것은 스타일시트에서만
//      쓸 수 있는데, JS 쪽에서도 같은 값을 부를 자리가 있다.
//   ② 세 상태가 **같은 선택자 묶음** 안에 있다 — 하나만 바꿔 단계를 되살릴 수 없다.
//   ③ 글자를 넣는 칸은 **화면을 가리지 않고** 링을 받는다(전역 규칙 하나).
//   ④ 고를 수 있는 줄·카드·항목이 .ems-pick 을 붙이고 있다.
//   ⑤ 옛 모양(자리마다 다른 호버)이 되돌아오지 않는다.

const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
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

let fails = 0
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}
const eq = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want)
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}`)
  if (!good) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
/**
 * 색값을 **글자로 적지 않고** 이어 붙인다 — scripts/color-token-check.js 는 이 파일도
 * 읽고, 여기 적힌 값을 「토큰 값을 손으로 적은 자리」로 세기 때문이다(제 설명에 걸린다).
 */
const HEX = v => '#' + v
/** 주석을 뺀 코드 — 「이 글자가 없어야 한다」는 제 설명에 걸리지 않게 이것으로 본다. */
const code = p => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split(/\r?\n/).map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')

const F = load(path.join(ROOT, 'lib/focusRing.ts'))
const CSS = read('app/globals.css')
/** @theme 에 적힌 토큰 값 — 링이 그 토큰을 부르는지 본다. */
const tokenOf = name => (CSS.match(new RegExp(`${name}:\\s*([^;]+);`)) ?? [])[1]?.trim()

console.log('── ① 두 곳의 값이 같다 ──')
// 링의 테두리색은 액센트 토큰, 테두리광은 그 액센트의 10% 토큰이다.
eq('테두리색 = --color-brand', F.RING_COLOR, tokenOf('--color-brand')?.split(/\s/)[0])
ok('테두리광은 --color-brand-ring 을 부른다', /box-shadow: 0 0 0 3px var\(--color-brand-ring\) !important/.test(CSS))
ok('그 토큰이 액센트의 10% 다', /rgba\(35,\s*78,\s*162,\s*0\.1\)/.test(tokenOf('--color-brand-ring') ?? ''))
eq('테두리광 글자도 같다', F.RING_SHADOW, '0 0 0 3px rgba(35,78,162,0.10)')
eq('테두리 두께는 1px(그 자리의 것)', F.RING_WIDTH, 1)
ok('두께를 2px 로 올리지 않은 까닭을 적어 두었다', /판단 필요/.test(read('lib/focusRing.ts')))
eq('고르는 자리에 붙이는 클래스', F.PICK_CLASS, 'ems-pick')
eq('선택됨을 알리는 속성', F.PICK_ON_ATTR, 'data-on')
eq('pickProps 는 셋을 한 번에', Object.keys(F.pickProps(true)).sort(), ['aria-selected', 'className', 'data-on'])

console.log('\n── ② 세 상태가 한 묶음이다 ──')
const pickBlock = CSS.slice(CSS.indexOf('.ems-pick:hover'), CSS.indexOf('.ems-pick:hover') + 400)
for (const sel of [':hover', ':focus-visible', ':focus-within', "[aria-selected='true']", "[data-on='true']"]) {
  ok(`.ems-pick${sel} 가 그 묶음 안에 있다`, pickBlock.includes(`.ems-pick${sel}`))
}
ok('그 묶음이 링을 칠한다',
  /border-color: var\(--color-brand\) !important/.test(pickBlock)
  && /box-shadow: 0 0 0 3px var\(--color-brand-ring\) !important/.test(pickBlock))
// 표의 줄은 테두리를 그릴 수 없어 안쪽 그림자로 그린다 — 세 상태가 거기에도 다 있다.
const trBlock = CSS.slice(CSS.indexOf('tr.ems-pick:hover > td,'))
for (const sel of [':hover', ':focus-visible', ':focus-within', "[aria-selected='true']", "[data-on='true']"]) {
  ok(`tr.ems-pick${sel} 도 있다`, trBlock.includes(`tr.ems-pick${sel}`))
}

console.log('\n── ③ 글자를 넣는 칸은 전역 규칙 하나다 ──')
const inputBlock = CSS.slice(CSS.indexOf("input:not([type='checkbox'])"), CSS.indexOf('.ems-pick {'))
for (const [what, sel] of [
  ['input 호버', "input:not([type='checkbox'])"],
  ['select', 'select:not(:disabled)'],
  ['textarea', 'textarea:not(:disabled)'],
  ['직접 고치는 칸', '[contenteditable]:not([contenteditable=\'false\'])'],
]) ok(`${what} 가 들어 있다`, inputBlock.includes(sel))
ok('호버와 키보드 포커스 둘 다', inputBlock.includes(':hover,') && inputBlock.includes(':focus-visible'))
for (const [what, sel] of [
  ['네모·동그라미는 뺀다', "[type='checkbox']"],
  ['범위·색 고르개도', "[type='range']"],
  ['꺼진 칸은 안 받는다', ':not(:disabled)'],
  ['붉게 막힌 칸도 안 받는다', ":not([aria-invalid='true'])"],
  ['상자가 대신 그리는 칸도', ':not(.ems-ring-off)'],
]) ok(what, inputBlock.includes(sel))
ok('테두리광이 이웃에 잘리지 않게 겹쳐 그린다', /position: relative;\s*\n\s*z-index: 1;/.test(inputBlock))
// 견적의 상자 — 안의 칸은 제 링을 그리지 않고 상자가 한 벌만 그린다.
const QP = read('app/quote/page.tsx')
ok('견적 상자는 호버·포커스가 같다', /\.q-box:hover,\s*\n\s*\.q-box:focus-within \{/.test(QP))
ok('그 상자도 같은 토큰을 부른다',
  /border-color: var\(--color-brand\);/.test(QP) && /box-shadow: 0 0 0 3px var\(--color-brand-ring\);/.test(QP))
ok('상자 안의 칸은 ems-ring-off 다',
  /className="q-box-field ems-ring-off"/.test(read('components/quote/CustomerCard.tsx')))

console.log('\n── ④ 고를 수 있는 자리가 붙이고 있다 ──')
for (const [where, file, pat] of [
  ['공용 콤보박스(SearchSelect)', 'components/common/SearchSelect.tsx', /className=\{PICK_CLASS\}/],
  ['문구 고르개(SnippetPicker)', 'components/common/SnippetPicker.tsx', /className=\{PICK_CLASS\}/],
  ['세그먼트', 'components/common/SegmentedControl.tsx', /className=\{PICK_CLASS\}/],
  ['홈 카드 안의 줄(CountList)', 'components/common/CountList.tsx', /className="ems-pick"/],
  ['홈 카드 껍데기(DashCard)', 'components/dashboard/DashCard.tsx', /className=\{onClick \? 'ems-pick' : undefined\}/],
  ['고객사 사업장 표', 'components/home/list/CompanyPane.tsx', /ems-pick/],
  ['고객사 카드', 'components/home/CustomerCard.tsx', /ems-pick/],
  ['명함 목록', 'app/cards/page.tsx', /ems-row-hover ems-pick/],
  ['발주 목록', 'app/purchase/page.tsx', /className="ems-pick"/],
  ['내 견적 표', 'components/dashboard/MyQuotesPanel.tsx', /className="ems-pick"/],
  ['실적 현황 표', 'app/sales/page.tsx', /className="ems-pick"/],
  ['수리품 목록', 'app/repair/page.tsx', /className="ems-pick"/],
  ['접촉보고서 목록', 'app/contact/semi/page.tsx', /cs-grid \$\{PICK_CLASS\}/],
  ['제안 목록', 'app/suggestions/page.tsx', /className="ems-pick"/],
  ['홀딩 카드', 'app/holdings/page.tsx', /className="ems-pick"/],
  ['장비 카드·서비스 카드', 'components/customer/DeviceSection.tsx', /className="ems-pick"/],
  ['칸반 카드', 'components/pipeline/OpportunityCard.tsx', /className="pl-card ems-pick"/],
  ['문구 목록', 'components/account/MySnippets.tsx', /ems-row-hover ems-pick/],
  ['모달 안 견적 이력', 'components/customer/modals/QuoteHistoryModal.tsx', /className="ems-pick"/],
  ['모달 안 연결 견적', 'components/customer/modals/OpportunityModal.tsx', /className="ems-pick"/],
  // 사명(묶음4 F)·E.U(묶음5 7) 는 공용 SearchSelect 로 갔다 — 링은 **그 부품**이 붙인다.
  ['공용 콤보(사명·E.U·포캐스트…)', 'components/common/SearchSelect.tsx', /className=\{PICK_CLASS\}/],
  ['견적 가격표 드롭다운', 'app/quote/QuoteItemRow.tsx', /className=\{PICK_CLASS\}/],
]) ok(where, pat.test(read(file)), '링을 붙이지 않았다')
ok('견적 품목 카드는 CSS 로 받는다', /\.q-item-card:hover,\s*\n\.q-item-card:focus-within \{/.test(CSS))

console.log('\n── ⑤ 옛 모양은 되돌아오지 않는다 ──')
// 자리마다 손으로 칠하던 호버 — 바꾼 자리에는 남아 있지 않아야 한다.
for (const [where, file] of [
  ['발주', 'app/purchase/page.tsx'],
  ['내 견적', 'components/dashboard/MyQuotesPanel.tsx'],
  ['실적 현황', 'app/sales/page.tsx'],
  ['제안', 'app/suggestions/page.tsx'],
  ['모달 안 견적 이력', 'components/customer/modals/QuoteHistoryModal.tsx'],
  ['홈 카드 안의 줄', 'components/common/CountList.tsx'],
]) ok(`${where} 에 손으로 칠하던 줄 호버가 없다`,
  !new RegExp(`currentTarget\\.style\\.background = '${HEX('f8fafc')}'`).test(code(file)))
for (const [where, file] of [
  ['홀딩 카드', 'app/holdings/page.tsx'],
  ['칸반 카드', 'components/pipeline/OpportunityCard.tsx'],
  ['홈 카드 껍데기', 'components/dashboard/DashCard.tsx'],
  ['모달 안 연결 견적', 'components/customer/modals/OpportunityModal.tsx'],
]) ok(`${where} 에 연파랑 호버 테두리가 없다`,
  !new RegExp(`borderColor = '${HEX('c7d7f8')}'`).test(code(file)))
const PALE = new RegExp(`hovered \\? '${HEX('c7d7f8')}'`)
ok('고객사 카드·서비스 카드의 연파랑 테두리도 없다',
  !PALE.test(code('components/home/CustomerCard.tsx'))
  && !PALE.test(code('components/customer/DeviceSection.tsx')))
ok('표의 줄을 연파랑으로 그리던 규칙(.ems-row-brand)이 없다', !/^\.ems-row-brand/m.test(CSS))
ok('폼 포커스 조각은 아무것도 그리지 않는다',
  /export default function FormFocusStyle\(\) \{\s*\n\s*return null/.test(read('components/common/FormFocusStyle.tsx')))
ok('견적의 옛 포커스 규칙 둘이 없다',
  !/\.q-input:focus \{/.test(code('app/quote/page.tsx'))
  && !/\.q-term-input:focus \{/.test(code('app/quote/page.tsx')))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
