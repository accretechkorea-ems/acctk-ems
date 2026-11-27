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
/** 주석을 뺀 코드 — 「이 글자가 **없어야** 한다」는 제 설명에 걸리지 않게 이것으로 본다. */
const strip = t => t
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split(/\r?\n/).map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
const PAGE_CODE = strip(PAGE)
ok('기간 거르개를 새로 두지 않았다(기본은 전부)', /useState<string \| null>\(null\)/.test(PAGE) && /setQuarter\(on \? null : s\.key\)/.test(PAGE))
ok('한 번 더 누르면 전부로 돌아온다', /분기 전체/.test(PAGE))
// 2026-11-26 묶음2 C1 — 제목 카드와 띠가 **카드 하나**가 됐다(위 44px · 아래 34px).
ok('상단은 카드 하나다(제목·띠가 한 상자)', /상단 카드 \*\*하나\*\*/.test(PAGE))
ok('아래 띠는 접을 수 있다', /지표 숨기기 ▴/.test(PAGE) && /지표 보기 ▾/.test(PAGE))
ok('접힘은 사용자별로 이 브라우저에 남는다',
  /useStoredFlag\(`pipeline:metrics:\$\{me\.engineer_id \?\? 'anon'\}`, true\)/.test(PAGE))
ok('그 저장은 수화를 깨지 않는다(서버에서는 기본값)',
  /getServerSnapshot/.test(read('lib/storedFlag.ts')) && /useSyncExternalStore/.test(read('lib/storedFlag.ts')))
// ③ 2026-11-26 확인 — 「14일 활동 없음」 자리는 **띠에 없다**(세려면 활동 이력을 한 번 더
//   읽어야 하고, 같은 수를 홈의 「멈춘 딜」 타일이 이미 보여 준다 — lib/forecastBoard.ts 주석).
ok('띠에 「활동 없음」 자리가 없다', !/활동 없음/.test(PAGE_CODE))
// C2 — 「단계」 묶음은 **띠에서 뺐다**. 열 머리가 같은 말을 이미 한다.
ok('띠에 단계 묶음이 없다', !/단계<\/span>/.test(PAGE_CODE))
ok('그 수는 열 머리가 보여 준다', /\{col\.stage\}/.test(PAGE) && /\{col\.rows\.length\}/.test(PAGE))
ok('띠에 건수·합계·이번 달 마감·예정 분기가 있다',
  /진행 중 /.test(PAGE) && /이번 달 마감 /.test(PAGE) && /예정 분기/.test(PAGE))
// 팝오버의 **제목**에는 그 글자가 남는다(창 이름이다) — 사라져야 하는 것은 **단추**다.
ok('엑셀은 공용 ⬇ 아이콘이다', /<ExcelIconButton/.test(PAGE)
  && !/엑셀 내보내기\s*<\/button>/.test(PAGE_CODE))
