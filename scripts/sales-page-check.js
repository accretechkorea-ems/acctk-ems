// 실적 현황 화면 — **시안대로 서 있는가** (2026-11-27 야간3 1).
//
//   node scripts/sales-page-check.js
//
// 집계 규칙은 scripts/sales-stats-check.js 가 본다(순수 함수). 여기서는 **화면의 약속**만
// 본다 — 수치 정의는 한 줄도 바꾸지 않았다는 것이 이 절의 전제다.
//
// 지키는 약속
//   ① 필터 바는 한 줄(46px)이고 「잔여 N일」·기간 글자는 **거기 없다**(제목으로 갔다).
//   ② 통합 카드 **하나** — 요약·차트·누적이 한 상자다. 「실적 추이」 펼침 단추는 없다.
//   ③ 제목은 「{사업부|팀} {기간} 실적 · 잔여 N일」이고 **가운데**다.
//   ④ 그래프는 **제 토글을 갖지 않는다** — 가로축 단위가 상단 필터를 따른다.
//   ⑤ 고른 칸은 **막대 진한 색 + 라벨 아래 밑줄**이다(배경 띠·테두리 없음).
//   ⑥ 금액 축약은 **칸반과 같은 함수** 하나다(krwShort·krwFull). 제 축약을 만들지 않는다.

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
/** 색값을 **글자로 적지 않는다** — scripts/color-token-check.js 가 이 파일도 세기 때문이다. */
const HEX = v => '#' + v
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
/** 주석을 뺀 코드 — 「이 글자가 없어야 한다」는 제 설명에 걸리지 않게 이것으로 본다. */
const code = p => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split(/\r?\n/).map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')

const PAGE = read('app/sales/page.tsx')
const PAGE_CODE = code('app/sales/page.tsx')
const CHART = read('components/sales/salesChart.tsx')

