// 실적 집계 대상 판정 시험 — 개인 값이 팀 값을 덮는 규칙.
//
//   node scripts/sales-scope-check.js
//
// 왜 따로 두는가 — 이 판정 하나가 실적 현황·활동 현황·포캐스트 엑셀·홈 「내 실적」 넷을
// 가른다. 예전 판정(메뉴 권한 파생)의 함정이 「메뉴를 켜면 집계에서 빠진다」였으므로,
// **메뉴와 무관하다**는 것도 여기서 못 박는다.

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
  inSalesStats, scopeChoiceOf, scopeValueOf, SCOPE_LABELS,
} = load(path.join(ROOT, 'lib/salesScope.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

const teamIn = { inSalesStats: true, menus: new Set(), division: '계측' }
const teamOut = { inSalesStats: false, menus: new Set(), division: '계측' }

console.log('── 팀 값만 있을 때 ──')
eq('대상 팀 · 개인 미설정 → 포함', inSalesStats({ in_sales_stats: null, perm: teamIn }), true)
eq('비대상 팀 · 개인 미설정 → 제외', inSalesStats({ in_sales_stats: null, perm: teamOut }), false)
eq('개인 값 칸이 아예 없어도 팀을 따른다', inSalesStats({ perm: teamIn }), true)

console.log('\n── 개인 값이 팀을 덮는다 ──')
eq('비대상 팀 + 개인 포함 → 포함', inSalesStats({ in_sales_stats: true, perm: teamOut }), true)
eq('대상 팀 + 개인 제외 → 제외', inSalesStats({ in_sales_stats: false, perm: teamIn }), false)

console.log('\n── 모를 때는 제외 ──')
eq('팀 권한을 아직 못 읽음 → 제외', inSalesStats({ in_sales_stats: null, perm: null }), false)
eq('팀 미배정 → 제외', inSalesStats({ in_sales_stats: null }), false)
eq('직원 자체가 없음 → 제외', inSalesStats(null), false)
eq('팀을 못 읽어도 개인 포함은 살린다', inSalesStats({ in_sales_stats: true, perm: null }), true)

console.log('\n── 메뉴와 무관하다 ──')
{
  // 예전 판정은 'sales'·'admin'·'approvals' 메뉴가 켜지면 집계에서 빠뜨렸다.
  const withSalesMenu = { inSalesStats: true, menus: new Set(['sales', 'admin', 'approvals']), division: '계측' }
  eq('실적 현황·관리·전자결재 메뉴를 다 켜도 포함', inSalesStats({ in_sales_stats: null, perm: withSalesMenu }), true)
  const noMenus = { inSalesStats: true, menus: new Set(), division: '계측' }
  eq('메뉴가 하나도 없어도 팀 값이 켜져 있으면 포함', inSalesStats({ in_sales_stats: null, perm: noMenus }), true)
}

console.log('\n── 목록을 통째로 판정할 때(맵에서 꺼낸 팀 값을 직접 넘긴다) ──')
eq('두 번째 인자가 engineer.perm 보다 먼저다', inSalesStats({ in_sales_stats: null, perm: teamOut }, teamIn), true)
eq('개인 값은 두 번째 인자보다도 세다', inSalesStats({ in_sales_stats: false, perm: teamIn }, teamIn), false)

console.log('\n── 선택칸 값 ──')
eq('저장값 → 선택', [scopeChoiceOf(true), scopeChoiceOf(false), scopeChoiceOf(null), scopeChoiceOf(undefined)],
  ['in', 'out', 'team', 'team'])
eq('선택 → 저장값', [scopeValueOf('in'), scopeValueOf('out'), scopeValueOf('team')], [true, false, null])
eq('왕복해도 같다', [scopeValueOf(scopeChoiceOf(true)), scopeValueOf(scopeChoiceOf(false)), scopeValueOf(scopeChoiceOf(null))],
  [true, false, null])
eq('이름 셋', [SCOPE_LABELS.team, SCOPE_LABELS.in, SCOPE_LABELS.out], ['팀 설정', '포함', '제외'])

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