// 2026-11-28(야간4 4-3) — 「끝난 건」 묶음을 걷고 세그먼트(진행 중|수주|실주|전체)로 바꿨다.
// 판에 서는 줄의 판정도 isClosed 하나에서 onBoard 로 옮겼다 — 수주는 30일까지만 선다.
ok('띠는 판에 보이는 줄을 센다', /boardSummary\(shown\.filter\(o => onBoard\(o, today\)\), BOARD_STAGES/.test(PAGE))
ok('분포는 분기를 고르기 전 줄에서 센다', /quarterSlices\(filtered\.filter\(o => onBoard\(o, today\)\)\)/.test(PAGE))
ok('판은 고른 분기를 따른다', /const shown = useMemo\(\(\) => filtered\.filter\(o => inQuarter\(o, quarter\)\)/.test(PAGE)
  && /\[shown, pendingStage, tasks, today\]/.test(PAGE))
ok('「끝난 건」 접이 묶음은 걷혔다', !/끝난 건<\/span>/.test(PAGE) && !/setShowLost/.test(PAGE))
ok('그 자리를 세그먼트가 대신한다', /<SegmentedControl/.test(PAGE) && /FORECAST_VIEWS\.map/.test(PAGE))
ok('끝난 건은 표로 선다', /<ClosedTable/.test(PAGE))
ok('카드 금액은 축약 + 호버 전체', /title=\{krwFull\(opp\.expected_amount\)\}/.test(CARD) && /krwShort\(opp\.expected_amount\)/.test(CARD))
ok('연결 견적은 뱃지다', /견적 \{quoteCount\}/.test(CARD) && /borderRadius: R\.pill/.test(CARD))
ok('카드에 「＋ 할 일」이 있다', /<TaskAddButton/.test(CARD) && /type: 'forecast'/.test(CARD))
ok('「견적 쓰기」는 그대로다', /견적 쓰기/.test(CARD) && /onWriteQuote/.test(CARD))
ok('카드 여백은 그대로다(10)', /padding: '10px 12px'/.test(CARD))
// C3 — 카드는 다섯 줄이다.
ok('1행 회사 » 사업장', /company=\{customerCompanyName\(o\.customers\)\}/.test(PAGE)
  && /site=\{shortSiteName\(/.test(PAGE) && /' » '/.test(CARD))
// 2026-11-28(야간4 3-3) — 이니셜 동그라미를 걷고 **이름**을 제목 줄 오른쪽에 두었다.
// 두 글자로는 누구인지 알아맞혀야 했고, 같은 성씨가 둘이면 알 수도 없었다.
ok('1행 오른쪽에 담당자 이름', /const ownerLabel = /.test(CARD) && /{ownerLabel || .담당 없음.}/.test(CARD))
ok('이니셜 동그라미는 없다', !/initialsOf(owner)/.test(CARD))
ok('4행은 예정 · 마지막 활동 둘뿐', CARD.includes('예정 {dueLabelOf(opp.expected_close)}') && CARD.includes('마지막 활동 {idleLabel(idleDays)}'))
ok('5행 다음 할 일 띠', /nextTaskLabel\(nextTask\)/.test(CARD) && /isTaskLate\(nextTask, today\)/.test(CARD))
ok('늦은 할 일은 빨간 바탕 + ⚠(이모지 아님, 인라인 SVG)',
  /background: late \? LATE_BG/.test(CARD) && /\{late && \(/.test(CARD) && /<svg/.test(CARD))
// ── 2026-11-27 야간3 0 — 흐림을 걷고 띠·차례로 가린다 ──────────────────────
ok('카드를 흐리게 하지 않는다(0-1)', !/opacity: dim/.test(CARD) && !/opacity: 0\.55/.test(CARD))
ok('대신 「N일 전」 글자만 빨갛다',
  /color: stalled \? LATE : MUTED/.test(CARD) && /fontWeight: stalled \? 600 : 400/.test(CARD))
ok('그 판정은 14일 그대로다', /IDLE_DIM_DAYS = 14/.test(read('lib/forecastBoard.ts')))
ok('이번 달 마감 노란 띠가 있다(0-2)',
  /\{dueSoon && \(/.test(CARD) && /background: DUE_BG, color: DUE/.test(CARD) && /이번 달 마감/.test(CARD))
ok('그 띠는 다음 할 일 띠 **위**다', CARD.indexOf('dueSoon && (') < CARD.indexOf('nextTaskLabel(nextTask)'))
ok('띠 아이콘은 이모지가 아니라 인라인 SVG 다', !/⏰/.test(strip(CARD)))
ok('두 띠는 **함께** 설 수 있다(둘을 가르는 조건이 없다)',
  !/dueSoon \? [\s\S]{0,40}: late/.test(CARD))
ok('카드의 판정과 머리 띠의 수가 **같은 함수**다(0-3)',
  /isDueThisMonth\(opp\.expected_close, today\)/.test(CARD)
  && /export const isDueThisMonth/.test(read('lib/forecastBoard.ts')))
ok('열 안 차례 — 이번 달 마감 → 지난 할 일 → 나머지',
  /cardRank\(a, \{ today, taskLate:/.test(PAGE) && /ra !== rb \? ra - rb : byDueDate\(a, b\)/.test(PAGE))
ok('마지막 활동은 **이미 읽어 둔 활동 줄**로 만든다(조회를 늘리지 않는다)',
  /lastActivityByOpp\(activities\)/.test(PAGE))
ok('다음 할 일은 /api/task 가 준다', /action: 'list'/.test(PAGE) && /pickNextTask\(tasks, /.test(PAGE))
// C4 — 판에 들어오면 사이드바를 임시로 접는다(고객사 탭과 같은 규칙).
const RAIL = read('lib/railPaths.ts')
ok('포캐스트도 사이드바를 접는 화면이다', /'\/pipeline'/.test(RAIL))
ok('그 접힘은 임시다(저장값을 건드리지 않는다)', /접힘은 「임시」다/.test(RAIL))
// 주석에는 compactKRW 라는 이름이 남아 있다(왜 바꿨는지 적어 둔 글이다) — **부르는 자리**만 본다.
ok('열 합계도 같은 축약이다(카드와 글자가 같다)',
  PAGE.includes('krwShort(col.sum)') && !PAGE.includes('{compactKRW('))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