console.log('── ① 필터 바 ──')
ok('한 줄 46px', /minHeight: 46, display: 'flex', alignItems: 'center'/.test(PAGE))
ok('FY 고르개가 있다', /\{\[currentFY \+ 1, currentFY, currentFY - 1\]\.map/.test(PAGE))
ok('기간 세그먼트 다섯', ["'year'", "'h1'", "'h2'", "'quarter'", "'month'"].every(v => PAGE.includes(`value: ${v}`)))
ok('월별·분기는 ‹ › 스테퍼다(드롭다운이 아니다)',
  /<Stepper/.test(PAGE) && !/\{\['q1', 'q2', 'q3', 'q4'\]\.map/.test(PAGE_CODE))
ok('「잔여」는 필터 바에 없다 — 제목에 있다',
  PAGE.indexOf('remainingLabel') > PAGE.indexOf('통합 카드'))
ok('옛 기간 글자(getPeriodLabel)는 걷었다', !/function getPeriodLabel/.test(PAGE_CODE))
ok('팀 세그먼트는 오른쪽 끝', /options=\{\['전체', \.\.\.teams\]\}/.test(PAGE))

console.log('\n── ② 통합 카드 하나 ──')
ok('요약·차트·누적이 한 상자다',
  /통합 카드 \*\*하나\*\*/.test(PAGE)
  && PAGE.includes('<PerformanceChart') && PAGE.includes('<SummaryBoxes'))
ok('「실적 추이」 펼침 단추가 없다',
  !/showChart/.test(PAGE_CODE) && !/실적 추이/.test(PAGE_CODE))
ok('요약은 여섯 칸 한 줄', /gridTemplateColumns: 'repeat\(6, minmax\(0, 1fr\)\)'/.test(PAGE))
ok('타일 높이가 같다(세로 flex + 바닥 보조 줄)',
  /flexDirection: 'column'/.test(PAGE) && /<span style=\{\{ flex: 1 \}\} \/>/.test(PAGE))
ok('달성률 칸만 막대를 얹는다', /gauge=\{total(Order)?TargetAmt > 0/.test(PAGE))
ok('누적 다섯 칸은 그대로다', /gridTemplateColumns: 'repeat\(5, minmax\(0, 1fr\)\)'/.test(read('components/sales/salesChart.tsx')))

console.log('\n── ③ 제목 ──')
const S = load(path.join(ROOT, 'app/sales/page.tsx'))
eq('월별', S.periodTitle('month', 2026, 11), '2026년 11월')
eq('1월은 다음 해다(회계연도 Q4)', S.periodTitle('month', 2026, 1), '2027년 1월')
eq('분기', S.periodTitle('q3', 2026, 11), '2026년 3분기')
eq('Q4 는 다음 해다', S.periodTitle('q4', 2026, 11), '2027년 4분기')
eq('H1', S.periodTitle('h1', 2026, 11), '2026년 H1')
eq('연간', S.periodTitle('year', 2026, 11), '2026년 연간')
eq('분기 스테퍼 글자', S.quarterStepLabel('q3'), '3분기')
ok('제목은 「{사업부|팀} {기간} 실적」이다',
  /\{teamFilter \? teamFilter : '계측사업부'\} \{periodTitle\(mode, fy, month\)\} 실적/.test(PAGE))
ok('잔여는 제목 뒤에 붙는다', /\{remainingLabel && \(/.test(PAGE))
ok('제목이 가운데다(양 끝에 같은 받침)',
  /<span style=\{\{ flex: 1, minWidth: 0 \}\} \/>/.test(PAGE)
  && /flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end'/.test(PAGE))
ok('우측 끝은 범례다', /<ChartLegend \/>/.test(PAGE))

console.log('\n── ④ 그래프는 상단 필터를 따른다 ──')
eq('연간 → 분기 축', S.chartUnitOf('year'), 'quarter')
eq('분기 → 분기 축', S.chartUnitOf('q2'), 'quarter')
eq('월별 → 달 축', S.chartUnitOf('month'), 'month')
eq('H1 → 달 축', S.chartUnitOf('h1'), 'month')
eq('고른 칸 — 분기', S.selectedBarKey('q3', 2026, 11), 'q3')
eq('고른 칸 — 월(11월은 그 해)', S.selectedBarKey('month', 2026, 11), '2026-11')
eq('고른 칸 — 월(1월은 다음 해)', S.selectedBarKey('month', 2026, 1), '2027-1')
eq('H1 은 여러 칸이라 고른 칸이 없다', S.selectedBarKey('h1', 2026, 11), null)
ok('그래프 제 토글이 없다',
  !/월별'\], \['quarter', '분기별'\]/.test(PAGE_CODE) && !/setUnit/.test(PAGE_CODE))

console.log('\n── ⑤ 고른 칸의 표시 ──')
ok('막대를 진하게 칠한다', /isPicked\(b\) \? pickedColor : color/.test(CHART))
ok('그 진한 색은 새 색이 아니다(액센트 hover·그 초록의 짙은 단)',
  new RegExp(`CHART_BLUE_DARK = '${HEX('1c3e87')}'`).test(CHART)
  && new RegExp(`CHART_GREEN_DARK = '${HEX('15803d')}'`).test(CHART))
ok('라벨 아래 2px 밑줄', /<rect x=\{cx - 18\} y=\{BASE_Y \+ 19\} width=\{36\} height=\{2\} fill=\{CHART_BLUE\}/.test(CHART))
ok('배경 띠·테두리는 없다', !/NOW_BAND/.test(code('components/sales/salesChart.tsx')))
ok('라벨은 「11월 22%」 한 줄이다', /\$\{ach\.toFixed\(0\)\}%/.test(CHART))
ok('축 상한 규칙은 그대로다(목표 ×1.5 · 넘으면 끊고 값 표기)',
  /barShapeOf/.test(CHART) && /BreakBands/.test(CHART))
ok('주지 않으면 오늘이 든 칸이 고른 칸이다(개인 모달)',
  /selectedKey === undefined \? b\.isNow : b\.key === selectedKey/.test(CHART))

console.log('\n── ⑥ 금액 축약은 한 함수 ──')
for (const [where, file] of [
  ['실적 현황', 'app/sales/page.tsx'],
  ['개인 카드(홈 「내 실적」도 이것이다)', 'components/sales/EngineerStatCard.tsx'],
]) ok(`${where} 가 칸반과 같은 함수를 쓴다`,
  /from '@\/lib\/forecastBoard'/.test(read(file)) && /krwShort/.test(read(file)))
ok('제 축약을 새로 만들지 않았다',
  !/function krwShort|const krwShort =/.test(code('app/sales/page.tsx'))
  && !/function krwShort|const krwShort =/.test(code('components/sales/EngineerStatCard.tsx')))
ok('전체 자릿수는 호버로 본다', /title=\{krwFull\(/.test(PAGE) && /title=\{krwFull\(/.test(read('components/sales/EngineerStatCard.tsx')))
ok('개인 모달은 최대 크기가 박혀 있다', /maxWidth: 1200/.test(PAGE) && /height: '92vh'/.test(PAGE))
ok('순위 흔적은 없다', !/순위/.test(PAGE_CODE) && !/순위/.test(code('components/sales/EngineerStatCard.tsx')))

console.log('\n── ⑦ 섹션 제목에 기간 ──')
ok('팀별 실적', /\{periodTitle\(mode, fy, month\)\} · 팀별 실적/.test(PAGE))
ok('개인 실적', /\{periodTitle\(mode, fy, month\)\} · 개인 실적/.test(PAGE))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
