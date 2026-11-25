// 포캐스트 칸반 정돈 (2026-11-26).
//
//   node scripts/forecast-board-check.js
//
// 지키는 약속
//   ① 판은 **기간으로 자르지 않는다**(기본은 살아 있는 건 전부). 기간은 띠의 **분포**로
//     보여 주고, 누르면 그 분기만 · 한 번 더 누르면 전부다.
//   ② 금액은 「1억 2,600만」까지 적고 전체 자릿수는 호버다. 「1.3억」처럼 뭉개지 않는다.
//   ③ 띠는 **판에 보이는 줄만** 센다(분포만 분기를 고르기 전 줄에서 센다 — 다른 분기로
//     옮겨 갈 수 있어야 한다).
//   ④ 카드에 「＋ 할 일」 · 「견적 쓰기」 · 연결 견적 뱃지가 있다.

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

const B = load(path.join(ROOT, 'lib/forecastBoard.ts'))

let fails = 0
const eq = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want)
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}`)
  if (!good) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

console.log('── ① 금액 축약 ──')
eq('억·만을 둘 다 적는다', B.krwShort(126000000), '1억 2,600만')
eq('억만 있으면 억만', B.krwShort(200000000), '2억')
eq('억 미만', B.krwShort(85000000), '8,500만')
eq('만 미만은 원', B.krwShort(3000), '3,000')
eq('0·없음은 줄표', [B.krwShort(0), B.krwShort(null)], ['-', '-'])
eq('음수도 적는다', B.krwShort(-12000000), '-1,200만')
eq('억 자리가 네 자리면 쉼표', B.krwShort(123400000000), '1,234억')
eq('억·만이 있으면 원 단위는 적지 않는다', B.krwShort(100000300), '1억')
eq('호버는 전체 자릿수', B.krwFull(126000000), '₩126,000,000')
ok('1.3억 식으로 뭉개지 않는다', !/\./.test(B.krwShort(130000000)) && !/\./.test(B.krwShort(125000000)))

console.log('\n── ② 분기 ──')
eq('달력 분기다 — 12월은 4Q', B.quarterKeyOf('2026-12-31'), '26 4Q')
eq('1월은 다음 해 1Q', B.quarterKeyOf('2027-01-31'), '27 1Q')
eq('3월도 1Q', B.quarterKeyOf('2027-03-31'), '27 1Q')
eq('4월은 2Q', B.quarterKeyOf('2027-04-30'), '27 2Q')
eq('마감일이 없으면 빈 열쇠', B.quarterKeyOf(null), '')
eq('그 글자는 「미정」', B.quarterLabel(''), '미정')

const deals = [
  { opportunity_id: 1, stage: '협상', expected_amount: 210000000, expected_close: '2026-12-31' },
  { opportunity_id: 2, stage: '견적제출', expected_amount: 64000000, expected_close: '2027-01-31' },
  { opportunity_id: 3, stage: '상담', expected_amount: 12000000, expected_close: null },
  { opportunity_id: 4, stage: '협상', expected_amount: null, expected_close: '2026-12-31' },
]
const slices = B.quarterSlices(deals)
eq('이른 분기부터, 미정은 끝', slices.map(s => s.label), ['26 4Q', '27 1Q', '미정'])
eq('건수와 합계를 함께 센다', [slices[0].count, slices[0].sum], [2, 210000000])
eq('금액이 빈 건도 건수로는 센다', slices[0].count, 2)

console.log('\n── ③ 띠의 수 ──')
const STAGES = ['상담', '사양검토', '견적제출', '협상', '수주']
const sum = B.boardSummary(deals, STAGES, '2026-12-05')
eq('건수·합계', [sum.count, sum.sum], [4, 286000000])
eq('단계별 수 — 없는 단계도 0 으로 남는다', sum.byStage.map(s => s.count), [1, 0, 1, 2, 0])
eq('단계 차례는 받은 그대로', sum.byStage.map(s => s.stage), STAGES)
eq('이번 달 마감 — 그 달에 닫히는 건만', sum.soon, 2)
eq('다른 달에 보면 0', B.boardSummary(deals, STAGES, '2027-02-05').soon, 0)
eq('목록에 없는 단계는 세지 않는다(합계는 센다)',
  B.boardSummary([{ opportunity_id: 9, stage: '실주', expected_amount: 1000, expected_close: null }], STAGES, '2026-12-05')
    .byStage.reduce((s, x) => s + x.count, 0), 0)

console.log('\n── ④ 분기 고르기 ──')
ok('아무것도 고르지 않으면 전부', deals.every(d => B.inQuarter(d, null)))
eq('고른 분기만 남는다', deals.filter(d => B.inQuarter(d, '26 4Q')).map(d => d.opportunity_id), [1, 4])
eq('미정도 고를 수 있다', deals.filter(d => B.inQuarter(d, '')).map(d => d.opportunity_id), [3])

console.log('\n── ⑤ 화면 ──')
const PAGE = read('app/pipeline/page.tsx')
const CARD = read('components/pipeline/OpportunityCard.tsx')
ok('기간 거르개를 새로 두지 않았다(기본은 전부)', /useState<string \| null>\(null\)/.test(PAGE) && /setQuarter\(on \? null : s\.key\)/.test(PAGE))
ok('한 번 더 누르면 전부로 돌아온다', /분기 전체/.test(PAGE))
ok('띠는 한 줄이다', /컴팩트 띠 하나/.test(PAGE))
ok('띠에 건수·합계·단계별 수·이번 달 마감이 있다',
  /진행 중/.test(PAGE) && /단계<\/span>/.test(PAGE) && /이번 달 마감/.test(PAGE) && /예정 분기/.test(PAGE))
ok('띠는 판에 보이는 줄을 센다', /boardSummary\(shown\.filter\(o => !isClosed\(o\)\), BOARD_STAGES/.test(PAGE))
ok('분포는 분기를 고르기 전 줄에서 센다', /quarterSlices\(filtered\.filter\(o => !isClosed\(o\)\)\)/.test(PAGE))
ok('판·끝난 건은 고른 분기를 따른다', /const shown = useMemo\(\(\) => filtered\.filter\(o => inQuarter\(o, quarter\)\)/.test(PAGE)
  && /\[shown, pendingStage\]/.test(PAGE) && /shown\.filter\(o => isClosed\(o\)\)/.test(PAGE))
ok('카드 금액은 축약 + 호버 전체', /title=\{krwFull\(opp\.expected_amount\)\}/.test(CARD) && /krwShort\(opp\.expected_amount\)/.test(CARD))
ok('연결 견적은 뱃지다', /견적 \{quoteCount\}/.test(CARD) && /borderRadius: R\.pill/.test(CARD))
ok('카드에 「＋ 할 일」이 있다', /<TaskAddButton/.test(CARD) && /type: 'forecast'/.test(CARD))
ok('「견적 쓰기」는 그대로다', /견적 쓰기/.test(CARD) && /onWriteQuote/.test(CARD))
ok('카드 높이를 줄였다(패딩 10)', /padding: '10px 12px'/.test(CARD))
// 주석에는 compactKRW 라는 이름이 남아 있다(왜 바꿨는지 적어 둔 글이다) — **부르는 자리**만 본다.
ok('열 합계도 같은 축약이다(카드와 글자가 같다)',
  PAGE.includes('krwShort(col.sum)') && !PAGE.includes('{compactKRW('))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
