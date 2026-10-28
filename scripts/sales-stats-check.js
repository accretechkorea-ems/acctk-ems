// 실적 숫자 규칙 시험 — 기간 판정 · 담당자 집계 · 월별 막대 · 한 해 요약.
//
//   node scripts/sales-stats-check.js
//
// 왜 따로 두는가 — 이 숫자는 **실적 현황과 개인 대시보드가 함께 쓴다.** 두 화면이 같은 사람의
// 같은 달을 다르게 말하면 어느 쪽이 맞는지 알 길이 없다. 기간을 재는 날짜가 지표마다 다르고
// (견적일·발주일·계산서 완료일) 시각은 한국 기준으로 읽어야 해서, 한 칸만 어긋나도 갈린다.
// 화면을 띄우지 않고 규칙 함수만 돌린다.

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
  fiscalYearOf, matchPeriod, inOrderPeriod, inRevenuePeriod, periodTarget,
  engineerStat, getFYMonths, monthlyBars, remainingMonths, neededPerMonth, yearSummary, unitBars,
} = load(path.join(ROOT, 'lib/salesStats.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

const ME = 7
const FY = 2026   // 2026-04 ~ 2027-03
const q = over => ({
  engineer_id: ME, quote_date: '2026-10-05', status: '견적중',
  purchase_order_at: null, tax_invoice_completed_at: null,
  total_supply: 1000, total_profit: 0, ...over,
})
const targets = [{ engineer_id: ME, year: FY, quarter: null, target_amount: 120000, order_target_amount: 240000 }]

// ── 회계연도·기간 ─────────────────────────────────────────────────────────
console.log('── 회계연도는 4월 시작 ──')
eq('4월은 그 해', fiscalYearOf('2026-04-01'), 2026)
eq('3월은 전년도', fiscalYearOf('2027-03-31'), 2026)
eq('한국 기준으로 읽는다(UTC 3/31 15:00 = 한국 4/1 00:00)', fiscalYearOf('2026-03-31T15:00:00Z'), 2026)
eq('연간 — FY 안이면 참', matchPeriod('2027-01-15', FY, 'year', 1), true)
eq('연간 — 다음 FY 는 거짓', matchPeriod('2027-04-01', FY, 'year', 1), false)
eq('1~3월은 **다음 해**에서 찾는다', matchPeriod('2027-02-10', FY, 'month', 2), true)
eq('같은 달이어도 해가 다르면 거짓', matchPeriod('2026-02-10', FY, 'month', 2), false)
eq('분기 q4 는 1~3월', [matchPeriod('2027-02-10', FY, 'q4', 1), matchPeriod('2026-12-10', FY, 'q4', 1)], [true, false])
eq('반기 h2 는 10~3월', [matchPeriod('2026-11-01', FY, 'h2', 1), matchPeriod('2026-09-30', FY, 'h2', 1)], [true, false])
eq('목표 나누기 — 연간/월/반기/분기',
  [periodTarget(1200, 'year'), periodTarget(1200, 'month'), periodTarget(1200, 'h1'), periodTarget(1200, 'q2')],
  [1200, 100, 600, 300])

// ── 지표마다 다른 날짜 ────────────────────────────────────────────────────
console.log('\n── 수주는 발주일, 매출은 계산서 완료일 ──')
eq('수주 — 발주일이 그 달',
  inOrderPeriod(q({ status: '주문완료', purchase_order_at: '2026-11-03T01:00:00Z' }), FY, 'month', 11), true)
eq('견적일이 그 달이어도 발주일이 아니면 아니다',
  inOrderPeriod(q({ status: '주문완료', purchase_order_at: '2026-11-03T01:00:00Z' }), FY, 'month', 10), false)
eq('발주일이 없으면 어느 기간에도 들지 않는다',
  inOrderPeriod(q({ status: '주문완료' }), FY, 'year', 1), false)
eq('매출 — 상태가 매출완료라야 한다',
  [inRevenuePeriod(q({ status: '매출완료', tax_invoice_completed_at: '2026-12-01T01:00:00Z' }), FY, 'month', 12),
   inRevenuePeriod(q({ status: '주문완료', tax_invoice_completed_at: '2026-12-01T01:00:00Z' }), FY, 'month', 12)],
  [true, false])
eq('한국 새벽 시각이 전달로 밀리지 않는다(UTC 10/31 16:00 = 한국 11/1)',
  inOrderPeriod(q({ status: '주문완료', purchase_order_at: '2026-10-31T16:00:00Z' }), FY, 'month', 11), true)

// ── 담당자 한 명분 ────────────────────────────────────────────────────────
console.log('\n── 담당자 집계 ──')
{
  const stat = engineerStat([
    q({ total_supply: 1000 }),
    q({ status: '주문완료', purchase_order_at: '2026-11-03T01:00:00Z', total_supply: 2000 }),
    q({ status: '매출완료', purchase_order_at: '2026-09-01T01:00:00Z', tax_invoice_completed_at: '2026-12-01T01:00:00Z', total_supply: 3000, total_profit: 600 }),
    q({ engineer_id: 99, total_supply: 9999 }),
  ], targets, { engineerId: ME, fy: FY, mode: 'year', month: 1 })
  eq('견적 제출 합계', stat.quotedAmt, 6000)
  eq('건수도 센다', [stat.quotedCnt, stat.orderedCnt], [3, 2])
  eq('수주는 매출완료 건도 포함(발주가 났다)', stat.orderedAmt, 5000)
  eq('매출', stat.revenueAmt, 3000)
  eq('순이익·이익률', [stat.profitAmt, Math.round(stat.profitRate)], [600, 20])
  eq('연간 목표는 그대로', [stat.targetAmt, stat.orderTargetAmt], [120000, 240000])
  eq('남의 건은 세지 않는다', stat.quotedAmt < 9999, true)
}

// ── 월별 막대 ─────────────────────────────────────────────────────────────
console.log('\n── 월별 막대(한 달에 넷) ──')
{
  const bars = monthlyBars([
    q({ status: '주문완료', purchase_order_at: '2026-11-03T01:00:00Z', total_supply: 50000 }),
    q({ status: '매출완료', purchase_order_at: '2026-11-03T01:00:00Z', tax_invoice_completed_at: '2027-01-10T01:00:00Z', total_supply: 30000, total_profit: 6000 }),
  ], targets, { engineerId: ME, fy: FY })
  eq('열두 달', bars.length, 12)
  eq('4월에서 시작해 3월에 끝난다', [bars[0].label, bars[11].label], ['4월', '3월'])
  eq('1~3월은 다음 해다', [bars[9].year, bars[11].year], [2027, 2027])
  const nov = bars.find(b => b.month === 11)
  const jan = bars.find(b => b.month === 1)
  eq('11월 — 수주 둘(발주일 기준)', nov.orderedAmt, 80000)
  eq('11월 — 매출은 아직 없다', nov.revenueAmt, 0)
  eq('1월 — 매출이 거기 잡힌다', [jan.revenueAmt, jan.profitAmt], [30000, 6000])
  eq('월 목표 = 연간 ÷ 12', [nov.orderTarget, nov.salesTarget], [20000, 10000])
  eq('달성률', [Math.round(nov.orderAchieve), Math.round(jan.salesAchieve)], [400, 300])
  eq('목표가 없으면 달성률은 null',
    monthlyBars([], [], { engineerId: ME, fy: FY })[0].orderAchieve, null)
}

// ── 남은 개월 ─────────────────────────────────────────────────────────────
console.log('\n── 남은 개월(이번 달 포함) ──')
eq('4월에 열면 12', remainingMonths(FY, '2026-04-01'), 12)
eq('10월에 열면 6', remainingMonths(FY, '2026-10-22'), 6)
eq('12월에 열면 4', remainingMonths(FY, '2026-12-31'), 4)
eq('1월에 열면 3', remainingMonths(FY, '2027-01-01'), 3)
eq('**3월에 열면 1**', remainingMonths(FY, '2027-03-15'), 1)
eq('지난 회계연도는 0', remainingMonths(FY, '2027-04-01'), 0)
eq('다음 회계연도는 12', remainingMonths(FY, '2026-03-31'), 12)

console.log('\n── 한 달에 얼마씩 더 해야 하는가 ──')
eq('(목표 − 누적) ÷ 남은 달', neededPerMonth(1200, 200, 5), 200)
eq('나누어떨어지지 않으면 올린다', neededPerMonth(1000, 0, 3), 334)
eq('이미 넘겼으면 「달성」', neededPerMonth(1000, 1000, 5), 'done')
eq('더 넘겨도 「달성」', neededPerMonth(1000, 5000, 5), 'done')
eq('**목표가 0이면 null**(0으로 나누지 않는다)', neededPerMonth(0, 0, 5), null)
eq('**남은 달이 0이면 null**', neededPerMonth(1000, 0, 0), null)

// ── 한 해 요약 ────────────────────────────────────────────────────────────
console.log('\n── 보조 지표 다섯 칸 ──')
{
  const sum = yearSummary([
    q({ status: '주문완료', purchase_order_at: '2026-11-03T01:00:00Z', total_supply: 60000 }),
    q({ status: '매출완료', purchase_order_at: '2026-11-03T01:00:00Z', tax_invoice_completed_at: '2027-01-10T01:00:00Z', total_supply: 30000, total_profit: 6000 }),
    q({ status: '견적중', total_supply: 7000 }),
    q({ status: '견적중', total_supply: 3000, quote_date: '2025-01-01' }),   // 기간을 보지 않는다
    q({ status: '실패', total_supply: 9000 }),                               // 잔량이 아니다
    q({ engineer_id: 99, status: '견적중', total_supply: 9999 }),            // 남의 건
  ], targets, { engineerId: ME, fy: FY, today: '2026-10-22' })
  eq('① 누적 수주', sum.orderedAmt, 90000)
  eq('① 수주 달성률', Math.round(sum.orderAchieve), 38)
  eq('② 누적 매출', sum.revenueAmt, 30000)
  eq('② 매출 달성률', Math.round(sum.salesAchieve), 25)
  eq('③ 순이익·이익률', [sum.profitAmt, Math.round(sum.profitRate)], [6000, 20])
  eq('④ 남은 개월(10월)', sum.remaining, 6)
  eq('④ 월평균 필요 수주 = (240000−90000)÷6', sum.needOrder, 25000)
  eq('④ 월평균 필요 매출 = (120000−30000)÷6', sum.needSales, 15000)
  eq('⑤ 견적중 잔량 — 오래된 것도 세고 남의 건·실패는 뺀다', [sum.pendingAmt, sum.pendingCnt], [10000, 2])
}
eq('목표가 없으면 달성률·필요액이 전부 null',
  (() => { const s2 = yearSummary([], [], { engineerId: ME, fy: FY, today: '2026-10-22' })
    return [s2.orderAchieve, s2.salesAchieve, s2.needOrder, s2.needSales] })(),
  [null, null, null, null])

eq('가로축은 늘 열두 달', getFYMonths(FY).length, 12)

// ── 여러 사람 합 · 단위별 목표 ───────────────────────────────────────────────
// 사업부 전체 그래프가 쓰는 길이다(실적 현황 상단). 개인 그래프와 **같은 함수**를 쓰므로
// 사업부 숫자는 개인 숫자의 합과 어긋날 수 없다 — 그 약속을 여기서 못 박는다.
console.log('\n── 여러 사람(engineerIds) 합 ──')
{
  const YOU = 8
  const two = [
    { engineer_id: ME, year: FY, quarter: null, target_amount: 120000, order_target_amount: 240000 },
    { engineer_id: YOU, year: FY, quarter: null, target_amount: 60000, order_target_amount: 120000 },
    // 분기 목표 줄은 보지 않는다(연간 줄만 정본).
    { engineer_id: ME, year: FY, quarter: 1, target_amount: 999999, order_target_amount: 999999 },
    // id 가 비어 있는 옛 줄은 어느 범위에도 들지 않는다.
    { engineer_id: null, year: FY, quarter: null, target_amount: 777, order_target_amount: 777 },
  ]
  const quotes = [
    q({ engineer_id: ME, status: '수주', purchase_order_at: '2026-05-10', total_supply: 10000 }),
    q({ engineer_id: YOU, status: '수주', purchase_order_at: '2026-05-20', total_supply: 20000 }),
    q({ engineer_id: 99, status: '수주', purchase_order_at: '2026-05-21', total_supply: 50000 }),   // 범위 밖
  ]
  const mine = monthlyBars(quotes, two, { engineerId: ME, fy: FY })
  const yours = monthlyBars(quotes, two, { engineerId: YOU, fy: FY })
  const both = monthlyBars(quotes, two, { engineerIds: [ME, YOU], fy: FY })
  const may = b => b.find(x => x.month === 5)
  eq('5월 수주 — 둘의 합', may(both).orderedAmt, may(mine).orderedAmt + may(yours).orderedAmt)
  eq('범위 밖 사람은 빠진다', may(both).orderedAmt, 30000)
  eq('월 수주 목표 — 두 사람 연간 합 ÷ 12', may(both).orderTarget, Math.round(360000 / 12))
  eq('월 매출 목표 — 두 사람 연간 합 ÷ 12', may(both).salesTarget, Math.round(180000 / 12))
  const sum = yearSummary(quotes, two, { engineerIds: [ME, YOU], fy: FY, today: '2026-10-22' })
  eq('연간 목표도 합', [sum.orderTarget, sum.salesTarget], [360000, 180000])
}

console.log('\n── 단위별 칸과 목표(÷12 · ÷4 · ×1) ──')
{
  const today = '2026-10-22'
  const quotes = [
    q({ status: '수주', purchase_order_at: '2026-05-10', total_supply: 10000 }),        // Q1
    q({ status: '수주', purchase_order_at: '2026-11-10', total_supply: 30000 }),        // Q3
    q({ tax_invoice_completed_at: '2026-05-11', status: '매출완료', total_supply: 7000, total_profit: 700 }),
  ]
  const months = unitBars(quotes, targets, { engineerId: ME, fy: FY, unit: 'month', today })
  const quarters = unitBars(quotes, targets, { engineerId: ME, fy: FY, unit: 'quarter', today })
  const years = unitBars(quotes, targets, { engineerId: ME, fy: FY, unit: 'year', today })

  eq('월 — 칸 열둘', months.length, 12)
  eq('월 — 목표는 연간 ÷ 12', months[0].orderTarget, Math.round(240000 / 12))
  eq('월 — 지금 칸은 10월 하나', months.filter(b => b.isNow).map(b => b.label), ['10월'])

  eq('분기 — 칸 넷', quarters.map(b => b.label), ['Q1', 'Q2', 'Q3', 'Q4'])
  eq('분기 — 목표는 연간 ÷ 4', quarters[0].orderTarget, Math.round(240000 / 4))
  eq('분기 — Q1 에 5월 수주가 든다', quarters[0].orderedAmt, 10000)
  eq('분기 — Q3 에 11월 수주가 든다', quarters[2].orderedAmt, 30000)
  eq('분기 — 열두 달 합과 같다',
    quarters.reduce((a, b) => a + b.orderedAmt, 0), months.reduce((a, b) => a + b.orderedAmt, 0))
  eq('분기 — 지금은 Q3(10월)', quarters.filter(b => b.isNow).map(b => b.label), ['Q3'])
  eq('분기 — 둘째 줄', quarters.map(b => b.sub), ['4~6월', '7~9월', '10~12월', '1~3월'])

  eq('연도 — FY−1·FY·FY+1', years.map(b => b.label), ['FY2025', 'FY2026', 'FY2027'])
  eq('연도 — 목표는 연간 그대로(÷ 하지 않는다)', years[1].orderTarget, 240000)
  eq('연도 — 목표가 없는 해는 달성률 null', [years[0].orderTarget, years[0].orderAchieve], [0, null])
  eq('연도 — FY 칸이 열두 달 합과 같다', years[1].orderedAmt, months.reduce((a, b) => a + b.orderedAmt, 0))
  eq('연도 — 지금은 FY2026', years.filter(b => b.isNow).map(b => b.label), ['FY2026'])
  eq('매출도 같은 규칙(Q1 에 5월 계산서)', quarters[0].revenueAmt, 7000)
  eq('이익도 칸을 따라간다', quarters[0].profitAmt, 700)
}

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
