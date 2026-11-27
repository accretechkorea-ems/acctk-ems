// 실적 현황 — **팀 필터가 어디까지 걸리나** · 그래프 범위 (2026-11-27, 묶음6 1).
//
//   node scripts/sales-team-scope-check.js
//
// ── 무엇이 잘못돼 있었나 ──────────────────────────────────────────────────
//   요약 **여섯 칸**이 늘 「집계 대상 전원」을 봤다 — 팀을 골라도 숫자가 그대로였다.
//   같은 화면의 **그래프와 연간 누적**은 이미 팀을 따르고 있어서, 한 화면 안에서
//   위아래가 서로 다른 말을 했다.
//
//   그래프의 **가로축**도 기간과 어긋났다 — 연간을 고르면 네 칸(분기), H1 을 골라도
//   열두 칸이 그대로 섰다. 기간을 바꿀 때마다 축의 **뜻**이 바뀌니, 「연간에서 보던
//   11월 막대」를 월별로 옮기면 같은 것을 못 찾았다.
//
// 규칙은 순수 함수라 **돌려 본다**. 키 없이 서버 없이 돈다.

const load = module.require.bind(module)
const fs = load('fs')
const path = load('path')
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

const S = load(path.join(ROOT, 'lib/salesStats.ts'))
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const PAGE = read('app/sales/page.tsx')

let fails = 0
const ok = (name, good, extra) => {
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
}
const eq = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want)
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}`)
  if (!good) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

const E = (id, teams) => ({ engineer_id: id, teams })
const ALL = [E(1, '80CS'), E(2, '80CS'), E(3, '20수리'), E(4, '임원')]
const VISIBLE = ALL                       // 슈퍼관리자 — 전부 보인다
const ONLY_ME = [E(4, '임원')]            // 그 밖 — 자기 것만 보인다

console.log('── ① 요약 여섯 칸이 보는 사람들 ──')
eq('「전체」면 **보이는 사람 전부**', S.scopeEngineersOf(null, VISIBLE).map(e => e.engineer_id), [1, 2, 3, 4])
eq('팀을 고르면 그 팀만', S.scopeEngineersOf('80CS', VISIBLE).map(e => e.engineer_id), [1, 2])
eq('다른 팀', S.scopeEngineersOf('20수리', VISIBLE).map(e => e.engineer_id), [3])
// 권한이 좁은 사람은 남의 팀을 골라도 남의 숫자를 보지 못한다 — 그래프와 같은 규칙이다.
eq('볼 수 없는 팀을 고르면 빈 목록', S.scopeEngineersOf('80CS', ONLY_ME).map(e => e.engineer_id), [])
eq('없는 팀', S.scopeEngineersOf('없는팀', VISIBLE), [])
// 2026-11-28(야간4 1) — 「전체」도 **보이는 사람**으로 좁혔다. 그 전에는 권한이 좁은
// 사람에게도 여섯 칸이 전사 금액을 보여 주었다(그래프는 그 사람 것만 보여 주는데도).
ok('권한이 좁으면 「전체」도 제 것만 본다',
  S.scopeEngineersOf(null, ONLY_ME).length === 1)
ok('권한이 넓으면 「전체」가 전원이다', S.scopeEngineersOf(null, VISIBLE).length === 4)

console.log('\n── ② 화면이 그 규칙을 쓴다 ──')
ok('여섯 칸의 사람들을 한 줄로 정한다', /const scopeEngineers = scopeEngineersOf\(teamFilter, visibleEngineers\)/.test(PAGE))
ok('그 사람들의 견적만 센다',
  /sumQuotes = quotes\.filter\(q => matchPeriod\(q\.quote_date, fy\) && scopeIds\.includes\(q\.engineer_id\)\)/.test(PAGE)
  && /sumOrderQuotes = quotes\.filter\(q => inOrderPeriod\(q, fy\) && scopeIds\.includes\(q\.engineer_id\)\)/.test(PAGE)
  && /sumRevenueQuotes = quotes\.filter\(q => inRevenuePeriod\(q, fy\) && scopeIds\.includes\(q\.engineer_id\)\)/.test(PAGE))
ok('여섯 칸이 그 집합을 쓴다',
  /totalQuoteAmt = sumQuotes/.test(PAGE) && /totalOrderAmt = sumOrderQuotes/.test(PAGE) && /totalRevenueAmt = sumRevenueQuotes/.test(PAGE))
// 목표도 같은 사람들로 — 팀 목표는 그 팀 사람들의 개인 목표 합이다.
ok('목표 합도 같은 사람들로 낸다', /scopeEngineers\.reduce\(\(s, e\) =>/.test(PAGE))
ok('전사만 보던 옛 집합이 없다', !/allFilteredQuotes/.test(PAGE) && !/allOrderQuotes/.test(PAGE) && !/allRevenueQuotes/.test(PAGE))
ok('그래프·연간 누적은 전부터 팀을 따른다', /engineerIds=\{filteredEngineerIds\}/.test(PAGE) && /engineerIds: filteredEngineerIds/.test(PAGE))
// 여섯 칸·그래프·연간 누적이 **한 목록**을 본다 — 한 화면에서 위아래가 다른 말을 하지 않게.
ok('전사만 보던 목록이 화면에 남아 있지 않다', !/allEngineers/.test(PAGE) && !/allEngineerIds/.test(PAGE))
ok('제목이 팀 이름과 잔여 일수를 적는다',
  /\{teamFilter \? teamFilter : '계측사업부'\} \{periodTitle\(mode, fy, month\)\} 실적/.test(PAGE) && /remainingLabel/.test(PAGE))

console.log('\n── ③ 그래프 범위가 기간을 따른다 ──')
// 단위는 늘 달이고, 기간은 **보여 주는 범위**만 바꾼다. 한 칸의 수치는 어디서 보든 같다.
const PG = load(path.join(ROOT, 'app/sales/page.tsx'))
eq('연간 — 열두 달', [...PG.chartMonthsOf('year')], [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3])
eq('H1 — 4~9월', [...PG.chartMonthsOf('h1')], [4, 5, 6, 7, 8, 9])
eq('H2 — 10~3월', [...PG.chartMonthsOf('h2')], [10, 11, 12, 1, 2, 3])
eq('Q1', [...PG.chartMonthsOf('q1')], [4, 5, 6])
eq('Q3 — 회계연도 셋째 분기', [...PG.chartMonthsOf('q3')], [10, 11, 12])
eq('Q4 — 해를 넘는다', [...PG.chartMonthsOf('q4')], [1, 2, 3])
// 월별은 열두 칸을 다 둔다 — 한 칸만 그리면 많은지 적은지를 알 수 없다.
eq('월별 — 열두 달 그대로', [...PG.chartMonthsOf('month')], [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3])
eq('단위는 늘 달이다', PG.chartUnitOf('year'), 'month')
// 고른 칸(밑줄)은 **월별에만** 있다 — 나머지는 범위지 한 칸이 아니다.
eq('월별은 그 달에 밑줄', PG.selectedBarKey('month', 2026, 11), '2026-11')
eq('1~3월은 다음 해로 센다', PG.selectedBarKey('month', 2026, 2), '2027-2')
eq('연간에는 고른 칸이 없다', PG.selectedBarKey('year', 2026, 11), null)
eq('분기에도 없다', PG.selectedBarKey('q3', 2026, 11), null)
ok('그린 뒤 기간에 맞는 달만 남긴다', /\.filter\(b => months\.includes\(Number\(b\.key\.split\('-'\)\[1\]\)\)\)/.test(PAGE))

console.log(fails === 0 ? '\n전부 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
